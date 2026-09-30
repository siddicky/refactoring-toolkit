/**
 * C29 — "worktree exists" means "is a registered worktree root", not "is a
 * directory somewhere inside the repository".
 *
 * Before: `rev-parse --is-inside-work-tree` was the probe, and worktreeRoot is
 * `<repo>/.worktrees`, so a plain directory left at the lease (or integration)
 * path reported true and the lease silently became the MAIN checkout: commits
 * and merges landed on `main`.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git } from "../src/git/exec.js";
import { makeFixtureRepo } from "../src/git/fixture.js";
import {
  InMemoryLeaseStore,
  WorktreePool,
  commitLeaseChanges,
  mergeLeaseIntoIntegration,
  operationId,
} from "../src/git/worktree.js";

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function setup(): Promise<{ repo: string; pool: WorktreePool }> {
  root = await mkdtemp(join(tmpdir(), "porting-kit-wt-validate-"));
  await makeFixtureRepo(root);
  return { repo: root, pool: new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2) };
}

async function branchOf(dir: string): Promise<string> {
  return (await git(dir).run(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
}

async function toplevelOf(dir: string): Promise<string> {
  return await realpath((await git(dir).run(["rev-parse", "--show-toplevel"])).trim());
}

describe("WorktreePool.acquire validates the lease path", () => {
  test("an empty stub directory at the lease path becomes a real linked worktree on the lease branch", async () => {
    const { repo, pool } = await setup();
    const first = await pool.acquire("src/a.php", 1, "run-1");
    if (!first.acquired) throw new Error(first.reason);
    const { worktreePath, branch } = first.lease;
    await pool.release("src/a.php");
    // Out-of-band leftover: the directory exists again but is not a worktree.
    await rm(worktreePath, { recursive: true, force: true });
    await mkdir(worktreePath, { recursive: true });

    const mainHeadBefore = (await git(repo).run(["rev-parse", "HEAD"])).trim();
    const again = await pool.acquire("src/a.php", 1, "run-2");
    if (!again.acquired) throw new Error(again.reason);

    expect(await toplevelOf(worktreePath)).toBe(await realpath(worktreePath));
    expect(await toplevelOf(worktreePath)).not.toBe(await realpath(repo));
    expect(await branchOf(worktreePath)).toBe(branch);
    const listed = await git(repo).run(["worktree", "list", "--porcelain"]);
    expect(listed).toContain(`branch refs/heads/${branch}`);

    // A commit through the lease lands on the lease branch, never on main.
    await mkdir(join(worktreePath, "src"), { recursive: true });
    await writeFile(join(worktreePath, "src", "a.php"), "<?php\n");
    await commitLeaseChanges(worktreePath, operationId("src/a.php", 1), "round 1");
    expect(await branchOf(repo)).toBe("main");
    expect((await git(repo).run(["rev-parse", "HEAD"])).trim()).toBe(mainHeadBefore);
  });

  test("a non-empty directory that is not a worktree fails loudly and records no lease", async () => {
    const { repo, pool } = await setup();
    const first = await pool.acquire("src/a.php", 1, "run-1");
    if (!first.acquired) throw new Error(first.reason);
    const { worktreePath } = first.lease;
    await pool.release("src/a.php");
    await rm(worktreePath, { recursive: true, force: true });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(join(worktreePath, "stray.txt"), "not a worktree\n");

    const mainHeadBefore = (await git(repo).run(["rev-parse", "HEAD"])).trim();
    await expect(pool.acquire("src/a.php", 1, "run-2")).rejects.toThrow(/already exists/);
    expect(pool.store().get("src/a.php")).toBeUndefined();
    expect(await branchOf(repo)).toBe("main");
    expect((await git(repo).run(["rev-parse", "HEAD"])).trim()).toBe(mainHeadBefore);
  });

  test("an existing registered worktree is still reused (crash-recovery path), dirty state intact", async () => {
    const { repo, pool } = await setup();
    const first = await pool.acquire("src/a.php", 1, "run-1");
    if (!first.acquired) throw new Error(first.reason);
    const { worktreePath, branch } = first.lease;
    await writeFile(join(worktreePath, "wip.txt"), "uncommitted\n");

    // A new pool instance (fresh store) models the recovered process.
    const recovered = new WorktreePool(repo, join(repo, ".worktrees"), new InMemoryLeaseStore(), 2);
    const again = await recovered.acquire("src/a.php", 1, "run-2");
    if (!again.acquired) throw new Error(again.reason);
    expect(again.lease.worktreePath).toBe(worktreePath);
    expect(await branchOf(worktreePath)).toBe(branch);
    expect((await git(worktreePath).run(["status", "--porcelain"])).trim()).toContain("wip.txt");
  });
});

describe("mergeLeaseIntoIntegration validates the integration worktree path", () => {
  test("a plain directory at .worktrees/integration never makes the merge land on main", async () => {
    const { repo, pool } = await setup();
    const lease = await pool.acquire("src/a.php", 1, "run-1");
    if (!lease.acquired) throw new Error(lease.reason);
    await mkdir(join(lease.lease.worktreePath, "src"), { recursive: true });
    await writeFile(join(lease.lease.worktreePath, "src", "a.php"), "<?php\n");
    await commitLeaseChanges(lease.lease.worktreePath, operationId("src/a.php", 1), "round 1");

    const integrationWt = join(repo, ".worktrees", "integration");
    await mkdir(integrationWt, { recursive: true }); // stub: exists, is not a worktree
    const mainHeadBefore = (await git(repo).run(["rev-parse", "main"])).trim();

    const res = await mergeLeaseIntoIntegration(repo, integrationWt, lease.lease.branch);
    expect(res.alreadyIntegrated).toBe(false);

    expect(await toplevelOf(integrationWt)).toBe(await realpath(integrationWt));
    expect(await branchOf(integrationWt)).toBe("integration");
    // main is untouched; the merged content is on the integration branch only.
    expect((await git(repo).run(["rev-parse", "main"])).trim()).toBe(mainHeadBefore);
    const onMain = (await git(repo).tryRun(["cat-file", "-e", "main:src/a.php"])).ok;
    const onIntegration = (await git(repo).tryRun(["cat-file", "-e", "integration:src/a.php"])).ok;
    expect(onMain).toBe(false);
    expect(onIntegration).toBe(true);
  });
});
