/**
 * C42 — the kill sidecar's flow_run_id must be the real Dex RUN id.
 *
 * watch-queue-verify used to pass `flowRunId: flowId` (the flow INSTANCE id),
 * so a reader filtering the append-only sidecar by run id could never match
 * it. The run id comes from `dexcli flow summary`'s `runId`.
 */

import { describe, expect, test } from "bun:test";

import { awaitArmTimeSummary, parseFlowSummary, resolveFlowRunId } from "./flow-summary.js";

// Shape of `dexcli flow summary <flowId> -output json` (DexFlowSummaryWire).
const SUMMARY_JSON = JSON.stringify({
  flowId: "cx-5e",
  flowType: "port.Project",
  flowStatus: "FLOW_STATUS_RUNNING",
  flowStatusCode: 1,
  runId: "01a0df1a-7c2e-7000-a000-0123456789ab",
  startTime: "2026-09-27T01:00:00Z",
});

describe("C42: parseFlowSummary / resolveFlowRunId", () => {
  test("reads the real run id and status from dexcli flow summary JSON", () => {
    expect(parseFlowSummary(SUMMARY_JSON)).toEqual({
      flowStatus: "FLOW_STATUS_RUNNING",
      runId: "01a0df1a-7c2e-7000-a000-0123456789ab",
    });
  });

  test("the sidecar flow_run_id is the RUN id, never the flow id", () => {
    const summary = parseFlowSummary(SUMMARY_JSON);
    const resolved = resolveFlowRunId(undefined, summary.runId);
    expect(resolved).toBe("01a0df1a-7c2e-7000-a000-0123456789ab");
    expect(resolved).not.toBe("cx-5e");
  });

  test("an explicit --flow-run-id override wins over the observed run id", () => {
    expect(resolveFlowRunId("operator-run", "observed-run")).toBe("operator-run");
  });

  test("unknown run id resolves to undefined (field omitted) — the flow id is not a fallback", () => {
    expect(resolveFlowRunId(undefined, null)).toBeUndefined();
    expect(resolveFlowRunId("", "")).toBeUndefined();
    expect(parseFlowSummary(JSON.stringify({ flowId: "cx-5e", flowStatus: "FLOW_STATUS_RUNNING" })).runId).toBeNull();
    expect(parseFlowSummary(JSON.stringify({ flowId: "cx-5e", runId: "" })).runId).toBeNull();
  });

  test("non-object or non-JSON output throws (the probe failure is then logged, not swallowed)", () => {
    expect(() => parseFlowSummary("not json")).toThrow();
    expect(() => parseFlowSummary("[]")).toThrow("JSON object");
    expect(() => parseFlowSummary("null")).toThrow("JSON object");
  });
});

describe("C2: the run id is known before the watcher arms (awaitArmTimeSummary)", () => {
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

  /** What watch-queue-verify's fetchFlowSummary does: remember the run id the moment the answer arrives. */
  function tracker(answerAfterMs: number) {
    const state = { observedRunId: null as string | null, calls: 0 };
    const fetch = async () => {
      state.calls += 1;
      await sleep(answerAfterMs);
      const summary = parseFlowSummary(SUMMARY_JSON);
      if (summary.runId !== null) state.observedRunId = summary.runId;
      return summary;
    };
    return { state, fetch };
  }

  test("a fetch that answers within the budget has set the run id by the time arming proceeds (it used to be fire-and-forget)", async () => {
    const { state, fetch } = tracker(60);
    const logs: string[] = [];
    await awaitArmTimeSummary(fetch, 2_000, (l) => logs.push(l));
    expect(state.observedRunId).toBe("01a0df1a-7c2e-7000-a000-0123456789ab");
    expect(resolveFlowRunId(undefined, state.observedRunId)).toBe(state.observedRunId ?? undefined);
    expect(logs).toEqual([]);
  });

  test("a hung dexcli cannot delay arming past the budget; it is logged, and a late answer is still remembered", async () => {
    const { state, fetch } = tracker(250);
    const logs: string[] = [];
    const started = Date.now();
    await awaitArmTimeSummary(fetch, 40, (l) => logs.push(l));
    expect(Date.now() - started).toBeLessThan(200);
    expect(state.observedRunId).toBeNull();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("did not answer within 40ms");
    expect(logs[0]).toContain("flow_run_id stays unknown until a probe succeeds");
    await sleep(350); // the in-flight fetch finishes later, as the status probe would
    expect(state.observedRunId).toBe("01a0df1a-7c2e-7000-a000-0123456789ab");
  });

  test("a failing fetch is logged and never thrown", async () => {
    const logs: string[] = [];
    await awaitArmTimeSummary(
      async () => {
        throw new Error("dexcli flow summary failed: connection refused");
      },
      1_000,
      (l) => logs.push(l),
    );
    expect(logs).toEqual(["dexcli flow summary failed: connection refused (at arm) — flow_run_id stays unknown until a probe succeeds"]);
    // a non-Error rejection is reported too
    await awaitArmTimeSummary(() => Promise.reject("boom"), 1_000, (l) => logs.push(l));
    expect(logs[1]).toContain("boom");
  });

  test("a fetch that throws synchronously is a failed fetch, not a crash", async () => {
    const logs: string[] = [];
    await awaitArmTimeSummary(
      () => {
        throw new Error("spawn failed");
      },
      1_000,
      (l) => logs.push(l),
    );
    expect(logs[0]).toContain("spawn failed");
  });
});
