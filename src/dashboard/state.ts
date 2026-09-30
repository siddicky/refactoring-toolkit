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
  BurnDownPointView,
  BurnDownSample,
  BurnDownSeriesView,
  CommitView,
  DashboardStateView,
  DegradedRoundView,
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
  HeadlineState,
  KillTimelineEntryView,
  KillTimelineGroupView,
  NormalizedKillEvent,
  QueueSummaryView,
  SourceStatus,
  AgentUsageView,
  TscAccountingSample,
  UsageSplitView,
  VitestAccountingSample,
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
    // Attempt 0 is the durable start marker (envelopeStartMarker): tokens are
    // null by construction, so it must never read as a provenance failure.
    tokensRequired: MODEL_ROLES.has(role) && attempt > 0,
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
    // The step's OWN input (when the wire carries it) is the context in force
    // while it ran (LeaseStep onward, every chained step input is a
    // FileRoundInput).
    for (const own of [
      payload.initialStart?.stepInput,
      payload.input?.stepInput,
      payload.movement?.stepInput,
    ]) {
      const found = stepInputContext(own);
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

    // Stamp the envelopes with the context the step ran under BEFORE the
    // decision's nextSteps advance it: a completing step's envelope must not
    // take the following step's file/round (queue-verify -> queue-fix, or a
    // release that hands the next file's lease to its successor).
    for (const upsert of payload.output?.upsertAttributes ?? []) {
      collectUpsert(flowId, upsert, ctx, feed, burnDown);
    }

    for (const next of payload.output?.stepDecision?.nextSteps ?? []) {
      const found = stepInputContext(next.stepInput);
      if (found !== null) ctx = found;
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

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Vitest ran/not-run accounting (US-010). Absent/null = legacy row. A present
 * but malformed object is NOT silently read as a clean run: it degrades to
 * not-run with an explicit reason.
 */
function parseVitestAccounting(raw: unknown): VitestAccountingSample | undefined {
  if (raw === undefined || raw === null) return undefined;
  const rec = typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (rec.state !== "ran" && rec.state !== "not-run") {
    return { state: "not-run", reason: "malformed vitest accounting", passed: null, failed: null, total: null };
  }
  return {
    state: rec.state,
    reason: typeof rec.reason === "string" ? rec.reason : null,
    passed: finiteOrNull(rec.passed),
    failed: finiteOrNull(rec.failed),
    total: finiteOrNull(rec.total),
  };
}

/**
 * tsc ran/not-run accounting (Contract A). Same honesty rule as vitest: a
 * present but malformed object degrades to not-run, never to a clean run.
 */
function parseTscAccounting(raw: unknown): TscAccountingSample | undefined {
  if (raw === undefined || raw === null) return undefined;
  const rec = typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (rec.state !== "ran" && rec.state !== "not-run") {
    return { state: "not-run", reason: "malformed tsc accounting", exit_code: null, unlocated: 0 };
  }
  return {
    state: rec.state,
    reason: typeof rec.reason === "string" ? rec.reason : null,
    exit_code: finiteOrNull(rec.exit_code),
    unlocated: finiteOrNull(rec.unlocated) ?? 0,
  };
}

/**
 * Shape-checks an attribute value into a burn-down sample. The single parser
 * for both the history attributes and the burn-down file sources
 * (queries.ts normalizeBurnDown delegates here), so accounting fields are
 * carried in exactly one place.
 */
export function burnDownFromUnknown(value: unknown): BurnDownSample | null {
  if (value === null || typeof value !== "object") return null;
  const rec = value as Record<string, unknown>;
  const queue = rec.queue;
  if (typeof queue !== "string" || (queue !== "tsc" && queue !== "vitest")) return null;
  if (typeof rec.iteration !== "number" || typeof rec.error_count !== "number") return null;
  const sample: BurnDownSample = {
    queue,
    file: typeof rec.file === "string" ? rec.file : null,
    iteration: rec.iteration,
    error_count: rec.error_count,
    recorded_at: typeof rec.recorded_at === "string" ? rec.recorded_at : null,
  };
  if (queue === "vitest") {
    const vitest = parseVitestAccounting(rec.vitest);
    if (vitest !== undefined) sample.vitest = vitest;
  } else {
    const tsc = parseTscAccounting(rec.tsc);
    if (tsc !== undefined) sample.tsc = tsc;
  }
  return sample;
}

/**
 * US-007 (Stage 2d): converts telemetry-STREAM messages into feed entries —
 * the same mapping collectUpsert applies to durable envelope attributes, so
 * a stream-delivered event and its polled counterpart are indistinguishable
 * in /api/state (dedup happens on merge in buildDashboardState). Projection
 * only: the stream is never a correctness source; this is a rendering feed.
 */
export function feedFromStreamMessages(
  messages: readonly { flowId: string; event: unknown }[],
): FeedEntry[] {
  const entries: FeedEntry[] = [];
  for (const message of messages) {
    const parsed = parseEnvelope(message.event);
    if (parsed === null) continue;
    entries.push({
      flowId: message.flowId,
      ts: envelopeTs(parsed),
      startedAt: parsed.started_at,
      endedAt: parsed.ended_at,
      stepId: parsed.stepId,
      role: parsed.role,
      file: parsed.file,
      round: parsed.round,
      attempt: parsed.attempt,
      outcome: parsed.outcome,
      tokens: parsed.tokens,
      usage: parsed.usage,
      wallClockMs: parsed.wall_clock_ms,
      tokensRequired: parsed.tokensRequired,
    });
  }
  return entries;
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

/**
 * One chart point. A not-run iteration (US-010 vitest accounting) keeps its
 * state and reason and carries NO count: the row's error_count is vacuous
 * (the flow writes 0 alongside the marker) and must never be plotted.
 */
function burnDownPoint(s: BurnDownSample): BurnDownPointView {
  // vitest accounting rides vitest rows, tsc accounting (Contract A) rides the
  // tsc total row; either state "not-run" voids the count.
  const accounting = s.vitest ?? s.tsc;
  const notRun = accounting?.state === "not-run";
  return {
    iteration: s.iteration,
    errorCount: notRun ? null : s.error_count,
    recordedAt: s.recorded_at,
    state: notRun ? "not-run" : "ran",
    reason: notRun ? (accounting.reason ?? "no reason recorded") : null,
  };
}

/** The most recently recorded sample (later input wins a timestamp tie). */
function latestSample(rows: readonly BurnDownSample[]): BurnDownSample {
  let best = rows[0] as BurnDownSample;
  for (const row of rows) {
    if (tsMs(row.recorded_at ?? "") >= tsMs(best.recorded_at ?? "")) best = row;
  }
  return best;
}

/**
 * The single point for one (queue, iteration). The flow writes a per-
 * iteration TOTAL row (file: null) plus up to 8 per-file rows; plotting them
 * all gives several y values per x (a zig-zag) and a "latest N errors" label
 * that can be one file's count. The total is authoritative (the per-file rows
 * are a truncated breakdown); only when no total exists are the per-file
 * rows summed (latest row per file).
 */
function iterationPoint(rows: readonly BurnDownSample[]): BurnDownPointView {
  const totals = rows.filter((r) => r.file === null);
  if (totals.length > 0) return burnDownPoint(latestSample(totals));
  const byFile = new Map<string, BurnDownSample[]>();
  for (const r of rows) {
    const list = byFile.get(r.file ?? "") ?? [];
    list.push(r);
    byFile.set(r.file ?? "", list);
  }
  const perFile = [...byFile.values()].map(latestSample);
  const newest = latestSample(perFile);
  return {
    iteration: newest.iteration,
    errorCount: perFile.reduce((sum, r) => sum + r.error_count, 0),
    recordedAt: newest.recorded_at,
    state: "ran",
    reason: null,
  };
}

export function burnDownSeries(samples: readonly BurnDownSample[]): BurnDownSeriesView[] {
  const byQueue = new Map<string, Map<number, BurnDownSample[]>>();
  for (const sample of samples) {
    const iterations = byQueue.get(sample.queue) ?? new Map<number, BurnDownSample[]>();
    const rows = iterations.get(sample.iteration) ?? [];
    rows.push(sample);
    iterations.set(sample.iteration, rows);
    byQueue.set(sample.queue, iterations);
  }
  const series: BurnDownSeriesView[] = [];
  for (const [queue, iterations] of byQueue) {
    const points = [...iterations.values()].map(iterationPoint).sort((a, b) => a.iteration - b.iteration);
    series.push({ queue, points: points.slice(-50) });
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
// US-006 degraded rounds (tombstoned reviewer verdicts)
// ---------------------------------------------------------------------------

export interface ParsedTombstone {
  file: string;
  round: number;
  reviewer: string;
  reason: string;
}

/** Parses a verdict attribute key suffix `<sanitized-file>#<round>#<reviewer>`. */
function parseVerdictKeySuffix(suffix: string): { file: string; round: number; reviewer: string } | null {
  const reviewerSep = suffix.lastIndexOf("#");
  const roundSep = reviewerSep > 0 ? suffix.lastIndexOf("#", reviewerSep - 1) : -1;
  if (reviewerSep <= 0 || roundSep <= 0) return null;
  const roundPart = suffix.slice(roundSep + 1, reviewerSep);
  const round = Number(roundPart);
  if (!Number.isInteger(round) || roundPart === "") return null;
  return {
    file: suffix.slice(0, roundSep).replace(/__/g, "/"),
    round,
    reviewer: suffix.slice(reviewerSep + 1),
  };
}

/**
 * US-006 degraded rounds per flow: groups of >= 2 tombstones
 * (`{reviewer, discarded: true, ...}` under pp-verdict / pp-prep-verdict)
 * for a file+round with NO completed verdict record. A tombstoned reviewer
 * is NOT a VerdictRecord, so such rounds surface `unreviewed` everywhere;
 * this derives the explicit DEGRADED marker for /api/state + the headline.
 */
export function degradedRoundsOf(flowId: string, state: DexStateWire | null): DegradedRoundView[] {
  const tombstones = new Map<string, ParsedTombstone[]>();
  const completed = new Set<string>();
  for (const attr of state?.attributes ?? []) {
    const key = typeof attr?.key === "string" ? attr.key : "";
    if (!key.startsWith("pp-verdict/") && !key.startsWith("pp-prep-verdict/")) continue;
    const parsedKey = parseVerdictKeySuffix(key.slice(key.indexOf("/") + 1));
    if (parsedKey === null) continue;
    const groupKey = `${parsedKey.file}\u0000${parsedKey.round}`;
    const value = attr?.value as Record<string, unknown> | null | undefined;
    if (value !== null && typeof value === "object" && value.discarded === true) {
      const reviewer = typeof value.reviewer === "string" ? value.reviewer : parsedKey.reviewer;
      const reason = typeof value.reason === "string" ? value.reason : "";
      const list = tombstones.get(groupKey) ?? [];
      list.push({ file: parsedKey.file, round: parsedKey.round, reviewer, reason });
      tombstones.set(groupKey, list);
    } else if (
      value !== null &&
      typeof value === "object" &&
      typeof (value as { metrics?: { file?: unknown } }).metrics?.file === "string"
    ) {
      completed.add(groupKey);
    }
  }
  const out: DegradedRoundView[] = [];
  for (const [groupKey, list] of tombstones) {
    if (list.length < 2 || completed.has(groupKey)) continue;
    out.push({
      flowId,
      file: list[0]?.file ?? "<unknown>",
      round: list[0]?.round ?? 0,
      reviewers: list.map((t) => t.reviewer),
      reasons: list.map((t) => t.reason),
    });
  }
  return out.sort((a, b) => (a.file !== b.file ? a.file.localeCompare(b.file) : a.round - b.round));
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
  /**
   * US-007 (Stage 2d): events delivered by the ReadStream subscriber
   * (port/<flowId>/events), merged into the feed with the same dedup as the
   * state fallback. Absent/empty = subscriber not running (poll fallback).
   * Projection-only: this field feeds RENDERING; nothing else consumes it.
   */
  streamFeed?: readonly { flowId: string; event: unknown }[];
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
 * - any non-running status (completed/failed/terminated/canceled/...) →
 *   terminal wording with the file count.
 *
 * US-006: `degradedRounds` > 0 appends an explicit `DEGRADED` marker so no
 * surface can read a zero-reviewer round as clean.
 */
export function lifecycleHeadline(input: LifecycleHeadlineInput): string {
  return lifecycleHeadlineView(input).text;
}

export interface LifecycleHeadlineInput {
  flow: FlowView | undefined;
  filesDone: number;
  filesTotal: number;
  killEvents: readonly NormalizedKillEvent[];
  dexAvailable: boolean;
  feed: readonly FeedEntry[];
  /** US-006: count of the headline run's degraded (all-reviewers-discarded) rounds. */
  degradedRounds?: number;
}

export interface HeadlineView {
  text: string;
  /** Structured lifecycle state: the client styles from this, not from `text`. */
  state: HeadlineState;
  /** US-006: the run has degraded rounds (never renders as a clean state). */
  degraded: boolean;
}

function terminalHeadlineState(status: string): HeadlineState {
  switch (status) {
    case "completed":
    case "failed":
    case "terminated":
    case "canceled":
      return status;
    default:
      return "other-terminal";
  }
}

/** Headline text plus the structured state/degraded flag behind it (C54). */
export function lifecycleHeadlineView(input: LifecycleHeadlineInput): HeadlineView {
  const { flow, filesDone, filesTotal } = input;
  if (flow === undefined) return { text: "no port flow found", state: "none", degraded: false };
  const files = `${filesDone}/${filesTotal} files`;
  const isDegraded = input.degradedRounds !== undefined && input.degradedRounds > 0;
  const degraded = isDegraded
    ? ` · DEGRADED (${input.degradedRounds} unreviewed round${input.degradedRounds === 1 ? "" : "s"})`
    : "";
  const view = (text: string, state: HeadlineState): HeadlineView => ({ text, state, degraded: isDegraded });
  const killAfterStart = input.killEvents
    .filter((e) => tsMs(e.utc) > tsMs(flow.startTime))
    .sort((a, b) => tsMs(b.utc) - tsMs(a.utc))[0];
  const status = flow.status;
  // Every non-running status is terminal (completed/failed/terminated/
  // canceled/continued-as-new/timed-out...): print the status word instead of
  // letting a stopped flow read as `running` (C55).
  if (status !== "running") {
    const killedNote =
      killAfterStart !== undefined && (status === "completed" || status === "failed") ? " (survived kill)" : "";
    return view(
      `◆ ${flow.flowId}: ${files} · ${terminalStatusWord(status)}${killedNote}${degraded}`,
      terminalHeadlineState(status),
    );
  }
  if (killAfterStart !== undefined) {
    const killMs = tsMs(killAfterStart.utc);
    const activityAfterKill = input.feed.some(
      (e) => e.flowId === flow.flowId && tsMs(e.startedAt) > killMs,
    );
    const at = killAfterStart.utc.slice(11, 19);
    if (activityAfterKill) {
      return view(`◆ ${flow.flowId}: ${files} · resumed (killed ${at}Z)${degraded}`, "resumed");
    }
    if (!input.dexAvailable) {
      return view(`◆ ${flow.flowId}: ${files} · killed (dex down since ${at}Z)${degraded}`, "killed");
    }
    return view(
      `◆ ${flow.flowId}: ${files} · running (kill at ${at}Z, awaiting resume)${degraded}`,
      "awaiting-resume",
    );
  }
  return view(`◆ ${flow.flowId}: ${files} · running${degraded}`, "running");
}

/** Display word for a non-running dex flow status (lower-cased, prefix stripped). */
export function terminalStatusWord(status: string): string {
  if (status === "continued_as_new") return "continued-as-new";
  if (status === "server_side_timeout_internal_only") return "timed-out";
  return status.replace(/_/g, "-");
}

/** Parallel-wave SubFlow children (port.File) surface as their own flows. */
export function isSubFlowChild(flowId: string): boolean {
  return flowId.startsWith("SubFlow:");
}

/**
 * True when `flowId` is the run flow itself or one of its SubFlow children
 * (dex names them `SubFlow:<parentFlowId>-<stepExecutionId>-<index>`).
 */
export function belongsToRun(flowId: string, runFlowId: string): boolean {
  return flowId === runFlowId || flowId.startsWith(`SubFlow:${runFlowId}-`);
}

/**
 * The run headline belongs to the newest top-level `port.Project` flow
 * (SubFlow children and probe.* flows never hijack it); any other top-level
 * flow is only a fallback when no port.Project exists. `flows` is newest-first.
 */
export function pickHeadlineFlow(flows: readonly FlowView[]): FlowView | undefined {
  const topLevel = flows.filter((f) => !isSubFlowChild(f.flowId));
  return topLevel.find((f) => f.flowType === "port.Project") ?? topLevel[0];
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
  // US-007: merge stream-delivered events (subscriber receipt) into the feed.
  // Stream messages are UPSERTS: an envelope's start and completion events
  // share one key (flowId#stepId#attempt#startedAt), so the merge keeps the
  // most complete row instead of the first one seen (C52). An event that BOTH
  // the stream and a poll delivered still appears once; events for flows
  // outside the selection still render (their flowId rides the entry).
  if (input.streamFeed !== undefined && input.streamFeed.length > 0) {
    const keyOf = (e: FeedEntry) => `${e.flowId}#${e.stepId}#${e.attempt}#${e.startedAt}`;
    const existingByKey = new Map<string, FeedEntry>();
    for (const e of feed) if (!existingByKey.has(keyOf(e))) existingByKey.set(keyOf(e), e);
    const streamOwned = new Set<FeedEntry>();
    for (const entry of feedFromStreamMessages(input.streamFeed)) {
      const key = keyOf(entry);
      const existing = existingByKey.get(key);
      if (existing === undefined) {
        feed.push(entry);
        existingByKey.set(key, entry);
        streamOwned.add(entry);
        feedByFlow.get(entry.flowId)?.push(entry);
        continue;
      }
      // Completion beats in-flight. Between two stream messages the later one
      // wins (upsert); a stream message never displaces a durable polled row
      // of equal completeness (the poll is the source of truth).
      const nextDone = entry.endedAt !== null;
      const existingDone = existing.endedAt !== null;
      const replace = streamOwned.has(existing) ? nextDone || !existingDone : nextDone && !existingDone;
      if (!replace) continue;
      const merged: FeedEntry = {
        ...entry,
        file: entry.file ?? existing.file,
        round: entry.round ?? existing.round,
      };
      feed[feed.indexOf(existing)] = merged;
      const flowList = feedByFlow.get(entry.flowId);
      const at = flowList?.indexOf(existing) ?? -1;
      if (flowList !== undefined && at >= 0) flowList[at] = merged;
      existingByKey.set(key, merged);
      streamOwned.add(merged);
    }
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

  // Wave-5 lifecycle headline: newest TOP-LEVEL port.Project flow (SubFlow
  // children of the parallel wave join surface as their own flows; the run
  // headline belongs to the parent) + its queue progress + kill overlay.
  const headlineFlow = pickHeadlineFlow(flowViews);
  const headlineQueue = headlineQueueFor(headlineFlow, queueSummaries);
  // US-006 degraded rounds: derived per flow from the verdict attributes. The
  // verdict attributes live in whichever flow ran the review steps, which in
  // the default parallel mode is a SubFlow child, so the headline run's count
  // covers the run flow AND its children.
  const degradedRounds = flowsSorted.flatMap((f) =>
    degradedRoundsOf(f.flowId, input.dex.states[f.flowId] ?? null),
  );
  const headlineView = lifecycleHeadlineView({
    flow: headlineFlow,
    filesDone: headlineQueue.done + headlineQueue.blocked,
    filesTotal: headlineQueue.total,
    killEvents: input.killEvents.events,
    dexAvailable: input.dex.available,
    feed,
    degradedRounds:
      headlineFlow === undefined
        ? 0
        : degradedRounds.filter((r) => belongsToRun(r.flowId, headlineFlow.flowId)).length,
  });

  return {
    generatedAt: input.now,
    headline: headlineView.text,
    headlineState: headlineView.state,
    headlineDegraded: headlineView.degraded,
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
    degradedRounds,
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
