/**
 * Toolkit-owned git operations: worktree leasing (epoch + base SHA), the
 * sole-committer operation-ID commit, the integration merge, and the
 * commit-preserving reconcile table.
 *
 * Phase 0 owns these minimal implementations; they are retained as production
 * seams and as the substrate for the upgrade regression kill-tests.
 *
 * Invariants (plan §Commit ownership and integration):
 * - Agents hold NO git access; every git operation flows through this module,
 *   invoked only from durable toolkit steps.
 * - Commit identity is the stable operation ID `file#round`; the content hash
 *   is recorded as evidence, never as the dedup key.
 * - Keyed-commit lookup scans ALL branches (shared object store).
 * - Recovery preserves committed work unconditionally: reset-to-commit, never
 *   past a keyed commit.
 */

import { git, type GitRunner } from "./exec.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Stable operation ID for a commit: `file#round`. Identity, not content. */
export type OperationId = string;

export function operationId(file: string, round: number): OperationId {
  return `${file}#${round}`;
}

/** Disposition of a completed file-round, recorded in the durable marker. */
export type CommitDisposition = `committed:${OperationId}` | "no-op-empty-diff";

/**
 * Completion marker payload — a dex attribute (source of truth). The
 * disposition disambiguates reconcile rows by data, not by reachability.
 */
export interface CompletionMarker {
  round: number;
  disposition: CommitDisposition;
  /** SHA-256-style evidence hash of the committed tree (`<sha>^{tree}`). */
  content_hash: string;
}

export function isCommittedDisposition(
  marker: CompletionMarker,
): marker is CompletionMarker & { disposition: `committed:${OperationId}` } {
  return marker.disposition.startsWith("committed:");
}

/** A commit found by operation-ID scan across all branches. */
export interface KeyedCommit {
  opId: OperationId;
  sha: string;
  /** Content hash trailer if recorded; evidence only. */
  contentHash: string | null;
  branch: string;
}

export interface WorktreeState {
  clean: boolean;
  /** Whether the keyed commit's object is readable (`git cat-file -e`). */
  commitObjectReadable: boolean;
}

export type ReconcileAction =
  | { kind: "skipped"; reason: string; backfillMarker?: CompletionMarker | undefined }
  | { kind: "redone"; resetTo: "lease-base"; reason: string }
  | { kind: "poisoned"; reason: string };

// ---------------------------------------------------------------------------
// reconcile(file, round) — pure decision table (plan §State ownership)
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  marker: CompletionMarker | undefined;
  keyed: KeyedCommit | undefined;
  worktree: WorktreeState;
}

/**
 * Pure function over (marker, keyed commit by op-ID, worktree state).
 * `redone` applies only where durable records agree no completed round exists.
 */
export function reconcile(input: ReconcileInput): ReconcileAction {
  const { marker, keyed, worktree } = input;

  if (marker !== undefined && isCommittedDisposition(marker)) {
    if (keyed !== undefined) {
      if (!worktree.commitObjectReadable) {
        return {
          kind: "poisoned",
          reason: `keyed commit object for ${keyed.opId} unreadable`,
        };
      }
      if (worktree.clean) {
        return { kind: "skipped", reason: "committed round; clean worktree" };
      }
      return {
        kind: "skipped",
        reason: "committed round; worktree restored from keyed commit",
      };
    }
    // Marker says committed but the commit is unfindable across ALL branches.
    return {
      kind: "poisoned",
      reason: `provenance failure: marker committed (${marker.disposition}) but no keyed commit found on any branch`,
    };
  }

  if (marker !== undefined && marker.disposition === "no-op-empty-diff") {
    if (keyed !== undefined) {
      return {
        kind: "poisoned",
        reason: `marker says no-op but keyed commit ${keyed.opId} exists; disposition mismatch`,
      };
    }
    // Legitimate empty-diff round. Caller must assert completed-file content
    // exists in the committed integrated output (a no-op presupposes it).
    return {
      kind: "skipped",
      reason: "no-op empty-diff round; caller asserts prior committed content in integrated output",
    };
  }

  if (keyed !== undefined) {
    if (!worktree.commitObjectReadable) {
      return {
        kind: "poisoned",
        reason: `keyed commit object for ${keyed.opId} unreadable`,
      };
    }
    const backfillMarker: CompletionMarker = {
      round: -1,
      disposition: `committed:${keyed.opId}`,
      content_hash: keyed.contentHash ?? keyed.sha,
    };
    if (worktree.clean) {
      return {
        kind: "skipped",
        reason: "backfill marker from commit key; clean worktree",
        backfillMarker,
      };
    }
    return {
      kind: "skipped",
      reason: "reset to keyed commit; backfill marker",
      backfillMarker,
    };
  }

  if (worktree.clean) {
    return { kind: "redone", resetTo: "lease-base", reason: "no records; clean worktree" };
  }
  return { kind: "redone", resetTo: "lease-base", reason: "no records; reset dirty worktree to lease-base" };
}

// ---------------------------------------------------------------------------
// Durable lease records (epoch + base SHA)
// ---------------------------------------------------------------------------

export interface LeaseRecord {
  file: string;
  worktreePath: string;
  /** Lease branch name: `lease/<file>/<epoch>`. */
  branch: string;
  epoch: number;
  /** SHA the lease branch was created from (used only when no keyed commit exists). */
  baseSha: string;
  /** Identity of the execution holding the lease (dex run ID). */
  holderExecutionId: string;
  acquiredAtUtc: string;
}

/**
 * Persistence backend for lease records. In production flows this is backed by
 * dex attributes (source of truth); tests use an in-memory store.
 */
export interface LeaseStore {
  get(file: string): LeaseRecord | undefined;
  put(record: LeaseRecord): void;
  remove(file: string): void;
  list(): readonly LeaseRecord[];
}

export class InMemoryLeaseStore implements LeaseStore {
  readonly #byFile = new Map<string, LeaseRecord>();
  get(file: string): LeaseRecord | undefined {
    return this.#byFile.get(file);
  }
  put(record: LeaseRecord): void {
    this.#byFile.set(record.file, record);
  }
  remove(file: string): void {
    this.#byFile.delete(file);
  }
  list(): readonly LeaseRecord[] {
    return [...this.#byFile.values()];
  }
}

export type AcquireResult =
  | { acquired: true; lease: LeaseRecord }
  | { acquired: false; reason: string };

/**
 * Worktree pool — the SINGLE enforcement point for the 2-worktree cap and
 * stale-lease reclamation (epoch-tagged).
 */
export class WorktreePool {
  readonly #repoRoot: string;
  readonly #worktreeRoot: string;
  readonly #maxLeases: number;
  readonly #store: LeaseStore;

  constructor(
    repoRoot: string,
    worktreeRoot: string,
    store: LeaseStore,
    maxLeases = 2,
  ) {
    this.#repoRoot = repoRoot;
    this.#worktreeRoot = worktreeRoot;
    this.#store = store;
    this.#maxLeases = maxLeases;
  }

  /** Active (non-stale) lease count for the current epoch. */
  activeCount(epoch: number): number {
    return this.#store.list().filter((l) => l.epoch === epoch).length;
  }

  /** A lease is stale when tagged with an older epoch (recovery bumped it). */
  isStale(lease: LeaseRecord, epoch: number): boolean {
    return lease.epoch !== epoch;
  }

  async acquire(
    file: string,
    epoch: number,
    holderExecutionId: string,
    now: () => Date = () => new Date(),
  ): Promise<AcquireResult> {
    const existing = this.#store.get(file);
    if (existing !== undefined) {
      if (this.isStale(existing, epoch)) {
        // Stale leases are reclaimable at this single point.
        await this.release(file);
      } else {
        return {
          acquired: false,
          reason: `lease for ${file} already held by ${existing.holderExecutionId} at epoch ${existing.epoch}`,
        };
      }
    }
    if (this.activeCount(epoch) >= this.#maxLeases) {
      return {
        acquired: false,
        reason: `worktree cap (${this.#maxLeases}) reached for epoch ${epoch}`,
      };
    }

    const runner = git(this.#repoRoot);
    const safeFile = sanitizePathSegment(file);
    const branch = `lease/${safeFile}/${epoch}`;
    const worktreePath = `${this.#worktreeRoot}/${safeFile}-${epoch}`;

    const headSha = (await runner.run(["rev-parse", "HEAD"])).trim();
    // Create the lease branch at HEAD if absent, then add the worktree.
    const branchExists = (
      await runner.tryRun(["rev-parse", "--verify", `refs/heads/${branch}`])
    ).ok;
    if (!branchExists) {
      await runner.run(["branch", branch, headSha]);
    }
    const wtExists = (
      await runner.tryRun(["-C", worktreePath, "rev-parse", "--is-inside-work-tree"])
    ).ok;
    if (!wtExists) {
      await runner.run(["worktree", "add", worktreePath, branch]);
    }

    const lease: LeaseRecord = {
      file,
      worktreePath,
      branch,
      epoch,
      baseSha: headSha,
      holderExecutionId,
      acquiredAtUtc: now().toISOString(),
    };
    this.#store.put(lease);
    return { acquired: true, lease };
  }

  async release(file: string): Promise<void> {
    const lease = this.#store.get(file);
    if (lease === undefined) return;
    const runner = git(this.#repoRoot);
    await runner.tryRun(["worktree", "remove", "--force", lease.worktreePath]);
    // The branch is kept: keyed-commit lookup scans all branches (shared
    // object store), and quarantined-lease commits must remain reachable.
    this.#store.remove(file);
  }

  store(): LeaseStore {
    return this.#store;
  }
}

// ---------------------------------------------------------------------------
// Sole-committer: keyed commit + lookup + integration
// ---------------------------------------------------------------------------

export const OP_ID_TRAILER = "Operation-ID:";
export const CONTENT_HASH_TRAILER = "Content-Hash:";

/**
 * Stages and commits all changes in the worktree on its lease branch.
 * Returns a no-op disposition when the diff is empty. The CALLER (the durable
 * commit step) is responsible for op-ID dedup via {@link findCommitByOpId}
 * BEFORE calling this, and for writing the completion marker after.
 */
export async function commitLeaseChanges(
  worktreePath: string,
  opId: OperationId,
  message: string,
): Promise<{ disposition: CommitDisposition; sha: string | null; contentHash: string }> {
  const runner = git(worktreePath);
  await runner.run(["add", "-A"]);
  const empty = (await runner.tryRun(["diff", "--cached", "--quiet"])).ok;
  if (empty) {
    const headTree = (await runner.tryRun(["rev-parse", "HEAD^{tree}"])).stdout.trim();
    return {
      disposition: "no-op-empty-diff",
      sha: null,
      contentHash: headTree,
    };
  }
  // Content-hash is EVIDENCE recorded in the commit body (plan: op-ID is the
  // identity; the hash is recoverable by the branch-scan lookup).
  const treeHash = (await runner.run(["write-tree"])).trim();
  await runner.run([
    "commit",
    "-m",
    message,
    "-m",
    `${OP_ID_TRAILER} ${opId}`,
    "-m",
    `${CONTENT_HASH_TRAILER} ${treeHash}`,
  ]);
  const sha = (await runner.run(["rev-parse", "HEAD"])).trim();
  return { disposition: `committed:${opId}`, sha, contentHash: treeHash };
}

/**
 * Scans ALL branches (shared object store) for a commit carrying the
 * operation-ID trailer, so a redo on a spare or reclaimed worktree still
 * finds a commit landed elsewhere.
 */
export async function findCommitByOpId(
  repoRoot: string,
  opId: OperationId,
): Promise<KeyedCommit | undefined> {
  const runner = git(repoRoot);
  const out = await runner.run(["log", "--all", "--format=%H%x1f%D%x1f%b%x1e"]);
  const records = out.split("\x1e").map((r) => r.trim()).filter(Boolean);
  for (const record of records) {
    const fields = record.split("\x1f").map((p) => p.trim());
    const sha = fields[0] ?? "";
    const refs = fields[1] ?? "";
    const body = fields[2] ?? "";
    const trailerLine = `${OP_ID_TRAILER} ${opId}`;
    const bodyLines = body.split("\n").map((l) => l.trim());
    if (bodyLines.includes(trailerLine)) {
      const hashLine = bodyLines.find((l) => l.startsWith(`${CONTENT_HASH_TRAILER} `));
      const branch =
        refs
          .split(",")
          .map((r) => r.trim().replace(/^->\s*/, ""))
          .find((r) => r.length > 0 && r !== "HEAD" && !r.startsWith("tag: ")) ?? sha;
      return {
        opId,
        sha,
        contentHash: hashLine ? hashLine.slice(CONTENT_HASH_TRAILER.length + 1) : null,
        branch,
      };
    }
  }
  return undefined;
}

/** Reads the worktree status (clean/dirty) without touching the index lock. */
export async function isWorktreeClean(worktreePath: string): Promise<boolean> {
  const runner = git(worktreePath);
  const out = await runner.run(["status", "--porcelain"]);
  return out.trim().length === 0;
}

export async function commitObjectReadable(
  repoRoot: string,
  sha: string,
): Promise<boolean> {
  const runner = git(repoRoot);
  return (await runner.tryRun(["cat-file", "-e", `${sha}^{commit}`])).ok;
}

/**
 * Applies the reconcile decision with real git. Reset semantics preserve
 * committed work: when a keyed commit exists the worktree resets TO it; the
 * lease base SHA is used only when no keyed commit exists.
 */
export async function applyReconcile(
  lease: LeaseRecord,
  action: ReconcileAction,
  keyed: KeyedCommit | undefined,
): Promise<{ restoredFrom: string | null }> {
  if (action.kind === "poisoned") return { restoredFrom: null };
  const runner = git(lease.worktreePath);
  if (action.kind === "redone") {
    await runner.run(["reset", "--hard", lease.baseSha]);
    await runner.run(["clean", "-fd"]);
    return { restoredFrom: lease.baseSha };
  }
  // skipped with a keyed commit and a dirty worktree: reset to the keyed commit.
  if (keyed !== undefined && !(await isWorktreeClean(lease.worktreePath))) {
    await runner.run(["reset", "--hard", keyed.sha]);
    await runner.run(["clean", "-fd"]);
    return { restoredFrom: keyed.sha };
  }
  return { restoredFrom: null };
}

export interface IntegrationResult {
  alreadyIntegrated: boolean;
  fastForward: boolean;
  sha: string;
}

/**
 * Durable integration step body: merges the lease branch into the single
 * `integration` branch — the one output project. One active file per lease
 * keeps merges conflict-free by construction (disjoint paths). Uses a
 * dedicated worktree so the main checkout is never disturbed.
 */
export async function mergeLeaseIntoIntegration(
  repoRoot: string,
  integrationWorktreePath: string,
  leaseBranch: string,
  integrationBranch = "integration",
): Promise<IntegrationResult> {
  const root = git(repoRoot);
  const tip = (await git(repoRoot).run(["rev-parse", leaseBranch])).trim();

  // Ensure the integration branch exists (created from current default HEAD).
  const hasIntegration = (
    await root.tryRun(["rev-parse", "--verify", `refs/heads/${integrationBranch}`])
  ).ok;
  if (!hasIntegration) {
    const head = (await root.run(["rev-parse", "HEAD"])).trim();
    await root.run(["branch", integrationBranch, head]);
  }

  // Ensure the integration worktree exists.
  const hasWt = (
    await root.tryRun(["-C", integrationWorktreePath, "rev-parse", "--is-inside-work-tree"])
  ).ok;
  if (!hasWt) {
    await root.run(["worktree", "add", integrationWorktreePath, integrationBranch]);
  }

  const integ = git(integrationWorktreePath);
  // Idempotency: if the lease tip is already an ancestor, nothing to do.
  const ancestor = await integ.tryRun(["merge-base", "--is-ancestor", tip, "HEAD"]);
  if (ancestor.ok) {
    const sha = (await integ.run(["rev-parse", "HEAD"])).trim();
    return { alreadyIntegrated: true, fastForward: false, sha };
  }

  // Fast-forward when possible; otherwise a real merge (same-path re-rounds).
  const headBefore = (await integ.run(["rev-parse", "HEAD"])).trim();
  const ff = await integ.tryRun(["merge", "--ff-only", leaseBranch]);
  if (ff.ok) {
    const sha = (await integ.run(["rev-parse", "HEAD"])).trim();
    return { alreadyIntegrated: false, fastForward: true, sha };
  }
  await integ.run(["merge", "--no-ff", "--no-edit", leaseBranch]);
  const sha = (await integ.run(["rev-parse", "HEAD"])).trim();
  if (sha === headBefore) {
    throw new Error(`integration merge produced no change for ${leaseBranch}`);
  }
  return { alreadyIntegrated: false, fastForward: false, sha };
}

/** True when the integrated output contains a path with non-empty content. */
export async function integratedContentExists(
  integrationWorktreePath: string,
  path: string,
): Promise<boolean> {
  const runner = git(integrationWorktreePath);
  const result = await runner.tryRun(["cat-file", "-e", `HEAD:${path}`]);
  return result.ok;
}

function sanitizePathSegment(input: string): string {
  const safe = input.replace(/[^a-zA-Z0-9._-]+/g, "__");
  return safe.length > 0 && safe.length <= 96
    ? safe
    : `seg-${hashOf(input)}`;
}

function hashOf(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

export type { GitRunner };
