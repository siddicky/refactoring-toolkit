/**
 * Wire-shape adapters for the AC2 evidence driver (scripts/render-metrics.ts).
 *
 * Pure functions over the `dexcli flow state` attribute list — no I/O, no
 * top-level side effects — so they can be unit-tested (the driver script runs
 * its `main()` on import and cannot be).
 */
import type {
  EnvelopeEvent,
  JevUsageEntry,
  QueueBurnDownEvent,
  QueueKind,
  TokenUsage,
  VerdictRecord,
  VerdictTombstone,
} from "./types.js";

/** One durable attribute of a flow (`flow state` wire shape). */
export interface StateAttribute {
  key: string;
  value: unknown;
}

/**
 * Burn-down attribute rows → renderer samples.
 *
 * The flow writes, per queue iteration, ONE aggregate row (`file: null`,
 * `error_count` = the iteration total) plus (tsc only, capped at 8 files)
 * per-file breakdown rows. Every valid row is passed through: the aggregate
 * row keeps `file: null` and the renderer treats it as AUTHORITATIVE for the
 * iteration total (per-file rows are breakdown only). Dropping the aggregate
 * row whenever per-file rows exist would understate the total for any
 * iteration with errors in more than the capped number of files.
 */
export function collectBurnDown(attrs: readonly StateAttribute[]): QueueBurnDownEvent[] {
  const out: QueueBurnDownEvent[] = [];
  for (const a of attrs) {
    if (!a.key.startsWith("queue-burndown/")) continue;
    const v = a.value as Partial<QueueBurnDownEvent> | null;
    if (
      typeof v?.queue !== "string" ||
      typeof v.iteration !== "number" ||
      typeof v.error_count !== "number" ||
      typeof v.recorded_at !== "string"
    ) {
      continue;
    }
    const queue = v.queue as QueueKind;
    // US-010 honest vitest accounting: state travels with the sample when the
    // flow wrote it (legacy rows keep the field absent).
    let vitest: QueueBurnDownEvent["vitest"];
    if (
      v.vitest !== undefined &&
      typeof v.vitest === "object" &&
      v.vitest !== null &&
      (v.vitest.state === "ran" || v.vitest.state === "not-run")
    ) {
      vitest = {
        state: v.vitest.state,
        reason: typeof v.vitest.reason === "string" ? v.vitest.reason : null,
        passed: typeof v.vitest.passed === "number" ? v.vitest.passed : null,
        failed: typeof v.vitest.failed === "number" ? v.vitest.failed : null,
        total: typeof v.vitest.total === "number" ? v.vitest.total : null,
      };
    }
    // Contract A: honest tsc accounting rides on the tsc TOTAL row (legacy
    // rows keep the field absent and render as before).
    let tsc: QueueBurnDownEvent["tsc"];
    if (
      v.tsc !== undefined &&
      typeof v.tsc === "object" &&
      v.tsc !== null &&
      (v.tsc.state === "ran" || v.tsc.state === "not-run")
    ) {
      tsc = {
        state: v.tsc.state,
        reason: typeof v.tsc.reason === "string" ? v.tsc.reason : null,
        exit_code: typeof v.tsc.exit_code === "number" ? v.tsc.exit_code : null,
        unlocated: typeof v.tsc.unlocated === "number" ? v.tsc.unlocated : 0,
      };
    }
    out.push({
      queue,
      file: typeof v.file === "string" && v.file !== "" ? v.file : null,
      iteration: v.iteration,
      error_count: v.error_count,
      recorded_at: v.recorded_at,
      ...(vitest !== undefined ? { vitest } : {}),
      ...(tsc !== undefined ? { tsc } : {}),
    });
  }
  return out;
}

export function collectVerdicts(attrs: readonly StateAttribute[]): VerdictRecord[] {
  const out: VerdictRecord[] = [];
  for (const a of attrs) {
    if (!a.key.startsWith("pp-verdict/") && !a.key.startsWith("pp-prep-verdict/")) continue;
    const tuple = a.value as { metrics?: VerdictRecord } | null;
    const rec = tuple?.metrics;
    if (
      rec !== undefined &&
      rec !== null &&
      typeof rec.file === "string" &&
      typeof rec.reviewer === "string" &&
      Array.isArray(rec.findings)
    ) {
      out.push(rec);
    }
  }
  return out.sort((p, q) =>
    `${p.file}#${p.round}#${p.reviewer}`.localeCompare(`${q.file}#${q.round}#${q.reviewer}`),
  );
}

/**
 * US-006 tombstones (discarded reviewer verdicts) stored under the same
 * pp-verdict / pp-prep-verdict keys a completed tuple would use. The value
 * carries {reviewer, discarded, reason, attempt, tokens}; file+round are
 * recovered from the attribute key (`<sanitized-file>#<round>#<reviewer>` —
 * "__" -> "/" is lossy for filenames containing "__", documented pattern of
 * fileFromIdentity). Tombstones never enter the VerdictRecord stream; the
 * renderer uses them for the degraded marker and the exhaustion under-count
 * note.
 */
export function collectTombstones(
  attrs: readonly StateAttribute[],
): Array<VerdictTombstone & { file: string; round: number }> {
  const out: Array<VerdictTombstone & { file: string; round: number }> = [];
  for (const a of attrs) {
    if (!a.key.startsWith("pp-verdict/") && !a.key.startsWith("pp-prep-verdict/")) continue;
    const suffix = a.key.slice(a.key.indexOf("/") + 1);
    const reviewerSep = suffix.lastIndexOf("#");
    const roundSep = reviewerSep > 0 ? suffix.lastIndexOf("#", reviewerSep - 1) : -1;
    if (reviewerSep <= 0 || roundSep <= 0) continue;
    const v = a.value as Partial<VerdictTombstone> | null;
    if (v === null || typeof v !== "object" || v.discarded !== true) continue;
    if (typeof v.reviewer !== "string" || typeof v.reason !== "string") continue;
    if (typeof v.attempt !== "number") continue;
    out.push({
      file: suffix.slice(0, roundSep).replace(/__/g, "/"),
      round: Number(suffix.slice(roundSep + 1, reviewerSep)),
      reviewer: v.reviewer,
      discarded: true,
      reason: v.reason,
      attempt: v.attempt,
      tokens: (v.tokens ?? null) as number | TokenUsage | null,
    });
  }
  return out.sort((p, q) =>
    `${p.file}#${p.round}#${p.reviewer}`.localeCompare(`${q.file}#${q.round}#${q.reviewer}`),
  );
}

export function collectEnvelopes(attrs: readonly StateAttribute[]): EnvelopeEvent[] {
  const out: EnvelopeEvent[] = [];
  for (const a of attrs) {
    if (!a.key.startsWith("envelope-event/")) continue;
    const v = a.value as Partial<EnvelopeEvent> | null;
    if (
      v !== null &&
      typeof v === "object" &&
      typeof v.stepId === "string" &&
      typeof v.role === "string" &&
      typeof v.attempt === "number" &&
      typeof v.outcome === "string"
    ) {
      out.push(v as EnvelopeEvent);
    }
  }
  return out.sort((p, q) => p.started_at.localeCompare(q.started_at));
}

/**
 * Live Jev usage (`pp-jev-usage/*`, value = array of {stepId, tokens, atUtc}).
 * Each flow (parent and every child) keeps its own log; the driver passes the
 * concatenation. Malformed entries are skipped.
 */
export function collectJevUsage(attrs: readonly StateAttribute[]): JevUsageEntry[] {
  const out: JevUsageEntry[] = [];
  for (const a of attrs) {
    if (!a.key.startsWith("pp-jev-usage/")) continue;
    if (!Array.isArray(a.value)) continue;
    for (const raw of a.value as unknown[]) {
      const e = raw as Partial<JevUsageEntry> | null;
      if (
        e !== null &&
        typeof e === "object" &&
        typeof e.stepId === "string" &&
        typeof e.tokens === "number" &&
        Number.isFinite(e.tokens) &&
        e.tokens >= 0 &&
        typeof e.atUtc === "string"
      ) {
        out.push({ stepId: e.stepId, tokens: e.tokens, atUtc: e.atUtc });
      }
    }
  }
  return out.sort((p, q) => p.atUtc.localeCompare(q.atUtc));
}

/**
 * `dexcli flow summary` wire subset. flowStatus / runId / firstRunId live on
 * the SUMMARY surface only: the `flow state` payload carries just
 * `activeStepExecutions` and `attributes` (src/dashboard/types.ts).
 */
export interface FlowSummaryWire {
  flowId?: string;
  runId?: string;
  firstRunId?: string;
  flowStatus?: string;
}

export const FLOW_STATUS_COMPLETED = "FLOW_STATUS_COMPLETED";

/** Flow-level facts derived from one `flow summary` payload. */
export interface FlowFacts {
  flowId: string;
  /** Current run id (falls back to the flow id when the summary has none). */
  runId: string;
  /** firstRunId and runId, de-duplicated (the runs whose history is fetched). */
  runIds: string[];
  flowCompleted: boolean;
}

export function flowFactsFromSummary(flowId: string, summary: FlowSummaryWire): FlowFacts {
  const runIds = [
    ...new Set(
      [summary.firstRunId, summary.runId].filter(
        (r): r is string => typeof r === "string" && r.length > 0,
      ),
    ),
  ];
  return {
    flowId: summary.flowId ?? flowId,
    runId:
      typeof summary.runId === "string" && summary.runId.length > 0 ? summary.runId : flowId,
    runIds,
    flowCompleted: summary.flowStatus === FLOW_STATUS_COMPLETED,
  };
}
