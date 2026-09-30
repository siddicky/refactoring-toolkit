/**
 * C35 — ref-name handling.
 *
 * (a) sanitizePathSegment returned any input matching [a-zA-Z0-9._-]+ as-is, so
 *     a bare `.htaccess`, `a..b.php` or `x.lock` produced a lease branch name
 *     git refuses (`lease/.htaccess/1`: "not a valid branch name").
 * (b) findCommitByOpId reported `HEAD -> main` as the keyed branch when the
 *     main checkout's branch already contained the keyed commit; that string
 *     is not a ref and failed later at `rev-parse` in the wave join.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { git } from "../src/git/exec.js";
import { makeFixtureRepo } from "../src/git/fixture.js";
import {
  InMemoryLeaseStore,
  WorktreePool,
  commitLeaseChanges,
  findCommitByOpId,
  keyedBranchFromDecoration,
  operationId,
  sanitizePathSegment,
} from "../src/git/worktree.js";

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function validRef(repo: string, ref: string): Promise<boolean> {
  return (await git(repo).tryRun(["check-ref-format", ref])).ok;
}

const BAD_NAMES = [".htaccess", "a..b.php", "x.lock", ".php", "src/a..b.php", ".", "..", ".lock", "a/.hidden.lock"];
const GOOD_NAMES = ["index.php", "src/a.php", "src/.htaccess", "Money.php", "a.b.c.php"];

describe("sanitizePathSegment yields valid ref components", () => {
  test("every produced lease ref passes git check-ref-format, including hostile names", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-refnames-"));
    await makeFixtureRepo(root);
    for (const name of [...BAD_NAMES, ...GOOD_NAMES]) {
      const seg = sanitizePathSegment(name);
      expect(await validRef(root, `refs/heads/lease/${seg}/1`)).toBe(true);
      expect(seg.length).toBeGreaterThan(0);
    }
  });

  test("names that were already valid keep their exact previous value (stable worktree paths / branches)", () => {
    expect(sanitizePathSegment("index.php")).toBe("index.php");
    expect(sanitizePathSegment("Money.php")).toBe("Money.php");
    expect(sanitizePathSegment("a.b.c.php")).toBe("a.b.c.php");
    // From the audit probe: lease/src__a.php-60de8fcf/1
    expect(sanitizePathSegment("src/a.php")).toBe("src__a.php-60de8fcf");
  });

  test("distinct hostile inputs stay distinct (hash suffix)", () => {
    expect(sanitizePathSegment(".htaccess")).not.toBe(sanitizePathSegment("_htaccess"));
    expect(sanitizePathSegment("x.lock")).not.toBe(sanitizePathSegment("x_lock"));
    expect(sanitizePathSegment("a..b.php")).not.toBe(sanitizePathSegment("a__b.php"));
  });

  test("acquire() succeeds for names that used to make `git branch` throw", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-refnames-acq-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    for (const name of [".htaccess", "a..b.php", "x.lock", ".php", "src/a..b.php"]) {
      const res = await pool.acquire(name, 1, "run-1");
      expect(res.acquired).toBe(true);
      if (!res.acquired) continue;
      const branch = (await git(res.lease.worktreePath).run(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      expect(branch).toBe(res.lease.branch);
      await pool.release(name);
    }
  });
});

describe("findCommitByOpId reports a real branch name", () => {
  test("after main fast-forwards to the keyed commit the lease branch is reported, not `HEAD -> main`", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-keyed-branch-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    const file = "src/a.php";
    const lease = await pool.acquire(file, 1, "run-1");
    if (!lease.acquired) throw new Error(lease.reason);
    await mkdir(dirname(join(lease.lease.worktreePath, file)), { recursive: true });
    await writeFile(join(lease.lease.worktreePath, file), "<?php\n");
    await commitLeaseChanges(lease.lease.worktreePath, operationId(file, 1), "round 1");

    // The main checkout's branch now contains (and sits on) the keyed commit.
    await git(root).run(["merge", "--ff-only", lease.lease.branch]);
    const rawDecoration = await git(root).run(["log", "--all", "--format=%D"]);
    expect(rawDecoration).toContain("HEAD -> main"); // the premise of the defect

    const keyed = await findCommitByOpId(root, operationId(file, 1));
    expect(keyed).toBeDefined();
    expect(keyed?.branch).toBe(lease.lease.branch);
    // and it is a ref git can resolve
    expect((await git(root).tryRun(["rev-parse", "--verify", "--quiet", `refs/heads/${keyed?.branch}`])).ok).toBe(true);
  });

  test("a keyed commit only on main reports `main`", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-keyed-main-"));
    await makeFixtureRepo(root);
    await writeFile(join(root, "f.txt"), "x\n");
    await commitLeaseChanges(root, operationId("f.txt", 1), "on main");
    const keyed = await findCommitByOpId(root, operationId("f.txt", 1));
    expect(keyed?.branch).toBe("main");
  });

  test("keyedBranchFromDecoration: strips the HEAD arrow, prefers lease/*, skips tags and bare HEAD", () => {
    expect(keyedBranchFromDecoration("HEAD -> main, lease/src__a.php-60de8fcf/1, integration")).toBe(
      "lease/src__a.php-60de8fcf/1",
    );
    expect(keyedBranchFromDecoration("HEAD -> main")).toBe("main");
    expect(keyedBranchFromDecoration("HEAD, tag: v1")).toBeUndefined();
    expect(keyedBranchFromDecoration("")).toBeUndefined();
    expect(keyedBranchFromDecoration("integration, lease/x/2")).toBe("lease/x/2");
  });
});
