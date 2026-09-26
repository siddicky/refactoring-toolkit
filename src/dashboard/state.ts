/**
 * Pure dashboard aggregation: dex history/state snapshots + git rows + kill
 * events -> the /api/state view model. No I/O here; queries.ts performs the
 * reads, tests feed fixtures straight in.
 *
 * Faithful to the event contract (src/metrics/types.ts): envelope events are
 * {stepId, role, file, round, attempt, started_at, ended_at, outcome, tokens,
 * wall_clock_ms}; `tokens` is required (non-null) for model-calling roles and
 * null-as-not-applicable otherwise. The live flow envelope stores the token
 * TOTAL as a number; the metrics variant is {input_tokens, output_tokens} —
 * both are accepted.
 */

import type {
  BurnDownSample,
  BurnDownSeriesView,
  CommitView,
  DashboardStateView,
  DexActiveStepWire,
  DexAttributeWire,
  DexHistoryWire,
  DexFlowSummaryWire,
  DexStateWire,
  FeedEntry,
  FlowView,
  GitCommitRow,
  GitWorktreeRow,
  GridRow,
  KillTimelineEntryView,
  KillTimelineGroupView,
  NormalizedKillEvent,
  QueueSummaryView,
  SourceStatus,
  AgentUsageView,
  UsageSplitView,
} from "./types.js";

// ---------------------------------------------------------------------------
// Envelope parsing
// ---------------------------------------------------------------------------

/**
 * Local mirror of the flow envelope's model-calling roles
 * (flows/steps/envelope.ts). Duplicated deliberately: importing the flow
 * module would pull the dex SDK and couple the dashboard to concurrently
 * edited flow code. If the envelope contract adds a model role, update here.
 */
const MODEL_ROLES: ReadonlySet<string> = new Set(["agent", "review", "judgment"]);

export interface ParsedEnvelope {
  stepId: string;
  role: string;
  file: string | null;
  round: number | null;
  attempt: number;
  started_at: string;
  ended_at: string | null;
  outcome: string;
  tokens: number | null;
  usage: UsageSplitView | null;
  wall_clock_ms: number | null;
  tokensRequired: boolean;
}

/** Shape-checks a durable attribute value into a ParsedEnvelope. */
export function parseEnvelope(value: unknown): ParsedEnvelope | null {
  if (value === null || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const stepId = rec.stepId;
  const role = rec.role;
  const attempt = rec.attempt;
  const startedAt = rec.started_at;
  if (typeof stepId !== "string" || typeof role !== "string") return null;
  if (typeof attempt !== "number" || typeof startedAt !== "string") return null;
  return {
    stepId,
    role,
    file: typeof rec.file === "string" ? rec.file : null,
    round: typeof rec.round === "number" ? rec.round : null,
    attempt,
    started_at: startedAt,
    ended_at: typeof rec.ended_at === "string" ? rec.ended_at : null,
    outcome: typeof rec.outcome === "string" ? rec.outcome : "unknown",
    tokens: normalizeTokens(rec.tokens),
    usage: parseUsageSplit(rec.tokens),
    wall_clock_ms: typeof rec.wall_clock_ms === "number" ? rec.wall_clock_ms : null,
    tokensRequired: MODEL_ROLES.has(role),
  };
}

/** Token TOTAL; accepts a number or the metrics TokenUsage object. */
export function normalizeTokens(raw: unknown): number | null {
  if (typeof raw === "number") return raw;
  if (raw !== null && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    const input = rec.input_tokens;
    const output = rec.output_tokens;
    if (typeof input === "number" && typeof output === "number") {
      return (
        input +
        output +
        numOr(rec.reasoning_tokens, 0) +
        numOr(rec.cache_read_tokens, 0) +
        numOr(rec.cache_write_tokens, 0)
      );
    }
  }
  return null;
}

/** Wave-5 cost honesty: the provider usage split, when the envelope carries it. */
export function parseUsageSplit(raw: unknown): UsageSplitView | null {
  if (raw === null || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const input = rec.input_tokens;
  const output = rec.output_tokens;
  if (typeof input !== "number" || typeof output !== "number") return null;
  return {
    input,
    output,
    reasoning: numOr(rec.reasoning_tokens, 0),
    cacheRead: numOr(rec.cache_read_tokens, 0),
    cacheWrite: numOr(rec.cache_write_tokens, 0),
    costUsd: numOr(rec.cost_usd, 0),
  };
}

function numOr(v: unknown, dflt: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : dflt;
}

/** Human stage label for a step id / dex step type. */
export function stageLabel(stepIdOrType: string): string {
  const compact = stepIdOrType.toLowerCase().replace(/[^a-z0-9]/g, "");
  const map: Record<string, string> = {
    "ppimplement": "implementer",
    "ppreviewa": "reviewer-1",
    "ppreviewb": "reviewer-2",
    "ppfixer": "fixer",
    "ppverdictcheck": "verdict-check",
    "ppprioritize": "prioritize",
    "ppcommit": "commit",
    "ppintegrate": "integration",
    "pprelease": "release",
    "ppdispatch": "dispatch",
    "pplease": "lease",
    "ppfence": "fence",
    "ppprep": "prep",
    "ppfinal": "final",
    "ppcapturediff": "diff-capture",
  };
  return map[compact] ?? stepIdOrType;
}

function tsMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function envelopeTs(e: ParsedEnvelope): string {
  return e.ended_at ?? e.started_at;
}

// ---------------------------------------------------------------------------
// History walk: dispatch context + envelope feed entries
// ---------------------------------------------------------------------------

interface StepContext {
  file: string;
  round: number | null;
  epoch: number | null;
}

function stepInputContext(raw: unknown): StepContext | null {
  if (raw === null || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.file !== "string" || rec.file.length === 0) return null;
  return {
    file: rec.file,
    round: typeof rec.round === "number" ? rec.round : null,
    epoch: typeof rec.epoch === "number" ? rec.epoch : null,
  };
}

export interface DispatchRow {
  flowId: string;
  stepExecutionId: string;
  stepType: string;
  finalAttempt: number | null;
  eventTime: string;
}

export interface HistoryWalkResult {
  feed: FeedEntry[];
  dispatch: DispatchRow[];
  burnDown: BurnDownSample[];
}

/**
 * Walks one flow's durable history in event order, threading the current
 * file/round context (from FileRoundInput step inputs) onto envelope upserts —
 * live envelope events carry file/round as null, the context restores them.
 */
export function walkHistory(flowId: string, history: DexHistoryWire): HistoryWalkResult {
  const events = [...history.events].sort((a, b) => Number(a.eventId) - Number(b.eventId));
  const feed: FeedEntry[] = [];
  const dispatch: DispatchRow[] = [];
  const burnDown: BurnDownSample[] = [];
  let ctx: StepContext | null = null;

  for (const event of events) {
    const payload = event.payload ?? {};
    // Any stepInput carrying a file updates the context (LeaseStep onward,
    // every chained step input is a FileRoundInput).
    const candidates: Array<Record<string, unknown> | undefined> = [
      payload.initialStart?.stepInput,
      payload.input?.stepInput,
      payload.movement?.stepInput,
    ];
    for (const next of payload.output?.stepDecision?.nextSteps ?? []) {
      candidates.push(next.stepInput);
    }
    for (const candidate of candidates) {
      const found = stepInputContext(candidate);
      if (found !== null) ctx = found;
    }

    const stepCtx = payload.context;
    if (stepCtx !== undefined && typeof stepCtx.stepExecutionId === "string") {
      dispatch.push({
        flowId,
        stepExecutionId: stepCtx.stepExecutionId,
        stepType: stepCtx.stepType ?? "",
        finalAttempt: typeof stepCtx.finalAttempt === "number" ? stepCtx.finalAttempt : null,
        eventTime: event.eventTime,
      });
    }

    for (const upsert of payload.output?.upsertAttributes ?? []) {
      collectUpsert(flowId, upsert, ctx, feed, burnDown);
    }
  }
  return { feed, dispatch, burnDown };
}

/** Latest-state fallback when history is unavailable: no context threading. */
export function feedFromState(flowId: string, state: DexStateWire): {
  feed: FeedEntry[];
  burnDown: BurnDownSample[];
} {
  const feed: FeedEntry[] = [];
  const burnDown: BurnDownSample[] = [];
  for (const attr of state.attributes ?? []) {
    collectUpsert(flowId, attr, null, feed, burnDown);
  }
  return { feed, burnDown };
}

function collectUpsert(
  flowId: string,
  upsert: DexAttributeWire,
  ctx: StepContext | null,
  feed: FeedEntry[],
  burnDown: BurnDownSample[],
): void {
  const key = typeof upsert?.key === "string" ? upsert.key : "";
  if (key.startsWith("envelope-event/")) {
    const parsed = parseEnvelope(upsert.value);
    if (parsed === null) return;
    feed.push({
      flowId,
      ts: envelopeTs(parsed),
      startedAt: parsed.started_at,
      endedAt: parsed.ended_at,
      stepId: parsed.stepId,
      role: parsed.role,
      file: parsed.file ?? ctx?.file ?? null,
      round: parsed.round ?? ctx?.round ?? null,
      attempt: parsed.attempt,
      outcome: parsed.outcome,
      tokens: parsed.tokens,
      usage: parsed.usage,
      wallClockMs: parsed.wall_clock_ms,
      tokensRequired: parsed.tokensRequired,
    });
    return;
  }
  if (/burndown|burn-down|burn_down/i.test(key)) {
    const sample = burnDownFromUnknown(upsert.value);
    if (sample !== null) burnDown.push(sample);
  }
}

/** Shape-checks an attribute value into a burn-down sample. */
export function burnDownFromUnknown(value: unknown): BurnDownSample | null {
  if (value === null || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const queue = rec.queue;
  if (typeof queue !== "string" || (queue !== "tsc" && queue !== "vitest")) return null;
  if (typeof rec.iteration !== "number" || typeof rec.error_count !== "number") return null;
  return {
    queue,
    file: typeof rec.file === "string" ? rec.file : null,
    iteration: rec.iteration,
    error_count: rec.error_count,
    recorded_at: typeof rec.recorded_at === "string" ? rec.recorded_at : null,
  };
}

// ---------------------------------------------------------------------------
// Queue state shape (pp-queue/queue durable attribute)
// ---------------------------------------------------------------------------

export interface ParsedQueueState {
  pending: string[];
  current: { file: string; round: number; epoch: number } | null;
  done: Array<{ file: string; round: number; commitSha: string | null }>;
  blocked: Array<{ file: string; round: number; reason: string }>;
}

export function parseQueueState(value: unknown): ParsedQueueState | null {
  if (value === null || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const pending = Array.isArray(rec.pending) ? rec.pending.filter((f): f is string => typeof f === "string") : [];
  const currentRaw = rec.current as Record<string, unknown> | null | undefined;
  const current =
    currentRaw !== null &&
    currentRaw !== undefined &&
    typeof currentRaw === "object" &&
    typeof currentRaw.file === "string"
      ? {
          file: currentRaw.file,
          round: typeof currentRaw.round === "number" ? currentRaw.round : 0,
          epoch: typeof currentRaw.epoch === "number" ? currentRaw.epoch : 0,
        }
      : null;
  const done = Array.isArray(rec.done)
    ? rec.done
        .map((d) => {
          if (d === null || typeof d !== "object") return null;
          const r = d as Record<string, unknown>;
          if (typeof r.file !== "string") return null;
          return {
            file: r.file,
            round: typeof r.round === "number" ? r.round : 0,
            commitSha: typeof r.commitSha === "string" ? r.commitSha : null,
          };
        })
        .filter((d): d is NonNullable<typeof d> => d !== null)
    : [];
  const blocked = Array.isArray(rec.blocked)
    ? rec.blocked
        .map((b) => {
          if (b === null || typeof b !== "object") return null;
          const r = b as Record<string, unknown>;
          if (typeof r.file !== "string") return null;
          return {
            file: r.file,
            round: typeof r.round === "number" ? r.round : 0,
            reason: typeof r.reason === "string" ? r.reason : "",
          };
        })
        .filter((b): b is NonNullable<typeof b> => b !== null)
    : [];
  return { pending, current, done, blocked };
}

export interface ParsedLease {
  file: string;
  worktreePath: string;
  branch: string;
  epoch: number;
  baseSha: string;
  holderExecutionId: string;
  acquiredAtUtc: string;
}

/** Parses the pp-lease/pool record table ({[file]: LeaseRecord}). */
export function parseLeases(value: unknown): ParsedLease[] {
  if (value === null || typeof value !== "object") return [];
  const out: ParsedLease[] = [];
  for (const rec of Object.values(value as Record<string, unknown>)) {
    if (rec === null || typeof rec !== "object") continue;
    const r = rec as Record<string, unknown>;
    if (typeof r.file !== "string" || typeof r.worktreePath !== "string") continue;
    out.push({
      file: r.file,
      worktreePath: r.worktreePath,
      branch: typeof r.branch === "string" ? r.branch : "",
      epoch: typeof r.epoch === "number" ? r.epoch : 0,
      baseSha: typeof r.baseSha === "string" ? r.baseSha : "",
      holderExecutionId: typeof r.holderExecutionId === "string" ? r.holderExecutionId : "",
      acquiredAtUtc: typeof r.acquiredAtUtc === "string" ? r.acquiredAtUtc : "",
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grid derivation
// ---------------------------------------------------------------------------

interface FlowSnapshot {
  summary: DexFlowSummaryWire;
  state: DexStateWire | null;
}

function activeStepsOf(state: DexStateWire | null): DexActiveStepWire[] {
  return state?.activeStepExecutions ?? [];
}

function attributesOf(state: DexStateWire | null): Record<string, unknown> {
  const map: Record<string, unknown> = {};
  for (const attr of state?.attributes ?? []) {
    if (typeof attr?.key === "string") map[attr.key] = attr.value;
  }
  return map;
}

function activeStepInput(step: DexActiveStepWire): StepContext | null {
  return stepInputContext(step.movement?.stepInput);
}

function activeError(step: DexActiveStepWire): string | null {
  const detail = step.lastFailureInfo?.details?.originalWorkerErrorDetail;
  if (typeof detail === "string" && detail.length > 0) {
    return detail.length > 160 ? `${detail.slice(0, 160)}...` : detail;
  }
  const backend = step.lastFailureInfo?.backendError;
  return typeof backend === "string" && backend.length > 0 ? backend : null;
}

function worktreeName(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/**
 * Path identity across sources: lease records say `/tmp/x` while macOS git
 * reports the resolved `/private/tmp/x`. Compare on the stripped form.
 */
export function normPath(path: string): string {
  let p = path.replace(/\/+$/, "");
  if (p.startsWith("/private/")) p = p.slice("/private".length);
  return p;
}

/**
 * One row per lease/worktree, plus blocked queue entries and idle git
 * worktrees. Flows are processed newest-first so the latest lease claim wins.
 */
export function deriveGridRows(
  flows: readonly FlowSnapshot[],
  worktrees: readonly GitWorktreeRow[],
  feedByFlow: ReadonlyMap<string, readonly FeedEntry[]>,
): GridRow[] {
  const rows: GridRow[] = [];
  const claimedWorktreePaths = new Set<string>();
  const claimedFiles = new Set<string>();
  for (const flow of flows) {
    const attrs = attributesOf(flow.state);
    const queue = parseQueueState(attrs["pp-queue/queue"]);
    const leases = parseLeases(attrs["pp-lease/pool"]);
    const active = activeStepsOf(flow.state);
    const feedForFlow = feedByFlow.get(flow.summary.flowId) ?? [];

    const latestFeedForFile = (file: string): FeedEntry | null => {
      let latest: FeedEntry | null = null;
      for (const entry of feedForFlow) {
        if (entry.file === file && (latest === null || tsMs(entry.ts) > tsMs(latest.ts))) {
          latest = entry;
        }
      }
      return latest;
    };

    for (const lease of leases) {
      if (claimedFiles.has(lease.file)) continue;
      claimedFiles.add(lease.file);
      claimedWorktreePaths.add(normPath(lease.worktreePath));

      const activeForFile = active.find((s) => activeStepInput(s)?.file === lease.file);
      const current = queue?.current ?? null;
      const isCurrent = current !== null && current.file === lease.file;
      const doneRound = (queue?.done ?? [])
        .filter((d) => d.file === lease.file)
        .reduce((acc, d) => Math.max(acc, d.round), 0);
      const blockedRound = (queue?.blocked ?? [])
        .filter((b) => b.file === lease.file)
        .reduce((acc, b) => Math.max(acc, b.round), 0);
      const round = isCurrent && current !== null ? current.round : Math.max(doneRound, blockedRound) || null;

      const latest = latestFeedForFile(lease.file);
      const clean = findWorktree(worktrees, lease.worktreePath)?.clean ?? null;

      rows.push({
        id: `lease:${flow.summary.flowId}:${lease.file}`,
        kind: "lease",
        file: lease.file,
        round,
        worktree: lease.worktreePath,
        worktreeName: worktreeName(lease.worktreePath),
        branch: lease.branch,
        epoch: lease.epoch,
        holder: lease.holderExecutionId,
        clean,
        stage:
          activeForFile !== undefined
            ? stageLabel(activeForFile.movement?.stepType ?? activeForFile.stepType)
            : latest !== null
              ? stageLabel(latest.stepId)
              : null,
        stepExecutionId: activeForFile?.stepExecutionId ?? null,
        attempt: activeForFile?.lastFailureInfo?.attempt ?? (latest !== null ? latest.attempt : null),
        lastOutcome: latest?.outcome ?? null,
        inFlight: activeForFile !== undefined || isCurrent,
        note: activeForFile !== undefined ? activeError(activeForFile) : null,
        flowId: flow.summary.flowId,
        acquiredAt: lease.acquiredAtUtc,
      });
    }

    // Blocked queue entries without a lease row (cap-exhausted rounds etc).
    for (const blocked of queue?.blocked ?? []) {
      if (claimedFiles.has(blocked.file)) continue;
      claimedFiles.add(blocked.file);
      rows.push({
        id: `blocked:${flow.summary.flowId}:${blocked.file}`,
        kind: "blocked",
        file: blocked.file,
        round: blocked.round,
        worktree: null,
        worktreeName: null,
        branch: null,
        epoch: null,
        holder: null,
        clean: null,
        stage: null,
        stepExecutionId: null,
        attempt: null,
        lastOutcome: null,
        inFlight: false,
        note: blocked.reason,
        flowId: flow.summary.flowId,
        acquiredAt: null,
      });
    }
  }

  // Idle worktrees: registered but unleased.
  for (const wt of worktrees) {
    if (claimedWorktreePaths.has(normPath(wt.path))) continue;
    claimedWorktreePaths.add(normPath(wt.path));
    rows.push({
      id: `idle:${wt.path}`,
      kind: "idle-worktree",
      file: null,
      round: null,
      worktree: wt.path,
      worktreeName: worktreeName(wt.path),
      branch: wt.branch.replace(/^refs\/heads\//, ""),
      epoch: null,
      holder: null,
      clean: wt.clean,
      stage: null,
      stepExecutionId: null,
      attempt: null,
      lastOutcome: null,
      inFlight: false,
      note: null,
      flowId: null,
      acquiredAt: null,
    });
  }

  return rows;
}

function findWorktree(
  worktrees: readonly GitWorktreeRow[],
  path: string,
): GitWorktreeRow | undefined {
  const wanted = normPath(path);
  return worktrees.find((w) => normPath(w.path) === wanted);
}

// ---------------------------------------------------------------------------
// Burn-down series
// ---------------------------------------------------------------------------

export function burnDownSeries(samples: readonly BurnDownSample[]): BurnDownSeriesView[] {
  const byQueue = new Map<string, BurnDownSample[]>();
  for (const sample of samples) {
    const list = byQueue.get(sample.queue) ?? [];
    list.push(sample);
    byQueue.set(sample.queue, list);
  }
  const series: BurnDownSeriesView[] = [];
  for (const [queue, list] of byQueue) {
    list.sort(
      (a, b) => a.iteration - b.iteration || tsMs(a.recorded_at ?? "") - tsMs(b.recorded_at ?? ""),
    );
    series.push({
      queue,
      points: list.slice(-50).map((s) => ({
        iteration: s.iteration,
        errorCount: s.error_count,
        recordedAt: s.recorded_at,
      })),
    });
  }
  series.sort((a, b) => a.queue.localeCompare(b.queue));
  return series;
}

// ---------------------------------------------------------------------------
// Kill / resume timeline
// ---------------------------------------------------------------------------

export function killTimeline(events: readonly NormalizedKillEvent[]): KillTimelineGroupView[] {
  const byRun = new Map<string, KillTimelineEntryView[]>();
  for (const e of events) {
    if (typeof e.utc !== "string" || e.utc.length === 0) continue;
    const entry: KillTimelineEntryView = {
      kind: e.kind,
      utc: e.utc,
      monotonicMs: e.monotonicMs,
      pids: e.pids,
      signal: e.signal,
      reason: e.reason,
      note: e.note,
      resumed: e.resumed,
      source: e.source,
    };
    const list = byRun.get(e.runId) ?? [];
    list.push(entry);
    byRun.set(e.runId, list);
  }
  const groups: KillTimelineGroupView[] = [...byRun.entries()].map(([runId, entries]) => ({
    runId,
    entries: entries.sort((a, b) => tsMs(a.utc) - tsMs(b.utc)),
  }));
  groups.sort((a, b) => {
    const aMs = tsMs(a.entries[0]?.utc ?? "");
    const bMs = tsMs(b.entries[0]?.utc ?? "");
    return bMs - aMs;
  });
  return groups;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export interface DashboardInput {
  now: string;
  dex: {
    available: boolean;
    error: string | null;
    detail: string | null;
    flows: readonly DexFlowSummaryWire[];
    states: Readonly<Record<string, DexStateWire | null>>;
    histories: Readonly<Record<string, DexHistoryWire | null>>;
  };
  git: {
    available: boolean;
    error: string | null;
    repoRoot: string;
    commits: readonly GitCommitRow[];
    worktrees: readonly GitWorktreeRow[];
  };
  killEvents: {
    available: boolean;
    error: string | null;
    filesScanned: readonly string[];
    events: readonly NormalizedKillEvent[];
  };
  burnDownFiles: readonly BurnDownSample[];
  feedLimit: number;
  commitLimit: number;
}

export function statusOf(available: boolean, error: string | null, detail: string | null): SourceStatus {
  return { available, error, detail };
}

// ---------------------------------------------------------------------------
// Wave-5 cost honesty: per-role agent usage aggregate (takeaways-synthesis #2)
// ---------------------------------------------------------------------------

/** Aggregates the provider usage split per role over real-attempt feed entries. */
export function aggregateAgentUsage(feed: readonly FeedEntry[]): AgentUsageView[] {
  const aggs = new Map<
    string,
    { role: string; calls: number; splitCalls: number; input: number; cacheRead: number; output: number; reasoning: number; cost: number; costReported: boolean }
  >();
  for (const e of feed) {
    if (e.attempt === 0 || !e.tokensRequired) continue;
    let agg = aggs.get(e.role);
    if (!agg) {
      agg = { role: e.role, calls: 0, splitCalls: 0, input: 0, cacheRead: 0, output: 0, reasoning: 0, cost: 0, costReported: false };
      aggs.set(e.role, agg);
    }
    agg.calls += 1;
    if (e.usage === null) continue;
    agg.splitCalls += 1;
    agg.input += e.usage.input;
    agg.cacheRead += e.usage.cacheRead;
    agg.output += e.usage.output;
    agg.reasoning += e.usage.reasoning;
    if (e.usage.costUsd > 0) {
      agg.cost += e.usage.costUsd;
      agg.costReported = true;
    }
  }
  return [...aggs.values()]
    .map((agg) => ({
      role: agg.role,
      calls: agg.calls,
      input: agg.splitCalls > 0 ? agg.input : null,
      cacheRead: agg.splitCalls > 0 ? agg.cacheRead : null,
      output: agg.splitCalls > 0 ? agg.output : null,
      reasoning: agg.splitCalls > 0 ? agg.reasoning : null,
      costUsd: agg.costReported ? agg.cost : agg.splitCalls > 0 ? 0 : null,
      estimated: agg.splitCalls > 0 && !agg.costReported,
    }))
    .sort((a, b) => a.role.localeCompare(b.role));
}

// ---------------------------------------------------------------------------
// Wave-5 lifecycle headline (takeaways-synthesis #3): the one-line run status
// with the live running → killed → resumed → completed flip.
// ---------------------------------------------------------------------------

/**
 * Derives the headline for the newest port flow. Status comes from dex; the
 * killed/resumed overlay comes from the kill sidecar ordering (UTC only):
 * - running + a kill after the flow started + feed activity after the kill
 *   → "resumed" (dex was restarted on the same DB and the flow is alive);
 * - running + a kill after start + NO post-kill activity + dex unreachable
 *   → "killed (dex down)";
 * - completed/failed → terminal wording with the file count.
 */
export function lifecycleHeadline(input: {
  flow: FlowView | undefined;
  filesDone: number;
  filesTotal: number;
  killEvents: readonly NormalizedKillEvent[];
  dexAvailable: boolean;
  feed: readonly FeedEntry[];
}): string {
  const { flow, filesDone, filesTotal } = input;
  if (flow === undefined) return "no port flow found";
  const files = `${filesDone}/${filesTotal} files`;
  const killAfterStart = input.killEvents
    .filter((e) => tsMs(e.utc) > tsMs(flow.startTime))
    .sort((a, b) => tsMs(b.utc) - tsMs(a.utc))[0];
  const status = flow.status;
  if (status === "completed" || status === "failed") {
    const killedNote = killAfterStart !== undefined ? " (survived kill)" : "";
    return `◆ ${flow.flowId}: ${files} · ${status}${killedNote}`;
  }
  if (killAfterStart !== undefined) {
    const killMs = tsMs(killAfterStart.utc);
    const activityAfterKill = input.feed.some(
      (e) => e.flowId === flow.flowId && tsMs(e.startedAt) > killMs,
    );
    if (activityAfterKill) {
      return `◆ ${flow.flowId}: ${files} · resumed (killed ${killAfterStart.utc.slice(11, 19)}Z)`;
    }
    if (!input.dexAvailable) {
      return `◆ ${flow.flowId}: ${files} · killed (dex down since ${killAfterStart.utc.slice(11, 19)}Z)`;
    }
    return `◆ ${flow.flowId}: ${files} · running (kill at ${killAfterStart.utc.slice(11, 19)}Z, awaiting resume)`;
  }
  return `◆ ${flow.flowId}: ${files} · running`;
}

/** Sorts flows newest-first (startTime desc, flowId as tiebreak). */
export function sortFlowsNewestFirst(
  flows: readonly DexFlowSummaryWire[],
): DexFlowSummaryWire[] {
  return [...flows].sort(
    (a, b) => tsMs(b.startTime ?? "") - tsMs(a.startTime ?? "") || a.flowId.localeCompare(b.flowId),
  );
}

export function buildDashboardState(input: DashboardInput): DashboardStateView {
  const flowsSorted = sortFlowsNewestFirst(input.dex.flows);

  const flowViews: FlowView[] = flowsSorted.map((f) => ({
    flowId: f.flowId,
    flowType: f.flowType,
    status: f.flowStatus.replace(/^FLOW_STATUS_/, "").toLowerCase(),
    startTime: f.startTime ?? "",
    closeTime: f.closeTime ?? null,
    runId: f.runId,
  }));

  // Feed: history walk (with context threading), state fallback per flow.
  const feedByFlow = new Map<string, FeedEntry[]>();
  const samples: BurnDownSample[] = [...input.burnDownFiles];
  const feed: FeedEntry[] = [];
  for (const flow of flowsSorted) {
    const flowId = flow.flowId;
    const history = input.dex.histories[flowId];
    const state = input.dex.states[flowId] ?? null;
    let flowFeed: FeedEntry[] = [];
    if (history !== undefined && history !== null) {
      const walked = walkHistory(flowId, history);
      flowFeed = walked.feed;
      samples.push(...walked.burnDown);
    } else if (state !== null) {
      const fallback = feedFromState(flowId, state);
      flowFeed = fallback.feed;
      samples.push(...fallback.burnDown);
    }
    // State attributes can hold envelope keys the history page has not shown
    // yet (fresh upserts) — merge without duplicating stepId#attempt keys.
    if (state !== null) {
      const seen = new Set(flowFeed.map((e) => `${e.stepId}#${e.attempt}#${e.startedAt}`));
      for (const entry of feedFromState(flowId, state).feed) {
        const key = `${entry.stepId}#${entry.attempt}#${entry.startedAt}`;
        if (!seen.has(key)) flowFeed.push(entry);
      }
    }
    feedByFlow.set(flowId, flowFeed);
    feed.push(...flowFeed);
  }
  feed.sort((a, b) => tsMs(b.ts) - tsMs(a.ts));
  const feedCapped = feed.slice(0, Math.max(0, input.feedLimit));

  const queueSummaries: QueueSummaryView[] = [];
  for (const flow of flowsSorted) {
    const attrs = attributesOf(input.dex.states[flow.flowId] ?? null);
    const queue = parseQueueState(attrs["pp-queue/queue"]);
    if (queue !== null) {
      queueSummaries.push({ ...queue, flowId: flow.flowId });
    }
  }

  const grid = deriveGridRows(
    flowsSorted.map((summary) => ({
      summary,
      state: input.dex.states[summary.flowId] ?? null,
    })),
    input.git.worktrees,
    feedByFlow,
  );

  const commits: CommitView[] = input.git.commits.slice(0, Math.max(0, input.commitLimit)).map((c) => ({
    sha: c.sha,
    shortSha: c.shortSha,
    author: c.author,
    date: c.date,
    subject: c.subject,
    refs: c.refs,
    opId: c.opId,
    contentHash: c.contentHash,
  }));

  // Wave-5 lifecycle headline: newest TOP-LEVEL flow (SubFlow children of the
  // parallel wave join surface as their own flows; the run headline belongs
  // to the parent port.Project flow) + its queue progress + kill overlay.
  const headlineFlow = flowViews.find((f) => !f.flowId.startsWith("SubFlow:"));
  const headlineQueue = headlineQueueFor(headlineFlow, queueSummaries);
  const headline = lifecycleHeadline({
    flow: headlineFlow,
    filesDone: headlineQueue.done + headlineQueue.blocked,
    filesTotal: headlineQueue.total,
    killEvents: input.killEvents.events,
    dexAvailable: input.dex.available,
    feed,
  });

  return {
    generatedAt: input.now,
    headline,
    sources: {
      dex: statusOf(input.dex.available, input.dex.error, input.dex.detail),
      git: { ...statusOf(input.git.available, input.git.error, null), repoRoot: input.git.repoRoot },
      killEvents: {
        ...statusOf(input.killEvents.available, input.killEvents.error, null),
        filesScanned: [...input.killEvents.filesScanned],
      },
    },
    flows: flowViews,
    grid,
    queueSummaries,
    feed: feedCapped,
    burnDown: burnDownSeries(samples),
    commits,
    worktrees: input.git.worktrees.map((w) => ({
      path: w.path,
      branch: w.branch.replace(/^refs\/heads\//, ""),
      head: w.head,
      clean: w.clean,
    })),
    killTimeline: killTimeline(input.killEvents.events),
    agentUsage: aggregateAgentUsage(feed),
  };
}

/** Queue progress for the headline flow: done+blocked vs total entries. */
function headlineQueueFor(
  flow: FlowView | undefined,
  summaries: readonly QueueSummaryView[],
): { done: number; blocked: number; total: number } {
  if (flow === undefined) return { done: 0, blocked: 0, total: 0 };
  const q = summaries.find((s) => s.flowId === flow.flowId);
  if (q === undefined) return { done: 0, blocked: 0, total: 0 };
  return {
    done: q.done.length,
    blocked: q.blocked.length,
    total: q.done.length + q.blocked.length + q.pending.length + (q.current !== null ? 1 : 0),
  };
}
