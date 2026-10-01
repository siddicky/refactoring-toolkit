/**
 * Deterministic suspicion predicate (US-006, plan §Stage 2c) — LANE A.
 *
 * A SCHEMA-VALID verdict is SUSPECT iff any of:
 *   (a) a finding's evidence span resolves OUTSIDE the diff's hunk
 *       line-ranges — the span resolver (src/harness/runtime.ts
 *       resolveEvidence, applied at mapping time) produced no evidence, or
 *       the resolved span's lines fall outside the cited hunk's body range;
 *   (b) findings count > 5 AND every finding is severity `blocker`
 *       (the "wall of blockers" degenerate shape);
 *   (c) the verdict text is identical (normalized) to a prior attempt's
 *       verdict text on the SAME diff within the SAME step — the comparison
 *       is IN-STEP ONLY (held in the review turn's process-local memo;
 *       cross-attempt replay is already cache-busted by the retry-prompt
 *       suffix, so an identical reply means a stuck provider cache).
 *
 * DETERMINISTIC and EXHAUSTIVE over its inputs: same input -> same verdict,
 * no clock, no randomness, and — per the two-lane rule — ZERO judgment input
 * (no Jev, no Tier-1 assessor; control-flow reads this module directly).
 * Pure functions only.
 */
import { extractJsonObject, type ParsedDiff } from "../harness/runtime.js";
import type { Finding, VerdictRecord } from "./types.js";

/** Machine-readable suspicion reasons (stable prefixes; report-rendered). */
export type SuspicionReason =
  | `span-outside-diff:${string}`
  | "all-blockers-over-cap"
  | "verbatim-repeat";

export interface SuspicionResult {
  suspect: boolean;
  /** Every fired reason, in deterministic (a) -> (b) -> (c) order. */
  reasons: SuspicionReason[];
}

/** Hard cap for the all-blockers arm: MORE than this many, ALL blocker. */
const ALL_BLOCKER_CAP = 5;

/**
 * Canonical text form of a verdict reply for the verbatim-repeat arm: a
 * parseable JSON object is canonicalized with sorted keys (so formatting and
 * key order never count as a repeat), anything else is whitespace-collapsed.
 */
export function normalizeVerdictText(text: string): string {
  try {
    const parsed = extractJsonObject(text);
    return `json:${stableStringify(parsed)}`;
  } catch {
    return `text:${text.replace(/\s+/g, " ").trim()}`;
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * True when the mapped evidence span lies INSIDE its cited hunk's body: both
 * ends resolve, through the runtime's single 1-based range helper (exposed as
 * `parsed.hunkIdForBodyLine`), to the hunk the evidence cites. The `@@` header
 * line and lines of other hunks are outside; a hunk's last body line is
 * inside. Uncited findings (evidence null = the span resolver rejected the
 * span) are OUTSIDE by definition.
 */
function spanInsideHunkRange(evidence: Finding["evidence"], parsed: ParsedDiff): boolean {
  if (evidence === null) return false;
  return (
    parsed.hunkIdForBodyLine(evidence.start_line) === evidence.hunk_id &&
    parsed.hunkIdForBodyLine(evidence.end_line) === evidence.hunk_id
  );
}

/**
 * The suspicion predicate over ONE schema-valid mapped verdict. `parsedDiff`
 * is the parse of the SAME raw diff the reviewer saw; `priorNormalizedText`
 * is the previous attempt's normalized reply on this step+diff (null when
 * this is the step's first parsed reply).
 */
export function evaluateSuspicion(input: {
  record: VerdictRecord;
  parsedDiff: ParsedDiff;
  /** THIS attempt's raw reply text (normalized here). */
  verdictText: string;
  /** Prior attempt's normalized reply on the same step+diff; null if none. */
  priorNormalizedText: string | null;
}): SuspicionResult {
  const reasons: SuspicionReason[] = [];

  // (a) evidence spans outside the diff's hunk line-ranges
  for (const finding of input.record.findings) {
    if (!spanInsideHunkRange(finding.evidence, input.parsedDiff)) {
      reasons.push(`span-outside-diff:${finding.finding_id}`);
    }
  }

  // (b) wall of blockers: > cap AND all blocker
  if (
    input.record.findings.length > ALL_BLOCKER_CAP &&
    input.record.findings.every((f) => f.severity === "blocker")
  ) {
    reasons.push("all-blockers-over-cap");
  }

  // (c) in-step verbatim repeat
  if (
    input.priorNormalizedText !== null &&
    normalizeVerdictText(input.verdictText) === input.priorNormalizedText
  ) {
    reasons.push("verbatim-repeat");
  }

  return { suspect: reasons.length > 0, reasons };
}
