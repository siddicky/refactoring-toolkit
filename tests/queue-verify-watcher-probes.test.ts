/**
 * C34 — probe lane of the queue-verify watcher: terminal statuses, logged probe
 * failures, real cadence, and no deaf window after a busy cycle.
 *
 * All on the blocking virtual-clock world (tests/helpers/virtual-stream.ts), so
 * cadence and pacing are observable; the older fake in
 * tests/queue-verify-watcher.test.ts ignores `timeoutMs` and the clock.
 */

import { describe, expect, test } from "bun:test";

import { flowStatusFromWire } from "../src/watcher/flow-summary.js";
import {
  isTerminalFlowStatus,
  runQueueVerifyWatcher,
  type WatcherFlowStatus,
} from "../src/watcher/queue-verify-watcher.js";
import { DONE, START, noise, virtualWorld } from "./helpers/virtual-stream.js";

const SILENT_30_MIN = { pollIntervalMs: 60_000, deadlineMs: 30 * 60_000 };

describe("C34(1): every terminal flow status ends the watch cleanly", () => {
  test("isTerminalFlowStatus covers completed/failed/terminated/canceled/timeout only", () => {
    const terminal: WatcherFlowStatus[] = ["completed", "failed", "terminated", "canceled", "timeout"];
    const live: WatcherFlowStatus[] = ["running", "unknown"];
    for (const status of terminal) expect(isTerminalFlowStatus(status)).toBe(true);
    for (const status of live) expect(isTerminalFlowStatus(status)).toBe(false);
  });

  test("flowStatusFromWire maps the SDK enum names; CONTINUED_AS_NEW lives on; garbage is 'unknown'", () => {
    expect(flowStatusFromWire("FLOW_STATUS_COMPLETED")).toBe("completed");
    expect(flowStatusFromWire("FLOW_STATUS_FAILED")).toBe("failed");
    expect(flowStatusFromWire("FLOW_STATUS_TERMINATED")).toBe("terminated");
    expect(flowStatusFromWire("FLOW_STATUS_CANCELED")).toBe("canceled");
    expect(flowStatusFromWire("FLOW_STATUS_SERVER_SIDE_TIMEOUT_INTERNAL_ONLY")).toBe("timeout");
    expect(flowStatusFromWire("FLOW_STATUS_RUNNING")).toBe("running");
    expect(flowStatusFromWire("FLOW_STATUS_CONTINUED_AS_NEW")).toBe("running");
    for (const odd of ["FLOW_STATUS_UNSPECIFIED", "FLOW_STATUS_FROM_THE_FUTURE", "", null, undefined]) {
      const mapped = flowStatusFromWire(odd);
      expect(mapped).toBe("unknown");
      expect(isTerminalFlowStatus(mapped)).toBe(false);
    }
  });

  for (const status of ["terminated", "canceled", "timeout"] as const) {
    test(`a ${status} flow exits 'terminal' on the first probe instead of running to the 30-minute bound`, async () => {
      const world = virtualWorld([]);
      const result = await runQueueVerifyWatcher({
        ...world.options(SILENT_30_MIN),
        flowStatus: async () => status,
      });
      expect(result.outcome).toBe("terminal");
      expect(result.firings).toBe(0);
      expect(world.clock()).toBeLessThan(2 * 60_000); // not the full bound
      expect(world.logs.some((l) => l.includes(`flow ${status} before trigger`))).toBe(true);
    });
  }

  test("an unfired START on a terminated flow is stale (no kill), same as completed/failed", async () => {
    const world = virtualWorld([{ at: 5_000, event: START }]);
    const result = await runQueueVerifyWatcher({
      ...world.options(SILENT_30_MIN),
      flowStatus: async () => "terminated",
    });
    expect(result.outcome).toBe("terminal");
    expect(world.firings).toHaveLength(0);
    expect(world.logs.some((l) => l.includes("follow start is stale — flow terminated"))).toBe(true);
  });
});

describe("C34(2): probe failures are logged, rate-limited, and never terminate the watch", () => {
  test("a poll probe that always fails logs the first failure and then every 10th, not silently and not 30 times", async () => {
    const world = virtualWorld([]);
    const result = await runQueueVerifyWatcher({
      ...world.options(SILENT_30_MIN),
      poll: async () => {
        throw new Error("dexcli: executable file not found in $PATH");
      },
    });
    expect(result.outcome).toBe("timeout");
    const failures = world.logs.filter((l) => l.includes("poll probe failed"));
    expect(failures.length).toBeGreaterThanOrEqual(3);
    expect(failures.length).toBeLessThan(6); // 30 cycles -> ~#1,#10,#20,#30
    expect(failures[0]).toContain("1 consecutive");
    expect(failures[0]).toContain("executable file not found");
    expect(failures[1]).toContain("10 consecutive");
  });

  test("a flow-status probe that throws is logged, reads as 'unknown', and does not stop the watch", async () => {
    const world = virtualWorld([{ at: 5_000, event: START }]);
    const result = await runQueueVerifyWatcher({
      ...world.options(SILENT_30_MIN),
      flowStatus: async () => {
        throw new Error("dexcli flow summary: connection refused");
      },
    });
    // 'unknown' never suppresses a live attempt: the START still fires.
    expect(result.outcome).toBe("fired");
    expect(result.firings).toBe(1);
    expect(world.logs.some((l) => l.includes("flow-status probe failed") && l.includes("connection refused"))).toBe(true);
  });

  test("a recovery after failures is logged once", async () => {
    let calls = 0;
    const world = virtualWorld([]);
    await runQueueVerifyWatcher({
      ...world.options({ pollIntervalMs: 60_000, deadlineMs: 6 * 60_000 }),
      poll: async () => {
        calls++;
        if (calls <= 2) throw new Error("transient");
        return false;
      },
    });
    expect(world.logs.filter((l) => l.includes("poll probe failed")).length).toBe(1);
    expect(world.logs.filter((l) => l.includes("poll probe recovered after 2 consecutive failure(s)")).length).toBe(1);
  });
});

describe("C34(3): the poll probe really runs once per poll interval", () => {
  test("silent stream, 60 s poll, 30 min bound: polls every 60 s (~30), not every 120 s (15)", async () => {
    const world = virtualWorld([]);
    const result = await runQueueVerifyWatcher(world.options(SILENT_30_MIN));
    expect(result.outcome).toBe("timeout");
    expect(world.polls.length).toBeGreaterThanOrEqual(29);
    for (let i = 1; i < world.polls.length; i++) {
      expect(world.polls[i]! - world.polls[i - 1]!).toBe(60_000);
    }
    // The stream long-poll already used the whole interval: no extra sleep.
    expect(world.sleeps).toEqual([]);
  });

  test("a stream that fails hands pacing to sleep(): still ~one poll per interval", async () => {
    const world = virtualWorld([]);
    const base = world.options({ pollIntervalMs: 60_000, deadlineMs: 10 * 60_000 });
    const result = await runQueueVerifyWatcher({
      ...base,
      nextStreamEvent: async () => {
        throw new Error("stream token invalidated");
      },
    });
    expect(result.outcome).toBe("timeout");
    expect(world.polls.length).toBeGreaterThanOrEqual(9);
    for (let i = 1; i < world.polls.length; i++) {
      expect(world.polls[i]! - world.polls[i - 1]!).toBe(60_000);
    }
  });
});

describe("C34(3): no deaf window after a busy cycle", () => {
  test("a START published while the watcher would have been sleeping still fires inside its window", async () => {
    // t=10 s a non-trigger event; the cycle that reads it used to end with
    // sleep(pollInterval), so the START at t=25 s was read only after 70 s,
    // long after its DONE (t=26.5 s) closed the window.
    const world = virtualWorld([
      { at: 10_000, event: noise(1) },
      { at: 25_000, event: START },
      { at: 26_500, event: DONE },
    ]);
    const result = await runQueueVerifyWatcher(world.options(SILENT_30_MIN));
    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("stream");
    expect(world.firings[0]!.at).toBeGreaterThanOrEqual(25_000);
    expect(world.firings[0]!.at).toBeLessThan(26_500);
  });

  test("a busy stream does not spam the dexcli probes and never sleeps between events", async () => {
    // A non-trigger event every 5 s for 5 minutes (each batch closes on the
    // 1 s catch-up timeout). Probes stay time-gated to ~once per 60 s.
    const schedule = Array.from({ length: 60 }, (_, i) => ({ at: 5_000 * (i + 1), event: noise(i) }));
    const world = virtualWorld(schedule);
    const result = await runQueueVerifyWatcher(
      world.options({ pollIntervalMs: 60_000, deadlineMs: 5 * 60_000 }),
    );
    expect(result.outcome).toBe("timeout");
    expect(world.sleeps).toEqual([]);
    expect(world.polls.length).toBeGreaterThanOrEqual(4);
    expect(world.polls.length).toBeLessThanOrEqual(6);
    expect(world.statusProbes.length).toBe(world.polls.length);
  });
});
