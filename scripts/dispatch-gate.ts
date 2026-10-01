/**
 * Lead-layer dispatch health gate (US-002, plan v5.1 §Stage 1).
 *
 * Reads the dexcli flow history ONLY (typed parser reuse from
 * src/dashboard/queries.ts — DexHistoryWire via flowHistory), computes
 * consecutive step-failure facts on REVIEW steps (the degenerate-turn
 * blast radius), and reports staleness. LEAD-LAYER ONLY: this module is
 * imported by scripts/run-demo.ts (the runner) and tests — NEVER by flow
 * steps (PpWaveDispatch/DispatchStep must not gate on it).
 *
 * Fail-open contract: every failure mode (no flow id, query failure, empty
 * history, no review events, stale history) degrades to verdict "degraded"
 * with `protection: "none"` — the gate NEVER blocks a dispatch, it only
 * informs. The runner surfaces `gate: degraded (...)` plus an explicit
 * no-protection note so an operator never mistakes silence for safety.
 */

import type { StringOption } from "../src/cli/args.js";
import type { DexHistoryWire } from "../src/dashboard/types.js";
import type { QueryResult } from "../src/dashboard/queries.js";

/**
 * The gate's one command-line input, declared here so every caller shares one
 * definition: `run-demo.ts gate --flow-id <id>` and `run-demo.ts demo
 * --gate-flow-id <id>` both build their option from it (this module has no
 * argv of its own; it is imported by the runner). Omitting it is allowed: the
 * gate then reports "degraded" and dispatch proceeds (fail-open).
 */
export const GATE_FLOW_ID_OPTION = {
  kind: "string",
  metavar: "id",
  description:
    "flow whose dexcli history the dispatch health gate reads (omitted: gate reports degraded, no protection; it never blocks)",
} as const satisfies StringOption;

/** Per-history-query timeout (spec: 5 s). */
export const GATE_QUERY_TIMEOUT_MS = 5_000;

/** History older than this means the gate cannot vouch for the lane. */
export const GATE_STALE_MS = 10 * 60_000;

/**
 * Review-step types whose failures indicate the degenerate-turn provider
 * signature (mirror of flows/port-project.ts step table — no flow imports;
 * same mirror rule as src/metrics/dispatch-anchor.ts).
 */
export const REVIEW_STEP_TYPES: readonly string[] = [
  "PpPrepReviewA",
  "PpPrepReviewB",
  "PpReviewA",
  "PpReviewB",
];

export function isReviewStepType(stepType: unknown): stepType is string {
  return typeof stepType === "string" && REVIEW_STEP_TYPES.includes(stepType);
}

/** Facts computed from one flow's history (pure; `nowMs` injected). */
export interface ReviewFailureFacts {
  /**
   * Trailing run of FAILED review-step EXECUTIONS ending at the newest
   * review execute event (waitFor-phase events never break the chain —
   * execute retries re-record waitFor completions between failures).
   */
  consecutiveReviewFailures: number;
  /** finalAttempt of the newest review event (null when none). */
  newestFinalAttempt: number | null;
  /** Age of the newest review-step event in ms (null when none). */
  newestRelevantEventAgeMs: number | null;
  /** Total review-step events seen in the history. */
  relevantEventCount: number;
}

interface ReviewEventRow {
  type: string;
  finalAttempt: number | null;
  eventTime: string | null;
}

function reviewEventRows(history: DexHistoryWire): ReviewEventRow[] {
  const rows: ReviewEventRow[] = [];
  for (const event of history.events) {
    const context = event.payload?.context;
    const stepType = context?.stepType;
    if (!isReviewStepType(stepType)) continue;
    rows.push({
      type: typeof event.type === "string" ? event.type : "",
      finalAttempt:
        typeof context?.finalAttempt === "number" && Number.isInteger(context.finalAttempt)
          ? context.finalAttempt
          : null,
      eventTime: typeof event.eventTime === "string" ? event.eventTime : null,
    });
  }
  return rows;
}

function ageMs(eventTime: string | null, nowMs: number): number | null {
  if (eventTime === null) return null;
  const t = Date.parse(eventTime);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, nowMs - t);
}

/**
 * Computes the gate's facts over one history payload (pure). Execute-phase
 * events (`StepExecuteCompleted` / `StepExecuteFailed`) form the failure
 * chain; `StepWaitFor*` events only contribute staleness/relevance.
 */
export function reviewFailureFacts(history: DexHistoryWire, nowMs: number): ReviewFailureFacts {
  const rows = reviewEventRows(history);
  let consecutiveReviewFailures = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === undefined) break;
    if (row.type === "StepExecuteFailed") {
      consecutiveReviewFailures++;
      continue;
    }
    if (row.type === "StepExecuteCompleted") break;
    // WaitFor* or unknown event kinds: skip (do not break the chain).
  }
  const newest = rows[rows.length - 1];
  const newestAge = newest === undefined ? null : ageMs(newest.eventTime, nowMs);
  const newestFinalAttempt = newest?.finalAttempt ?? null;
  return {
    consecutiveReviewFailures,
    newestFinalAttempt,
    newestRelevantEventAgeMs: newestAge,
    relevantEventCount: rows.length,
  };
}

/** Gate outcome. `protection: "none"` ALWAYS pairs with verdict "degraded". */
export interface DispatchGateReport {
  verdict: "ok" | "degraded";
  /** Human-readable basis (healthy basis or fail-open reason). */
  reason: string;
  /** Facts when history was queryable; null on missing/query-failure. */
  facts: ReviewFailureFacts | null;
  /** "active" = fresh queryable history vouches for the facts shown. */
  protection: "active" | "none";
}

/**
 * Evaluates the gate against an injected flowHistory query (5 s timeout is a
 * property of the query source — dexCliQueries with GATE_QUERY_TIMEOUT_MS).
 * Pure control flow over the QueryResult; no I/O here, so the fail-open
 * branches are unit-testable (AC-B3) without dexcli.
 */
export async function evaluateDispatchGate(
  flowHistory: (flowId: string) => Promise<QueryResult<DexHistoryWire>>,
  flowId: string | undefined,
  nowMs: number,
): Promise<DispatchGateReport> {
  if (flowId === undefined || flowId === "") {
    return {
      verdict: "degraded",
      reason: "no flow history available (no --gate-flow-id given)",
      facts: null,
      protection: "none",
    };
  }
  let queried: QueryResult<DexHistoryWire>;
  try {
    queried = await flowHistory(flowId);
  } catch (e) {
    return {
      verdict: "degraded",
      reason: `flow history query threw: ${(e as Error).message}`,
      facts: null,
      protection: "none",
    };
  }
  if (!queried.ok) {
    return {
      verdict: "degraded",
      reason: `flow history query failed: ${queried.error}`,
      facts: null,
      protection: "none",
    };
  }
  const events = queried.value.events;
  if (!Array.isArray(events) || events.length === 0) {
    return {
      verdict: "degraded",
      reason: `flow history for ${flowId} is empty`,
      facts: null,
      protection: "none",
    };
  }
  const facts = reviewFailureFacts(queried.value, nowMs);
  if (facts.relevantEventCount === 0 || facts.newestRelevantEventAgeMs === null) {
    return {
      verdict: "degraded",
      reason: `no review-step events in ${flowId} history (nothing relevant to vouch on)`,
      facts,
      protection: "none",
    };
  }
  if (facts.newestRelevantEventAgeMs > GATE_STALE_MS) {
    return {
      verdict: "degraded",
      reason: `newest review event is ${Math.round(facts.newestRelevantEventAgeMs / 1000)}s old (> ${GATE_STALE_MS / 1000}s stale threshold)`,
      facts,
      protection: "none",
    };
  }
  const failureNote =
    facts.consecutiveReviewFailures > 0
      ? `; ${facts.consecutiveReviewFailures} consecutive failed review execution(s) — f(attempt) demotion engages on retries`
      : "; no failed review executions";
  return {
    verdict: "ok",
    reason: `newest review event ${Math.round(facts.newestRelevantEventAgeMs / 1000)}s old${failureNote}`,
    facts,
    protection: "active",
  };
}

/** The single runner-output line for a gate report (US-002 surface). */
export function gateLine(report: DispatchGateReport): string {
  if (report.verdict === "ok") {
    return `gate: ok (${report.reason})`;
  }
  return `gate: degraded (${report.reason}) — dispatch protection NOT active (fail-open); proceeding WITHOUT lane-health protection`;
}
