/**
 * findCommitByOpId returns the ORIGINAL commit when a naive replay produced a
 * second commit with the same operation-ID (git-selftest 0d3 / the quarantine
 * dedup contract). `git log` lists newest first, so taking the first match
 * returned the replay whenever the two commits landed in different seconds; the
 * git-selftest 0d3 check failed in roughly one run in eight (also on the
 * pre-audit baseline).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { makeFixtureRepo } from "./fixture.js";
import {
  InMemoryLeaseStore,
  WorktreePool,
  commitLeaseChanges,
  findCommitByOpId,
  operationId,
} from "./worktree.js";

let root: string | undefined;
const savedDates = {
  author: process.env.GIT_AUTHOR_DATE,
  committer: process.env.GIT_COMMITTER_DATE,
};

afterEach(async () => {
  for (const [key, saved] of [
    ["GIT_AUTHOR_DATE", savedDates.author],
    ["GIT_COMMITTER_DATE", savedDates.committer],
  ] as const) {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function commitAt(worktreePath: string, file: string, content: string, opId: string, date: string) {
  process.env.GIT_AUTHOR_DATE = date;
  process.env.GIT_COMMITTER_DATE = date;
  await mkdir(dirname(join(worktreePath, file)), { recursive: true });
  await writeFile(join(worktreePath, file), content);
  return commitLeaseChanges(worktreePath, opId, `write ${file}`);
}

describe("findCommitByOpId with duplicate op-ID commits", () => {
  test("the original (oldest) commit wins even though git log lists the replay first", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-opid-lookup-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    const file = "src/a.php";
    const opId = operationId(file, 1);

    const first = await pool.acquire(file, 1, "run-1");
    if (!first.acquired) throw new Error(first.reason);
    const original = await commitAt(first.lease.worktreePath, file, "<?php // original\n", opId, "2030-01-01T00:00:00Z");
    await pool.release(file);

    // The replay on a spare (next epoch) lands LATER, in a different second.
    const spare = await pool.acquire(file, 2, "run-2");
    if (!spare.acquired) throw new Error(spare.reason);
    const replay = await commitAt(spare.lease.worktreePath, file, "<?php // replay\n", opId, "2030-01-01T00:00:07Z");
    expect(replay.sha).not.toBe(original.sha);

    const found = await findCommitByOpId(root, opId);
    expect(found?.sha).toBe(original.sha ?? undefined);
    expect(found?.branch).toBe(first.lease.branch);
    expect(found?.contentHash).toBe(original.contentHash);
  });

  test("a single matching commit and a missing op-ID behave as before", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-opid-lookup-single-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    const lease = await pool.acquire("src/b.php", 1, "run-1");
    if (!lease.acquired) throw new Error(lease.reason);
    const c = await commitAt(lease.lease.worktreePath, "src/b.php", "<?php\n", operationId("src/b.php", 1), "2030-02-01T00:00:00Z");
    expect((await findCommitByOpId(root, operationId("src/b.php", 1)))?.sha).toBe(c.sha ?? undefined);
    expect(await findCommitByOpId(root, operationId("src/b.php", 2))).toBeUndefined();
  });
});
