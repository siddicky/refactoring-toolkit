/**
 * Deterministic reviewer-agreement rule (plan §Metrics event contract).
 *
 * Per file+round, derived ONLY from the two completed verdict records:
 * - findings from different reviewers AGREE iff their evidence spans overlap
 *   in >= 1 diff hunk (same hunk id, intersecting line ranges) AND the
 *   severity classes match;
 * - both completed and empty findings -> "agree-clean";
 * - exactly one has findings -> "disagree" (one-sided);
 * - any record missing -> "unreviewed" (excluded from agreement, surfaced).
 *
 * Pure functions only — no I/O, no clock, no randomness.
 */
import type { EvidenceSpan, Finding, VerdictRecord } from "./types.js";

export type AgreementOutcome = "agree" | "agree-clean" | "disagree" | "unreviewed";

export interface AgreementRecord {
  file: string;
  round: number;
  outcome: AgreementOutcome;
  /** Deterministic, human-readable justification for the outcome. */
  reason: string;
}

/** Two evidence spans overlap iff they live in the same diff hunk and their line ranges intersect. */
export function spansOverlap(a: EvidenceSpan, b: EvidenceSpan): boolean {
  return a.hunk_id === b.hunk_id && a.start_line <= b.end_line && b.start_line <= a.end_line;
}

/** Two findings match iff severity classes are equal and both cite overlapping evidence. */
export function findingsMatch(a: Finding, b: Finding): boolean {
  if (a.severity !== b.severity) return false;
  if (a.evidence === null || b.evidence === null) return false;
  return spansOverlap(a.evidence, b.evidence);
}

/**
 * Maximum bipartite matching between the two reviewers' findings
 * (Kuhn's algorithm; deterministic given the records' finding order).
 * Both finding arrays are tiny (reviewer verdicts), so this is cheap.
 */
function maxMatching(a: readonly Finding[], b: readonly Finding[]): number {
  const matchOfB: (number | null)[] = b.map(() => null);

  const tryAssign = (i: number, seen: boolean[]): boolean => {
    const findingA = a[i];
    if (findingA === undefined) return false;
    for (let j = 0; j < b.length; j++) {
      if (seen[j]) continue;
      const findingB = b[j];
      if (findingB === undefined || !findingsMatch(findingA, findingB)) continue;
      seen[j] = true;
      const owner = matchOfB[j] ?? null;
      if (owner === null || tryAssign(owner, seen)) {
        matchOfB[j] = i;
        return true;
      }
    }
    return false;
  };

  let matched = 0;
  for (let i = 0; i < a.length; i++) {
    if (tryAssign(i, b.map(() => false))) matched++;
  }
  return matched;
}

/**
 * The core rule for exactly the two verdict records of one file+round.
 * Either record may be null/undefined (= missing) which yields "unreviewed".
 */
export function classifyAgreement(
  a: VerdictRecord | null | undefined,
  b: VerdictRecord | null | undefined,
): AgreementRecord {
  const file = a?.file ?? b?.file ?? "<unknown>";
  const round = a?.round ?? b?.round ?? 0;
  const records: VerdictRecord[] = [];
  if (a) records.push(a);
  if (b) records.push(b);
  return agreementForGroup(records, file, round);
}

/**
 * Agreement for one file+round group of completed verdict records.
 * A healthy v1 run has exactly 2 DISTINCT reviewers; any other count (0, 1,
 * 3+) or a duplicated reviewer id is "unreviewed" with the observed shape
 * surfaced in the reason.
 */
export function agreementForGroup(
  records: readonly VerdictRecord[],
  file: string,
  round: number,
): AgreementRecord {
  if (records.length !== 2) {
    return {
      file,
      round,
      outcome: "unreviewed",
      reason: `expected exactly 2 completed verdict records, found ${records.length}`,
    };
  }
  const x = records[0];
  const y = records[1];
  if (x === undefined || y === undefined) {
    return {
      file,
      round,
      outcome: "unreviewed",
      reason: `expected exactly 2 completed verdict records, found ${records.length}`,
    };
  }
  if (x.reviewer === y.reviewer) {
    // Two records from ONE reviewer are not a pair: the other reviewer never
    // reviewed, so neither agreement nor disagreement can be claimed.
    return {
      file,
      round,
      outcome: "unreviewed",
      reason: `expected two distinct reviewers, found ${x.reviewer} twice (duplicate reviewer)`,
    };
  }
  if (x.findings.length === 0 && y.findings.length === 0) {
    return {
      file,
      round,
      outcome: "agree-clean",
      reason: "both completed reviews report zero findings",
    };
  }
  if (x.findings.length === 0 || y.findings.length === 0) {
    const withFindings = x.findings.length > 0 ? x.reviewer : y.reviewer;
    return {
      file,
      round,
      outcome: "disagree",
      reason: `one-sided: only ${withFindings} reports findings`,
    };
  }
  const matched = maxMatching(x.findings, y.findings);
  if (matched === x.findings.length && matched === y.findings.length) {
    return {
      file,
      round,
      outcome: "agree",
      reason: `${matched} finding pair(s) matched on severity class and overlapping evidence span`,
    };
  }
  return {
    file,
    round,
    outcome: "disagree",
    reason: `findings could not be fully paired: ${x.reviewer} has ${x.findings.length}, ${y.reviewer} has ${y.findings.length}, matched ${matched}`,
  };
}

/**
 * Group completed verdict records by file+round and compute the agreement
 * outcome for each group. Output is sorted by (file, round) for determinism.
 * Groups with any record count other than 2 come out as "unreviewed".
 */
export function agreementByFileRound(records: readonly VerdictRecord[]): AgreementRecord[] {
  const groups = new Map<string, VerdictRecord[]>();
  for (const r of records) {
    const key = `${r.file}\u0000${r.round}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const out: AgreementRecord[] = [];
  for (const [key, list] of groups) {
    const parts = key.split("\u0000");
    const file = parts[0] ?? "<unknown>";
    const round = Number(parts[1] ?? "0");
    const sorted = [...list].sort((p, q) => (p.reviewer < q.reviewer ? -1 : p.reviewer > q.reviewer ? 1 : 0));
    out.push(agreementForGroup(sorted, file, round));
  }
  out.sort((p, q) => {
    if (p.file !== q.file) return p.file < q.file ? -1 : 1;
    return p.round - q.round;
  });
  return out;
}
