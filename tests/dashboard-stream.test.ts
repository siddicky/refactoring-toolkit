/**
 * US-007 (Stage 2d) — dashboard ReadStream subscriber, poll fallback, AC-D
 * end-to-end, and the projection-only stream boundary.
 *
 * AC-D: publish → subscriber receipt → event present in the /api/state feed
 * payload; forced subscriber failure → poll fallback ENGAGED (the durable
 * history/state poll path keeps building the feed).
 *
 * Projection-only boundary (same pattern as the US-003 import-boundary test):
 * no control-flow module reads the telemetry stream — flows/, src/git/, and
 * src/queues/ must contain no readStream/listStreamMessages usage. The only
 * consumers are the dashboard/query layer, the serve-status/watcher script
 * compositions, and the injected watcher core.
 */

import { describe, expect, test } from "bun:test";

import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  startEnvelopeStreamSubscriber,
  type EnvelopeStreamReader,
} from "../src/dashboard/queries.js";
import {
  buildDashboardState,
  feedFromStreamMessages,
  parseEnvelope,
} from "../src/dashboard/state.js";
import type {
  DexFlowSummaryWire,
  StreamEventMessage,
} from "../src/dashboard/types.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function streamMessage(overrides: Partial<StreamEventMessage> = {}): StreamEventMessage {
  return {
    topic: "port/cx-7/events",
    flowId: "cx-7",
    eventKey: "pp-queue-verify#1",
    event: {
      stepId: "pp-queue-verify",
      role: "queue",
      file: null,
      round: null,
      attempt: 1,
      started_at: "2026-09-27T01:00:00.000Z",
      ended_at: "2026-09-27T01:00:05.000Z",
      outcome: "completed",
      tokens: null,
      wall_clock_ms: 5_000,
      identity: null,
    },
    ...overrides,
  };
}

function flowSummary(flowId: string): DexFlowSummaryWire {
  return {
    flowId,
    flowType: "port.Project",
    flowStatus: "FLOW_STATUS_RUNNING",
    flowStatusCode: 1,
    runId: `run-${flowId}`,
    startTime: "2026-09-27T00:59:00.000Z",
  };
}

/** Deferred-read helper: a controllable PER-FLOW stream double (no loop can
 * spin on its own — every read stays pending until the test resolves it). */
function deferredReader(): {
  read: EnvelopeStreamReader;
  resolveNext: (flowId: string, msg: StreamEventMessage) => void;
  failNext: (flowId: string, err: unknown) => void;
  pendingCount: () => number;
  timeouts: Record<string, number[]>;
} {
  const pending = new Map<
    string,
    Array<{
      resolve: (value: { value: StreamEventMessage; resumeToken: string }) => void;
      reject: (err: unknown) => void;
    }>
  >();
  const timeouts: Record<string, number[]> = {};
  const take = (flowId: string) => {
    const queue = pending.get(flowId);
    const entry = queue?.shift();
    if (queue !== undefined && queue.length === 0) pending.delete(flowId);
    return entry;
  };
  const read: EnvelopeStreamReader = (flowId, resumeToken, timeoutMs) => {
    void resumeToken;
    (timeouts[flowId] ??= []).push(timeoutMs);
    return new Promise((resolve, reject) => {
      pending.set(flowId, [...(pending.get(flowId) ?? []), { resolve, reject }]);
    });
  };
  return {
    read,
    resolveNext: (flowId, msg) =>
      take(flowId)?.resolve({ value: msg, resumeToken: `tok-${flowId}` }),
    failNext: (flowId, err) => take(flowId)?.reject(err),
    pendingCount: () => [...pending.values()].reduce((n, q) => n + q.length, 0),
    timeouts,
  };
}

/** Manually released backoff sleeps, so retry timing is deterministic. */
function controllableSleep(): {
  sleep: (ms: number) => Promise<void>;
  waits: Array<{ ms: number; resolve: () => void }>;
  /** Every requested duration, in order (released or not). */
  waitLog: number[];
  releaseNext: () => void;
} {
  const waits: Array<{ ms: number; resolve: () => void }> = [];
  const waitLog: number[] = [];
  return {
    sleep: (ms) => {
      waitLog.push(ms);
      return new Promise<void>((resolve) => waits.push({ ms, resolve }));
    },
    waits,
    waitLog,
    releaseNext: () => waits.shift()?.resolve(),
  };
}

/** Yields once on the MACROtask queue so pending loop continuations settle. */
const tick = (): Promise<void> => Bun.sleep(1);

// ---------------------------------------------------------------------------
// Subscriber behavior
// ---------------------------------------------------------------------------

describe("envelope stream subscriber (US-007): receipt, fallback, resilience", () => {
  test("a published event arrives via subscription and is buffered", async () => {
    const reader = deferredReader();
    const seen: StreamEventMessage[] = [];
    const subscriber = startEnvelopeStreamSubscriber({
      read: reader.read,
      longPollMs: 1_000,
      onEvent: (m) => seen.push(m),
    });
    subscriber.follow(["cx-7"]);
    await tick();
    expect(reader.timeouts["cx-7"]?.[0]).toBe(1_000);
    reader.resolveNext("cx-7", streamMessage());
    await tick();
    expect(subscriber.size("cx-7")).toBe(1);
    expect(subscriber.mode("cx-7")).toBe("stream");
    expect(seen.length).toBe(1);
    expect(subscriber.recentEvents("cx-7")[0]?.eventKey).toBe("pp-queue-verify#1");
    subscriber.stop();
  });

  test("a long-poll wake-up (subStatus longPollTimeout) is NOT a failure — stream stays live", async () => {
    const reader = deferredReader();
    const subscriber = startEnvelopeStreamSubscriber({ read: reader.read, longPollMs: 50 });
    subscriber.follow(["cx-7"]);
    await tick();
    reader.failNext("cx-7", Object.assign(new Error("waiting exceeded the poll window"), { subStatus: "longPollTimeout" }));
    await tick();
    expect(subscriber.mode("cx-7")).toBe("stream");
    reader.resolveNext("cx-7", streamMessage());
    await tick();
    expect(subscriber.size("cx-7")).toBe(1);
    subscriber.stop();
  });

  test("forced stream failure ENGAGES the poll fallback once and backs off instead of hot-looping", async () => {
    const reader = deferredReader();
    const sleeper = controllableSleep();
    const fallbacks: Array<{ flowId: string; error: string }> = [];
    const subscriber = startEnvelopeStreamSubscriber({
      read: reader.read,
      longPollMs: 50,
      sleep: sleeper.sleep,
      onFallback: (flowId, error) => fallbacks.push({ flowId, error }),
    });
    subscriber.follow(["cx-7"]);
    await tick();
    reader.failNext("cx-7", new Error("server unreachable (forced failure)"));
    await tick();
    expect(subscriber.mode("cx-7")).toBe("poll-fallback");
    expect(fallbacks).toEqual([{ flowId: "cx-7", error: "server unreachable (forced failure)" }]);
    // No re-read while backing off (poll serves the feed meanwhile).
    expect(reader.pendingCount()).toBe(0);
    expect(sleeper.waits).toHaveLength(1);
    subscriber.stop();
  });

  test("C57: after a failure the subscriber retries and flips back to stream on a successful read", async () => {
    const reader = deferredReader();
    const sleeper = controllableSleep();
    const fallbacks: string[] = [];
    const recovered: string[] = [];
    const subscriber = startEnvelopeStreamSubscriber({
      read: reader.read,
      longPollMs: 50,
      retryBaseMs: 100,
      retryMaxMs: 800,
      sleep: sleeper.sleep,
      onFallback: (flowId) => fallbacks.push(flowId),
      onRecover: (flowId) => recovered.push(flowId),
    });
    subscriber.follow(["cx-7"]);
    await tick();
    reader.failNext("cx-7", new Error("UNAVAILABLE: dex restarting"));
    await tick();
    expect(subscriber.mode("cx-7")).toBe("poll-fallback");
    expect(sleeper.waits.map((w) => w.ms)).toEqual([100]);

    sleeper.releaseNext(); // dex is back: the backoff elapses
    await tick();
    expect(reader.pendingCount()).toBe(1); // the loop re-armed its long-poll
    reader.resolveNext("cx-7", streamMessage());
    await tick();
    expect(subscriber.mode("cx-7")).toBe("stream");
    expect(recovered).toEqual(["cx-7"]);
    expect(subscriber.size("cx-7")).toBe(1);
    expect(subscriber.modes()).toEqual({ "cx-7": "stream" });

    // A NEW failure streak announces the fallback again.
    reader.failNext("cx-7", new Error("UNAVAILABLE again"));
    await tick();
    expect(fallbacks).toEqual(["cx-7", "cx-7"]);
    subscriber.stop();
  });

  test("C57: backoff is bounded and onFallback fires once per failure streak, not per retry", async () => {
    const reader = deferredReader();
    const sleeper = controllableSleep();
    const fallbacks: string[] = [];
    const subscriber = startEnvelopeStreamSubscriber({
      read: reader.read,
      retryBaseMs: 100,
      retryMaxMs: 800,
      sleep: sleeper.sleep,
      onFallback: (flowId) => fallbacks.push(flowId),
    });
    subscriber.follow(["cx-7"]);
    await tick();
    for (let i = 0; i < 5; i += 1) {
      reader.failNext("cx-7", new Error(`still down ${i}`));
      await tick();
      sleeper.releaseNext();
      await tick();
    }
    expect(sleeper.waitLog).toEqual([100, 200, 400, 800, 800]);
    expect(fallbacks).toEqual(["cx-7"]);
    expect(subscriber.mode("cx-7")).toBe("poll-fallback");
    subscriber.stop();
  });

  test("C57: a long-poll wake-up after a failure also counts as recovered (the connection works)", async () => {
    const reader = deferredReader();
    const sleeper = controllableSleep();
    const subscriber = startEnvelopeStreamSubscriber({ read: reader.read, sleep: sleeper.sleep });
    subscriber.follow(["cx-7"]);
    await tick();
    reader.failNext("cx-7", new Error("down"));
    await tick();
    sleeper.releaseNext();
    await tick();
    reader.failNext("cx-7", Object.assign(new Error("idle"), { subStatus: "longPollTimeout" }));
    await tick();
    expect(subscriber.mode("cx-7")).toBe("stream");
    subscriber.stop();
  });

  test("C57: stop() or dropping the flow while backing off ends the loop (no read afterwards)", async () => {
    const reader = deferredReader();
    const sleeper = controllableSleep();
    const subscriber = startEnvelopeStreamSubscriber({ read: reader.read, sleep: sleeper.sleep });
    subscriber.follow(["cx-7", "cx-6"]);
    await tick();
    reader.failNext("cx-7", new Error("down"));
    reader.failNext("cx-6", new Error("down"));
    await tick();
    expect(sleeper.waits).toHaveLength(2);
    subscriber.follow(["cx-7"]); // cx-6 leaves the selection while backing off
    subscriber.stop(); // and everything stops
    sleeper.releaseNext();
    sleeper.releaseNext();
    await tick();
    expect(reader.pendingCount()).toBe(0);
  });

  test("the per-flow ring buffer is bounded (oldest dropped)", async () => {
    const reader = deferredReader();
    const subscriber = startEnvelopeStreamSubscriber({ read: reader.read, bufferLimit: 2 });
    subscriber.follow(["cx-7"]);
    await tick();
    for (let i = 1; i <= 3; i += 1) {
      reader.resolveNext("cx-7", streamMessage({ eventKey: `ev-${i}` }));
      await tick();
    }
    expect(subscriber.size("cx-7")).toBe(2);
    expect(subscriber.recentEvents("cx-7")[0]?.eventKey).toBe("ev-2");
    expect(subscriber.recentEvents("cx-7")[1]?.eventKey).toBe("ev-3");
    subscriber.stop();
  });

  test("follow() stops loops for flows that left the selection", async () => {
    const reader = deferredReader();
    const subscriber = startEnvelopeStreamSubscriber({ read: reader.read });
    subscriber.follow(["cx-7", "cx-6"]);
    await tick();
    expect(reader.pendingCount()).toBe(2); // one live long-poll per followed flow
    subscriber.follow(["cx-7"]); // cx-6 dropped
    await tick();
    expect(subscriber.mode("cx-6")).toBe("poll-fallback"); // no longer followed
    expect(subscriber.mode("cx-7")).toBe("stream");
    // cx-6's dangling long-poll may still be in flight; once it settles the
    // deactivated loop must NOT re-read (only cx-7 re-arms).
    reader.resolveNext("cx-6", streamMessage({ flowId: "cx-6" }));
    await tick();
    expect(reader.pendingCount()).toBe(1); // only the selection's loop remains
    subscriber.stop();
  });
});

// ---------------------------------------------------------------------------
// Feed conversion + AC-D end-to-end (rendered payload)
// ---------------------------------------------------------------------------

describe("stream feed conversion + AC-D end-to-end (/api/state payload)", () => {
  test("feedFromStreamMessages maps stream events exactly like durable envelope upserts", () => {
    const entries = feedFromStreamMessages([streamMessage()]);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({
      flowId: "cx-7",
      stepId: "pp-queue-verify",
      role: "queue",
      attempt: 1,
      outcome: "completed",
      tokensRequired: false,
    });
    // A model-role event requires tokens (envelope contract, local mirror).
    const review = feedFromStreamMessages([
      streamMessage({
        eventKey: "pp-review-a#2",
        event: {
          stepId: "pp-review-a",
          role: "review",
          file: null,
          round: null,
          attempt: 2,
          started_at: "2026-09-27T01:01:00.000Z",
          ended_at: "2026-09-27T01:02:00.000Z",
          outcome: "completed",
          tokens: {
            input_tokens: 10,
            output_tokens: 5,
            reasoning_tokens: 1,
            cache_read_tokens: 4,
            cache_write_tokens: 0,
            cost_usd: 0,
          },
          wall_clock_ms: 60_000,
          identity: null,
        },
      }),
    ]);
    expect(review[0]?.tokensRequired).toBe(true);
    expect(review[0]?.usage?.input).toBe(10);
    expect(review[0]?.usage?.cacheRead).toBe(4);
    // Malformed event payloads are shape-checked out, never cast.
    expect(feedFromStreamMessages([streamMessage({ event: { garbage: true } })])).toEqual([]);
  });

  test("AC-D: published event -> subscriber -> present in the /api/state feed payload", () => {
    const streamFeed = [streamMessage()];
    const state = buildDashboardState({
      now: "2026-09-27T01:03:00.000Z",
      dex: {
        available: true,
        error: null,
        detail: "dexcli@test",
        flows: [flowSummary("cx-7")],
        states: {},
        histories: {}, // poll path has NOTHING yet — the stream delivered it
      },
      git: { available: false, error: null, repoRoot: "/tmp/pk-cx7", commits: [], worktrees: [] },
      killEvents: { available: false, error: null, filesScanned: [], events: [] },
      burnDownFiles: [],
      streamFeed,
      feedLimit: 80,
      commitLimit: 40,
    });
    const rendered = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(rendered.feed.length).toBe(1);
    expect(rendered.feed[0]).toMatchObject({
      flowId: "cx-7",
      stepId: "pp-queue-verify",
      outcome: "completed",
    });
  });

  test("a stream-delivered event and its polled twin appear ONCE (dedup)", () => {
    const envelopeEvent = streamMessage().event as Record<string, unknown>;
    const state = buildDashboardState({
      now: "2026-09-27T01:03:00.000Z",
      dex: {
        available: true,
        error: null,
        detail: "dexcli@test",
        flows: [flowSummary("cx-7")],
        states: {
          "cx-7": {
            activeStepExecutions: [],
            attributes: [{ key: "envelope-event/pp-queue-verify#1", value: envelopeEvent }],
          },
        },
        histories: {},
      },
      git: { available: false, error: null, repoRoot: "/tmp/pk-cx7", commits: [], worktrees: [] },
      killEvents: { available: false, error: null, filesScanned: [], events: [] },
      burnDownFiles: [],
      streamFeed: [streamMessage()],
      feedLimit: 80,
      commitLimit: 40,
    });
    const queueEntries = state.feed.filter((e) => e.stepId === "pp-queue-verify");
    expect(queueEntries.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C52: stream messages are UPSERTS (start row -> completion row)
// ---------------------------------------------------------------------------

describe("C52: stream start + completion upsert (the feed never sticks on the in-flight row)", () => {
  const reviewStart = {
    stepId: "pp-review-a",
    role: "review",
    file: null,
    round: null,
    attempt: 1,
    started_at: "2026-09-27T01:10:00.000Z",
    ended_at: null,
    outcome: "interrupted",
    tokens: null,
    wall_clock_ms: null,
    identity: null,
  };
  const reviewDone = {
    ...reviewStart,
    ended_at: "2026-09-27T01:12:00.000Z",
    outcome: "completed",
    tokens: 4_321,
    wall_clock_ms: 120_000,
  };
  const message = (event: Record<string, unknown>): StreamEventMessage =>
    streamMessage({ eventKey: "pp-review-a#1", event });

  function feedFor(input: {
    states?: Record<string, { activeStepExecutions: []; attributes: Array<{ key: string; value: unknown }> }>;
    histories?: Record<string, import("../src/dashboard/types.js").DexHistoryWire>;
    streamFeed: StreamEventMessage[];
  }) {
    return buildDashboardState({
      now: "2026-09-27T01:13:00.000Z",
      dex: {
        available: true,
        error: null,
        detail: "dexcli@test",
        flows: [flowSummary("cx-7")],
        states: input.states ?? {},
        histories: input.histories ?? {},
      },
      git: { available: false, error: null, repoRoot: "/tmp/pk-cx7", commits: [], worktrees: [] },
      killEvents: { available: false, error: null, filesScanned: [], events: [] },
      burnDownFiles: [],
      streamFeed: input.streamFeed,
      feedLimit: 80,
      commitLimit: 40,
    }).feed;
  }

  test("a stream start followed by its completion yields ONE completed row", () => {
    const feed = feedFor({ streamFeed: [message(reviewStart), message(reviewDone)] });
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ outcome: "completed", tokens: 4_321, wallClockMs: 120_000 });
    expect(feed[0]?.endedAt).toBe("2026-09-27T01:12:00.000Z");
  });

  test("a polled in-flight row is replaced by the stream completion (file/round from the poll survive)", () => {
    const feed = feedFor({
      states: { "cx-7": { activeStepExecutions: [], attributes: [{ key: "envelope-event/pp-review-a#1", value: reviewStart }] } },
      histories: {
        "cx-7": {
          flowId: "cx-7",
          runId: "run-cx-7",
          events: [
            {
              eventId: "1",
              eventTime: "2026-09-27T01:09:00.000Z",
              type: "StepExecuteCompleted",
              payload: {
                output: {
                  stepDecision: {
                    nextSteps: [{ stepType: "PpReviewA", stepInput: { file: "src/A.php", round: 2, epoch: 1 } }],
                  },
                  upsertAttributes: [],
                },
              },
            },
            {
              eventId: "2",
              eventTime: "2026-09-27T01:10:01.000Z",
              type: "StepExecuteCompleted",
              payload: { output: { upsertAttributes: [{ key: "envelope-event/pp-review-a#1", value: reviewStart }] } },
            },
          ],
        },
      },
      streamFeed: [message(reviewDone)],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ outcome: "completed", tokens: 4_321, file: "src/A.php", round: 2 });
  });

  test("a polled completed row is never overwritten by a late stream start", () => {
    const feed = feedFor({
      states: { "cx-7": { activeStepExecutions: [], attributes: [{ key: "envelope-event/pp-review-a#1", value: reviewDone }] } },
      streamFeed: [message(reviewStart)],
    });
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ outcome: "completed", tokens: 4_321 });
  });

  test("a completion is not downgraded by a later-delivered start in the same stream buffer", () => {
    const feed = feedFor({ streamFeed: [message(reviewDone), message(reviewStart)] });
    expect(feed).toHaveLength(1);
    expect(feed[0]?.outcome).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Projection-only boundary (streams are never read by control flow)
// ---------------------------------------------------------------------------

describe("US-007 projection-only boundary: streams are never read for correctness", () => {
  test("control-flow modules contain no stream reads (readStream/listStreamMessages)", () => {
    const controlRoots = ["flows", join("src", "git"), join("src", "queues")];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts")) {
          const src = readFileSync(join(ROOT, p), "utf8");
          if (/readStream|listStreamMessages/.test(src)) offenders.push(p);
        }
      }
    };
    for (const r of controlRoots) walk(r);
    expect(offenders).toEqual([]);
  });

  test("the durable envelope attribute remains the only correctness source (comment contract intact)", () => {
    const envelope = readFileSync(join(ROOT, "flows", "steps", "envelope.ts"), "utf8");
    expect(envelope).toContain("the durable envelope-event attribute remains the only");
    // Stream consumers exist ONLY in the projection layer.
    for (const allowed of [
      join("src", "dashboard", "queries.ts"),
      join("scripts", "serve-status.ts"),
      join("scripts", "watch-queue-verify.ts"),
    ]) {
      expect(readFileSync(join(ROOT, allowed), "utf8")).toMatch(/readStream/);
    }
    // The watcher core takes an INJECTED source — no direct SDK read.
    const core = readFileSync(join(ROOT, "src", "watcher", "queue-verify-watcher.ts"), "utf8");
    expect(core).not.toMatch(/readStream/);
  });

  test("parseEnvelope shape-checks (boundary defense for the unknown-typed stream event)", () => {
    expect(parseEnvelope({ stepId: "s", role: "review", attempt: 1, started_at: "x", outcome: "completed" })).not.toBeNull();
    expect(parseEnvelope(null)).toBeNull();
    expect(parseEnvelope({})).toBeNull();
  });
});
