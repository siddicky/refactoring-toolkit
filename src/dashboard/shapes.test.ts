/**
 * End-to-end over the shapes the live flow really emits (audit C63): a
 * parallel run (parent + SubFlow children), attempt-0 start markers, per-
 * iteration total + per-file burn-down rows with ran/not-run accounting,
 * terminated/canceled port flows and a stream start+completion pair, all
 * pushed through the extracted snapshot with injected DexQueries doubles.
 */

import { describe, expect, test } from "bun:test";

import { configFromEnv } from "./config.js";
import { ok, type DexQueries, type EnvelopeStreamSubscriber, type GitQueries } from "./queries.js";
import { createSnapshotter } from "./snapshot.js";
import {
  BURN_DOWN_FLOW_ROWS,
  ENVELOPE_REAL_ATTEMPT,
  ENVELOPE_START_MARKER,
  FLOW_CANCELED_PORT,
  FLOW_TERMINATED_PORT,
  STREAM_REVIEW_START_AND_DONE,
  parallelRunFlows,
} from "./testdata.js";
import type { DexFlowSummaryWire, DexHistoryWire, DexStateWire, StreamEventMessage } from "./types.js";

const git: GitQueries = {
  async logAll() {
    return ok([]);
  },
  async worktrees() {
    return ok([]);
  },
};

/** The parent's durable history: marker + real envelope, then the burn-down rows. */
function parentHistory(flowId: string): DexHistoryWire {
  const upsert = (key: string, value: unknown) => ({ key, value });
  return {
    flowId,
    runId: `run-${flowId}`,
    events: [
      {
        eventId: "1",
        eventTime: "2026-09-30T10:05:00.000Z",
        type: "StepExecuteCompleted",
        payload: {
          // envelopeStartMarker key shape: <stepId>#0@start
          output: { upsertAttributes: [upsert("envelope-event/pp-implement#0@start", ENVELOPE_START_MARKER)] },
        },
      },
      {
        eventId: "2",
        eventTime: "2026-09-30T10:08:01.000Z",
        type: "StepExecuteCompleted",
        payload: { output: { upsertAttributes: [upsert("envelope-event/pp-implement#1", ENVELOPE_REAL_ATTEMPT)] } },
      },
      {
        eventId: "3",
        eventTime: "2026-09-30T10:20:00.000Z",
        type: "StepExecuteCompleted",
        payload: {
          output: {
            upsertAttributes: BURN_DOWN_FLOW_ROWS.map((row, i) => upsert(`queue-burndown/${row.queue}-${row.iteration}-${i}`, row)),
          },
        },
      },
    ],
  };
}

const PARENT_STATE: DexStateWire = {
  activeStepExecutions: [],
  attributes: [
    {
      key: "pp-queue/queue",
      value: { pending: ["src/C.php"], current: { file: "src/B.php", round: 1, epoch: 1 }, done: [{ file: "src/A.php", round: 1, commitSha: "abc" }], blocked: [] },
    },
  ],
};

function doubles(flows: DexFlowSummaryWire[]) {
  const dex: DexQueries = {
    async searchFlows() {
      return ok({ flows });
    },
    async flowState(flowId) {
      return ok(flowId === "cx-5" ? PARENT_STATE : { activeStepExecutions: [], attributes: [] });
    },
    async flowHistory(flowId) {
      return ok(flowId === "cx-5" ? parentHistory(flowId) : { flowId, runId: `run-${flowId}`, events: [] });
    },
  };
  return dex;
}

function stubSubscriber(messages: StreamEventMessage[]): EnvelopeStreamSubscriber {
  return {
    follow() {},
    recentEvents: (flowId) => (flowId === "cx-5" ? messages : []),
    mode: () => "stream",
    modes: () => ({ "cx-5": "stream" }),
    size: () => messages.length,
    stop() {},
  };
}

const cfg = () => ({ ...configFromEnv({}, "/w"), killEventFiles: [], burnDownFiles: [] });

describe("a mid-run parallel snapshot with every audited shape (C63)", () => {
  const flows = [...parallelRunFlows("cx-5", 14), FLOW_TERMINATED_PORT, FLOW_CANCELED_PORT];
  const messages: StreamEventMessage[] = STREAM_REVIEW_START_AND_DONE.map((m) => ({ ...m, topic: `port/${m.flowId}/events` }));

  async function snapshot() {
    return createSnapshotter({
      cfg: cfg(),
      dex: doubles(flows),
      git,
      getStream: () => stubSubscriber(messages),
      now: () => new Date("2026-09-30T10:30:00.000Z"),
    })();
  }

  test("the running parent stays the headline flow beside older terminated/canceled runs", async () => {
    const state = await snapshot();
    expect(state.flows.some((f) => f.flowId === "cx-5")).toBe(true);
    expect(state.headline.startsWith("◆ cx-5:")).toBe(true);
    expect(state.headlineState).toBe("running");
    expect(state.queueSummaries.map((q) => q.flowId)).toContain("cx-5");
    // The terminated/canceled runs are listed with their own statuses.
    expect(state.flows.find((f) => f.flowId === "cx-term")?.status).toBe("terminated");
    expect(state.flows.find((f) => f.flowId === "cx-cancel")?.status).toBe("canceled");
    // Every flow reports its live-feed source from the subscriber.
    expect(state.flows.find((f) => f.flowId === "cx-5")?.streamMode).toBe("stream");
  });

  test("the start marker renders neutral while the real attempt keeps the token requirement", async () => {
    const state = await snapshot();
    const implement = state.feed.filter((e) => e.stepId === "pp-implement");
    expect(implement.map((e) => [e.attempt, e.tokensRequired]).sort()).toEqual([
      [0, false],
      [1, true],
    ]);
  });

  test("burn-down: one aggregate point per iteration; not-run iterations carry reasons, never a 0", async () => {
    const state = await snapshot();
    const tsc = state.burnDown.find((s) => s.queue === "tsc");
    expect(tsc?.points).toHaveLength(2);
    expect(tsc?.points[0]).toMatchObject({ iteration: 1, errorCount: 12, state: "ran" });
    expect(tsc?.points[1]).toMatchObject({ iteration: 2, errorCount: null, state: "not-run" });
    expect(tsc?.points[1]?.reason).toContain("TS18003");
    const vitest = state.burnDown.find((s) => s.queue === "vitest");
    expect(vitest?.points[0]).toMatchObject({ errorCount: 2, state: "ran" });
    expect(vitest?.points[1]).toMatchObject({ errorCount: null, state: "not-run", reason: "runner unavailable" });
  });

  test("the stream start+completion pair yields ONE completed row and the real fresh-input split", async () => {
    const state = await snapshot();
    const reviews = state.feed.filter((e) => e.stepId === "pp-review-a");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ outcome: "completed", wallClockMs: 120000 });
    const review = state.agentUsage.find((u) => u.role === "review");
    expect(review).toMatchObject({ input: 329000, freshInput: 329000, cacheRead: 576000 }); // not clamped to 0
  });
});

describe("terminated / canceled headline (C63)", () => {
  test("with only a terminated port.Project the headline says terminated, never running", async () => {
    const state = await createSnapshotter({ cfg: cfg(), dex: doubles([FLOW_TERMINATED_PORT]), git })();
    expect(state.headline).toContain("terminated");
    expect(state.headline).not.toContain("running");
    expect(state.headlineState).toBe("terminated");
    const canceled = await createSnapshotter({ cfg: cfg(), dex: doubles([FLOW_CANCELED_PORT]), git })();
    expect(canceled.headlineState).toBe("canceled");
  });
});
