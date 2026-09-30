/**
 * Unit tests for src/queues/vitest-queue.ts — standalone, assert-based.
 * Run: bun run src/queues/vitest-queue.test.ts
 */

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
import { assertEquals, assertTrue, runTestFile } from "./testkit.js";

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

runTestFile("vitest-queue", {
  "parses failing tests into records with name, message, and frames": () => {
    const failures = parseVitestOutput(VITEST_SAMPLE);
    assertEquals(failures.length, 2, "two FAIL blocks");

    const first = failures[0]!;
    assertEquals(first.testFile, "tests/discount.test.ts");
    assertEquals(first.testName, "PriceCalculator > applies member discount");
    assertTrue(
      first.errorMessage.startsWith("AssertionError: expected 100 to be 90"),
      "error message captured",
    );
    assertTrue(
      first.errorMessage.includes("+ Received"),
      "diff block kept in message",
    );
    assertEquals(first.frames.length, 3, "three stack frames");
    assertEquals(first.frames[0], {
      file: "tests/discount.test.ts",
      line: 18,
      column: 26,
    });
    assertEquals(first.frames[1], {
      file: "src/pricing/discount.ts",
      line: 41,
      column: 5,
    });

    const second = failures[1]!;
    assertEquals(second.testName, "PriceCalculator > rejects negative price");
    assertEquals(second.errorMessage, "Error: price must be positive");
    assertEquals(second.frames[0]!.file, "src/pricing/discount.ts");
  },

  "ignores per-file summary bullets and ANSI escapes": () => {
    // The `×` bullet WITHOUT a " > " separator must not spawn a record; the
    // full FAIL block is the authoritative record.
    const failures = parseVitestOutput(VITEST_SAMPLE);
    assertEquals(failures.length, 2);

    const ansiSample = "\x1b[31m FAIL \x1b[0m tests/a.test.ts > suite > t\nError: boom\n";
    const parsed = parseVitestOutput(ansiSample);
    assertEquals(parsed.length, 1, "ANSI-stripped FAIL line still starts a record");
    assertEquals(parsed[0]!.testFile, "tests/a.test.ts");
  },

  "C26: bullets never start records, FAIL blocks do (no duplicates when streams merge)": () => {
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
    assertEquals(records.length, 1, "one FAIL block = one record");
    assertEquals(records[0]!.testName, "Suite > case");
    assertEquals(records[0]!.frames.length, 2, "frames survive");
    assertEquals(records[0]!.errorMessage, "AssertionError: expected 1 to be 2", "banner/footer rules stay out of the message");
    // Bullets alone (the stdout-only shape the flow used to parse) carry no record.
    assertEquals(parseVitestOutput("   × Suite > case 3ms\n     → expected 1 to be 2\n"), []);
  },

  "C26: summary lines are anchored (Failed Tests banner / FAIL header cannot overwrite them)": () => {
    const merged = [
      " Test Files  1 failed (1)",
      "      Tests  1 failed | 2 passed (3)",
      "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯",
      " FAIL  tests/a.test.ts > Tests > x",
      "Error: boom",
    ].join("\n");
    const summary = parseVitestSummary(merged);
    assertEquals(summary?.tests, { passed: 2, failed: 1, total: 3 });
    assertEquals(summary?.testFiles, { passed: 0, failed: 1, total: 1 });
    // ANSI-colored summary lines still anchor once escapes are stripped.
    const colored = "\x1b[2m Test Files \x1b[22m \x1b[31m1 failed\x1b[39m (1)\n\x1b[2m      Tests \x1b[22m \x1b[31m1 failed\x1b[39m | 2 passed (3)\n";
    assertEquals(parseVitestSummary(colored)?.tests, { passed: 2, failed: 1, total: 3 });
  },

  "C26: a collection-failure header drops the `[ file ]` suffix": () => {
    const records = parseVitestOutput(
      [
        " FAIL  tests/broken.test.ts [ tests/broken.test.ts ]",
        "Error: Cannot find module '../src/missing'",
        " ❯ tests/broken.test.ts:2:1",
        "",
      ].join("\n"),
    );
    assertEquals(records.length, 1);
    assertEquals(records[0]!.testFile, "tests/broken.test.ts");
    assertEquals(records[0]!.testName, "");
    assertEquals(records[0]!.frames, [{ file: "tests/broken.test.ts", line: 2, column: 1 }]);
    // A TEST name that merely ends in brackets keeps them.
    const named = parseVitestOutput(" FAIL  tests/a.test.ts > handles [ edge ]\nError: x\n");
    assertEquals(named[0]!.testName, "handles [ edge ]");
  },

  "empty and clean outputs yield no records": () => {
    assertEquals(parseVitestOutput(""), []);
    assertEquals(parseVitestOutput("Tests  3 passed (3)\n"), []);
  },

  "naive classifier: stack touching ported output is port-caused": () => {
    const classifier = createNaiveClassifier();
    const failures = parseVitestOutput(VITEST_SAMPLE);
    const result = classifier.classify(failures[0]!);
    assertEquals(result.failureClass, "port-caused");
    assertTrue(
      result.reason.includes("src/pricing/discount.ts"),
      "reason names the deciding frame",
    );
  },

  "naive classifier: fixture-only stack is fixture-problem": () => {
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
    assertEquals(result.failureClass, "fixture-problem");
    assertTrue(
      result.reason.includes("tests/setup.test.ts"),
      "reason names the fixture frame",
    );
  },

  "naive classifier: unknown roots fall back to configured class": () => {
    const unknownFailure: VitestFailureRecord = {
      testFile: "node_modules/.cache/gen.test.ts",
      testName: "gen > case",
      errorMessage: "Error: ?",
      frames: [{ file: "/opt/vendor/lib/gen.ts", line: 1, column: 1 }],
      raw: "",
    };
    assertEquals(
      createNaiveClassifier().classify(unknownFailure).failureClass,
      "port-caused",
      "default unknown fallback is port-caused",
    );
    assertEquals(
      createNaiveClassifier({ unknown: "fixture-problem" }).classify(unknownFailure)
        .failureClass,
      "fixture-problem",
      "unknown fallback is configurable",
    );
  },

  "custom classifier implementations satisfy the same interface": () => {
    const alwaysFixture: FailureClassification = {
      failureClass: "fixture-problem",
      attributedFile: "tests/discount.test.ts",
      reason: "policy override",
    };
    const classifier: FailureClassifier = { classify: () => alwaysFixture };
    const failures = parseVitestOutput(VITEST_SAMPLE);
    assertEquals(
      classifier.classify(failures[1]!).failureClass,
      "fixture-problem",
      "the FailureClassifier seam accepts any implementation",
    );
  },

  "queue state is attribute-serializable (JSON round-trip)": () => {
    const state: VitestQueueState = buildVitestQueueState(
      parseVitestOutput(VITEST_SAMPLE),
      2,
    );
    assertEquals(state.total, 2);
    assertEquals(state.iteration, 2);
    assertEquals(state.kind, "vitest-queue");
    const restored = JSON.parse(JSON.stringify(state)) as VitestQueueState;
    assertEquals(restored, state, "JSON round-trip preserves state exactly");
  },
});
