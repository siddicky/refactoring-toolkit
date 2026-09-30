/**
 * Wire-shape adapters for the AC2 evidence driver (scripts/render-metrics.ts).
 *
 * Pure functions over the `dexcli flow state` attribute list — no I/O, no
 * top-level side effects — so they can be unit-tested (the driver script runs
 * its `main()` on import and cannot be).
 */
import type {
  EnvelopeEvent,
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
    out.push({
      queue,
      file: typeof v.file === "string" && v.file !== "" ? v.file : null,
      iteration: v.iteration,
      error_count: v.error_count,
      recorded_at: v.recorded_at,
      ...(vitest !== undefined ? { vitest } : {}),
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
