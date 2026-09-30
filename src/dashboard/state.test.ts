/**
 * Dashboard unit tests: pure aggregation over wire-shaped fixtures
 * (testdata.ts, modeled on live dexcli JSON + metrics fixture shapes) and
 * file-reader behavior for kill-event/burn-down sources.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  aggregateAgentUsage,
  buildDashboardState,
  burnDownSeries,
  deriveGridRows,
  feedFromState,
  killTimeline,
  lifecycleHeadline,
  lifecycleHeadlineView,
  normalizeTokens,
  parseEnvelope,
  parseQueueState,
  sortFlowsNewestFirst,
  stageLabel,
  walkHistory,
} from "./state.js";
import {
  normalizeBurnDown,
  readBurnDownFile,
  readKillEventsFile,
} from "./queries.js";
import type {
  DexFlowSummaryWire,
  DexHistoryEventWire,
  DexHistoryWire,
  DexStateWire,
  FeedEntry,
  FlowView,
  NormalizedKillEvent,
} from "./types.js";
import {
  BURN_DOWN_FILE_SAMPLES,
  FLOW_PROBE,
  FLOW_TRIAL,
  GIT_COMMITS,
  GIT_WORKTREES,
  HISTORY_PROBE,
  HISTORY_TRIAL,
  KILL_EVENT_A,
  KILL_EVENT_B,
  KILL_EVENT_C,
  STATE_PROBE,
  STATE_TRIAL,
} from "./testdata.js";

// ---------------------------------------------------------------------------
// Envelope parsing
// ---------------------------------------------------------------------------

describe("parseEnvelope / normalizeTokens", () => {
  test("parses the live flow-envelope shape (tokens as total number)", () => {
    const parsed = parseEnvelope({
      stepId: "pp-implement",
      role: "agent",
      file: null,
      round: null,
      attempt: 1,
      started_at: "2026-09-25T21:23:36.693Z",
      ended_at: "2026-09-25T21:26:38.981Z",
      outcome: "completed",
      tokens: 60921,
      wall_clock_ms: 182288,
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.role).toBe("agent");
    expect(parsed?.tokens).toBe(60921);
    expect(parsed?.tokensRequired).toBe(true);
  });

  test("accepts the metrics {input_tokens, output_tokens} shape", () => {
    expect(normalizeTokens({ input_tokens: 1200, output_tokens: 800 })).toBe(2000);
    expect(normalizeTokens(null)).toBeNull();
    expect(normalizeTokens("n/a")).toBeNull();
  });

  test("non-model roles are not token-required", () => {
    const parsed = parseEnvelope({ stepId: "pp-commit", role: "commit", attempt: 1, started_at: "x" });
    expect(parsed?.tokensRequired).toBe(false);
  });

  test("rejects garbage", () => {
    expect(parseEnvelope(null)).toBeNull();
    expect(parseEnvelope({ nope: true })).toBeNull();
  });

  test("C53: an attempt-0 start marker is never token-required (no false provenance failure)", () => {
    const marker = parseEnvelope({
      stepId: "pp-implement",
      role: "agent",
      file: null,
      round: null,
      attempt: 0,
      started_at: "2026-09-25T21:23:36.693Z",
      ended_at: null,
      outcome: "interrupted",
      tokens: null,
      wall_clock_ms: null,
    });
    expect(marker?.attempt).toBe(0);
    expect(marker?.tokens).toBeNull();
    expect(marker?.tokensRequired).toBe(false);
    // The real attempt of the same step still requires tokens.
    const real = parseEnvelope({
      stepId: "pp-implement",
      role: "agent",
      attempt: 1,
      started_at: "2026-09-25T21:23:36.693Z",
      tokens: null,
    });
    expect(real?.tokensRequired).toBe(true);
  });
});

describe("stageLabel", () => {
  test("maps pipeline step ids to human roles", () => {
    expect(stageLabel("pp-implement")).toBe("implementer");
    expect(stageLabel("pp-review-a")).toBe("reviewer-1");
    expect(stageLabel("pp-review-b")).toBe("reviewer-2");
    expect(stageLabel("pp-fixer")).toBe("fixer");
    expect(stageLabel("pp-commit")).toBe("commit");
    expect(stageLabel("pp-integrate")).toBe("integration");
  });

  test("maps dex step types (PpReviewA) through the same table", () => {
    expect(stageLabel("PpReviewA")).toBe("reviewer-1");
    expect(stageLabel("PpFixer")).toBe("fixer");
  });

  test("passes unknown step types through", () => {
    expect(stageLabel("ProbeLongSleep")).toBe("ProbeLongSleep");
  });
});

// ---------------------------------------------------------------------------
// History walk: context threading + feed
// ---------------------------------------------------------------------------

describe("walkHistory", () => {
  const trial = walkHistory(FLOW_TRIAL.flowId, HISTORY_TRIAL);

  test("threads file/round context onto envelope events (live envelopes carry null)", () => {
    const byStep = new Map(trial.feed.map((e) => [e.stepId, e]));
    // Before any file-bearing stepInput: file stays null.
    expect(byStep.get("pp-prep")?.file).toBeNull();
    // After the lease step's FileRoundInput: context applied.
    expect(byStep.get("pp-implement")?.file).toBe("src/Money.php");
    expect(byStep.get("pp-implement")?.round).toBe(1);
    expect(byStep.get("pp-commit")?.file).toBe("src/Money.php");
  });

  test("feed entries carry outcome/tokens/attempt from the envelope", () => {
    const implement = trial.feed.find((e) => e.stepId === "pp-implement");
    expect(implement?.outcome).toBe("completed");
    expect(implement?.tokens).toBe(60921);
    expect(implement?.attempt).toBe(1);
    expect(implement?.tokensRequired).toBe(true);
    const interrupted = trial.feed.find((e) => e.stepId === "pp-review-a");
    expect(interrupted?.endedAt).toBeNull();
    expect(interrupted?.outcome).toBe("interrupted");
  });

  test("collects dispatch rows with dex finalAttempt (0f anchor)", () => {
    const implement = trial.dispatch.find((d) => d.stepExecutionId === "PpImplement-1");
    expect(implement?.finalAttempt).toBe(1);
    expect(implement?.stepType).toBe("PpImplement");
  });

  test("collects burn-down samples only under burndown-ish keys", () => {
    expect(trial.burnDown).toHaveLength(1);
    expect(trial.burnDown[0]?.queue).toBe("tsc");
    expect(trial.burnDown[0]?.iteration).toBe(1);
  });

  test("flow-level probe events keep file null and never crash", () => {
    const probe = walkHistory(FLOW_PROBE.flowId, HISTORY_PROBE);
    expect(probe.feed).toHaveLength(1);
    expect(probe.feed[0]?.file).toBeNull();
    expect(probe.feed[0]?.attempt).toBe(7);
  });
});

describe("walkHistory file/round attribution at step boundaries (C64)", () => {
  const at = (n: number) => `2026-09-28T10:00:${String(n).padStart(2, "0")}.000Z`;
  const env = (stepId: string, role: string, n: number) => ({
    key: `envelope-event/${stepId}#1`,
    value: {
      stepId,
      role,
      file: null,
      round: null,
      attempt: 1,
      started_at: at(n),
      ended_at: at(n + 1),
      outcome: "completed",
      tokens: null,
      wall_clock_ms: 1,
    },
  });
  const step = (
    eventId: string,
    stepType: string,
    upserts: Array<ReturnType<typeof env>>,
    next?: { stepType: string; stepInput: Record<string, unknown> },
  ): DexHistoryEventWire => ({
    eventId,
    eventTime: at(Number(eventId)),
    type: "StepExecuteCompleted",
    payload: {
      context: { stepExecutionId: `${stepType}-${eventId}`, stepType, finalAttempt: 1 },
      output: {
        ...(next !== undefined ? { stepDecision: { nextSteps: [next] } } : {}),
        upsertAttributes: upserts,
      },
    },
  });
  const history = (events: DexHistoryEventWire[]): DexHistoryWire => ({
    flowId: "f",
    runId: "r",
    events,
  });
  const fileOf = (feed: FeedEntry[], stepId: string) => feed.find((e) => e.stepId === stepId)?.file;

  test("a completing step's envelope keeps ITS file; the next step's file applies afterwards", () => {
    const walked = walkHistory(
      "f",
      history([
        step("1", "PpLease", [], { stepType: "PpFence", stepInput: { file: "src/A.php", round: 1, epoch: 1 } }),
        step("2", "PpCommit", [env("pp-commit", "commit", 2)], {
          stepType: "PpRelease",
          stepInput: { file: "src/A.php", round: 1, epoch: 1 },
        }),
        // Release hands the NEXT file's lease to the following step.
        step("3", "PpRelease", [env("pp-release", "record", 3)], {
          stepType: "PpLease",
          stepInput: { file: "src/B.php", round: 1, epoch: 1 },
        }),
        step("4", "PpLease", [env("pp-lease", "record", 4)]),
      ]),
    );
    expect(fileOf(walked.feed, "pp-commit")).toBe("src/A.php");
    expect(fileOf(walked.feed, "pp-release")).toBe("src/A.php"); // was B before the fix
    expect(fileOf(walked.feed, "pp-lease")).toBe("src/B.php");
  });

  test("queue-verify -> queue-fix: the verify envelope is not pulled onto the first fix-round file", () => {
    const walked = walkHistory(
      "f",
      history([
        step("1", "PpBootstrap", []),
        step("2", "PpQueueVerify", [env("pp-queue-verify", "queue", 2)], {
          stepType: "PpQueueFix",
          stepInput: { file: "src/C.php", round: 2, epoch: 1 },
        }),
        step("3", "PpQueueFix", [env("pp-queue-fix", "agent", 3)]),
      ]),
    );
    expect(fileOf(walked.feed, "pp-queue-verify")).toBeNull(); // flow-level
    expect(fileOf(walked.feed, "pp-queue-fix")).toBe("src/C.php");
    expect(walked.feed.find((e) => e.stepId === "pp-queue-fix")?.round).toBe(2);
  });

  test("a step's own input (when the wire carries it) wins over the previous step's context", () => {
    const own = step("2", "PpCommit", [env("pp-commit", "commit", 2)]);
    own.payload.input = { stepInput: { file: "src/B.php", round: 3, epoch: 1 } };
    const walked = walkHistory(
      "f",
      history([
        step("1", "PpLease", [], { stepType: "PpFence", stepInput: { file: "src/A.php", round: 1, epoch: 1 } }),
        own,
      ]),
    );
    expect(fileOf(walked.feed, "pp-commit")).toBe("src/B.php");
    expect(walked.feed[0]?.round).toBe(3);
  });
});

describe("feedFromState (history-unavailable fallback)", () => {
  test("parses envelope attributes without context", () => {
    const res = feedFromState(FLOW_TRIAL.flowId, STATE_TRIAL);
    const commit = res.feed.find((e) => e.stepId === "pp-commit");
    expect(commit?.outcome).toBe("completed");
    expect(commit?.file).toBeNull(); // no context in state attributes
    expect(res.feed.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Grid derivation
// ---------------------------------------------------------------------------

describe("deriveGridRows", () => {
  // Newest-first, the order buildDashboardState passes after sorting.
  const flows = [
    { summary: FLOW_TRIAL, state: STATE_TRIAL },
    { summary: FLOW_PROBE, state: STATE_PROBE },
  ];
  const feedByFlow = new Map([
    [FLOW_TRIAL.flowId, walkHistory(FLOW_TRIAL.flowId, HISTORY_TRIAL).feed],
  ]);
  const rows = deriveGridRows(flows, GIT_WORKTREES, feedByFlow);

  test("emits a lease row with active step stage + failure note", () => {
    const row = rows.find((r) => r.kind === "lease" && r.file === "src/Pricing/FlatRateDiscount.php");
    expect(row).toBeDefined();
    expect(row?.stage).toBe("reviewer-1");
    expect(row?.attempt).toBe(2);
    expect(row?.inFlight).toBe(true);
    expect(row?.round).toBe(1);
    expect(row?.branch).toBe("lease/src__Pricing__FlatRateDiscount.php/1");
    expect(row?.clean).toBe(false);
    expect(row?.note ?? "").toContain("provenance failure");
  });

  test("falls back to feed-derived stage/attempt/outcome when no step is active", () => {
    const row = rows.find((r) => r.kind === "lease" && r.file === "src/Money.php");
    expect(row).toBeDefined();
    expect(row?.inFlight).toBe(false);
    expect(row?.round).toBe(1); // from queue.done
    expect(row?.stage).toBe("commit"); // newest feed entry for the file
    expect(row?.attempt).toBe(1);
    expect(row?.lastOutcome).toBe("completed");
    expect(row?.clean).toBe(true);
  });

  test("emits blocked rows from the queue", () => {
    const row = rows.find((r) => r.kind === "blocked");
    expect(row?.file).toBe("src/Util/Csv.php");
    expect(row?.note).toBe("round cap 1 exceeded");
    expect(row?.flowId).toBe(FLOW_TRIAL.flowId);
  });

  test("emits idle-worktree rows for unleased git worktrees", () => {
    const idle = rows.filter((r) => r.kind === "idle-worktree");
    const paths = idle.map((r) => r.worktree);
    // Both lease worktrees are claimed; only the main checkout is idle.
    expect(paths).toEqual(["/tmp/pk-trial"]);
    const main = idle.find((r) => r.worktree === "/tmp/pk-trial");
    expect(main?.branch).toBe("main");
    expect(main?.clean).toBe(true);
  });

  test("first-processed (newest) flow wins when two flows claim the same file", () => {
    const oldestFirst = [
      { summary: FLOW_PROBE, state: STATE_PROBE },
      { summary: FLOW_TRIAL, state: STATE_TRIAL },
    ];
    const rows2 = deriveGridRows(oldestFirst, [], new Map());
    const lease = rows2.find((r) => r.kind === "lease" && r.file === "src/Pricing/FlatRateDiscount.php");
    expect(lease?.flowId).toBe(FLOW_PROBE.flowId);
    expect(lease?.branch).toBe("lease/src__Pricing__FlatRateDiscount.php/9");
    // Exactly one row for the contested file.
    expect(rows2.filter((r) => r.file === "src/Pricing/FlatRateDiscount.php")).toHaveLength(1);
  });

  test("empty inputs produce zero rows without crashing", () => {
    expect(deriveGridRows([], [], new Map())).toEqual([]);
  });

  test("macOS /private path prefix does not duplicate worktree rows", () => {
    const macGit = GIT_WORKTREES.map((w) => ({ ...w, path: `/private${w.path}` }));
    const rows2 = deriveGridRows(flows, macGit, feedByFlow);
    const worktreeRows = rows2.filter((r) => r.kind !== "blocked");
    const names = worktreeRows.map((r) => r.worktreeName);
    // src__Money.php-1 appears exactly once (the lease row), not twice.
    expect(names.filter((n) => n === "src__Money.php-1")).toHaveLength(1);
    const money = rows2.find((r) => r.kind === "lease" && r.file === "src/Money.php");
    expect(money?.clean).toBe(true); // cleanliness matched across the prefix
  });
});

// ---------------------------------------------------------------------------
// Queue state parsing
// ---------------------------------------------------------------------------

describe("parseQueueState", () => {
  test("parses the live pp-queue attribute", () => {
    const q = parseQueueState({
      pending: ["src/B.php"],
      current: { file: "src/A.php", round: 2, epoch: 3 },
      done: [{ file: "src/C.php", round: 1, commitSha: "deadbeef" }],
      blocked: [{ file: "src/D.php", round: 1, reason: "cap" }],
    });
    expect(q?.current?.file).toBe("src/A.php");
    expect(q?.done[0]?.commitSha).toBe("deadbeef");
    expect(q?.blocked[0]?.reason).toBe("cap");
  });

  test("tolerates junk", () => {
    expect(parseQueueState(null)).toBeNull();
    expect(parseQueueState("x")).toBeNull();
    expect(parseQueueState({})?.current).toBeNull();
    expect(parseQueueState({ current: { file: "a" } })?.current?.round).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Burn-down series
// ---------------------------------------------------------------------------

describe("burnDownSeries", () => {
  test("groups by queue and sorts points by iteration", () => {
    const series = burnDownSeries([
      ...BURN_DOWN_FILE_SAMPLES,
      { queue: "tsc", file: null, iteration: 1, error_count: 3, recorded_at: "2026-09-25T21:26:39.100Z" },
    ]);
    const tsc = series.find((s) => s.queue === "tsc");
    expect(tsc?.points.map((p) => p.iteration)).toEqual([1, 2, 3]);
    expect(tsc?.points.map((p) => p.errorCount)).toEqual([3, 1, 0]);
    const vitest = series.find((s) => s.queue === "vitest");
    expect(vitest?.points).toHaveLength(1);
  });

  test("rejects non-queue junk", () => {
    expect(normalizeBurnDown({ queue: "eslint", iteration: 1, error_count: 1 }, "x")).toBeNull();
    expect(normalizeBurnDown({ queue: "tsc", iteration: "1", error_count: 1 }, "x")).toBeNull();
    expect(normalizeBurnDown(null, "x")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Kill timeline
// ---------------------------------------------------------------------------

describe("killTimeline", () => {
  test("groups by run, sorts entries by UTC, newest run first", () => {
    const groups = killTimeline([KILL_EVENT_B, KILL_EVENT_C, KILL_EVENT_A]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.runId).toBe("run-a-2026-09-25"); // newest first
    const runA = groups.find((g) => g.runId === "kill-2026-09-25-a");
    expect(runA?.entries[0]?.kind).toBe("intent");
    expect(runA?.entries[1]?.kind).toBe("completed");
    expect(runA?.entries[0]?.pids).toEqual([4242, 4243]);
  });

  test("drops events without a UTC timestamp (evidence chain requires it)", () => {
    const groups = killTimeline([{ ...KILL_EVENT_A, utc: "" }]);
    expect(groups).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Full aggregation
// ---------------------------------------------------------------------------

describe("buildDashboardState", () => {
  const base = {
    now: "2026-09-25T22:00:00.000Z",
    burnDownFiles: BURN_DOWN_FILE_SAMPLES,
    feedLimit: 80,
    commitLimit: 40,
  };

  test("aggregates all sections from live-shaped sources", () => {
    const state = buildDashboardState({
      ...base,
      dex: {
        available: true,
        error: null,
        detail: "dexcli@127.0.0.1:8801",
        flows: [FLOW_PROBE, FLOW_TRIAL],
        states: { [FLOW_TRIAL.flowId]: STATE_TRIAL, [FLOW_PROBE.flowId]: STATE_PROBE },
        histories: { [FLOW_TRIAL.flowId]: HISTORY_TRIAL, [FLOW_PROBE.flowId]: HISTORY_PROBE },
      },
      git: {
        available: true,
        error: null,
        repoRoot: "/tmp/pk-trial",
        commits: GIT_COMMITS,
        worktrees: GIT_WORKTREES,
      },
      killEvents: {
        available: true,
        error: null,
        filesScanned: ["/tmp/kill-events-phase0.jsonl", "metrics/kill-events.json"],
        events: [KILL_EVENT_A, KILL_EVENT_B, KILL_EVENT_C],
      },
    });

    expect(state.generatedAt).toBe(base.now);
    expect(state.sources.dex.available).toBe(true);
    expect(state.flows[0]?.flowId).toBe(FLOW_TRIAL.flowId); // newest first
    expect(state.flows[0]?.status).toBe("running");

    expect(state.grid.some((r) => r.kind === "lease")).toBe(true);
    expect(state.queueSummaries).toHaveLength(1); // only the port flow has pp-queue
    expect(state.queueSummaries[0]?.current?.file).toBe("src/Pricing/FlatRateDiscount.php");

    // Feed merged across flows, newest first.
    expect(state.feed.length).toBeGreaterThanOrEqual(6);
    for (let i = 1; i < state.feed.length; i++) {
      expect(Date.parse(state.feed[i - 1]?.ts ?? "")).toBeGreaterThanOrEqual(
        Date.parse(state.feed[i]?.ts ?? ""),
      );
    }

    expect(state.burnDown.some((s) => s.queue === "tsc" && s.points.length >= 3)).toBe(true);
    expect(state.commits[0]?.opId).toBe("src/Money.php#1");
    expect(state.killTimeline).toHaveLength(2);
  });

  test("feed respects the cap", () => {
    const state = buildDashboardState({
      ...base,
      feedLimit: 3,
      dex: {
        available: true,
        error: null,
        detail: null,
        flows: [FLOW_TRIAL],
        states: { [FLOW_TRIAL.flowId]: STATE_TRIAL },
        histories: { [FLOW_TRIAL.flowId]: HISTORY_TRIAL },
      },
      git: { available: true, error: null, repoRoot: "/tmp/pk-trial", commits: [], worktrees: [] },
      killEvents: { available: true, error: null, filesScanned: [], events: [] },
    });
    expect(state.feed).toHaveLength(3);
  });

  test("unavailable dex degrades to git-only rendering without crashing", () => {
    const state = buildDashboardState({
      ...base,
      dex: { available: false, error: "connect ECONNREFUSED", detail: "dexcli@127.0.0.1:8801", flows: [], states: {}, histories: {} },
      git: {
        available: true,
        error: null,
        repoRoot: "/tmp/pk-trial",
        commits: GIT_COMMITS,
        worktrees: GIT_WORKTREES,
      },
      killEvents: { available: false, error: "no sidecar files present", filesScanned: [], events: [] },
    });
    expect(state.sources.dex.available).toBe(false);
    expect(state.flows).toEqual([]);
    expect(state.feed).toEqual([]);
    expect(state.grid.every((r) => r.kind === "idle-worktree")).toBe(true);
    expect(state.grid.length).toBe(GIT_WORKTREES.length);
    expect(state.commits).toHaveLength(GIT_COMMITS.length);
    expect(state.killTimeline).toEqual([]);
    expect(state.burnDown.some((s) => s.queue === "tsc")).toBe(true); // file samples survive
  });

  test("sorts flows newest-first regardless of input order", () => {
    const sorted = sortFlowsNewestFirst([FLOW_PROBE, FLOW_TRIAL]);
    expect(sorted[0]?.flowId).toBe(FLOW_TRIAL.flowId);
  });
});

// ---------------------------------------------------------------------------
// File readers (queries.ts)
// ---------------------------------------------------------------------------

describe("kill-event / burn-down file readers", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dash-test-"));
  });

  afterAll(async () => {
    if (dir.length > 0) await rm(dir, { recursive: true, force: true });
  });

  test("reads a metrics-style {run_id, events:[...]} JSON file", async () => {
    const p = join(dir, "kill-events.json");
    await writeFile(
      p,
      JSON.stringify({
        run_id: "run-a-2026-09-25",
        events: [
          { kind: "kill-intent", run_id: "run-a-2026-09-25", utc: "2026-09-25T10:30:00.100Z", monotonic_ms: 4832100, target_pids: [4242] },
          { kind: "kill-completed", run_id: "run-a-2026-09-25", utc: "2026-09-25T10:31:00.500Z", monotonic_ms: 4892500, resumed: true, note: null },
        ],
      }),
      "utf8",
    );
    const res = await readKillEventsFile(p);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toHaveLength(2);
      expect(res.value[0]?.kind).toBe("intent");
      expect(res.value[1]?.resumed).toBe(true);
      expect(res.value[1]?.note).toBeNull();
    }
  });

  test("reads a chaos-kill JSONL sidecar, tolerating a torn tail line", async () => {
    const p = join(dir, "sidecar.jsonl");
    await writeFile(
      p,
      `{"kind":"intent","run_id":"k1","utc":"2026-09-25T20:45:00.100Z","monotonic_ms":1,"target_pids":[1,2],"signal":"SIGKILL","reason":"t"}\n` +
        `{"kind":"completed","run_id":"k1","utc":"2026-09-25T20:45:00.800Z","monotonic_ms":2,"killed_pids":[1],"notes":"done"}\n` +
        `{"kind":"intent","run_id":"k2","utc":"2026-09-25T20:4`, // torn write
      "utf8",
    );
    const res = await readKillEventsFile(p);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value).toHaveLength(2);
      expect(res.value[0]?.signal).toBe("SIGKILL");
      expect(res.value[1]?.note).toBe("done");
    }
  });

  test("missing file is a graceful error, not a throw", async () => {
    const res = await readKillEventsFile(join(dir, "absent.json"));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0);
  });

  test("burn-down file: JSON array and JSONL both parse; junk lines skipped", async () => {
    const arr = join(dir, "burn-down.json");
    await writeFile(
      arr,
      JSON.stringify([
        { queue: "tsc", file: "a.php", iteration: 1, error_count: 4, recorded_at: "2026-09-25T10:00:00Z" },
      ]),
      "utf8",
    );
    const resArr = await readBurnDownFile(arr);
    expect(resArr.ok && resArr.value).toHaveLength(1);

    const jsonl = join(dir, "burn-down.jsonl");
    await writeFile(
      jsonl,
      `{"queue":"vitest","file":"a.php","iteration":1,"error_count":2,"recorded_at":"2026-09-25T10:00:00Z"}\n{"queue":"nope"}\n`,
      "utf8",
    );
    const resJsonl = await readBurnDownFile(jsonl);
    expect(resJsonl.ok && resJsonl.value).toHaveLength(1);
    expect(resJsonl.ok && resJsonl.value[0]?.queue).toBe("vitest");
  });
});

// ---------------------------------------------------------------------------
// Wave-5: cost honesty (aggregateAgentUsage) + lifecycle headline
// ---------------------------------------------------------------------------

describe("aggregateAgentUsage (wave-5 cost honesty)", () => {
  const feedEntry = (over: Partial<import("./types.js").FeedEntry>): import("./types.js").FeedEntry => ({
    flowId: "f",
    ts: "2026-09-26T10:00:00Z",
    startedAt: "2026-09-26T10:00:00Z",
    endedAt: "2026-09-26T10:01:00Z",
    stepId: "pp-review-a",
    role: "review",
    file: null,
    round: null,
    attempt: 1,
    outcome: "completed",
    tokens: 100,
    usage: null,
    wallClockMs: 1000,
    tokensRequired: true,
    ...over,
  });

  test("splits cache/fresh per role; plan-authed lanes flag estimated", () => {
    const rows = aggregateAgentUsage([
      feedEntry({
        tokens: 300,
        usage: { input: 200, output: 10, reasoning: 20, cacheRead: 60, cacheWrite: 10, costUsd: 0 },
      }),
      feedEntry({ tokens: 90 }),
      feedEntry({ role: "agent", tokensRequired: true, tokens: 500, usage: { input: 400, output: 40, reasoning: 0, cacheRead: 20, cacheWrite: 40, costUsd: 0.012 } }),
    ]);
    expect(rows).toHaveLength(2);
    const review = rows.find((r) => r.role === "review");
    expect(review?.calls).toBe(2);
    expect(review?.input).toBe(200);
    expect(review?.cacheRead).toBe(60);
    expect(review?.estimated).toBe(true);
    expect(review?.costUsd).toBe(0);
    const agent = rows.find((r) => r.role === "agent");
    expect(agent?.costUsd).toBeCloseTo(0.012);
    expect(agent?.estimated).toBe(false);
  });

  test("attempt-0 markers and non-model roles are excluded", () => {
    const rows = aggregateAgentUsage([
      feedEntry({ attempt: 0, usage: { input: 5, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 } }),
      feedEntry({ role: "commit", tokensRequired: false, tokens: null }),
    ]);
    expect(rows).toHaveLength(0);
  });
});

describe("lifecycleHeadline (wave-5 lifecycle flip)", () => {
  const flow = (over: Partial<import("./types.js").FlowView>): import("./types.js").FlowView => ({
    flowId: "cx-5",
    flowType: "port.Project",
    status: "running",
    startTime: "2026-09-26T10:00:00Z",
    closeTime: null,
    runId: "r1",
    ...over,
  });
  const kill = (utc: string): import("./types.js").NormalizedKillEvent => ({
    source: "s", kind: "intent", runId: "r", utc, monotonicMs: 1, pids: [1],
    signal: "SIGKILL", reason: null, note: null, resumed: null,
  });

  test("running without kills", () => {
    const h = lifecycleHeadline({ flow: flow({}), filesDone: 2, filesTotal: 5, killEvents: [], dexAvailable: true, feed: [] });
    expect(h).toBe("◆ cx-5: 2/5 files · running");
  });

  test("kill while dex down -> killed; feed activity after kill -> resumed", () => {
    const kills = [kill("2026-09-26T10:30:00Z")];
    const down = lifecycleHeadline({ flow: flow({}), filesDone: 3, filesTotal: 5, killEvents: kills, dexAvailable: false, feed: [] });
    expect(down).toContain("killed");
    const feed = [{ flowId: "cx-5", startedAt: "2026-09-26T10:35:00Z" } as import("./types.js").FeedEntry];
    const up = lifecycleHeadline({ flow: flow({}), filesDone: 3, filesTotal: 5, killEvents: kills, dexAvailable: true, feed });
    expect(up).toContain("resumed");
  });

  test("completed with a survived kill", () => {
    const h = lifecycleHeadline({
      flow: flow({ status: "completed", closeTime: "2026-09-26T11:00:00Z" }),
      filesDone: 5, filesTotal: 5,
      killEvents: [kill("2026-09-26T10:30:00Z")],
      dexAvailable: true, feed: [],
    });
    expect(h).toBe("◆ cx-5: 5/5 files · completed (survived kill)");
  });

  test("no flow found", () => {
    expect(lifecycleHeadline({ flow: undefined, filesDone: 0, filesTotal: 0, killEvents: [], dexAvailable: true, feed: [] })).toBe("no port flow found");
  });

  test("C55: every non-running status is terminal and is printed, never 'running'", () => {
    const head = (status: string) =>
      lifecycleHeadline({ flow: flow({ status }), filesDone: 1, filesTotal: 5, killEvents: [], dexAvailable: true, feed: [] });
    expect(head("terminated")).toBe("◆ cx-5: 1/5 files · terminated");
    expect(head("canceled")).toBe("◆ cx-5: 1/5 files · canceled");
    expect(head("continued_as_new")).toBe("◆ cx-5: 1/5 files · continued-as-new");
    expect(head("server_side_timeout_internal_only")).toBe("◆ cx-5: 1/5 files · timed-out");
    expect(head("failed")).toBe("◆ cx-5: 1/5 files · failed");
    expect(head("running")).toBe("◆ cx-5: 1/5 files · running");
    for (const status of ["terminated", "canceled", "continued_as_new", "server_side_timeout_internal_only"]) {
      expect(head(status)).not.toContain("running");
    }
  });
});

describe("headline flow selection (C55)", () => {
  const base = {
    now: "2026-09-25T22:00:00.000Z",
    burnDownFiles: [],
    feedLimit: 80,
    commitLimit: 40,
    git: { available: false, error: null, repoRoot: "/tmp/pk-trial", commits: [], worktrees: [] },
    killEvents: { available: false, error: null, filesScanned: [], events: [] },
  };
  const probeNewer = { ...FLOW_PROBE, flowId: "round-x", startTime: "2026-09-25T23:30:00.000Z" };

  test("a newer probe.* flow does not hijack the headline from the port.Project flow", () => {
    const state = buildDashboardState({
      ...base,
      dex: {
        available: true, error: null, detail: null,
        flows: [FLOW_TRIAL, probeNewer],
        states: { [FLOW_TRIAL.flowId]: STATE_TRIAL },
        histories: {},
      },
    });
    expect(state.headline.startsWith(`◆ ${FLOW_TRIAL.flowId}:`)).toBe(true);
    expect(state.headline).toContain("2/3 files"); // the port flow's queue, not 0/0
  });

  test("falls back to the newest top-level flow when no port.Project exists (children never headline)", () => {
    const child = { ...FLOW_TRIAL, flowId: "SubFlow:trial-9-x-1", flowType: "port.File", startTime: "2026-09-25T23:45:00.000Z" };
    const state = buildDashboardState({
      ...base,
      dex: {
        available: true, error: null, detail: null,
        flows: [FLOW_PROBE, probeNewer, child],
        states: {},
        histories: {},
      },
    });
    expect(state.headline.startsWith("◆ round-x:")).toBe(true);
  });

  test("a terminated port.Project headlines as terminated", () => {
    const state = buildDashboardState({
      ...base,
      dex: {
        available: true, error: null, detail: null,
        flows: [{ ...FLOW_TRIAL, flowStatus: "FLOW_STATUS_TERMINATED", flowStatusCode: 5 }],
        states: { [FLOW_TRIAL.flowId]: STATE_TRIAL },
        histories: {},
      },
    });
    expect(state.headline).toContain("terminated");
    expect(state.headline).not.toContain("running");
  });
});

// ---------------------------------------------------------------------------
// C54: structured headline state (the client never regexes display text)
// ---------------------------------------------------------------------------

describe("lifecycleHeadlineView (C54 structured headline)", () => {
  const flow = (over: Partial<FlowView>): FlowView => ({
    flowId: "cx-5",
    flowType: "port.Project",
    status: "running",
    startTime: "2026-09-26T10:00:00Z",
    closeTime: null,
    runId: "r1",
    ...over,
  });
  const kill = (utc: string): NormalizedKillEvent => ({
    source: "s", kind: "intent", runId: "r", utc, monotonicMs: 1, pids: [1],
    signal: "SIGKILL", reason: null, note: null, resumed: null,
  });
  const args = { filesDone: 3, filesTotal: 5, dexAvailable: true, feed: [] as FeedEntry[] };

  test("a resumed headline is state 'resumed' even though its text contains the word 'killed'", () => {
    const feed = [{ flowId: "cx-5", startedAt: "2026-09-26T10:35:00Z" } as FeedEntry];
    const view = lifecycleHeadlineView({ ...args, flow: flow({}), killEvents: [kill("2026-09-26T10:30:00Z")], feed });
    expect(view.text).toContain("killed"); // the display text still says so...
    expect(view.state).toBe("resumed"); // ...the structured state is what the client styles from
    expect(view.degraded).toBe(false);
  });

  test("killed (dex down) and awaiting-resume are distinct states", () => {
    const kills = [kill("2026-09-26T10:30:00Z")];
    expect(lifecycleHeadlineView({ ...args, flow: flow({}), killEvents: kills, dexAvailable: false }).state).toBe("killed");
    expect(lifecycleHeadlineView({ ...args, flow: flow({}), killEvents: kills }).state).toBe("awaiting-resume");
    expect(lifecycleHeadlineView({ ...args, flow: flow({}), killEvents: [] }).state).toBe("running");
  });

  test("a completed headline with degraded rounds is completed + degraded (never a clean green)", () => {
    const view = lifecycleHeadlineView({
      ...args,
      flow: flow({ status: "completed" }),
      killEvents: [],
      degradedRounds: 2,
    });
    expect(view.text).toContain("completed");
    expect(view.text).toContain("DEGRADED (2 unreviewed rounds)");
    expect(view.state).toBe("completed");
    expect(view.degraded).toBe(true);
    expect(lifecycleHeadlineView({ ...args, flow: flow({ status: "completed" }), killEvents: [] }).degraded).toBe(false);
  });

  test("a flow id containing a lifecycle word does not change the state", () => {
    const view = lifecycleHeadlineView({ ...args, flow: flow({ flowId: "run-completed-killed" }), killEvents: [] });
    expect(view.state).toBe("running");
  });

  test("terminal statuses map to their own state; unknown terminal statuses are other-terminal", () => {
    const stateOf = (status: string) =>
      lifecycleHeadlineView({ ...args, flow: flow({ status }), killEvents: [] }).state;
    expect(stateOf("completed")).toBe("completed");
    expect(stateOf("failed")).toBe("failed");
    expect(stateOf("terminated")).toBe("terminated");
    expect(stateOf("canceled")).toBe("canceled");
    expect(stateOf("continued_as_new")).toBe("other-terminal");
    expect(
      lifecycleHeadlineView({ flow: undefined, filesDone: 0, filesTotal: 0, killEvents: [], dexAvailable: true, feed: [] }).state,
    ).toBe("none");
  });
});

describe("buildDashboardState headline state + degraded across SubFlow children (C54)", () => {
  const tombstone = (reviewer: string) => ({ reviewer, discarded: true, reason: "exhausted retries" });
  const parent = { ...FLOW_TRIAL, flowId: "cx-9", flowStatus: "FLOW_STATUS_COMPLETED", flowStatusCode: 2 };
  const child = {
    ...FLOW_TRIAL,
    flowId: "SubFlow:cx-9-PpWaveJoin-7-0",
    flowType: "port.File",
    flowStatus: "FLOW_STATUS_COMPLETED",
    flowStatusCode: 2,
    startTime: "2026-09-25T21:40:00.000000Z",
  };
  const stranger = { ...child, flowId: "SubFlow:cx-10-PpWaveJoin-1-0" };
  const build = (flows: DexFlowSummaryWire[], states: Record<string, DexStateWire>) =>
    buildDashboardState({
      now: "2026-09-25T22:00:00.000Z",
      dex: { available: true, error: null, detail: null, flows, states, histories: {} },
      git: { available: false, error: null, repoRoot: "/tmp/x", commits: [], worktrees: [] },
      killEvents: { available: false, error: null, filesScanned: [], events: [] },
      burnDownFiles: [],
      feedLimit: 80,
      commitLimit: 40,
    });
  const childVerdicts: DexStateWire = {
    activeStepExecutions: [],
    attributes: [
      { key: "pp-verdict/src__Money.php#1#reviewer-A", value: tombstone("reviewer-A") },
      { key: "pp-verdict/src__Money.php#1#reviewer-B", value: tombstone("reviewer-B") },
    ],
  };

  test("degraded rounds living in the headline run's SubFlow children mark the headline degraded", () => {
    const state = build([parent, child], { [child.flowId]: childVerdicts });
    expect(state.degradedRounds).toHaveLength(1);
    expect(state.degradedRounds[0]?.flowId).toBe(child.flowId);
    expect(state.headlineState).toBe("completed");
    expect(state.headlineDegraded).toBe(true);
    expect(state.headline).toContain("DEGRADED (1 unreviewed round)");
  });

  test("another run's children never degrade this run's headline", () => {
    const state = build([parent, stranger], { [stranger.flowId]: childVerdicts });
    expect(state.degradedRounds).toHaveLength(1); // still listed in the panel payload
    expect(state.headlineDegraded).toBe(false);
  });

  test("no flows: headline state none", () => {
    const state = build([], {});
    expect(state.headlineState).toBe("none");
    expect(state.headlineDegraded).toBe(false);
  });
});
