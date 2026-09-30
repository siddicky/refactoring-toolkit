/**
 * Queue-verify watcher against BLOCKING reads on a virtual clock.
 *
 * tests/queue-verify-watcher.test.ts fakes `nextStreamEvent` as
 * `async () => queue.shift() ?? null`, which ignores `timeoutMs` and the clock,
 * so a defect that only exists because a read BLOCKS could not be caught there
 * (audit C27: the catch-up read after a START waited a full pollInterval, the
 * queue-verify DONE arrived during that wait, and the stale-start guard then
 * cancelled the kill).
 *
 * This world models the real dex long-poll: a read returns a retained event
 * immediately, otherwise blocks until the next event is published or the
 * timeout elapses (then reports "nothing arrived" as null). Every clock move is
 * virtual, so cycles run in microseconds.
 */

import { describe, expect, test } from "bun:test";

import {
  runQueueVerifyWatcher,
  type WatcherStreamEvent,
} from "../src/watcher/queue-verify-watcher.js";

const START: WatcherStreamEvent = {
  eventKey: "pp-queue-verify#1",
  stepId: "pp-queue-verify",
  endedAt: null,
};
const DONE: WatcherStreamEvent = {
  eventKey: "pp-queue-verify#1",
  stepId: "pp-queue-verify",
  endedAt: "2026-09-27T01:05:00.000Z",
};

function noise(i: number): WatcherStreamEvent {
  return { eventKey: `pp-implement#${i}@src/a.php#1`, stepId: "pp-implement", endedAt: null };
}

interface ScheduledEvent {
  /** Absolute virtual time (ms) at which the event is published. */
  at: number;
  event: WatcherStreamEvent;
}

/** Virtual-clock dex stream: blocking reads, publish schedule, recorded reads. */
function virtualWorld(schedule: ScheduledEvent[]) {
  let clock = 0;
  let cursor = 0;
  const reads: Array<{ at: number; timeoutMs: number }> = [];
  const polls: number[] = [];
  const firings: Array<{ via: string; at: number }> = [];
  const logs: string[] = [];
  return {
    reads,
    polls,
    firings,
    logs,
    clock: () => clock,
    options: (overrides: {
      pollIntervalMs: number;
      deadlineMs: number;
      catchUpTimeoutMs?: number;
      streamBlocks?: boolean;
    }) => ({
      pollIntervalMs: overrides.pollIntervalMs,
      deadlineMs: overrides.deadlineMs,
      ...(overrides.catchUpTimeoutMs !== undefined
        ? { catchUpTimeoutMs: overrides.catchUpTimeoutMs }
        : {}),
      nextStreamEvent: async (timeoutMs: number) => {
        reads.push({ at: clock, timeoutMs });
        const next = schedule[cursor];
        if (next !== undefined && next.at <= clock) {
          cursor++; // retained: resolves immediately
          return next.event;
        }
        if (next !== undefined && next.at <= clock + timeoutMs) {
          clock = next.at; // published mid-wait: the read wakes up at once
          cursor++;
          return next.event;
        }
        clock += timeoutMs; // long-poll wake-up with nothing new
        return null;
      },
      poll: async () => {
        polls.push(clock);
        return false;
      },
      fire: async ({ via }: { via: "stream" | "poll" }) => {
        firings.push({ via, at: clock });
      },
      flowStatus: async () => "running" as const,
      now: () => clock,
      sleep: async (ms: number) => {
        clock += ms;
      },
      log: (line: string) => logs.push(line),
    }),
  };
}

describe("C27: catch-up reads must not absorb the DONE that closes the kill window", () => {
  // The observed queue-verify windows were ~1.1-1.6 s. START is published at
  // t=10 s and its DONE one window later.
  for (const pollIntervalMs of [1_000, 2_000, 5_000, 60_000]) {
    test(`pollInterval=${pollIntervalMs / 1000}s, window=1.5s: the kill fires INSIDE the window`, async () => {
      const world = virtualWorld([
        { at: 10_000, event: START },
        { at: 11_500, event: DONE },
      ]);
      const result = await runQueueVerifyWatcher(
        world.options({ pollIntervalMs, deadlineMs: 5 * 60_000 }),
      );

      expect(result.outcome).toBe("fired");
      expect(result.via).toBe("stream");
      expect(result.firings).toBe(1);
      expect(world.firings).toHaveLength(1);
      // Fired before the DONE (11.5 s) could close the window.
      expect(world.firings[0]!.at).toBeGreaterThanOrEqual(10_000);
      expect(world.firings[0]!.at).toBeLessThan(11_500);
      expect(world.logs.some((l) => l.includes("skipped 1 stale queue-verify start(s)"))).toBe(false);
    });
  }

  test("every read after the first event of a cycle uses the short catch-up timeout, never the poll interval", async () => {
    const world = virtualWorld([
      { at: 10_000, event: START },
      { at: 11_500, event: DONE },
    ]);
    await runQueueVerifyWatcher(world.options({ pollIntervalMs: 60_000, deadlineMs: 5 * 60_000 }));

    expect(world.reads[0]).toEqual({ at: 0, timeoutMs: 60_000 }); // the follow long-poll
    const catchUp = world.reads.slice(1);
    expect(catchUp.length).toBeGreaterThan(0);
    for (const read of catchUp) {
      expect(read.timeoutMs).toBe(1_000);
      expect(read.timeoutMs).toBeGreaterThan(0); // 0 means the 60 s server default, not no-wait
    }
  });

  test("an explicit catchUpTimeoutMs is honoured; a non-positive one falls back to the 1 s default", async () => {
    const explicit = virtualWorld([{ at: 10_000, event: START }]);
    await runQueueVerifyWatcher(
      explicit.options({ pollIntervalMs: 60_000, deadlineMs: 5 * 60_000, catchUpTimeoutMs: 3_000 }),
    );
    expect(explicit.reads[1]).toEqual({ at: 10_000, timeoutMs: 3_000 });

    const zero = virtualWorld([{ at: 10_000, event: START }]);
    await runQueueVerifyWatcher(
      zero.options({ pollIntervalMs: 60_000, deadlineMs: 5 * 60_000, catchUpTimeoutMs: 0 }),
    );
    expect(zero.reads[1]).toEqual({ at: 10_000, timeoutMs: 1_000 });
  });

  test("a busy stream cannot starve the trigger: the lookahead after a START is bounded by the catch-up budget", async () => {
    // Noise keeps arriving every 400 ms, so no catch-up read ever times out.
    // The budget (1 s after the START was read) must still close the batch
    // before the DONE at +1.5 s is read.
    const world = virtualWorld([
      { at: 10_000, event: START },
      { at: 10_400, event: noise(1) },
      { at: 10_800, event: noise(2) },
      { at: 11_200, event: noise(3) },
      { at: 11_500, event: DONE },
    ]);
    const result = await runQueueVerifyWatcher(
      world.options({ pollIntervalMs: 60_000, deadlineMs: 5 * 60_000 }),
    );
    expect(result.outcome).toBe("fired");
    expect(world.firings[0]!.at).toBeLessThan(11_500);
  });

  test("the stale-pair guard survives: a START whose DONE is already retained never fires", async () => {
    // Both published at t=10 s (DONE is retained behind the START).
    const world = virtualWorld([
      { at: 10_000, event: START },
      { at: 10_000, event: DONE },
    ]);
    const result = await runQueueVerifyWatcher(
      world.options({ pollIntervalMs: 60_000, deadlineMs: 2 * 60_000 }),
    );
    expect(world.firings).toHaveLength(0);
    expect(result.outcome).toBe("timeout");
    expect(world.logs.some((l) => l.includes("skipped 1 stale queue-verify start(s) in the follow batch"))).toBe(true);
  });

  test("a window shorter than the 1 s read floor is structurally unkillable via the stream lane (documented limit)", async () => {
    // The SDK only takes whole seconds and 0 means the 60 s server default, so
    // a 0.5 s window closes inside the single catch-up read. The watcher must
    // report the skipped stale start rather than claim a kill.
    const world = virtualWorld([
      { at: 10_000, event: START },
      { at: 10_500, event: DONE },
    ]);
    const result = await runQueueVerifyWatcher(
      world.options({ pollIntervalMs: 60_000, deadlineMs: 2 * 60_000 }),
    );
    expect(result.outcome).toBe("timeout");
    expect(result.firings).toBe(0);
    expect(world.logs.some((l) => l.includes("skipped 1 stale queue-verify start(s)"))).toBe(true);
  });
});
