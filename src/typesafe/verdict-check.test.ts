import { describe, expect, test } from "bun:test";
import {
  createCitationChecker,
  diffText,
  jevCitationCheck,
  naiveCitationCheck,
  normalizeForMatch,
} from "./verdict-check.js";
import { createInMemoryJevClient } from "./client.js";
import type { DiffDocument, Finding, VerdictRecord } from "../metrics/types.js";

const diff: DiffDocument = {
  diff_id: "diff-1",
  file: "src/Util/Counter.php",
  base_ref: "abc123",
  hunks: [
    {
      hunk_id: "h1",
      header: "@@ -1,4 +1,5 @@",
      old_start: 1,
      old_lines: 4,
      new_start: 1,
      new_lines: 5,
      lines: [
        "+use App\\Legacy\\Logger;",
        " function countItems(array $items): int",
        "-    return 0;",
        "+    $total = 0;",
        "+    foreach ($items as $item) {",
      ],
    },
    {
      hunk_id: "h2",
      header: "@@ -20,3 +21,4 @@",
      old_start: 20,
      old_lines: 3,
      new_start: 21,
      new_lines: 4,
      lines: ["+    return $total;", "+}"],
    },
  ],
};

function verdictWith(findings: Finding[]): VerdictRecord {
  return {
    file: diff.file,
    reviewer: "reviewer-A",
    round: 1,
    diff_id: diff.diff_id,
    findings,
    citation_check: [],
  };
}

describe("normalizeForMatch / diffText", () => {
  test("strips +/- markers and trims each line", () => {
    expect(normalizeForMatch("+  hello \n-  world \n context ")).toBe("hello\nworld\ncontext");
  });
  test("diffText joins all hunks in order", () => {
    expect(diffText(diff)).toContain("function countItems(array $items): int");
    expect(diffText(diff)).toContain("$total = 0;\nforeach ($items as $item) {\nreturn $total;");
  });
});

describe("naiveCitationCheck (code-only, deterministic)", () => {
  test("cited quote present in the diff -> p_cited 1", () => {
    const v = verdictWith([
      {
        finding_id: "F1",
        severity: "major",
        summary: "removed early return",
        evidence: { hunk_id: "h1", start_line: 3, end_line: 3, quote: "return 0;" },
      },
    ]);
    expect(naiveCitationCheck(v, diff)).toEqual([{ finding_id: "F1", p_cited: 1 }]);
  });

  test("multiline quote spanning +/- lines -> p_cited 1", () => {
    const v = verdictWith([
      {
        finding_id: "F2",
        severity: "major",
        summary: "rewritten accumulation",
        evidence: {
          hunk_id: "h1",
          start_line: 3,
          end_line: 5,
          quote: "$total = 0;\nforeach ($items as $item) {",
        },
      },
    ]);
    expect(naiveCitationCheck(v, diff)[0]?.p_cited).toBe(1);
  });

  test("quote absent from the diff -> p_cited 0", () => {
    const v = verdictWith([
      {
        finding_id: "F3",
        severity: "blocker",
        summary: "hallucinated evidence",
        evidence: { hunk_id: "h1", start_line: 1, end_line: 2, quote: "$db->query('DROP TABLE');" },
      },
    ]);
    expect(naiveCitationCheck(v, diff)).toEqual([{ finding_id: "F3", p_cited: 0 }]);
  });

  test("finding without evidence -> p_cited 0", () => {
    const v = verdictWith([{ finding_id: "F4", severity: "nit", summary: "vague", evidence: null }]);
    expect(naiveCitationCheck(v, diff)).toEqual([{ finding_id: "F4", p_cited: 0 }]);
  });

  test("claimed hunk missing from the diff -> p_cited 0 even if text matches", () => {
    const v = verdictWith([
      {
        finding_id: "F5",
        severity: "minor",
        summary: "wrong hunk reference",
        evidence: { hunk_id: "hX", start_line: 1, end_line: 1, quote: "return 0;" },
      },
    ]);
    expect(naiveCitationCheck(v, diff)[0]?.p_cited).toBe(0);
  });
});

describe("jevCitationCheck (batched nouls over shared diff state)", () => {
  test("one systemOne request for all evidence-bearing findings; output preserves order", async () => {
    const v = verdictWith([
      {
        finding_id: "F1",
        severity: "major",
        summary: "a",
        evidence: { hunk_id: "h1", start_line: 3, end_line: 3, quote: "return 0;" },
      },
      {
        finding_id: "F2",
        severity: "major",
        summary: "b",
        evidence: { hunk_id: "h1", start_line: 4, end_line: 4, quote: "$total = 0;" },
      },
      { finding_id: "F3", severity: "nit", summary: "no evidence", evidence: null },
    ]);
    const client = createInMemoryJevClient((request) => {
      expect(Object.keys(request.questions).sort()).toEqual(["F1", "F2"]);
      return { F1: { type: "noul", noul: 0.9 }, F2: { type: "noul", noul: 0.2 } };
    });
    const result = await jevCitationCheck(client, v, diff);
    expect(result).toEqual([
      { finding_id: "F1", p_cited: 0.9 },
      { finding_id: "F2", p_cited: 0.2 },
      { finding_id: "F3", p_cited: 0 },
    ]);
    expect(client.callCount).toBe(1);
  });

  test("no evidence-bearing findings -> no model call at all", async () => {
    const v = verdictWith([{ finding_id: "F9", severity: "nit", summary: "vague", evidence: null }]);
    const client = createInMemoryJevClient(() => {
      throw new Error("must not be called");
    });
    expect(await jevCitationCheck(client, v, diff)).toEqual([{ finding_id: "F9", p_cited: 0 }]);
    expect(client.callCount).toBe(0);
  });
});

describe("createCitationChecker (naive-first swap-in seam)", () => {
  test("no client -> naive checker; with client -> jev checker", async () => {
    const naive = createCitationChecker();
    expect(naive.kind).toBe("naive");

    const v = verdictWith([
      {
        finding_id: "F1",
        severity: "major",
        summary: "a",
        evidence: { hunk_id: "h1", start_line: 3, end_line: 3, quote: "return 0;" },
      },
    ]);
    expect(await naive.check(v, diff)).toEqual([{ finding_id: "F1", p_cited: 1 }]);

    const jevClient = createInMemoryJevClient(() => ({
      F1: { type: "noul", noul: 0.7 },
    }));
    const jev = createCitationChecker(jevClient);
    expect(jev.kind).toBe("jev");
    expect(await jev.check(v, diff)).toEqual([{ finding_id: "F1", p_cited: 0.7 }]);
  });
});
