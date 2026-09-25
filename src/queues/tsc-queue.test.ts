/**
 * Unit tests for src/queues/tsc-queue.ts — standalone, assert-based.
 * Run: bun run src/queues/tsc-queue.test.ts
 */

import {
  buildTscQueueState,
  emptyBurnDown,
  parseTscOutput,
  parseTscQueueState,
  recordBurnDown,
  type BurnDownSeries,
  type TscQueueState,
} from "./tsc-queue.js";
import { TSC_SAMPLE_1, TSC_SAMPLE_2, TSC_SAMPLE_3 } from "./testdata/tsc-fixtures.js";
import { assertEquals, assertTrue, runTestFile } from "./testkit.js";

runTestFile("tsc-queue", {
  "parses sample 1: records, fields, continuation, summary ignored": () => {
    const errors = parseTscOutput(TSC_SAMPLE_1);
    assertEquals(errors.length, 4, "four errors in sample 1");

    const first = errors[0]!;
    assertEquals(first.file, "src/services/user-service.ts");
    assertEquals(first.line, 12);
    assertEquals(first.column, 3);
    assertEquals(first.code, "TS2304");
    assertTrue(
      first.message.includes("mysqli_query"),
      "first message kept",
    );

    // Multi-line detail lines join into the TS2345 record.
    const assignable = errors[1]!;
    assertEquals(assignable.code, "TS2345");
    assertTrue(
      assignable.message.includes("Types of parameters"),
      "continuation line 1 appended",
    );
    assertTrue(
      assignable.message.includes("Type 'null' is not assignable"),
      "continuation line 2 appended",
    );
    assertTrue(
      assignable.raw.includes("\n  Types of parameters"),
      "raw keeps original lines as evidence",
    );

    // "Found 4 errors in 2 files." must not become a record.
    assertTrue(
      errors.every((e) => e.code.startsWith("TS")),
      "summary line ignored",
    );
  },

  "parses sample 2 and 3 (no summary line, various codes)": () => {
    const errors2 = parseTscOutput(TSC_SAMPLE_2);
    assertEquals(errors2.length, 5, "five errors in sample 2");

    const errors3 = parseTscOutput(TSC_SAMPLE_3);
    assertEquals(errors3.length, 1, "one error in sample 3");
    assertEquals(errors3[0]!.code, "TS18048");
  },

  "empty and noisy inputs yield no records": () => {
    assertEquals(parseTscOutput(""), [], "empty output");
    assertEquals(parseTscOutput("\n\n"), [], "blank lines only");
    assertEquals(parseTscOutput("Found 0 errors in 0 files."), [], "summary only");
  },

  "groups by error code and by file": () => {
    const state = parseTscQueueState(TSC_SAMPLE_2, 0);

    // byCode: TS2322 x2, TS7006 x3 — files sorted.
    assertEquals(state.byCode.length, 2);
    assertEquals(state.byCode[0], {
      code: "TS2322",
      count: 2,
      files: ["src/pricing/discount.ts", "src/pricing/tax.ts"],
    });
    const ts7006 = state.byCode.find((g) => g.code === "TS7006");
    assertEquals(ts7006?.count, 3);
    assertEquals(ts7006?.files, [
      "src/pricing/discount.ts",
      "tests/discount.test.ts",
    ]);

    // byFile: discount.ts x3, tax.ts x1, tests x1 — sorted by path.
    assertEquals(state.byFile.length, 3);
    assertEquals(state.byFile[0], {
      file: "src/pricing/discount.ts",
      count: 3,
      codes: ["TS2322", "TS7006"],
    });
    assertEquals(state.byFile[1], {
      file: "src/pricing/tax.ts",
      count: 1,
      codes: ["TS2322"],
    });
    assertEquals(state.byFile[2], {
      file: "tests/discount.test.ts",
      count: 1,
      codes: ["TS7006"],
    });

    assertEquals(state.total, 5);
  },

  "queue state is attribute-serializable (JSON round-trip)": () => {
    const state: TscQueueState = parseTscQueueState(TSC_SAMPLE_1, 3);
    const restored = JSON.parse(JSON.stringify(state)) as TscQueueState;
    assertEquals(restored, state, "JSON round-trip preserves state exactly");
  },

  "burn-down records counts per iteration and replaces repeats": () => {
    let series: BurnDownSeries = emptyBurnDown();
    assertEquals(series.entries, [], "starts empty");

    series = recordBurnDown(series, 0, 12);
    series = recordBurnDown(series, 1, 7);
    series = recordBurnDown(series, 2, 0);
    assertEquals(
      series.entries.map((e) => [e.iteration, e.errorCount]),
      [
        [0, 12],
        [1, 7],
        [2, 0],
      ],
    );

    // Re-running the queue step for iteration 1 replaces, never duplicates.
    series = recordBurnDown(series, 1, 5);
    assertEquals(series.entries.length, 3);
    assertEquals(series.entries[1], { iteration: 1, errorCount: 5 });
  },

  "buildTscQueueState on an empty error list produces an empty queue": () => {
    const state = buildTscQueueState([], 9);
    assertEquals(state.total, 0);
    assertEquals(state.errors, []);
    assertEquals(state.byCode, []);
    assertEquals(state.byFile, []);
    assertEquals(state.iteration, 9);
    assertEquals(state.kind, "tsc-queue");
  },
});
