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

import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

import { GitError, git, gitPredicate, type GitRunner, type TryRunResult } from "./exec.js";

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
 * Optional evidence fields: `sha` (commit, vs `content_hash` tree), and the
 * C1 cross-branch fields recorded when dedup found the keyed commit on a
 * DIFFERENT branch than this round's lease.
 */
export interface CompletionMarker {
  round: number;
  disposition: CommitDisposition;
  /** SHA-256-style evidence hash of the committed tree (`<sha>^{tree}`). */
  content_hash: string;
  /** Commit sha (evidence; distinct from the tree hash above). */
  sha?: string | null;
  /** C1: branch the deduped keyed commit was found on. */
  keyed_branch?: string;
  /** C1: the replay's worktree content diverged from the keyed commit. */
  replay_divergent?: boolean;
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
  /** Branch the scan found the commit on (evidence; other branches may hold it). */
  branch: string;
  /** Round parsed from the opId (`file#round`); -1 when unparseable. */
  round: number;
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
      round: keyed.round,
      disposition: `committed:${keyed.opId}`,
      content_hash: keyed.contentHash ?? keyed.sha,
      sha: keyed.sha,
      keyed_branch: keyed.branch,
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
  /**
   * SHA the lease worktree starts from: the lease branch tip at acquire, after
   * an already-integrated branch was fast-forwarded to the integration tip
   * (used only when no keyed commit exists).
   */
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

    // M6: lease branches base on the INTEGRATION tip when it exists (the one
    // output project) so re-rounds of the same path fast-forward into
    // integration; only a baseless first round falls back to HEAD.
    const resolvedBase = (await refExists(runner, "refs/heads/integration")) ? "integration" : "HEAD";

    const headSha = (await runner.run(["rev-parse", resolvedBase])).trim();
    // Create the lease branch at the resolved base if absent, then add the worktree.
    const branchExists = await refExists(runner, `refs/heads/${branch}`);
    if (!branchExists) {
      await runner.run(["branch", branch, headSha]);
    }
    // `rev-parse --is-inside-work-tree` is true for ANY directory under the main
    // checkout (worktreeRoot is `<repo>/.worktrees`), so a leftover plain
    // directory used to become the lease and commits landed on the main branch.
    // Only a directory that IS a worktree root is reused; anything else goes to
    // `worktree add` (an empty directory is adopted, a non-empty one fails loudly).
    const registered = await isWorktreeRoot(runner, worktreePath);
    if (branchExists) {
      // The flow keeps ONE epoch across all rounds, so a re-round reuses the
      // round-1 branch. When everything on it is already integrated, move it up
      // to the integration tip so the round-2 merge is a fast-forward (M6); a
      // branch holding unintegrated commits is never touched.
      await fastForwardIntegratedBranch(runner, branch, headSha, registered ? worktreePath : undefined);
    }
    if (!registered) {
      await runner.run(["worktree", "add", worktreePath, branch]);
    }

    const lease: LeaseRecord = {
      file,
      worktreePath,
      branch,
      epoch,
      // The base the worktree really starts from (the branch tip), which is the
      // integration tip only for a new or fast-forwarded branch.
      baseSha: (await runner.run(["rev-parse", `refs/heads/${branch}`])).trim(),
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
    // Cleanup ordering (Tier-1, takeaways-synthesis #4; verified empirically
    // against git 2.x): `worktree remove --force` DEREGISTERS the worktree
    // even when its directory is already gone — so this single call is the
    // deregister step, it runs BEFORE the lease record is dropped, `git
    // worktree prune` is NEVER used (blanket prune can sweep registrations of
    // live concurrent worktrees), and lease branches are deliberately kept
    // for keyed-commit reachability (quarantine/dedup scans all branches).
    //
    // The result is inspected (C32): "is not a working tree" means it is
    // already gone (idempotent release); a LOCKED worktree is retried with
    // `--force --force`; any other failure (timeout, busy directory) keeps the
    // lease record and surfaces git's message instead of leaking the worktree
    // while the store claims it was released.
    const removeArgs = ["worktree", "remove", "--force", lease.worktreePath];
    let removed = await runner.tryRun(removeArgs);
    if (!removed.ok && /locked/i.test(removed.stderr)) {
      removed = await runner.tryRun([
        "worktree",
        "remove",
        "--force",
        "--force",
        lease.worktreePath,
      ]);
    }
    if (!removed.ok && !/is not a working tree|does not exist/i.test(removed.stderr)) {
      throw new GitError(removeArgs, removed.failure ?? removed.stderr);
    }
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
  // diff --quiet: exit 0 = nothing staged, exit 1 = staged changes; any other
  // outcome (timeout, fatal) throws rather than reading as "has changes".
  const empty = await gitPredicate(runner, ["diff", "--cached", "--quiet"]);
  if (empty) {
    const headTree = (await runner.run(["rev-parse", "HEAD^{tree}"])).trim();
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

/** Parses the round out of an opId (`file#round`); -1 when unparseable (m1). */
export function roundOfOpId(opId: OperationId): number {
  const i = opId.lastIndexOf("#");
  if (i < 0) return -1;
  const n = Number.parseInt(opId.slice(i + 1), 10);
  return Number.isInteger(n) ? n : -1;
}

/**
 * Picks the branch to report for a commit from its `%D` decoration string.
 * `%D` lists HEAD first as `HEAD -> <branch>` when the main checkout's branch
 * sits on the commit - that is not a ref name (`rev-parse "HEAD -> main"`
 * fails), so the prefix is stripped. A `lease/*` branch is preferred because
 * it is the one the round was committed on; otherwise the first branch wins.
 * Returns undefined when no branch decorates the commit (caller falls back to
 * the sha).
 */
export function keyedBranchFromDecoration(decoration: string): string | undefined {
  const names = decoration
    .split(",")
    .map((r) => r.trim().replace(/^HEAD\s*->\s*/, ""))
    .filter((r) => r.length > 0 && r !== "HEAD" && !r.startsWith("tag: "));
  return names.find((n) => n.startsWith("lease/")) ?? names[0];
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
  // --decorate-refs=refs/heads/: decorations (%D) name only local branches, so
  // remote-tracking refs and notes never show up as the keyed "branch".
  const out = await runner.run([
    "log",
    "--all",
    "--decorate-refs=refs/heads/",
    "--format=%H%x1f%D%x1f%b%x1e",
  ]);
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
      const branch = keyedBranchFromDecoration(refs) ?? sha;
      return {
        opId,
        sha,
        contentHash: hashLine ? hashLine.slice(CONTENT_HASH_TRAILER.length + 1) : null,
        branch,
        round: roundOfOpId(opId),
      };
    }
  }
  return undefined;
}

/**
 * C1: after a cross-branch dedup hit, the keyed commit lives on a DIFFERENT
 * branch (quarantined lease / earlier epoch) than this round's lease branch —
 * merging the lease branch alone would integrate NOTHING while the round is
 * already marked done. Makes the keyed commit reachable from THIS branch:
 * fast-forward when possible, else an explicit merge. Divergent replay
 * content (uncommitted, this round's re-implementation) is discarded first —
 * the round is completed and the keyed commit is authoritative; callers
 * record `replay_divergent` evidence before calling.
 */
export async function makeCommitReachable(
  worktreePath: string,
  keyed: KeyedCommit,
): Promise<"already" | "fast-forward" | "merge"> {
  const runner = git(worktreePath);
  if (await isAncestor(runner, keyed.sha, "HEAD")) {
    return "already";
  }
  // Completed round: keyed commit authoritative; drop divergent replay state.
  await runner.run(["reset", "--hard"]);
  await runner.run(["clean", "-fd"]);
  const ffArgs = ["merge", "--ff-only", keyed.sha];
  const ff = await runner.tryRun(ffArgs);
  if (ff.ok) return "fast-forward";
  throwIfInfraFailure(ffArgs, ff);
  await mergeOrAbort(runner, ["--no-ff", "--no-edit", keyed.sha]);
  return "merge";
}

/**
 * C1 verification for the integration step: when a keyed commit exists for
 * the round, it MUST be reachable from the integration branch HEAD — a
 * no-op merge of the wrong branch would silently drop a committed round.
 */
export async function keyedCommitIntegrated(
  integrationWorktreePath: string,
  keyed: KeyedCommit,
): Promise<boolean> {
  // Exit 1 = not an ancestor, 128 = the commit object is missing (also "not
  // integrated"); a timeout or spawn failure is an error, not a "no".
  return gitPredicate(
    git(integrationWorktreePath),
    ["merge-base", "--is-ancestor", keyed.sha, "HEAD"],
    [1, 128],
  );
}

/**
 * `rev-parse --verify --quiet <ref>`: exit 0 = present, exit 1 = absent.
 * Any other outcome (timeout, exit 128) throws instead of reading as "absent".
 */
async function refExists(runner: GitRunner, ref: string): Promise<boolean> {
  return gitPredicate(runner, ["rev-parse", "--verify", "--quiet", ref]);
}

/**
 * Moves an existing lease branch up to `base` when its tip is an ancestor of
 * `base` (every commit on it is already integrated), so a same-epoch re-round
 * starts on the integration tip. With a live worktree the branch is advanced
 * inside it (`merge --ff-only`; refused, and so left alone, if local changes
 * would be overwritten); without one via `branch -f`, which itself refuses a
 * branch checked out elsewhere. A branch with commits not in `base` holds
 * unintegrated work and is left exactly as it is.
 */
async function fastForwardIntegratedBranch(
  runner: GitRunner,
  branch: string,
  base: string,
  worktreePath: string | undefined,
): Promise<void> {
  const tip = (await runner.run(["rev-parse", `refs/heads/${branch}`])).trim();
  if (tip === base) return;
  if (!(await isAncestor(runner, tip, base))) return;
  const args =
    worktreePath !== undefined ? ["-C", worktreePath, "merge", "--ff-only", base] : ["branch", "-f", branch, base];
  const moved = await runner.tryRun(args);
  if (!moved.ok) throwIfInfraFailure(args, moved);
}

/**
 * True only when `path` is the root of a worktree (linked or main): the
 * realpath of `rev-parse --show-toplevel` run inside it must equal the
 * realpath of the path itself. A plain directory nested in a checkout reports
 * that checkout's root instead, and a missing directory fails the probe.
 */
async function isWorktreeRoot(runner: GitRunner, path: string): Promise<boolean> {
  const args = ["-C", path, "rev-parse", "--show-toplevel"];
  const top = await runner.tryRun(args);
  if (!top.ok) {
    throwIfInfraFailure(args, top);
    return false;
  }
  try {
    // `-C <path>` resolves against the runner's cwd, so do the same here.
    return (await realpath(top.stdout.trim())) === (await realpath(resolve(runner.cwd, path)));
  } catch {
    return false;
  }
}

/**
 * For a tryRun whose plain non-zero exit is an expected outcome (e.g. a
 * non-fast-forwardable `merge --ff-only`): a timeout or spawn failure is not
 * that outcome and must surface instead of silently steering the caller down
 * its fallback path.
 */
function throwIfInfraFailure(args: readonly string[], r: TryRunResult): void {
  if ((r.timedOut || r.spawnError !== null) && r.failure !== null) {
    throw new GitError(args, r.failure);
  }
}

/**
 * Runs `git merge <args>` and, when it fails (conflict, refusal, timeout),
 * restores the worktree to a clean pre-merge state before rethrowing: `merge
 * --abort`, falling back to `reset --merge` when git reports no merge to abort
 * or the abort itself fails. Without this a conflict leaves MERGE_HEAD and
 * unmerged paths behind, and every later merge in that worktree fails with
 * "Merging is not possible because you have unmerged files".
 */
async function mergeOrAbort(runner: GitRunner, args: readonly string[]): Promise<void> {
  try {
    await runner.run(["merge", ...args]);
  } catch (mergeErr) {
    const abort = await runner.tryRun(["merge", "--abort"]);
    if (!abort.ok) {
      const reset = await runner.tryRun(["reset", "--merge"]);
      if (!reset.ok) {
        const base = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        throw new Error(
          `${base}; additionally could not restore a clean worktree (merge --abort: ${abort.stderr.trim()}; reset --merge: ${reset.stderr.trim()})`,
          { cause: mergeErr },
        );
      }
    }
    throw mergeErr;
  }
}

/** `merge-base --is-ancestor`: exit 0 = yes, exit 1 = no; anything else throws. */
async function isAncestor(runner: GitRunner, ancestor: string, descendant: string): Promise<boolean> {
  return gitPredicate(runner, ["merge-base", "--is-ancestor", ancestor, descendant]);
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
  // 1/128 = absent or not a repo; a timeout must not read as "unreadable".
  return gitPredicate(runner, ["cat-file", "-e", `${sha}^{commit}`], [1, 128]);
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
 * keeps merges conflict-free by construction (disjoint paths) - but nothing
 * enforces disjointness, so a conflicting merge is aborted and rethrown,
 * leaving the shared integration worktree clean. Uses a dedicated worktree so
 * the main checkout is never disturbed.
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
  const hasIntegration = await refExists(root, `refs/heads/${integrationBranch}`);
  if (!hasIntegration) {
    const head = (await root.run(["rev-parse", "HEAD"])).trim();
    await root.run(["branch", integrationBranch, head]);
  }

  // Ensure the integration worktree exists.
  if (!(await isWorktreeRoot(root, integrationWorktreePath))) {
    await root.run(["worktree", "add", integrationWorktreePath, integrationBranch]);
  }

  const integ = git(integrationWorktreePath);
  // Idempotency: if the lease tip is already an ancestor, nothing to do.
  if (await isAncestor(integ, tip, "HEAD")) {
    const sha = (await integ.run(["rev-parse", "HEAD"])).trim();
    return { alreadyIntegrated: true, fastForward: false, sha };
  }

  // Fast-forward when possible; otherwise a real merge. Explicit re-round
  // strategy (M6): re-round leases base on the integration tip, so a same-path
  // re-round merges as a pure FAST-FORWARD; a genuinely divergent lease (its
  // branch has own commits while integration moved) falls back to --no-ff,
  // which is the only sanctioned merge-commit shape in the toolkit.
  const ffArgs = ["merge", "--ff-only", leaseBranch];
  const ff = await integ.tryRun(ffArgs);
  if (ff.ok) {
    const sha = (await integ.run(["rev-parse", "HEAD"])).trim();
    return { alreadyIntegrated: false, fastForward: true, sha };
  }
  throwIfInfraFailure(ffArgs, ff);
  // A conflicting merge is aborted (see mergeOrAbort) so the SHARED integration
  // worktree is never left holding MERGE_HEAD / unmerged paths that would wedge
  // the step retry and every later merge, including unrelated files.
  await mergeOrAbort(integ, ["--no-ff", "--no-edit", leaseBranch]);
  const sha = (await integ.run(["rev-parse", "HEAD"])).trim();
  return { alreadyIntegrated: false, fastForward: false, sha };
}

/** True when the integrated output contains a path with non-empty content. */
export async function integratedContentExists(
  integrationWorktreePath: string,
  path: string,
): Promise<boolean> {
  const runner = git(integrationWorktreePath);
  return gitPredicate(runner, ["cat-file", "-e", `HEAD:${path}`], [1, 128]);
}

/**
 * One path/ref-safe segment for a file: the lease branch is
 * `lease/<segment>/<epoch>` and the worktree directory `<segment>-<epoch>`.
 * Beyond the character whitelist the segment must also be a valid ref
 * component (`git check-ref-format`): no leading `.`, no `..`, no trailing
 * `.lock` - those are rewritten, which forces the hash suffix below. Names
 * that were already valid are returned unchanged.
 */
export function sanitizePathSegment(input: string): string {
  const safe = input
    .replace(/[^a-zA-Z0-9._-]+/g, "__")
    .replace(/\.{2,}/g, "__")
    .replace(/^\./, "_")
    .replace(/\.lock$/, "_lock");
  if (safe.length === 0 || safe.length > 96) return `seg-${hashOf(input)}`;
  // m3: inputs differing only in sanitized-away characters (e.g. `a/b` vs
  // `a.b`) would otherwise collide; suffix the hash whenever sanitizing
  // actually changed the input.
  if (safe !== input) return `${safe}-${hashOf(input)}`;
  return safe;
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
