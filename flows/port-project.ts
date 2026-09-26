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
} from "@superdurable/dex";
import type { Context, Flow, StepDecision } from "@superdurable/dex";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  envelopeStartMarker,
  envelopeStepClass,
  persistenceAttributes,
  type EnvelopeOutcome,
  type EnvelopeStepClass,
} from "./steps/envelope.js";
import {
  fenceLabel,
  sessionFenceMap,
  tokenTotal,
  type AgentSessionClient,
} from "../src/harness/opencode.js";
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
import type { AgentDefinition } from "../harness/agents/types.js";
import type {
  VerdictRecord as AgentVerdictRecord,
} from "../harness/agents/verdict-schema.js";
import type {
  DiffDocument,
  Finding as MetricsFinding,
  VerdictRecord as MetricsVerdictRecord,
} from "../src/metrics/types.js";
import { naiveCitationCheck } from "../src/typesafe/verdict-check.js";
import { naivePrioritize } from "../src/typesafe/prioritize.js";
import {
  composeFixerTurn,
  composeImplementerTurn,
  composeReviewerTurn,
  extractCodeFence,
  extractJsonObject,
  mapVerdictToMetrics,
  parseUnifiedDiff,
  renderDiffForReview,
  reviewerAgentOverride,
  toolOverridesAllOff,
  toolPolicyBlock,
  DIFF_HEADER_LINES,
} from "../src/harness/runtime.js";

const execFileP = promisify(execFile);

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
}

export interface PortRunConfig {
  maxRounds: number;
}

export interface PrepArtifact {
  raw: string;
  sourceMap: Record<string, { outPath: string; notes: string }>;
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

export interface KeptFindings {
  findings: MetricsFinding[];
  dropped: Array<{ finding_id: string; reviewer: string; reason: string }>;
}

export interface OutPathRef {
  outPath: string;
}

/** Terminal flow output (gracefulComplete payload). */
export interface PortRunResult {
  completed: PortQueueState["done"];
  blocked: PortQueueState["blocked"];
}

// ---------------------------------------------------------------------------
// Durable attributes (pp-* — unique within this flow)
// ---------------------------------------------------------------------------

export const ppConfig = new AttributeMap<PortRunConfig>("pp-config", jsonCodec<PortRunConfig>());
export const ppQueue = new AttributeMap<PortQueueState>("pp-queue", jsonCodec<PortQueueState>());
export const ppPrep = new AttributeMap<PrepArtifact>("pp-prep", jsonCodec<PrepArtifact>());
export const ppLease = new AttributeMap<Record<string, LeaseRecord>>("pp-lease", jsonCodec<Record<string, LeaseRecord>>());
export const ppDiff = new AttributeMap<CapturedDiff>("pp-diff", jsonCodec<CapturedDiff>());
export const ppVerdict = new AttributeMap<ReviewTuple>("pp-verdict", jsonCodec<ReviewTuple>());
export const ppKept = new AttributeMap<KeptFindings>("pp-kept", jsonCodec<KeptFindings>());
export const ppOut = new AttributeMap<OutPathRef>("pp-out", jsonCodec<OutPathRef>());
export const ppMarker = new AttributeMap<CompletionMarker>("pp-marker", jsonCodec<CompletionMarker>());

const PP_LEASE_INSTANCE = "pool";

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
function composeAgentTurn(def: AgentDefinition, turn: string): string {
  return [def.prompt, "", toolPolicyBlock(def), "", turn].join("\n\n");
}

async function gitDiffStaged(worktreePath: string): Promise<string> {
  const { stdout } = await execFileP("git", ["add", "-A"], { cwd: worktreePath });
  void stdout;
  const res = await execFileP("git", ["diff", "--cached"], { cwd: worktreePath });
  return res.stdout;
}

async function writeOutFile(worktreePath: string, outPath: string, content: string): Promise<void> {
  const target = join(worktreePath, outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

interface AgentTurnResult {
  text: string;
  tokens: number | null;
}

async function runAgentTurn(input: {
  def: AgentDefinition;
  sessionId: string;
  turn: string;
  file: string;
  round: number;
  agent?: string;
}): Promise<AgentTurnResult> {
  const harness = requireHarness();
  // Bridge mode: ALL server-side tools disabled for every agent turn; the
  // toolkit mediates writes into the lease worktree (see toolOverridesAllOff).
  const reply = await harness.prompt(input.sessionId, composeAgentTurn(input.def, input.turn), {
    tools: toolOverridesAllOff(),
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
  });
  if (reply.aborted) {
    throw new Error(`agent session aborted (file=${input.file} round=${input.round})`);
  }
  const tokens = reply.usage === null ? null : tokenTotal(reply.usage);
  return { text: reply.text, tokens };
}

/**
 * Reviewer turn inside a durable step: fresh session → fence persisted with
 * THIS step's decision (0(g)) → prompt with the diff by value → verdict
 * extracted, validated, and mapped onto the metrics shapes. Any failure
 * throws so dex retries the whole turn on a fresh session.
 */
async function runReviewerTurn(input: {
  ctx: Context;
  reviewerId: string;
  fri: FileRoundInput;
  diff: CapturedDiff;
}): Promise<{ tuple: ReviewTuple; tokens: number | null }> {
  const harness = requireHarness();
  const label = fenceLabel(input.fri.file, input.fri.round, input.fri.epoch);
  const session = await harness.createSession(label);
  sessionFenceMap.set(input.ctx, label, {
    sessionId: session.id,
    stepId: `pp-review-${input.reviewerId}`,
    epoch: input.fri.epoch,
    label,
    persistedAtUtc: new Date().toISOString(),
  });

  const diffBlock = renderDiffForReview({
    diffText: input.diff.raw,
    file: input.fri.file,
    round: input.fri.round,
    diffId: input.diff.diffId,
  });
  const turn = composeReviewerTurn({
    reviewerId: input.reviewerId,
    reviewerLabel: REVIEWER.name,
    diffBlock: diffBlock.block,
  });
    const agent = reviewerAgentOverride();
    const result = await runAgentTurn({
      def: REVIEWER,
      sessionId: session.id,
      turn,
      file: input.fri.file,
      round: input.fri.round,
      ...(agent !== undefined ? { agent } : {}),
    });

  const parsed = extractJsonObject(result.text);
  const mapped = mapVerdictToMetrics({
    raw: parsed,
    file: input.fri.file,
    reviewer: input.reviewerId,
    round: input.fri.round,
    diffId: input.diff.diffId,
    // Re-parse from the stored raw text: ParsedDiff carries non-JSON helpers
    // (hunk resolution) and cannot live in the durable attribute itself.
    parsedDiff: parseUnifiedDiff(input.diff.raw),
    bodyLineOffset: input.diff.bodyLineOffset,
    naiveCited: (finding) =>
      naiveCitationCheck(
        emptyRecordWith(input.fri, input.reviewerId, finding),
        input.diff.doc,
      ).find((c) => c.finding_id === finding.finding_id)?.p_cited ?? 0,
  });
  if (!mapped.ok) {
    throw new Error(
      `reviewer ${input.reviewerId} verdict failed validation: ${mapped.errors.join("; ")}`,
    );
  }
  return { tuple: { agent: mapped.agentRecord, metrics: mapped.record }, tokens: result.tokens };
}

/** Single-finding metrics record scoping for the naive fallback citation. */
function emptyRecordWith(
  fri: FileRoundInput,
  reviewer: string,
  finding: MetricsFinding,
): MetricsVerdictRecord {
  return {
    file: fri.file,
    reviewer,
    round: fri.round,
    diff_id: "",
    findings: [finding],
    citation_check: [],
  };
}

// ---------------------------------------------------------------------------
// The flow steps
// ---------------------------------------------------------------------------

const MODEL_STEP_OPTIONS = { executeRetry: { maximumAttempts: 3 } } as const;

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
    ppPrep.set(ctx, "prep", { raw, sourceMap });
    ppConfig.set(ctx, "config", { maxRounds: input.maxRounds });
    ppQueue.set(ctx, "queue", {
      pending: [...input.files],
      current: null,
      done: [],
      blocked: [],
    });
    return { output: input, tokens: null };
  },
  route: (_ctx, _input, out) => goTo(DispatchStep, out),
});

const DispatchStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<
  PortRunInput,
  PortRunInput & { done: boolean }
>({
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
      return { output: { ...input, done: false }, tokens: null, outcome: "skipped" };
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
  route: (_ctx, _input, out) => (out.done ? goTo(FinalStep, out) : goTo(LeaseStep, out)),
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
      2,
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
  route: (_ctx, _input, fri) => goTo(ImplementStart, fri),
});

// M4 (0(g)): durable PRE-start markers for model-calling steps. The
// envelope's own start event is staged with its step's decision, so a kill
// inside the step leaves no envelope; this marker's decision lands first.
const ImplementStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpImplementStart",
  targetStepId: "pp-implement",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
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

    const turn = composeImplementerTurn({
      phpFileName: fri.file,
      phpSource,
      prepExcerpt: prep.raw,
      outputPath: outPath,
    });
    const result = await runAgentTurn({
      def: IMPLEMENTER,
      sessionId: fence.sessionId,
      turn,
      file: fri.file,
      round: fri.round,
    });
    const code = extractCodeFence(result.text, ".ts");
    await writeOutFile(fri.worktreePath, outPath, code);
    ppOut.set(ctx, outKeyOf(fri.file, fri.round), { outPath });
    return { output: fri, tokens: result.tokens };
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
    const { tuple, tokens } = await runReviewerTurn({
      ctx,
      reviewerId: "reviewer-A",
      fri,
      diff,
    });
    ppVerdict.set(ctx, verdictKeyOf(fri.file, fri.round, "reviewer-A"), tuple);
    return { output: fri, tokens };
  },
  route: (_ctx, _input, fri) => goTo(ReviewBStart, fri),
});

const ReviewBStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpReviewBStart",
  targetStepId: "pp-review-b",
  role: "review",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
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
    const { tuple, tokens } = await runReviewerTurn({
      ctx,
      reviewerId: "reviewer-B",
      fri,
      diff,
    });
    ppVerdict.set(ctx, verdictKeyOf(fri.file, fri.round, "reviewer-B"), tuple);
    return { output: fri, tokens };
  },
  route: (_ctx, _input, fri) => goTo(VerdictCheckStep, fri),
});

const VerdictCheckStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput & { keptCount: number }>({
  stepType: "PpVerdictCheck",
  stepId: "pp-verdict-check",
  role: "verdict-check",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: { executeLoadAttributeMaps: [ppVerdict, ppDiff] },
  inner: async (ctx, fri) => {
    const diff = ppDiff.get(ctx, diffKeyOf(fri.file, fri.round));
    if (diff === undefined) throw new Error(`captured diff missing for ${fri.file}#${fri.round}`);
    const kept: MetricsFinding[] = [];
    const dropped: KeptFindings["dropped"] = [];
    for (const reviewerId of ["reviewer-A", "reviewer-B"] as const) {
      const key = verdictKeyOf(fri.file, fri.round, reviewerId);
      const tuple = ppVerdict.get(ctx, key);
      if (tuple === undefined) {
        throw new Error(`verdict record missing for ${key}`);
      }
      // Citation check (naive, code-only): a finding survives iff its cited
      // evidence literally appears in the reviewed diff (p_cited === 1) and
      // its disposition asks for a fix.
      for (const check of naiveCitationCheck(tuple.metrics, diff.doc)) {
        const agentFinding = tuple.agent.findings.find((f) => f.finding_id === check.finding_id);
        const metricsFinding = tuple.metrics.findings.find((f) => f.finding_id === check.finding_id);
        if (agentFinding === undefined || metricsFinding === undefined) continue;
        if (check.p_cited < 1) {
          dropped.push({
            finding_id: check.finding_id,
            reviewer: reviewerId,
            reason: `citation check failed (p_cited=${check.p_cited})`,
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
    ppKept.set(ctx, keptKeyOf(fri.file, fri.round), { findings: kept, dropped });
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
  stepOptions: { executeLoadAttributeMaps: [ppKept] },
  inner: async (ctx, fri) => {
    const kept = ppKept.get(ctx, keptKeyOf(fri.file, fri.round));
    if (kept === undefined) throw new Error(`kept findings missing for ${fri.file}#${fri.round}`);
    ppKept.set(ctx, keptKeyOf(fri.file, fri.round), {
      ...kept,
      findings: naivePrioritize(kept.findings),
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
  route: (fri) => goTo(FixerStep, fri),
});

const FixerStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpFixer",
  stepId: "pp-fixer",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: {
    ...MODEL_STEP_OPTIONS,
    executeLoadAttributeMaps: [ppKept, ppOut],
  },
  inner: async (ctx, fri) => {
    const kept = ppKept.get(ctx, keptKeyOf(fri.file, fri.round));
    if (kept === undefined) throw new Error(`kept findings missing for ${fri.file}#${fri.round}`);
    if (kept.findings.length === 0) {
      // Clean review (verdict-check kept nothing): skip the fixer entirely.
      return { output: fri, tokens: null, outcome: "skipped" as EnvelopeOutcome };
    }
    const out = ppOut.get(ctx, outKeyOf(fri.file, fri.round));
    if (out === undefined) throw new Error(`output path missing for ${fri.file}#${fri.round}`);
    const current = await readFile(join(fri.worktreePath, out.outPath), "utf8");

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

    const turn = composeFixerTurn({
      currentContent: current,
      findings: kept.findings,
      outputPath: out.outPath,
    });
    const result = await runAgentTurn({
      def: FIXER,
      sessionId: session.id,
      turn,
      file: fri.file,
      round: fri.round,
    });
    const code = extractCodeFence(result.text, ".ts");
    await writeOutFile(fri.worktreePath, out.outPath, code);
    return { output: fri, tokens: result.tokens };
  },
  route: (_ctx, _input, fri) => goTo(CommitStep, fri),
});

const CommitStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpCommit",
  stepId: "pp-commit",
  role: "commit",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
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
  route: (_ctx, _input, fri) => goTo(IntegrateStep, fri),
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
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppMarker] },
  inner: async (ctx, fri) => {
    const queue = ppQueue.get(ctx, "queue");
    if (queue.current === null) {
      throw new Error("release inconsistency: no current file-round");
    }
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
  route: (_ctx, _input, out) => goTo(DispatchStep, out),
});

const FinalStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunResult>({
  stepType: "PpFinal",
  stepId: "pp-final",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppQueue] },
  inner: async (ctx, input) => {
    const queue = ppQueue.get(ctx, "queue");
    return {
      output: { completed: queue.done, blocked: queue.blocked },
      tokens: null,
    };
  },
});

function baseInput(fri: FileRoundInput): PortRunInput {
  return {
    repoRoot: fri.repoRoot,
    worktreeRoot: fri.worktreeRoot,
    integrationWorktreePath: fri.integrationWorktreePath,
    epoch: fri.epoch,
    sourceRoot: fri.sourceRoot,
    prepPath: "",
    files: [],
    maxRounds: 1,
  };
}

// ---------------------------------------------------------------------------
// Flow registration
// ---------------------------------------------------------------------------

export class PortProjectFlow implements Flow<PortRunInput> {
  readonly prep = new PrepStep();
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
  readonly release = new ReleaseStep();
  readonly final = new FinalStep();

  getFlowType(): string {
    return "port.Project";
  }

  getSteps() {
    return StepList.startStep(this.prep).otherSteps(
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
      this.release,
      this.final,
    );
  }

  getPersistenceSchema() {
    return portPersistenceSchema();
  }
}

export type { Context, StepDecision };
