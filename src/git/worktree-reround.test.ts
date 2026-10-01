/**
 * C10 — same-epoch re-round leases.
 *
 * The flow keeps ONE epoch across all rounds of a run, so round 2 of a file
 * re-acquires `lease/<file>/<epoch>`: the branch from round 1. Before, acquire
 * only based a NEW branch on the integration tip, so a re-round reused the old
 * branch: the worktree was stale relative to integration, the round-2 merge was
 * a non-fast-forward merge commit, and LeaseRecord.baseSha (the integration
 * tip) was not the branch's real base. The M6 test only passed because it
 * bumped the epoch.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { git } from "./exec.js";
import { makeFixtureRepo } from "./fixture.js";
import {
  InMemoryLeaseStore,
  WorktreePool,
  applyReconcile,
  commitLeaseChanges,
  findCommitByOpId,
  mergeLeaseIntoIntegration,
  operationId,
  reconcile,
  type LeaseRecord,
} from "./worktree.js";

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function setup(): Promise<{ repo: string; pool: WorktreePool; integrationWt: string }> {
  root = await mkdtemp(join(tmpdir(), "porting-kit-reround-"));
  await makeFixtureRepo(root);
  return {
    repo: root,
    pool: new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2),
    integrationWt: join(root, ".worktrees", "integration"),
  };
}

async function writeAndCommit(lease: LeaseRecord, file: string, content: string, round: number) {
  await mkdir(dirname(join(lease.worktreePath, file)), { recursive: true });
  await writeFile(join(lease.worktreePath, file), content);
  return commitLeaseChanges(lease.worktreePath, operationId(file, round), `${file} round ${round}`);
}

async function head(dir: string): Promise<string> {
  return (await git(dir).run(["rev-parse", "HEAD"])).trim();
}

async function acquireOrThrow(pool: WorktreePool, file: string, epoch: number): Promise<LeaseRecord> {
  const res = await pool.acquire(file, epoch, `run-${file}-${epoch}`);
  if (!res.acquired) throw new Error(res.reason);
  return res.lease;
}

describe("same-epoch re-round fast-forwards into integration", () => {
  test("a r1, b r1, then a r2 at the SAME epoch: worktree starts on the integration tip, baseSha is real, merge is a fast-forward", async () => {
    const { repo, pool, integrationWt } = await setup();
    const EPOCH = 1;

    const a1 = await acquireOrThrow(pool, "src/a.ts", EPOCH);
    await writeAndCommit(a1, "src/a.ts", "export const a = 1;\n", 1);
    await mergeLeaseIntoIntegration(repo, integrationWt, a1.branch);
    await pool.release("src/a.ts");

    const b1 = await acquireOrThrow(pool, "src/b.ts", EPOCH);
    await writeAndCommit(b1, "src/b.ts", "export const b = 1;\n", 1);
    await mergeLeaseIntoIntegration(repo, integrationWt, b1.branch);
    await pool.release("src/b.ts");
    const integrationTip = await head(integrationWt);

    // Round 2 of a.ts: same epoch, so the same branch name as round 1.
    const a2 = await acquireOrThrow(pool, "src/a.ts", EPOCH);
    expect(a2.branch).toBe(a1.branch);
    const worktreeHead = await head(a2.worktreePath);
    expect(worktreeHead).toBe(integrationTip); // not stale: a2 sees b.ts
    expect(a2.baseSha).toBe(worktreeHead); // baseSha is the real base
    expect(a2.baseSha).toBe(integrationTip);

    await writeAndCommit(a2, "src/a.ts", "export const a = 2;\n", 2);
    const merged = await mergeLeaseIntoIntegration(repo, integrationWt, a2.branch);
    expect(merged.fastForward).toBe(true);
    expect(merged.alreadyIntegrated).toBe(false);
    // linear history: no merge commit on integration
    const merges = (await git(repo).run(["log", "integration", "--merges", "--format=%H"])).trim();
    expect(merges).toBe("");
  });

  test("a live (crash-surviving) worktree on an integrated branch is advanced in place", async () => {
    const { repo, pool, integrationWt } = await setup();
    const a1 = await acquireOrThrow(pool, "src/a.ts", 1);
    await writeAndCommit(a1, "src/a.ts", "export const a = 1;\n", 1);
    await mergeLeaseIntoIntegration(repo, integrationWt, a1.branch);
    // a's worktree is left behind (no release); b integrates and moves the tip.
    const b1 = await acquireOrThrow(pool, "src/b.ts", 1);
    await writeAndCommit(b1, "src/b.ts", "export const b = 1;\n", 1);
    await mergeLeaseIntoIntegration(repo, integrationWt, b1.branch);
    const integrationTip = await head(integrationWt);

    const recovered = new WorktreePool(repo, join(repo, ".worktrees"), new InMemoryLeaseStore(), 2);
    const a2 = await acquireOrThrow(recovered, "src/a.ts", 1);
    expect(a2.worktreePath).toBe(a1.worktreePath);
    expect(await head(a2.worktreePath)).toBe(integrationTip);
    expect(a2.baseSha).toBe(integrationTip);
  });
});

describe("a branch with unintegrated commits is never reset", () => {
  test("the round-1 commit survives a same-epoch re-lease and is the recorded base", async () => {
    const { repo, pool, integrationWt } = await setup();
    const a1 = await acquireOrThrow(pool, "src/a.ts", 1);
    const committed = await writeAndCommit(a1, "src/a.ts", "export const a = 1;\n", 1);
    await pool.release("src/a.ts"); // round 1 committed on the lease branch, NOT integrated

    // Integration moves on without it.
    const b1 = await acquireOrThrow(pool, "src/b.ts", 1);
    await writeAndCommit(b1, "src/b.ts", "export const b = 1;\n", 1);
    await mergeLeaseIntoIntegration(repo, integrationWt, b1.branch);
    await pool.release("src/b.ts");

    const a2 = await acquireOrThrow(pool, "src/a.ts", 1);
    expect(await head(a2.worktreePath)).toBe(committed.sha!);
    expect(a2.baseSha).toBe(committed.sha!); // the branch's true base, not the integration tip

    // A `redone` reconcile resets to baseSha: the committed round must survive.
    await writeFile(join(a2.worktreePath, "stray.txt"), "junk\n");
    const action = reconcile({
      marker: undefined,
      keyed: undefined,
      worktree: { clean: false, commitObjectReadable: false },
    });
    expect(action.kind).toBe("redone");
    await applyReconcile(a2, action, undefined);
    expect(await head(a2.worktreePath)).toBe(committed.sha!);
    expect((await findCommitByOpId(repo, operationId("src/a.ts", 1)))?.sha).toBe(committed.sha!);
  });
});
