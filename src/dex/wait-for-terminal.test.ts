/**
 * US-007 — typed failure classification in waitForFlowTerminal.
 *
 * The dex-sdk skill review (area 1.6, DRIFT S) flagged the old string
 * matching (`detail.includes("waiting exceeded the timeout")`,
 * `message.includes("14 UNAVAILABLE")`) as a violation of error-handling.md
 * §Client failures ("Do not compare human-readable detail for normal control
 * flow when a typed error exists"). The classification is now TYPED:
 * - LongPollTimeoutError → transient (the periodic long-poll wake-up);
 * - DexServiceError with gRPC UNAVAILABLE → transient (transport blip during
 *   the kill/resume window);
 * - anything else → rethrown immediately; anything past the deadline → thrown.
 *
 * The transient shapes are constructed from the installed 0.12.1 SDK classes
 * (verified: LongPollTimeoutError extends DexServiceError; waitForFlow
 * documents throwing LongPollTimeoutError).
 */

import { describe, expect, test } from "bun:test";

import { DexServiceError, ErrorSubStatus, LongPollTimeoutError } from "@superdurable/dex";
import type { FlowResult, FlowStatus } from "@superdurable/dex";
import { status } from "@grpc/grpc-js";

import { isTransientWaitError, waitForFlowTerminal } from "./wait-for-terminal.js";

function serviceErr(code: status, subStatus: keyof typeof ErrorSubStatus): DexServiceError {
  return new DexServiceError(
    code,
    ErrorSubStatus[subStatus],
    "server-side detail (never text-matched)",
    "waitForFlow",
    "cx-7",
  );
}

/**
 * A FlowResult in the REAL shape the installed SDK returns (flow-result.d.ts:
 * lowercase FlowStatus, isTerminal false only for running / continuedAsNew).
 * The old fakes used `{ status: "FLOW_STATUS_COMPLETED" }`, which is not a
 * FlowResult at all.
 */
function flowResult(flowStatus: FlowStatus, extra: Partial<FlowResult> = {}): FlowResult {
  return {
    status: flowStatus,
    errorType: undefined,
    errorMessage: undefined,
    isTerminal: flowStatus !== "running" && flowStatus !== "continuedAsNew",
    completions: [],
    singleOutput() {
      throw new TypeError("not used by these tests");
    },
    ...extra,
  };
}

/** Fake client: scripted outcomes per waitForFlow call. */
function fakeClient(outcomes: Array<{ ok?: FlowResult; err?: unknown }>): {
  client: { waitForFlow(flowId: string): Promise<FlowResult> };
  calls: () => number;
} {
  let n = 0;
  return {
    client: {
      waitForFlow: async () => {
        const outcome =
          outcomes[Math.min(n, outcomes.length - 1)] ?? { err: new Error("script exhausted") };
        n += 1;
        if (outcome.err !== undefined) throw outcome.err;
        return outcome.ok as FlowResult;
      },
    },
    calls: () => n,
  };
}

describe("waitForFlowTerminal typed classification (US-007)", () => {
  test("LongPollTimeoutError is retried until the flow completes", async () => {
    const runtime = fakeClient([
      { err: new LongPollTimeoutError(status.DEADLINE_EXCEEDED, ErrorSubStatus.LONG_POLL_TIMEOUT, "poll", "waitForFlow", "cx-7") },
      { err: new LongPollTimeoutError(status.DEADLINE_EXCEEDED, ErrorSubStatus.LONG_POLL_TIMEOUT, "poll", "waitForFlow", "cx-7") },
      { ok: flowResult("completed") },
    ]);
    const result = await waitForFlowTerminal(runtime, "cx-7", 60_000, 1);
    expect(result.status).toBe("completed");
    expect(result.isTerminal).toBe(true);
    expect(runtime.calls()).toBe(3);
  });

  test("a DexServiceError UNAVAILABLE (transport blip) is retried", async () => {
    const runtime = fakeClient([
      { err: serviceErr(status.UNAVAILABLE, "UNCATEGORIZED") },
      { ok: flowResult("terminated") },
    ]);
    const result = await waitForFlowTerminal(runtime, "cx-7", 60_000, 1);
    expect(result.status).toBe("terminated");
    expect(runtime.calls()).toBe(2);
  });

  test("a subStatus longPollTimeout service error typed as LongPollTimeoutError is the wake-up path", async () => {
    // The class check, not the text: LongPollTimeoutError instanceof chain.
    const err = new LongPollTimeoutError(
      status.DEADLINE_EXCEEDED,
      ErrorSubStatus.LONG_POLL_TIMEOUT,
      "waiting exceeded the timeout",
      "waitForFlow",
      "cx-7",
    );
    expect(err instanceof LongPollTimeoutError).toBe(true);
    expect(err instanceof DexServiceError).toBe(true);
    expect(err.subStatus).toBe("longPollTimeout");
    // ...and the helper actually treats it as the wake-up path (it is exercised,
    // not just constructed): one wake-up, then the flow completes.
    const runtime = fakeClient([{ err }, { ok: flowResult("completed") }]);
    const result = await waitForFlowTerminal(runtime, "cx-7", 60_000, 1);
    expect(result.status).toBe("completed");
    expect(runtime.calls()).toBe(2);
  });

  test("a NON-transient DexServiceError is rethrown immediately (no retry burn)", async () => {
    // gRPC INTERNAL with UNCATEGORIZED subStatus: a real failure, not a wake-up.
    const runtime = fakeClient([{ err: serviceErr(status.INTERNAL, "UNCATEGORIZED") }]);
    await expect(waitForFlowTerminal(runtime, "cx-7", 60_000, 1)).rejects.toBeInstanceOf(
      DexServiceError,
    );
    expect(runtime.calls()).toBe(1);
  });

  test("a non-service error is rethrown immediately (defects stay visible)", async () => {
    const boom = new TypeError("application bug");
    const runtime = fakeClient([{ err: boom }]);
    await expect(waitForFlowTerminal(runtime, "cx-7", 60_000, 1)).rejects.toBe(boom);
    expect(runtime.calls()).toBe(1);
  });

  test("deadline: transient failures past the bound throw the LAST error", async () => {
    const err = new LongPollTimeoutError(
      status.DEADLINE_EXCEEDED,
      ErrorSubStatus.LONG_POLL_TIMEOUT,
      "poll",
      "waitForFlow",
      "cx-7",
    );
    const runtime = fakeClient([{ err }]);
    await expect(waitForFlowTerminal(runtime, "cx-7", 5, 100)).rejects.toBe(err);
  });

  test("completion on the first call never retries", async () => {
    const done = flowResult("completed");
    const runtime = fakeClient([{ ok: done }]);
    const result = await waitForFlowTerminal(runtime, "cx-7", 60_000, 1);
    expect(result).toBe(done);
    expect(runtime.calls()).toBe(1);
  });
});

describe("waitForFlowTerminal returns the typed FlowResult (C33)", () => {
  test("failed / cancelled / terminated results are returned, not thrown, with their status and error detail", async () => {
    for (const s of ["failed", "cancelled", "terminated"] as const) {
      const failed = flowResult(s, { errorMessage: "step blew up" });
      const runtime = fakeClient([{ ok: failed }]);
      const result = await waitForFlowTerminal(runtime, "cx-7", 60_000, 1);
      expect(result.status).toBe(s);
      expect(result.isTerminal).toBe(true);
      expect(result.errorMessage).toBe("step blew up");
    }
  });

  test("a non-terminal result (continuedAsNew) is waited on again, not returned as if terminal", async () => {
    const runtime = fakeClient([
      { ok: flowResult("continuedAsNew") },
      { ok: flowResult("running") },
      { ok: flowResult("completed") },
    ]);
    const result = await waitForFlowTerminal(runtime, "cx-7", 60_000, 1);
    expect(result.status).toBe("completed");
    expect(runtime.calls()).toBe(3);
  });

  test("a non-terminal result at the deadline is returned as-is (isTerminal false) for the caller to report", async () => {
    const runtime = fakeClient([{ ok: flowResult("continuedAsNew") }]);
    const result = await waitForFlowTerminal(runtime, "cx-7", 5, 10);
    expect(result.isTerminal).toBe(false);
    expect(result.status).toBe("continuedAsNew");
  });

  test("isTransientWaitError classifies only the two typed transient failures", () => {
    expect(
      isTransientWaitError(
        new LongPollTimeoutError(status.DEADLINE_EXCEEDED, ErrorSubStatus.LONG_POLL_TIMEOUT, "poll", "waitForFlow", "cx-7"),
      ),
    ).toBe(true);
    expect(isTransientWaitError(serviceErr(status.UNAVAILABLE, "UNCATEGORIZED"))).toBe(true);
    expect(isTransientWaitError(serviceErr(status.INTERNAL, "UNCATEGORIZED"))).toBe(false);
    expect(isTransientWaitError(new Error("14 UNAVAILABLE"))).toBe(false); // never text-matched
  });
});
