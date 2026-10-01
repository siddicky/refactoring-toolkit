/**
 * C34 — probe lane of the queue-verify watcher: terminal statuses, logged probe
 * failures, real cadence, and no deaf window after a busy cycle.
 *
 * All on the blocking virtual-clock world (tests/support/virtual-stream.ts), so
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
import { DONE, START, noise, virtualWorld } from "./support/virtual-stream.js";

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

describe("C34(3): pacing never leaves the watcher deaf while a real long-poll is available", () => {
  test("a server that caps the long-poll below pollInterval: no sleeps, probes still ~once per pollInterval", async () => {
    // The long-poll wakes after 20 s although 60 s was requested. A sleep for
    // the remaining 40 s would leave the watcher deaf; probes must not double up.
    const world = virtualWorld([]);
    const result = await runQueueVerifyWatcher(
      world.options({ ...SILENT_30_MIN, longPollCapMs: 20_000 }),
    );
    expect(result.outcome).toBe("timeout");
    expect(world.sleeps).toEqual([]);
    expect(world.polls.length).toBeGreaterThanOrEqual(29);
    expect(world.polls.length).toBeLessThanOrEqual(31);
  });

  test("...and a START published mid-cycle under that cap still fires inside its window", async () => {
    const world = virtualWorld([
      { at: 70_000, event: START },
      { at: 71_500, event: DONE },
    ]);
    const result = await runQueueVerifyWatcher(
      world.options({ ...SILENT_30_MIN, longPollCapMs: 20_000 }),
    );
    expect(result.outcome).toBe("fired");
    expect(world.firings[0]!.at).toBeLessThan(71_500);
  });
});

describe("review: the kill gate, the hard bound, and batch draining are all bounded", () => {
  test("a hung flow-status probe cannot eat the kill window: past the gate budget the START fires anyway", async () => {
    const world = virtualWorld([{ at: 5_000, event: START }]);
    const lateRejection = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("late")), 60));
    const started = Date.now();
    const result = await runQueueVerifyWatcher({
      ...world.options(SILENT_30_MIN),
      statusGateTimeoutMs: 25,
      flowStatus: () => lateRejection, // never resolves inside the budget; rejects afterwards
    });
    expect(result.outcome).toBe("fired");
    expect(Date.now() - started).toBeLessThan(500); // not the 10 s dexcli timeout
    expect(world.logs.some((l) => l.includes("exceeded the 25ms kill-gate budget"))).toBe(true);
    await new Promise((r) => setTimeout(r, 100)); // the late rejection must not surface as unhandled
  });

  test("a fast status probe inside the budget still gates: a terminal flow does not fire", async () => {
    const world = virtualWorld([{ at: 5_000, event: START }]);
    const result = await runQueueVerifyWatcher({
      ...world.options(SILENT_30_MIN),
      statusGateTimeoutMs: 500,
      flowStatus: async () => "failed",
    });
    expect(result.outcome).toBe("terminal");
    expect(world.firings).toHaveLength(0);
  });

  test("the watch never runs past its hard bound: the last long-poll is clamped and the last sleep too", async () => {
    // deadline 90 s with a 60 s poll: the second read may only wait the 30 s that remain.
    const silent = virtualWorld([]);
    const r1 = await runQueueVerifyWatcher(silent.options({ pollIntervalMs: 60_000, deadlineMs: 90_000 }));
    expect(r1.outcome).toBe("timeout");
    expect(silent.reads.map((r) => r.timeoutMs)).toEqual([60_000, 30_000]);
    expect(silent.clock()).toBeLessThanOrEqual(90_000);

    // Stream unusable: pacing is sleep(); the last sleep is clamped to the bound.
    const failing = virtualWorld([]);
    const r2 = await runQueueVerifyWatcher({
      ...failing.options({ pollIntervalMs: 60_000, deadlineMs: 90_000 }),
      nextStreamEvent: async () => {
        throw new Error("stream token invalidated");
      },
    });
    expect(r2.outcome).toBe("timeout");
    expect(failing.sleeps).toEqual([60_000, 30_000]);
    expect(failing.clock()).toBe(90_000);
  });

  test("a constantly busy stream cannot starve the poll/terminal probes until the deadline", async () => {
    // A non-trigger event every 500 ms: every catch-up read is satisfied, so no
    // read ever times out. The batch must still close every pollInterval.
    const schedule = Array.from({ length: 600 }, (_, i) => ({ at: 500 * (i + 1), event: noise(i) }));
    const world = virtualWorld(schedule);
    const result = await runQueueVerifyWatcher({
      ...world.options({ pollIntervalMs: 60_000, deadlineMs: 5 * 60_000 }),
      flowStatus: async () => {
        world.statusProbes.push(world.clock());
        return world.clock() >= 130_000 ? "completed" : "running";
      },
    });
    // The terminal probe got to run while events were still flowing, and ended the watch.
    expect(result.outcome).toBe("terminal");
    expect(world.clock()).toBeLessThan(200_000);
    expect(world.polls.length).toBeGreaterThanOrEqual(2);
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
