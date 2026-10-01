/**
 * Wire-shape adapters for the AC2 evidence driver (scripts/render-metrics.ts).
 *
 * Pure functions over the `dexcli flow state` attribute list — no I/O, no
 * top-level side effects — so they can be unit-tested (the driver script runs
 * its `main()` on import and cannot be).
 */
import {
  type CitationGateView,
  type EnvelopeEvent,
  fileFromIdentity,
  fileFromSanitizedKey,
  type JevUsageEntry,
  type QueueBurnDownEvent,
  type QueueKind,
  type TokenUsage,
  type VerdictRecord,
  type VerdictTombstone,
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
 * recovered from the attribute key (`<sanitized-file>#<round>#<reviewer>`,
 * inverted by the shared fileFromSanitizedKey — lossy for filenames containing
 * "__"; the renderer prefers a verdict record's authoritative file). Tombstones never enter the VerdictRecord stream; the
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
    const roundPart = suffix.slice(roundSep + 1, reviewerSep);
    if (!/^\d+$/.test(roundPart)) continue;
    out.push({
      file: fileFromSanitizedKey(suffix.slice(0, roundSep)),
      round: Number(roundPart),
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
  // A record without a string started_at is kept (validateProvenance reports
  // it as unparsable) but must not crash the sort.
  const startedAt = (e: EnvelopeEvent): string =>
    typeof e.started_at === "string" ? e.started_at : "";
  return out.sort((p, q) => startedAt(p).localeCompare(startedAt(q)));
}

/**
 * The citation gate's own scores (`pp-kept/<sanitized-file>#<round>`, value =
 * KeptFindings): per reviewer, the p_cited the gate APPLIED and what it did
 * with each finding. The verdict records carry only the deterministic check
 * stamped at review time, which can read 1.00 for a finding the live Jev gate
 * dropped at 0.3, so the report needs this attribute to show the gate's score
 * (C14). Records that predate `citationGate`, and malformed ones, yield nothing.
 */
export function collectCitationGates(attrs: readonly StateAttribute[]): CitationGateView[] {
  const out: CitationGateView[] = [];
  for (const a of attrs) {
    if (!a.key.startsWith("pp-kept/")) continue;
    const target = fileFromIdentity(a.key.slice("pp-kept/".length));
    const kept = a.value as {
      citationGate?: unknown;
      dropped?: unknown;
    } | null;
    if (target === null || kept === null || typeof kept !== "object" || !Array.isArray(kept.citationGate)) continue;
    const dropped = (Array.isArray(kept.dropped) ? kept.dropped : []) as Array<{
      finding_id?: unknown;
      reviewer?: unknown;
      p_cited?: unknown;
    } | null>;
    for (const raw of kept.citationGate as unknown[]) {
      const g = raw as { reviewer?: unknown; checker?: unknown; fallbackReason?: unknown; scores?: unknown } | null;
      if (g === null || typeof g !== "object" || typeof g.reviewer !== "string" || !Array.isArray(g.scores)) continue;
      const reviewer = g.reviewer;
      const scores: CitationGateView["scores"] = [];
      for (const s of g.scores as unknown[]) {
        const score = s as { finding_id?: unknown; p_cited?: unknown } | null;
        if (typeof score?.finding_id !== "string" || typeof score.p_cited !== "number") continue;
        const drop = dropped.find((d) => d?.reviewer === reviewer && d.finding_id === score.finding_id);
        scores.push({
          finding_id: score.finding_id,
          p_cited: score.p_cited,
          outcome: drop == null ? "kept" : typeof drop.p_cited === "number" ? "dropped-citation" : "dropped-disposition",
        });
      }
      out.push({
        file: target.file,
        round: target.round,
        reviewer,
        checker: typeof g.checker === "string" ? g.checker : "unknown",
        fallbackReason: typeof g.fallbackReason === "string" ? g.fallbackReason : null,
        scores,
      });
    }
  }
  return out.sort((p, q) =>
    `${p.file}#${p.round}#${p.reviewer}`.localeCompare(`${q.file}#${q.round}#${q.reviewer}`),
  );
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
  /**
   * firstRunId and runId, de-duplicated: the two runs the summary names. The
   * runs between them are found by walking `previousRunId` back from the
   * current run (scripts/render-metrics.ts mergedHistory).
   */
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

/** History events that may carry `pp-wave-children` attribute upserts (dexcli wire subset). */
interface WaveChildrenHistoryEvent {
  payload?: {
    output?: {
      upsertAttributes?: Array<{
        key?: string;
        value?: { children?: Array<{ flowId?: string }> };
      }>;
    };
  };
}

/**
 * Child flow ids of a parallel-topology parent. The parent publishes its
 * children under `pp-wave-children/children`, but that attribute is
 * OVERWRITTEN on every wave, so the final state only names the LAST wave's
 * children (live finding cx-5e: 10 children across 6 waves, 1 in final
 * state). Walk the parent's durable history for every pp-wave-children upsert
 * and merge the final state's copy.
 */
export function discoverChildFlowIds(
  attrs: readonly StateAttribute[],
  historyEvents: readonly unknown[],
): string[] {
  const ids = new Set<string>();
  const add = (children: Array<{ flowId?: string }> | undefined): void => {
    for (const c of children ?? []) {
      if (typeof c?.flowId === "string" && c.flowId.length > 0) ids.add(c.flowId);
    }
  };
  for (const a of attrs) {
    if (!a.key.startsWith("pp-wave-children")) continue;
    add((a.value as { children?: Array<{ flowId?: string }> } | null)?.children);
  }
  for (const event of historyEvents as readonly WaveChildrenHistoryEvent[]) {
    for (const up of event?.payload?.output?.upsertAttributes ?? []) {
      if (up?.key === undefined || !up.key.startsWith("pp-wave-children")) continue;
      add(up.value?.children);
    }
  }
  return [...ids];
}
