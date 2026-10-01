/**
 * Durable contracts of the port flows: the run/round input shapes, the state
 * records persisted as dex attributes, and the `pp-*` AttributeMap instances
 * (plus the persistence schema both flows return). Pure declarations — no
 * step, no goTo(), no I/O — so every other module under flows/port can import
 * it without creating a cycle.
 */

import { AttributeMap, jsonCodec } from "@superdurable/dex";

import { persistenceAttributes } from "../steps/envelope.js";
import type { CompletionMarker, LeaseRecord } from "../../src/git/worktree.js";
import type { VerdictRecord as AgentVerdictRecord } from "../../harness/agents/verdict-schema.js";
import type { PhpSymbol } from "../../src/typesafe/symbol-types.js";
import type { TscRunAccounting } from "../../src/queues/tsc-queue.js";
import type {
  ClassifiedVitestFailure,
  VitestQueueState,
  VitestRunState,
} from "../../src/queues/vitest-queue.js";
import type {
  DiffDocument,
  Finding as MetricsFinding,
  VerdictRecord as MetricsVerdictRecord,
  VerdictTombstone,
  VitestRunAccounting,
} from "../../src/metrics/types.js";

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

/** Which classifier produced a vitest queue's triage, and why live Jev was abandoned. */
export interface VitestTriageRecord {
  checker: JudgmentChecker;
  fallbackReason: string | null;
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

/** Accumulated LIVE Jev usage (evidence stream; naive path adds nothing). */
export const ppJevUsage = new AttributeMap<Array<{ stepId: string; tokens: number; atUtc: string }>>(
  "pp-jev-usage",
  jsonCodec<Array<{ stepId: string; tokens: number; atUtc: string }>>(),
);

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

/** Input of one per-file child flow (PortFileFlow). */
export interface PortFileInput {
  repoRoot: string;
  worktreeRoot: string;
  integrationWorktreePath: string;
  sourceRoot: string;
  epoch: number;
  file: string;
  round: number;
  // No round cap rides along: the parent enforces it (deriveNext, the wave
  // entries) before it dispatches a child, and nothing in the child reads one.
  /** The parent's reviewed prep artifact (children own a copy in their store). */
  prep: PrepArtifact;
  /** Grouped queue errors for fix rounds (round ≥ 2); empty for round 1. */
  queueFixErrors: ReadonlyArray<QueueVerifyError>;
  /** Vitest failures triaged to this file (fix rounds; by-value records). */
  queueFixVitest: ReadonlyArray<ClassifiedVitestFailure>;
}

export type WaveMode = "port" | "fix";
export interface WaveDispatchOutput extends PortRunInput {
  mode: WaveMode;
}

/** Child receipt: release the lease, hand the round's git facts to the parent. */
export interface ChildFileResult {
  file: string;
  round: number;
  commitSha: string | null;
  treeHash: string | null;
}
