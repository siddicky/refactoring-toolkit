/**
 * Snapshot assembly + flow selection, through injected DexQueries/GitQueries
 * doubles (no server, no dexcli spawn).
 */

import { describe, expect, test } from "bun:test";

import { CLIENT_POLL_MS, configFromEnv, type StatusConfig } from "./config.js";
import { selectFlows } from "./flow-select.js";
import { ok, type DexQueries, type GitQueries } from "./queries.js";
import { HISTORY_TTL_MS, SEARCH_TTL_MS, STATE_TTL_MS, createSnapshotter } from "./snapshot.js";
import { sortFlowsNewestFirst } from "./state.js";
import type { DexFlowSummaryWire, DexHistoryWire, DexStateWire } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const T0 = Date.parse("2026-09-28T10:00:00.000Z");
const iso = (offsetSec: number) => new Date(T0 + offsetSec * 1000).toISOString();

function wireFlow(
  flowId: string,
  flowType: string,
  status: "RUNNING" | "COMPLETED" | "TERMINATED",
  startOffsetSec: number,
): DexFlowSummaryWire {
  return {
    flowId,
    flowType,
    flowStatus: `FLOW_STATUS_${status}`,
    flowStatusCode: status === "RUNNING" ? 1 : 2,
    runId: `run-${flowId}`,
    startTime: iso(startOffsetSec),
  };
}

const parent = (id = "cx-5", startOffsetSec = 0, status: "RUNNING" | "COMPLETED" = "RUNNING") =>
  wireFlow(id, "port.Project", status, startOffsetSec);
const child = (parentId: string, n: number, status: "RUNNING" | "COMPLETED" = "COMPLETED") =>
  wireFlow(`SubFlow:${parentId}-PpWaveJoin-1-${n}`, "port.File", status, 10 + n);

/** The parent owns pp-queue / pp-lease (the attributes the headline + grid need). */
const PARENT_STATE: DexStateWire = {
  activeStepExecutions: [],
  attributes: [
    {
      key: "pp-queue/queue",
      value: {
        pending: ["src/C.php"],
        current: { file: "src/B.php", round: 1, epoch: 1 },
        done: [{ file: "src/A.php", round: 1, commitSha: "abc" }],
        blocked: [],
      },
    },
    {
      key: "pp-lease/pool",
      value: {
        "src/B.php": {
          file: "src/B.php",
          worktreePath: "/tmp/pk-x/.worktrees/src__B.php-1",
          branch: "lease/src__B.php/1",
          epoch: 1,
          baseSha: "deadbeef",
          holderExecutionId: "pp-1",
          acquiredAtUtc: iso(5),
        },
      },
    },
  ],
};

function config(over: Partial<StatusConfig> = {}): StatusConfig {
  return { ...configFromEnv({}), killEventFiles: [], burnDownFiles: [], ...over };
}

interface Calls {
  search: number;
  state: string[];
  history: string[];
}

function fakeDex(
  flows: DexFlowSummaryWire[],
  states: Record<string, DexStateWire> = {},
): { dex: DexQueries; calls: Calls } {
  const calls: Calls = { search: 0, state: [], history: [] };
  const dex: DexQueries = {
    async searchFlows() {
      calls.search += 1;
      return ok({ flows });
    },
    async flowState(flowId) {
      calls.state.push(flowId);
      return ok(states[flowId] ?? { activeStepExecutions: [], attributes: [] });
    },
    async flowHistory(flowId) {
      calls.history.push(flowId);
      const history: DexHistoryWire = { flowId, runId: `run-${flowId}`, events: [] };
      return ok(history);
    },
  };
  return { dex, calls };
}

const fakeGit: GitQueries = {
  async logAll() {
    return ok([]);
  },
  async worktrees() {
    return ok([]);
  },
};

// ---------------------------------------------------------------------------
// selectFlows
// ---------------------------------------------------------------------------

describe("selectFlows (C51): priority, not raw recency", () => {
  test("the premise: a newest-N cut evicts the parent once > N SubFlow children exist", () => {
    const flows = [parent(), ...Array.from({ length: 14 }, (_, i) => child("cx-5", i))];
    const naive = sortFlowsNewestFirst(flows).slice(0, 12);
    expect(naive.some((f) => f.flowId === "cx-5")).toBe(false); // the old serve-status behaviour
  });

  test("the running parent survives 14 newer SubFlow children; children are capped separately", () => {
    const flows = [parent(), ...Array.from({ length: 14 }, (_, i) => child("cx-5", i))];
    const selected = selectFlows(flows, { maxFlows: 12, maxChildFlows: 8 });
    expect(selected.map((f) => f.flowId)).toContain("cx-5");
    expect(selected.filter((f) => f.flowId.startsWith("SubFlow:"))).toHaveLength(8);
    expect(selected.length).toBeLessThanOrEqual(12);
  });

  test("the result stays newest-first", () => {
    const flows = [parent(), ...Array.from({ length: 5 }, (_, i) => child("cx-5", i))];
    const selected = selectFlows(flows, { maxFlows: 12 });
    const times = selected.map((f) => Date.parse(f.startTime));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  test("RUNNING children are preferred over completed ones when the child cap bites", () => {
    const flows = [
      parent(),
      ...Array.from({ length: 6 }, (_, i) => child("cx-5", i, "COMPLETED")),
      child("cx-5", 90, "RUNNING"), // oldest-by-id but running
    ];
    // Make the running child the OLDEST so recency alone would drop it.
    flows[flows.length - 1] = { ...flows[flows.length - 1]!, startTime: iso(1) };
    const selected = selectFlows(flows, { maxFlows: 12, maxChildFlows: 2 });
    expect(selected.map((f) => f.flowId)).toContain("SubFlow:cx-5-PpWaveJoin-1-90");
    expect(selected.filter((f) => f.flowId.startsWith("SubFlow:"))).toHaveLength(2);
  });

  test("the newest port.Project runs are always kept; older ones and probe flows fill the rest", () => {
    const flows = [
      parent("run-1", 0, "COMPLETED"),
      parent("run-2", 100, "COMPLETED"),
      parent("run-3", 200, "COMPLETED"),
      parent("run-4", 300),
      wireFlow("probe-x", "probe.PortRound", "TERMINATED", 400),
      ...Array.from({ length: 20 }, (_, i) => child("run-4", i)),
    ];
    const ids = selectFlows(flows, { maxFlows: 5, maxChildFlows: 1, maxParentFlows: 3 }).map((f) => f.flowId);
    expect(ids).toEqual(expect.arrayContaining(["run-4", "run-3", "run-2"]));
    expect(ids).not.toContain("run-1"); // beyond the parent cap
    expect(ids).toHaveLength(5);
  });

  test("maxFlows 1 keeps only the newest port.Project", () => {
    const flows = [parent("old", 0, "COMPLETED"), parent("new", 50), child("new", 1)];
    expect(selectFlows(flows, { maxFlows: 1 }).map((f) => f.flowId)).toEqual(["new"]);
  });

  test("with no port.Project at all it degrades to recency (probe flows only)", () => {
    const flows = [wireFlow("p1", "probe.A", "TERMINATED", 0), wireFlow("p2", "probe.A", "TERMINATED", 10)];
    expect(selectFlows(flows, { maxFlows: 1 }).map((f) => f.flowId)).toEqual(["p2"]);
  });

  test("maxChildFlows 0 selects no children", () => {
    const flows = [parent(), child("cx-5", 1), child("cx-5", 2)];
    expect(selectFlows(flows, { maxFlows: 12, maxChildFlows: 0 }).map((f) => f.flowId)).toEqual(["cx-5"]);
  });

  test("empty input and a non-positive budget never throw", () => {
    expect(selectFlows([], { maxFlows: 12 })).toEqual([]);
    expect(selectFlows([parent()], { maxFlows: 0 })).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// snapshot through the injected doubles
// ---------------------------------------------------------------------------

describe("createSnapshotter (C51): parent headline/queue/leases survive a wave of children", () => {
  test("14 newer SubFlow children do not evict the parent's headline, queue summary or lease rows", async () => {
    const flows = [parent(), ...Array.from({ length: 14 }, (_, i) => child("cx-5", i))];
    const { dex, calls } = fakeDex(flows, { "cx-5": PARENT_STATE });
    const snapshot = createSnapshotter({ cfg: config(), dex, git: fakeGit, now: () => new Date(iso(60)) });

    const state = await snapshot();

    expect(state.flows.map((f) => f.flowId)).toContain("cx-5");
    expect(state.flows.length).toBeLessThanOrEqual(12);
    expect(state.headline.startsWith("◆ cx-5:")).toBe(true);
    expect(state.headline).toContain("1/3 files"); // done 1 of (done 1 + current 1 + pending 1)
    expect(state.headlineState).toBe("running");
    expect(state.queueSummaries.map((q) => q.flowId)).toEqual(["cx-5"]);
    expect(state.grid.some((r) => r.kind === "lease" && r.file === "src/B.php" && r.flowId === "cx-5")).toBe(true);
    expect(calls.state).toContain("cx-5"); // the parent's state was actually queried
    expect(state.generatedAt).toBe(iso(60));
  });

  test("the dex detail string reads <bin>@<server> (no duplicated 'dexcli')", async () => {
    const { dex } = fakeDex([parent()], { "cx-5": PARENT_STATE });
    const snapshot = createSnapshotter({ cfg: config(), dex, git: fakeGit });
    const state = await snapshot();
    expect(state.sources.dex.detail).toBe("dexcli@127.0.0.1:8801");
  });

  test("a failing dex search degrades to an unavailable source instead of throwing", async () => {
    const dex: DexQueries = {
      async searchFlows() {
        return { ok: false, error: "connect ECONNREFUSED" };
      },
      async flowState() {
        return { ok: false, error: "x" };
      },
      async flowHistory() {
        return { ok: false, error: "x" };
      },
    };
    const state = await createSnapshotter({ cfg: config(), dex, git: fakeGit })();
    expect(state.sources.dex).toMatchObject({ available: false, error: "connect ECONNREFUSED" });
    expect(state.flows).toEqual([]);
  });

  test("C58: concurrent snapshots share ONE in-flight query per source (no spawn storm)", async () => {
    const flows = [parent("cx-5"), parent("cx-6", 100)];
    const { dex, calls } = fakeDex(flows, { "cx-5": PARENT_STATE });
    // Make every query slow enough that all three requests overlap.
    const slow: DexQueries = {
      async searchFlows() {
        await Bun.sleep(15);
        return dex.searchFlows();
      },
      async flowState(id) {
        await Bun.sleep(15);
        return dex.flowState(id);
      },
      async flowHistory(id) {
        await Bun.sleep(15);
        return dex.flowHistory(id);
      },
    };
    const snapshot = createSnapshotter({ cfg: config(), dex: slow, git: fakeGit });
    await Promise.all([snapshot(), snapshot(), snapshot()]);
    expect(calls.search).toBe(1);
    expect(calls.state.slice().sort()).toEqual(["cx-5", "cx-6"]); // 1 per flow, not 3
    expect(calls.history.slice().sort()).toEqual(["cx-5", "cx-6"]);
  });

  test("C58: searchFlows, state and history are cached for a polling client (TTL >= poll interval)", async () => {
    const { dex, calls } = fakeDex([parent("cx-5")], { "cx-5": PARENT_STATE });
    let clock = T0;
    const snapshot = createSnapshotter({ cfg: config(), dex, git: fakeGit, now: () => new Date(clock) });
    await snapshot();
    clock += CLIENT_POLL_MS; // the next poll of a single client, one interval later
    await snapshot();
    expect(calls.search).toBe(1);
    expect(calls.state).toEqual(["cx-5"]);
    expect(calls.history).toEqual(["cx-5"]);
    clock += 10_000; // well past every TTL
    await snapshot();
    expect(calls.search).toBe(2);
    expect(calls.state).toEqual(["cx-5", "cx-5"]);
    expect(calls.history).toEqual(["cx-5", "cx-5"]);
  });

  test("C58: the cache TTLs are not shorter than the client poll interval", () => {
    expect(STATE_TTL_MS).toBeGreaterThanOrEqual(CLIENT_POLL_MS);
    expect(SEARCH_TTL_MS).toBeGreaterThanOrEqual(CLIENT_POLL_MS);
    expect(HISTORY_TTL_MS).toBeGreaterThanOrEqual(CLIENT_POLL_MS);
  });

  test("C58: state and history are fetched in one round (history starts before state resolves)", async () => {
    const { dex: base, calls } = fakeDex([parent("cx-5")], { "cx-5": PARENT_STATE });
    let releaseState: () => void = () => {};
    const stateGate = new Promise<void>((resolve) => {
      releaseState = resolve;
    });
    const dex: DexQueries = {
      searchFlows: () => base.searchFlows(),
      async flowState(id) {
        await stateGate;
        return base.flowState(id);
      },
      flowHistory: (id) => base.flowHistory(id),
    };
    const pending = createSnapshotter({ cfg: config(), dex, git: fakeGit })();
    await Bun.sleep(10);
    // State is still blocked, yet history was already requested (no serial rounds).
    expect(calls.history).toEqual(["cx-5"]);
    releaseState();
    await pending;
  });

  test("C58: cache entries of flows that left the selection are evicted", async () => {
    const first = [parent("cx-5"), parent("cx-6", 100)];
    let flows = first;
    const dex: DexQueries = {
      async searchFlows() {
        return ok({ flows });
      },
      async flowState() {
        return ok({ activeStepExecutions: [], attributes: [] });
      },
      async flowHistory(flowId) {
        return ok({ flowId, runId: "r", events: [] });
      },
    };
    let clock = T0;
    const snapshot = createSnapshotter({ cfg: config(), dex, git: fakeGit, now: () => new Date(clock) });
    await snapshot();
    expect(snapshot.cacheSizes()).toEqual({ state: 2, history: 2 });
    flows = [parent("cx-6", 100)]; // cx-5 is gone from dex
    clock += 10_000; // search cache expired
    await snapshot();
    expect(snapshot.cacheSizes()).toEqual({ state: 1, history: 1 });
  });

  test("STATUS_MAX_FLOWS / STATUS_MAX_CHILD_FLOWS from the environment bound the drill-down", async () => {
    const flows = [parent(), ...Array.from({ length: 10 }, (_, i) => child("cx-5", i))];
    const { dex, calls } = fakeDex(flows, { "cx-5": PARENT_STATE });
    const cfg = config({ maxFlows: 4, maxChildFlows: 2 });
    await createSnapshotter({ cfg, dex, git: fakeGit })();
    expect(calls.state).toHaveLength(3); // parent + 2 children
    expect(calls.state).toContain("cx-5");
  });
});
