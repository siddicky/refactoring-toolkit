/**
 * US-007 (Stage 2d) — queue-verify kill watcher core.
 *
 * Covers the acceptance criteria that previously lived in unbounded /tmp
 * shell poll loops:
 * - exactly-once fire (stream event, duplicate stream events, and a later
 *   poll echo produce ONE kill);
 * - 60 s poll fallback ENGAGED after a stream failure (still exactly-once);
 * - bounded: the deadline ends the watch with no kill (30 min in production);
 * - terminal flow (COMPLETED/FAILED before the trigger) EXITS cleanly — the
 *   r1-review non-exiting terminal branch fix;
 * - only a genuine pp-queue-verify START triggers (completion events and
 *   other steps do not).
 *
 * The watcher runs on an injected fake clock: every `sleep(pollIntervalMs)`
 * advances `now` by the poll interval, so cycles spin deterministically in
 * microseconds with no real timers.
 */

import { describe, expect, test } from "bun:test";

import {
  isQueueVerifyStart,
  runQueueVerifyWatcher,
  type QueueVerifyWatcherOptions,
  type WatcherStreamEvent,
} from "../src/watcher/queue-verify-watcher.js";

const START_EVENT: WatcherStreamEvent = {
  eventKey: "pp-queue-verify#1",
  stepId: "pp-queue-verify",
  endedAt: null, // START envelope — the kill window
};
const DONE_EVENT: WatcherStreamEvent = {
  eventKey: "pp-queue-verify#1",
  stepId: "pp-queue-verify",
  endedAt: "2026-09-27T01:05:00.000Z",
};
const OTHER_EVENT: WatcherStreamEvent = {
  eventKey: "pp-implement#2@src/a.php#1",
  stepId: "pp-implement",
  endedAt: null,
};

interface Harness {
  firings: Array<{ via: string; atUtc: string }>;
  logs: string[];
  queue: (events: Array<WatcherStreamEvent | Error | null>) => void;
  pollQueue: (hits: boolean[]) => void;
  setStatus: (s: "running" | "completed" | "failed" | "unknown") => void;
  run: (overrides?: Partial<QueueVerifyWatcherOptions>) => Promise<{
    outcome: string;
    via?: string;
    firings: number;
  }>;
}

/** Deterministic watcher harness: scripted stream events, polls, and clock. */
function harness(init: {
  events?: Array<WatcherStreamEvent | Error | null>;
  polls?: boolean[];
  status?: "running" | "completed" | "failed" | "unknown";
  deadlineMs?: number;
  pollIntervalMs?: number;
}): Harness {
  const eventQueue = [...(init.events ?? [])];
  const pollQueue = [...(init.polls ?? [])];
  let status = init.status ?? "running";
  const firings: Array<{ via: string; atUtc: string }> = [];
  const logs: string[] = [];
  let clock = 0;
  const pollIntervalMs = init.pollIntervalMs ?? 60_000;

  const options: QueueVerifyWatcherOptions = {
    deadlineMs: init.deadlineMs ?? 30 * 60_000,
    pollIntervalMs,
    nextStreamEvent: async () => {
      const next = eventQueue.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    },
    poll: async () => pollQueue.shift() ?? false,
    flowStatus: async () => status,
    fire: async (trigger) => {
      firings.push(trigger);
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms; // fake clock: no real waiting
    },
    log: (line) => logs.push(line),
  };

  return {
    firings,
    logs,
    queue: (events) => eventQueue.push(...events),
    pollQueue: (hits) => pollQueue.push(...hits),
    setStatus: (s) => {
      status = s;
    },
    run: async (overrides = {}) =>
      await runQueueVerifyWatcher({ ...options, ...overrides }),
  };
}

describe("queue-verify kill watcher (US-007): exactly-once, bounded, clean exits", () => {
  test("a genuine pp-queue-verify START on the stream fires ONCE", async () => {
    const h = harness({ events: [START_EVENT] });
    const result = await h.run();
    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("stream");
    expect(result.firings).toBe(1);
    expect(h.firings.length).toBe(1);
  });

  test("no-duplicate: repeat start events and a poll echo never fire twice", async () => {
    const h = harness({ events: [START_EVENT, START_EVENT, START_EVENT] });
    // Even if the watcher kept running, later triggers must be suppressed.
    const result = await h.run();
    expect(result.firings).toBe(1);
    expect(h.firings.length).toBe(1);
    // A poll hit AFTER the fire (echo) cannot produce a second kill either.
    const h2 = harness({ events: [START_EVENT], polls: [true] });
    const r2 = await h2.run();
    expect(r2.firings).toBe(1);
    expect(h2.firings.length).toBe(1);
  });

  test("stream failure ENGAGES the poll fallback; the kill fires exactly once via poll", async () => {
    const h = harness({
      events: [new Error("server restarted; stream token invalidated")],
      polls: [true],
    });
    const result = await h.run();
    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("poll");
    expect(result.firings).toBe(1);
    expect(h.logs.some((l) => l.includes("poll fallback ENGAGED"))).toBe(true);
    // After the stream failed it is never touched again this run.
    h.queue([START_EVENT]);
    h.pollQueue([true]);
    // (no further run needed — the assertion is that the run above already
    // used only the poll path; a second cycle would have fired via stream)
  });

  test("completion envelopes and other steps do NOT trigger the kill", async () => {
    const h = harness({
      events: [DONE_EVENT, OTHER_EVENT, START_EVENT],
      polls: [false, false],
    });
    const result = await h.run();
    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("stream");
    expect(result.firings).toBe(1);
  });

  test("bounded: the 30-minute deadline ends the watch with no kill", async () => {
    const h = harness({
      events: [], // stream silent forever (null = no message)
      polls: [],
      deadlineMs: 30 * 60_000,
      pollIntervalMs: 60_000,
    });
    const result = await h.run();
    expect(result.outcome).toBe("timeout");
    expect(result.firings).toBe(0);
    expect(h.firings.length).toBe(0);
    expect(h.logs.some((l) => l.includes("bounded exit"))).toBe(true);
  });

  test("terminal branch FIX: flow COMPLETED before the trigger exits cleanly (no kill)", async () => {
    const h = harness({ events: [], status: "completed", deadlineMs: 30 * 60_000 });
    const result = await h.run();
    expect(result.outcome).toBe("terminal");
    expect(result.firings).toBe(0);
    expect(h.logs.some((l) => l.includes("exiting cleanly"))).toBe(true);
  });

  test("terminal branch FIX: flow FAILED before the trigger exits cleanly (no kill)", async () => {
    const h = harness({ events: [], status: "failed", deadlineMs: 30 * 60_000 });
    const result = await h.run();
    expect(result.outcome).toBe("terminal");
    expect(result.firings).toBe(0);
  });

  test("a flow-status query failure ('unknown') does NOT terminate the watch", async () => {
    const h = harness({
      events: [null, START_EVENT],
      status: "unknown",
      deadlineMs: 10 * 60_000,
    });
    const result = await h.run();
    expect(result.outcome).toBe("fired");
    expect(result.firings).toBe(1);
  });

  test("isQueueVerifyStart predicate: start envelope yes; marker/other/no-stepId no", () => {
    expect(isQueueVerifyStart(START_EVENT)).toBe(true);
    expect(isQueueVerifyStart(DONE_EVENT)).toBe(false);
    expect(isQueueVerifyStart(OTHER_EVENT)).toBe(false);
    expect(isQueueVerifyStart({ eventKey: "pp-queue-verify#1", stepId: "", endedAt: null })).toBe(false);
  });
});

// US-010a — drain-to-head (cx8 miss shape). The follow lane consumed the
// retained stream at ~1 message/pollInterval, so its cursor fell ~28 min
// behind and every ~1.1-1.6 s queue-verify window was missed. Fix: at arm,
// drain the retained backlog (injected `drainBacklog` seam) and scan it for
// the trigger BEFORE the follow loop starts at the drained head.
describe("queue-verify kill watcher (US-010a): drain-to-head before following", () => {
  test("REGRESSION (cx8 shape): a trigger already in the retained backlog fires from the drain — the pre-US-010a follow-only watcher missed it", async () => {
    // Backlog published BEFORE arm, trigger inside it; the follow phase sees
    // only post-arm messages (nulls), and the flow goes terminal quickly —
    // exactly the run shape where the old cursor-at-tail follow never reached
    // the trigger in time and exited on the terminal branch.
    const backlog = [OTHER_EVENT, START_EVENT, DONE_EVENT];
    const h = harness({ events: [null, null], status: "completed" });
    const result = await h.run({ drainBacklog: async () => backlog });

    // Drained shape fires...
    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("stream");
    expect(result.firings).toBe(1);
    expect(h.logs.some((l) => l.includes("drained 3 retained stream event(s) to head"))).toBe(true);
    expect(h.logs.some((l) => l.includes("trigger found in drained backlog"))).toBe(true);

    // ...while the OLD behavior (no drain seam) on the SAME scenario exits
    // terminal with zero firings — the miss this story fixes, kept as a
    // documented contrast.
    const old = await harness({ events: [null, null], status: "completed" }).run();
    expect(old.outcome).toBe("terminal");
    expect(old.firings).toBe(0);
  });

  test("a trigger published AFTER arm is caught by the follow phase (cursor pinned at head by the drain)", async () => {
    const h = harness({ events: [null, START_EVENT, null] });
    const result = await h.run({ drainBacklog: async () => [OTHER_EVENT] });
    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("stream");
    expect(result.firings).toBe(1);
    expect(h.logs.some((l) => l.includes("drained 1 retained stream event(s) to head"))).toBe(true);
    // Fired by the FOLLOW phase, not the drain: no backlog-trigger line, and
    // the trigger was consumed from nextStreamEvent (the drained event was
    // the other step only).
    expect(h.logs.some((l) => l.includes("trigger found in drained backlog"))).toBe(false);
  });

  test("an empty retained stream arms cleanly: drain of 0 events, watch proceeds to its bounded end", async () => {
    const h = harness({ events: [], deadlineMs: 5 * 60_000 });
    const result = await h.run({ drainBacklog: async () => [] });
    expect(result.outcome).toBe("timeout");
    expect(result.firings).toBe(0);
    expect(h.logs.some((l) => l.includes("drained 0 retained stream event(s) to head"))).toBe(true);
  });

  test("a FAILED drain does not kill the watch: the follow phase (and poll fallback) continue from the current cursor", async () => {
    const h = harness({ events: [null, START_EVENT] });
    const result = await h.run({
      drainBacklog: async () => {
        throw new Error("listStreamMessages: server unavailable at arm");
      },
    });
    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("stream");
    expect(result.firings).toBe(1);
    expect(h.logs.some((l) => l.includes("backlog drain failed"))).toBe(true);
  });

  test("malformed backlog entries are skipped; the drained trigger fires exactly once", async () => {
    const malformed: WatcherStreamEvent = { eventKey: "", stepId: "", endedAt: null };
    const h = harness({ events: [null] }); // follow phase: nothing post-arm
    const result = await h.run({
      drainBacklog: async () => [malformed, malformed, DONE_EVENT, START_EVENT],
    });
    expect(result.outcome).toBe("fired");
    expect(result.firings).toBe(1);
    expect(h.firings.length).toBe(1);
    // Exactly ONE backlog trigger recognized — the malformed entries and the
    // completion envelope were skipped, the START was found once.
    expect(h.logs.filter((l) => l.includes("trigger found in drained backlog")).length).toBe(1);
  });
});
