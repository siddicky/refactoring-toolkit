/**
 * Phase 2 core-loop unit suites: the pure derivations of
 * flows/port-project.ts plus the runtime bridge (src/harness/runtime.ts).
 * All offline — the live trial is the gate, these pin the deterministic
 * parts (diff parsing/rendering, JSON + code extraction, verdict intake and
 * mapping, dispatch derivation, prep source-map parsing).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DIFF_HEADER_LINES,
  extractCodeFence,
  extractJsonObject,
  mapVerdictToMetrics,
  parseUnifiedDiff,
  renderDiffForReview,
  resolveEvidence,
} from "../src/harness/runtime.js";
import {
  deriveNext,
  markerKeyOf,
  parsePrepSourceMap,
  verdictKeyOf,
  type PortQueueState,
} from "../flows/port-project.js";

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

const SAMPLE_DIFF = `diff --git a/src/money.ts b/src/money.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/money.ts
@@ -0,0 +1,4 @@
+export class Money {
+  constructor(readonly cents: number) {}
+  add(other: Money): Money {
+    return new Money(this.cents + other.cents);
+  }
+}`;

describe("parseUnifiedDiff + renderDiffForReview", () => {
  test("extracts hunks with stable h1..hN ids and correct spans", () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF);
    expect(parsed.hunks.length).toBe(1);
    const h1 = parsed.hunks[0];
    expect(h1?.hunk_id).toBe("h1");
    expect(h1?.new_start).toBe(1);
    expect(h1?.new_lines).toBe(4);
    // Body: file headers are NOT hunk lines; only the +/- lines are.
    expect(h1?.lines.every((l) => /^[+\- ]/.test(l))).toBe(true);
  });

  test("rendered block offsets match DIFF_HEADER_LINES; evidence resolves to h1", () => {
    const rendered = renderDiffForReview({
      diffText: SAMPLE_DIFF,
      file: "src/Money.php",
      round: 1,
      diffId: "diff-x-r1",
    });
    const lines = rendered.block.split("\n");
    expect(lines[0]).toContain("DIFF_ID: diff-x-r1");
    expect(DIFF_HEADER_LINES).toBe(5);

    const parsed = parseUnifiedDiff(SAMPLE_DIFF);
    // The line "+  constructor(readonly cents: number) {}" is body line 10
    // (6 header lines of the diff body + line 4 of the added content is
    // body line 9; reviewer cites BLOCK lines, we subtract the offset).
    const blockLine = DIFF_HEADER_LINES + parsed.lines.indexOf("+  add(other: Money): Money {") + 1;
    const evidence = resolveEvidence(
      { start_line: blockLine, end_line: blockLine, snippet: "add(other: Money): Money" },
      parsed,
      DIFF_HEADER_LINES,
    );
    expect(evidence).not.toBeNull();
    expect(evidence?.hunk_id).toBe("h1");
    expect(evidence?.quote).toBe("add(other: Money): Money");
  });

  test("evidence outside the diff resolves to null (uncitable)", () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF);
    const evidence = resolveEvidence(
      { start_line: 1, end_line: 1, snippet: "DROP TABLE users" },
      parsed,
      DIFF_HEADER_LINES,
    );
    expect(evidence).toBeNull();
  });
});

describe("extractJsonObject / extractCodeFence", () => {
  test("extracts fenced JSON, bare JSON, and prose-wrapped JSON", () => {
    const fenced = '```json\n{"a": 1}\n```';
    expect(extractJsonObject(fenced)).toEqual({ a: 1 });
    const prose = 'Here is my verdict:\n{"findings": [], "note": "clean"} — done.';
    expect(extractJsonObject(prose)).toEqual({ findings: [], note: "clean" });
    const nested = '{"a": {"b": "}"},"c": 2}';
    expect(extractJsonObject(nested)).toEqual({ a: { b: "}" }, c: 2 });
  });

  test("throws when no JSON object exists (caller retries, never invents)", () => {
    expect(() => extractJsonObject("no json here")).toThrow();
  });

  test("extractCodeFence prefers typescript fences and normalizes trailing newline", () => {
    const reply = "SUMMARY below.\n```typescript\nexport const x = 1;\n```";
    expect(extractCodeFence(reply, ".ts")).toBe("export const x = 1;\n");
    const plain = "```\nconst y = 2;\n```";
    expect(extractCodeFence(plain)).toBe("const y = 2;\n");
    expect(() => extractCodeFence("no fence")).toThrow();
  });
});

describe("verdict intake: validate + map onto metrics shapes", () => {
  const raw = {
    file: "IGNORED",
    reviewer: "IGNORED",
    round: -1,
    diff_id: "IGNORED",
    findings: [
      {
        finding_id: "F1",
        severity: "blocker",
        description: "add() drops the currency check, so mixed-currency sums silently succeed",
        evidence_span: { start_line: 9, end_line: 10, snippet: "add(other: Money): Money" },
        disposition: "fix",
      },
      {
        finding_id: "F2",
        severity: "nit",
        description: "naming nit on a line that is not part of this diff",
        evidence_span: { start_line: 1, end_line: 1, snippet: "not in the diff at all" },
        disposition: "wontfix",
      },
    ],
    citation_check: [{ finding_id: "F1", p_cited: 0.9 }],
  };

  test("identity fields are forced from pipeline values; evidence is hunk-resolved", () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF);
    const mapped = mapVerdictToMetrics({
      raw,
      file: "src/Money.php",
      reviewer: "reviewer-A",
      round: 2,
      diffId: "diff-x-r2",
      parsedDiff: parsed,
      bodyLineOffset: DIFF_HEADER_LINES,
      naiveCited: (f) => (f.finding_id === "F1" ? 1 : 0),
    });
    if (!mapped.ok) throw new Error(mapped.errors.join("; "));
    expect(mapped.record.file).toBe("src/Money.php");
    expect(mapped.record.reviewer).toBe("reviewer-A");
    expect(mapped.record.round).toBe(2);
    expect(mapped.record.diff_id).toBe("diff-x-r2");

    const f1 = mapped.record.findings.find((f) => f.finding_id === "F1");
    expect(f1?.evidence?.hunk_id).toBe("h1");
    expect(f1?.evidence?.quote).toBe("add(other: Money): Money");
    // C12: the summary is the reviewer's description, never the disposition.
    expect(f1?.summary).toBe("add() drops the currency check, so mixed-currency sums silently succeed");
    expect(f1?.summary).not.toBe("fix");
    // C14: the mapped record carries the DETERMINISTIC citation check; the
    // model's self-reported 0.9 is advisory (agentRecord only) and never shown
    // as if the gate had computed it.
    expect(mapped.record.citation_check.find((c) => c.finding_id === "F1")?.p_cited).toBe(1);
    expect(mapped.record.citation_check.find((c) => c.finding_id === "F2")?.p_cited).toBe(0);
    expect(mapped.agentRecord.citation_check.find((c) => c.finding_id === "F1")?.p_cited).toBe(0.9);
  });

  test("structurally invalid verdicts are rejected with all errors", () => {
    const parsed = parseUnifiedDiff(SAMPLE_DIFF);
    const mapped = mapVerdictToMetrics({
      raw: { findings: "many" },
      file: "f",
      reviewer: "r",
      round: 1,
      diffId: "d",
      parsedDiff: parsed,
      bodyLineOffset: DIFF_HEADER_LINES,
      naiveCited: () => 0,
    });
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.errors.length).toBeGreaterThan(0);
  });
});

describe("dispatch derivation over the durable queue", () => {
  const empty: PortQueueState = { pending: [], current: null, done: [], blocked: [] };

  test("starts the first pending file at round 1", () => {
    const action = deriveNext({ ...empty, pending: ["a.php", "b.php"] }, 1);
    expect(action).toEqual({ kind: "start", file: "a.php" });
  });

  test("resumes an in-flight file-round after a kill (idempotent)", () => {
    const action = deriveNext(
      { ...empty, current: { file: "a.php", round: 1, epoch: 2 } },
      1,
    );
    expect(action).toEqual({ kind: "resume", file: "a.php", round: 1, epoch: 2 });
  });

  test("blocks when the round cap is exceeded", () => {
    const action = deriveNext(
      { ...empty, current: { file: "a.php", round: 2, epoch: 1 } },
      1,
    );
    expect(action.kind).toBe("blocked");
    const fresh = deriveNext({ ...empty, pending: ["a.php"] }, 0);
    expect(fresh.kind).toBe("blocked");
  });

  test("done when nothing pending and nothing current", () => {
    expect(deriveNext(empty, 1).kind).toBe("done");
  });

  test("attribute keys are slash-free per AttributeMap rules", () => {
    expect(markerKeyOf("src/Pricing/FlatRateDiscount.php", 1)).toBe(
      "src__Pricing__FlatRateDiscount.php#1",
    );
    expect(verdictKeyOf("src/Money.php", 2, "reviewer-A")).toBe("src__Money.php#2#reviewer-A");
  });
});

describe("prep source-map parsing (stub-prep.md table)", () => {
  test("parses php→ts rows, ignores headers and test globs", async () => {
    dir = await mkdtemp(join(tmpdir(), "porting-kit-prep-"));
    const prepPath = join(dir, "stub-prep.md");
    await writeFile(
      prepPath,
      [
        "# PORTING PREP",
        "| PHP file | Proposed port target | Notes |",
        "|---|---|---|",
        "| `src/Money.php` | `src/money.ts` | value object; needs shared round helper |",
        "| `src/Pricing/FlatRateDiscount.php` | `src/pricing/flat-rate-discount.ts` | |",
        "| `tests/*.php` | `test/*.test.ts` | PHPUnit asserts → vitest |",
        "",
      ].join("\n"),
      "utf8",
    );
    const raw = await readFile(prepPath, "utf8");
    const map = parsePrepSourceMap(raw);
    expect(map["src/Money.php"]?.outPath).toBe("src/money.ts");
    expect(map["src/Money.php"]?.notes).toContain("round helper");
    expect(map["src/Pricing/FlatRateDiscount.php"]?.outPath).toBe(
      "src/pricing/flat-rate-discount.ts",
    );
    expect(map["tests/*.php"]).toBeUndefined(); // not a .php source row
  });
});
