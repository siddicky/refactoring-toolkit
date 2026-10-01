/**
 * Pure metrics renderer (plan AC2): renders metrics/report.md + report.json
 * from the evidence stream — envelope events, completed verdict records, queue
 * burn-down samples — merged with the chaos kill-events sidecar and, when the
 * dex history is supplied, the Phase 5 typed dispatch anchoring.
 *
 * Pure function over its input: no clock, no randomness, no I/O. The same
 * input always produces byte-identical markdown and JSON. `generatedAt` is an
 * input, not `Date.now()`.
 *
 * Envelope contract notes (src/metrics/types.ts):
 * - attempt-0 start markers (M4) are excluded from token totals, per-role
 *   aggregation, and interrupted counts — they are surfaced via
 *   `start_marker_count` and the dispatch anchor instead;
 * - per-file envelopes carry their target in `identity` (sanitized
 *   `file#round`, M2); the file is recovered for grouping;
 * - an interrupted model-calling envelope with null tokens is NOT a provenance
 *   failure (the attempt was killed mid-turn — the M4 marker plus its dispatch
 *   entries are the evidence); a completed/redone/skipped model envelope
 *   without tokens IS a failure, never zero.
 */
import { agreementForGroup, type AgreementRecord } from "./agreement.js";
import {
  anchorForRun,
  type DispatchAnchorResult,
  type DispatchHistory,
  type ProvenanceCrossCheck,
} from "./dispatch-anchor.js";
import {
  fileFromIdentity,
  isFiredKill,
  isModelCallingRole,
  isStartMarker,
  PREP_SPEC_FILE,
  sanitizeFileKey,
  type CitationCheckResult,
  type CitationGateView,
  type EnvelopeEvent,
  type EnvelopeRole,
  type Finding,
  type JevUsageEntry,
  type KillEventDiagnostics,
  type KillEventsFile,
  type QueueBurnDownEvent,
  type QueueKind,
  type ReportKillEvent,
  type TscRunAccounting,
  type VerdictRecord,
  type VerdictTombstone,
  type VitestRunAccounting,
  tokenTotalOf,
} from "./types.js";

/**
 * The fixer step id for AC2 retry counts: a hand-kept mirror of the flow's
 * fixer step (the metrics layer never imports flows), pinned against the real
 * step by tests/mirror-drift.test.ts.
 */
export const FIXER_STEP_ID = "pp-fixer";

/** The single provenance failure an empty evidence stream produces. */
const NO_EVIDENCE_FAILURE =
  "NO EVIDENCE: the envelope stream is empty, so nothing was verified (wrong flow id, attributes not read, or a flow with no steps yet)";

/** Legacy driver pseudo-file marking an aggregate burn-down row (now `file: null`). */
const TOTAL_PSEUDO_FILE = "(total)";

export interface MetricsRenderInput {
  envelopes: readonly EnvelopeEvent[];
  verdicts: readonly VerdictRecord[];
  /**
   * US-006 tombstones (discarded reviewer verdicts) with their file+round
   * target, recovered by the driver from the verdict attribute keys. A round
   * with ZERO completed records and >= 2 tombstones is DEGRADED.
   */
  tombstones?: ReadonlyArray<VerdictTombstone & { file: string; round: number }>;
  /**
   * The citation gate's own scores per reviewer and round (`pp-kept`), so the
   * report can show the p_cited the gate APPLIED next to the deterministic
   * review-time check on the verdict record (C14).
   */
  citationGates?: readonly CitationGateView[];
  burnDown: readonly QueueBurnDownEvent[];
  /**
   * Live TypeSafe Jev usage from the flows' `pp-jev-usage` attribute (parent +
   * children). Reported separately: these steps keep non-model roles, so their
   * spend never reaches the model-calling token/cost totals.
   */
  jevUsage?: readonly JevUsageEntry[];
  /** Merged kill-events.json sidecar; null/undefined when the run had no kill. */
  killEvents?: KillEventsFile | null;
  /** Sidecar read diagnostics (malformed lines, other-run exclusions) from kill-events.ts. */
  killEventDiagnostics?: KillEventDiagnostics | null;
  /**
   * dexcli history JSON (`flow history -output json`). When present the Phase 5
   * typed dispatch anchoring runs as part of the AC2 cross-check and its
   * failures join the provenance failures.
   */
  history?: DispatchHistory | null;
  /**
   * Render PRE-identityOf evidence (cx-5e style flow-keyed envelopes for
   * per-file steps) with the lossy legacy anchoring. Default false.
   */
  legacyFlowKeyedEnvelopes?: boolean;
  /** Optional UTC ISO-8601 stamp for the report header (supplied by the caller). */
  generatedAt?: string;
}

export interface ReportJson {
  generated_at: string | null;
  /** false when any provenance failure exists, including NO EVIDENCE (empty stream). */
  provenance_ok: boolean;
  provenance_failures: string[];
  /** True when the envelope stream was empty: the report verifies nothing. */
  no_evidence: boolean;
  summary: {
    files: string[];
    envelope_count: number;
    /** M4 attempt-0 start markers (excluded from token/role aggregates). */
    start_marker_count: number;
    /** Interrupted envelopes over REAL attempts (attempt >= 1) only. */
    interrupted_envelope_count: number;
    verdict_record_count: number;
    /** Rounds with zero completed records and every reviewer tombstoned (US-006). */
    degraded_round_count: number;
    /** Total discarded-reviewer tombstones in the stream. */
    tombstoned_reviewer_count: number;
    /** Tombstones whose reason is attempt exhaustion (final-attempt tokens only). */
    exhausted_attempt_tombstones: number;
    /** Total over model-calling roles, real attempts only; null when none. */
    tokens_model_roles: number | null;
    /**
     * SUM of every real step's own duration. Parallel waves overlap, so this
     * can exceed the elapsed time — it is step time, not wall clock.
     */
    step_time_ms_total: number;
    /** Elapsed time: first envelope start to last envelope end; null when unknown. */
    wall_clock_span_ms: number | null;
    /**
     * US-010: what the run was actually verified BY. `tsc_verified` is the
     * last burn-down iteration's typecheck result (null = no tsc samples);
     * `vitest` is the last vitest accounting (null = no vitest samples — the
     * run's evidence is typecheck-only at best).
     */
    verification: {
      /** null = no tsc samples OR the final tsc run did not run (see `tsc`). */
      tsc_final_error_count: number | null;
      /** null = unknown: no tsc samples, or tsc NOT RUN (never a pass). */
      tsc_verified: boolean | null;
      /** Contract A accounting of the final tsc iteration; absent on legacy rows / no samples. */
      tsc?: TscRunAccounting;
      vitest: VitestRunAccounting | null;
    };
  };
  file_rounds: Array<{
    file: string;
    round: number;
    records: Array<{ reviewer: string; diff_id: string; findings: Finding[] }>;
    agreement: AgreementRecord;
    /** True when the round reached verdict-check with every reviewer discarded. */
    degraded: boolean;
    tombstones: Array<{ reviewer: string; reason: string; attempt: number }>;
    /**
     * The deterministic citation check stamped on the verdict records at review
     * time. NOT what the gate decided on when live Jev is configured: see
     * `citation_gate`.
     */
    citation_checks: CitationCheckResult[];
    /** The gate's own p_cited and decision per reviewer; empty when no gate record exists (older evidence). */
    citation_gate: Array<Omit<CitationGateView, "file" | "round">>;
  }>;
  tokens_by_file_role: Array<{
    file: string;
    role: EnvelopeRole;
    steps: number;
    /** null = not applicable (non-model role) or a provenance failure (model role). */
    tokens: number | null;
    wall_clock_ms: number | null;
  }>;
  /**
   * Wave-5 cost honesty (takeaways-synthesis #2): per-role usage split over
   * envelopes that carry the full TokenUsage object. Roles whose envelopes
   * only carry bare totals appear with calls counted but split fields null.
   * `cost_estimated` is true when at least one model call reported tokens
   * without a provider-reported cost (plan-authed lane, or a bare token total
   * with no split) — the USD total is then a lower bound and renderers prefix
   * it with `~`. `costed_calls` / `uncosted_calls` make the basis explicit.
   */
  usage_by_role: Array<{
    role: EnvelopeRole;
    calls: number;
    input_tokens: number | null;
    cache_read_tokens: number | null;
    cache_write_tokens: number | null;
    reasoning_tokens: number | null;
    output_tokens: number | null;
    cost_usd: number | null;
    /** Calls with a provider-reported cost (cost_usd > 0). */
    costed_calls: number;
    /** Calls with tokens but no provider-reported cost (cost_usd absent/0, or a bare total). */
    uncosted_calls: number;
  }>;
  cost_total_usd: number | null;
  cost_estimated: boolean;
  costed_calls: number;
  uncosted_calls: number;
  /**
   * Live Jev (judgment-model) spend from `pp-jev-usage`, kept OUT of
   * `tokens_model_roles` and `cost_total_usd` (verdict-check / prioritize /
   * vitest-triage are non-model roles). Tokens only: the usage record carries
   * no cost, so none is claimed. null = none recorded (naive path / no spend).
   * Counts only step attempts whose write committed (0(g)): a retried attempt's
   * spend is not durable and is not included.
   */
  jev_usage: {
    calls: number;
    total_tokens: number;
    cost_usd: null;
    by_step: Array<{ step: string; calls: number; tokens: number }>;
  } | null;
  /**
   * Fixer retries per file: for each fixer target (file#round) the highest
   * durable attempt minus one, summed per file. Only the successful attempt's
   * envelope is durable (0(g)), so max(attempt) is the attempt count.
   */
  fixer_retries: Array<{ file: string; retries: number }>;
  queue_burn_down: Array<{
    queue: QueueKind;
    iterations: Array<{
      iteration: number;
      error_count: number;
      /**
       * US-010 vitest accounting for this iteration (vitest rows only): the
       * count is vacuous when state is "not-run" — renderers must show the
       * state + reason, never a bare 0.
       */
      vitest?: VitestRunAccounting;
      /** Contract A tsc accounting for this iteration; not-run => count is vacuous. */
      tsc?: TscRunAccounting;
      /** Breakdown rows only; `error_count` above is the authoritative total. */
      per_file: Array<{ file: string; error_count: number }>;
    }>;
  }>;
  kill_events: KillEventsFile | null;
  /** Malformed sidecar lines / events excluded as another run's; null = clean or no sidecar. */
  kill_event_diagnostics: KillEventDiagnostics | null;
  /** Present only when `history` was supplied to the renderer. */
  dispatch_anchor: DispatchAnchorResult | null;
}

export interface RenderedReport {
  markdown: string;
  json: ReportJson;
}

/**
 * Provenance validation over envelope events (plan: "a missing required token
 * value = provenance failure, never zero"). Returns human-readable failure
 * strings; empty array = the stream is contract-clean.
 *
 * Attempt-0 start markers (M4) are exempt from token/role requirements (they
 * are record-semantics under the target role and carry null tokens by design)
 * but must NOT carry tokens themselves.
 */
export function validateProvenance(envelopes: readonly EnvelopeEvent[]): string[] {
  const failures: string[] = [];
  for (const env of envelopes) {
    const tokens = tokenTotalOf(env.tokens);
    if (env.attempt < 0) {
      failures.push(`envelope ${env.stepId} has attempt ${env.attempt} < 0`);
      continue;
    }
    if (isStartMarker(env)) {
      if (tokens !== null) {
        failures.push(`envelope ${env.stepId} is an attempt-0 start marker but carries token usage`);
      }
      continue;
    }
    if (isModelCallingRole(env.role)) {
      if (tokens === null && env.outcome !== "interrupted") {
        failures.push(
          `envelope ${env.stepId} (${env.role}) is model-calling but carries no token usage`,
        );
      }
    } else if (tokens !== null) {
      failures.push(`envelope ${env.stepId} (${env.role}) is non-model but carries token usage`);
    }
    if (env.outcome === "interrupted" && env.ended_at === null) {
      failures.push(`envelope ${env.stepId} is interrupted but has no ended_at (recovery did not close it)`);
    }
    const start = Date.parse(env.started_at);
    if (Number.isNaN(start)) {
      failures.push(`envelope ${env.stepId} has unparsable started_at "${env.started_at}"`);
    } else if (env.ended_at !== null) {
      const end = Date.parse(env.ended_at);
      if (Number.isNaN(end)) {
        failures.push(`envelope ${env.stepId} has unparsable ended_at "${env.ended_at}"`);
      } else if (end < start) {
        failures.push(`envelope ${env.stepId} ends before it starts`);
      }
    }
    if (env.wall_clock_ms !== null && env.wall_clock_ms < 0) {
      failures.push(`envelope ${env.stepId} has negative wall_clock_ms`);
    }
  }
  return failures;
}

/**
 * Full AC2 cross-check: the envelope stream reconciles against the attribute
 * log (validateProvenance) AND the envelope<->dispatch typed 1:N mapping holds
 * (anchorForRun). Missing required token usage still fails.
 */
export function runProvenanceCrossCheck(input: {
  envelopes: readonly EnvelopeEvent[];
  history: DispatchHistory;
  requireStartMarkers?: boolean;
  /** Accept the lossy cx-5e flow-keyed anchoring (old evidence only; default off). */
  legacyFlowKeyedEnvelopes?: boolean;
}): ProvenanceCrossCheck {
  const envelopeFailures = validateProvenance(input.envelopes);
  const cross = anchorForRun(input.history, input.envelopes, {
    ...(input.requireStartMarkers === undefined
      ? {}
      : { requireStartMarkers: input.requireStartMarkers }),
    ...(input.legacyFlowKeyedEnvelopes === undefined
      ? {}
      : { legacyFlowKeyedEnvelopes: input.legacyFlowKeyedEnvelopes }),
  });
  const failures = [...envelopeFailures, ...cross.failures].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return { ok: failures.length === 0, failures, anchor: cross.anchor };
}

/**
 * Recover the grouping target for an envelope: an explicit file/round first
 * (hand-built and legacy events), else parse the M2 identity (`file#round`);
 * null for flow-level steps. The live factory writes no file/round on any
 * event, so there the identity is the authoritative target key.
 */
function envelopeTarget(
  env: EnvelopeEvent,
  canonicalFile: (file: string) => string,
): { file: string; round: number | null } | null {
  if (env.file != null) return { file: canonicalFile(env.file), round: env.round ?? null };
  if (env.identity !== null) {
    const parsed = fileFromIdentity(env.identity);
    if (parsed !== null) {
      return { file: canonicalFile(parsed.file), round: env.round ?? parsed.round };
    }
  }
  return null;
}

/**
 * Resolves a (possibly lossy) recovered file path to the AUTHORITATIVE one: a
 * verdict record carries the true `file`, while the sanitized identity's
 * "__" -> "/" inverse corrupts any path containing "__" (src/__tests__/Foo.php
 * -> src//tests//Foo.php) and would split one file-round in two. The
 * sanitized forms are compared (sanitize(inverse(x)) === x always holds); two
 * distinct authoritative files that sanitize identically are ambiguous and
 * left alone.
 */
function canonicalFileResolver(verdicts: readonly VerdictRecord[]): (file: string) => string {
  const bySanitized = new Map<string, string | null>();
  for (const v of verdicts) {
    const key = sanitizeFileKey(v.file);
    const known = bySanitized.get(key);
    bySanitized.set(key, known === undefined || known === v.file ? v.file : null);
  }
  return (file) => bySanitized.get(sanitizeFileKey(file)) ?? file;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Group key for a Jev usage entry: `<step>:<file>#<round>` collapses to the
 * step; other ids (`pp-queue-verify:vitest-triage`) stay whole.
 */
function jevStepOf(stepId: string): string {
  const colon = stepId.indexOf(":");
  return colon > 0 && stepId.slice(colon + 1).includes("#") ? stepId.slice(0, colon) : stepId;
}

function summarizeJevUsage(entries: readonly JevUsageEntry[]): ReportJson["jev_usage"] {
  if (entries.length === 0) return null;
  const byStep = new Map<string, { calls: number; tokens: number }>();
  let total = 0;
  for (const e of entries) {
    const step = jevStepOf(e.stepId);
    const agg = byStep.get(step) ?? { calls: 0, tokens: 0 };
    agg.calls += 1;
    agg.tokens += e.tokens;
    byStep.set(step, agg);
    total += e.tokens;
  }
  return {
    calls: entries.length,
    total_tokens: total,
    cost_usd: null,
    by_step: [...byStep.entries()]
      .map(([step, agg]) => ({ step, calls: agg.calls, tokens: agg.tokens }))
      .sort((p, q) => compareStrings(p.step, q.step)),
  };
}

function buildReportJson(input: MetricsRenderInput, cross: ProvenanceCrossCheck | null): ReportJson {
  const { envelopes, verdicts, burnDown } = input;
  const noEvidence = envelopes.length === 0;
  // An empty envelope stream verifies NOTHING (wrong flow id, attributes not
  // read, a flow with no steps yet): it must never read as a vacuous pass.
  const provenanceFailures = [
    ...(cross === null ? validateProvenance(envelopes) : cross.failures),
    ...(noEvidence ? [NO_EVIDENCE_FAILURE] : []),
  ];
  const canonicalFile = canonicalFileResolver(verdicts);

  // ---- universe of file+round pairs (envelopes + verdicts) ---------------
  const fileRoundKeys = new Set<string>();
  const files = new Set<string>();
  for (const env of envelopes) {
    const target = envelopeTarget(env, canonicalFile);
    if (target === null || target.round === null) continue; // flow-level step
    fileRoundKeys.add(`${target.file}\u0000${target.round}`);
    files.add(target.file);
  }
  for (const v of verdicts) {
    fileRoundKeys.add(`${v.file}\u0000${v.round}`);
    files.add(v.file);
  }
  const tombstones = (input.tombstones ?? []).map((t) => ({ ...t, file: canonicalFile(t.file) }));
  for (const t of tombstones) {
    fileRoundKeys.add(`${t.file}\u0000${t.round}`);
    files.add(t.file);
  }

  // ---- verdicts grouped by file+round ------------------------------------
  const verdictsByGroup = new Map<string, VerdictRecord[]>();
  for (const v of verdicts) {
    const key = `${v.file}\u0000${v.round}`;
    const list = verdictsByGroup.get(key);
    if (list) list.push(v);
    else verdictsByGroup.set(key, [v]);
  }

  // ---- US-006 tombstones grouped by file+round ---------------------------
  const tombstonesByGroup = new Map<string, Array<VerdictTombstone>>();
  for (const t of tombstones) {
    const key = `${t.file}\u0000${t.round}`;
    const list = tombstonesByGroup.get(key);
    if (list) list.push(t);
    else tombstonesByGroup.set(key, [t]);
  }

  const fileRounds: ReportJson["file_rounds"] = [];
  for (const key of fileRoundKeys) {
    const parts = key.split("\u0000");
    const file = parts[0] ?? "<unknown>";
    const round = Number(parts[1] ?? "0");
    const records = [...(verdictsByGroup.get(key) ?? [])].sort((p, q) =>
      compareStrings(p.reviewer, q.reviewer),
    );
    const agreement = agreementForGroup(records, file, round);
    const groupTombstones = [...(tombstonesByGroup.get(key) ?? [])];
    // DEGRADED: the round reached verdict-check and EVERY reviewer was
    // discarded (zero completed records, >= 2 tombstones) — never readable
    // as a clean round on any surface.
    const degraded = records.length === 0 && groupTombstones.length >= 2;
    const citationChecks: CitationCheckResult[] = records.flatMap((r) =>
      r.citation_check.map((c) => ({ finding_id: c.finding_id, p_cited: c.p_cited })),
    );
    const citationGate = (input.citationGates ?? [])
      .filter((g) => canonicalFile(g.file) === file && g.round === round)
      .map((g) => ({
        reviewer: g.reviewer,
        checker: g.checker,
        fallbackReason: g.fallbackReason,
        scores: g.scores,
      }))
      .sort((p, q) => compareStrings(p.reviewer, q.reviewer));
    fileRounds.push({
      file,
      round,
      records: records.map((r) => ({
        reviewer: r.reviewer,
        diff_id: r.diff_id,
        findings: r.findings,
      })),
      agreement,
      degraded,
      tombstones: groupTombstones
        .map((t) => ({ reviewer: t.reviewer, reason: t.reason, attempt: t.attempt }))
        .sort((p, q) => compareStrings(p.reviewer, q.reviewer)),
      citation_checks: citationChecks,
      citation_gate: citationGate,
    });
  }
  fileRounds.sort((p, q) => (p.file !== q.file ? compareStrings(p.file, q.file) : p.round - q.round));

  // ---- tokens + wall clock per file per role (real attempts only) --------
  interface FileRoleAgg {
    file: string;
    role: EnvelopeRole;
    steps: number;
    tokenSum: number | null;
    allHaveTokens: boolean;
    wallSum: number | null;
  }
  const fileRoleAggs = new Map<string, FileRoleAgg>();
  for (const env of envelopes) {
    if (isStartMarker(env)) continue; // M4 start markers are not step work
    const file = envelopeTarget(env, canonicalFile)?.file ?? "(flow)";
    const key = `${file}\u0000${env.role}`;
    let agg = fileRoleAggs.get(key);
    if (!agg) {
      agg = { file, role: env.role, steps: 0, tokenSum: null, allHaveTokens: true, wallSum: null };
      fileRoleAggs.set(key, agg);
    }
    agg.steps += 1;
    const tokens = tokenTotalOf(env.tokens);
    if (tokens === null) {
      agg.allHaveTokens = false;
    } else {
      agg.tokenSum = agg.tokenSum === null ? tokens : agg.tokenSum + tokens;
    }
    if (env.wall_clock_ms !== null) {
      agg.wallSum = (agg.wallSum ?? 0) + env.wall_clock_ms;
    }
  }
  const tokensByFileRole = [...fileRoleAggs.values()]
    .map((agg) => ({
      file: agg.file,
      role: agg.role,
      steps: agg.steps,
      tokens: agg.allHaveTokens && agg.tokenSum !== null ? agg.tokenSum : null,
      wall_clock_ms: agg.wallSum,
    }))
    .sort((p, q) => (p.file !== q.file ? compareStrings(p.file, q.file) : compareStrings(p.role, q.role)));

  // ---- wave-5 cost honesty: per-role usage split (object-carrying envelopes)
  interface UsageAgg {
    role: EnvelopeRole;
    calls: number;
    splitCalls: number;
    input: number;
    cacheRead: number;
    cacheWrite: number;
    reasoning: number;
    output: number;
    cost: number;
    costedCalls: number;
    uncostedCalls: number;
  }
  const usageAggs = new Map<EnvelopeRole, UsageAgg>();
  for (const env of envelopes) {
    if (isStartMarker(env) || !isModelCallingRole(env.role)) continue;
    // A step that ran no model call (skipped, no tokens: a queue-fix with
    // nothing to fix reports tokens 0) is neither a call nor an uncosted one:
    // counting it overstated `calls` and turned an exact cost into a lower
    // bound with a note about tokens that never flowed (B22).
    if (env.outcome === "skipped" && (env.tokens === null || tokenTotalOf(env.tokens) === 0)) continue;
    let agg = usageAggs.get(env.role);
    if (!agg) {
      agg = {
        role: env.role,
        calls: 0,
        splitCalls: 0,
        input: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        output: 0,
        cost: 0,
        costedCalls: 0,
        uncostedCalls: 0,
      };
      usageAggs.set(env.role, agg);
    }
    agg.calls += 1;
    if (env.tokens === null) continue;
    if (typeof env.tokens === "number") {
      // Bare token total: tokens flowed but no provider cost can be attached.
      agg.uncostedCalls += 1;
      continue;
    }
    agg.splitCalls += 1;
    agg.input += env.tokens.input_tokens;
    agg.output += env.tokens.output_tokens;
    agg.reasoning += env.tokens.reasoning_tokens ?? 0;
    agg.cacheRead += env.tokens.cache_read_tokens ?? 0;
    agg.cacheWrite += env.tokens.cache_write_tokens ?? 0;
    if (typeof env.tokens.cost_usd === "number" && env.tokens.cost_usd > 0) {
      agg.cost += env.tokens.cost_usd;
      agg.costedCalls += 1;
    } else {
      agg.uncostedCalls += 1;
    }
  }
  const usageByRole = [...usageAggs.values()]
    .map((agg) => ({
      role: agg.role,
      calls: agg.calls,
      input_tokens: agg.splitCalls > 0 ? agg.input : null,
      cache_read_tokens: agg.splitCalls > 0 ? agg.cacheRead : null,
      cache_write_tokens: agg.splitCalls > 0 ? agg.cacheWrite : null,
      reasoning_tokens: agg.splitCalls > 0 ? agg.reasoning : null,
      output_tokens: agg.splitCalls > 0 ? agg.output : null,
      cost_usd: agg.costedCalls > 0 ? agg.cost : agg.splitCalls > 0 ? 0 : null,
      costed_calls: agg.costedCalls,
      uncosted_calls: agg.uncostedCalls,
    }))
    .sort((p, q) => compareStrings(p.role, q.role));
  const anySplit = [...usageAggs.values()].some((agg) => agg.splitCalls > 0);
  const costedCalls = [...usageAggs.values()].reduce((sum, agg) => sum + agg.costedCalls, 0);
  const uncostedCalls = [...usageAggs.values()].reduce((sum, agg) => sum + agg.uncostedCalls, 0);
  const costTotalUsd = [...usageAggs.values()].reduce((sum, agg) => sum + agg.cost, 0);
  const costTotal = anySplit ? costTotalUsd : null;
  // Estimated (a lower bound) whenever ANY call carried tokens without a
  // provider-reported cost — a mixed lane must not read as an exact total.
  // A plan-authed lane is the all-uncosted case: the honest total is "~$0".
  const costEstimated = costTotal !== null && uncostedCalls > 0;

  // ---- totals over eligible (model-calling, real-attempt) steps ----------
  let modelTokens: number | null = null;
  let stepTimeTotal = 0;
  let spanStart: number | null = null;
  let spanEnd: number | null = null;
  let startMarkerCount = 0;
  let interruptedRealCount = 0;
  for (const env of envelopes) {
    const startedAt = Date.parse(env.started_at);
    if (!Number.isNaN(startedAt)) spanStart = spanStart === null ? startedAt : Math.min(spanStart, startedAt);
    const endedAt = env.ended_at === null ? Number.NaN : Date.parse(env.ended_at);
    if (!Number.isNaN(endedAt)) spanEnd = spanEnd === null ? endedAt : Math.max(spanEnd, endedAt);
    if (isStartMarker(env)) {
      startMarkerCount++;
      continue;
    }
    if (env.outcome === "interrupted") interruptedRealCount++;
    if (isModelCallingRole(env.role)) {
      const tokens = tokenTotalOf(env.tokens);
      if (tokens !== null) modelTokens = (modelTokens ?? 0) + tokens;
    }
    if (env.wall_clock_ms !== null) stepTimeTotal += env.wall_clock_ms;
  }

  // ---- fixer retries -------------------------------------------------------
  // Per target (identity) the highest durable attempt minus one; the durable
  // envelope of a fixer that succeeded on attempt 3 is attempt 3 alone.
  const maxAttemptByTarget = new Map<string, Map<string, number>>();
  for (const env of envelopes) {
    if (env.stepId !== FIXER_STEP_ID || isStartMarker(env)) continue;
    const file = envelopeTarget(env, canonicalFile)?.file;
    if (file === undefined) continue;
    const targets = maxAttemptByTarget.get(file) ?? new Map<string, number>();
    const target = env.identity ?? "(flow)";
    targets.set(target, Math.max(targets.get(target) ?? 0, env.attempt));
    maxAttemptByTarget.set(file, targets);
  }
  const fixerRetries = [...maxAttemptByTarget.entries()]
    .map(([file, targets]) => ({
      file,
      retries: [...targets.values()].reduce((sum, attempt) => sum + Math.max(0, attempt - 1), 0),
    }))
    .sort((p, q) => compareStrings(p.file, q.file));

  // ---- queue burn-down ------------------------------------------------------
  // The flow's aggregate row (file null) is AUTHORITATIVE for an iteration's
  // total; per-file rows (tsc: capped by the flow) are breakdown only. The sum
  // of per-file rows is only the fallback when no aggregate row exists.
  interface IterationAgg {
    total: number | null;
    perFile: Array<{ file: string; error_count: number }>;
    /** US-010: vitest accounting for this iteration (first sample with one wins). */
    vitest?: VitestRunAccounting;
    /** Contract A: tsc accounting (rides on the tsc total row; first wins). */
    tsc?: TscRunAccounting;
  }
  interface QueueAgg {
    queue: QueueKind;
    iterations: Map<number, IterationAgg>;
  }
  const iterationCount = (it: IterationAgg): number =>
    it.total ?? it.perFile.reduce((sum, e) => sum + e.error_count, 0);
  const queueAggs = new Map<QueueKind, QueueAgg>();
  for (const sample of burnDown) {
    let agg = queueAggs.get(sample.queue);
    if (!agg) {
      agg = { queue: sample.queue, iterations: new Map() };
      queueAggs.set(sample.queue, agg);
    }
    let it = agg.iterations.get(sample.iteration);
    if (!it) {
      it = { total: null, perFile: [] };
      agg.iterations.set(sample.iteration, it);
    }
    if (sample.file === null || sample.file === TOTAL_PSEUDO_FILE) {
      // Each flow writes one aggregate row per iteration; rows from distinct
      // flows (parent + children) are independent counts and add up.
      it.total = (it.total ?? 0) + sample.error_count;
    } else {
      it.perFile.push({ file: sample.file, error_count: sample.error_count });
    }
    if (sample.vitest !== undefined && it.vitest === undefined) it.vitest = sample.vitest;
    if (sample.tsc !== undefined && it.tsc === undefined) it.tsc = sample.tsc;
  }
  const burnDownJson: ReportJson["queue_burn_down"] = [...queueAggs.values()]
    .sort((p, q) => compareStrings(p.queue, q.queue))
    .map((agg) => ({
      queue: agg.queue,
      iterations: [...agg.iterations.entries()]
        .sort((p, q) => p[0] - q[0])
        .map(([iteration, it]) => ({
          iteration,
          error_count: iterationCount(it),
          ...(it.vitest !== undefined ? { vitest: it.vitest } : {}),
          ...(it.tsc !== undefined ? { tsc: it.tsc } : {}),
          per_file: [...it.perFile].sort((p, q) => compareStrings(p.file, q.file)),
        })),
    }));

  // ---- US-010 verification: what the run was verified BY --------------------
  const tscAgg = queueAggs.get("tsc");
  let tscFinalErrorCount: number | null = null;
  let tscFinalAccounting: TscRunAccounting | null = null;
  if (tscAgg !== undefined && tscAgg.iterations.size > 0) {
    const last = Math.max(...tscAgg.iterations.keys());
    const lastIteration = tscAgg.iterations.get(last);
    if (lastIteration !== undefined) {
      tscFinalAccounting = lastIteration.tsc ?? null;
      // A tsc run that did not RUN has no trustworthy count: never 0, never PASS.
      tscFinalErrorCount =
        tscFinalAccounting?.state === "not-run" ? null : iterationCount(lastIteration);
    }
  }
  const vitestIterations = [...(queueAggs.get("vitest")?.iterations.entries() ?? [])].filter(
    ([, it]) => it.vitest !== undefined,
  );
  const lastVitest = vitestIterations.sort((p, q) => p[0] - q[0]).at(-1);
  const vitestVerification = lastVitest?.[1].vitest ?? null;
  const verification: ReportJson["summary"]["verification"] = {
    tsc_final_error_count: tscFinalErrorCount,
    tsc_verified:
      tscFinalErrorCount === null
        ? null
        : tscFinalErrorCount === 0 && (tscFinalAccounting?.unlocated ?? 0) === 0,
    ...(tscFinalAccounting !== null ? { tsc: tscFinalAccounting } : {}),
    vitest: vitestVerification,
  };

  return {
    generated_at: input.generatedAt ?? null,
    provenance_ok: provenanceFailures.length === 0,
    provenance_failures: provenanceFailures,
    no_evidence: noEvidence,
    summary: {
      files: [...files].filter((f) => f !== PREP_SPEC_FILE).sort(compareStrings),
      envelope_count: envelopes.length,
      start_marker_count: startMarkerCount,
      interrupted_envelope_count: interruptedRealCount,
      verdict_record_count: verdicts.length,
      degraded_round_count: fileRounds.filter((fr) => fr.degraded).length,
      tombstoned_reviewer_count: (input.tombstones ?? []).length,
      exhausted_attempt_tombstones: (input.tombstones ?? []).filter((t) =>
        t.reason.startsWith("attempt-exhausted"),
      ).length,
      tokens_model_roles: modelTokens,
      step_time_ms_total: stepTimeTotal,
      wall_clock_span_ms: spanStart !== null && spanEnd !== null && spanEnd >= spanStart ? spanEnd - spanStart : null,
      verification,
    },
    file_rounds: fileRounds,
    tokens_by_file_role: tokensByFileRole,
    usage_by_role: usageByRole,
    cost_total_usd: costTotal,
    cost_estimated: costEstimated,
    costed_calls: costedCalls,
    uncosted_calls: uncostedCalls,
    jev_usage: summarizeJevUsage(input.jevUsage ?? []),
    fixer_retries: fixerRetries,
    queue_burn_down: burnDownJson,
    kill_events: input.killEvents ?? null,
    kill_event_diagnostics: input.killEventDiagnostics ?? null,
    dispatch_anchor: cross === null ? null : cross.anchor,
  };
}

// ---- markdown ----------------------------------------------------------------

function mdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function pFmt(p: number): string {
  return p.toFixed(2);
}

/**
 * Cost cell: `~` marks an estimate — the role has at least one call whose
 * tokens carry no provider-reported cost (plan-authed lane or bare total), so
 * the USD figure is a lower bound; `~$0` is the all-uncosted case.
 */
function costCell(costUsd: number | null, estimated: boolean): string {
  if (costUsd === null) return "n/a";
  return costUsd > 0 ? `${estimated ? "~" : ""}$${costUsd.toFixed(4)}` : "~$0";
}

function killEventLine(e: ReportKillEvent): string {
  if (e.kind === "kill-intent") {
    return `- kill-intent run=${e.run_id} utc=${e.utc} monotonic_ms=${e.monotonic_ms} target_pids=${e.target_pids.join(",")}`;
  }
  const note = e.note === null ? "" : ` note=${mdCell(e.note)}`;
  const killed = e.killed_pids === undefined ? "" : ` killed_pids=${e.killed_pids.join(",")}`;
  const noop = isFiredKill(e) ? "" : " NO-OP (nothing was killed; not a kill-and-resume)";
  return `- kill-completed run=${e.run_id} utc=${e.utc} monotonic_ms=${e.monotonic_ms} resumed=${e.resumed}${killed}${noop}${note}`;
}

function renderMarkdown(report: ReportJson): string {
  const lines: string[] = [];
  lines.push("# Porting Run Metrics Report");
  lines.push("");
  if (report.generated_at !== null) {
    lines.push(`_generated_at: ${report.generated_at}_`);
    lines.push("");
  }

  lines.push("## Provenance");
  lines.push(
    report.no_evidence
      ? "- status: NO EVIDENCE (the envelope stream is empty — nothing was verified)"
      : report.provenance_ok
        ? "- status: OK"
        : `- status: FAILED (${report.provenance_failures.length} failure(s))`,
  );
  for (const failure of report.provenance_failures) lines.push(`- ${mdCell(failure)}`);
  lines.push("");

  lines.push("## Summary");
  lines.push(`- files: ${report.summary.files.length}${report.summary.files.length > 0 ? ` (${report.summary.files.join(", ")})` : ""}`);
  lines.push(
    `- envelopes: ${report.summary.envelope_count} (start markers: ${report.summary.start_marker_count}, interrupted: ${report.summary.interrupted_envelope_count})`,
  );
  lines.push(`- completed verdict records: ${report.summary.verdict_record_count}`);
  lines.push(`- tombstoned reviewers: ${report.summary.tombstoned_reviewer_count}`);
  if (report.summary.degraded_round_count > 0) {
    lines.push(
      `- DEGRADED rounds: ${report.summary.degraded_round_count} (every reviewer discarded — the round is UNREVIEWED, not clean)`,
    );
  }
  if (report.summary.exhausted_attempt_tombstones > 0) {
    lines.push(
      "- token under-count (attempt exhaustion): a tombstone anchors only the FINAL attempt's tokens; attempts 1..n-1 of an exhausted step leave no durable trace (0(g)) and are NOT reconciled — token totals under-count those steps.",
    );
  }
  const tokens = report.summary.tokens_model_roles;
  lines.push(
    tokens === null
      ? "- tokens (model-calling roles): n/a"
      : `- tokens (model-calling roles): ${tokens}`,
  );
  lines.push(
    report.jev_usage === null
      ? "- judgment (Jev) tokens: none recorded (naive judgment path or no live Jev spend)"
      : `- judgment (Jev) tokens: ${report.jev_usage.total_tokens} (separate from model-calling roles; see Judgment (Jev) section)`,
  );
  lines.push(
    `- step time: ${report.summary.step_time_ms_total} ms (sum of per-step durations; parallel steps overlap, so this can exceed elapsed time)`,
  );
  lines.push(
    report.summary.wall_clock_span_ms === null
      ? "- elapsed wall clock: n/a"
      : `- elapsed wall clock: ${report.summary.wall_clock_span_ms} ms (first envelope start to last envelope end)`,
  );
  lines.push("");

  lines.push("## Findings and agreement");
  if (report.file_rounds.length === 0) {
    lines.push("_no file+round records in the stream_");
  }
  for (const fr of report.file_rounds) {
    lines.push("");
    lines.push(
      `### ${fr.file} — round ${fr.round} (agreement: ${fr.agreement.outcome}${fr.degraded ? " — DEGRADED" : ""})`,
    );
    if (fr.records.length === 0) {
      lines.push(
        fr.degraded
          ? "_DEGRADED: every reviewer discarded — the round proceeds UNREVIEWED_"
          : "_no completed verdict records (unreviewed)_",
      );
    } else {
      lines.push("| reviewer | findings | severities |");
      lines.push("| --- | --- | --- |");
      for (const rec of fr.records) {
        const severities = rec.findings.map((f) => f.severity).join(", ");
        lines.push(`| ${mdCell(rec.reviewer)} | ${rec.findings.length} | ${mdCell(severities)} |`);
      }
    }
    lines.push(`- agreement: ${fr.agreement.outcome} — ${mdCell(fr.agreement.reason)}`);
    for (const t of fr.tombstones) {
      lines.push(`- tombstone: ${mdCell(t.reviewer)} discarded at attempt ${t.attempt} — ${mdCell(t.reason)}`);
    }
    // The gate's own score first: it is what decided which findings reached the
    // fixer. The verdict record's check is the deterministic one stamped at
    // review time and can disagree with a live Jev gate (C14).
    for (const g of fr.citation_gate) {
      const via = g.checker === "naive-fallback" ? `naive-fallback: ${mdCell(g.fallbackReason ?? "no reason recorded")}` : g.checker;
      const scores = g.scores
        .map((s) => `${mdCell(s.finding_id)}=${pFmt(s.p_cited)} ${s.outcome === "kept" ? "kept" : s.outcome === "dropped-citation" ? "dropped (citation)" : "dropped (disposition)"}`)
        .join(", ");
      lines.push(`- citation gate (${via}) ${mdCell(g.reviewer)}: ${scores === "" ? "no findings scored" : scores}`);
    }
    if (fr.citation_checks.length > 0) {
      const checks = fr.citation_checks
        .map((c) => `${c.finding_id}=${pFmt(c.p_cited)}`)
        .join(", ");
      lines.push(
        fr.citation_gate.length > 0
          ? `- review-time citation checks (deterministic, before the gate): ${checks}`
          : `- citation checks (deterministic, at review time; no gate record): ${checks}`,
      );
    }
  }
  lines.push("");

  lines.push("## Tokens and step time per file and role");
  if (report.tokens_by_file_role.length === 0) {
    lines.push("_no envelope events in the stream_");
  } else {
    lines.push("| file | role | steps | tokens | step time ms |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const agg of report.tokens_by_file_role) {
      const tokensCell = agg.tokens === null ? "n/a" : String(agg.tokens);
      const wallCell = agg.wall_clock_ms === null ? "n/a" : String(agg.wall_clock_ms);
      lines.push(`| ${mdCell(agg.file)} | ${mdCell(agg.role)} | ${agg.steps} | ${tokensCell} | ${wallCell} |`);
    }
  }
  lines.push("");

  lines.push("## Cost per role (provider-reported split)");
  if (report.usage_by_role.length === 0) {
    lines.push("_no model-calling envelopes in the stream_");
  } else {
    lines.push("| role | calls | input | cache-read | cache-write | reasoning | output | cost USD |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const u of report.usage_by_role) {
      const cell = (v: number | null): string => (v === null ? "n/a" : String(v));
      lines.push(
        `| ${u.role} | ${u.calls} | ${cell(u.input_tokens)} | ${cell(u.cache_read_tokens)} | ${cell(u.cache_write_tokens)} | ${cell(u.reasoning_tokens)} | ${cell(u.output_tokens)} | ${costCell(u.cost_usd, u.uncosted_calls > 0)} |`,
      );
    }
    const total =
      report.cost_total_usd === null
        ? "n/a"
        : `${report.cost_estimated ? "~" : ""}$${report.cost_total_usd.toFixed(4)}`;
    lines.push("");
    lines.push(`- total cost: ${total}`);
    if (report.cost_estimated) {
      lines.push(
        `- \`~\` = estimated: ${report.uncosted_calls} of ${report.costed_calls + report.uncosted_calls} model call(s) carried tokens with no provider-reported cost (plan-authed lane or bare token total); the USD total is a lower bound, not exact.`,
      );
    }
  }
  lines.push("");

  lines.push("## Judgment (Jev) tokens and cost");
  if (report.jev_usage === null) {
    lines.push("_none recorded (naive judgment path or no live Jev spend)_");
  } else {
    lines.push(
      `- total: ${report.jev_usage.total_tokens} tokens over ${report.jev_usage.calls} call(s) — NOT included in the model-calling token total or the USD total above`,
    );
    lines.push(
      "- cost: not reported (the pp-jev-usage record carries tokens only); no USD figure is claimed. Only committed step attempts are recorded, so retried attempts under-count.",
    );
    lines.push("");
    lines.push("| step | calls | tokens |");
    lines.push("| --- | --- | --- |");
    for (const s of report.jev_usage.by_step) {
      lines.push(`| ${mdCell(s.step)} | ${s.calls} | ${s.tokens} |`);
    }
  }
  lines.push("");

  lines.push("## Fixer retries");
  if (report.fixer_retries.length === 0) {
    lines.push("_no fixer steps in the stream_");
  } else {
    lines.push("| file | retries |");
    lines.push("| --- | --- |");
    for (const fr of report.fixer_retries) {
      lines.push(`| ${mdCell(fr.file)} | ${fr.retries} |`);
    }
  }
  lines.push("");

  lines.push("## Queue burn-down");
  if (report.queue_burn_down.length === 0) {
    lines.push("_no queue samples in the stream_");
  }
  for (const q of report.queue_burn_down) {
    lines.push("");
    lines.push(`### ${q.queue}`);
    lines.push("| iteration | total | per file |");
    lines.push("| --- | --- | --- |");
    for (const it of q.iterations) {
      const perFile = it.per_file.map((e) => `${e.file}:${e.error_count}`).join(", ");
      let total: string;
      if (q.queue === "vitest" && it.vitest !== undefined) {
        // US-010: a not-run vitest iteration NEVER presents as a bare count.
        total =
          it.vitest.state === "ran"
            ? `${it.error_count} failed (${it.vitest.passed ?? "?"} passed / ${it.vitest.total ?? "?"} total)`
            : `NOT RUN — ${mdCell(it.vitest.reason ?? "reason unrecorded")}`;
      } else if (q.queue === "tsc" && it.tsc !== undefined) {
        // Contract A: a not-run tsc iteration NEVER presents as a bare count.
        total =
          it.tsc.state === "ran"
            ? it.tsc.unlocated > 0
              ? `${it.error_count} (+${it.tsc.unlocated} unlocated)`
              : String(it.error_count)
            : `NOT RUN — ${mdCell(it.tsc.reason ?? "reason unrecorded")}`;
      } else {
        total = String(it.error_count);
      }
      lines.push(`| ${it.iteration} | ${total} | ${mdCell(perFile)} |`);
    }
  }
  lines.push("");

  // US-010: typecheck-verified vs test-verified are DIFFERENT evidence claims.
  lines.push("## Verification");
  const verification = report.summary.verification;
  if (verification.tsc?.state === "not-run") {
    lines.push(
      `- typecheck (tsc): NOT RUN (${mdCell(verification.tsc.reason ?? "reason unrecorded")}) — typecheck status unknown, never a pass`,
    );
  } else if (verification.tsc_verified === null) {
    lines.push("- typecheck (tsc): no queue samples — typecheck status unknown");
  } else if (verification.tsc_verified) {
    lines.push("- typecheck (tsc): PASS at final iteration (0 remaining errors)");
  } else {
    const unlocated = verification.tsc?.unlocated ?? 0;
    const unlocatedNote = unlocated > 0 ? ` (+${unlocated} unlocated diagnostic(s))` : "";
    lines.push(
      `- typecheck (tsc): ${verification.tsc_final_error_count} error(s)${unlocatedNote} remain at final iteration — NOT typecheck-clean`,
    );
  }
  if (verification.vitest === null) {
    lines.push(
      "- tests (vitest): no vitest samples in the stream — evidence is typecheck-only at best",
    );
  } else if (verification.vitest.state === "ran") {
    lines.push(
      `- tests (vitest): RAN — ${verification.vitest.passed ?? "?"} passed / ${verification.vitest.failed ?? "?"} failed of ${verification.vitest.total ?? "?"} total (test-verified only when failed = 0)`,
    );
  } else {
    lines.push(
      `- tests (vitest): NOT RUN — ${mdCell(verification.vitest.reason ?? "reason unrecorded")} (evidence is typecheck-only; a 0 here would be vacuous)`,
    );
  }
  lines.push("");

  lines.push("## Kill events");
  if (report.kill_events === null || report.kill_events.events.length === 0) {
    lines.push("_none recorded_");
  } else {
    for (const event of report.kill_events.events) lines.push(killEventLine(event));
    const completions = report.kill_events.events.filter((e) => e.kind === "kill-completed");
    if (completions.length > 0) {
      const fired = completions.filter(isFiredKill).length;
      lines.push(`- kills fired: ${fired}; no-op completions: ${completions.length - fired}`);
    }
  }
  const diag = report.kill_event_diagnostics;
  if (diag !== null) {
    if (diag.malformed_lines > 0) {
      lines.push(
        `- sidecar: ${diag.malformed_lines} malformed line(s) NOT counted as kill events (${diag.malformed_examples.map(mdCell).join("; ")})`,
      );
    }
    if (diag.excluded_events > 0) {
      lines.push(
        `- sidecar: ${diag.excluded_events} event(s) excluded — not anchored to this flow's run ids (another run's kill, or a legacy record without flow_run_id; pass --all-runs to include them)`,
      );
    }
  }
  lines.push("");
  lines.push(`- interrupted envelopes: ${report.summary.interrupted_envelope_count}`);
  lines.push("");

  lines.push("## Dispatch anchoring (dex typed 1:N)");
  const anchor = report.dispatch_anchor;
  if (anchor === null) {
    lines.push("_dex history not supplied — anchoring not evaluated_");
  } else {
    lines.push(anchor.ok ? "- status: OK" : "- status: FAILED");
    lines.push(`- envelopes anchored: ${anchor.envelopes_anchored}`);
    lines.push(
      `- dispatch entries: ${anchor.dispatch_entries_total} (non-agent kinds: ${anchor.non_agent_dispatch_entries}, unexplained: ${anchor.unexplained_dispatch_entries})`,
    );
    lines.push(`- model steps missing start marker: ${anchor.model_steps_missing_start_marker}`);
    for (const failure of anchor.failures) lines.push(`- ${mdCell(failure)}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Render the evidence stream into {markdown, json} for metrics/report.{md,json}. */
export function renderReport(input: MetricsRenderInput): RenderedReport {
  const cross =
    input.history === undefined || input.history === null
      ? null
      : runProvenanceCrossCheck({
          envelopes: input.envelopes,
          history: input.history,
          ...(input.legacyFlowKeyedEnvelopes === undefined
            ? {}
            : { legacyFlowKeyedEnvelopes: input.legacyFlowKeyedEnvelopes }),
        });
  const json = buildReportJson(input, cross);
  return { markdown: renderMarkdown(json), json };
}
