/**
 * C32 — WorktreePool.release inspects the `worktree remove` result.
 *
 * Before: the result was discarded and the lease record dropped regardless, so
 * a locked (or otherwise unremovable) worktree leaked on disk and in
 * `git worktree list` while the store claimed it was released.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { git } from "./exec.js";
import { makeFixtureRepo } from "./fixture.js";
import { InMemoryLeaseStore, WorktreePool } from "./worktree.js";

const savedPath = process.env.PATH;
const tmpDirs: string[] = [];

afterEach(async () => {
  process.env.PATH = savedPath;
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

async function setup(): Promise<{ repo: string; pool: WorktreePool }> {
  const repo = await tmp("porting-kit-release-");
  await makeFixtureRepo(repo);
  return { repo, pool: new WorktreePool(repo, join(repo, ".worktrees"), new InMemoryLeaseStore(), 2) };
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** A `git` shim that fails every `worktree remove` and delegates the rest. */
async function installFailingRemoveShim(): Promise<void> {
  const realGit = Bun.which("git", { PATH: savedPath ?? "" });
  if (realGit === null) throw new Error("git not found");
  const bin = await tmp("fake-git-remove-");
  const script = join(bin, "git");
  await writeFile(
    script,
    [
      "#!/bin/sh",
      'for a in "$@"; do',
      '  if [ "$a" = "remove" ]; then echo "fatal: simulated busy directory" >&2; exit 128; fi',
      "done",
      `exec "${realGit}" "$@"`,
      "",
    ].join("\n"),
  );
  await chmod(script, 0o755);
  process.env.PATH = `${bin}:${savedPath ?? ""}`;
}

describe("WorktreePool.release", () => {
  test("a locked worktree is removed via --force --force and the lease is dropped", async () => {
    const { repo, pool } = await setup();
    const res = await pool.acquire("src/a.php", 1, "run-1");
    if (!res.acquired) throw new Error(res.reason);
    await writeFile(join(res.lease.worktreePath, "dirty.txt"), "uncommitted\n");
    await git(repo).run(["worktree", "lock", res.lease.worktreePath]);

    await pool.release("src/a.php");

    expect(pool.store().get("src/a.php")).toBeUndefined();
    expect(await exists(res.lease.worktreePath)).toBe(false);
    const listed = await git(repo).run(["worktree", "list", "--porcelain"]);
    expect(listed).not.toContain(res.lease.branch);
    // The lease branch is deliberately kept (keyed-commit reachability).
    expect((await git(repo).tryRun(["rev-parse", "--verify", "--quiet", `refs/heads/${res.lease.branch}`])).ok).toBe(true);
  });

  test("a removal that fails keeps the lease record, throws git's message, and a retry succeeds", async () => {
    const { pool } = await setup();
    const res = await pool.acquire("src/a.php", 1, "run-1");
    if (!res.acquired) throw new Error(res.reason);

    await installFailingRemoveShim();
    await expect(pool.release("src/a.php")).rejects.toThrow(/simulated busy directory/);
    expect(pool.store().get("src/a.php")?.worktreePath).toBe(res.lease.worktreePath);
    expect(await exists(res.lease.worktreePath)).toBe(true);

    // Shim gone (the busy condition cleared): the retry completes the release.
    process.env.PATH = savedPath;
    await pool.release("src/a.php");
    expect(pool.store().get("src/a.php")).toBeUndefined();
    expect(await exists(res.lease.worktreePath)).toBe(false);
  });

  test("an already-removed worktree releases idempotently (no throw, lease dropped)", async () => {
    const { repo, pool } = await setup();
    const res = await pool.acquire("src/a.php", 1, "run-1");
    if (!res.acquired) throw new Error(res.reason);
    // Removed behind the pool's back: git no longer knows the path.
    await git(repo).run(["worktree", "remove", "--force", res.lease.worktreePath]);

    await pool.release("src/a.php");
    expect(pool.store().get("src/a.php")).toBeUndefined();
    // and releasing a file with no lease is a no-op
    await pool.release("src/a.php");
    await pool.release("src/never-leased.php");
  });

  test("stale-lease reclaim through acquire also removes a locked worktree", async () => {
    const { repo, pool } = await setup();
    const old = await pool.acquire("src/a.php", 1, "run-1");
    if (!old.acquired) throw new Error(old.reason);
    await git(repo).run(["worktree", "lock", old.lease.worktreePath]);

    const fresh = await pool.acquire("src/a.php", 2, "run-2");
    expect(fresh.acquired).toBe(true);
    expect(await exists(old.lease.worktreePath)).toBe(false);
    expect(pool.store().get("src/a.php")?.epoch).toBe(2);
  });
});
