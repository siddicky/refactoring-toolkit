/**
 * C33 — run-demo's wait commands report the flow OUTCOME in their exit code.
 *
 * Before: `demo` and `wait-flow` printed "completed: <json>" and exited 0 for
 * ANY terminal status (failed / cancelled / terminated / blocked files), while
 * a healthy flow still running when --wait-minutes elapsed was reported as
 * `[run-demo] fatal:` (exit 1). hello / long-step / round called waitForFlow
 * directly and skipped the typed transient retry.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { ErrorSubStatus, LongPollTimeoutError } from "@superdurable/dex";
import type { FlowResult, FlowStatus, StepCompletion } from "@superdurable/dex";
import { status as grpcStatus } from "@grpc/grpc-js";

import {
  EXIT_FLOW_FAILED,
  EXIT_STILL_RUNNING,
  EXIT_UNRESOLVED,
  decodePortRunResult,
  flowOutcome,
  waitAndReport,
} from "../scripts/run-demo.js";
import type { PortRunResult } from "../flows/port-project.js";

function completion(stepType: string, payload: unknown): StepCompletion {
  return {
    stepType,
    stepExecutionId: `${stepType}#1`,
    decode<T>() {
      return payload as T;
    },
  };
}

function flowResult(
  flowStatus: FlowStatus,
  completions: StepCompletion[] = [],
  extra: Partial<FlowResult> = {},
): FlowResult {
  return {
    status: flowStatus,
    errorType: undefined,
    errorMessage: undefined,
    isTerminal: flowStatus !== "running" && flowStatus !== "continuedAsNew",
    completions,
    singleOutput() {
      throw new TypeError("unused");
    },
    ...extra,
  };
}

function portResult(over: Partial<PortRunResult> = {}): PortRunResult {
  return {
    completed: [],
    blocked: [],
    verification: { iteration: 1, tscTotal: 0, vitestTotal: 0, vitestNote: null, vitestRun: null },
    ...over,
  };
}

const origLog = console.log;
const origError = console.error;
afterEach(() => {
  console.log = origLog;
  console.error = origError;
});

function silence(): { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  console.log = (...a: unknown[]) => void out.push(a.join(" "));
  console.error = (...a: unknown[]) => void err.push(a.join(" "));
  return { out, err };
}

describe("flowOutcome", () => {
  test("failed / cancelled / terminated are a non-zero exit with the error detail (never 'completed')", () => {
    for (const s of ["failed", "cancelled", "terminated"] as const) {
      const o = flowOutcome("demo", "f1", flowResult(s, [], { errorMessage: "boom" }));
      expect(o.code).toBe(EXIT_FLOW_FAILED);
      expect(o.lines.join("\n")).toContain(`status=${s}`);
      expect(o.lines.join("\n")).toContain("boom");
      expect(o.lines.join("\n")).not.toContain("completed:");
    }
  });

  test("a clean completed port run exits 0 and prints the decoded PortRunResult", () => {
    const payload = portResult({ completed: [{ file: "src/A.php", round: 1, commitSha: "abc", treeHash: "def" }] });
    const o = flowOutcome("demo", "f1", flowResult("completed", [completion("PpFinal", payload)]));
    expect(o.code).toBe(0);
    expect(o.lines[0]).toContain("completed=1 blocked=0 tsc=0 vitest=0");
    expect(o.lines.join("\n")).toContain('"commitSha":"abc"');
  });

  test("completed with blocked files or failing verification exits 3 and says work remains", () => {
    const blocked = portResult({ blocked: [{ file: "src/B.php", round: 2, reason: "round cap 1 exceeded" }] });
    const o1 = flowOutcome("demo", "f1", flowResult("completed", [completion("PpFinal", blocked)]));
    expect(o1.code).toBe(EXIT_UNRESOLVED);
    expect(o1.lines[0]).toContain("blocked=1");
    expect(o1.lines[0]).toContain("unresolved work remains");

    const tsc = portResult({
      verification: { iteration: 2, tscTotal: 4, vitestTotal: 0, vitestNote: null, vitestRun: null },
    });
    expect(flowOutcome("demo", "f1", flowResult("completed", [completion("PpFinal", tsc)])).code).toBe(EXIT_UNRESOLVED);

    const vitest = portResult({
      verification: { iteration: 2, tscTotal: 0, vitestTotal: 3, vitestNote: null, vitestRun: null },
    });
    expect(flowOutcome("demo", "f1", flowResult("completed", [completion("PpFinal", vitest)])).code).toBe(
      EXIT_UNRESOLVED,
    );
  });

  test("a non-terminal result reports 'still running' with the wait-flow hint and the distinct code", () => {
    const o = flowOutcome("demo", "f1", flowResult("continuedAsNew"));
    expect(o.code).toBe(EXIT_STILL_RUNNING);
    expect(o.lines[0]).toContain("wait-flow --id f1");
  });

  test("a completed non-port flow (probe) is exit 0 with its result summary", () => {
    const o = flowOutcome("hello", "h1", flowResult("completed", [completion("ProbeHello", { ok: true })]));
    expect(o.code).toBe(0);
    expect(o.lines[0]).toContain("status=completed");
    expect(decodePortRunResult(flowResult("completed", [completion("ProbeHello", {})]))).toBeUndefined();
  });
});

describe("waitAndReport", () => {
  test("returns the outcome's exit code and prints failures on stderr", async () => {
    const { out, err } = silence();
    const runtime = { client: { waitForFlow: async () => flowResult("failed", [], { errorMessage: "step failed" }) } };
    expect(await waitAndReport(runtime, "f1", 1, "demo", 1)).toBe(EXIT_FLOW_FAILED);
    expect(out).toEqual([]);
    expect(err.join("\n")).toContain("step failed");
  });

  test("a long-poll timeout past the deadline is 'flow still running' (exit 4), not a fatal error", async () => {
    const { err } = silence();
    const timeout = new LongPollTimeoutError(
      grpcStatus.DEADLINE_EXCEEDED,
      ErrorSubStatus.LONG_POLL_TIMEOUT,
      "poll",
      "waitForFlow",
      "f1",
    );
    const runtime = {
      client: {
        waitForFlow: async (): Promise<FlowResult> => {
          throw timeout;
        },
      },
    };
    // waitMinutes 0 => the deadline has already passed after the first timeout.
    expect(await waitAndReport(runtime, "f1", 0, "demo", 1)).toBe(EXIT_STILL_RUNNING);
    expect(err.join("\n")).toContain("flow still running");
    expect(err.join("\n")).toContain("wait-flow --id f1");
    expect(err.join("\n")).toContain("do not re-dispatch");
  });

  test("any other error stays fatal (rethrown)", async () => {
    silence();
    const runtime = {
      client: {
        waitForFlow: async (): Promise<FlowResult> => {
          throw new TypeError("application bug");
        },
      },
    };
    await expect(waitAndReport(runtime, "f1", 1, "demo", 1)).rejects.toThrow("application bug");
  });
});
