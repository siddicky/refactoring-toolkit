/**
 * Regression tests for the agent/prompt/schema contract audit clusters owned
 * by team T4b (C11-C16, C18, C21, C23, C75). One describe block per cluster;
 * every block fails on the pre-fix code and passes on the fixed code.
 */

import { describe, expect, test } from "bun:test";

import { evaluateSuspicion } from "../src/metrics/suspicion.js";
import type { Finding, VerdictRecord } from "../src/metrics/types.js";
import {
  composeFixerTurn,
  DIFF_HEADER_LINES,
  mapVerdictToMetrics,
  parseUnifiedDiff,
} from "../src/harness/runtime.js";

// ---------------------------------------------------------------------------
// C11 — hunk body ranges are 1-based: last body line inside, @@ line outside
// ---------------------------------------------------------------------------

/** Three hunks; raw (1-based) line numbers annotated on the right. */
const MULTI_HUNK_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts", //  1
  "index 1111111..2222222 100644", //      2
  "--- a/src/a.ts", //                     3
  "+++ b/src/a.ts", //                     4
  "@@ -1,3 +1,3 @@", //                   5  (h1 header)
  " line1", //                             6  (h1 first body line)
  "-old", //                               7
  "+new", //                               8  (h1 last body line)
  "@@ -10,2 +10,3 @@", //                 9  (h2 header)
  " ctx", //                              10  (h2 first body line)
  "+added", //                            11
  " tail", //                             12  (h2 last body line)
  "@@ -20,1 +21,2 @@", //                13  (h3 header)
  " x", //                                14  (h3 first body line)
  "+last", //                             15  (h3 last body line)
].join("\n");

function evidence(hunkId: string, start: number, end: number): Finding["evidence"] {
  return { hunk_id: hunkId, start_line: start, end_line: end, quote: "q" };
}

function recordWith(findings: Finding[]): VerdictRecord {
  return {
    file: "src/a.ts",
    reviewer: "reviewer-A",
    round: 1,
    diff_id: "d1",
    findings,
    citation_check: findings.map((f) => ({ finding_id: f.finding_id, p_cited: 1 })),
  };
}

function suspectReasons(hunkId: string, start: number, end: number): string[] {
  const parsedDiff = parseUnifiedDiff(MULTI_HUNK_DIFF);
  return evaluateSuspicion({
    record: recordWith([{ finding_id: "F1", severity: "major", summary: "s", evidence: evidence(hunkId, start, end) }]),
    parsedDiff,
    verdictText: "{}",
    priorNormalizedText: null,
  }).reasons;
}

describe("C11: hunk body ranges use 1-based bounds", () => {
  const parsed = parseUnifiedDiff(MULTI_HUNK_DIFF);

  test("parseUnifiedDiff.hunkIdForBodyLine: header lines are outside, every body line is inside", () => {
    const expected: Array<[number, string | undefined]> = [
      [4, undefined], // +++ file header
      [5, undefined], // @@ h1
      [6, "h1"], // first body line of the first hunk
      [8, "h1"], // LAST body line of the first hunk
      [9, undefined], // @@ h2
      [10, "h2"], // first body line of a middle hunk
      [12, "h2"], // LAST body line of a middle hunk
      [13, undefined], // @@ h3
      [14, "h3"], // first body line of the last hunk
      [15, "h3"], // LAST body line of the last hunk (end of diff)
      [16, undefined], // past the end
    ];
    for (const [line, hunk] of expected) {
      expect([line, parsed.hunkIdForBodyLine(line)]).toEqual([line, hunk]);
    }
  });

  test("suspicion arm (a): first and last body line of first/middle/last hunks are NOT suspect", () => {
    for (const [hunk, first, last] of [
      ["h1", 6, 8],
      ["h2", 10, 12],
      ["h3", 14, 15],
    ] as const) {
      expect([hunk, "first", suspectReasons(hunk, first, first)]).toEqual([hunk, "first", []]);
      expect([hunk, "last", suspectReasons(hunk, last, last)]).toEqual([hunk, "last", []]);
      expect([hunk, "whole", suspectReasons(hunk, first, last)]).toEqual([hunk, "whole", []]);
    }
  });

  test("suspicion arm (a): a span on the @@ header line is suspect, and so is a span straddling two hunks", () => {
    expect(suspectReasons("h1", 5, 6)).toEqual(["span-outside-diff:F1"]);
    expect(suspectReasons("h2", 9, 9)).toEqual(["span-outside-diff:F1"]);
    expect(suspectReasons("h3", 13, 14)).toEqual(["span-outside-diff:F1"]);
    // last body line of h1 through the first body line of h2 crosses the @@ line
    expect(suspectReasons("h1", 8, 10)).toEqual(["span-outside-diff:F1"]);
  });

  test("reviewer block numbering: block line = DIFF_HEADER_LINES + raw line", () => {
    // The resolver subtracts DIFF_HEADER_LINES; a reviewer citing the last body
    // line of the whole diff (raw 15 -> block 20) must resolve into h3.
    expect(parsed.hunkIdForBodyLine(20 - DIFF_HEADER_LINES)).toBe("h3");
  });
});

// ---------------------------------------------------------------------------
// C12 + C14 — verdict intake: description -> summary, required snippet,
// closed disposition enum, advisory citation_check
// ---------------------------------------------------------------------------

const MONEY_DIFF = [
  "diff --git a/src/money.ts b/src/money.ts",
  "new file mode 100644",
  "index 0000000..e69de29",
  "--- /dev/null",
  "+++ b/src/money.ts",
  "@@ -0,0 +1,4 @@",
  "+export class Money {",
  "+  constructor(readonly cents: number) {}",
  "+  add(other: Money): Money {",
  "+    return new Money(this.cents + other.cents);",
  "+  }",
  "+}",
].join("\n");

function rawFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    finding_id: "F1",
    severity: "major",
    description: "add() ignores the currency, so USD + EUR silently sums cents",
    evidence_span: { start_line: DIFF_HEADER_LINES + 10, end_line: DIFF_HEADER_LINES + 10, snippet: "return new Money(this.cents + other.cents);" },
    disposition: "fix",
    ...overrides,
  };
}

function mapRaw(raw: unknown, naive: (f: Finding) => number = () => 1) {
  return mapVerdictToMetrics({
    raw,
    file: "src/Money.php",
    reviewer: "reviewer-A",
    round: 1,
    diffId: "diff-1",
    parsedDiff: parseUnifiedDiff(MONEY_DIFF),
    bodyLineOffset: DIFF_HEADER_LINES,
    naiveCited: naive,
  });
}

describe("C12: Finding.summary carries the defect description, not the disposition", () => {
  test("summary is the reviewer's description and differs from the disposition", () => {
    const mapped = mapRaw({ findings: [rawFinding()] });
    if (!mapped.ok) throw new Error(mapped.errors.join("; "));
    const f = mapped.record.findings[0];
    expect(f?.summary).toBe("add() ignores the currency, so USD + EUR silently sums cents");
    expect(f?.summary).not.toBe(mapped.agentRecord.findings[0]?.disposition);
    expect(f?.evidence?.quote).toBe("return new Money(this.cents + other.cents);");
  });

  test("a finding with no description is rejected (the field is required)", () => {
    const { description: _description, ...noDescription } = rawFinding();
    const mapped = mapRaw({ findings: [noDescription] });
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.errors.join("; ")).toContain("description");
  });

  test("composeFixerTurn hands the fixer the description, not `(fix)`", () => {
    const mapped = mapRaw({ findings: [rawFinding()] });
    if (!mapped.ok) throw new Error(mapped.errors.join("; "));
    const turn = composeFixerTurn({
      currentContent: "export class Money {}",
      findings: mapped.record.findings,
      outputPath: "src/money.ts",
    });
    expect(turn).toContain("[major] F1: add() ignores the currency, so USD + EUR silently sums cents");
    expect(turn).toContain("evidence: return new Money(this.cents + other.cents);");
    expect(turn).not.toContain("(fix)");
  });
});

describe("C14: verdict schema vs prompt vs gate", () => {
  test("a finding without a snippet is invalid (snippet is required, not silently dropped later)", () => {
    const mapped = mapRaw({
      findings: [rawFinding({ evidence_span: { start_line: DIFF_HEADER_LINES + 10, end_line: DIFF_HEADER_LINES + 10 } })],
    });
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.errors.join("; ")).toContain("snippet");
  });

  test("disposition is normalized: \"Fix\" is kept by the gate's exact `fix` match, junk is rejected", () => {
    const mapped = mapRaw({ findings: [rawFinding({ disposition: "Fix" }), rawFinding({ finding_id: "F2", disposition: "won't fix" })] });
    if (!mapped.ok) throw new Error(mapped.errors.join("; "));
    expect(mapped.agentRecord.findings.map((f) => f.disposition)).toEqual(["fix", "wontfix"]);

    const junk = mapRaw({ findings: [rawFinding({ disposition: "someday" })] });
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.errors.join("; ")).toContain("fix | wontfix");
  });

  test("a malformed citation_check no longer discards the verdict; the record shows the deterministic check", () => {
    const mapped = mapRaw(
      {
        findings: [rawFinding()],
        citation_check: [{ finding_id: "NOPE", p_cited: 7 }, "garbage", { finding_id: "F1", p_cited: 0.2 }],
      },
      () => 1,
    );
    if (!mapped.ok) throw new Error(mapped.errors.join("; "));
    // self-report (0.2) is advisory and kept only on the agent record ...
    expect(mapped.agentRecord.citation_check).toEqual([{ finding_id: "F1", p_cited: 0.2 }]);
    // ... the metrics record (what the report renders) is the gate-equivalent check
    expect(mapped.record.citation_check).toEqual([{ finding_id: "F1", p_cited: 1 }]);
  });

  test("a verdict with no citation_check at all is valid", () => {
    const mapped = mapRaw({ findings: [rawFinding()] });
    expect(mapped.ok).toBe(true);
  });
});
