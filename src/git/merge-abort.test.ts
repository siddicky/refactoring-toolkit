/**
 * C31 — a failed `git merge --no-ff` must not wedge the shared worktree.
 *
 * Before: a conflicting merge in mergeLeaseIntoIntegration / makeCommitReachable
 * left MERGE_HEAD and unmerged paths behind, so the step retry and every later
 * merge (even of unrelated files) failed with "Merging is not possible because
 * you have unmerged files".
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
  commitLeaseChanges,
  findCommitByOpId,
  makeCommitReachable,
  mergeLeaseIntoIntegration,
  operationId,
} from "./worktree.js";

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function commitFile(worktreePath: string, rel: string, content: string, opId: string) {
  await mkdir(dirname(join(worktreePath, rel)), { recursive: true });
  await writeFile(join(worktreePath, rel), content);
  return commitLeaseChanges(worktreePath, opId, `write ${rel}`);
}

async function mergeHeadPresent(worktreePath: string): Promise<boolean> {
  return (await git(worktreePath).tryRun(["rev-parse", "-q", "--verify", "MERGE_HEAD"])).ok;
}

async function isClean(worktreePath: string): Promise<boolean> {
  return (await git(worktreePath).run(["status", "--porcelain"])).trim() === "";
}

describe("mergeLeaseIntoIntegration aborts a conflicting merge", () => {
  test("conflict is rethrown with the cause, the integration worktree stays clean, and unrelated leases still merge", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-merge-abort-"));
    await makeFixtureRepo(root);
    const integrationWt = join(root, ".worktrees", "integration");
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 3);

    // Three leases, all based on the same integration tip (created before any merge).
    const a = await pool.acquire("a.php", 1, "run-a");
    const b = await pool.acquire("b.php", 1, "run-b");
    const c = await pool.acquire("c.php", 1, "run-c");
    if (!a.acquired || !b.acquired || !c.acquired) throw new Error("lease setup failed");

    // a and b both add shared.txt with different content (the cross-path conflict
    // nothing enforces); c touches a disjoint file.
    await commitFile(a.lease.worktreePath, "shared.txt", "from a\n", operationId("a.php", 1));
    await commitFile(b.lease.worktreePath, "shared.txt", "from b\n", operationId("b.php", 1));
    await commitFile(c.lease.worktreePath, "c.txt", "from c\n", operationId("c.php", 1));

    await mergeLeaseIntoIntegration(root, integrationWt, a.lease.branch);
    const tipBefore = (await git(integrationWt).run(["rev-parse", "HEAD"])).trim();

    let firstErr: unknown;
    try {
      await mergeLeaseIntoIntegration(root, integrationWt, b.lease.branch);
    } catch (e) {
      firstErr = e;
    }
    expect(firstErr).toBeInstanceOf(Error);
    // The conflict detail (git prints CONFLICT to stdout) is in the message.
    expect((firstErr as Error).message).toContain("CONFLICT");

    // The shared worktree was restored: no merge in progress, nothing unmerged.
    expect(await mergeHeadPresent(integrationWt)).toBe(false);
    expect(await isClean(integrationWt)).toBe(true);
    expect((await git(integrationWt).run(["rev-parse", "HEAD"])).trim()).toBe(tipBefore);

    // A step retry fails the SAME way (the conflict), not with "unmerged files".
    let retryErr: unknown;
    try {
      await mergeLeaseIntoIntegration(root, integrationWt, b.lease.branch);
    } catch (e) {
      retryErr = e;
    }
    expect((retryErr as Error).message).toContain("CONFLICT");
    expect((retryErr as Error).message).not.toContain("unmerged files");

    // An unrelated lease still integrates (non-fast-forward, clean merge).
    const res = await mergeLeaseIntoIntegration(root, integrationWt, c.lease.branch);
    expect(res.alreadyIntegrated).toBe(false);
    expect(res.fastForward).toBe(false);
    const cPresent = (await git(integrationWt).tryRun(["cat-file", "-e", "HEAD:c.txt"])).ok;
    expect(cPresent).toBe(true);
    expect(await isClean(integrationWt)).toBe(true);
  });
});

describe("makeCommitReachable aborts a conflicting merge", () => {
  test("a divergent keyed commit that conflicts leaves the lease worktree clean at its old HEAD", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-reach-abort-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    const a = await pool.acquire("a.php", 1, "run-a");
    const b = await pool.acquire("b.php", 1, "run-b");
    if (!a.acquired || !b.acquired) throw new Error("lease setup failed");

    await commitFile(a.lease.worktreePath, "shared.txt", "from a\n", operationId("a.php", 1));
    await commitFile(b.lease.worktreePath, "shared.txt", "from b\n", operationId("b.php", 1));
    const keyed = await findCommitByOpId(root, operationId("b.php", 1));
    if (keyed === undefined) throw new Error("keyed commit not found");

    const headBefore = (await git(a.lease.worktreePath).run(["rev-parse", "HEAD"])).trim();
    let err: unknown;
    try {
      await makeCommitReachable(a.lease.worktreePath, keyed);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("CONFLICT");
    expect(await mergeHeadPresent(a.lease.worktreePath)).toBe(false);
    expect(await isClean(a.lease.worktreePath)).toBe(true);
    expect((await git(a.lease.worktreePath).run(["rev-parse", "HEAD"])).trim()).toBe(headBefore);
  });
});
