/**
 * Unit tests for src/queues/tsc-queue.ts — standalone, assert-based.
 * Run: bun run src/queues/tsc-queue.test.ts
 */

import {
  buildTscQueueState,
  capErrorsPerFile,
  emptyBurnDown,
  parseTscDiagnostics,
  parseTscOutput,
  parseTscQueueState,
  recordBurnDown,
  tscOutcomeFromRun,
  type BurnDownSeries,
  type TscProcessRun,
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

  "C06: global (file-less) diagnostics are counted, never glued onto a located record": () => {
    const output = [
      "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "error TS18003: No inputs were found in config file '/itg/tsconfig.json'. Specified 'include' paths were [\"src/**/*.ts\"]",
      "error TS2688: Cannot find type definition file for 'nonexistent-types'.",
      "  The file is in the program because:",
      "    Entry point for implicit type library 'nonexistent-types'",
      "",
    ].join("\n");
    const parsed = parseTscDiagnostics(output);
    assertEquals(parsed.errors.length, 1, "one located record");
    assertEquals(
      parsed.errors[0]!.message,
      "Type 'string' is not assignable to type 'number'.",
      "the global line does not become a continuation of the located record",
    );
    assertEquals(parsed.unlocated.map((u) => u.code), ["TS18003", "TS2688"]);
    assertTrue(
      parsed.unlocated[1]!.message.includes("Entry point for implicit type library"),
      "indented detail lines attach to the global diagnostic",
    );
    assertEquals(parseTscOutput(output).length, 1, "parseTscOutput stays located-only");
  },

  "C06: CRLF output parses like LF output": () => {
    const crlf = "src/a.ts(1,2): error TS2304: Cannot find name 'x'.\r\n  detail\r\nerror TS5083: Cannot read file 'nope.json'.\r\n";
    const parsed = parseTscDiagnostics(crlf);
    assertEquals(parsed.errors.length, 1);
    assertEquals(parsed.errors[0]!.message, "Cannot find name 'x'.\n  detail");
    assertEquals(parsed.unlocated.length, 1);
  },

  "C06: tscOutcomeFromRun never reads a failed tsc as a clean typecheck": () => {
    const run = (over: Partial<TscProcessRun>): TscProcessRun => ({
      output: "",
      exitCode: 0,
      signal: null,
      killed: false,
      errorCode: null,
      timeoutMs: 180_000,
      ...over,
    });

    // TS18003 (no inputs): exit 2, zero located diagnostics -> NOT-RUN.
    const noInputs = tscOutcomeFromRun(
      run({ exitCode: 2, output: "error TS18003: No inputs were found in config file '/itg/tsconfig.json'.\n" }),
    );
    assertEquals(noInputs.errors.length, 0);
    assertEquals(noInputs.accounting.state, "not-run");
    assertEquals(noInputs.accounting.exit_code, 2);
    assertEquals(noInputs.accounting.unlocated, 1);
    assertTrue(
      (noInputs.accounting.reason ?? "").startsWith("tsc exited 2 with no located diagnostics: error TS18003: No inputs were found"),
      `reason names exit code and first global diagnostic, got ${noInputs.accounting.reason}`,
    );

    // TS5083 unreadable tsconfig.
    const unreadable = tscOutcomeFromRun(run({ exitCode: 2, output: "error TS5083: Cannot read file '/itg/nope.json'.\n" }));
    assertEquals(unreadable.accounting.state, "not-run");

    // Non-zero exit and completely empty output.
    const empty = tscOutcomeFromRun(run({ exitCode: 1, output: "" }));
    assertEquals(empty.accounting.state, "not-run");
    assertTrue((empty.accounting.reason ?? "").includes("no output"), "empty output is named");

    // Missing binary: spawn error, no exit code.
    const enoent = tscOutcomeFromRun(run({ exitCode: null, errorCode: "ENOENT", output: "\n" }));
    assertEquals(enoent.accounting, {
      state: "not-run",
      reason: "tsc binary not found (ENOENT)",
      exit_code: null,
      unlocated: 0,
    });

    // Timeout kill, even with partial located output.
    const timedOut = tscOutcomeFromRun(
      run({ exitCode: null, killed: true, signal: "SIGTERM", timeoutMs: 180_000, output: "src/a.ts(1,1): error TS2304: x\n" }),
    );
    assertEquals(timedOut.accounting.state, "not-run");
    assertEquals(timedOut.accounting.reason, "tsc timed out after 180s");

    // External signal (not our timeout).
    const signalled = tscOutcomeFromRun(run({ exitCode: null, signal: "SIGKILL" }));
    assertEquals(signalled.accounting.reason, "tsc terminated by SIGKILL");

    // Buffer overflow is a spawn-level failure, not a timeout.
    const overflow = tscOutcomeFromRun(
      run({ exitCode: null, killed: true, errorCode: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
    );
    assertTrue((overflow.accounting.reason ?? "").includes("capture buffer"), "maxBuffer named");

    // Honest RAN paths: exit 0 with no output is a genuine clean typecheck...
    const clean = tscOutcomeFromRun(run({ exitCode: 0, output: "" }));
    assertEquals(clean.accounting, { state: "ran", reason: null, exit_code: 0, unlocated: 0 });
    // ...and exit 2 with located diagnostics is a real error count (plus the global ones seen).
    const errorsFound = tscOutcomeFromRun(
      run({
        exitCode: 2,
        output: "src/a.ts(1,1): error TS2304: Cannot find name 'x'.\nerror TS2688: Cannot find type definition file for 'y'.\n",
      }),
    );
    assertEquals(errorsFound.errors.length, 1);
    assertEquals(errorsFound.accounting, { state: "ran", reason: null, exit_code: 2, unlocated: 1 });
  },

  "C05: capErrorsPerFile caps each file, not the whole list, and keeps order": () => {
    const errs = [
      ...Array.from({ length: 5 }, (_, i) => ({ file: "src/a.ts", n: i })),
      { file: "./src/b.ts", n: 0 },
      { file: "src/b.ts", n: 1 },
      { file: "./src/b.ts", n: 2 },
      { file: "src/c.ts", n: 0 },
    ];
    const kept = capErrorsPerFile(errs, 2);
    assertEquals(
      kept.map((e) => `${e.file}#${e.n}`),
      ["src/a.ts#0", "src/a.ts#1", "./src/b.ts#0", "src/b.ts#1", "src/c.ts#0"],
      "a.ts capped at 2; b.ts (with and without ./) shares one budget; c.ts is never starved",
    );
    assertEquals(capErrorsPerFile([], 2), []);
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
