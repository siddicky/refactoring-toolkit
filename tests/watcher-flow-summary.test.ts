/**
 * C42 — the kill sidecar's flow_run_id must be the real Dex RUN id.
 *
 * watch-queue-verify used to pass `flowRunId: flowId` (the flow INSTANCE id),
 * so a reader filtering the append-only sidecar by run id could never match
 * it. The run id comes from `dexcli flow summary`'s `runId`.
 */

import { describe, expect, test } from "bun:test";

import { parseFlowSummary, resolveFlowRunId } from "../src/watcher/flow-summary.js";

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
