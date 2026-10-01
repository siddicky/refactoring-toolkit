/**
 * PortProjectFlow — the v1 core loop (Phase 2, plan §Flow contract):
 *
 *   prep → dispatch ─┬─→ lease → fence → implement → capture-diff →
 *                    │   review-A → review-B → verdict-check ─┬─→ prioritize →
 *                    │                                        └─→ commit ──→
 *                    └─→ final   ↑   fixer ────────────────────────────┘
 *                              └── release ←── integrate ←─────┘
 *
 * - EVERY step is created by the envelope factory (flows/steps/envelope.ts).
 * - Deviation (recorded in BUILD_NOTES): the two reviewers run as sequential
 *   durable steps rather than `goToMany` parallel movements — convergence
 *   semantics for scheduled branches are undocumented in dex 0.12. Each
 *   reviewer keeps an independent session, envelope, and verdict attribute.
 * - Loop + queue state is a durable attribute (pp-queue) derived each
 *   iteration; retry/round caps are durable (pp-config + envelope
 *   stepOptions executeRetry).
 * - Diffs and verdicts are stored BY VALUE as dex attributes (pp-diff,
 *   pp-verdict, pp-kept); agents hold no git access — the commit step is the
 *   sole committer (op-ID dedup, branch-scan lookup).
 * - 0(g) mini-step rule: the implementer's session fence persists in a
 *   preceding role-record step (FenceStep). Reviewer/fixer steps create +
 *   fence + prompt within one durable step (short-lived sessions; the plan's
 *   enumeration fallback covers a mid-review kill).
 *
 * This module is the PUBLIC ENTRY of the port flows: it holds no code, only the
 * explicit re-exports other files and tests import. The implementation lives in
 * flows/port/ (layering and the one forward link: flows/port/links.ts):
 *
 *   state.ts          durable contracts, pp-* AttributeMaps, persistence schema
 *   queue-logic.ts    attribute keys + pure queue/dispatch helpers
 *   leases.ts         lease-store binding + the WorktreePool factory
 *   step-options.ts   restart-window retry schedule shared by model steps
 *   lane-b.ts         Jev gates (citation, prioritize, vitest triage) + fail-open
 *   agent-turns.ts    harness injection, runAgentTurn, fenced sessions
 *   review-turn.ts    the reviewer turn (suspicion repair/discard, turn health)
 *   bootstrap.ts      integration bootstrap (vitest runner scaffold)
 *   queue-tools.ts    tsc/vitest process plumbing + honest vitest outcome
 *   file-steps.ts     per-file pipeline (shared by port.Project and port.File)
 *   file-flow.ts      port.File (child of a parallel wave)
 *   project-steps.ts  dispatch, lease, release, final, queue-verify, waves
 *   prep-steps.ts     Phase 3 prep-analysis loop
 *   project-flow.ts   port.Project
 *
 * tests/port-project-exports.test.ts pins the export surface below.
 */

/** Contract A: honest tsc accounting (defined with the tsc queue, re-exported for metrics consumers). */
export type { TscRunAccounting } from "../src/queues/tsc-queue.js";
export type { Context, StepDecision } from "@superdurable/dex";

// Durable contracts + attributes
export type {
  BootstrapRecord,
  CapturedDiff,
  ChildFileResult,
  CitationGateRecord,
  FileRoundInput,
  JudgmentChecker,
  KeptFindings,
  OutPathRef,
  PortFileInput,
  PortQueueState,
  PortRunConfig,
  PortRunInput,
  PortRunResult,
  PrepArtifact,
  PrepDiffArtifact,
  PrepDraft,
  PrepSeedState,
  QueueBurnDownSample,
  QueueVerifyError,
  QueueVerifyState,
  ReviewTuple,
  ReviewVerdict,
  SymbolTableRow,
  VitestTriageRecord,
  WaveChildrenRecord,
  WaveDispatchOutput,
  WaveDispatchRecord,
  WaveEntry,
  WaveMode,
} from "./port/state.js";
export {
  LEASE_SLOT_CAP,
  portPersistenceSchema,
  ppBootstrap,
  ppBurndown,
  ppConfig,
  ppDiff,
  ppJevUsage,
  ppKept,
  ppLease,
  ppMarker,
  ppOut,
  ppPrep,
  ppPrepDiff,
  ppPrepDraft,
  ppPrepFindings,
  ppPrepSeed,
  ppPrepState,
  ppPrepVerdict,
  ppQueue,
  ppSymtab,
  ppVerdict,
  ppVerify,
  ppWave,
  ppWaveChildren,
} from "./port/state.js";

// Keys + pure helpers
export type { NextAction } from "./port/queue-logic.js";
export {
  deriveNext,
  diffKeyOf,
  errorCountsByOutput,
  keptKeyOf,
  markerKeyOf,
  outKeyOf,
  parsePrepSourceMap,
  parsePrepSourceMapRows,
  portedRootsFromSourceMap,
  queueFixFeedForFile,
  selectFixableFiles,
  sourceMapProblems,
  verdictKeyOf,
  vitestRoutedTo,
  waveEntryRound,
} from "./port/queue-logic.js";

// Lane-B gates
export type { JevGateResult } from "./port/lane-b.js";
export {
  citationKept,
  classifyVitestRecords,
  liveJevClient,
  runCitationGate,
  runPrioritizeGate,
} from "./port/lane-b.js";

// Agent turns
export { composeAgentTurn, configurePortHarness, runAgentTurn } from "./port/agent-turns.js";
export type { ReviewTurnDiff } from "./port/review-turn.js";
export {
  REVIEW_STEP_MAX_ATTEMPTS,
  resetInStepVerdictMemo,
  runReviewTurn,
} from "./port/review-turn.js";

// Integration bootstrap + verification queue tools
export type {
  BootstrapDeps,
  BootstrapInspection,
  BootstrapOutcome,
  BootstrapPlan,
} from "./port/bootstrap.js";
export {
  BOOTSTRAP_OP_ID,
  BOOTSTRAP_VITEST_PIN,
  bootstrapPlan,
  runIntegrationBootstrap,
  scaffoldTsconfigText,
  tsconfigIncludeFromSourceMap,
} from "./port/bootstrap.js";
export {
  findVitestTestFiles,
  queueVerifyTools,
  vitestOutcomeFromRun,
} from "./port/queue-tools.js";

// Flows
export type { LeaseOutcome } from "./port/project-steps.js";
export { PortFileFlow, PortFileFlowInstance } from "./port/file-flow.js";
export { PortProjectFlow } from "./port/project-flow.js";
