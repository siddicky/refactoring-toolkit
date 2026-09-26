import { describe, expect, test } from "bun:test";
import {
  agreementByFileRound,
  classifyAgreement,
  findingsMatch,
  spansOverlap,
} from "./agreement.js";
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

describe("classifyAgreement (plan rule, per file+round)", () => {
  test("both completed and empty -> agree-clean", () => {
    const a = record("f.php", "reviewer-A", 1, []);
    const b = record("f.php", "reviewer-B", 1, []);
    expect(classifyAgreement(a, b).outcome).toBe("agree-clean");
  });

  test("overlapping evidence spans + same severity class -> agree", () => {
    const a = record("f.php", "reviewer-A", 1, [finding("A1", "major", "h1", 2, 6)]);
    const b = record("f.php", "reviewer-B", 1, [finding("B1", "major", "h1", 3, 5)]);
    const result = classifyAgreement(a, b);
    expect(result.outcome).toBe("agree");
    expect(result.reason).toContain("1 finding pair(s)");
  });

  test("severity class mismatch -> disagree", () => {
    const a = record("f.php", "reviewer-A", 1, [finding("A1", "blocker", "h1", 2, 6)]);
    const b = record("f.php", "reviewer-B", 1, [finding("B1", "major", "h1", 2, 6)]);
    expect(classifyAgreement(a, b).outcome).toBe("disagree");
  });

  test("no overlapping hunk -> disagree", () => {
    const a = record("f.php", "reviewer-A", 1, [finding("A1", "major", "h1", 2, 4)]);
    const b = record("f.php", "reviewer-B", 1, [finding("B1", "major", "h2", 2, 4)]);
    expect(classifyAgreement(a, b).outcome).toBe("disagree");
  });

  test("finding without evidence cannot match -> disagree", () => {
    const noEvidence: Finding = { finding_id: "A1", severity: "major", summary: "s", evidence: null };
    const a = record("f.php", "reviewer-A", 1, [noEvidence]);
    const b = record("f.php", "reviewer-B", 1, [finding("B1", "major", "h1", 2, 4)]);
    expect(classifyAgreement(a, b).outcome).toBe("disagree");
  });

  test("one-sided (exactly one empty) -> disagree", () => {
    const a = record("f.php", "reviewer-A", 1, [finding("A1", "nit", "h1", 1, 2)]);
    const b = record("f.php", "reviewer-B", 1, []);
    const result = classifyAgreement(a, b);
    expect(result.outcome).toBe("disagree");
    expect(result.reason).toContain("one-sided");
    expect(result.reason).toContain("reviewer-A");
  });

  test("any record missing -> unreviewed", () => {
    const a = record("f.php", "reviewer-A", 1, []);
    expect(classifyAgreement(a, null).outcome).toBe("unreviewed");
    expect(classifyAgreement(null, a).outcome).toBe("unreviewed");
    expect(classifyAgreement(null, null).outcome).toBe("unreviewed");
  });

  test("findingsMatch requires same severity and overlapping span", () => {
    expect(findingsMatch(finding("a", "major", "h1", 1, 5), finding("b", "major", "h1", 4, 9))).toBe(true);
    expect(findingsMatch(finding("a", "major", "h1", 1, 5), finding("b", "minor", "h1", 1, 5))).toBe(false);
  });
});

describe("agreementByFileRound (grouping)", () => {
  test("groups by file+round, sorted output, mixed outcomes", () => {
    const records = [
      record("b.php", "reviewer-B", 1, []),
      record("a.php", "reviewer-A", 2, [finding("A1", "major", "h1", 1, 3)]),
      record("a.php", "reviewer-A", 1, []),
      record("b.php", "reviewer-A", 1, []),
      record("a.php", "reviewer-B", 2, [finding("B1", "major", "h1", 2, 3)]),
      record("a.php", "reviewer-B", 1, []),
    ];
    const out = agreementByFileRound(records);
    expect(out.map((r) => `${r.file}#${r.round}:${r.outcome}`)).toEqual([
      "a.php#1:agree-clean",
      "a.php#2:agree",
      "b.php#1:agree-clean",
    ]);
  });

  test("a group with only one record is unreviewed and surfaced", () => {
    const out = agreementByFileRound([record("f.php", "reviewer-A", 1, [])]);
    expect(out.length).toBe(1);
    expect(out[0]?.outcome).toBe("unreviewed");
    expect(out[0]?.reason).toContain("found 1");
  });

  test("a group with three records is unreviewed, not silently paired", () => {
    const out = agreementByFileRound([
      record("f.php", "reviewer-A", 1, []),
      record("f.php", "reviewer-B", 1, []),
      record("f.php", "reviewer-C", 1, []),
    ]);
    expect(out[0]?.outcome).toBe("unreviewed");
    expect(out[0]?.reason).toContain("found 3");
  });
});
