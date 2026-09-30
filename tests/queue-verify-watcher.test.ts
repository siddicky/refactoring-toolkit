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
//
// Fix-wave amendment: a drained start fires only when its attempt is
// UNMATCHED (start/completion correlated by event key) AND the flow is not
// terminal — the original [OTHER, START, DONE]+completed shape was a STALE
// trigger and must exit cleanly with zero firings instead.
describe("queue-verify kill watcher (US-010a): drain-to-head before following", () => {
  test("REGRESSION (cx8 shape): an UNMATCHED start in the retained backlog fires while the flow is still running", async () => {
    // Backlog published BEFORE arm with a still-active attempt (no same-key
    // completion after it); the flow is running — the kill must fire.
    const h = harness({ events: [null, null], status: "running" });
    const result = await h.run({ drainBacklog: async () => [OTHER_EVENT, START_EVENT] });

    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("stream");
    expect(result.firings).toBe(1);
    expect(h.logs.some((l) => l.includes("drained 2 retained stream event(s) to head"))).toBe(true);
    expect(h.logs.some((l) => l.includes("trigger found in drained backlog"))).toBe(true);
  });

  test("REGRESSION (stale-start, fix-wave): a matched [start, done] pair in the backlog NEVER fires; terminal flow exits cleanly (0 firings)", async () => {
    // The reviewer-rejected shape: the start's completion sits later in the
    // SAME backlog (attempt already closed) and the flow went terminal. The
    // drain-to-head watcher fired on it; the stale-start guard must not.
    const h = harness({ events: [null, null], status: "completed" });
    const result = await h.run({ drainBacklog: async () => [OTHER_EVENT, START_EVENT, DONE_EVENT] });

    expect(result.outcome).toBe("terminal");
    expect(result.firings).toBe(0);
    expect(h.firings.length).toBe(0);
    expect(h.logs.some((l) => l.includes("skipped 1 stale queue-verify start(s)"))).toBe(true);
    expect(h.logs.some((l) => l.includes("trigger found in drained backlog"))).toBe(false);
  });

  test("a still-UNMATCHED backlog start on an already-terminal flow does not fire either (terminal gate)", async () => {
    const h = harness({ events: [null], status: "failed" });
    const result = await h.run({ drainBacklog: async () => [START_EVENT] });
    expect(result.outcome).toBe("terminal");
    expect(result.firings).toBe(0);
    expect(h.firings.length).toBe(0);
    expect(h.logs.some((l) => l.includes("flow failed before the trigger"))).toBe(true);
  });

  test("attempt correlation: a closed attempt-1 does not suppress a LATER open attempt-2 start in the same backlog", async () => {
    const start2: WatcherStreamEvent = {
      eventKey: "pp-queue-verify#2",
      stepId: "pp-queue-verify",
      endedAt: null,
    };
    const done1: WatcherStreamEvent = {
      eventKey: "pp-queue-verify#1",
      stepId: "pp-queue-verify",
      endedAt: "2026-09-27T01:00:00.000Z",
    };
    const h = harness({ events: [null], status: "running" });
    const result = await h.run({ drainBacklog: async () => [START_EVENT, done1, start2] });
    expect(result.outcome).toBe("fired");
    expect(result.firings).toBe(1);
    expect(h.logs.some((l) => l.includes("trigger found in drained backlog: pp-queue-verify#2"))).toBe(true);
  });

  test("REGRESSION (fix-wave catch-up): armed on an EMPTY stream, a large backlog + trigger published while the flow is active fires within one cycle — not 1 message/poll", async () => {
    // The cx8 miss shape, post-arm edition: arm drains 0 events, then a large
    // backlog is published with the trigger at its end while the flow is
    // active (first long-poll comes back empty; the published events land in
    // the retained stream right after). The follow phase must catch up to
    // exhaustion in ONE cycle. The pre-fix loop consumed 1 message/poll — on
    // this deadline (5 min / 60 s polls) it would read only ~4 of 21 events
    // and exit on the timeout without ever reaching the trigger.
    const backlog: WatcherStreamEvent[] = Array.from({ length: 20 }, (_, i) => ({
      eventKey: `pp-implement#${i}@src/a.php#1`,
      stepId: "pp-implement",
      endedAt: null,
    }));
    const h = harness({
      events: [null, ...backlog, START_EVENT],
      polls: [],
      status: "running",
      deadlineMs: 5 * 60_000,
      pollIntervalMs: 60_000,
    });
    const result = await h.run({ drainBacklog: async () => [] });

    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("stream");
    expect(result.firings).toBe(1);
    expect(h.logs.some((l) => l.includes("drained 0 retained stream event(s) to head"))).toBe(true);
    expect(h.logs.some((l) => l.includes("catch-up drained 21 follow event(s) to exhaustion before checks"))).toBe(true);
    expect(h.logs.some((l) => l.includes("trigger in follow batch: pp-queue-verify#1"))).toBe(true);
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

  test("REGRESSION (fix-wave follow guard): armed on an EMPTY stream, a [OTHER, START, DONE] follow batch on a terminal flow NEVER fires — the arm-time stale-start guard mirrored", async () => {
    // Pre-fix the follow loop fired on ANY queue-verify START the moment it
    // was read — before its matching DONE (later in the SAME batch) or the
    // terminal status was seen. The arm-time drain got the correlation +
    // terminal check; the follow path now gets the same treatment: the batch
    // is drained to exhaustion FIRST, correlated by event key, and gated on
    // the flow status before any firing.
    const statuses: Array<"running" | "completed"> = ["running", "completed"];
    const h = harness({
      events: [OTHER_EVENT, START_EVENT, DONE_EVENT, null],
      polls: [false, false],
      status: "running", // terminal only AFTER the batch has been consumed
      deadlineMs: 5 * 60_000,
    });
    const result = await h.run({
      drainBacklog: async () => [],
      flowStatus: async () => statuses.shift() ?? "completed",
    });

    expect(result.outcome).toBe("terminal");
    expect(result.firings).toBe(0);
    expect(h.firings.length).toBe(0);
    expect(h.logs.some((l) => l.includes("drained 0 retained stream event(s) to head"))).toBe(true);
    expect(h.logs.some((l) => l.includes("catch-up drained 3 follow event(s) to exhaustion before checks"))).toBe(true);
    expect(h.logs.some((l) => l.includes("skipped 1 stale queue-verify start(s) in the follow batch"))).toBe(true);
  });

  test("the follow guard keeps live triggers: an UNMATCHED start in a follow batch on a running flow still fires", async () => {
    const h = harness({
      events: [OTHER_EVENT, START_EVENT, null],
      polls: [false],
      status: "running",
      deadlineMs: 5 * 60_000,
    });
    const result = await h.run({ drainBacklog: async () => [] });
    expect(result.outcome).toBe("fired");
    expect(result.via).toBe("stream");
    expect(result.firings).toBe(1);
    expect(h.logs.some((l) => l.includes("trigger in follow batch: pp-queue-verify#1"))).toBe(true);
  });
});

// Audit C71 — a trigger whose kill action killed NOTHING (no live target PIDs)
// must not be reported as a fired kill (the script used to print "kill fired
// once" and exit 0 while the sidecar claimed a successful kill).
describe("queue-verify kill watcher (C71): a no-op kill is not 'fired'", () => {
  test("fire resolving { killed: false } yields outcome 'no-op' with 0 firings", async () => {
    const h = harness({ events: [START_EVENT] });
    const result = await h.run({
      fire: async (trigger) => {
        h.firings.push(trigger);
        return { killed: false, detail: "pgrep found no dexcli/worker PIDs" };
      },
    });
    expect(result.outcome).toBe("no-op");
    expect(result.via).toBe("stream");
    expect(result.firings).toBe(0);
    expect(h.firings.length).toBe(1); // the action ran exactly once
    expect(h.logs.some((l) => l.includes("kill was a NO-OP: pgrep found no dexcli/worker PIDs"))).toBe(true);
  });

  test("the poll lane reports a no-op the same way", async () => {
    const h = harness({ events: [null], polls: [true] });
    const result = await h.run({ fire: async () => ({ killed: false }) });
    expect(result.outcome).toBe("no-op");
    expect(result.via).toBe("poll");
    expect(result.firings).toBe(0);
  });

  test("fire resolving { killed: true } or void stays a real 'fired' (backwards compatible)", async () => {
    const real = harness({ events: [START_EVENT] });
    const r1 = await real.run({ fire: async () => ({ killed: true }) });
    expect(r1.outcome).toBe("fired");
    expect(r1.firings).toBe(1);

    const legacy = harness({ events: [START_EVENT] });
    const r2 = await legacy.run();
    expect(r2.outcome).toBe("fired");
    expect(r2.firings).toBe(1);
  });
});
