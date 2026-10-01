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
 */

import {
  AttributeMap,
  jsonCodec,
  StepList,
  goTo,
  Wait,
  SubFlow,
} from "@superdurable/dex";
import type { Context, Flow, StepDecision } from "@superdurable/dex";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  envelopeStartMarker,
  envelopeStepClass,
  envelopeStream,
  persistenceAttributes,
  publishTurnDiagnosisEvent,
  type EnvelopeOutcome,
  type EnvelopeStepClass,
} from "./steps/envelope.js";
import {
  configurePortFault,
  configurePortJudgment,
  crashPortWorker,
  faultMatches,
  portTurnHealthAssessor,
  requirePortJudgment,
} from "./runtime-hooks.js";
import {
  fenceLabel,
  sessionFenceMap,
  tokenTotal,
  OpencodePromptError,
  type AgentSessionClient,
} from "../src/harness/opencode.js";
import { git } from "../src/git/exec.js";
import {
  commitLeaseChanges,
  findCommitByOpId,
  integratedContentExists,
  isWorktreeClean,
  keyedCommitIntegrated,
  makeCommitReachable,
  mergeLeaseIntoIntegration,
  operationId,
  WorktreePool,
  type CompletionMarker,
  type LeaseRecord,
  type LeaseStore,
} from "../src/git/worktree.js";
import { IMPLEMENTER } from "../harness/agents/implementer.js";
import { REVIEWER } from "../harness/agents/reviewer.js";
import { FIXER } from "../harness/agents/fixer.js";
import {
  executorPromptOpts,
  isDemotedAttempt,
  plannerPromptOpts,
  reviewLaneRouting,
} from "../src/harness/lanes.js";
import type { AgentDefinition } from "../harness/agents/types.js";
import type {
  VerdictRecord as AgentVerdictRecord,
} from "../harness/agents/verdict-schema.js";
import type { PhpSymbol } from "../src/typesafe/symbol-types.js";
import { selectSymbolType } from "../src/typesafe/symbol-types.js";
import {
  createOfflineJevClient,
  composePrepGenerateTurn,
  composePrepReviseTurn,
  composeQueueFixTurn,
  harvestPhpSymbols,
  renderSymbolTable,
} from "../src/harness/runtime.js";
import {
  buildTscQueueState,
  capErrorsPerFile,
  tscOutcomeFromRun,
  TSC_ERRORS_PER_FILE_CAP,
  type TscRunAccounting,
} from "../src/queues/tsc-queue.js";
import {
  buildClassifiedVitestQueueState,
  createNaiveClassifier,
  parseVitestOutput,
  parseVitestSummary,
  VITEST_RECORD_CAP,
  type ClassifierRoots,
  type ClassifiedVitestFailure,
  type VitestFailureRecord,
  type VitestQueueState,
  type VitestRunState,
} from "../src/queues/vitest-queue.js";
import { portJevLive } from "./runtime-hooks.js";
import type { JudgmentClient } from "../src/typesafe/client.js";
import { createJevFailureClassifier } from "../src/typesafe/vitest-triage.js";
import { CITATION_MIN_P_JEV, CITATION_MIN_P_NAIVE } from "../src/judgment-registry.js";
import {
  buildRetryContextDiagnosis,
  type CitationCheckResult,
  type DiffDocument,
  type Finding as MetricsFinding,
  type TokenUsage,
  type TurnDiagnosis,
  type TurnObservation,
  type TurnShapeClass,
  type VerdictRecord as MetricsVerdictRecord,
  type VerdictTombstone,
  type VitestRunAccounting,
  isVerdictTombstone,
} from "../src/metrics/types.js";
import { evaluateSuspicion, normalizeVerdictText } from "../src/metrics/suspicion.js";
import { createCitationChecker, naiveCitationCheck } from "../src/typesafe/verdict-check.js";
import { createJevPrioritizer, naivePrioritize } from "../src/typesafe/prioritize.js";
import {
  composeFixerTurn,
  composeImplementerTurn,
  composeReviewerRepairTurn,
  composeReviewerTurn,
  extractCodeFence,
  extractJsonObject,
  extractSpecMap,
  mapVerdictToMetrics,
  parseUnifiedDiff,
  renderDiffForReview,
  reviewerAgentOverride,
  testPortScopeNote,
  toEnvelopeUsage,
  toolOverridesAllOff,
  toolPolicyBlock,
  DIFF_HEADER_LINES,
} from "../src/harness/runtime.js";

const execFileP = promisify(execFile);

/** Contract A: honest tsc accounting (defined with the tsc queue, re-exported for metrics consumers). */
export type { TscRunAccounting };

// ---------------------------------------------------------------------------
// Durable input/output shapes
// ---------------------------------------------------------------------------

/** startFlow input: one porting run over a fixed set of seed files. */
export interface PortRunInput {
  repoRoot: string;
  worktreeRoot: string;
  integrationWorktreePath: string;
  /** Fencing epoch (recovery bumps it). */
  epoch: number;
  /** Absolute dir containing the PHP sources named by `files`. */
  sourceRoot: string;
  /** Absolute path of the (stub) prep artifact consumed by the prep step. */
  prepPath: string;
  /** PHP source files to port, relative to sourceRoot, in order. */
  files: readonly string[];
  /** Per-file round cap (durable in pp-config; enforced by dispatch). */
  maxRounds: number;
  /**
   * v1.1: "parallel" (default) dispatches per-file waves as dex SubFlows —
   * up to 2 children on the 2 lease slots concurrently, joined durably by
   * Wait.allOf; the parent integrates serially after each wave. "sequential"
   * keeps the Phase 2 loop shape.
   */
  dispatchMode?: "sequential" | "parallel";
}

/** Identity of one file-round carried between the per-file steps. */
export interface FileRoundInput {
  repoRoot: string;
  worktreeRoot: string;
  integrationWorktreePath: string;
  sourceRoot: string;
  epoch: number;
  file: string;
  round: number;
  worktreePath: string;
  branch: string;
  /** v1.1: true inside a per-file SubFlow child (routes to child release). */
  childFlow?: boolean;
  /**
   * Run-level fields of the PortRunInput this file-round was leased from.
   * LeaseStep spreads the run input into the FileRoundInput, so they ride the
   * sequential per-file pipeline; ReleaseStep rebuilds the run input from
   * them (baseInput) — dropping them silently turned `--dispatch sequential`
   * into parallel after the first file. Absent in per-file SubFlow children,
   * which end at ChildReleaseStep and never rebuild a run input.
   */
  prepPath?: string;
  files?: readonly string[];
  maxRounds?: number;
  dispatchMode?: "sequential" | "parallel";
}

export interface PortRunConfig {
  maxRounds: number;
  /** Prep-review loopback cap (Phase 3; same envelope caps as the port loop). */
  prepMaxRounds: number;
}

/** Phase 3: harvested PHP symbols + the stub baseline they supersede. */
export interface PrepSeedState {
  stubRaw: string;
  symbols: PhpSymbol[];
}

/** Phase 3: one per-symbol table row (symbol-types decision, flattened). */
export interface SymbolTableRow {
  file: string;
  symbol: string;
  kind: string;
  signature: string;
  candidates: string[];
  selected: string;
  flagged: boolean;
  escalations: number;
  /**
   * "live" = judged by the real Jev client; "scripted" = the offline double's
   * first-candidate pick (UNVERIFIED). Absent on rows persisted before the tag.
   */
  judge?: "live" | "scripted";
}

export interface PrepDraft {
  specText: string;
  iteration: number;
}

export interface PrepDiffArtifact {
  raw: string;
  doc: DiffDocument;
  diffId: string;
  bodyLineOffset: number;
  iteration: number;
}

/** Phase 4: verification-queue state (durable; feeds the per-file fix loop). */
export interface QueueVerifyError {
  file: string;
  code: string;
  message: string;
  line: number;
}

export interface QueueVerifyState {
  iteration: number;
  fixQueue: Array<{ file: string; fromRound: number }>;
  tscTotal: number;
  vitestTotal: number;
  vitestNote: string | null;
  lastRunAt: string;
  /** Raw tsc error records (capped) consumed by the per-file fix loop. */
  errors: QueueVerifyError[];
  /**
    * Durable vitest queue state: parsed failure records PLUS their Lane-B
    * triage ({failureClass, attributedFile, reason} per record — declared in
    * src/judgment-registry.ts as "vitest-triage"). null when vitest is not
    * installed in the integrated checkout. Older persisted states predate
    * this field — every consumer treats undefined like null.
    */
  vitestState: VitestQueueState | null;
  /**
    * US-010 honest run accounting: `ran` (pass/fail/total) or `not-run` with
    * an explicit reason. NEVER a bare vitestTotal 0 when the runner did not
    * execute — consumers read the state, not the count. null on states
    * persisted before US-010 (treat like "unknown; state predates ran/not-run
    * recording").
    */
  vitestRun: VitestRunState | null;
  /**
   * C06 honest tsc accounting: `ran`, or `not-run` with an explicit reason
   * (spawn error, timeout, non-zero exit with no located diagnostics).
   * tscTotal counts LOCATED diagnostics only — read the state, not the count.
   * Absent on states persisted before C06 and on child by-value feeds.
   */
  tscRun?: TscRunAccounting;
  /**
   * Lane-B vitest-triage provenance: which classifier produced
   * `vitestState.classified` — "jev", "naive", or "naive-fallback" with the
   * reason live Jev was abandoned (a fail-open is otherwise invisible in the
   * routing it changed). Absent on states persisted before it existed and on
   * child by-value feeds.
   */
  vitestTriage?: VitestTriageRecord;
}

/** Phase 4: one burn-down sample (dashboard renders queue-burndown/*). */
export interface QueueBurnDownSample {
  queue: "tsc" | "vitest";
  iteration: number;
  error_count: number;
  file: string | null;
  recorded_at: string;
  /**
   * US-010: honest vitest accounting riding the sample (vitest rows only).
   * A not-run iteration is never a bare error_count 0 — the state + explicit
   * reason travel with the sample.
   */
  vitest?: VitestRunAccounting;
  /**
   * C06 (Contract A): honest tsc accounting, on the tsc TOTAL row only
   * (file null). A not-run row is never a bare error_count 0.
   */
  tsc?: TscRunAccounting;
}

export interface PrepArtifact {
  raw: string;
  sourceMap: Record<string, { outPath: string; notes: string }>;
  /** Phase 3: per-symbol table rows backing the generated spec. */
  symbolTable: SymbolTableRow[];
  /**
   * The user's PORTING.md text (the prep seed's stub baseline), kept by value:
   * the planner rewrites it into `raw`, so implement/fix turns also receive the
   * original as the authoritative user contract. Absent on artifacts persisted
   * before this field existed.
   */
  userContract?: string;
}

export interface PortQueueState {
  pending: string[];
  current: { file: string; round: number; epoch: number } | null;
  done: Array<{
    file: string;
    round: number;
    /** Commit sha (m1: distinct from the tree-hash evidence below). */
    commitSha: string | null;
    /** Tree hash recorded in the completion marker (content evidence). */
    treeHash: string | null;
  }>;
  blocked: Array<{ file: string; round: number; reason: string }>;
}

export interface CapturedDiff {
  diffId: string;
  raw: string;
  doc: DiffDocument;
  /** Wrapper header lines before the diff body in the rendered block. */
  bodyLineOffset: number;
}

export interface ReviewTuple {
  agent: AgentVerdictRecord;
  metrics: MetricsVerdictRecord;
}

/**
 * US-006: what a reviewer verdict attribute holds — a completed tuple, or a
 * tombstone marking a DISCARDED reviewer (suspicion repair failed, or the
 * step exhausted its dex attempts). A tombstoned reviewer contributes ZERO
 * kept findings; both reviewers tombstoned = a degraded, unreviewed round.
 */
export type ReviewVerdict = ReviewTuple | VerdictTombstone;

/** Which implementation produced a Lane-B gate's scores/order (provenance). */
export type JudgmentChecker = "naive" | "jev" | "naive-fallback";

/** One reviewer's citation-gate scores, with the checker that produced them. */
export interface CitationGateRecord {
  reviewer: string;
  checker: JudgmentChecker;
  /** Why live Jev was abandoned (checker "naive-fallback"); null otherwise. */
  fallbackReason: string | null;
  /** p_cited per checked finding (kept AND dropped) — the gate's audit trail. */
  scores: Array<{ finding_id: string; p_cited: number }>;
}

export interface KeptFindings {
  findings: MetricsFinding[];
  /** `p_cited` is set on citation-gate drops (the score the gate applied). */
  dropped: Array<{ finding_id: string; reviewer: string; reason: string; p_cited?: number }>;
  /** Lane-B "citation-check" provenance (absent on records predating it). */
  citationGate?: CitationGateRecord[];
  /** Lane-B "prioritize" provenance (set by PrioritizeStep). */
  prioritize?: { checker: JudgmentChecker; fallbackReason: string | null };
}

export interface OutPathRef {
  outPath: string;
}

/** Terminal flow output (gracefulComplete payload). */
export interface PortRunResult {
  completed: PortQueueState["done"];
  blocked: PortQueueState["blocked"];
  verification: {
    iteration: number;
    tscTotal: number;
    vitestTotal: number;
    vitestNote: string | null;
    /** US-010: ran/not-run accounting (null on pre-US-010 states). */
    vitestRun: VitestRunState | null;
    /** C06: tsc ran/not-run accounting (null on pre-C06 states). */
    tscRun?: TscRunAccounting | null;
  } | null;
}

// ---------------------------------------------------------------------------
// Durable attributes (pp-* — unique within this flow)
// ---------------------------------------------------------------------------

export const ppConfig = new AttributeMap<PortRunConfig>("pp-config", jsonCodec<PortRunConfig>());
export const ppQueue = new AttributeMap<PortQueueState>("pp-queue", jsonCodec<PortQueueState>());
export const ppPrep = new AttributeMap<PrepArtifact>("pp-prep", jsonCodec<PrepArtifact>());
export const ppLease = new AttributeMap<Record<string, LeaseRecord>>("pp-lease", jsonCodec<Record<string, LeaseRecord>>());
export const ppDiff = new AttributeMap<CapturedDiff>("pp-diff", jsonCodec<CapturedDiff>());
export const ppVerdict = new AttributeMap<ReviewVerdict>("pp-verdict", jsonCodec<ReviewVerdict>());
export const ppKept = new AttributeMap<KeptFindings>("pp-kept", jsonCodec<KeptFindings>());
export const ppOut = new AttributeMap<OutPathRef>("pp-out", jsonCodec<OutPathRef>());
export const ppMarker = new AttributeMap<CompletionMarker>("pp-marker", jsonCodec<CompletionMarker>());

// Phase 3 (prep-analysis) durable attributes.
export const ppPrepSeed = new AttributeMap<PrepSeedState>("pp-prep-seed", jsonCodec<PrepSeedState>());
export const ppSymtab = new AttributeMap<{ rows: SymbolTableRow[] }>("pp-symtab", jsonCodec<{ rows: SymbolTableRow[] }>());
export const ppPrepDraft = new AttributeMap<PrepDraft>("pp-prep-draft", jsonCodec<PrepDraft>());
export const ppPrepDiff = new AttributeMap<PrepDiffArtifact>("pp-prep-diff", jsonCodec<PrepDiffArtifact>());
export const ppPrepVerdict = new AttributeMap<ReviewVerdict>("pp-prep-verdict", jsonCodec<ReviewVerdict>());
export const ppPrepFindings = new AttributeMap<KeptFindings>("pp-prep-findings", jsonCodec<KeptFindings>());
export const ppPrepState = new AttributeMap<{ prepIteration: number }>("pp-prep-state", jsonCodec<{ prepIteration: number }>());

// Phase 4 (verification queues) durable attributes.
export const ppVerify = new AttributeMap<QueueVerifyState>("pp-verify", jsonCodec<QueueVerifyState>());
export const ppBurndown = new AttributeMap<QueueBurnDownSample>("queue-burndown", jsonCodec<QueueBurnDownSample>());

// US-010 (integration bootstrap) durable attribute.
export interface BootstrapRecord {
  bootstrappedAtUtc: string;
  /** Files the bootstrap wrote or patched (empty when already satisfied). */
  wrote: string[];
  installRan: boolean;
  /** Sole-committer commit landed for BOOTSTRAP_OP_ID. */
  committed: boolean;
  sha: string | null;
}
export const ppBootstrap = new AttributeMap<BootstrapRecord>("pp-bootstrap", jsonCodec<BootstrapRecord>());

// v1.1 parallel dispatch durable attributes.
export interface WaveEntry {
  file: string;
  /**
   * C03: the round THIS file runs at (fix waves mix files at different
   * fromRounds). Absent on records persisted before C03 — readers fall back
   * to the wave-level round (see waveEntryRound).
   */
  round?: number;
  errors: ReadonlyArray<QueueVerifyError>;
  /** Vitest failures triaged to this file (fix waves; Lane-B vitest-triage). */
  vitest: ReadonlyArray<ClassifiedVitestFailure>;
}
export interface WaveDispatchRecord {
  entries: WaveEntry[];
  /** The FIRST entry's round (informational; each entry carries its own). */
  round: number;
  mode: "port" | "fix";
  dispatchedAtUtc: string;
}
export interface WaveChildrenRecord {
  children: Array<{ file: string; round: number; flowId: string }>;
}
export const ppWave = new AttributeMap<WaveDispatchRecord>("pp-wave", jsonCodec<WaveDispatchRecord>());
export const ppWaveChildren = new AttributeMap<WaveChildrenRecord>("pp-wave-children", jsonCodec<WaveChildrenRecord>());

const PP_LEASE_INSTANCE = "pool";

/**
 * WorktreePool lease cap handed to every pool the flow builds (sequential
 * Lease/Release here; each per-file child builds its own). The pool enforces
 * the cap per LEASE STORE, and every parallel child owns its own pp-lease
 * store, so in parallel mode the effective concurrency bound is the wave
 * planner's slice width (CHILD_SLOT_CAP, derived from this constant), not
 * this pool cap.
 */
export const LEASE_SLOT_CAP = 2;

/** Persistence schema fragment for getPersistenceSchema(). */
export function portPersistenceSchema(): {
  attributes: ReturnType<typeof persistenceAttributes> | AttributeMap<unknown>[];
} {
  return {
    attributes: [
      ...persistenceAttributes(),
      ppConfig,
      ppQueue,
      ppPrep,
      ppLease,
      ppDiff,
      ppVerdict,
      ppKept,
      ppOut,
      ppMarker,
      ppPrepSeed,
      ppSymtab,
      ppPrepDraft,
      ppPrepDiff,
      ppPrepVerdict,
      ppPrepFindings,
      ppPrepState,
      ppVerify,
      ppBurndown,
      ppBootstrap,
      ppWave,
      ppWaveChildren,
      ppJevUsage,
    ],
  };
}

// ---------------------------------------------------------------------------
// Keys + pure helpers (unit-tested in tests/phase2-flow.test.ts)
// ---------------------------------------------------------------------------

const safe = (file: string): string => file.replace(/\//g, "__");

export const markerKeyOf = (file: string, round: number): string => `${safe(file)}#${round}`;
export const diffKeyOf = markerKeyOf;
export const keptKeyOf = markerKeyOf;
export const outKeyOf = markerKeyOf;
export const verdictKeyOf = (file: string, round: number, reviewerId: string): string =>
  `${safe(file)}#${round}#${reviewerId}`;

/**
 * Parses the stub-prep source-map table: rows of the form
 * `| \`src/X.php\` | \`src/x.ts\` | notes |`. Header/separator rows,
 * non-.php first cells, and glob rows (`*`) are ignored — seed lookup is
 * by exact source path only.
 */
export function parsePrepSourceMap(raw: string): Record<string, { outPath: string; notes: string }> {
  const map: Record<string, { outPath: string; notes: string }> = {};
  for (const line of raw.split("\n")) {
    const m = /^\|\s*`([^`]+\.php)`\s*\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|?\s*$/.exec(line.trim());
    if (m === null) continue;
    const php = m[1];
    if (php === undefined || m[2] === undefined) continue;
    if (php.includes("*")) continue; // glob rows are not exact seeds
    map[php] = { outPath: m[2], notes: m[3] ?? "" };
  }
  return map;
}

export type NextAction =
  | { kind: "resume"; file: string; round: number; epoch: number }
  | { kind: "start"; file: string }
  | { kind: "done" }
  | { kind: "blocked"; file: string; round: number; reason: string };

/**
 * Pure dispatch derivation over the durable queue: resume an in-flight
 * file-round first (kill mid-file), else start the next pending file, else
 * finish. The round cap blocks a NEW round beyond maxRounds.
 */
export function deriveNext(queue: PortQueueState, maxRounds: number): NextAction {
  const current = queue.current;
  if (current !== null) {
    if (current.round > maxRounds) {
      return { kind: "blocked", file: current.file, round: current.round, reason: `round cap ${maxRounds} exceeded` };
    }
    return { kind: "resume", file: current.file, round: current.round, epoch: current.epoch };
  }
  const next = queue.pending[0];
  if (next === undefined) return { kind: "done" };
  if (1 > maxRounds) {
    return { kind: "blocked", file: next, round: 1, reason: `round cap ${maxRounds} exceeded` };
  }
  return { kind: "start", file: next };
}

/**
 * US-010 (cx6b live finding): per-output error counts feeding fix-round
 * selection — tsc errors PLUS vitest failures Lane-B-routed to the output
 * (port-caused AND attributedFile set). Without the vitest half, failing
 * ported tests complete the run unaddressed: the fix FEED saw them, the
 * selection didn't. Counts derive from the durable classified records (same
 * 80-record cap as the tsc error list).
 */
export function errorCountsByOutput(
  tscErrors: ReadonlyArray<{ file: string }>,
  vitestClassified: ReadonlyArray<ClassifiedVitestFailure> | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of tscErrors) {
    const rel = e.file.replace(/^\.\//, "");
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  for (const c of vitestClassified ?? []) {
    if (c.classification.failureClass !== "port-caused") continue;
    if (c.classification.attributedFile === null) continue;
    const rel = c.classification.attributedFile.replace(/^\.\//, "");
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  return counts;
}

/**
 * Phase 4 termination rule (pure): from the done-set, the prep source map
 * (php→ts outPath), and the per-output error counts, select the files that
 * get a FIX ROUND (errors remain AND round+1 stays within the cap) versus
 * files that are capped (recorded as blocked, errors remain unresolvable
 * in-run).
 */
export function selectFixableFiles(
  done: ReadonlyArray<{ file: string; round: number }>,
  sourceMap: Record<string, { outPath: string }>,
  errorCountByOutput: ReadonlyMap<string, number>,
  maxRounds: number,
): { fixable: Array<{ file: string; fromRound: number }>; capped: Array<{ file: string; round: number; count: number }> } {
  const fixable: Array<{ file: string; fromRound: number }> = [];
  const capped: Array<{ file: string; round: number; count: number }> = [];
  // cx6c live finding (loop non-termination): the cap decision must read the
  // file's LATEST done round. Iterating EVERY done entry let a file's stale
  // round-1 entry re-qualify it at round 2 forever (round cap never reached
  // for maxRounds >= 2), so a persistent error looped fix waves without end.
  const latestRound = new Map<string, number>();
  for (const entry of done) {
    latestRound.set(entry.file, Math.max(latestRound.get(entry.file) ?? 0, entry.round));
  }
  for (const [file, round] of latestRound) {
    const outPath = sourceMap[file]?.outPath;
    if (outPath === undefined) continue;
    const count = errorCountByOutput.get(outPath.replace(/^\.\//, "")) ?? 0;
    if (count === 0) continue;
    if (round + 1 > maxRounds) {
      capped.push({ file, round, count });
    } else {
      fixable.push({ file, fromRound: round });
    }
  }
  return { fixable, capped };
}

/** Binds the pp-lease map instance as a sync LeaseStore for one invocation. */
function bindLeaseStore(ctx: Context, map: AttributeMap<Record<string, LeaseRecord>>): LeaseStore {
  const read = (): Record<string, LeaseRecord> => map.get(ctx, PP_LEASE_INSTANCE) ?? {};
  return {
    get: (file) => read()[file],
    put: (record) => {
      const table = read();
      table[record.file] = record;
      map.set(ctx, PP_LEASE_INSTANCE, table);
    },
    remove: (file) => {
      const table = read();
      delete table[file];
      map.set(ctx, PP_LEASE_INSTANCE, table);
    },
    list: () => Object.values(read()),
  };
}

// ---------------------------------------------------------------------------
/**
 * The LIVE Jev client when a REAL (billed) client is wired through the
 * runtime-hooks seam; `undefined` → every consumer below (verdict-check,
 * prioritize, vitest triage) runs its deterministic naive default.
 *
 * dex-sdk review fix (DRIFT S, silent naive fallback): this used to be a
 * SECOND module global (`PORT_JEV_LIVE` + configurePortJevLive) that was
 * NEVER called by the worker — a keyed worker silently ran naive here while
 * its startup log claimed "Jev: REAL client". There is deliberately no
 * second seam anymore: the single resolution point is what the worker
 * configures via configurePortJudgment (scripts/run-demo.ts resolveJudgment).
 */
export function liveJevClient(): JudgmentClient | undefined {
  // portJevLive() is false when nothing is configured, so requirePortJudgment
  // cannot throw on this path (tests without a worker keep the naive default).
  return portJevLive() ? requirePortJudgment() : undefined;
}

/** Accumulated LIVE Jev usage (evidence stream; naive path adds nothing). */
export const ppJevUsage = new AttributeMap<Array<{ stepId: string; tokens: number; atUtc: string }>>(
  "pp-jev-usage",
  jsonCodec<Array<{ stepId: string; tokens: number; atUtc: string }>>(),
);

/** Records one live-Jev usage event (evidence stream entry). */
async function recordJevUsage(ctx: Context, stepId: string, tokens: number): Promise<void> {
  const log = ppJevUsage.get(ctx, "usage") ?? [];
  log.push({ stepId, tokens, atUtc: new Date().toISOString() });
  ppJevUsage.set(ctx, "usage", log);
}

// Lane-B gates with a fail-open fallback (registry: citation-check, prioritize)
// ---------------------------------------------------------------------------

/**
 * The citation gate's keep decision — the single authority for the port-loop
 * gate (VerdictCheckStep) and the prep gate (PrepVerdictCheckStep). Thresholds
 * live in src/judgment-registry.ts next to the registry entry that documents
 * them: the naive checker is binary (keep iff 1), the live Jev checker returns
 * a probability (keep iff >= CITATION_MIN_P_JEV).
 */
export function citationKept(pCited: number, checker: JudgmentChecker): boolean {
  return pCited >= (checker === "jev" ? CITATION_MIN_P_JEV : CITATION_MIN_P_NAIVE);
}

/** Counts System One tokens across every call, including calls that fail later. */
function countingJevClient(client: JudgmentClient): { client: JudgmentClient; tokens: () => number } {
  let total = 0;
  return {
    client: {
      kind: client.kind,
      systemOne: async (request) => {
        const r = await client.systemOne(request);
        total += r.usage.input_tokens + r.usage.output_tokens;
        return r;
      },
    },
    tokens: () => total,
  };
}

function failureReason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/** A Lane-B gate's result plus how it was produced. */
export interface JevGateResult<T> {
  value: T;
  checker: JudgmentChecker;
  fallbackReason: string | null;
  /** Live Jev tokens spent, including before a failure (0 on the naive path). */
  jevTokens: number;
}

/**
 * Runs `live` against the Jev client when one is configured, else (or when it
 * FAILS — client error, no answer for a finding) the deterministic `naive`
 * default. Failing open is deliberate: a thrown step is retried by dex and
 * re-bills the batch. The degradation is returned for the caller to record.
 */
async function withJevFallback<T>(
  gate: "citation-check" | "prioritize" | "vitest-triage",
  jev: JudgmentClient | undefined,
  live: (client: JudgmentClient) => Promise<T>,
  naive: () => T | Promise<T>,
): Promise<JevGateResult<T>> {
  if (jev === undefined) return { value: await naive(), checker: "naive", fallbackReason: null, jevTokens: 0 };
  const counting = countingJevClient(jev);
  try {
    const value = await live(counting.client);
    return { value, checker: "jev", fallbackReason: null, jevTokens: counting.tokens() };
  } catch (err) {
    const fallbackReason = failureReason(err);
    // Failing open must not be silent: a persistent client/auth defect would
    // otherwise degrade the whole run to naive with no signal beyond the
    // durable pp-kept record.
    console.warn(`[lane-b] live Jev failed in ${gate}; using the naive default (${fallbackReason})`);
    return { value: await naive(), checker: "naive-fallback", fallbackReason, jevTokens: counting.tokens() };
  }
}

/** Citation scores for one reviewer's verdict (registry "citation-check"). */
export function runCitationGate(
  verdict: MetricsVerdictRecord,
  diff: DiffDocument,
  jev: JudgmentClient | undefined,
): Promise<JevGateResult<CitationCheckResult[]>> {
  return withJevFallback(
    "citation-check",
    jev,
    (client) => createCitationChecker(client).check(verdict, diff),
    () => naiveCitationCheck(verdict, diff),
  );
}

/** Fixer-queue ordering (registry "prioritize"); nothing to rank stays naive. */
export function runPrioritizeGate(
  findings: readonly MetricsFinding[],
  jev: JudgmentClient | undefined,
): Promise<JevGateResult<MetricsFinding[]>> {
  return withJevFallback(
    "prioritize",
    findings.length === 0 ? undefined : jev,
    (client) => createJevPrioritizer(client).prioritize(findings),
    () => naivePrioritize(findings),
  );
}

// Vitest triage (Lane-B "vitest-triage", declared in src/judgment-registry.ts)
// ---------------------------------------------------------------------------

/** Which classifier produced a vitest queue's triage, and why live Jev was abandoned. */
export interface VitestTriageRecord {
  checker: JudgmentChecker;
  fallbackReason: string | null;
}

/**
 * Queue-build triage for the parsed vitest records: Jev classifier when a
 * live client is injected (TYPESAFE_API_KEY), naive path-heuristic default
 * otherwise; Jev failing MID-batch fails open to the naive classifier (the
 * whole batch re-runs naive — no half-Jev state persists). Failing open is
 * not silent: the degradation is logged and reported through
 * `hooks.onTriage` ({checker: "naive-fallback", fallbackReason}) for the
 * caller to persist next to the queue state, like the citation gate's
 * records. Usage tokens are surfaced through hooks.onUsage as each Jev call
 * completes, so tokens spent before a failure are still accounted. `roots`
 * (US-010) carries the ported source/test/fixture roots derived from the prep
 * source map, so failures limited to a PORTED TEST file classify port-caused
 * and route to that file.
 */
export async function classifyVitestRecords(
  records: readonly VitestFailureRecord[],
  iteration: number,
  jev: JudgmentClient | undefined,
  hooks: { onUsage?: (tokens: number) => void; onTriage?: (triage: VitestTriageRecord) => void } = {},
  roots?: ClassifierRoots,
): Promise<VitestQueueState> {
  const naive = createNaiveClassifier(roots ?? {});
  const jevOptions: { onUsage?: (tokens: number) => void; roots?: ClassifierRoots } = {
    ...(hooks.onUsage !== undefined ? { onUsage: hooks.onUsage } : {}),
    ...(roots !== undefined ? { roots } : {}),
  };
  const gate = await withJevFallback(
    "vitest-triage",
    jev,
    (client) =>
      buildClassifiedVitestQueueState(records, iteration, createJevFailureClassifier(client, jevOptions)),
    () => buildClassifiedVitestQueueState(records, iteration, naive),
  );
  hooks.onTriage?.({ checker: gate.checker, fallbackReason: gate.fallbackReason });
  // `total` stays the TRUE failure count (burn-down honesty); the durable
  // per-record evidence is capped like the tsc error list.
  return {
    ...gate.value,
    failures: gate.value.failures.slice(0, VITEST_RECORD_CAP),
    classified: gate.value.classified.slice(0, VITEST_RECORD_CAP),
  };
}

/**
 * US-010: ported output roots derived from the prep source map — the fix
 * loop's classification must know which output trees are PORTED (including
 * the ported test tree, whose failures belong to the port loop, not the
 * fixture bucket). A root is a top-level directory of a normalized outPath;
 * roots whose files end in `.test.ts` are ported TEST roots.
 */
export function portedRootsFromSourceMap(
  sourceMap: Record<string, { outPath: string }>,
): { portedRoots: string[]; portedTestRoots: string[] } {
  const srcRoots = new Set<string>();
  const testRoots = new Set<string>();
  for (const row of Object.values(sourceMap)) {
    const rel = row.outPath.replace(/^\.\//, "");
    const slash = rel.indexOf("/");
    if (slash <= 0) continue;
    const root = rel.slice(0, slash);
    if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) testRoots.add(root);
    else srcRoots.add(root);
  }
  return {
    portedRoots: [...srcRoots].sort(),
    portedTestRoots: [...testRoots].sort(),
  };
}

/**
 * The vitest-triage routing predicate (single authority): a record reaches a
 * per-file fix feed iff it is port-caused AND attributed to that exact
 * output path ("./"-normalized). Unattributable records (attributedFile
 * null, deterministic port-caused default) match nothing per-file.
 */
export function vitestRoutedTo(
  classified: readonly ClassifiedVitestFailure[] | undefined,
  relPath: string,
): ClassifiedVitestFailure[] {
  const rel = relPath.replace(/^\.\//, "");
  return (classified ?? []).filter(
    (c) =>
      c.classification.failureClass === "port-caused" &&
      c.classification.attributedFile !== null &&
      c.classification.attributedFile.replace(/^\.\//, "") === rel,
  );
}

/**
 * Per-file fix-round feed (consumer of the classified queue state): the tsc
 * errors for this output path PLUS the vitest failures Lane-B triage routed
 * here (failureClass port-caused AND attributedFile === this path, normalized
 * "./"-free). Fixture-problem records and unattributable records (class
 * port-caused by the deterministic default, attributedFile null) reach no
 * per-file feed — they stay visible in the durable vitest queue state.
 */
export function queueFixFeedForFile(
  verify: QueueVerifyState | undefined,
  relPath: string,
): { errors: QueueVerifyError[]; testFailures: Array<{ name: string; message: string }> } {
  const rel = relPath.replace(/^\.\//, "");
  const errors = (verify?.errors ?? []).filter((e) => e.file.replace(/^\.\//, "") === rel);
  const testFailures = vitestRoutedTo(verify?.vitestState?.classified, rel).map((c) => ({
    name:
      c.record.testName === ""
        ? c.record.testFile
        : `${c.record.testFile} > ${c.record.testName}`,
    message: c.record.errorMessage,
  }));
  return { errors, testFailures };
}

// Harness injection (worker calls configurePortHarness at startup)
// ---------------------------------------------------------------------------

let PORT_HARNESS: AgentSessionClient | undefined;

export function configurePortHarness(harness: AgentSessionClient): void {
  PORT_HARNESS = harness;
}

function requireHarness(): AgentSessionClient {
  if (PORT_HARNESS === undefined) {
    throw new Error("configurePortHarness() was not called by the worker");
  }
  return PORT_HARNESS;
}

/** One agent turn: definition prompt + enforced tool policy + turn text. */
export function composeAgentTurn(def: AgentDefinition, turn: string): string {
  return [def.prompt, "", toolPolicyBlock(def), "", turn].join("\n\n");
}

/**
 * Stages everything in the lease worktree and returns the staged diff. Goes
 * through src/git/exec.ts so the 30s timeout and 64 MiB buffer apply (a bare
 * promisified execFile has Node's 1 MiB default buffer and no timeout).
 */
async function gitDiffStaged(worktreePath: string): Promise<string> {
  const runner = git(worktreePath);
  await runner.run(["add", "-A"]);
  return runner.run(["diff", "--cached"]);
}

async function writeOutFile(worktreePath: string, outPath: string, content: string): Promise<void> {
  const target = join(worktreePath, outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

interface AgentTurnResult {
  text: string;
  tokens: number | null;
  /** Full provider usage split (metrics-shaped); null when usage was absent. */
  usage: TokenUsage | null;
}

export async function runAgentTurn(input: {
  def: AgentDefinition;
  sessionId: string;
  turn: string;
  file: string;
  round: number;
  agent?: string;
  /** Per-turn model override (reviewer lane swap; undefined = default lane). */
  model?: { providerID: string; modelID: string };
  /** Per-turn reasoning variant (lane policy: src/harness/lanes.ts). */
  variant?: string;
}): Promise<AgentTurnResult> {
  const harness = requireHarness();
  // Bridge mode: ALL server-side tools disabled for every agent turn; the
  // toolkit mediates writes into the lease worktree (see toolOverridesAllOff).
  const reply = await harness.prompt(input.sessionId, composeAgentTurn(input.def, input.turn), {
    tools: toolOverridesAllOff(),
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.variant !== undefined ? { variant: input.variant } : {}),
  });
  if (reply.aborted) {
    throw new Error(`agent session aborted (file=${input.file} round=${input.round})`);
  }
  const tokens = reply.usage === null ? null : tokenTotal(reply.usage);
  // Wave-5 cost honesty: prefer the full usage split over the bare total —
  // the envelope contract accepts both; tokenTotalOf normalizes downstream.
  const usage = reply.usage === null ? null : toEnvelopeUsage(reply.usage);
  return { text: reply.text, tokens, usage };
}

export interface ReviewTurnDiff {
  raw: string;
  doc: DiffDocument;
  diffId: string;
  bodyLineOffset: number;
}

/**
 * Tier-1 evidence-only diagnosis at an ambiguous-shape throw site (US-003).
 * The assessor is the INJECTED seam (flows/runtime-hooks.ts) — this module
 * never imports the turn-health implementation (import-boundary, AC-B2).
 * Fail-open end to end: no assessor, an assessor error, or a null diagnosis
 * all leave the failure path EXACTLY as it was (AC-B3). The diagnosis, when
 * produced, reaches the telemetry stream as a record-role event via the
 * existing publisher path; the throwing attempt cannot persist anything
 * durably (0(g)) — the successor attempt's re-record is the durable surface.
 */
async function diagnoseAmbiguousThrow(input: {
  ctx: Context;
  file: string;
  round: number;
  reviewerId: string;
  stepId: string;
  attempt: number;
  usage: TokenUsage | null;
  text: string;
  shape: TurnShapeClass;
  errorMessage: string;
}): Promise<void> {
  const assessor = portTurnHealthAssessor();
  if (assessor === null) return; // Tier-1 unavailable -> no-diagnosis (fail-open)
  const observation: TurnObservation = {
    shape: input.shape,
    output_tokens: input.usage?.output_tokens ?? null,
    reasoning_tokens: input.usage?.reasoning_tokens ?? null,
    text_chars: input.text.length,
    error: input.errorMessage,
  };
  try {
    const diagnosis = await assessor.assess({
      file: input.file,
      stepId: input.stepId,
      turn: `${input.stepId}@${markerKeyOf(input.file, input.round)}`,
      reviewer: input.reviewerId,
      attempt: input.attempt,
      prior_failed_attempts: Math.max(0, input.attempt - 1),
      lane: isDemotedAttempt(input.attempt) ? "demoted" : "default",
      shape: observation,
      recordedAtUtc: new Date().toISOString(),
    });
    if (diagnosis !== null) publishTurnDiagnosisEvent(input.ctx, diagnosis);
  } catch {
    // Swallowed deliberately: diagnosis is evidence-only and must never
    // alter the step's failure path (AC-B3).
  }
}

/**
 * Reviewer turn inside a durable step: fresh session → fence persisted with
 * THIS step's decision (0(g)) → prompt with the diff by value → verdict
 * extracted, validated, and mapped onto the metrics shapes. Any failure
 * throws so dex retries the whole turn on a fresh session.
 *
 * US-006 repair-or-discard (on top of the US-003 turn-health behavior):
 * - a SCHEMA-VALID verdict is checked against the deterministic suspicion
 *   predicate (src/metrics/suspicion.ts — Lane A, zero judgment input);
 * - a SUSPECT verdict gets ONE repair re-prompt through the SAME reviewer
 *   session (same config; the repair reply flows through harness.prompt, so
 *   the Tier-0 degenerateReply guard applies to it). Repair success = the
 *   repaired verdict passes schema AND is not suspect. Repair failure =
 *   TOMBSTONE;
 * - attempt EXHAUSTION (deterministic: ctx.attempt >= maxAttempts, the
 *   in-step bound REVIEW_STEP_MAX_ATTEMPTS — independent of the step's dex
 *   executeRetry budget) converts that attempt's failure into a TOMBSTONE
 *   instead of a throw — with the failed turn's usage when the failure shape
 *   exposed it (the Tier-0 degenerate class does). A no-usage exhaustion
 *   (nothing measurable to anchor — provenance never zero) stays fatal:
 *   documented limitation, per the honest ADR.
 *
 * Tombstones carry the burned tokens of the discarded attempt(s); a
 * tombstoned reviewer contributes zero kept findings and, when BOTH
 * reviewers tombstone, the round proceeds degraded/unreviewed and the flow
 * reaches terminal-success.
 *
 * Turn-health (US-003, evidence-only):
 * - an ambiguous-shape throw (text present, verdict extraction failed /
 *   validation discarded) runs the injected Tier-1 assessor and publishes the
 *   diagnosis to the stream — fire-and-forget, zero control-flow effect;
 * - a SUCCESS on attempt n >= 2 re-records the prior attempts' diagnosis
 *   context DETERMINISTICALLY (attempt count is visible here; the throwing
 *   attempt cannot persist — 0(g)) on the returned record, which the review
 *   step piggybacks onto its completion envelope. A first-attempt success
 *   records nothing (healthy turns are shape-trivial: zero Jev, zero records).
 */

/** In-step verbatim-repeat memo (US-006 predicate arm c): the previous
 *  attempt's normalized reply per `<flowId>/<runId>:<step>:<diffId>`, held in
 *  the step closure's process memory ONLY — zero durable substrate;
 *  cross-attempt replay is already cache-busted by the retry-prompt suffix.
 *  Fix-wave keying (reviewer finding 3): the key carries the flow/run
 *  identity — keyed by step+diff alone, two flows reviewing the same
 *  file+round cross-contaminated (a flow inherited another flow's pending
 *  reply as its "prior attempt" -> false repair/tombstone). */
const inStepVerdictTexts = new Map<string, string>();

/** The in-step memo key for one review execution: flow/run + step + diff. */
function inStepMemoKey(input: {
  ctx: Context;
  reviewerId: string;
  stepId?: string;
  diff: ReviewTurnDiff;
}): string {
  return `${input.ctx.flowId}/${input.ctx.runId}:${input.stepId ?? reviewStepIdOf(input.reviewerId)}:${input.diff.diffId}`;
}

/**
 * Envelope step id of a port-loop review step for a reviewer id
 * ("reviewer-A" -> "pp-review-a", matching ReviewAStep's stepId). Callers in
 * other loops (prep review) pass their own explicit `stepId`.
 */
function reviewStepIdOf(reviewerId: string): string {
  return `pp-review-${reviewerId.replace(/^reviewer-/, "").toLowerCase()}`;
}

/** Test seam: clears the in-step verbatim memo (per-test isolation). */
export function resetInStepVerdictMemo(): void {
  inStepVerdictTexts.clear();
}

/**
 * In-step exhaustion bound for a review turn: on dex attempt >= this value a
 * failing turn with measurable provider usage becomes a TOMBSTONE instead of
 * a throw. It is NOT the step's dex retry budget: the review steps run
 * MODEL_STEP_OPTIONS (RESTART_WINDOW_RETRY, 8 attempts, sized to outlive a
 * worker restart), and connection-refused attempts during a restart also
 * count toward dex's attempt number. The two bounds are deliberately
 * independent (stage 3c, BUILD_NOTES); a usage-less failure at or past this
 * bound still throws and is retried within the dex budget.
 */
export const REVIEW_STEP_MAX_ATTEMPTS = 3;

/** Sums two usage splits (original turn + repair turn burned tokens). */
function addUsage(
  a: TokenUsage | null,
  b: TokenUsage | null,
): TokenUsage | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    ...(a.reasoning_tokens !== undefined || b.reasoning_tokens !== undefined
      ? { reasoning_tokens: (a.reasoning_tokens ?? 0) + (b.reasoning_tokens ?? 0) }
      : {}),
    ...(a.cache_read_tokens !== undefined || b.cache_read_tokens !== undefined
      ? { cache_read_tokens: (a.cache_read_tokens ?? 0) + (b.cache_read_tokens ?? 0) }
      : {}),
    ...(a.cache_write_tokens !== undefined || b.cache_write_tokens !== undefined
      ? { cache_write_tokens: (a.cache_write_tokens ?? 0) + (b.cache_write_tokens ?? 0) }
      : {}),
    ...(a.cost_usd !== undefined || b.cost_usd !== undefined
      ? { cost_usd: (a.cost_usd ?? 0) + (b.cost_usd ?? 0) }
      : {}),
  };
}

export async function runReviewTurn(input: {
  ctx: Context;
  reviewerId: string;
  file: string;
  round: number;
  epoch: number;
  diff: ReviewTurnDiff;
  /** Dex attempt (1-based). Retries get a cache-busting suffix (live finding:
   *  identical retry prompts replayed IDENTICAL truncated provider turns). */
  attempt?: number;
  /** The durable step's id (diagnosis turn identity: `<stepId>@<identity>`). */
  stepId?: string;
  /** In-step exhaustion bound (default REVIEW_STEP_MAX_ATTEMPTS); not dex's retry budget. */
  maxAttempts?: number;
}): Promise<{
  verdict: ReviewVerdict;
  tokens: number | TokenUsage | null;
  turnDiagnosis: TurnDiagnosis | null;
}> {
  const result = await runReviewTurnOnce(input);
  // Fix-wave memo hygiene (reviewer finding 3): the review execution ENDED
  // (verdict or tombstone returned) — the memo entry existed only to serve
  // throw-to-retry comparisons WITHIN this execution (a throwing attempt
  // leaves it; dex's next attempt reads it). Clearing here keeps the
  // process-global map bounded and guarantees a later execution — this
  // flow's or another's — never inherits a settled execution's reply.
  inStepVerdictTexts.delete(inStepMemoKey(input));
  return result;
}

async function runReviewTurnOnce(input: {
  ctx: Context;
  reviewerId: string;
  file: string;
  round: number;
  epoch: number;
  diff: ReviewTurnDiff;
  attempt?: number;
  stepId?: string;
  maxAttempts?: number;
}): Promise<{
  verdict: ReviewVerdict;
  tokens: number | TokenUsage | null;
  turnDiagnosis: TurnDiagnosis | null;
}> {
  const harness = requireHarness();
  // The envelope step this turn runs inside — the fence owner, the memo key
  // and every diagnosis turn label name the SAME id as the step's envelope.
  const stepId = input.stepId ?? reviewStepIdOf(input.reviewerId);
  const label = fenceLabel(input.file, input.round, input.epoch);
  const session = await harness.createSession(label);
  sessionFenceMap.set(input.ctx, label, {
    sessionId: session.id,
    stepId,
    epoch: input.epoch,
    label,
    persistedAtUtc: new Date().toISOString(),
  });

  const attemptNo = input.attempt ?? 1;
  const maxAttempts = Math.max(1, input.maxAttempts ?? REVIEW_STEP_MAX_ATTEMPTS);
  const stepKey = inStepMemoKey(input);
  // Tokens of THIS attempt's failed turn(s), reachable when the failure shape
  // exposed usage (Tier-0 degenerate throws carry it; parse/validation
  // failures had it in hand). null = nothing measurable to anchor.
  let lastUsage: TokenUsage | null = null;
  const tombstoneOf = (reason: string, usage: TokenUsage | null): {
    verdict: VerdictTombstone;
    tokens: number | TokenUsage | null;
    turnDiagnosis: TurnDiagnosis | null;
  } => {
    const tokens = usage;
    return {
      verdict: {
        reviewer: input.reviewerId,
        discarded: true,
        reason,
        attempt: attemptNo,
        tokens,
      },
      tokens,
      turnDiagnosis: null,
    };
  };

  try {
    const diffBlock = renderDiffForReview({
      diffText: input.diff.raw,
      file: input.file,
      round: input.round,
      diffId: input.diff.diffId,
    });
    // US-010: reviewers of a TEST-port diff review test code as test code.
    const scopeNote = testPortScopeNote(input.file);
    const turn = composeReviewerTurn({
      reviewerId: input.reviewerId,
      reviewerLabel: REVIEWER.name,
      diffBlock: diffBlock.block,
      ...(scopeNote !== null ? { scopeNote } : {}),
    });
    const turnText =
      attemptNo > 1
        ? `${turn}\n\n(retry attempt ${attemptNo}: a previous reply on this step was truncated or unparseable — respond with exactly one JSON object and nothing else)`
        : turn;
    // Lane routing = f(attempt) ONLY (US-002): from the demotion threshold
    // (isDemotedAttempt, src/harness/lanes.ts — the one place the rule lives)
    // a review turn leaves the reviewer lane (gpt-6-luna @ high) for
    // OPENCODE_REVIEWER_MODEL_FALLBACK or — when unset — the executor lane
    // (glm-5.3-flash @ max). Pure policy over the durable dex attempt count — no
    // env mutation, no durable flag substrate (intra-step writes don't survive;
    // 0(g)). Tier-0 retries (degenerate no-text replies) therefore land on the
    // fallback lane automatically. Table: reviewLaneRouting().
    const agent = reviewerAgentOverride();
    const routing = reviewLaneRouting(attemptNo);
    const result = await runAgentTurn({
      def: REVIEWER,
      sessionId: session.id,
      turn: turnText,
      file: input.file,
      round: input.round,
      ...(agent !== undefined ? { agent } : {}),
      ...routing,
    });
    lastUsage = result.usage;
    // In-step verbatim memo (arm c): capture the PRIOR attempt's normalized
    // reply BEFORE recording this one.
    const priorNormalized = inStepVerdictTexts.get(stepKey) ?? null;
    const replyNormalized = normalizeVerdictText(result.text);
    inStepVerdictTexts.set(stepKey, replyNormalized);

    // Deterministic successor re-record (US-003): on a retry (attempt > 1) the
    // prior attempt(s) left NO durable trace (0(g) — a throwing attempt cannot
    // persist), so THIS successful attempt records the deterministic context:
    // attempt count + resulting lane. NO Jev call — a parsed verdict is
    // shape-trivial and the battery must never fire on it (AC-B1).
    const turnDiagnosis =
      attemptNo > 1
        ? buildRetryContextDiagnosis({
            file: input.file,
            stepId,
            identity: markerKeyOf(input.file, input.round),
            reviewer: input.reviewerId,
            attempt: attemptNo,
            shape: {
              shape: "parsed",
              output_tokens: result.usage?.output_tokens ?? null,
              reasoning_tokens: result.usage?.reasoning_tokens ?? null,
              text_chars: result.text.length,
              error: null,
            },
            recordedAtUtc: new Date().toISOString(),
          })
        : null;

    let parsed: unknown;
    try {
      parsed = extractJsonObject(result.text);
    } catch (err) {
      // Ambiguous shape: parseable-length text that fails verdict extraction
      // (the 885-token case). Evidence-only Tier-1 assessment; the original
      // error still drives the retry (AC-B2/B3) — or the US-006 exhaustion
      // tombstone on the final attempt (catch below).
      await diagnoseAmbiguousThrow({
        ctx: input.ctx,
        file: input.file,
        round: input.round,
        reviewerId: input.reviewerId,
        stepId,
        attempt: attemptNo,
        usage: result.usage,
        text: result.text,
        shape: "unparseable-text",
        errorMessage: (err as Error).message,
      });
      throw err;
    }
    const parsedDiff = parseUnifiedDiff(input.diff.raw);
    const mapArgs = {
      file: input.file,
      reviewer: input.reviewerId,
      round: input.round,
      diffId: input.diff.diffId,
      // Re-parse from the stored raw text: ParsedDiff carries non-JSON helpers
      // (hunk resolution) and cannot live in the durable attribute itself.
      parsedDiff,
      bodyLineOffset: input.diff.bodyLineOffset,
      naiveCited: (finding: MetricsFinding) =>
        naiveCitationCheck(
          emptyRecordWith(input.file, input.round, input.reviewerId, input.diff.diffId, finding),
          input.diff.doc,
        ).find((c) => c.finding_id === finding.finding_id)?.p_cited ?? 0,
    } as const;
    const mapped = mapVerdictToMetrics({ raw: parsed, ...mapArgs });
    if (!mapped.ok) {
      // Extracted but invalid: the discard-class trigger (diagnosed as
      // evidence-only; the error drives the dex retry — or the US-006
      // exhaustion tombstone on the final attempt).
      const err = new Error(
        `reviewer ${input.reviewerId} verdict failed validation: ${mapped.errors.join("; ")}`,
      );
      await diagnoseAmbiguousThrow({
        ctx: input.ctx,
        file: input.file,
        round: input.round,
        reviewerId: input.reviewerId,
        stepId,
        attempt: attemptNo,
        usage: result.usage,
        text: result.text,
        shape: "discarded-verdict",
        errorMessage: err.message,
      });
      throw err;
    }

    // US-006 suspicion gate (Lane A): schema-valid does not mean trusted.
    const suspicion = evaluateSuspicion({
      record: mapped.record,
      parsedDiff,
      verdictText: result.text,
      priorNormalizedText: priorNormalized,
    });
    if (!suspicion.suspect) {
      return {
        verdict: { agent: mapped.agentRecord, metrics: mapped.record },
        tokens: result.usage ?? result.tokens,
        turnDiagnosis,
      };
    }

    // ONE repair re-prompt through the SAME reviewer session config; the
    // reply is routed through harness.prompt (Tier-0 degenerateReply guard).
    const repair = await runAgentTurn({
      def: REVIEWER,
      sessionId: session.id,
      turn: composeReviewerRepairTurn({ reasons: suspicion.reasons }),
      file: input.file,
      round: input.round,
      ...(agent !== undefined ? { agent } : {}),
      ...routing,
    });
    const burned = addUsage(result.usage, repair.usage);
    let repairedRaw: unknown;
    try {
      repairedRaw = extractJsonObject(repair.text);
    } catch {
      return tombstoneOf(
        `repair-failed-schema: repair reply had no parseable JSON object`,
        burned,
      );
    }
    const repaired = mapVerdictToMetrics({ raw: repairedRaw, ...mapArgs });
    if (!repaired.ok) {
      return tombstoneOf(
        `repair-failed-schema: ${repaired.errors.join("; ")}`,
        burned,
      );
    }
    // Repair-vs-original verbatim comparison (in-step, held in memory only).
    const suspicionAfter = evaluateSuspicion({
      record: repaired.record,
      parsedDiff,
      verdictText: repair.text,
      priorNormalizedText: replyNormalized,
    });
    if (suspicionAfter.suspect) {
      return tombstoneOf(
        `repair-still-suspect: ${suspicionAfter.reasons.join("; ")}`,
        burned,
      );
    }
    inStepVerdictTexts.set(stepKey, normalizeVerdictText(repair.text));
    return {
      verdict: { agent: repaired.agentRecord, metrics: repaired.record },
      tokens: burned ?? result.usage ?? result.tokens,
      turnDiagnosis,
    };
  } catch (err) {
    // US-006 exhaustion tombstone: deterministic ctx.attempt >= maxAttempts.
    if (attemptNo >= maxAttempts) {
      const errUsage =
        err instanceof OpencodePromptError && err.usage !== null
          ? toEnvelopeUsage(err.usage)
          : null;
      if (lastUsage !== null || errUsage !== null) {
        return tombstoneOf(
          `attempt-exhausted: ${(err as Error).message.slice(0, 300)}`,
          lastUsage ?? errUsage,
        );
      }
      // No measurable provider usage on the exhausted attempt — nothing to
      // anchor (provenance: never zero, never invented). The failure stays
      // fatal; documented US-006 limitation.
    }
    throw err;
  }
}

/** Single-finding metrics record scoping for the naive fallback citation. */
function emptyRecordWith(
  file: string,
  round: number,
  reviewer: string,
  diffId: string,
  finding: MetricsFinding,
): MetricsVerdictRecord {
  return {
    file,
    reviewer,
    round,
    diff_id: diffId,
    findings: [finding],
    citation_check: [],
  };
}

// ---------------------------------------------------------------------------
// The flow steps
// ---------------------------------------------------------------------------

/**
 * US-009-final (cx7 live finding): the connection-failure retry budget. After
 * a kill+resume, the dex server re-dispatches in-flight steps to the worker
 * target (127.0.0.1:8803) while the worker is still coming up — a restart
 * window of ~60s. The old budget (maximumAttempts 3, ~7s of backoff) was
 * shorter than the window, so the resumed marker/model steps exhausted
 * (dial refused → WORKER_API_ERROR, finalAttempt 3) and the flow FAILED
 * before the worker ever came back (cx7 resume fingerprint). This schedule
 * spans ~155s of exponential backoff (5s, 10s, 20s, then 30s-capped waits
 * across 8 attempts total), so re-dispatch retries outlive the restart window
 * with margin. dex 0.12.1 RetryPolicy has no error-class filter (verified
 * against dist/src/step.d.ts), so non-connection failures on these steps get
 * the same longer SCHEDULE — the exhaustion semantics are unchanged (the
 * final attempt still fails the step/flow), and policies outside the
 * marker/model/review scope keep their existing bounds (PpPrep stays at 1 —
 * a bad run input is permanent). The in-step REVIEW_STEP_MAX_ATTEMPTS
 * tombstone bound is independent of this retry budget and untouched.
 */
const RESTART_WINDOW_RETRY = {
  maximumAttempts: 8,
  initialIntervalMs: 5_000,
  backoffCoefficient: 2,
  maximumIntervalMs: 30_000,
} as const;

/** Model/review/fixer step retry policy (dex executeRetry). */
const MODEL_STEP_OPTIONS = { executeRetry: RESTART_WINDOW_RETRY } as const;

/** Pre-start marker retry policy — markers are the FIRST re-dispatched steps
 *  after a resume, so they carry the same restart-window budget. */
const MARKER_STEP_OPTIONS = { executeRetry: RESTART_WINDOW_RETRY } as const;

const PrepStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrep",
  stepId: "pp-prep",
  role: "record",
  // A prep/config failure is permanent (bad run input): never retry it.
  stepOptions: { executeRetry: { maximumAttempts: 1 } },
  inner: async (ctx, input) => {
    const raw = await readFile(input.prepPath, "utf8");
    const sourceMap = parsePrepSourceMap(raw);
    const missing = input.files.filter((f) => sourceMap[f] === undefined);
    if (missing.length > 0) {
      throw new Error(`prep source map lacks rows for: ${missing.join(", ")}`);
    }
    // Phase 3: harvest symbols (code-only, deterministic) for the per-symbol
    // table; the stub baseline is what the generated spec map supersedes.
    // ppPrep is finalized only after the capped prep-review loop.
    const symbols: PhpSymbol[] = [];
    for (const file of input.files) {
      const source = await readFile(join(input.sourceRoot, file), "utf8");
      symbols.push(...harvestPhpSymbols(file, source));
    }
    ppPrepSeed.set(ctx, "seed", { stubRaw: raw, symbols });
    ppPrepState.set(ctx, "state", { prepIteration: 0 });
    ppConfig.set(ctx, "config", { maxRounds: input.maxRounds, prepMaxRounds: 2 });
    ppQueue.set(ctx, "queue", {
      pending: [...input.files],
      current: null,
      done: [],
      blocked: [],
    });
    return { output: input, tokens: null };
  },
  route: (_ctx, _input, out) => goTo(SymbolStart, out),
});

/**
 * DispatchStep output: `done` = the port queue is exhausted; `requeue` = this
 * pass only recorded a blocked file (round cap) and must be followed by another
 * dispatch pass for the files still pending.
 */
type DispatchOutput = PortRunInput & { done: boolean; requeue?: boolean };

const DispatchStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, DispatchOutput>({
  stepType: "PpDispatch",
  stepId: "pp-dispatch",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppConfig] },
  // Best-effort identity: the claim happens inside inner, so the start
  // event reports the in-flight file (resume) or flow-level (fresh claim).
  identityOf: (ctx) => {
    const q = ppQueue.get(ctx, "queue");
    return q?.current ? markerKeyOf(q.current.file, q.current.round) : "";
  },
  inner: async (ctx, input) => {
    const queue = ppQueue.get(ctx, "queue");
    const config = ppConfig.get(ctx, "config");
    if ((input.dispatchMode ?? "parallel") === "parallel") {
      // Parallel mode: pending is consumed by the WAVE JOIN after children
      // commit — dispatch only reports whether the port queue is exhausted
      // (deriveNext's current/popping is sequential-loop machinery).
      const nothingPending = queue.pending.length === 0;
      return { output: { ...input, done: nothingPending }, tokens: null };
    }
    const action = deriveNext(queue, config?.maxRounds ?? input.maxRounds);
    if (action.kind === "blocked") {
      const blocked: PortQueueState = {
        ...queue,
        pending: queue.pending.filter((f) => f !== action.file),
        blocked: [
          ...queue.blocked,
          { file: action.file, round: action.round, reason: action.reason },
        ],
        current: null,
      };
      ppQueue.set(ctx, "queue", blocked);
      // Not Lease: with current cleared LeaseStep reads "exhausted" and ends the
      // run, silently abandoning every file still pending behind this one. Each
      // blocked pass removes one file, so re-dispatching always terminates.
      return { output: { ...input, done: false, requeue: true }, tokens: null, outcome: "skipped" };
    }
    if (action.kind === "start") {
      ppQueue.set(ctx, "queue", {
        ...queue,
        pending: queue.pending.filter((f) => f !== action.file),
        current: { file: action.file, round: 1, epoch: input.epoch },
      });
    }
    // "resume": current already set — nothing to mutate, just re-enter the loop.
    // "done": route below must go to Final (the loop terminator).
    return { output: { ...input, done: action.kind === "done" }, tokens: null };
  },
  route: (_ctx, _input, out) => {
    const { done, requeue, ...run } = out;
    if (requeue === true) return goTo(DispatchStep, run);
    if (done) return goTo(QueueVerifyStep, out);
    if ((out.dispatchMode ?? "parallel") !== "parallel") return goTo(LeaseStep, out);
    const portWave: WaveDispatchOutput = { ...out, mode: "port" };
    return goTo(WaveDispatchStep, portWave);
  },
});

/** Lease outcome: carry the file-round forward, or report an exhausted queue. */
export type LeaseOutcome =
  | { kind: "lease"; fri: FileRoundInput }
  | { kind: "exhausted"; input: PortRunInput };

const LeaseStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, LeaseOutcome>({
  stepType: "PpLease",
  stepId: "pp-lease",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppLease] },
  inner: async (ctx, input) => {
    const queue = ppQueue.get(ctx, "queue");
    const current = queue.current;
    if (current === null) {
      // Queue exhausted between dispatch and lease (retry-after-race or a
      // resumed replay): terminate gracefully instead of error-looping.
      return {
        output: { kind: "exhausted", input },
        tokens: null,
        outcome: "skipped" as EnvelopeOutcome,
      };
    }
    const pool = new WorktreePool(
      input.repoRoot,
      input.worktreeRoot,
      bindLeaseStore(ctx, ppLease),
      LEASE_SLOT_CAP,
    );
    // Idempotent per (file, epoch): a lease surviving a kill is reused.
    const existing = pool.store().get(current.file);
    if (existing !== undefined && !pool.isStale(existing, current.epoch)) {
      return {
        output: {
          kind: "lease",
          fri: {
            ...input,
            file: current.file,
            round: current.round,
            epoch: current.epoch,
            worktreePath: existing.worktreePath,
            branch: existing.branch,
          },
        },
        tokens: null,
      };
    }
    const acquired = await pool.acquire(current.file, current.epoch, `pp-${current.epoch}`);
    if (!acquired.acquired) {
      throw new Error(`lease failed for ${current.file}: ${acquired.reason}`);
    }
    return {
      output: {
        kind: "lease",
        fri: {
          ...input,
          file: current.file,
          round: current.round,
          epoch: current.epoch,
          worktreePath: acquired.lease.worktreePath,
          branch: acquired.lease.branch,
        },
      },
      tokens: null,
    };
  },
  route: (_ctx, _input, out) =>
    out.kind === "lease" ? goTo(FenceStep, out.fri) : goTo(FinalStep, out.input),
});

const FenceStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpFence",
  stepId: "pp-fence",
  role: "record",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  inner: async (ctx, fri) => {
    const harness = requireHarness();
    const label = fenceLabel(fri.file, fri.round, fri.epoch);
    // 0(g) mini-step semantics: the session exists and the fence lands
    // durably with this step's decision BEFORE the implementer prompts.
    const session = await harness.createSession(label);
    sessionFenceMap.set(ctx, label, {
      sessionId: session.id,
      stepId: "pp-implement",
      epoch: fri.epoch,
      label,
      persistedAtUtc: new Date().toISOString(),
    });
    return { output: fri, tokens: null };
  },
  // Phase 4: fix rounds (round >= 2) enter the queue-driven fix loop instead
  // of re-implementing from scratch. One QueueFix class serves both flows: it
  // reads its feed from the ctx-bound pp-verify, which is the parent's store
  // in port.Project and the child's by-value seed (ChildLeaseStep) in port.File.
  route: (_ctx, _input, fri) =>
    fri.round >= 2 ? goTo(QueueFixStart, fri) : goTo(ImplementStart, fri),
});

// M4 (0(g)): durable PRE-start markers for model-calling steps. The
// envelope's own start event is staged with its step's decision, so a kill
// inside the step leaves no envelope; this marker's decision lands first.
const ImplementStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpImplementStart",
  targetStepId: "pp-implement",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(ImplementStep, fri),
});

const ImplementStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpImplement",
  stepId: "pp-implement",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: {
    ...MODEL_STEP_OPTIONS,
    executeLoadAttributeMaps: [sessionFenceMap, ppPrep, ppQueue],
  },
  inner: async (ctx, fri) => {
    const opId = operationId(fri.file, fri.round);
    const label = fenceLabel(fri.file, fri.round, fri.epoch);
    const fence = sessionFenceMap.get(ctx, label);
    if (fence === undefined) {
      throw new Error(`no durable session fence for ${label}`);
    }
    const prep = ppPrep.get(ctx, "prep");
    if (prep === undefined) {
      throw new Error("prep artifact missing from durable attributes");
    }
    const phpSource = await readFile(join(fri.sourceRoot, fri.file), "utf8");
    const outPath = prep.sourceMap[fri.file]?.outPath ?? `src/${fri.file}.ts`;
    // US-010: test-file ports (PHPUnit -> vitest) announce their scope.
    const scopeNote = testPortScopeNote(fri.file);

    const turn = composeImplementerTurn({
      phpFileName: fri.file,
      phpSource,
      prepExcerpt: prep.raw,
      outputPath: outPath,
      ...(scopeNote !== null ? { scopeNote } : {}),
      ...(prep.userContract !== undefined ? { userContract: prep.userContract } : {}),
    });
    const result = await runAgentTurn({
      def: IMPLEMENTER,
      sessionId: fence.sessionId,
      turn,
      file: fri.file,
      round: fri.round,
      ...executorPromptOpts(),
    });
    const code = extractCodeFence(result.text, ".ts");
    await writeOutFile(fri.worktreePath, outPath, code);
    ppOut.set(ctx, outKeyOf(fri.file, fri.round), { outPath });
    return { output: fri, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, fri) => goTo(CaptureDiffStep, fri),
});

const CaptureDiffStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpCaptureDiff",
  stepId: "pp-capture-diff",
  role: "diff-capture",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  inner: async (ctx, fri) => {
    const raw = await gitDiffStaged(fri.worktreePath);
    const diffId = `diff-${safe(fri.file)}-r${fri.round}`;
    const doc: DiffDocument = {
      diff_id: diffId,
      file: fri.file,
      base_ref: "HEAD",
      hunks: parseUnifiedDiff(raw).hunks,
    };
    ppDiff.set(ctx, diffKeyOf(fri.file, fri.round), {
      diffId,
      raw,
      doc,
      bodyLineOffset: DIFF_HEADER_LINES,
    });
    return { output: fri, tokens: null };
  },
  route: (_ctx, _input, fri) => goTo(ReviewAStart, fri),
});

const ReviewAStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpReviewAStart",
  targetStepId: "pp-review-a",
  role: "review",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(ReviewAStep, fri),
});

const ReviewAStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpReviewA",
  stepId: "pp-review-a",
  role: "review",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppDiff] },
  inner: async (ctx, fri) => {
    const diff = ppDiff.get(ctx, diffKeyOf(fri.file, fri.round));
    if (diff === undefined) throw new Error(`captured diff missing for ${fri.file}#${fri.round}`);
    // Fix-wave (reviewer finding 4): turnDiagnosis (US-003 successor-attempt
    // re-record) is forwarded onto the step's completion envelope — it was
    // destructured away here, so the envelope never carried it.
    const { verdict, tokens, turnDiagnosis } = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-A",
      stepId: "pp-review-a",
      file: fri.file,
      round: fri.round,
      epoch: fri.epoch,
      diff,
      attempt: ctx.attempt,
    });
    ppVerdict.set(ctx, verdictKeyOf(fri.file, fri.round, "reviewer-A"), verdict);
    return { output: fri, tokens, turnDiagnosis };
  },
  route: (_ctx, _input, fri) => goTo(ReviewBStart, fri),
});

const ReviewBStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpReviewBStart",
  targetStepId: "pp-review-b",
  role: "review",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(ReviewBStep, fri),
});

const ReviewBStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpReviewB",
  stepId: "pp-review-b",
  role: "review",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppDiff] },
  inner: async (ctx, fri) => {
    const diff = ppDiff.get(ctx, diffKeyOf(fri.file, fri.round));
    if (diff === undefined) throw new Error(`captured diff missing for ${fri.file}#${fri.round}`);
    // Fix-wave (reviewer finding 4): forward the successor-attempt diagnosis.
    const { verdict, tokens, turnDiagnosis } = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-B",
      stepId: "pp-review-b",
      file: fri.file,
      round: fri.round,
      epoch: fri.epoch,
      diff,
      attempt: ctx.attempt,
    });
    ppVerdict.set(ctx, verdictKeyOf(fri.file, fri.round, "reviewer-B"), verdict);
    return { output: fri, tokens, turnDiagnosis };
  },
  route: (_ctx, _input, fri) => goTo(VerdictCheckStep, fri),
});

const VerdictCheckStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput & { keptCount: number }>({
  stepType: "PpVerdictCheck",
  stepId: "pp-verdict-check",
  role: "verdict-check",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  // cx6 live finding: recordJevUsage READS pp-jev-usage when the live Jev
  // citation loop spent tokens — an undeclared read throws (retried 46x,
  // each retry re-billing the citation batch). Writes need no declaration
  // (why pp-kept never surfaced this); READS do.
  stepOptions: { executeLoadAttributeMaps: [ppVerdict, ppDiff, ppJevUsage] },
  inner: async (ctx, fri) => {
    const diff = ppDiff.get(ctx, diffKeyOf(fri.file, fri.round));
    if (diff === undefined) throw new Error(`captured diff missing for ${fri.file}#${fri.round}`);
    const kept: MetricsFinding[] = [];
    const dropped: KeptFindings["dropped"] = [];
    const gate: CitationGateRecord[] = [];
    for (const reviewerId of ["reviewer-A", "reviewer-B"] as const) {
      const key = verdictKeyOf(fri.file, fri.round, reviewerId);
      const verdict = ppVerdict.get(ctx, key);
      if (verdict === undefined) {
        throw new Error(`verdict record missing for ${key}`);
      }
      // US-006 tombstone: a discarded reviewer contributes ZERO kept findings
      // — the discard rides the existing dropped-findings semantics. With
      // both reviewers tombstoned keptCount stays 0 and the keptCount-0
      // route below proceeds (degraded, unreviewed round — never a failure).
      if (isVerdictTombstone(verdict)) {
        dropped.push({
          finding_id: `tombstoned:${reviewerId}`,
          reviewer: reviewerId,
          reason: `reviewer discarded (attempt ${verdict.attempt}): ${verdict.reason}`,
        });
        continue;
      }
      // Citation check (Lane-B "citation-check"): LIVE Jev nouls when
      // configured (Phase 3 swap-in, createCitationChecker seam), else the
      // naive code-only default; a Jev failure fails OPEN to the naive check
      // (never a thrown, re-billed step). A finding survives iff its cited
      // evidence scores at least the checker's threshold (citationKept) and
      // its disposition asks for a fix.
      const outcome = await runCitationGate(verdict.metrics, diff.doc, liveJevClient());
      if (outcome.jevTokens > 0) {
        await recordJevUsage(ctx, `pp-verdict-check:${fri.file}#${fri.round}`, outcome.jevTokens);
      }
      gate.push({
        reviewer: reviewerId,
        checker: outcome.checker,
        fallbackReason: outcome.fallbackReason,
        scores: outcome.value.map((c) => ({ finding_id: c.finding_id, p_cited: c.p_cited })),
      });
      for (const check of outcome.value) {
        const agentFinding = verdict.agent.findings.find((f) => f.finding_id === check.finding_id);
        const metricsFinding = verdict.metrics.findings.find((f) => f.finding_id === check.finding_id);
        if (agentFinding === undefined || metricsFinding === undefined) continue;
        if (!citationKept(check.p_cited, outcome.checker)) {
          dropped.push({
            finding_id: check.finding_id,
            reviewer: reviewerId,
            reason: `citation check failed (p_cited=${check.p_cited})`,
            p_cited: check.p_cited,
          });
          continue;
        }
        if (agentFinding.disposition !== "fix") {
          dropped.push({
            finding_id: check.finding_id,
            reviewer: reviewerId,
            reason: `disposition "${agentFinding.disposition}"`,
          });
          continue;
        }
        kept.push(metricsFinding);
      }
    }
    ppKept.set(ctx, keptKeyOf(fri.file, fri.round), { findings: kept, dropped, citationGate: gate });
    return {
      output: { ...fri, keptCount: kept.length },
      tokens: null,
      outcome: kept.length > 0 ? "completed" : "skipped",
    };
  },
  route: (_ctx, _input, fri) =>
    fri.keptCount > 0 ? goTo(PrioritizeStep, fri) : goTo(CommitStep, fri),
});

const PrioritizeStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpPrioritize",
  stepId: "pp-prioritize",
  role: "prioritize",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  // cx6 live finding: ppJevUsage read via recordJevUsage (see pp-verdict-check).
  stepOptions: { executeLoadAttributeMaps: [ppKept, ppJevUsage] },
  inner: async (ctx, fri) => {
    const kept = ppKept.get(ctx, keptKeyOf(fri.file, fri.round));
    if (kept === undefined) throw new Error(`kept findings missing for ${fri.file}#${fri.round}`);
    // Lane-B "prioritize": live Jev rerank when configured, naive severity
    // order otherwise; a Jev failure fails OPEN to the naive order and the
    // degradation rides the pp-kept record (never a thrown, re-billed step).
    const outcome = await runPrioritizeGate(kept.findings, liveJevClient());
    if (outcome.jevTokens > 0) {
      await recordJevUsage(ctx, `pp-prioritize:${fri.file}#${fri.round}`, outcome.jevTokens);
    }
    ppKept.set(ctx, keptKeyOf(fri.file, fri.round), {
      ...kept,
      findings: outcome.value,
      prioritize: { checker: outcome.checker, fallbackReason: outcome.fallbackReason },
    });
    return { output: fri, tokens: null };
  },
  route: (_ctx, _input, fri) => goTo(FixerStart, fri),
});

const FixerStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpFixerStart",
  targetStepId: "pp-fixer",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(FixerStep, fri),
});

const FixerStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpFixer",
  stepId: "pp-fixer",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: {
    ...MODEL_STEP_OPTIONS,
    executeLoadAttributeMaps: [ppKept, ppOut, ppPrep],
  },
  inner: async (ctx, fri) => {
    const kept = ppKept.get(ctx, keptKeyOf(fri.file, fri.round));
    if (kept === undefined) throw new Error(`kept findings missing for ${fri.file}#${fri.round}`);
    if (kept.findings.length === 0) {
      // Clean review (verdict-check kept nothing): skip the fixer entirely.
      return { output: fri, tokens: null, outcome: "skipped" as EnvelopeOutcome };
    }
    // Fix rounds (round >= 2) enter via the queue-fix path which does NOT
    // run the implement step, so ppOut is never set for them — resolve the
    // output path with the prep source-map fallback exactly like the
    // queue-fix and integrate steps (live finding cx-5d fix wave).
    const out = ppOut.get(ctx, outKeyOf(fri.file, fri.round));
    const outPath =
      out?.outPath ?? ppPrep.get(ctx, "prep")?.sourceMap[fri.file]?.outPath;
    if (outPath === undefined) throw new Error(`output path missing for ${fri.file}#${fri.round}`);
    const current = await readFile(join(fri.worktreePath, outPath), "utf8");

    // Fresh fenced session for the fixer turn (fence staged with this
    // step's decision; enumeration fallback covers a mid-fix kill).
    const harness = requireHarness();
    const label = fenceLabel(`${fri.file}:fixer`, fri.round, fri.epoch);
    const session = await harness.createSession(label);
    sessionFenceMap.set(ctx, label, {
      sessionId: session.id,
      stepId: "pp-fixer",
      epoch: fri.epoch,
      label,
      persistedAtUtc: new Date().toISOString(),
    });

    const userContract = ppPrep.get(ctx, "prep")?.userContract;
    const turn = composeFixerTurn({
      currentContent: current,
      findings: kept.findings,
      outputPath: outPath,
      ...(userContract !== undefined ? { userContract } : {}),
    });
    const result = await runAgentTurn({
      def: FIXER,
      sessionId: session.id,
      turn,
      file: fri.file,
      round: fri.round,
      ...executorPromptOpts(),
    });
    const code = extractCodeFence(result.text, ".ts");
    await writeOutFile(fri.worktreePath, outPath, code);
    return { output: fri, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, fri) => goTo(CommitStep, fri),
});

const CommitStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpCommit",
  stepId: "pp-commit",
  role: "commit",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  // This step is the COMMIT-TIME subset of the recovery decision table: keyed
  // dedup (op-ID scan across ALL branches) plus the C1 cross-branch
  // reachability fix. It deliberately does NOT call reconcile()/applyReconcile()
  // (src/git/worktree.ts): those are the round-START recovery table that
  // `recover-port` (scripts/run-demo.ts) applies to a worktree before
  // re-dispatch. At commit time the lease worktree is dirty BY DESIGN (the
  // implementer's uncommitted output), and reconcile's `redone` arm resets a
  // dirty worktree to the lease base — wiring it in here would wipe the
  // round's own work. The `poisoned` rows (marker committed but no keyed
  // commit; no-op marker beside a keyed commit) are therefore raised by
  // recovery, not by this step.
  inner: async (ctx, fri) => {
    const opId = operationId(fri.file, fri.round);
    const key = markerKeyOf(fri.file, fri.round);

    // Sole-committer dedup: keyed lookup scans ALL branches first.
    const keyed = await findCommitByOpId(fri.repoRoot, opId);
    if (keyed !== undefined) {
      // C1: the keyed commit may sit on a DIFFERENT branch than this round's
      // lease (quarantined lease / epoch bump). Making it reachable from THIS
      // branch is what lets the integration step actually ship the round —
      // without it, the lease merges a branch that lacks the commit and the
      // completed round silently never lands in the output project.
      const replayDivergent = !(await isWorktreeClean(fri.worktreePath));
      const reach = await makeCommitReachable(fri.worktreePath, keyed);
      ppMarker.set(ctx, key, {
        round: fri.round,
        disposition: `committed:${opId}`,
        content_hash: keyed.contentHash ?? keyed.sha,
        sha: keyed.sha,
        keyed_branch: keyed.branch,
        replay_divergent: replayDivergent && reach !== "already",
      });
      return { output: fri, tokens: null, outcome: "skipped" as EnvelopeOutcome };
    }

    const res = await commitLeaseChanges(
      fri.worktreePath,
      opId,
      `porting-toolkit: port ${fri.file} (round ${fri.round})`,
    );
    ppMarker.set(ctx, key, {
      round: fri.round,
      disposition: res.disposition,
      content_hash: res.contentHash,
      sha: res.sha,
    });
    return {
      output: fri,
      tokens: null,
      outcome: (res.disposition === "no-op-empty-diff" ? "skipped" : "completed") as EnvelopeOutcome,
    };
  },
  route: (_ctx, _input, fri) =>
    fri.childFlow === true ? goTo(ChildReleaseStep, fri) : goTo(IntegrateStep, fri),
});

const IntegrateStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpIntegrate",
  stepId: "pp-integrate",
  role: "integration",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: { executeLoadAttributeMaps: [ppMarker, ppOut, ppPrep] },
  inner: async (ctx, fri) => {
    const result = await mergeLeaseIntoIntegration(
      fri.repoRoot,
      fri.integrationWorktreePath,
      fri.branch,
      "integration",
    );

    // C1 guard: when a keyed commit exists for this round it MUST be
    // reachable from integration HEAD — a no-op merge of a branch lacking
    // the commit would mark the round done while dropping its content.
    const opId = operationId(fri.file, fri.round);
    const keyed = await findCommitByOpId(fri.repoRoot, opId);
    if (keyed !== undefined && !(await keyedCommitIntegrated(fri.integrationWorktreePath, keyed))) {
      throw new Error(
        `C1: keyed commit ${keyed.sha} (${opId}) is NOT reachable from integration — refusing to mark the round integrated`,
      );
    }

    // M1: no-op rounds presuppose the ported OUTPUT file (outPath from the
    // prep map / pp-out), never the PHP source path this round ported FROM.
    const marker = ppMarker.get(ctx, markerKeyOf(fri.file, fri.round));
    if (marker !== undefined && marker.disposition === "no-op-empty-diff") {
      const out = ppOut.get(ctx, outKeyOf(fri.file, fri.round));
      const prep = ppPrep.get(ctx, "prep");
      const outPath = out?.outPath ?? prep?.sourceMap[fri.file]?.outPath;
      if (
        outPath === undefined ||
        !(await integratedContentExists(fri.integrationWorktreePath, outPath))
      ) {
        throw new Error(
          `no-op round for ${fri.file} (output ${outPath ?? "unknown"}) but integrated output lacks the file`,
        );
      }
    }
    void result;
    return { output: fri, tokens: null };
  },
  route: (_ctx, _input, fri) => goTo(ReleaseStep, fri),
});

const ReleaseStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, PortRunInput>({
  stepType: "PpRelease",
  stepId: "pp-release",
  role: "record",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  // ppLease: the lease is READ and removed through bindLeaseStore below.
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppMarker, ppLease] },
  inner: async (ctx, fri) => {
    const queue = ppQueue.get(ctx, "queue");
    if (queue.current === null) {
      throw new Error("release inconsistency: no current file-round");
    }
    // Give the lease slot back (mirrors ChildReleaseStep). Without this the
    // sequential loop accumulated one pp-lease record per file at the same
    // epoch and the third file failed "worktree cap (2) reached". The merge
    // into integration happened in IntegrateStep, so dropping the worktree
    // here is safe; the lease branch stays for keyed-commit reachability.
    await new WorktreePool(
      fri.repoRoot,
      fri.worktreeRoot,
      bindLeaseStore(ctx, ppLease),
      LEASE_SLOT_CAP,
    ).release(fri.file);
    const marker = ppMarker.get(ctx, markerKeyOf(fri.file, fri.round));
    ppQueue.set(ctx, "queue", {
      ...queue,
      current: null,
      done: [
        ...queue.done,
        {
          file: fri.file,
          round: fri.round,
          commitSha: marker?.sha ?? null,
          treeHash: marker?.content_hash ?? null,
        },
      ],
    });
    return { output: baseInput(fri), tokens: null };
  },
  // US-010 (sequential path): release routes through the bootstrap step
  // before dispatch — the idempotent provisioning runs right after the first
  // integration and is a no-op thereafter.
  route: (_ctx, _input, out) => goTo(BootstrapStep, out),
});

const FinalStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunResult>({
  stepType: "PpFinal",
  stepId: "pp-final",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppVerify] },
  inner: async (ctx, input) => {
    const queue = ppQueue.get(ctx, "queue");
    const verify = ppVerify.get(ctx, "verify");
    return {
      output: {
        completed: queue.done,
        blocked: queue.blocked,
        verification:
          verify === undefined
            ? null
            : {
                iteration: verify.iteration,
                tscTotal: verify.tscTotal,
                vitestTotal: verify.vitestTotal,
                vitestNote: verify.vitestNote,
                vitestRun: verify.vitestRun ?? null,
                tscRun: verify.tscRun ?? null,
              },
      },
      tokens: null,
    };
  },
});

/**
 * Rebuilds the run input after a sequential file-round. The run-level fields
 * (dispatchMode, maxRounds, prepPath, files) are carried on the FileRoundInput
 * by LeaseStep's spread; the stub values below apply only to a FileRoundInput
 * that never came from a run input.
 */
function baseInput(fri: FileRoundInput): PortRunInput {
  return {
    repoRoot: fri.repoRoot,
    worktreeRoot: fri.worktreeRoot,
    integrationWorktreePath: fri.integrationWorktreePath,
    epoch: fri.epoch,
    sourceRoot: fri.sourceRoot,
    prepPath: fri.prepPath ?? "",
    files: fri.files ?? [],
    maxRounds: fri.maxRounds ?? 1,
    ...(fri.dispatchMode !== undefined ? { dispatchMode: fri.dispatchMode } : {}),
  };
}

// ---------------------------------------------------------------------------
// Phase 3 — prep-analysis steps (spec map + per-symbol table + prep review)
// ---------------------------------------------------------------------------

const PREP_SPEC_FILE = "PORTING.spec.md";

const SymbolStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpSymbolStart",
  targetStepId: "pp-symbol-table",
  role: "judgment",
  stepOptions: MARKER_STEP_OPTIONS,
  route: (input) => goTo(SymbolTableStep, input),
});

const SymbolTableStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpSymbolTable",
  stepId: "pp-symbol-table",
  role: "judgment",
  stepOptions: { executeLoadAttributeMaps: [ppPrepSeed] },
  inner: async (ctx, input) => {
    const client = requirePortJudgment();
    const seed = ppPrepSeed.get(ctx, "seed");
    if (seed === undefined) throw new Error("prep seed missing");
    // Only the real client produces judgments; the offline double's answers
    // are scripted first-candidate picks and its token counts are synthetic.
    const scripted = client.kind !== "real";

    // Usage accumulator: selectSymbolType consumes the client internally, so
    // wrap it to capture System One usage for the envelope (never zero-null).
    let usageTokens = 0;
    const wrapped: JudgmentClient = {
      kind: client.kind,
      systemOne: async (request) => {
        const result = await client.systemOne(request);
        usageTokens += result.usage.input_tokens + result.usage.output_tokens;
        return result;
      },
    };

    const rows: SymbolTableRow[] = [];
    for (const symbol of seed.symbols) {
      const decision = await selectSymbolType(wrapped, symbol);
      rows.push({
        file: decision.file,
        symbol: decision.symbol,
        kind: kindOfSymbol(symbol),
        signature: symbol.signature,
        candidates: decision.candidates.map((c) => c.type),
        selected: decision.selected,
        flagged: decision.flagged,
        escalations: decision.escalations.length,
        judge: scripted ? "scripted" : "live",
      });
    }

    // P3 smoke kill point: AFTER the Jev selection loop, BEFORE the durable
    // table write (deterministic; set PORTING_KIT_FAULT=symbol-table:post:seed).
    if (faultMatches("symbol-table:post", "seed")) {
      crashPortWorker(`symbol-table:post:seed (${rows.length} rows computed)`);
    }

    ppSymtab.set(ctx, "symtab", { rows });
    // Real usage only: the scripted double's synthetic counts must not land in
    // the judgment-role totals, and "no calls were made" is an honest 0, not an
    // invented 1.
    return { output: input, tokens: scripted ? 0 : usageTokens };
  },
  route: (_ctx, _input, out) => goTo(PrepStart, out),
});

function kindOfSymbol(symbol: PhpSymbol): string {
  return symbol.kind;
}

const PrepStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpPrepGenerateStart",
  targetStepId: "pp-prep-generate",
  role: "agent",
  stepOptions: MARKER_STEP_OPTIONS,
  route: (input) => goTo(PrepGenerateStep, input),
});

const PrepGenerateStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepGenerate",
  stepId: "pp-prep-generate",
  role: "agent",
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppPrepSeed, ppSymtab] },
  inner: async (ctx, input) => {
    const seed = ppPrepSeed.get(ctx, "seed");
    const symtab = ppSymtab.get(ctx, "symtab");
    if (seed === undefined || symtab === undefined) {
      throw new Error("prep seed/symbol table missing");
    }
    const sources: Array<{ name: string; source: string }> = [];
    for (const file of input.files) {
      sources.push({ name: file, source: await readFile(join(input.sourceRoot, file), "utf8") });
    }
    const symbolTableText = renderSymbolTable(symtab.rows, sources);
    const turn = composePrepGenerateTurn({
      phpFiles: sources,
      symbolTableText,
      stubPrepBaseline: seed.stubRaw,
    });
    const result = await runAgentTurn({ def: IMPLEMENTER, sessionId: await prepSessionId(input.epoch), turn, file: PREP_SPEC_FILE, round: 0, ...plannerPromptOpts() });
    // Outermost ```markdown block + structural check (a truncated or
    // table-less spec throws, so dex retries instead of adopting it).
    const specText = extractSpecMap(result.text, { expectedFiles: input.files });
    ppPrepDraft.set(ctx, "draft", { specText, iteration: 0 });
    return { output: input, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, input) => goTo(PrepDiffCaptureStep, input),
});

/** Prep-loop identity for envelope event keys (spec file + iteration).
 * Defensive: an unloaded attribute map must never kill a start marker —
 * fall back to the flow-level prep identity. */
function prepIdentityOf(ctx: Context): string {
  try {
    const state = ppPrepState.get(ctx, "state");
    return state === undefined ? "prep" : `prep${state.prepIteration}`;
  } catch {
    return "prep";
  }
}

async function prepSessionId(epoch: number): Promise<string> {
  const harness = requireHarness();
  const label = fenceLabel(PREP_SPEC_FILE, 0, epoch);
  const session = await harness.createSession(label);
  return session.id;
}

const PrepDiffCaptureStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<
  PortRunInput,
  PortRunInput
>({
  stepType: "PpPrepDiffCapture",
  stepId: "pp-prep-diff-capture",
  role: "diff-capture",
  stepOptions: { executeLoadAttributeMaps: [ppPrepDraft, ppPrepState, ppPrepSeed] },
  inner: async (ctx, input) => {
    const draft = ppPrepDraft.get(ctx, "draft");
    const seed = ppPrepSeed.get(ctx, "seed");
    const state = ppPrepState.get(ctx, "state");
    if (draft === undefined || seed === undefined || state === undefined) {
      throw new Error("prep draft/seed/state missing");
    }
    // Artifact-diff (plan §Flow contract): the GENERATED artifacts vs the
    // baseline they supersede, rendered as a real unified diff. git exits 1
    // when files differ — that is data, not failure.
    const tmp = await mkdtemp(join(tmpdir(), "porting-kit-prep-"));
    try {
      const baselinePath = join(tmp, "baseline.md");
      const specPath = join(tmp, "spec.md");
      await writeFile(baselinePath, seed.stubRaw);
      await writeFile(specPath, draft.specText);
      // Exit 1 (files differ) carries the diff on stdout; a real failure
      // exits >= 2 with NOTHING on stdout. The old catch-all swallowed every
      // failure into an empty diff, which reviewers then "reviewed".
      const res = await git(tmp).tryRun(["diff", "--no-index", "--", baselinePath, specPath]);
      if (!res.ok && res.stdout.length === 0) {
        throw new Error(`prep diff failed: git diff --no-index: ${res.stderr.trim()}`);
      }
      const raw = res.stdout;
      const doc: DiffDocument = {
        diff_id: `prep-diff-${state.prepIteration}`,
        file: PREP_SPEC_FILE,
        base_ref: "baseline",
        hunks: parseUnifiedDiff(raw).hunks,
      };
      ppPrepDiff.set(ctx, "diff", {
        raw,
        doc,
        diffId: doc.diff_id,
        bodyLineOffset: DIFF_HEADER_LINES,
        iteration: state.prepIteration,
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    return { output: input, tokens: null };
  },
  route: (_ctx, _input, input) => goTo(PrepReviewAStart, input),
});

const PrepReviewAStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpPrepReviewAStart",
  targetStepId: "pp-prep-review-a",
  role: "review",
  identityOf: prepIdentityOf,
  stepOptions: { executeRetry: RESTART_WINDOW_RETRY, executeLoadAttributeMaps: [ppPrepState] },
  route: (input) => goTo(PrepReviewAStep, input),
});

const PrepReviewAStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepReviewA",
  stepId: "pp-prep-review-a",
  role: "review",
  // M2/M4 join identity: the attempt-0 start marker carries prep<iteration>;
  // the model envelope must carry the SAME identity or the AC2 marker join
  // (by stepId+identity) cannot see it.
  identityOf: prepIdentityOf,
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppPrepDiff, ppPrepState] },
  inner: async (ctx, input) => {
    const diff = ppPrepDiff.get(ctx, "diff");
    const state = ppPrepState.get(ctx, "state");
    if (diff === undefined || state === undefined) throw new Error("prep diff/state missing");
    // Fix-wave (reviewer finding 4): forward the successor-attempt diagnosis.
    const { verdict, tokens, turnDiagnosis } = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-A",
      stepId: "pp-prep-review-a",
      file: PREP_SPEC_FILE,
      round: state.prepIteration,
      epoch: input.epoch,
      diff,
      attempt: ctx.attempt,
    });
    ppPrepVerdict.set(ctx, verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, "reviewer-A"), verdict);
    return { output: input, tokens, turnDiagnosis };
  },
  route: (_ctx, _input, input) => goTo(PrepReviewBStart, input),
});

const PrepReviewBStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpPrepReviewBStart",
  targetStepId: "pp-prep-review-b",
  role: "review",
  identityOf: prepIdentityOf,
  stepOptions: { executeRetry: RESTART_WINDOW_RETRY, executeLoadAttributeMaps: [ppPrepState] },
  route: (input) => goTo(PrepReviewBStep, input),
});

const PrepReviewBStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepReviewB",
  stepId: "pp-prep-review-b",
  role: "review",
  // M2/M4 join identity — same rationale as PrepReviewAStep.
  identityOf: prepIdentityOf,
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppPrepDiff, ppPrepState] },
  inner: async (ctx, input) => {
    const diff = ppPrepDiff.get(ctx, "diff");
    const state = ppPrepState.get(ctx, "state");
    if (diff === undefined || state === undefined) throw new Error("prep diff/state missing");
    // Fix-wave (reviewer finding 4): forward the successor-attempt diagnosis.
    const { verdict, tokens, turnDiagnosis } = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-B",
      stepId: "pp-prep-review-b",
      file: PREP_SPEC_FILE,
      round: state.prepIteration,
      epoch: input.epoch,
      diff,
      attempt: ctx.attempt,
    });
    ppPrepVerdict.set(ctx, verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, "reviewer-B"), verdict);
    return { output: input, tokens, turnDiagnosis };
  },
  route: (_ctx, _input, input) => goTo(PrepVerdictCheckStep, input),
});

const PrepVerdictCheckStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepVerdictCheck",
  stepId: "pp-prep-verdict-check",
  role: "verdict-check",
  stepOptions: { executeLoadAttributeMaps: [ppPrepVerdict, ppPrepDiff, ppPrepState, ppConfig] },
  inner: async (ctx, input) => {
    const diff = ppPrepDiff.get(ctx, "diff");
    const state = ppPrepState.get(ctx, "state");
    const config = ppConfig.get(ctx, "config");
    if (diff === undefined || state === undefined || config === undefined) {
      throw new Error("prep diff/state/config missing");
    }
    const kept: MetricsFinding[] = [];
    const dropped: KeptFindings["dropped"] = [];
    const gate: CitationGateRecord[] = [];
    for (const reviewerId of ["reviewer-A", "reviewer-B"] as const) {
      const key = verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, reviewerId);
      const verdict = ppPrepVerdict.get(ctx, key);
      if (verdict === undefined) throw new Error(`prep verdict missing for ${key}`);
      // US-006 tombstone: a discarded prep reviewer contributes ZERO kept
      // findings; with both discarded the findings list stays empty and
      // PrepLoopDecisionStep finalizes (revise requires findings > 0) — the
      // prep loop TERMINATES on a degraded, unreviewed iteration.
      if (isVerdictTombstone(verdict)) {
        dropped.push({
          finding_id: `tombstoned:${reviewerId}`,
          reviewer: reviewerId,
          reason: `reviewer discarded (attempt ${verdict.attempt}): ${verdict.reason}`,
        });
        continue;
      }
      // The prep gate is deliberately NAIVE-only (registry "prep-citation-check"):
      // the spec-map diff is reviewed against a deterministic baseline and
      // never consults a judgment client.
      const citations = naiveCitationCheck(verdict.metrics, diff.doc);
      gate.push({
        reviewer: reviewerId,
        checker: "naive",
        fallbackReason: null,
        scores: citations.map((c) => ({ finding_id: c.finding_id, p_cited: c.p_cited })),
      });
      for (const check of citations) {
        const agentFinding = verdict.agent.findings.find((f) => f.finding_id === check.finding_id);
        const metricsFinding = verdict.metrics.findings.find((f) => f.finding_id === check.finding_id);
        if (agentFinding === undefined || metricsFinding === undefined) continue;
        if (!citationKept(check.p_cited, "naive")) {
          dropped.push({
            finding_id: check.finding_id,
            reviewer: reviewerId,
            reason: `citation check failed (p_cited=${check.p_cited})`,
            p_cited: check.p_cited,
          });
          continue;
        }
        if (agentFinding.disposition !== "fix") {
          dropped.push({
            finding_id: check.finding_id,
            reviewer: reviewerId,
            reason: `disposition "${agentFinding.disposition}"`,
          });
          continue;
        }
        kept.push(metricsFinding);
      }
    }
    ppPrepFindings.set(ctx, "findings", { findings: kept, dropped, citationGate: gate });
    // Counter ownership lives in PrepLoopDecision (single place decides a
    // revision; the increment rides with that decision — no double-count).
    void state;
    void config;
    return { output: input, tokens: null, outcome: kept.length > 0 ? "completed" : "skipped" };
  },
  route: (_ctx, _input, input) => goTo(PrepLoopDecisionStep, input),
});

/**
 * Prep loopback decision (kept separate so the loopback route is a pure
 * function of durable state): revise when unaddressed findings remain and
 * the prep cap allows; otherwise finalize and enter the port loop.
 */
const PrepLoopDecisionStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput & { revise: boolean }>({
  stepType: "PpPrepLoopDecision",
  stepId: "pp-prep-loop-decision",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppPrepFindings, ppPrepState, ppConfig] },
  inner: async (ctx, input) => {
    const findings = ppPrepFindings.get(ctx, "findings");
    const state = ppPrepState.get(ctx, "state");
    const config = ppConfig.get(ctx, "config");
    if (findings === undefined || state === undefined || config === undefined) {
      throw new Error("prep findings/state/config missing");
    }
    // Termination: a revision is allowed only STRICTLY BELOW the cap, and
    // the counter increments WITH the decision (so each revision consumes
    // one unit of the cap — bounded loopback, no runaway).
    const revise = findings.findings.length > 0 && state.prepIteration < config.prepMaxRounds;
    if (revise) {
      ppPrepState.set(ctx, "state", { prepIteration: state.prepIteration + 1 });
    }
    return { output: { ...input, revise }, tokens: null };
  },
  route: (_ctx, _input, out) => (out.revise ? goTo(PrepReviseStart, out) : goTo(PrepFinalizeStep, out)),
});

const PrepReviseStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpPrepReviseStart",
  targetStepId: "pp-prep-revise",
  role: "agent",
  identityOf: prepIdentityOf,
  stepOptions: { executeRetry: RESTART_WINDOW_RETRY, executeLoadAttributeMaps: [ppPrepState] },
  route: (input) => goTo(PrepReviseStep, input),
});

const PrepReviseStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepRevise",
  stepId: "pp-prep-revise",
  role: "agent",
  // M2/M4 join identity — same rationale as PrepReviewAStep.
  identityOf: prepIdentityOf,
  stepOptions: {
    ...MODEL_STEP_OPTIONS,
    executeLoadAttributeMaps: [ppPrepFindings, ppPrepDraft, ppPrepState],
  },
  inner: async (ctx, input) => {
    const findings = ppPrepFindings.get(ctx, "findings");
    const draft = ppPrepDraft.get(ctx, "draft");
    if (findings === undefined || draft === undefined) throw new Error("prep findings/draft missing");
    const turn = composePrepReviseTurn({
      specMapText: draft.specText,
      findings: findings.findings.map((f) => ({
        finding_id: f.finding_id,
        severity: f.severity,
        summary: f.summary,
        evidence: f.evidence?.quote ?? "(uncited)",
      })),
    });
    const result = await runAgentTurn({
      def: IMPLEMENTER,
      sessionId: await prepSessionId(input.epoch),
      turn,
      file: PREP_SPEC_FILE,
      round: 0,
      ...plannerPromptOpts(),
    });
    const specText = extractSpecMap(result.text, { expectedFiles: input.files });
    ppPrepDraft.set(ctx, "draft", { specText, iteration: draft.iteration + 1 });
    return { output: input, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, input) => goTo(PrepDiffCaptureStep, input),
});

const PrepFinalizeStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepFinalize",
  stepId: "pp-prep-finalize",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppPrepDraft, ppPrepSeed, ppSymtab] },
  inner: async (ctx, input) => {
    const draft = ppPrepDraft.get(ctx, "draft");
    const seed = ppPrepSeed.get(ctx, "seed");
    const symtab = ppSymtab.get(ctx, "symtab");
    if (draft === undefined || seed === undefined || symtab === undefined) {
      throw new Error("prep draft/seed/symtab missing at finalize");
    }
    // The port loop consumes the REVIEWED generated spec; the stub's source
    // map stays the deterministic php→ts path authority.
    ppPrep.set(ctx, "prep", {
      raw: draft.specText,
      sourceMap: parsePrepSourceMap(seed.stubRaw),
      symbolTable: symtab.rows,
      userContract: seed.stubRaw,
    });
    return { output: input, tokens: null };
  },
  route: (_ctx, _input, input) => goTo(DispatchStep, input),
});


// ---------------------------------------------------------------------------
// US-010 — integration bootstrap (deterministic, toolkit-owned): the integrated
// checkout gets a REAL test runner so vitest evidence can never be vacuously
// green. Agents never run installs: provisioning is its own durable step, the
// slow command (bun install) happens OUTSIDE every agent turn, the runner
// artifacts are committed by the sole-committer path under the dedicated
// op-ID `bootstrap:integration`, and every part is idempotent
// (skip-if-present), so kill-replay and re-runs converge.
// ---------------------------------------------------------------------------

/** Sole-committer op-ID for the bootstrap commit (dedup across kill/replay). */
export const BOOTSTRAP_OP_ID = "bootstrap:integration";

/** vitest devDependency version written into the bootstrapped package.json. */
export const BOOTSTRAP_VITEST_PIN = "^3.2.4";

/** What the runner inspected in the integration checkout (no decisions). */
export interface BootstrapInspection {
  /** package.json file text, or null when absent. */
  packageJsonRaw: string | null;
  tsconfigJson: boolean;
  vitestConfig: boolean;
  /** .gitignore file text, or null when absent. */
  gitignoreRaw: string | null;
  /** node_modules/.bin/vitest present (deps installed). */
  vitestBin: boolean;
}

/** Pure decision over an inspection: what the bootstrap must do. */
export interface BootstrapPlan {
  /** False when the checkout already satisfies every artifact (pure skip). */
  needed: boolean;
  packageJson: "write" | "patch" | "satisfied";
  tsconfig: boolean;
  vitestConfig: boolean;
  gitignore: boolean;
  /** bun install needed (bin missing, or package.json changes to sync). */
  install: boolean;
}

/** tsconfig `include` globs every scaffold covers, whatever the source map says. */
const DEFAULT_TSCONFIG_INCLUDE: readonly string[] = ["src/**/*.ts", "test/**/*.ts", "tests/**/*.ts"];

/**
 * C06: tsconfig `include` for the integrated checkout — the defaults PLUS the
 * top-level directory of every prep source-map output, so a map that puts
 * output outside src/test/tests does not make tsc fail with TS18003 (no
 * inputs). Outputs that are absolute, parent-relative or globbed are ignored
 * (the include must stay inside the checkout).
 */
export function tsconfigIncludeFromSourceMap(
  sourceMap: Record<string, { outPath: string }>,
): string[] {
  const include = new Set<string>(DEFAULT_TSCONFIG_INCLUDE);
  for (const row of Object.values(sourceMap)) {
    const rel = row.outPath.replace(/^\.\//, "");
    if (rel === "" || rel.startsWith("/") || rel.includes("*") || rel.split("/").includes("..")) continue;
    const ext = rel.endsWith(".tsx") ? "tsx" : "ts";
    const slash = rel.indexOf("/");
    include.add(slash > 0 ? `${rel.slice(0, slash)}/**/*.${ext}` : rel);
  }
  return [...include].sort();
}

/** The toolkit-owned scaffold tsconfig (single builder: bootstrap + verify fallback). */
export function scaffoldTsconfigText(include: readonly string[] = DEFAULT_TSCONFIG_INCLUDE): string {
  return (
    JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "Bundler",
          noEmit: true,
          skipLibCheck: true,
          types: [],
        },
        include,
      },
      null,
      2,
    ) + "\n"
  );
}

const BOOTSTRAP_TSCONFIG = scaffoldTsconfigText();

const BOOTSTRAP_VITEST_CONFIG = [
  'import { defineConfig } from "vitest/config";',
  "",
  "export default defineConfig({",
  "  test: {",
  '    include: ["test/**/*.test.ts", "tests/**/*.test.ts"],',
  "  },",
  "});",
  "",
].join("\n");

const BOOTSTRAP_PACKAGE_JSON =
  JSON.stringify(
    {
      name: "ported-project",
      private: true,
      type: "module",
      scripts: { test: "vitest run" },
      devDependencies: { vitest: BOOTSTRAP_VITEST_PIN },
    },
    null,
    2,
  ) + "\n";

/** US-010 pure core: decide the bootstrap work from an inspection. */
export function bootstrapPlan(insp: BootstrapInspection): BootstrapPlan {
  let packageJson: BootstrapPlan["packageJson"] = "satisfied";
  if (insp.packageJsonRaw === null) {
    packageJson = "write";
  } else {
    try {
      const parsed = JSON.parse(insp.packageJsonRaw) as {
        type?: string;
        scripts?: { test?: string };
        devDependencies?: { vitest?: string };
      };
      const ok =
        parsed.type === "module" &&
        parsed.scripts?.test === "vitest run" &&
        typeof parsed.devDependencies?.vitest === "string";
      if (!ok) packageJson = "patch";
    } catch {
      packageJson = "patch";
    }
  }
  const tsconfig = !insp.tsconfigJson;
  const vitestConfig = !insp.vitestConfig;
  const gitignore =
    insp.gitignoreRaw === null || !/^node_modules\/?$/m.test(insp.gitignoreRaw);
  const install = !insp.vitestBin || packageJson !== "satisfied";
  const needed =
    packageJson !== "satisfied" || tsconfig || vitestConfig || gitignore || install;
  return { needed, packageJson, tsconfig, vitestConfig, gitignore, install };
}

/** The deterministic vitest runner artifacts the bootstrap writes. */
export async function findVitestTestFiles(integrationWorktreePath: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (abs: string, rel: string): Promise<void> => {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        await walk(join(abs, e.name), `${rel}/${e.name}`);
      } else if (e.isFile() && /\.test\.tsx?$/.test(e.name)) {
        out.push(`${rel}/${e.name}`);
      }
    }
  };
  for (const dir of ["test", "tests"]) {
    const root = join(integrationWorktreePath, dir);
    if (await pathExists(root)) await walk(root, dir);
  }
  return out.sort();
}

/**
 * US-010 pure core: the honest vitest outcome from one queue attempt. The
 * runner either RAN (counts from the vitest summary + parsed failure records)
 * or did NOT run — with an explicit reason. A crashed runner (no parseable
 * summary) is NOT-RUN, never a zero-failure ran.
 *
 * C26: vitest 3.x writes the summary and per-file bullets to stdout but every
 * `FAIL` block (message, diff, `file:line:col` frames) to stderr, so `run`
 * carries both streams. They are read as stdout-then-stderr; the parsers
 * anchor the summary lines and start records on `FAIL` only, so the merge
 * neither doubles records nor lets the `Failed Tests N` banner win.
 */
export function vitestOutcomeFromRun(
  binExists: boolean,
  testFiles: readonly string[],
  run: { stdout: string; stderr?: string } | null,
): { vitestRun: VitestRunState; records: VitestFailureRecord[] } {
  if (!binExists) {
    return {
      vitestRun: {
        kind: "not-run",
        reason: "runner unavailable: vitest not installed in the integrated checkout",
      },
      records: [],
    };
  }
  if (testFiles.length === 0) {
    return {
      vitestRun: { kind: "not-run", reason: "no test files in the integrated checkout" },
      records: [],
    };
  }
  if (run === null) {
    return { vitestRun: { kind: "not-run", reason: "runner produced no output" }, records: [] };
  }
  const text = run.stderr === undefined || run.stderr === "" ? run.stdout : `${run.stdout}\n${run.stderr}`;
  const summary = parseVitestSummary(text);
  if (summary === null) {
    return {
      vitestRun: {
        kind: "not-run",
        reason: "runner produced no parseable summary (possible crash)",
      },
      records: [],
    };
  }
  return {
    vitestRun: {
      kind: "ran",
      passed: summary.tests.passed,
      failed: summary.tests.failed,
      total: summary.tests.total,
    },
    records: parseVitestOutput(text),
  };
}

export interface BootstrapOutcome {
  /** Any file write/patch or install happened on THIS invocation. */
  changed: boolean;
  wrote: string[];
  installRan: boolean;
  /** The sole-committer bootstrap commit landed on THIS invocation. */
  committed: boolean;
  sha: string | null;
  alreadyBootstrapped: boolean;
}

/** Injectable deps (tests pass a no-op install; the step defaults to bun). */
export interface BootstrapDeps {
  install?: (cwd: string) => Promise<void>;
}

/**
 * Provision the integrated checkout: package.json (type: module, test script
 * vitest run, vitest devDep), strict tsconfig.json, vitest.config.ts, a
 * node_modules gitignore, and the dependency install. Idempotent end to end:
 * a satisfied checkout is a no-op, and the commit dedups on BOOTSTRAP_OP_ID,
 * so kill-replay never duplicates the bootstrap commit.
 */
export async function runIntegrationBootstrap(
  input: { repoRoot: string; integrationWorktreePath: string; tsconfigInclude?: readonly string[] },
  deps: BootstrapDeps = {},
): Promise<BootstrapOutcome> {
  const itg = input.integrationWorktreePath;
  const readIfExists = async (p: string): Promise<string | null> => {
    try {
      return await readFile(p, "utf8");
    } catch {
      return null;
    }
  };
  const pkgRaw = await readIfExists(join(itg, "package.json"));
  const insp: BootstrapInspection = {
    packageJsonRaw: pkgRaw,
    tsconfigJson: await pathExists(join(itg, "tsconfig.json")),
    vitestConfig: await pathExists(join(itg, "vitest.config.ts")),
    gitignoreRaw: await readIfExists(join(itg, ".gitignore")),
    vitestBin: await pathExists(join(itg, "node_modules", ".bin", "vitest")),
  };
  const plan = bootstrapPlan(insp);
  const outcome: BootstrapOutcome = {
    changed: false,
    wrote: [],
    installRan: false,
    committed: false,
    sha: null,
    alreadyBootstrapped: !plan.needed,
  };
  if (!plan.needed) return outcome;

  const write = async (name: string, content: string): Promise<void> => {
    await writeFile(join(itg, name), content, "utf8");
    outcome.wrote.push(name);
    outcome.changed = true;
  };
  if (plan.packageJson === "write") {
    await write("package.json", BOOTSTRAP_PACKAGE_JSON);
  } else if (plan.packageJson === "patch") {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(pkgRaw ?? "{}") as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const obj = parsed as {
      type?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    obj.type = "module";
    obj.scripts = { ...(obj.scripts ?? {}), test: "vitest run" };
    obj.devDependencies = {
      ...(obj.devDependencies ?? {}),
      vitest: obj.devDependencies?.vitest ?? BOOTSTRAP_VITEST_PIN,
    };
    await write("package.json", `${JSON.stringify(obj, null, 2)}\n`);
  }
  if (plan.tsconfig) {
    await write(
      "tsconfig.json",
      input.tsconfigInclude === undefined ? BOOTSTRAP_TSCONFIG : scaffoldTsconfigText(input.tsconfigInclude),
    );
  }
  if (plan.vitestConfig) await write("vitest.config.ts", BOOTSTRAP_VITEST_CONFIG);
  if (plan.gitignore) {
    const base = (insp.gitignoreRaw ?? "").replace(/\n*$/, "\n");
    await write(".gitignore", `${base}node_modules/\n`);
  }

  if (plan.install) {
    const install =
      deps.install ??
      (async (cwd: string) => {
        await execFileP("bun", ["install"], { cwd, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
      });
    await install(itg);
    outcome.installRan = true;
    outcome.changed = true;
  }

  // Sole-committer dedup: a kill after commit replays to no second commit.
  const keyed = await findCommitByOpId(input.repoRoot, BOOTSTRAP_OP_ID);
  if (keyed === undefined) {
    const res = await commitLeaseChanges(
      itg,
      BOOTSTRAP_OP_ID,
      "porting-toolkit: integration bootstrap (vitest runner scaffold)",
    );
    outcome.committed = res.disposition !== "no-op-empty-diff";
    outcome.sha = res.sha;
  } else {
    outcome.sha = keyed.sha;
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Phase 4 — verification queues on the integrated checkout + fix rounds
// ---------------------------------------------------------------------------

const TSC_BIN = join(import.meta.dir, "..", "node_modules", ".bin", "tsc");

/**
 * Tool locations and timeouts for the verify step. Production defaults; a
 * mutable export so tests can point tsc at a missing binary or shrink the
 * timeout without spawning a 180 s process.
 */
export const queueVerifyTools = {
  tscBin: TSC_BIN,
  tscTimeoutMs: 180_000,
  vitestTimeoutMs: 180_000,
};

/** One finished child process, with everything execFile reports on failure. */
interface CapturedRun {
  stdout: string;
  stderr: string;
  /** Exit code; null when killed, signalled or never spawned. */
  exitCode: number | null;
  signal: string | null;
  /** True when execFile's timeout / maxBuffer guard killed the process. */
  killed: boolean;
  /** Spawn-level error code ("ENOENT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", ...). */
  errorCode: string | null;
}

/** Runs a tool to completion and NEVER throws: failure modes are data. */
async function runCaptured(
  bin: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<CapturedRun> {
  try {
    const { stdout, stderr } = await execFileP(bin, [...args], {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    return { stdout, stderr, exitCode: 0, signal: null, killed: false, errorCode: null };
  } catch (err) {
    const e = err as {
      stdout?: string;
      stderr?: string;
      code?: number | string | null;
      signal?: string | null;
      killed?: boolean;
    };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: typeof e.code === "number" ? e.code : null,
      signal: e.signal ?? null,
      killed: e.killed === true,
      errorCode: typeof e.code === "string" ? e.code : null,
    };
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

const QueueVerifyStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<
  PortRunInput,
  PortRunInput & { exhausted: boolean }
>({
  stepType: "PpQueueVerify",
  stepId: "pp-queue-verify",
  role: "queue",
  stepOptions: {
    // ppJevUsage: vitest-triage live Jev tokens are recorded via
    // recordJevUsage (read) — undeclared-read live finding, cx6.
    executeLoadAttributeMaps: [ppVerify, ppQueue, ppConfig, ppPrep, ppMarker, ppJevUsage],
  },
  inner: async (ctx, input) => {
    const config = ppConfig.get(ctx, "config");
    const queue = ppQueue.get(ctx, "queue");
    const prep = ppPrep.get(ctx, "prep");
    const prev = ppVerify.get(ctx, "verify");
    const iteration = (prev?.iteration ?? 0) + 1;
    const recordedAt = new Date().toISOString();
    const itg = input.integrationWorktreePath;

    // Toolkit-owned scaffold: the integrated checkout needs a tsconfig for
    // tsc; queue infrastructure is toolkit code, not agent content.
    if (!(await pathExists(join(itg, "tsconfig.json")))) {
      await writeFile(
        join(itg, "tsconfig.json"),
        scaffoldTsconfigText(tsconfigIncludeFromSourceMap(prep?.sourceMap ?? {})),
      );
    }

    // tsc queue: parse + group via the proven queue module. C06: the process
    // outcome (exit code, kill/timeout, spawn error) is data, not a silent
    // "0 parsed errors": a run that could not produce a trustworthy count is
    // recorded as NOT-RUN with its reason.
    const tscRun = await runCaptured(queueVerifyTools.tscBin, ["--noEmit", "--pretty", "false"], {
      cwd: itg,
      timeoutMs: queueVerifyTools.tscTimeoutMs,
    });
    let tscOut = `${tscRun.stdout}\n${tscRun.stderr}`;
    // Deterministic kill-smoke fault (Phase 4 exit): iteration 1 only — inject
    // one synthetic, self-labeled tsc error for the first done file so the fix
    // round ACTUALLY runs and the queue/fix-round kill window exists. Never
    // active without PORTING_KIT_FAULT; the injected line names itself.
    if (faultMatches("queue-verify:inject-error", "seed") && iteration === 1) {
      const firstDone = queue.done[0];
      const injectPath = firstDone !== undefined ? prep?.sourceMap[firstDone.file]?.outPath : undefined;
      if (firstDone !== undefined && injectPath !== undefined) {
        tscOut += `\n${injectPath.replace(/^\.\//, "")}(1,1): error TS9999: injected fault queue-verify:inject-error:seed (synthetic — fix-round durability smoke, not a real port error)\n`;
      }
    }
    const tscOutcome = tscOutcomeFromRun({
      output: tscOut,
      exitCode: tscRun.exitCode,
      signal: tscRun.signal,
      killed: tscRun.killed,
      errorCode: tscRun.errorCode,
      timeoutMs: queueVerifyTools.tscTimeoutMs,
    });
    const tscState = buildTscQueueState(tscOutcome.errors, iteration);

    // vitest queue (US-010 honest accounting): the runner either RAN — counts
    // from the vitest summary plus parsed failure records — or did NOT run,
    // with an explicit reason. Runner provisioning is the bootstrap step's job
    // (pp-bootstrap); a missing runner here is an honest not-run, never a bare
    // zero. Test-file discovery drives the not-run "no test files" reason and
    // the classification roots come from the prep source map (ported test
    // trees are port OUTPUT — their failures route to the port loop).
    const vitestBin = join(itg, "node_modules", ".bin", "vitest");
    const binExists = await pathExists(vitestBin);
    const testFiles = await findVitestTestFiles(itg);
    let vitestIo: { stdout: string; stderr: string } | null = null;
    if (binExists && testFiles.length > 0) {
      // C26: vitest 3.x writes every `FAIL` block (message, diff, frames) to
      // STDERR and only the summary + per-file bullets to stdout — both
      // streams are captured. A non-zero exit = failing tests (still ran —
      // the output carries counts); no output at all on a failed spawn = null.
      const vitestProc = await runCaptured(vitestBin, ["run", "--reporter", "default"], {
        cwd: itg,
        timeoutMs: queueVerifyTools.vitestTimeoutMs,
      });
      const silent = vitestProc.stdout === "" && vitestProc.stderr === "";
      vitestIo =
        silent && vitestProc.exitCode !== 0
          ? null
          : { stdout: vitestProc.stdout, stderr: vitestProc.stderr };
    }
    const { vitestRun, records: vitestRecords } = vitestOutcomeFromRun(binExists, testFiles, vitestIo);
    const vitestNote = vitestRun.kind === "not-run" ? vitestRun.reason : null;
    const jevUsageSink: number[] = [];
    const roots = portedRootsFromSourceMap(prep?.sourceMap ?? {});
    let vitestTriage: VitestTriageRecord | undefined;
    const vitestState = await classifyVitestRecords(vitestRecords, iteration, liveJevClient(), {
      onUsage: (tokens) => {
        jevUsageSink.push(tokens);
      },
      onTriage: (triage) => {
        vitestTriage = triage;
      },
    }, roots);
    const vitestJevTokens = jevUsageSink.reduce((sum, t) => sum + t, 0);
    if (vitestJevTokens > 0) {
      await recordJevUsage(ctx, "pp-queue-verify:vitest-triage", vitestJevTokens);
    }
    const vitestTotal = vitestState.total;

    // Burn-down upserts (dashboard renders queue-burndown/*).
    ppBurndown.set(ctx, `tsc-${iteration}`, {
      queue: "tsc",
      iteration,
      // C06: error_count counts LOCATED diagnostics only; the accounting says
      // whether that count is trustworthy (ran) or vacuous (not-run).
      error_count: tscState.total,
      file: null,
      recorded_at: recordedAt,
      tsc: tscOutcome.accounting,
    });
    ppBurndown.set(ctx, `vitest-${iteration}`, {
      queue: "vitest",
      iteration,
      // US-010: the count is honest ONLY alongside the state — a not-run
      // iteration is never read as "zero failures".
      error_count: vitestRun.kind === "ran" ? vitestRun.failed : 0,
      file: null,
      recorded_at: recordedAt,
      vitest:
        vitestRun.kind === "ran"
          ? { state: "ran", reason: null, passed: vitestRun.passed, failed: vitestRun.failed, total: vitestRun.total }
          : { state: "not-run", reason: vitestRun.reason, passed: null, failed: null, total: null },
    });
    for (const group of tscState.byFile.slice(0, 8)) {
      ppBurndown.set(ctx, `tsc-${iteration}-${group.file.replace(/\//g, "__")}`, {
        queue: "tsc",
        iteration,
        error_count: group.count,
        file: group.file,
        recorded_at: recordedAt,
      });
    }

    // Grouped errors feed the per-file fix loop: done files whose ported
    // output has queue errors get a FIX ROUND (round increment); files at the
    // round cap move to blocked (termination rule: caps OR empty queues).
    const outPathToPhp = new Map<string, { file: string; round: number }>();
    for (const d of queue.done) {
      const outPath = prep?.sourceMap[d.file]?.outPath;
      if (outPath !== undefined) outPathToPhp.set(outPath.replace(/^\.\//, ""), { file: d.file, round: d.round });
    }
    const errorCountByFile = errorCountsByOutput(tscState.errors, vitestState.classified);
    const { fixable, capped } = selectFixableFiles(
      queue.done,
      Object.fromEntries(
        Object.entries(prep?.sourceMap ?? {}).map(([php, v]) => [php, { outPath: v.outPath }]),
      ),
      errorCountByFile,
      config?.maxRounds ?? input.maxRounds,
    );
    // `capped` is recomputed from the WHOLE done set every iteration, so a
    // file capped earlier shows up again: append only files not already
    // blocked (C04 — else PortRunResult.blocked and the dashboard counts
    // inflate with every further iteration).
    const alreadyBlocked = new Set(queue.blocked.map((b) => b.file));
    const blocked = [
      ...queue.blocked,
      ...capped
        .filter((c) => !alreadyBlocked.has(c.file))
        .map((c) => ({
          file: c.file,
          round: c.round,
          reason: `round cap reached with ${c.count} queue error(s) remaining`,
        })),
    ];

    ppVerify.set(ctx, "verify", {
      iteration,
      fixQueue: fixable,
      tscTotal: tscState.total,
      vitestTotal,
      vitestNote,
      lastRunAt: recordedAt,
      // C05: capped PER FILE (not globally): selection above counts every
      // file's errors, so every fixable file must keep a non-empty feed.
      errors: capErrorsPerFile(tscState.errors).map((e) => ({
        file: e.file.replace(/^\.\//, ""),
        code: e.code,
        message: e.message,
        line: e.line,
      })),
      vitestState,
      vitestRun,
      tscRun: tscOutcome.accounting,
      ...(vitestTriage !== undefined ? { vitestTriage } : {}),
    });
    ppQueue.set(ctx, "queue", {
      ...queue,
      blocked,
      current:
        fixable.length > 0
          ? { file: fixable[0]!.file, round: fixable[0]!.fromRound + 1, epoch: input.epoch }
          : null,
    });

    // Remaining fixable files stay in fixQueue (release → dispatch →
    // QueueVerify pops the next one); exhausted = nothing fixable left.
    const exhausted = fixable.length === 0;
    return { output: { ...input, exhausted }, tokens: null };
  },
  route: (_ctx, input, out) => {
    if (out.exhausted) return goTo(FinalStep, out);
    if ((input.dispatchMode ?? "parallel") !== "parallel") return goTo(LeaseStep, out);
    const fixWave: WaveDispatchOutput = { ...input, mode: "fix" };
    return goTo(WaveDispatchStep, fixWave);
  },
});

const QueueFixStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpQueueFixStart",
  targetStepId: "pp-queue-fix",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(QueueFixStep, fri),
});

/**
 * US-010 integration bootstrap (durable, deterministic, toolkit-owned): after
 * the FIRST integration the checkout is provisioned with a REAL vitest runner
 * (package.json, strict tsconfig, vitest.config.ts, bun install). Agents never
 * run installs — provisioning is this step, so the slow command lives OUTSIDE
 * every agent turn. Idempotent (skip-if-present; commit dedups on
 * BOOTSTRAP_OP_ID), so re-entry after every wave join / sequential integrate
 * is a cheap no-op and kill-replay converges. In parallel mode it sits between
 * the parent's port-wave join and the next dispatch; in sequential mode
 * between each integrate and the release.
 */
const BootstrapStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpBootstrap",
  stepId: "pp-bootstrap",
  role: "integration",
  identityOf: () => "bootstrap",
  stepOptions: { executeRetry: { maximumAttempts: 2 }, executeLoadAttributeMaps: [ppPrep] },
  inner: async (ctx, input) => {
    // C06: the scaffold tsconfig must cover the prep source map's outputs.
    const prep = ppPrep.get(ctx, "prep");
    const outcome = await runIntegrationBootstrap({
      repoRoot: input.repoRoot,
      integrationWorktreePath: input.integrationWorktreePath,
      ...(prep !== undefined ? { tsconfigInclude: tsconfigIncludeFromSourceMap(prep.sourceMap) } : {}),
    });
    ppBootstrap.set(ctx, "bootstrap", {
      bootstrappedAtUtc: new Date().toISOString(),
      wrote: outcome.wrote,
      installRan: outcome.installRan,
      committed: outcome.committed,
      sha: outcome.sha,
    });
    return { output: input, tokens: null, outcome: outcome.changed ? "completed" : "skipped" };
  },
  // Both wiring points converge back on dispatch: parallel mode enters from
  // the port-wave join (before dispatch), sequential mode from Release
  // (integrate -> release -> bootstrap -> dispatch). Fix-wave joins skip it —
  // the idempotent skip keeps any unexpected re-entry a cheap no-op.
  route: (_ctx, _input, out) => goTo(DispatchStep, out),
});

/**
 * Queue-driven fix step (Phase 4 fix loop): the fixer receives the grouped
 * queue errors for THIS file by value and produces the fixed file. Clean
 * runs skip it entirely. Shared by port.Project (sequential mode) and
 * port.File (parallel children): the feed is read from the flow's own
 * ctx-bound pp-verify, so the step body is identical in both.
 */
const QueueFixStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpQueueFix",
  stepId: "pp-queue-fix",
  role: "agent",
  // cx-5e: identity-keyed envelope (see ChildLeaseStep note).
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: {
    ...MODEL_STEP_OPTIONS,
    executeLoadAttributeMaps: [ppVerify, ppOut, ppPrep],
  },
  inner: async (ctx, fri) => {
    const verify = ppVerify.get(ctx, "verify");
    const prep = ppPrep.get(ctx, "prep");
    const out = ppOut.get(ctx, outKeyOf(fri.file, fri.round));
    const outPath = out?.outPath ?? prep?.sourceMap[fri.file]?.outPath;
    if (outPath === undefined) throw new Error(`output path missing for ${fri.file}#${fri.round}`);
    const rel = outPath.replace(/^\.\//, "");
    // Fix-round feed: tsc errors + vitest failures triaged to this file
    // (Lane-B vitest-triage; registry-declared routing by attributedFile).
    const feed = queueFixFeedForFile(verify, rel);
    const errs = feed.errors;
    if (errs.length === 0 && feed.testFailures.length === 0) {
      // Nothing to fix: no agent turn. The envelope rejects tokens:null for a
      // model-calling role even on a skip (it threw "provenance failure"), so
      // a skip reports its true usage: an explicit 0.
      return { output: fri, tokens: 0, outcome: "skipped" as EnvelopeOutcome };
    }
    const current = await readFile(join(fri.worktreePath, outPath), "utf8");

    // Fresh fenced session (0(g): fence staged with this step's decision).
    const harness = requireHarness();
    const label = fenceLabel(`${fri.file}:queuefix`, fri.round, fri.epoch);
    const session = await harness.createSession(label);
    sessionFenceMap.set(ctx, label, {
      sessionId: session.id,
      stepId: "pp-queue-fix",
      epoch: fri.epoch,
      label,
      persistedAtUtc: new Date().toISOString(),
    });

    const turn = composeQueueFixTurn({
      currentContent: current,
      outputPath: outPath,
      errors: errs.map((e) => ({ code: e.code, message: e.message, line: e.line })),
      testFailures: feed.testFailures,
      ...(prep?.userContract !== undefined ? { userContract: prep.userContract } : {}),
    });
    const result = await runAgentTurn({
      def: FIXER,
      sessionId: session.id,
      turn,
      file: fri.file,
      round: fri.round,
      ...executorPromptOpts(),
    });
    const code = extractCodeFence(result.text, ".ts");
    await writeOutFile(fri.worktreePath, outPath, code);
    return { output: fri, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, fri) => goTo(CaptureDiffStep, fri),
});

// ---------------------------------------------------------------------------
// v1.1 — parallel per-file dispatch (dex SubFlows; default mode)
//
// WaveDispatch plans the next ≤2-file wave from the durable queue (fresh or
// fix rounds). WaveJoin declares `Wait.allOf(...SubFlow.run(PortFileFlow, …))`
// so both lease slots fill CONCURRENTLY; dex's RESTART_IF_PREVIOUS_EXITS_
// ABNORMALLY SubFlow reuse policy restarts a dead child on resume, making the
// join kill-safe. Children run the FULL per-file pipeline (lease → fence →
// implement/fix → reviews → commit) against their OWN attribute stores; the
// parent integrates serially after the join (the shared integration worktree
// never races) and appends git-derived done entries. Caps: one lease per
// child, wave width ≤ CHILD_SLOT_CAP. The WorktreePool cap is enforced per
// lease STORE and every child owns its own pp-lease store, so it can never
// trip across siblings: concurrency is bounded ONLY by the wave planner's
// slice width, never widened.
// ---------------------------------------------------------------------------

/** Input of one per-file child flow (PortFileFlow). */
export interface PortFileInput {
  repoRoot: string;
  worktreeRoot: string;
  integrationWorktreePath: string;
  sourceRoot: string;
  epoch: number;
  file: string;
  round: number;
  maxRounds: number;
  /** The parent's reviewed prep artifact (children own a copy in their store). */
  prep: PrepArtifact;
  /** Grouped queue errors for fix rounds (round ≥ 2); empty for round 1. */
  queueFixErrors: ReadonlyArray<QueueVerifyError>;
  /** Vitest failures triaged to this file (fix rounds; by-value records). */
  queueFixVitest: ReadonlyArray<ClassifiedVitestFailure>;
}

/** Wave width: one child per lease slot (the only cross-child concurrency bound). */
const CHILD_SLOT_CAP = LEASE_SLOT_CAP;

function childInputOf(
  base: PortRunInput,
  prep: PrepArtifact,
  file: string,
  round: number,
  errors: ReadonlyArray<QueueVerifyError>,
  vitest: ReadonlyArray<ClassifiedVitestFailure>,
): PortFileInput {
  return {
    repoRoot: base.repoRoot,
    worktreeRoot: base.worktreeRoot,
    integrationWorktreePath: base.integrationWorktreePath,
    sourceRoot: base.sourceRoot,
    epoch: base.epoch,
    file,
    round,
    maxRounds: base.maxRounds,
    prep,
    queueFixErrors: errors,
    queueFixVitest: vitest,
  };
}

/** The round one wave entry runs at (pre-C03 records carry only the wave's). */
export function waveEntryRound(wave: Pick<WaveDispatchRecord, "round">, entry: Pick<WaveEntry, "round">): number {
  return entry.round ?? wave.round;
}

export type WaveMode = "port" | "fix";
export interface WaveDispatchOutput extends PortRunInput {
  mode: WaveMode;
}

const WaveDispatchStep: EnvelopeStepClass<WaveDispatchOutput> = envelopeStepClass<
  WaveDispatchOutput,
  WaveDispatchOutput
>({
  stepType: "PpWaveDispatch",
  stepId: "pp-wave-dispatch",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppVerify, ppConfig, ppPrep, ppWave] },
  inner: async (ctx, input) => {
    const queue = ppQueue.get(ctx, "queue");
    const verify = ppVerify.get(ctx, "verify");
    const prep = ppPrep.get(ctx, "prep");
    if (queue === undefined || prep === undefined) {
      throw new Error("wave dispatch requires durable queue + prep state");
    }
    let entries: WaveEntry[];
    if (input.mode === "fix") {
      const fixable = (verify?.fixQueue ?? []).slice(0, CHILD_SLOT_CAP);
      if (fixable.length === 0) throw new Error("fix wave dispatched with empty fix queue");
      const outPathOf = (file: string): string =>
        (prep.sourceMap[file]?.outPath ?? "").replace(/^\.\//, "");
      // C03: a fix queue mixes files at different fromRounds. Each entry runs
      // at ITS OWN next round — one shared round skipped a round for the
      // lower-round file, or re-ran the higher-round file at a round whose
      // keyed commit already exists (the new fix deduped away).
      entries = fixable.map((f) => ({
        file: f.file,
        round: f.fromRound + 1,
        errors: (verify?.errors ?? []).filter((e) => e.file === outPathOf(f.file)),
        vitest: vitestRoutedTo(verify?.vitestState?.classified, outPathOf(f.file)),
      }));
    } else {
      const files = queue.pending.slice(0, CHILD_SLOT_CAP);
      if (files.length === 0) throw new Error("port wave dispatched with empty pending queue");
      entries = files.map((file) => ({ file, round: 1, errors: [], vitest: [] }));
    }
    ppWave.set(ctx, "wave", {
      entries,
      round: entries[0]?.round ?? 1,
      mode: input.mode,
      dispatchedAtUtc: new Date().toISOString(),
    });
    return { output: { ...input, mode: input.mode }, tokens: null };
  },
  route: (_ctx, _input, out) => goTo(WaveJoinStep, out),
});

const WaveJoinStep: EnvelopeStepClass<WaveDispatchOutput> = envelopeStepClass<
  WaveDispatchOutput,
  WaveDispatchOutput
>({
  stepType: "PpWaveJoin",
  stepId: "pp-wave-join",
  role: "record",
  stepOptions: {
    executeLoadAttributeMaps: [ppQueue, ppVerify, ppPrep, ppWave],
    // Live finding (cx-5 first parallel dispatch): dex loads maps for the
    // EXECUTE phase via executeLoadAttributeMaps, but the WAIT-FOR phase has
    // its OWN load set — the join's waitFor reads pp-prep/pp-wave and failed
    // 14 attempts with "AttributeMap instance was not loaded for this
    // invocation: pp-prep/prep" until this declaration was added.
    waitForLoadAttributeMaps: [ppPrep, ppWave],
    // US-009-final: the join re-executes into the restart gap after a
    // kill+resume (cx7 resume fingerprint: finalAttempt 3 on the old 3-attempt
    // budget); same raised schedule as the marker/model steps.
    executeRetry: RESTART_WINDOW_RETRY,
    // The wait spans two full per-file pipelines; generous method timeout.
    waitForMethodTimeoutMs: 4 * 60 * 60_000,
  },
  waitFor: (ctx, input) => {
    const prep = ppPrep.get(ctx, "prep");
    if (prep === undefined) throw new Error("wave join requires durable prep state");
    const wave = ppWave.get(ctx, "wave");
    if (wave === undefined) throw new Error("wave join requires a durable wave record");
    const conditions = wave.entries.map((entry, i) => {
      const round = waveEntryRound(wave, entry);
      return SubFlow.run(
        PortFileFlowInstance,
        childInputOf(input, prep, entry.file, round, entry.errors, entry.vitest),
        { conditionId: `wave-${wave.mode}-${round}-${i}` },
      );
    });
    return Wait.allOf(...conditions);
  },
  inner: async (ctx, input) => {
    const wave = ppWave.get(ctx, "wave");
    const queue = ppQueue.get(ctx, "queue");
    if (wave === undefined || queue === undefined) {
      throw new Error("wave join requires durable wave + queue state");
    }
    // Publish child flow ids (metrics/dashboard fan-out surface).
    ppWaveChildren.set(ctx, "children", {
      children: wave.entries.map((entry, i) => ({
        file: entry.file,
        round: waveEntryRound(wave, entry),
        flowId: SubFlow.getFlowId(ctx, i),
      })),
    });

    // Serial integration of each child's keyed commit (git-durable; the
    // children released their leases, so this is the proven quarantine
    // geometry — branch merge from the shared object store). A child that
    // ended no-op-empty-diff has NO keyed commit: its receipt (terminal
    // SubFlow output) is the evidence, and the round-1 integrated content
    // must already exist (plan's no-op reconcile row).
    const prep = ppPrep.get(ctx, "prep");
    const done = [...queue.done];
    for (let i = 0; i < wave.entries.length; i++) {
      const entry = wave.entries[i]!;
      const round = waveEntryRound(wave, entry);
      const result = SubFlow.getConditionResults(ctx, i);
      if (!result.isTerminal || result.errorType !== undefined) {
        throw new Error(`wave join: child ${entry.file}#${round} not successfully terminal (${result.status})`);
      }
      const receipt = result.singleOutput<ChildFileResult>();
      const opId = operationId(entry.file, round);
      const keyed = await findCommitByOpId(input.repoRoot, opId);
      if (keyed !== undefined) {
        await mergeLeaseIntoIntegration(
          input.repoRoot,
          input.integrationWorktreePath,
          keyed.branch,
          "integration",
        );
        if (!(await keyedCommitIntegrated(input.integrationWorktreePath, keyed))) {
          throw new Error(`C1: keyed commit ${keyed.sha} (${opId}) not reachable from integration`);
        }
        done.push({
          file: entry.file,
          round,
          commitSha: keyed.sha,
          treeHash: keyed.contentHash ?? null,
        });
      } else {
        const outPath = prep?.sourceMap[entry.file]?.outPath;
        if (
          outPath === undefined ||
          !(await integratedContentExists(input.integrationWorktreePath, outPath))
        ) {
          throw new Error(
            `wave join: no-op round for ${entry.file} (output ${outPath ?? "unknown"}) but integrated output lacks the file`,
          );
        }
        done.push({
          file: entry.file,
          round,
          commitSha: receipt.commitSha ?? null,
          treeHash: receipt.treeHash ?? null,
        });
      }
    }

    const next: PortQueueState = {
      ...queue,
      done,
      current: null,
      pending:
        input.mode === "fix"
          ? queue.pending
          : queue.pending.filter((f) => !wave.entries.some((e) => e.file === f)),
    };
    if (input.mode === "fix") {
      // Drop consumed fix-queue entries so re-verification is honest.
      const verify = ppVerify.get(ctx, "verify");
      if (verify !== undefined) {
        ppVerify.set(ctx, "verify", {
          ...verify,
          fixQueue: verify.fixQueue.filter(
            (f) => !wave.entries.some((e) => e.file === f.file),
          ),
        });
      }
    }
    ppQueue.set(ctx, "queue", next);
    return { output: input, tokens: null };
  },
  route: (_ctx, _input, out) =>
    out.mode === "fix"
      ? goTo(QueueVerifyStep, baseInputOf(out))
      : goTo(BootstrapStep, baseInputOf(out)),
});

function baseInputOf(out: WaveDispatchOutput): PortRunInput {
  const { mode: _mode, ...rest } = out;
  void _mode;
  return rest;
}

// ---------------------------------------------------------------------------
// PortFileFlow — one file's full pipeline as an independent, kill-safe flow
// ---------------------------------------------------------------------------

const ChildLeaseStep: EnvelopeStepClass<PortFileInput> = envelopeStepClass<PortFileInput, FileRoundInput>({
  stepType: "PpChildLease",
  stepId: "pp-child-lease",
  role: "record",
  // Live finding cx-5e: without identityOf the lease envelope keys flow-level
  // while its dispatch entry carries file#round — the AC2 anchor then reports
  // it (and the queue-fix steps below) as unanchored. Per-file steps MUST key
  // their envelopes by the sanitized file#round identity.
  identityOf: (_ctx, input) => markerKeyOf(input.file, input.round),
  stepOptions: {
    // ppLease is READ through bindLeaseStore (lease reclaim/put); live
    // finding cx-5c: the child's first step failed 3 attempts with
    // "AttributeMap instance was not loaded: pp-lease/pool" until declared.
    executeLoadAttributeMaps: [ppPrep, ppVerify, ppLease],
    // US-009-final: child-entry re-dispatch after a resume faces the same
    // restart-window connection budget (cx7: the resumed fix-wave child
    // re-executed into the gap); raised with the marker/model schedule.
    executeRetry: RESTART_WINDOW_RETRY,
  },
  inner: async (ctx, input) => {
    // Seed the child's OWN stores with the parent-provided prep + queue
    // errors: every downstream per-file step is store-local (ctx-bound), so
    // the child pipeline reads its copies exactly like the sequential path.
    // The vitest triage state rides along by value: the child's fix feed
    // (queueFixFeedForFile) re-derives the SAME routing the parent decided.
    const childVitest = [...input.queueFixVitest];
    ppPrep.set(ctx, "prep", input.prep);
    ppVerify.set(ctx, "verify", {
      iteration: input.round,
      fixQueue: [],
      tscTotal: input.queueFixErrors.length,
      vitestTotal: childVitest.length,
      vitestNote: "child flow (errors by value)",
      lastRunAt: new Date().toISOString(),
      errors: [...input.queueFixErrors].slice(0, TSC_ERRORS_PER_FILE_CAP).map((e) => ({ ...e })),
      vitestState: {
        kind: "vitest-queue",
        iteration: input.round,
        total: childVitest.length,
        failures: childVitest.map((c) => c.record),
        classified: childVitest,
      },
      // By-value feed (not a run record): no ran/not-run claim here.
      vitestRun: null,
    });
    const pool = new WorktreePool(
      input.repoRoot,
      input.worktreeRoot,
      bindLeaseStore(ctx, ppLease),
      LEASE_SLOT_CAP,
    );
    // The fix feed travels through the child's pp-verify seeded above (read by
    // queueFixFeedForFile), so the FileRoundInput carries no error copies.
    const childInput = (lease: { worktreePath: string; branch: string }): FileRoundInput => ({
      repoRoot: input.repoRoot,
      worktreeRoot: input.worktreeRoot,
      integrationWorktreePath: input.integrationWorktreePath,
      sourceRoot: input.sourceRoot,
      epoch: input.epoch,
      file: input.file,
      round: input.round,
      worktreePath: lease.worktreePath,
      branch: lease.branch,
      childFlow: true,
    });
    const existing = pool.store().get(input.file);
    if (existing !== undefined && !pool.isStale(existing, input.epoch)) {
      return { output: childInput(existing), tokens: null };
    }
    const acquired = await pool.acquire(input.file, input.epoch, `pp-child-${input.epoch}`);
    if (!acquired.acquired) {
      // The child's store holds no sibling leases, so the pool cap cannot
      // trip here; a refusal means this file's own lease is already held in
      // this store (concurrent re-acquire): retryable.
      throw new Error(`child lease failed for ${input.file}: ${acquired.reason}`);
    }
    return { output: childInput(acquired.lease), tokens: null };
  },
  route: (_ctx, _input, fri) => goTo(FenceStep, fri),
});

/** Child receipt: release the lease, hand the round's git facts to the parent. */
export interface ChildFileResult {
  file: string;
  round: number;
  commitSha: string | null;
  treeHash: string | null;
}

const ChildReleaseStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<
  FileRoundInput,
  ChildFileResult
>({
  stepType: "PpChildRelease",
  stepId: "pp-child-release",
  role: "record",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: { executeLoadAttributeMaps: [ppLease, ppMarker] },
  inner: async (ctx, fri) => {
    const pool = new WorktreePool(
      fri.repoRoot,
      fri.worktreeRoot,
      bindLeaseStore(ctx, ppLease),
      LEASE_SLOT_CAP,
    );
    await pool.release(fri.file);
    const marker = ppMarker.get(ctx, markerKeyOf(fri.file, fri.round));
    return {
      output: {
        file: fri.file,
        round: fri.round,
        commitSha: marker?.sha ?? null,
        treeHash: marker?.content_hash ?? null,
      },
      tokens: null,
    };
  },
  // gracefulComplete(output) — the child's terminal result.
});

/** Registration helper for the per-file child flow (registered alongside the parent). */
export class PortFileFlow implements Flow<PortFileInput> {
  readonly childLease = new ChildLeaseStep();
  readonly fence = new FenceStep();
  readonly implementStart = new ImplementStart();
  readonly implement = new ImplementStep();
  readonly queueFixStart = new QueueFixStart();
  readonly queueFix = new QueueFixStep();
  readonly captureDiff = new CaptureDiffStep();
  readonly reviewAStart = new ReviewAStart();
  readonly reviewA = new ReviewAStep();
  readonly reviewBStart = new ReviewBStart();
  readonly reviewB = new ReviewBStep();
  readonly verdictCheck = new VerdictCheckStep();
  readonly prioritize = new PrioritizeStep();
  readonly fixerStart = new FixerStart();
  readonly fixer = new FixerStep();
  readonly commit = new CommitStep();
  readonly release = new ChildReleaseStep();

  getFlowType(): string {
    return "port.File";
  }

  getSteps() {
    return StepList.startStep(this.childLease).otherSteps(
      this.fence,
      this.implementStart,
      this.implement,
      this.queueFixStart,
      this.queueFix,
      this.captureDiff,
      this.reviewAStart,
      this.reviewA,
      this.reviewBStart,
      this.reviewB,
      this.verdictCheck,
      this.prioritize,
      this.fixerStart,
      this.fixer,
      this.commit,
      this.release,
    );
  }

  getPersistenceSchema() {
    return portPersistenceSchema();
  }
}

/** The singleton the WaveJoin SubFlows target (must be worker-registered). */
export const PortFileFlowInstance = new PortFileFlow();// ---------------------------------------------------------------------------
// Flow registration
// ---------------------------------------------------------------------------

export class PortProjectFlow implements Flow<PortRunInput> {
  readonly prep = new PrepStep();
  readonly symbolStart = new SymbolStart();
  readonly symbolTable = new SymbolTableStep();
  readonly prepStart = new PrepStart();
  readonly prepGenerate = new PrepGenerateStep();
  readonly prepDiffCapture = new PrepDiffCaptureStep();
  readonly prepReviewAStart = new PrepReviewAStart();
  readonly prepReviewA = new PrepReviewAStep();
  readonly prepReviewBStart = new PrepReviewBStart();
  readonly prepReviewB = new PrepReviewBStep();
  readonly prepVerdictCheck = new PrepVerdictCheckStep();
  readonly prepLoopDecision = new PrepLoopDecisionStep();
  readonly prepReviseStart = new PrepReviseStart();
  readonly prepRevise = new PrepReviseStep();
  readonly prepFinalize = new PrepFinalizeStep();
  readonly dispatch = new DispatchStep();
  readonly lease = new LeaseStep();
  readonly fence = new FenceStep();
  readonly implementStart = new ImplementStart();
  readonly implement = new ImplementStep();
  readonly captureDiff = new CaptureDiffStep();
  readonly reviewAStart = new ReviewAStart();
  readonly reviewA = new ReviewAStep();
  readonly reviewBStart = new ReviewBStart();
  readonly reviewB = new ReviewBStep();
  readonly verdictCheck = new VerdictCheckStep();
  readonly prioritize = new PrioritizeStep();
  readonly fixerStart = new FixerStart();
  readonly fixer = new FixerStep();
  readonly commit = new CommitStep();
  readonly integrate = new IntegrateStep();
  readonly bootstrap = new BootstrapStep();
  readonly release = new ReleaseStep();
  readonly queueVerify = new QueueVerifyStep();
  readonly queueFixStart = new QueueFixStart();
  readonly queueFix = new QueueFixStep();
  readonly waveDispatch = new WaveDispatchStep();
  readonly waveJoin = new WaveJoinStep();
  readonly final = new FinalStep();

  getFlowType(): string {
    return "port.Project";
  }

  getSteps() {
    return StepList.startStep(this.prep).otherSteps(
      this.symbolStart,
      this.symbolTable,
      this.prepStart,
      this.prepGenerate,
      this.prepDiffCapture,
      this.prepReviewAStart,
      this.prepReviewA,
      this.prepReviewBStart,
      this.prepReviewB,
      this.prepVerdictCheck,
      this.prepLoopDecision,
      this.prepReviseStart,
      this.prepRevise,
      this.prepFinalize,
      this.dispatch,
      this.lease,
      this.fence,
      this.implementStart,
      this.implement,
      this.captureDiff,
      this.reviewAStart,
      this.reviewA,
      this.reviewBStart,
      this.reviewB,
      this.verdictCheck,
      this.prioritize,
      this.fixerStart,
      this.fixer,
      this.commit,
      this.integrate,
      this.bootstrap,
      this.release,
      this.queueVerify,
      this.queueFixStart,
      this.queueFix,
      this.waveDispatch,
      this.waveJoin,
      this.final,
    );
  }

  getPersistenceSchema() {
    // US-002 telemetry stream: dex's Registry allows ONE flow type to own a
    // given Stream instance. port.Project owns `envelopeStream` here; the
    // worker's runner-side publisher (Client.writeStream) uses it for every
    // mirrored envelope event (child flows included — flowId is the
    // per-instance key; open question for US-007 consumers, recorded in
    // flows/steps/envelope.ts).
    return { ...portPersistenceSchema(), streams: [envelopeStream] };
  }
}

export type { Context, StepDecision };
