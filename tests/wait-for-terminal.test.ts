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
import { status } from "@grpc/grpc-js";

import { waitForFlowTerminal } from "../src/dex/wait-for-terminal.js";

function serviceErr(code: status, subStatus: keyof typeof ErrorSubStatus): DexServiceError {
  return new DexServiceError(
    code,
    ErrorSubStatus[subStatus],
    "server-side detail (never text-matched)",
    "waitForFlow",
    "cx-7",
  );
}

/** Fake client: scripted outcomes per waitForFlow call. */
function fakeClient(outcomes: Array<{ ok?: unknown; err?: unknown }>): {
  client: { waitForFlow(flowId: string): Promise<unknown> };
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
        return outcome.ok;
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
      { ok: { status: "FLOW_STATUS_COMPLETED" } },
    ]);
    const result = await waitForFlowTerminal(runtime, "cx-7", 60_000, 1);
    expect(result).toEqual({ status: "FLOW_STATUS_COMPLETED" });
    expect(runtime.calls()).toBe(3);
  });

  test("a DexServiceError UNAVAILABLE (transport blip) is retried", async () => {
    const runtime = fakeClient([
      { err: serviceErr(status.UNAVAILABLE, "UNCATEGORIZED") },
      { ok: "terminal" },
    ]);
    const result = await waitForFlowTerminal(runtime, "cx-7", 60_000, 1);
    expect(result).toBe("terminal");
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
    const runtime = fakeClient([{ ok: "done" }]);
    const result = await waitForFlowTerminal(runtime, "cx-7", 60_000, 1);
    expect(result).toBe("done");
    expect(runtime.calls()).toBe(1);
  });
});
