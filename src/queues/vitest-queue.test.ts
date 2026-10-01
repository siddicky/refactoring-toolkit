/**
 * Unit tests for src/queues/vitest-queue.ts.
 */

import { describe, expect, test } from "bun:test";
import {
  buildVitestQueueState,
  createNaiveClassifier,
  parseVitestOutput,
  parseVitestSummary,
  type FailureClassification,
  type FailureClassifier,
  type VitestFailureRecord,
  type VitestQueueState,
} from "./vitest-queue.js";

const VITEST_SAMPLE = `
 RUN  v3.2.4 /Users/dev/refactoring-toolkit

 ❯ tests/discount.test.ts (4 tests | 2 failed) 12ms
   × applies member discount 12ms
     → expected 100 to be 90

 FAIL  tests/discount.test.ts > PriceCalculator > applies member discount
AssertionError: expected 100 to be 90 // Object.is equality

- Expected
+ Received

- 90
+ 100

 ❯ tests/discount.test.ts:18:26
 ❯ src/pricing/discount.ts:41:5
 ❯ tests/discount.test.ts:22:18

 FAIL  tests/discount.test.ts > PriceCalculator > rejects negative price
Error: price must be positive
 ❯ src/pricing/discount.ts:29:11
 ❯ tests/discount.test.ts:30:16

 Test Files  1 failed (1)
      Tests  2 failed | 2 passed (4)
`;

describe("vitest-queue", () => {
  test("parses failing tests into records with name, message, and frames", () => {
    const failures = parseVitestOutput(VITEST_SAMPLE);
    // two FAIL blocks
    expect(failures.length).toBe(2);

    const first = failures[0]!;
    expect(first.testFile).toBe("tests/discount.test.ts");
    expect(first.testName).toBe("PriceCalculator > applies member discount");
    // error message captured, and the diff block is kept in it
    expect(first.errorMessage.startsWith("AssertionError: expected 100 to be 90")).toBe(true);
    expect(first.errorMessage).toContain("+ Received");
    // three stack frames
    expect(first.frames.length).toBe(3);
    expect(first.frames[0]).toStrictEqual({
      file: "tests/discount.test.ts",
      line: 18,
      column: 26,
    });
    expect(first.frames[1]).toStrictEqual({
      file: "src/pricing/discount.ts",
      line: 41,
      column: 5,
    });

    const second = failures[1]!;
    expect(second.testName).toBe("PriceCalculator > rejects negative price");
    expect(second.errorMessage).toBe("Error: price must be positive");
    expect(second.frames[0]!.file).toBe("src/pricing/discount.ts");
  });

  test("ignores per-file summary bullets and ANSI escapes", () => {
    // The `×` bullet WITHOUT a " > " separator must not spawn a record; the
    // full FAIL block is the authoritative record.
    const failures = parseVitestOutput(VITEST_SAMPLE);
    expect(failures.length).toBe(2);

    const ansiSample = "\x1b[31m FAIL \x1b[0m tests/a.test.ts > suite > t\nError: boom\n";
    const parsed = parseVitestOutput(ansiSample);
    // ANSI-stripped FAIL line still starts a record
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.testFile).toBe("tests/a.test.ts");
  });

  test("C26: bullets never start records, FAIL blocks do (no duplicates when streams merge)", () => {
    // vitest 3.x: per-file bullets (with a describe path) go to stdout, the
    // FAIL block to stderr; read together they must yield ONE record.
    const merged = [
      " ❯ tests/a.test.ts (1 test | 1 failed) 4ms",
      "   × Suite > case 3ms",
      "     → expected 1 to be 2",
      "",
      " Test Files  1 failed (1)",
      "      Tests  1 failed (1)",
      "",
      "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
      "",
      " FAIL  tests/a.test.ts > Suite > case",
      "AssertionError: expected 1 to be 2",
      " ❯ tests/a.test.ts:5:18",
      " ❯ src/a.ts:2:9",
      "",
      "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯",
      "",
    ].join("\n");
    const records = parseVitestOutput(merged);
    // one FAIL block = one record
    expect(records.length).toBe(1);
    expect(records[0]!.testName).toBe("Suite > case");
    // frames survive
    expect(records[0]!.frames.length).toBe(2);
    // banner/footer rules stay out of the message
    expect(records[0]!.errorMessage).toBe("AssertionError: expected 1 to be 2");
    // Bullets alone (the stdout-only shape the flow used to parse) carry no record.
    expect(parseVitestOutput("   × Suite > case 3ms\n     → expected 1 to be 2\n")).toStrictEqual([]);
  });

  test("C26: summary lines are anchored (Failed Tests banner / FAIL header cannot overwrite them)", () => {
    const merged = [
      " Test Files  1 failed (1)",
      "      Tests  1 failed | 2 passed (3)",
      "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
      " FAIL  tests/a.test.ts > Tests > x",
      "Error: boom",
    ].join("\n");
    const summary = parseVitestSummary(merged);
    expect(summary?.tests).toStrictEqual({ passed: 2, failed: 1, total: 3 });
    expect(summary?.testFiles).toStrictEqual({ passed: 0, failed: 1, total: 1 });
    // ANSI-colored summary lines still anchor once escapes are stripped.
    const colored = "\x1b[2m Test Files \x1b[22m \x1b[31m1 failed\x1b[39m (1)\n\x1b[2m      Tests \x1b[22m \x1b[31m1 failed\x1b[39m | 2 passed (3)\n";
    expect(parseVitestSummary(colored)?.tests).toStrictEqual({ passed: 2, failed: 1, total: 3 });
  });

  test("C26: a collection-failure header drops the `[ file ]` suffix", () => {
    const records = parseVitestOutput(
      [
        " FAIL  tests/broken.test.ts [ tests/broken.test.ts ]",
        "Error: Cannot find module '../src/missing'",
        " ❯ tests/broken.test.ts:2:1",
        "",
      ].join("\n"),
    );
    expect(records.length).toBe(1);
    expect(records[0]!.testFile).toBe("tests/broken.test.ts");
    expect(records[0]!.testName).toBe("");
    expect(records[0]!.frames).toStrictEqual([{ file: "tests/broken.test.ts", line: 2, column: 1 }]);
    // A TEST name that merely ends in brackets keeps them.
    const named = parseVitestOutput(" FAIL  tests/a.test.ts > handles [ edge ]\nError: x\n");
    expect(named[0]!.testName).toBe("handles [ edge ]");
  });

  test("empty and clean outputs yield no records", () => {
    expect(parseVitestOutput("")).toStrictEqual([]);
    expect(parseVitestOutput("Tests  3 passed (3)\n")).toStrictEqual([]);
  });

  test("naive classifier: stack touching ported output is port-caused", () => {
    const classifier = createNaiveClassifier();
    const failures = parseVitestOutput(VITEST_SAMPLE);
    const result = classifier.classify(failures[0]!);
    expect(result.failureClass).toBe("port-caused");
    // reason names the deciding frame
    expect(result.reason).toContain("src/pricing/discount.ts");
  });

  test("naive classifier: fixture-only stack is fixture-problem", () => {
    const classifier = createNaiveClassifier();
    const fixtureFailure: VitestFailureRecord = {
      testFile: "tests/setup.test.ts",
      testName: "harness > broken fixture",
      errorMessage: "Error: expected fixture value",
      frames: [
        { file: "tests/setup.test.ts", line: 9, column: 3 },
        { file: "fixtures/php-sample/loader.ts", line: 2, column: 1 },
      ],
      raw: "FAIL  tests/setup.test.ts > harness > broken fixture",
    };
    const result = classifier.classify(fixtureFailure);
    expect(result.failureClass).toBe("fixture-problem");
    // reason names the fixture frame
    expect(result.reason).toContain("tests/setup.test.ts");
  });

  test("naive classifier: unknown roots fall back to configured class", () => {
    const unknownFailure: VitestFailureRecord = {
      testFile: "node_modules/.cache/gen.test.ts",
      testName: "gen > case",
      errorMessage: "Error: ?",
      frames: [{ file: "/opt/vendor/lib/gen.ts", line: 1, column: 1 }],
      raw: "",
    };
    // default unknown fallback is port-caused
    expect(createNaiveClassifier().classify(unknownFailure).failureClass).toBe("port-caused");
    // unknown fallback is configurable
    expect(createNaiveClassifier({ unknown: "fixture-problem" }).classify(unknownFailure).failureClass).toBe(
      "fixture-problem",
    );
  });

  test("custom classifier implementations satisfy the same interface", () => {
    const alwaysFixture: FailureClassification = {
      failureClass: "fixture-problem",
      attributedFile: "tests/discount.test.ts",
      reason: "policy override",
    };
    const classifier: FailureClassifier = { classify: () => alwaysFixture };
    const failures = parseVitestOutput(VITEST_SAMPLE);
    // the FailureClassifier seam accepts any implementation
    expect(classifier.classify(failures[1]!).failureClass).toBe("fixture-problem");
  });

  test("queue state is attribute-serializable (JSON round-trip)", () => {
    const state: VitestQueueState = buildVitestQueueState(parseVitestOutput(VITEST_SAMPLE), 2);
    expect(state.total).toBe(2);
    expect(state.iteration).toBe(2);
    expect(state.kind).toBe("vitest-queue");
    const restored = JSON.parse(JSON.stringify(state)) as VitestQueueState;
    // JSON round-trip preserves state exactly
    expect(restored).toStrictEqual(state);
  });
});
