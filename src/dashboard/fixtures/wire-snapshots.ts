/**
 * Dashboard test fixtures — wire-shaped snapshots modeled on the LIVE dex
 * JSON surface (dexcli flow search/state/history against dex 0.13.5) and on
 * the metrics fixture shapes (src/metrics/fixtures/*.json). Used by
 * state.test.ts and shapes.test.ts; never imported by production code.
 */

import type {
  BurnDownSample,
  DexFlowSummaryWire,
  DexHistoryWire,
  DexStateWire,
  GitCommitRow,
  GitWorktreeRow,
  NormalizedKillEvent,
} from "../types.js";

export const FLOW_TRIAL: DexFlowSummaryWire = {
  flowId: "trial-9",
  flowType: "port.Project",
  flowStatus: "FLOW_STATUS_RUNNING",
  flowStatusCode: 1,
  runId: "01a0da73-c992-7080-a231-021d2c677a53",
  startTime: "2026-09-25T21:23:36.466034Z",
};

export const FLOW_PROBE: DexFlowSummaryWire = {
  flowId: "round-src__a.php-1-1-1790365705434",
  flowType: "probe.PortRound",
  flowStatus: "FLOW_STATUS_TERMINATED",
  flowStatusCode: 5,
  runId: "01a0da1c-a4e7-7c0d-b3a5-958116536591",
  startTime: "2026-09-25T19:48:25.447791Z",
  closeTime: "2026-09-25T20:08:15.038632Z",
};

const envelope = (
  stepId: string,
  role: string,
  attempt: number,
  started: string,
  ended: string | null,
  outcome: string,
  tokens: number | null,
  wallClockMs: number | null,
): Record<string, unknown> => ({
  stepId,
  role,
  file: null,
  round: null,
  attempt,
  started_at: started,
  ended_at: ended,
  outcome,
  tokens,
  wall_clock_ms: wallClockMs,
});

/** Trial flow state: Money.php committed, FlatRateDiscount mid-review-A retry. */
export const STATE_TRIAL: DexStateWire = {
  activeStepExecutions: [
    {
      stepExecutionId: "PpReviewA-2",
      stepType: "PpReviewA",
      phase: "ACTIVE_STEP_PHASE_ACTIVE",
      lastFailureInfo: {
        attempt: 2,
        backendError: "FLOW_ERROR_TYPE_WORKER_API_FAIL",
        subStatus: "ERROR_SUB_STATUS_WORKER_API_ERROR",
        details: {
          originalWorkerErrorDetail:
            "provenance failure: step pp-review-a (role review) returned no token usage",
        },
      },
      movement: {
        stepType: "PpReviewA",
        stepInput: {
          repoRoot: "/tmp/pk-trial",
          file: "src/Pricing/FlatRateDiscount.php",
          round: 1,
          epoch: 1,
          branch: "lease/src__Pricing__FlatRateDiscount.php/1",
          worktreePath: "/tmp/pk-trial/.worktrees/src__Pricing__FlatRateDiscount.php-1",
        },
      },
    },
  ],
  attributes: [
    {
      key: "envelope-event/pp-implement#1",
      value: envelope("pp-implement", "agent", 1, "2026-09-25T21:23:36.693Z", "2026-09-25T21:26:38.981Z", "completed", 60921, 182288),
    },
    {
      key: "envelope-event/pp-commit#1",
      value: envelope("pp-commit", "commit", 1, "2026-09-25T21:27:00.100Z", "2026-09-25T21:27:00.220Z", "completed", null, 120),
    },
    {
      key: "pp-config/config",
      value: { maxRounds: 1 },
    },
    {
      key: "pp-lease/pool",
      value: {
        "src/Money.php": {
          file: "src/Money.php",
          worktreePath: "/tmp/pk-trial/.worktrees/src__Money.php-1",
          branch: "lease/src__Money.php/1",
          epoch: 1,
          baseSha: "393798583a050dc2376c98ef72f61ff0fc65503b",
          holderExecutionId: "pp-1",
          acquiredAtUtc: "2026-09-25T21:23:36.609Z",
        },
        "src/Pricing/FlatRateDiscount.php": {
          file: "src/Pricing/FlatRateDiscount.php",
          worktreePath: "/tmp/pk-trial/.worktrees/src__Pricing__FlatRateDiscount.php-1",
          branch: "lease/src__Pricing__FlatRateDiscount.php/1",
          epoch: 1,
          baseSha: "393798583a050dc2376c98ef72f61ff0fc65503b",
          holderExecutionId: "pp-1",
          acquiredAtUtc: "2026-09-25T21:26:39.201Z",
        },
      },
    },
    {
      key: "pp-queue/queue",
      value: {
        pending: [],
        current: { file: "src/Pricing/FlatRateDiscount.php", round: 1, epoch: 1 },
        done: [{ file: "src/Money.php", round: 1, commitSha: "abc1234567890" }],
        blocked: [{ file: "src/Util/Csv.php", round: 1, reason: "round cap 1 exceeded" }],
      },
    },
  ],
};

export const STATE_PROBE: DexStateWire = {
  activeStepExecutions: [],
  attributes: [
    {
      key: "envelope-event/probe-commit#7",
      value: envelope("probe-commit", "commit", 7, "2026-09-25T19:55:00.000Z", "2026-09-25T19:55:00.100Z", "skipped", null, 100),
    },
    {
      // Deliberately claims the SAME file as the trial flow's lease so the
      // newest-flow-wins dedup is exercised.
      key: "pp-lease/pool",
      value: {
        "src/Pricing/FlatRateDiscount.php": {
          file: "src/Pricing/FlatRateDiscount.php",
          worktreePath: "/tmp/pk-probe/.worktrees/src__Pricing__FlatRateDiscount.php-9",
          branch: "lease/src__Pricing__FlatRateDiscount.php/9",
          epoch: 9,
          baseSha: "393798583a050dc2376c98ef72f61ff0fc65503b",
          holderExecutionId: "probe-9",
          acquiredAtUtc: "2026-09-25T19:50:00.000Z",
        },
      },
    },
  ],
};

/**
 * Trial history: context threading — the first two envelope upserts happen
 * before any file-bearing stepInput (prep/dispatch are flow-level), the rest
 * after the lease step's FileRoundInput, so file/round must be restored from
 * context. Includes a retry attempt (pp-review-a#1 vs #2) and a burn-down
 * sample shaped like metrics QueueBurnDownEvent.
 */
export const HISTORY_TRIAL: DexHistoryWire = {
  flowId: FLOW_TRIAL.flowId,
  runId: FLOW_TRIAL.runId,
  events: [
    {
      eventId: "1",
      eventTime: "2026-09-25T21:23:36.466034Z",
      type: "FlowStartedOrContinued",
      payload: {
        initialStart: {
          stepInput: { repoRoot: "/tmp/pk-trial", maxRounds: 1, files: ["src/Money.php"] },
        },
      },
    },
    {
      eventId: "15",
      eventTime: "2026-09-25T21:23:36.522787Z",
      type: "StepExecuteCompleted",
      payload: {
        context: { stepExecutionId: "PpPrep-1", stepType: "PpPrep", finalAttempt: 1 },
        output: {
          upsertAttributes: [
            {
              key: "envelope-event/pp-prep#1",
              value: envelope("pp-prep", "record", 1, "2026-09-25T21:23:36.500Z", "2026-09-25T21:23:36.502Z", "completed", null, 2),
            },
          ],
        },
      },
    },
    {
      eventId: "39",
      eventTime: "2026-09-25T21:23:36.623998Z",
      type: "StepExecuteCompleted",
      payload: {
        context: { stepExecutionId: "PpLease-1", stepType: "PpLease", finalAttempt: 1 },
        output: {
          stepDecision: {
            nextSteps: [
              {
                stepType: "PpFence",
                stepInput: {
                  file: "src/Money.php",
                  round: 1,
                  epoch: 1,
                  worktreePath: "/tmp/pk-trial/.worktrees/src__Money.php-1",
                  branch: "lease/src__Money.php/1",
                },
              },
            ],
          },
          upsertAttributes: [
            {
              key: "envelope-event/pp-lease#1",
              value: envelope("pp-lease", "record", 1, "2026-09-25T21:23:36.578Z", "2026-09-25T21:23:36.609Z", "completed", null, 31),
            },
          ],
        },
      },
    },
    {
      eventId: "63",
      eventTime: "2026-09-25T21:26:38.992716Z",
      type: "StepExecuteCompleted",
      payload: {
        context: { stepExecutionId: "PpImplement-1", stepType: "PpImplement", finalAttempt: 1 },
        output: {
          upsertAttributes: [
            {
              key: "envelope-event/pp-implement#1",
              value: envelope("pp-implement", "agent", 1, "2026-09-25T21:23:36.693Z", "2026-09-25T21:26:38.981Z", "completed", 60921, 182288),
            },
            {
              key: "queue-burndown/tsc#1",
              value: { queue: "tsc", file: "src/Money.php", iteration: 1, error_count: 3, recorded_at: "2026-09-25T21:26:39.100Z" },
            },
          ],
        },
      },
    },
    {
      eventId: "71",
      eventTime: "2026-09-25T21:26:55.000000Z",
      type: "StepExecuteCompleted",
      payload: {
        context: { stepExecutionId: "PpReviewA-1", stepType: "PpReviewA", finalAttempt: 1 },
        output: {
          upsertAttributes: [
            {
              key: "envelope-event/pp-review-a#1",
              value: envelope("pp-review-a", "review", 1, "2026-09-25T21:26:39.300Z", null, "interrupted", null, null),
            },
          ],
        },
      },
    },
    {
      eventId: "88",
      eventTime: "2026-09-25T21:27:30.000000Z",
      type: "StepExecuteCompleted",
      payload: {
        context: { stepExecutionId: "PpCommit-2", stepType: "PpCommit", finalAttempt: 1 },
        output: {
          stepDecision: {
            nextSteps: [
              {
                stepType: "PpRelease",
                stepInput: {
                  file: "src/Money.php",
                  round: 1,
                  epoch: 1,
                },
              },
            ],
          },
          upsertAttributes: [
            {
              key: "envelope-event/pp-commit#1",
              value: envelope("pp-commit", "commit", 1, "2026-09-25T21:27:00.100Z", "2026-09-25T21:27:00.220Z", "completed", null, 120),
            },
          ],
        },
      },
    },
  ],
};

/** Probe history: one flow-level envelope event (no file context anywhere). */
export const HISTORY_PROBE: DexHistoryWire = {
  flowId: FLOW_PROBE.flowId,
  runId: FLOW_PROBE.runId,
  events: [
    {
      eventId: "200",
      eventTime: "2026-09-25T19:55:00.050Z",
      type: "StepExecuteCompleted",
      payload: {
        context: { stepExecutionId: "ProbeCommit-3", stepType: "ProbeCommit", finalAttempt: 7 },
        output: {
          upsertAttributes: [
            {
              key: "envelope-event/probe-commit#7",
              value: envelope("probe-commit", "commit", 7, "2026-09-25T19:55:00.000Z", "2026-09-25T19:55:00.100Z", "skipped", null, 100),
            },
          ],
        },
      },
    },
  ],
};

export const GIT_COMMITS: GitCommitRow[] = [
  {
    sha: "9f1c0deadc0ffee000000000000000000000001",
    shortSha: "9f1c0de",
    author: "porting-toolkit",
    date: "2026-09-25T21:27:00+00:00",
    subject: "porting-toolkit: port src/Money.php (round 1)",
    refs: "lease/src__Money.php/1, integration",
    opId: "src/Money.php#1",
    contentHash: "aaa111bbb222ccc333ddd444eee555fff666aaa7",
  },
  {
    sha: "393798583a050dc2376c98ef72f61ff0fc65503b",
    shortSha: "3937985",
    author: "fixture",
    date: "2026-09-25T21:20:00+00:00",
    subject: "fixture init",
    refs: "main -> origin/main, HEAD -> main",
    opId: null,
    contentHash: null,
  },
];

export const GIT_WORKTREES: GitWorktreeRow[] = [
  {
    path: "/tmp/pk-trial",
    head: "393798583a050dc2376c98ef72f61ff0fc65503b",
    branch: "refs/heads/main",
    clean: true,
  },
  {
    path: "/tmp/pk-trial/.worktrees/src__Money.php-1",
    head: "9f1c0deadc0ffee000000000000000000000001",
    branch: "refs/heads/lease/src__Money.php/1",
    clean: true,
  },
  {
    path: "/tmp/pk-trial/.worktrees/src__Pricing__FlatRateDiscount.php-1",
    head: "393798583a050dc2376c98ef72f61ff0fc65503b",
    branch: "refs/heads/lease/src__Pricing__FlatRateDiscount.php/1",
    clean: false,
  },
];

/** Chaos-kill sidecar spelling (kind: intent/completed). */
export const KILL_EVENT_A: NormalizedKillEvent = {
  source: "/tmp/kill-events-phase0.jsonl",
  kind: "intent",
  runId: "kill-2026-09-25-a",
  utc: "2026-09-25T20:45:00.100Z",
  monotonicMs: 4832100,
  pids: [4242, 4243],
  signal: "SIGKILL",
  reason: "phase0-kill",
  note: null,
  resumed: null,
};

export const KILL_EVENT_B: NormalizedKillEvent = {
  source: "/tmp/kill-events-phase0.jsonl",
  kind: "completed",
  runId: "kill-2026-09-25-a",
  utc: "2026-09-25T20:45:00.800Z",
  monotonicMs: 4832800,
  pids: [4242, 4243],
  signal: null,
  reason: null,
  note: "all targets exited after SIGKILL (reason=phase0-kill)",
  resumed: null,
};

/** Metrics-contract spelling (kind: kill-intent/kill-completed, resumed flag). */
export const KILL_EVENT_C: NormalizedKillEvent = {
  source: "metrics/kill-events.json",
  kind: "intent",
  runId: "run-a-2026-09-25",
  utc: "2026-09-25T22:00:00.100Z",
  monotonicMs: 4900000,
  pids: [5150],
  signal: null,
  reason: null,
  note: null,
  resumed: null,
};

export const BURN_DOWN_FILE_SAMPLES: BurnDownSample[] = [
  { queue: "tsc", file: "src/Money.php", iteration: 2, error_count: 1, recorded_at: "2026-09-25T21:30:00.000Z" },
  { queue: "tsc", file: "src/Money.php", iteration: 3, error_count: 0, recorded_at: "2026-09-25T21:35:00.000Z" },
  { queue: "vitest", file: "src/Money.php", iteration: 1, error_count: 2, recorded_at: "2026-09-25T21:26:50.000Z" },
];

// ---------------------------------------------------------------------------
// Shapes the live flow really emits: every fixture below models a
// dashboard defect that the original fixtures could not express.
// ---------------------------------------------------------------------------

/**
 * Default parallel mode: one RUNNING port.Project parent plus `childCount`
 * COMPLETED SubFlow port.File children, all started AFTER the parent
 * (`SubFlow:<parent>-<stepExecutionId>-<index>`, as dex names them).
 */
export function parallelRunFlows(parentId: string, childCount: number): DexFlowSummaryWire[] {
  const base = Date.parse("2026-09-30T10:00:00.000Z");
  const parent: DexFlowSummaryWire = {
    flowId: parentId,
    flowType: "port.Project",
    flowStatus: "FLOW_STATUS_RUNNING",
    flowStatusCode: 1,
    runId: `run-${parentId}`,
    startTime: new Date(base).toISOString(),
  };
  const children = Array.from({ length: childCount }, (_, i): DexFlowSummaryWire => ({
    flowId: `SubFlow:${parentId}-PpWaveJoin-1-${i}`,
    flowType: "port.File",
    flowStatus: "FLOW_STATUS_COMPLETED",
    flowStatusCode: 2,
    runId: `run-child-${i}`,
    startTime: new Date(base + (i + 1) * 60_000).toISOString(),
  }));
  return [parent, ...children];
}

export const FLOW_TERMINATED_PORT: DexFlowSummaryWire = {
  flowId: "cx-term",
  flowType: "port.Project",
  flowStatus: "FLOW_STATUS_TERMINATED",
  flowStatusCode: 5,
  runId: "run-cx-term",
  startTime: "2026-09-29T09:00:00.000Z",
  closeTime: "2026-09-29T09:30:00.000Z",
};

export const FLOW_CANCELED_PORT: DexFlowSummaryWire = {
  ...FLOW_TERMINATED_PORT,
  flowId: "cx-cancel",
  flowStatus: "FLOW_STATUS_CANCELED",
  flowStatusCode: 6,
  runId: "run-cx-cancel",
};

/**
 * envelopeStartMarker (attempt 0, ended_at null, tokens null) and the real
 * attempt of the SAME model step: the marker must never read as a provenance
 * failure, only the real attempt carries the token requirement.
 */
export const ENVELOPE_START_MARKER: Record<string, unknown> = {
  stepId: "pp-implement",
  role: "agent",
  file: null,
  round: null,
  attempt: 0,
  started_at: "2026-09-30T10:05:00.000Z",
  ended_at: null,
  outcome: "interrupted",
  tokens: null,
  wall_clock_ms: null,
};

export const ENVELOPE_REAL_ATTEMPT: Record<string, unknown> = {
  ...ENVELOPE_START_MARKER,
  attempt: 1,
  started_at: "2026-09-30T10:05:01.000Z",
  ended_at: "2026-09-30T10:08:01.000Z",
  outcome: "completed",
  tokens: 60921,
  wall_clock_ms: 180000,
};

/**
 * Per-iteration burn-down rows exactly as QueueVerifyStep writes them: the
 * tsc TOTAL row (file null) plus per-file rows, a vitest row with ran
 * accounting, then iteration 2 where vitest did NOT run (error_count 0 plus
 * the not-run marker) and tsc could not produce a count (Contract A).
 */
export const BURN_DOWN_FLOW_ROWS: BurnDownSample[] = [
  { queue: "tsc", file: null, iteration: 1, error_count: 12, recorded_at: "2026-09-30T10:10:00.000Z", tsc: { state: "ran", reason: null, exit_code: 2, unlocated: 0 } },
  { queue: "tsc", file: "src/a.php", iteration: 1, error_count: 7, recorded_at: "2026-09-30T10:10:00.000Z" },
  { queue: "tsc", file: "src/b.php", iteration: 1, error_count: 5, recorded_at: "2026-09-30T10:10:00.000Z" },
  { queue: "vitest", file: null, iteration: 1, error_count: 2, recorded_at: "2026-09-30T10:10:00.000Z", vitest: { state: "ran", reason: null, passed: 8, failed: 2, total: 10 } },
  { queue: "tsc", file: null, iteration: 2, error_count: 0, recorded_at: "2026-09-30T10:20:00.000Z", tsc: { state: "not-run", reason: "tsc exited 2 with no located diagnostics: error TS18003: No inputs were found", exit_code: 2, unlocated: 1 } },
  { queue: "vitest", file: null, iteration: 2, error_count: 0, recorded_at: "2026-09-30T10:20:00.000Z", vitest: { state: "not-run", reason: "runner unavailable", passed: null, failed: null, total: null } },
];

/** A review step's start and completion stream messages: one eventKey, one started_at. */
export const STREAM_REVIEW_START_AND_DONE: Array<{ flowId: string; eventKey: string; event: Record<string, unknown> }> = (() => {
  const start = {
    stepId: "pp-review-a",
    role: "review",
    file: null,
    round: null,
    attempt: 1,
    started_at: "2026-09-30T10:12:00.000Z",
    ended_at: null,
    outcome: "interrupted",
    tokens: null,
    wall_clock_ms: null,
  };
  const done = {
    ...start,
    ended_at: "2026-09-30T10:14:00.000Z",
    outcome: "completed",
    tokens: { input_tokens: 329000, output_tokens: 4000, reasoning_tokens: 0, cache_read_tokens: 576000, cache_write_tokens: 0, cost_usd: 0 },
    wall_clock_ms: 120000,
  };
  return [
    { flowId: "cx-5", eventKey: "pp-review-a#1", event: start },
    { flowId: "cx-5", eventKey: "pp-review-a#1", event: done },
  ];
})();
