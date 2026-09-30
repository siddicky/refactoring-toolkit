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
  composePrepGenerateTurn,
  composePrepReviseTurn,
  DIFF_HEADER_LINES,
  extractCodeFence,
  extractJsonObject,
  extractSpecMap,
  fenceFor,
  mapVerdictToMetrics,
  parseUnifiedDiff,
  specMapProblems,
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

// ---------------------------------------------------------------------------
// C13 — reply extractors: nested fences, truncated specs, brace-y prose
// ---------------------------------------------------------------------------

const SPEC_HEAD = [
  "# Porting spec",
  "",
  "## 1. Source map",
  "| PHP file | Port target |",
  "|---|---|",
  "| `src/Money.php` | `src/money.ts` |",
  "| `src/Invoice.php` | `src/invoice.ts` |",
  "",
  "## 2. Examples",
].join("\n");

const SPEC_TAIL = ["", "## 3. Known traps", "1. rounding is half away from zero"].join("\n");

/** A planner reply: ```markdown spec containing a nested fenced example. */
function specReply(nestedLang: string, outerFence = "```"): string {
  return [
    "Here is the revised spec map.",
    "",
    `${outerFence}markdown`,
    SPEC_HEAD,
    "```" + nestedLang,
    nestedLang === "php" ? "<?php echo round($a + $b);" : "const total: number = a + b;",
    "```",
    SPEC_TAIL,
    outerFence,
    "",
    "SUMMARY: kept the table, added an example.",
  ].join("\n");
}

const FULL_SPEC = (nestedLang: string): string =>
  [
    SPEC_HEAD,
    "```" + nestedLang,
    nestedLang === "php" ? "<?php echo round($a + $b);" : "const total: number = a + b;",
    "```",
    SPEC_TAIL,
  ].join("\n") + "\n";

describe("C13: extractSpecMap returns the OUTERMOST markdown block", () => {
  test("a nested ```typescript example no longer wins over the ```markdown spec", () => {
    const spec = extractSpecMap(specReply("typescript"), { expectedFiles: ["src/Money.php", "src/Invoice.php"] });
    expect(spec).toBe(FULL_SPEC("typescript"));
  });

  test("a nested ```php example no longer truncates the spec at the first inner fence", () => {
    const spec = extractSpecMap(specReply("php"));
    expect(spec).toBe(FULL_SPEC("php"));
    expect(spec).toContain("## 3. Known traps");
  });

  test("a four-backtick outer fence (the requested reply format) is honored", () => {
    const spec = extractSpecMap(specReply("typescript", "````"));
    expect(spec).toBe(FULL_SPEC("typescript"));
  });

  test("a reply with no closing outer fence is rejected instead of yielding a nested block", () => {
    const truncated = specReply("typescript").split("\n").slice(0, -4).join("\n"); // drop outer closer + SUMMARY
    expect(() => extractSpecMap(truncated)).toThrow();
  });

  test("a spec that lost its source-map table is rejected", () => {
    const noTable = ["```markdown", "# Porting spec", "just prose, no table", "```"].join("\n");
    expect(() => extractSpecMap(noTable)).toThrow(/source-map/);
    expect(specMapProblems("prose only")).toEqual(["no source-map table (no `|` table rows)"]);
  });

  test("a spec whose table lacks a file the run ports is rejected", () => {
    const partial = ["```markdown", SPEC_HEAD.replace("| `src/Invoice.php` | `src/invoice.ts` |\n", ""), "```"].join("\n");
    expect(() => extractSpecMap(partial, { expectedFiles: ["src/Money.php", "src/Invoice.php"] })).toThrow(/src\/Invoice\.php/);
    expect(extractSpecMap(partial, { expectedFiles: ["src/Money.php"] })).toContain("src/Money.php");
  });
});

describe("C13: extractCodeFence is fence-length aware", () => {
  test("nested ``` lines inside a longer outer fence stay part of the block", () => {
    const reply = [
      "````typescript",
      "const doc = `",
      "```",
      "inner",
      "```",
      "`;",
      "````",
      "SUMMARY: ok",
    ].join("\n");
    expect(extractCodeFence(reply, ".ts")).toBe("const doc = `\n```\ninner\n```\n`;\n");
  });

  test("ordinary replies still work (typescript preferred, bare fence, no fence throws)", () => {
    expect(extractCodeFence("x\n```typescript\nexport const x = 1;\n```\nSUMMARY: y", ".ts")).toBe("export const x = 1;\n");
    expect(extractCodeFence("```\nconst y = 2;\n```")).toBe("const y = 2;\n");
    expect(() => extractCodeFence("no fence")).toThrow();
  });

  test("fenceFor picks a fence longer than any backtick run in the content", () => {
    expect(fenceFor("plain text")).toBe("```");
    expect(fenceFor("a\n```php\nx\n```\n")).toBe("````");
    expect(fenceFor("````md\n```\n````")).toBe("`````");
  });
});

describe("C13: extractJsonObject tries every { start position", () => {
  test("prose with a brace pair before the JSON no longer hides the object", () => {
    expect(extractJsonObject('Here is the result {see above}: {"a":1}')).toEqual({ a: 1 });
  });

  test("an unbalanced { in the prose is skipped", () => {
    expect(extractJsonObject('note: use { carefully. {"findings": []}')).toEqual({ findings: [] });
  });

  test("fenced JSON and pure prose behave as before", () => {
    expect(extractJsonObject('```json\n{"a": {"b": "}"}}\n```')).toEqual({ a: { b: "}" } });
    expect(() => extractJsonObject("no json here {still none}")).toThrow(/no parseable JSON object/);
  });
});

describe("C13: prep turns ask for a long outer fence and fence embedded markdown safely", () => {
  test("generate + revise turns request a four-backtick outer fence", () => {
    const gen = composePrepGenerateTurn({
      phpFiles: [{ name: "src/Money.php", source: "<?php class Money {}" }],
      symbolTableText: "| Symbol |",
      stubPrepBaseline: "# stub",
    });
    const rev = composePrepReviseTurn({ specMapText: "# spec", findings: [] });
    for (const turn of [gen, rev]) {
      expect(turn).toContain("````markdown");
      expect(turn).toContain("FOUR backticks");
    }
  });

  test("an embedded baseline/spec that contains ``` fences is wrapped in a longer fence", () => {
    const withFences = "# stub\n```php\n<?php echo 1;\n```\n";
    const gen = composePrepGenerateTurn({
      phpFiles: [],
      symbolTableText: "t",
      stubPrepBaseline: withFences,
    });
    expect(gen).toContain("````markdown\n" + withFences + "\n````");
    const rev = composePrepReviseTurn({ specMapText: withFences, findings: [] });
    expect(rev).toContain("````markdown\n" + withFences + "\n````");
  });
});
