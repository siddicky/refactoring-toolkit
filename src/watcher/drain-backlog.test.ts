/**
 * C28 — the arm-time backlog drain must hand the watcher STREAM ORDER.
 *
 * `listStreamMessages` pages are newest-first. The drain closure that lived in
 * scripts/watch-queue-verify.ts main() reversed each page but appended page 0
 * (newest) before page 1 (older), so a closed queue-verify START/DONE pair that
 * straddled a 100-message page boundary read as an ACTIVE start and the drain
 * fired the chaos kill on an already-finished attempt. The closure was
 * untested; the drain is now an importable function over a `listPage` seam.
 */

import { describe, expect, test } from "bun:test";

import {
  DRAIN_PAGE_SIZE,
  drainRetainedBacklog,
  toWatcherEvent,
  type RetainedMessage,
  type RetainedPage,
} from "./drain-backlog.js";
import {
  activeAttemptStarts,
  runQueueVerifyWatcher,
  type WatcherStreamEvent,
} from "./queue-verify-watcher.js";

/** Envelope-shaped stream value the script's toWatcherEvent understands. */
function envelopeValue(eventKey: string, stepId: string, endedAt: string | null) {
  return { eventKey, event: { stepId, ended_at: endedAt } };
}

/**
 * 120 retained messages in stream order (seq 1..120). The queue-verify START
 * is seq 20 and its DONE is seq 21 — adjacent, straddling the 100-message
 * boundary of newest-first pages (page 0 = seq 120..21, page 1 = seq 20..1).
 */
function retainedStream(): RetainedMessage[] {
  const messages: RetainedMessage[] = [];
  for (let seq = 1; seq <= 120; seq++) {
    let value: unknown;
    if (seq === 20) value = envelopeValue("pp-queue-verify#1", "pp-queue-verify", null);
    else if (seq === 21) {
      value = envelopeValue("pp-queue-verify#1", "pp-queue-verify", "2026-09-27T01:05:00.000Z");
    } else value = envelopeValue(`f#${seq}`, "pp-implement", null);
    messages.push({ value, resumeToken: `tok-${seq}` });
  }
  return messages;
}

/** Serves `listStreamMessages` semantics: newest-first pages + older-page token. */
function pager(stream: RetainedMessage[], pageSize = DRAIN_PAGE_SIZE) {
  const requested: string[] = [];
  const listPage = async (pageToken: string): Promise<RetainedPage> => {
    requested.push(pageToken);
    const end = pageToken === "" ? stream.length : Number(pageToken.replace("before-", ""));
    const begin = Math.max(0, end - pageSize);
    const slice = stream.slice(begin, end).reverse(); // newest-first
    return { messages: slice, nextPageToken: begin === 0 ? "" : `before-${begin}` };
  };
  return { listPage, requested };
}

/** The pre-fix closure body, verbatim, over the same pages (shows the defect). */
async function legacyDrain(listPage: (t: string) => Promise<RetainedPage>) {
  const events: WatcherStreamEvent[] = [];
  let pageToken = "";
  for (let page = 0; page < 500; page++) {
    const res = await listPage(pageToken);
    for (let i = res.messages.length - 1; i >= 0; i--) {
      const message = res.messages[i];
      if (message !== undefined) events.push(toWatcherEvent(message));
    }
    if (res.nextPageToken === "") return events;
    pageToken = res.nextPageToken;
  }
  return events;
}

describe("C28: drainRetainedBacklog returns stream order across page boundaries", () => {
  test("the scenario is discriminating: the legacy page order reports the CLOSED attempt as active", async () => {
    const { listPage } = pager(retainedStream());
    const legacy = await legacyDrain(listPage);
    expect(activeAttemptStarts(legacy).map((e) => e.eventKey)).toEqual(["pp-queue-verify#1"]);
  });

  test("two pages with a START/DONE pair on the 100-message boundary: no active attempt", async () => {
    const { listPage, requested } = pager(retainedStream());
    const drained = await drainRetainedBacklog({ listPage });

    expect(requested).toEqual(["", "before-20"]); // exactly two pages
    expect(drained).toHaveLength(120);
    // Strict stream order: f#1..f#19, START(20), DONE(21), f#22..f#120.
    expect(drained[0]!.eventKey).toBe("f#1");
    expect(drained[18]!.eventKey).toBe("f#19");
    expect(drained[19]).toEqual({ eventKey: "pp-queue-verify#1", stepId: "pp-queue-verify", endedAt: null });
    expect(drained[20]!.endedAt).toBe("2026-09-27T01:05:00.000Z");
    expect(drained[119]!.eventKey).toBe("f#120");
    expect(activeAttemptStarts(drained)).toEqual([]);
  });

  test("three pages are stitched oldest-page-first", async () => {
    const stream: RetainedMessage[] = Array.from({ length: 25 }, (_, i) => ({
      value: envelopeValue(`f#${i + 1}`, "pp-implement", null),
      resumeToken: `tok-${i + 1}`,
    }));
    const { listPage } = pager(stream, 10); // pages: 25..16, 15..6, 5..1
    const drained = await drainRetainedBacklog({ listPage });
    expect(drained.map((e) => e.eventKey)).toEqual(Array.from({ length: 25 }, (_, i) => `f#${i + 1}`));
  });

  test("the head resume token is pinned from page 0's newest message BEFORE deeper paging", async () => {
    const stream = retainedStream();
    const calls: string[] = [];
    const { listPage } = pager(stream);
    await drainRetainedBacklog({
      listPage: async (t) => {
        calls.push(`list:${t || "head"}`);
        return await listPage(t);
      },
      onHead: (token) => calls.push(`head:${token}`),
    });
    expect(calls).toEqual(["list:head", "head:tok-120", "list:before-20"]);
  });

  test("a mid-drain failure leaves the cursor already pinned at head and propagates", async () => {
    const { listPage } = pager(retainedStream());
    let head = "";
    await expect(
      drainRetainedBacklog({
        listPage: async (t) => {
          if (t !== "") throw new Error("listStreamMessages: server went away");
          return await listPage(t);
        },
        onHead: (token) => {
          head = token;
        },
      }),
    ).rejects.toThrow("server went away");
    expect(head).toBe("tok-120");
  });

  test("an empty stream yields no events and never pins a head", async () => {
    let head: string | undefined;
    const drained = await drainRetainedBacklog({
      listPage: async () => ({ messages: [], nextPageToken: "" }),
      onHead: (t) => {
        head = t;
      },
    });
    expect(drained).toEqual([]);
    expect(head).toBeUndefined();
  });

  test("the page bound stops a server that never exhausts nextPageToken, and logs it", async () => {
    const logs: string[] = [];
    let served = 0;
    const drained = await drainRetainedBacklog({
      maxPages: 3,
      log: (l) => logs.push(l),
      listPage: async () => {
        served++;
        return {
          messages: [{ value: envelopeValue(`f#${served}`, "pp-implement", null), resumeToken: `t${served}` }],
          nextPageToken: `more-${served}`,
        };
      },
    });
    expect(served).toBe(3);
    // Pages were served newest-first (f#1 newest of the walk), so stream order is f#3, f#2, f#1.
    expect(drained.map((e) => e.eventKey)).toEqual(["f#3", "f#2", "f#1"]);
    expect(logs.some((l) => l.includes("3-page bound"))).toBe(true);
  });

  test("toWatcherEvent: only an absent/null ended_at is a START; a non-string ended_at is a completion, not a START", () => {
    const base = { eventKey: "pp-queue-verify#1", event: { stepId: "pp-queue-verify" } };
    expect(toWatcherEvent({ value: base }).endedAt).toBeNull(); // ended_at absent
    expect(toWatcherEvent({ value: { ...base, event: { ...base.event, ended_at: null } } }).endedAt).toBeNull();
    const epoch = toWatcherEvent({ value: { ...base, event: { ...base.event, ended_at: 1_790_000_000_000 } } });
    expect(epoch.endedAt).toBe("1790000000000");
    // A finished attempt with an unexpected ended_at type must close its START.
    const start = toWatcherEvent({ value: base });
    expect(activeAttemptStarts([start, epoch])).toEqual([]);
  });

  test("toWatcherEvent tolerates null / non-object / partial envelope values", () => {
    const empty = { eventKey: "", stepId: "", endedAt: null };
    expect(toWatcherEvent({ value: null })).toEqual(empty);
    expect(toWatcherEvent({ value: "garbage" })).toEqual(empty);
    expect(toWatcherEvent({ value: { eventKey: "k", event: null } })).toEqual({ ...empty, eventKey: "k" });
  });
});

describe("C28: end to end through the watcher", () => {
  test("a finished attempt straddling the page boundary does NOT fire the kill", async () => {
    const { listPage } = pager(retainedStream());
    const firings: string[] = [];
    const logs: string[] = [];
    let clock = 0;
    const result = await runQueueVerifyWatcher({
      deadlineMs: 2 * 60_000,
      pollIntervalMs: 60_000,
      drainBacklog: () => drainRetainedBacklog({ listPage }),
      nextStreamEvent: async () => null,
      poll: async () => false,
      flowStatus: async () => "running",
      fire: async ({ via }) => {
        firings.push(via);
      },
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      log: (l) => logs.push(l),
    });

    expect(firings).toEqual([]);
    expect(result.outcome).toBe("timeout");
    expect(result.firings).toBe(0);
    expect(logs.some((l) => l.includes("trigger found in drained backlog"))).toBe(false);
    expect(logs.some((l) => l.includes("skipped 1 stale queue-verify start(s) in the drained backlog"))).toBe(true);
  });
});
