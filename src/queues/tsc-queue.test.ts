/**
 * Unit tests for src/queues/tsc-queue.ts.
 */

import { describe, expect, test } from "bun:test";
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
import { TSC_SAMPLE_1, TSC_SAMPLE_2, TSC_SAMPLE_3 } from "./fixtures/tsc-fixtures.js";

describe("tsc-queue", () => {
  test("parses sample 1: records, fields, continuation, summary ignored", () => {
    const errors = parseTscOutput(TSC_SAMPLE_1);
    expect(errors.length).toBe(4);

    const first = errors[0]!;
    expect(first.file).toBe("src/services/user-service.ts");
    expect(first.line).toBe(12);
    expect(first.column).toBe(3);
    expect(first.code).toBe("TS2304");
    expect(first.message).toContain("mysqli_query");

    // Multi-line detail lines join into the TS2345 record.
    const assignable = errors[1]!;
    expect(assignable.code).toBe("TS2345");
    expect(assignable.message).toContain("Types of parameters");
    expect(assignable.message).toContain("Type 'null' is not assignable");
    // raw keeps original lines as evidence
    expect(assignable.raw).toContain("\n  Types of parameters");

    // "Found 4 errors in 2 files." must not become a record.
    expect(errors.every((e) => e.code.startsWith("TS"))).toBe(true);
  });

  test("parses sample 2 and 3 (no summary line, various codes)", () => {
    const errors2 = parseTscOutput(TSC_SAMPLE_2);
    expect(errors2.length).toBe(5);

    const errors3 = parseTscOutput(TSC_SAMPLE_3);
    expect(errors3.length).toBe(1);
    expect(errors3[0]!.code).toBe("TS18048");
  });

  test("empty and noisy inputs yield no records", () => {
    expect(parseTscOutput("")).toStrictEqual([]);
    // blank lines only
    expect(parseTscOutput("\n\n")).toStrictEqual([]);
    // summary only
    expect(parseTscOutput("Found 0 errors in 0 files.")).toStrictEqual([]);
  });

  test("groups by error code and by file", () => {
    const state = parseTscQueueState(TSC_SAMPLE_2, 0);

    // byCode: TS2322 x2, TS7006 x3 — files sorted.
    expect(state.byCode.length).toBe(2);
    expect(state.byCode[0]).toStrictEqual({
      code: "TS2322",
      count: 2,
      files: ["src/pricing/discount.ts", "src/pricing/tax.ts"],
    });
    const ts7006 = state.byCode.find((g) => g.code === "TS7006");
    expect(ts7006?.count).toBe(3);
    expect(ts7006?.files).toStrictEqual([
      "src/pricing/discount.ts",
      "tests/discount.test.ts",
    ]);

    // byFile: discount.ts x3, tax.ts x1, tests x1 — sorted by path.
    expect(state.byFile.length).toBe(3);
    expect(state.byFile[0]).toStrictEqual({
      file: "src/pricing/discount.ts",
      count: 3,
      codes: ["TS2322", "TS7006"],
    });
    expect(state.byFile[1]).toStrictEqual({
      file: "src/pricing/tax.ts",
      count: 1,
      codes: ["TS2322"],
    });
    expect(state.byFile[2]).toStrictEqual({
      file: "tests/discount.test.ts",
      count: 1,
      codes: ["TS7006"],
    });

    expect(state.total).toBe(5);
  });

  test("queue state is attribute-serializable (JSON round-trip)", () => {
    const state: TscQueueState = parseTscQueueState(TSC_SAMPLE_1, 3);
    const restored = JSON.parse(JSON.stringify(state)) as TscQueueState;
    // JSON round-trip preserves state exactly
    expect(restored).toStrictEqual(state);
  });

  test("burn-down records counts per iteration and replaces repeats", () => {
    let series: BurnDownSeries = emptyBurnDown();
    expect(series.entries).toStrictEqual([]);

    series = recordBurnDown(series, 0, 12);
    series = recordBurnDown(series, 1, 7);
    series = recordBurnDown(series, 2, 0);
    expect(series.entries.map((e) => [e.iteration, e.errorCount])).toStrictEqual([
      [0, 12],
      [1, 7],
      [2, 0],
    ]);

    // Re-running the queue step for iteration 1 replaces, never duplicates.
    series = recordBurnDown(series, 1, 5);
    expect(series.entries.length).toBe(3);
    expect(series.entries[1]).toStrictEqual({ iteration: 1, errorCount: 5 });
  });

  test("C06: global (file-less) diagnostics are counted, never glued onto a located record", () => {
    const output = [
      "src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      "error TS18003: No inputs were found in config file '/itg/tsconfig.json'. Specified 'include' paths were [\"src/**/*.ts\"]",
      "error TS2688: Cannot find type definition file for 'nonexistent-types'.",
      "  The file is in the program because:",
      "    Entry point for implicit type library 'nonexistent-types'",
      "",
    ].join("\n");
    const parsed = parseTscDiagnostics(output);
    // one located record, and the global line does not become a continuation of it
    expect(parsed.errors.length).toBe(1);
    expect(parsed.errors[0]!.message).toBe("Type 'string' is not assignable to type 'number'.");
    expect(parsed.unlocated.map((u) => u.code)).toStrictEqual(["TS18003", "TS2688"]);
    // indented detail lines attach to the global diagnostic
    expect(parsed.unlocated[1]!.message).toContain("Entry point for implicit type library");
    // parseTscOutput stays located-only
    expect(parseTscOutput(output).length).toBe(1);
  });

  test("C06: CRLF output parses like LF output", () => {
    const crlf = "src/a.ts(1,2): error TS2304: Cannot find name 'x'.\r\n  detail\r\nerror TS5083: Cannot read file 'nope.json'.\r\n";
    const parsed = parseTscDiagnostics(crlf);
    expect(parsed.errors.length).toBe(1);
    expect(parsed.errors[0]!.message).toBe("Cannot find name 'x'.\n  detail");
    expect(parsed.unlocated.length).toBe(1);
  });

  test("C06: tscOutcomeFromRun never reads a failed tsc as a clean typecheck", () => {
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
    expect(noInputs.errors.length).toBe(0);
    expect(noInputs.accounting.state).toBe("not-run");
    expect(noInputs.accounting.exit_code).toBe(2);
    expect(noInputs.accounting.unlocated).toBe(1);
    // reason names exit code and first global diagnostic
    expect((noInputs.accounting.reason ?? "").startsWith("tsc exited 2 with no located diagnostics: error TS18003: No inputs were found")).toBe(true);

    // TS5083 unreadable tsconfig.
    const unreadable = tscOutcomeFromRun(run({ exitCode: 2, output: "error TS5083: Cannot read file '/itg/nope.json'.\n" }));
    expect(unreadable.accounting.state).toBe("not-run");

    // Non-zero exit and completely empty output.
    const empty = tscOutcomeFromRun(run({ exitCode: 1, output: "" }));
    expect(empty.accounting.state).toBe("not-run");
    expect(empty.accounting.reason ?? "").toContain("no output");

    // Missing binary: spawn error, no exit code.
    const enoent = tscOutcomeFromRun(run({ exitCode: null, errorCode: "ENOENT", output: "\n" }));
    expect(enoent.accounting).toStrictEqual({
      state: "not-run",
      reason: "tsc binary not found (ENOENT)",
      exit_code: null,
      unlocated: 0,
    });

    // Timeout kill, even with partial located output.
    const timedOut = tscOutcomeFromRun(
      run({ exitCode: null, killed: true, signal: "SIGTERM", timeoutMs: 180_000, output: "src/a.ts(1,1): error TS2304: x\n" }),
    );
    expect(timedOut.accounting.state).toBe("not-run");
    expect(timedOut.accounting.reason).toBe("tsc timed out after 180s");

    // External signal (not our timeout).
    const signalled = tscOutcomeFromRun(run({ exitCode: null, signal: "SIGKILL" }));
    expect(signalled.accounting.reason).toBe("tsc terminated by SIGKILL");

    // Buffer overflow is a spawn-level failure, not a timeout.
    const overflow = tscOutcomeFromRun(
      run({ exitCode: null, killed: true, errorCode: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" }),
    );
    expect(overflow.accounting.reason ?? "").toContain("capture buffer");

    // Honest RAN paths: exit 0 with no output is a genuine clean typecheck...
    const clean = tscOutcomeFromRun(run({ exitCode: 0, output: "" }));
    expect(clean.accounting).toStrictEqual({ state: "ran", reason: null, exit_code: 0, unlocated: 0 });
    // ...and exit 2 with located diagnostics is a real error count (plus the global ones seen).
    const errorsFound = tscOutcomeFromRun(
      run({
        exitCode: 2,
        output: "src/a.ts(1,1): error TS2304: Cannot find name 'x'.\nerror TS2688: Cannot find type definition file for 'y'.\n",
      }),
    );
    expect(errorsFound.errors.length).toBe(1);
    expect(errorsFound.accounting).toStrictEqual({ state: "ran", reason: null, exit_code: 2, unlocated: 1 });
  });

  test("C05: capErrorsPerFile caps each file, not the whole list, and keeps order", () => {
    const errs = [
      ...Array.from({ length: 5 }, (_, i) => ({ file: "src/a.ts", n: i })),
      { file: "./src/b.ts", n: 0 },
      { file: "src/b.ts", n: 1 },
      { file: "./src/b.ts", n: 2 },
      { file: "src/c.ts", n: 0 },
    ];
    const kept = capErrorsPerFile(errs, 2);
    // a.ts capped at 2; b.ts (with and without ./) shares one budget; c.ts is never starved
    expect(kept.map((e) => `${e.file}#${e.n}`)).toStrictEqual([
      "src/a.ts#0",
      "src/a.ts#1",
      "./src/b.ts#0",
      "src/b.ts#1",
      "src/c.ts#0",
    ]);
    expect(capErrorsPerFile([], 2)).toStrictEqual([]);
  });

  test("buildTscQueueState on an empty error list produces an empty queue", () => {
    const state = buildTscQueueState([], 9);
    expect(state.total).toBe(0);
    expect(state.errors).toStrictEqual([]);
    expect(state.byCode).toStrictEqual([]);
    expect(state.byFile).toStrictEqual([]);
    expect(state.iteration).toBe(9);
    expect(state.kind).toBe("tsc-queue");
  });
});
