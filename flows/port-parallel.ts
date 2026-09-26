/**
 * Parallel file dispatch (v1.1 prep — NOT the default; live use pending lead
 * confirmation). dex-native shape: the parent flow's WAVE step declares
 * `waitFor: Wait.allOf(...pending files.map(f => SubFlow.run(PortFileFlow, …)))`
 * so both worktree slots fill concurrently, and `execute` runs only after every
 * child flow is terminal (dex SubFlow reuse policy RESTART_IF_PREVIOUS_EXITS_
 * ABNORMALLY makes the join kill-safe: a dead child restarts on resume).
 *
 * Durability invariants preserved:
 * - caps: children acquire leases through the SAME durable pp-lease store
 *   (WorktreePool cap 2, single enforcement point). A child whose slot is taken
 *   fails its lease attempt retryably and dex retries with backoff — the cap is
 *   never widened.
 * - evidence stream: children are real flows with their OWN attribute stores;
 *   the parent publishes every child flow id under `pp-wave/children` so the
 *   metrics driver and dashboard can fan out over parent+children. Envelope
 *   anchoring runs per flow (each child's envelopes anchor in its own history).
 * - sole committer: children end at Release (their keyed commits are durable in
 *   git); the parent performs integration merges SERIALLY after the join, so
 *   the shared integration worktree never races.
 *
 * The sequential path (flows/port-project.ts) is untouched and remains the
 * default until the parallel path is confirmed for evidence runs.
 */

import { StepList, goTo } from "@superdurable/dex";
import type { Flow } from "@superdurable/dex";
import { Wait, SubFlow } from "@superdurable/dex";

// ---------------------------------------------------------------------------
// Pure wave planning (unit-tested)
// ---------------------------------------------------------------------------

/**
 * Chunks pending files into waves of at most `slots` concurrent children.
 * `slots` comes from the WorktreePool cap (2 in v1) — never wider.
 */
export function planWaves(files: readonly string[], slots: number): string[][] {
  const width = Number.isInteger(slots) && slots > 0 ? slots : 1;
  const waves: string[][] = [];
  for (let i = 0; i < files.length; i += width) {
    waves.push(files.slice(i, i + width).map((f) => f));
  }
  return waves;
}

/** Deterministic child flow id (dedup-friendly across retries of the parent). */
export function fileFlowId(parentFlowId: string, file: string, round: number): string {
  const safe = file.replace(/\//g, "__").replace(/[^A-Za-z0-9_.-]/g, "_");
  return `${parentFlowId}--file-${safe}-r${round}`;
}

/** Start input of one per-file child flow (PortFileFlow). */
export interface PortFileInput {
  repoRoot: string;
  worktreeRoot: string;
  integrationWorktreePath: string;
  sourceRoot: string;
  /** Fencing epoch (inherited from the parent run). */
  epoch: number;
  file: string;
  round: number;
  /** Per-file round cap, inherited from the parent's pp-config. */
  maxRounds: number;
  /** Round-1 files implement; fix rounds (≥2) enter the queue-fix loop. */
  queueFixErrors?: ReadonlyArray<{ code: string; message: string; line: number }>;
}

/** Parent-side record of one dispatched child (published to pp-wave/children). */
export interface WaveChild {
  file: string;
  round: number;
  flowId: string;
}

// ---------------------------------------------------------------------------
// Parent wave-step building blocks
// ---------------------------------------------------------------------------

/** Parent-side per-wave base fields (everything except the per-file key). */
export interface WaveBase extends Omit<PortFileInput, "file" | "round" | "queueFixErrors"> {
  /** Parent QueueVerify output: grouped errors per file (fix waves). */
  queueFixErrorsFor?: (file: string) => ReadonlyArray<{ code: string; message: string; line: number }>;
}

/**
 * Builds the `waitFor` handler body for one wave: every file in the wave is a
 * durable SubFlow condition; `Wait.allOf` releases `execute` only when ALL
 * children reach a terminal state. Condition IDs are wave-stable.
 */
export function waveWait(
  files: readonly string[],
  round: number,
  base: WaveBase,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fileFlow: Flow<any>,
): ReturnType<typeof Wait.allOf> {
  const conditions = files.map((file, i) => {
    const errors = base.queueFixErrorsFor?.(file) ?? [];
    return SubFlow.run(
      fileFlow,
      {
        repoRoot: base.repoRoot,
        worktreeRoot: base.worktreeRoot,
        integrationWorktreePath: base.integrationWorktreePath,
        sourceRoot: base.sourceRoot,
        epoch: base.epoch,
        file,
        round,
        maxRounds: base.maxRounds,
        ...(errors.length > 0 ? { queueFixErrors: errors } : {}),
      } satisfies PortFileInput,
      { conditionId: `wave-${round}-${i}-${file.replace(/[^A-Za-z0-9]/g, "_")}` },
    );
  });
  return Wait.allOf(...conditions);
}

/** Slot count for wave sizing: the durable WorktreePool cap. */
export const PARALLEL_SLOTS = 2;

// ---------------------------------------------------------------------------
// PortFileFlow — per-file child flow (skeleton)
//
// The per-file step classes live in flows/port-project.ts (module-private, so
// their envelope/fence/queue semantics stay single-sourced). Extraction into
// this flow is a mechanical `export` + re-registration job performed at the
// point the lead confirms parallel evidence runs; the child entry derives
// FileRoundInput directly (its own WorktreePool lease through the SHARED
// durable pp-lease store — cap enforced), then routes into the exported
// FenceStep pipeline unchanged. Queue/fix-round children accept their grouped
// errors via PortFileInput.queueFixErrors (parent QueueVerify output).
// ---------------------------------------------------------------------------

/** Minimal child entry: derive the file-round without reading the parent queue. */
export interface ChildLeaseOutcome {
  kind: "lease" | "exhausted";
}

export function childFlowType(): string {
  return "port.File";
}

/** Registration helper (unused until activation; keeps the shape typechecked). */
export function portFileStepList(childEntry: unknown, fence: unknown): unknown {
  return StepList.startStep(childEntry as never).otherSteps(fence as never);
}

/** Route helper shared by the child entry: round ≥ 2 → queue-fix, else implement. */
export function childEntryRoute(fri: { round: number }): "queue-fix" | "implement" {
  return fri.round >= 2 ? "queue-fix" : "implement";
}

// Re-exported so the future activation compiles against one surface.
export { goTo };
