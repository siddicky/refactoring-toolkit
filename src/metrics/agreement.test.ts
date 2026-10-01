import { describe, expect, test } from "bun:test";
import { agreementForGroup, findingsMatch, spansOverlap } from "./agreement.js";
import type { Finding, VerdictRecord } from "./types.js";

function span(hunk: string, start: number, end: number): { hunk_id: string; start_line: number; end_line: number; quote: string } {
  return { hunk_id: hunk, start_line: start, end_line: end, quote: "quoted evidence" };
}

function finding(id: string, severity: Finding["severity"], hunk: string, start: number, end: number): Finding {
  return { finding_id: id, severity, summary: `summary ${id}`, evidence: span(hunk, start, end) };
}

function record(
  file: string,
  reviewer: string,
  round: number,
  findings: Finding[],
): VerdictRecord {
  return {
    file,
    reviewer,
    round,
    diff_id: `${file}-r${round}`,
    findings,
    citation_check: findings.map((f) => ({ finding_id: f.finding_id, p_cited: 1 })),
  };
}

/** The agreement of one file+round whose completed verdict records are exactly `records`. */
const agreementOf = (...records: VerdictRecord[]) => agreementForGroup(records, "f.php", 1);

describe("spansOverlap", () => {
  test("overlaps in the same hunk with intersecting ranges", () => {
    expect(spansOverlap(span("h1", 2, 6), span("h1", 3, 5))).toBe(true);
    expect(spansOverlap(span("h1", 2, 4), span("h1", 4, 8))).toBe(true); // boundary touch
  });
  test("does not overlap across hunks or disjoint ranges", () => {
    expect(spansOverlap(span("h1", 2, 4), span("h2", 2, 4))).toBe(false);
    expect(spansOverlap(span("h1", 2, 4), span("h1", 5, 8))).toBe(false);
  });
});

describe("agreementForGroup (plan rule, per file+round)", () => {
  test("both completed and empty -> agree-clean", () => {
    const a = record("f.php", "reviewer-A", 1, []);
    const b = record("f.php", "reviewer-B", 1, []);
    expect(agreementOf(a, b).outcome).toBe("agree-clean");
  });

  test("overlapping evidence spans + same severity class -> agree", () => {
    const a = record("f.php", "reviewer-A", 1, [finding("A1", "major", "h1", 2, 6)]);
    const b = record("f.php", "reviewer-B", 1, [finding("B1", "major", "h1", 3, 5)]);
    const result = agreementOf(a, b);
    expect(result.outcome).toBe("agree");
    expect(result.reason).toContain("1 finding pair(s)");
  });

  test("severity class mismatch -> disagree", () => {
    const a = record("f.php", "reviewer-A", 1, [finding("A1", "blocker", "h1", 2, 6)]);
    const b = record("f.php", "reviewer-B", 1, [finding("B1", "major", "h1", 2, 6)]);
    expect(agreementOf(a, b).outcome).toBe("disagree");
  });

  test("no overlapping hunk -> disagree", () => {
    const a = record("f.php", "reviewer-A", 1, [finding("A1", "major", "h1", 2, 4)]);
    const b = record("f.php", "reviewer-B", 1, [finding("B1", "major", "h2", 2, 4)]);
    expect(agreementOf(a, b).outcome).toBe("disagree");
  });

  test("finding without evidence cannot match -> disagree", () => {
    const noEvidence: Finding = { finding_id: "A1", severity: "major", summary: "s", evidence: null };
    const a = record("f.php", "reviewer-A", 1, [noEvidence]);
    const b = record("f.php", "reviewer-B", 1, [finding("B1", "major", "h1", 2, 4)]);
    expect(agreementOf(a, b).outcome).toBe("disagree");
  });

  test("one-sided (exactly one empty) -> disagree", () => {
    const a = record("f.php", "reviewer-A", 1, [finding("A1", "nit", "h1", 1, 2)]);
    const b = record("f.php", "reviewer-B", 1, []);
    const result = agreementOf(a, b);
    expect(result.outcome).toBe("disagree");
    expect(result.reason).toContain("one-sided");
    expect(result.reason).toContain("reviewer-A");
  });

  test("any record missing -> unreviewed", () => {
    const a = record("f.php", "reviewer-A", 1, []);
    expect(agreementOf(a).outcome).toBe("unreviewed");
    expect(agreementOf().outcome).toBe("unreviewed");
  });

  test("findingsMatch requires same severity and overlapping span", () => {
    expect(findingsMatch(finding("a", "major", "h1", 1, 5), finding("b", "major", "h1", 4, 9))).toBe(true);
    expect(findingsMatch(finding("a", "major", "h1", 1, 5), finding("b", "minor", "h1", 1, 5))).toBe(false);
  });
});

describe("agreementForGroup counts the records in the group", () => {
  test("a group with only one record is unreviewed and surfaced", () => {
    const out = agreementOf(record("f.php", "reviewer-A", 1, []));
    expect(out.outcome).toBe("unreviewed");
    expect(out.reason).toContain("found 1");
  });

  test("a group with three records is unreviewed, not silently paired", () => {
    const out = agreementOf(
      record("f.php", "reviewer-A", 1, []),
      record("f.php", "reviewer-B", 1, []),
      record("f.php", "reviewer-C", 1, []),
    );
    expect(out.outcome).toBe("unreviewed");
    expect(out.reason).toContain("found 3");
  });

  test("the group's file and round are echoed, never taken from the records", () => {
    const out = agreementForGroup([record("x.php", "reviewer-A", 9, []), record("x.php", "reviewer-B", 9, [])], "a.php", 2);
    expect(`${out.file}#${out.round}:${out.outcome}`).toBe("a.php#2:agree-clean");
  });
});

describe("agreementForGroup requires two DISTINCT reviewers (C48)", () => {
  test("two records from the same reviewer are unreviewed (duplicate reviewer), not agree-clean", () => {
    const out = agreementOf(record("f.php", "reviewer-A", 1, []), record("f.php", "reviewer-A", 1, []));
    expect(out.outcome).toBe("unreviewed");
    expect(out.reason).toContain("duplicate reviewer");
    expect(out.reason).toContain("reviewer-A twice");
  });

  test("a duplicated reviewer with findings is not a disagree/agree pairing either", () => {
    const f = finding("F1", "major", "h1", 1, 5);
    const out = agreementOf(record("f.php", "reviewer-B", 2, [f]), record("f.php", "reviewer-B", 2, [f]));
    expect(out.outcome).toBe("unreviewed");
  });

  test("two distinct reviewers still pair as before", () => {
    const out = agreementOf(record("f.php", "reviewer-A", 1, []), record("f.php", "reviewer-B", 1, []));
    expect(out.outcome).toBe("agree-clean");
  });
});
