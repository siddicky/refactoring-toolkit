import { describe, expect, test } from "bun:test";
import {
  collectBurnDown,
  collectEnvelopes,
  collectJevUsage,
  collectTombstones,
  collectVerdicts,
  flowFactsFromSummary,
  type StateAttribute,
} from "./collect.js";

const attr = (key: string, value: unknown): StateAttribute => ({ key, value });

describe("collectBurnDown (flow attribute rows -> renderer samples)", () => {
  test("keeps the aggregate row (file null) alongside per-file rows instead of dropping it", () => {
    // Exactly what QueueVerifyStep writes: tsc-<iter> total + per-file rows.
    const rows = collectBurnDown([
      attr("queue-burndown/tsc-1", {
        queue: "tsc",
        iteration: 1,
        error_count: 12,
        file: null,
        recorded_at: "2026-09-26T10:00:00Z",
      }),
      attr("queue-burndown/tsc-1-src__a.php", {
        queue: "tsc",
        iteration: 1,
        error_count: 7,
        file: "src/a.php",
        recorded_at: "2026-09-26T10:00:00Z",
      }),
      attr("queue-burndown/tsc-1-src__b.php", {
        queue: "tsc",
        iteration: 1,
        error_count: 5,
        file: "src/b.php",
        recorded_at: "2026-09-26T10:00:00Z",
      }),
    ]);
    expect(rows.map((r) => `${r.file}:${r.error_count}`).sort()).toEqual([
      "null:12",
      "src/a.php:7",
      "src/b.php:5",
    ]);
  });

  test("carries vitest accounting and skips malformed / foreign attributes", () => {
    const rows = collectBurnDown([
      attr("queue-burndown/vitest-1", {
        queue: "vitest",
        iteration: 1,
        error_count: 0,
        file: null,
        recorded_at: "2026-09-26T10:00:00Z",
        vitest: { state: "not-run", reason: "runner unavailable", passed: null, failed: null, total: null },
      }),
      attr("queue-burndown/bad", { queue: "tsc", iteration: "1" }),
      attr("envelope-event/x", { stepId: "s" }),
    ]);
    expect(rows.length).toBe(1);
    expect(rows[0]?.vitest).toEqual({
      state: "not-run",
      reason: "runner unavailable",
      passed: null,
      failed: null,
      total: null,
    });
  });
});

describe("collectVerdicts / collectTombstones / collectEnvelopes", () => {
  test("verdicts come from the ReviewTuple metrics member; tombstones from the key + value", () => {
    const metrics = {
      file: "src/a.php",
      reviewer: "reviewer-A",
      round: 1,
      diff_id: "d1",
      findings: [],
      citation_check: [],
    };
    const attrs = [
      attr("pp-verdict/src__a.php#1#reviewer-A", { metrics }),
      attr("pp-verdict/src__a.php#1#reviewer-B", {
        reviewer: "reviewer-B",
        discarded: true,
        reason: "attempt-exhausted",
        attempt: 3,
        tokens: 42,
      }),
    ];
    expect(collectVerdicts(attrs)).toEqual([metrics]);
    expect(collectTombstones(attrs)).toEqual([
      {
        file: "src/a.php",
        round: 1,
        reviewer: "reviewer-B",
        discarded: true,
        reason: "attempt-exhausted",
        attempt: 3,
        tokens: 42,
      },
    ]);
  });

  test("envelopes are validated and sorted by started_at", () => {
    const env = (stepId: string, started_at: string) => ({
      stepId,
      role: "record",
      attempt: 1,
      outcome: "completed",
      started_at,
    });
    const out = collectEnvelopes([
      attr("envelope-event/2", env("b", "2026-09-26T10:00:02Z")),
      attr("envelope-event/1", env("a", "2026-09-26T10:00:01Z")),
      attr("envelope-event/3", { stepId: "no-role" }),
    ]);
    expect(out.map((e) => e.stepId)).toEqual(["a", "b"]);
  });

  test("a record without started_at is kept (provenance reports it) and never crashes the sort", () => {
    const base = { stepId: "a", role: "record", attempt: 1, outcome: "completed" };
    const out = collectEnvelopes([
      attr("envelope-event/1", { ...base, stepId: "late", started_at: "2026-09-26T10:00:01Z" }),
      attr("envelope-event/2", { ...base, stepId: "no-start" }),
    ]);
    expect(out.map((e) => e.stepId)).toEqual(["no-start", "late"]);
  });
});

describe("collectBurnDown tsc accounting (Contract A)", () => {
  test("carries tsc accounting from the total row; legacy rows stay without it", () => {
    const base = { queue: "tsc", iteration: 1, error_count: 0, file: null, recorded_at: "2026-09-26T10:00:00Z" };
    const rows = collectBurnDown([
      attr("queue-burndown/tsc-1", {
        ...base,
        tsc: { state: "not-run", reason: "tsc timed out after 180s", exit_code: null, unlocated: 0 },
      }),
      attr("queue-burndown/tsc-2", { ...base, iteration: 2 }),
      attr("queue-burndown/tsc-3", { ...base, iteration: 3, tsc: { state: "bogus" } }),
    ]);
    expect(rows[0]?.tsc).toEqual({
      state: "not-run",
      reason: "tsc timed out after 180s",
      exit_code: null,
      unlocated: 0,
    });
    expect(rows[1]?.tsc).toBeUndefined();
    expect(rows[2]?.tsc).toBeUndefined();
  });
});

describe("collectJevUsage (pp-jev-usage attribute)", () => {
  test("reads the usage log array, skips malformed entries, ignores other attributes", () => {
    const out = collectJevUsage([
      attr("pp-jev-usage/usage", [
        { stepId: "pp-prioritize:src/a.php#1", tokens: 50, atUtc: "2026-09-26T10:04:00Z" },
        { stepId: "pp-verdict-check:src/a.php#1", tokens: 300, atUtc: "2026-09-26T10:02:00Z" },
        { stepId: "bad", tokens: "12", atUtc: "2026-09-26T10:05:00Z" },
        null,
      ]),
      attr("pp-verdict/x", [{ stepId: "s", tokens: 1, atUtc: "t" }]),
      attr("pp-jev-usage/other", "not-an-array"),
    ]);
    expect(out).toEqual([
      { stepId: "pp-verdict-check:src/a.php#1", tokens: 300, atUtc: "2026-09-26T10:02:00Z" },
      { stepId: "pp-prioritize:src/a.php#1", tokens: 50, atUtc: "2026-09-26T10:04:00Z" },
    ]);
  });

  test("no usage attribute yields an empty list", () => {
    expect(collectJevUsage([])).toEqual([]);
  });
});

describe("flowFactsFromSummary (run ids and terminal status come from `flow summary`)", () => {
  test("a completed, resumed flow reads as completed from its summary", () => {
    // `dexcli flow summary` shape; the `flow state` payload has none of these fields.
    const summary = {
      flowId: "port-cx5e",
      runId: "9f4c5bd4",
      firstRunId: "01a0e1ea",
      flowStatus: "FLOW_STATUS_COMPLETED",
    };
    expect(flowFactsFromSummary("port-cx5e", summary)).toEqual({
      flowId: "port-cx5e",
      runId: "9f4c5bd4",
      runIds: ["01a0e1ea", "9f4c5bd4"],
      flowCompleted: true,
    });
  });

  test("a failed or running flow is not completed; identical first/current run ids de-duplicate", () => {
    const failed = flowFactsFromSummary("f", { runId: "r1", firstRunId: "r1", flowStatus: "FLOW_STATUS_FAILED" });
    expect(failed.flowCompleted).toBe(false);
    expect(failed.runIds).toEqual(["r1"]);
    expect(flowFactsFromSummary("f", { runId: "r1" }).flowCompleted).toBe(false);
  });

  test("an empty summary falls back to the flow id and fetches no run history", () => {
    expect(flowFactsFromSummary("only-flow", {})).toEqual({
      flowId: "only-flow",
      runId: "only-flow",
      runIds: [],
      flowCompleted: false,
    });
  });

  test("a flow-state-shaped payload (attributes only) can never read as completed", () => {
    const statePayload = { attributes: [], activeStepExecutions: [] } as unknown as Parameters<typeof flowFactsFromSummary>[1];
    expect(flowFactsFromSummary("f", statePayload).flowCompleted).toBe(false);
  });
});

describe("collectTombstones key parsing (C46)", () => {
  const tomb = { reviewer: "reviewer-B", discarded: true, reason: "x", attempt: 1, tokens: null };

  test("a non-decimal round in the attribute key is skipped instead of coerced by Number()", () => {
    const out = collectTombstones([
      attr("pp-verdict/src__a.php#1e2#reviewer-B", tomb),
      attr("pp-verdict/src__a.php#0x10#reviewer-B", tomb),
      attr("pp-verdict/src__a.php#3#reviewer-B", tomb),
    ]);
    expect(out.map((t) => t.round)).toEqual([3]);
  });

  test("the file is recovered with the shared (lossy for __) inverse", () => {
    const out = collectTombstones([attr("pp-verdict/src____tests____Foo.php#1#reviewer-B", tomb)]);
    expect(out[0]?.file).toBe("src//tests//Foo.php");
  });
});
