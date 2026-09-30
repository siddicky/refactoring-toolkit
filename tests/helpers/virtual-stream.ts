/**
 * Virtual-clock dex stream for the queue-verify watcher tests.
 *
 * Models the real dex long-poll: a read returns a retained event immediately,
 * otherwise blocks until the next event is published or the timeout elapses
 * (then reports "nothing arrived" as null). Every clock move is virtual, so a
 * 30-minute watch runs in microseconds. Not a test file (no `.test.` in the
 * name), so `bun test` does not pick it up.
 */

import type {
  QueueVerifyWatcherOptions,
  WatcherFlowStatus,
  WatcherStreamEvent,
} from "../../src/watcher/queue-verify-watcher.js";

export const START: WatcherStreamEvent = {
  eventKey: "pp-queue-verify#1",
  stepId: "pp-queue-verify",
  endedAt: null,
};
export const DONE: WatcherStreamEvent = {
  eventKey: "pp-queue-verify#1",
  stepId: "pp-queue-verify",
  endedAt: "2026-09-27T01:05:00.000Z",
};

export function noise(i: number): WatcherStreamEvent {
  return { eventKey: `pp-implement#${i}@src/a.php#1`, stepId: "pp-implement", endedAt: null };
}

export interface ScheduledEvent {
  /** Absolute virtual time (ms) at which the event is published. */
  at: number;
  event: WatcherStreamEvent;
}

export interface VirtualWorldOptions {
  pollIntervalMs: number;
  deadlineMs: number;
  catchUpTimeoutMs?: number;
  /** Status the flow probe reports (default "running"). May throw. */
  flowStatus?: () => Promise<WatcherFlowStatus>;
  /** Poll probe (default: never hits). May throw. */
  poll?: () => Promise<boolean>;
}

export function virtualWorld(schedule: ScheduledEvent[]) {
  let clock = 0;
  let cursor = 0;
  const reads: Array<{ at: number; timeoutMs: number }> = [];
  const polls: number[] = [];
  const statusProbes: number[] = [];
  const sleeps: number[] = [];
  const firings: Array<{ via: string; at: number }> = [];
  const logs: string[] = [];
  return {
    reads,
    polls,
    statusProbes,
    sleeps,
    firings,
    logs,
    clock: () => clock,
    options: (config: VirtualWorldOptions): QueueVerifyWatcherOptions => ({
      pollIntervalMs: config.pollIntervalMs,
      deadlineMs: config.deadlineMs,
      ...(config.catchUpTimeoutMs !== undefined
        ? { catchUpTimeoutMs: config.catchUpTimeoutMs }
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
        return config.poll !== undefined ? await config.poll() : false;
      },
      fire: async ({ via }) => {
        firings.push({ via, at: clock });
      },
      flowStatus: async () => {
        statusProbes.push(clock);
        return config.flowStatus !== undefined ? await config.flowStatus() : "running";
      },
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      log: (line: string) => logs.push(line),
    }),
  };
}
