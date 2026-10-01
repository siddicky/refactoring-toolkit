/**
 * C68 — `recover-port` reconciles EACH file against its OWN lease worktree.
 *
 * Before: `leaseWorktrees.find(p => p.includes(`-${epoch - 1}`))` never used
 * `file`, so every file was reconciled against the first listed worktree:
 * applyReconcile could `reset --hard` file A's worktree to file B's keyed
 * commit (silently repointing A's lease branch and making A's committed round
 * unfindable) while the command printed success. The substring `-1` also
 * matched hashes / parent directories, the previous epoch was hard-coded to
 * epoch-1, `--files creatorex` was not expanded, and the printed re-dispatch
 * command omitted --source-root/--prep.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  parseWorktreeList,
  reconcileLeaseWorktrees,
  redispatchCommand,
  selectLeaseWorktree,
  type WorktreeRef,
} from "../scripts/run-demo.js";
import { git } from "../src/git/exec.js";
import { makeFixtureRepo } from "../src/git/fixture.js";
import {
  InMemoryLeaseStore,
  WorktreePool,
  commitLeaseChanges,
  findCommitByOpId,
  operationId,
  sanitizePathSegment,
} from "../src/git/worktree.js";

const RUN_DEMO = join(import.meta.dir, "..", "scripts", "run-demo.ts");
const MONEY = "src/Money.php";
const CUSTOMER = "src/Customer.php";

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

function capture(): { lines: string[]; errors: string[]; log(m: string): void; error(m: string): void } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, log: (m) => void lines.push(m), error: (m) => void errors.push(m) };
}

/** Two leased files, each with a committed round 1 and a stale writer's junk afterwards. */
async function twoDirtyLeases(epoch: number) {
  root = await mkdtemp(join(tmpdir(), "porting-kit-recover-"));
  await makeFixtureRepo(root);
  const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
  const tips: Record<string, string> = {};
  const worktrees: Record<string, string> = {};
  const branches: Record<string, string> = {};
  for (const file of [MONEY, CUSTOMER]) {
    const res = await pool.acquire(file, epoch, `run-${file}`);
    if (!res.acquired) throw new Error(res.reason);
    await mkdir(dirname(join(res.lease.worktreePath, file)), { recursive: true });
    await writeFile(join(res.lease.worktreePath, file), `<?php\n// ${file} committed round 1\n`);
    const c = await commitLeaseChanges(res.lease.worktreePath, operationId(file, 1), `${file} round 1`);
    tips[file] = c.sha!;
    worktrees[file] = res.lease.worktreePath;
    branches[file] = res.lease.branch;
  }
  // A stale writer dirties BOTH worktrees after their keyed commits.
  for (const file of [MONEY, CUSTOMER]) {
    await writeFile(join(worktrees[file]!, file), `STALE WRITER JUNK for ${file}\n`);
    await writeFile(join(worktrees[file]!, "stale.txt"), "junk\n");
  }
  return { repo: root, tips, worktrees, branches };
}

async function head(dir: string): Promise<string> {
  return (await git(dir).run(["rev-parse", "HEAD"])).trim();
}

describe("reconcileLeaseWorktrees (git level, two files)", () => {
  test("each file is restored to ITS OWN keyed commit; no lease branch is repointed; nothing is lost", async () => {
    const { repo, tips, worktrees, branches } = await twoDirtyLeases(1);
    expect(tips[MONEY]).not.toBe(tips[CUSTOMER]);
    const out = capture();

    const { failures } = await reconcileLeaseWorktrees({ dir: repo, epoch: 2, files: [MONEY, CUSTOMER] }, out);
    expect(failures).toBe(0);

    for (const file of [MONEY, CUSTOMER]) {
      expect(await head(worktrees[file]!)).toBe(tips[file]!);
      expect((await git(worktrees[file]!).run(["status", "--porcelain"])).trim()).toBe("");
      // the lease branch still points at this file's own keyed commit
      expect((await git(repo).run(["rev-parse", branches[file]!])).trim()).toBe(tips[file]!);
      expect((await findCommitByOpId(repo, operationId(file, 1)))?.sha).toBe(tips[file]!);
    }
    const money = out.lines.find((l) => l.includes(MONEY));
    const customer = out.lines.find((l) => l.includes(CUSTOMER));
    expect(money).toContain(`keyed=${tips[MONEY]}`);
    expect(money).toContain(worktrees[MONEY]!);
    expect(customer).toContain(`keyed=${tips[CUSTOMER]}`);
    expect(customer).toContain(worktrees[CUSTOMER]!);
  });

  test("the previous epoch is not hard-coded to epoch-1: a bump 1 -> 5 still finds the lease", async () => {
    const { repo, tips, worktrees } = await twoDirtyLeases(1);
    const out = capture();
    const { failures } = await reconcileLeaseWorktrees({ dir: repo, epoch: 5, files: [MONEY, CUSTOMER] }, out);
    expect(failures).toBe(0);
    expect(out.lines.some((l) => l.includes("no live lease worktree"))).toBe(false);
    for (const file of [MONEY, CUSTOMER]) {
      expect(await head(worktrees[file]!)).toBe(tips[file]!);
      expect((await git(worktrees[file]!).run(["status", "--porcelain"])).trim()).toBe("");
    }
  });

  test("a file with no lease below the requested epoch is reported, not reconciled against another file's worktree", async () => {
    const { repo, worktrees } = await twoDirtyLeases(1);
    const out = capture();
    // epoch 1 requested: leases at epoch 1 are not "below" it.
    const { failures } = await reconcileLeaseWorktrees({ dir: repo, epoch: 1, files: [MONEY] }, out);
    expect(failures).toBe(0);
    expect(out.lines.join("\n")).toContain("no live lease worktree");
    // untouched: still dirty
    expect((await git(worktrees[MONEY]!).run(["status", "--porcelain"])).trim()).not.toBe("");
  });
});

describe("selectLeaseWorktree (pure)", () => {
  const leaseRef = (file: string, epoch: number, parent = "/out/.worktrees"): WorktreeRef => {
    const safe = sanitizePathSegment(file);
    return { path: `${parent}/${safe}-${epoch}`, branch: `lease/${safe}/${epoch}` };
  };

  test("matches the file's own lease exactly, regardless of listing order", () => {
    const list = [leaseRef(CUSTOMER, 1), leaseRef(MONEY, 1)];
    expect(selectLeaseWorktree(list, MONEY, 2)?.worktree.branch).toBe(leaseRef(MONEY, 1).branch);
    expect(selectLeaseWorktree(list, CUSTOMER, 2)?.worktree.branch).toBe(leaseRef(CUSTOMER, 1).branch);
    expect(selectLeaseWorktree([leaseRef(CUSTOMER, 1)], MONEY, 2)).toBeUndefined();
  });

  test("picks the highest epoch strictly below the requested one", () => {
    const list = [leaseRef(MONEY, 1), leaseRef(MONEY, 3), leaseRef(MONEY, 7)];
    expect(selectLeaseWorktree(list, MONEY, 5)?.epoch).toBe(3);
    expect(selectLeaseWorktree(list, MONEY, 3)?.epoch).toBe(1);
    expect(selectLeaseWorktree(list, MONEY, 1)).toBeUndefined();
    expect(selectLeaseWorktree(list, MONEY, 99)?.epoch).toBe(7);
  });

  test("a `-1` inside the hash or a parent directory never selects a worktree", () => {
    // Parent dir contains `-1`, the OTHER file's hash starts with 1: the old
    // substring predicate matched both for any file.
    const other: WorktreeRef = { path: "/tmp/run-1/.worktrees/src__Other.php-1a2b3c-7", branch: null };
    const list = [other, leaseRef(CUSTOMER, 9, "/tmp/run-1/.worktrees")];
    expect(selectLeaseWorktree(list, MONEY, 10)).toBeUndefined();
    expect(selectLeaseWorktree(list, CUSTOMER, 10)?.epoch).toBe(9);
  });

  test("a detached worktree is matched by its directory name", () => {
    const safe = sanitizePathSegment(MONEY);
    const detached: WorktreeRef = { path: `/out/.worktrees/${safe}-2`, branch: null };
    expect(selectLeaseWorktree([detached], MONEY, 3)?.epoch).toBe(2);
  });

  test("parseWorktreeList reads branch and detached blocks", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD 1111111111111111111111111111111111111111",
      "branch refs/heads/main",
      "",
      "worktree /repo/.worktrees/src__a.php-abc-1",
      "HEAD 2222222222222222222222222222222222222222",
      "branch refs/heads/lease/src__a.php-abc/1",
      "",
      "worktree /repo/.worktrees/detached-2",
      "HEAD 3333333333333333333333333333333333333333",
      "detached",
      "",
    ].join("\n");
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/repo/.worktrees/src__a.php-abc-1", branch: "lease/src__a.php-abc/1" },
      { path: "/repo/.worktrees/detached-2", branch: null },
    ]);
  });
});

describe("redispatchCommand", () => {
  test("carries --source-root, --prep and --flow-id (real values when passed)", () => {
    const cmd = redispatchCommand({
      dir: "/proj",
      epoch: 2,
      filesArg: "src/A.php,src/B.php",
      sourceRoot: "/src/php",
      prepPath: "/prep/PORTING.md",
      flowId: "demo-2",
      maxRounds: "2",
    });
    expect(cmd).toBe(
      "run-demo.ts demo --dir /proj --epoch 2 --files src/A.php,src/B.php --source-root /src/php --prep /prep/PORTING.md --flow-id demo-2 --max-rounds 2",
    );
  });

  test("placeholders when the operator did not pass them; creatorex implies its own prep/source root", () => {
    const plain = redispatchCommand({ dir: "/proj", epoch: 2, filesArg: "src/A.php" });
    expect(plain).toContain("--source-root <sourceRoot>");
    expect(plain).toContain("--prep <prepPath>");
    expect(plain).toContain("--flow-id <new-flow-id>");
    expect(plain).toContain("--max-rounds <maxRounds>");
    const creatorex = redispatchCommand({ dir: "/proj", epoch: 2, filesArg: "creatorex" });
    expect(creatorex).toContain("--files creatorex");
    expect(creatorex).not.toContain("<sourceRoot>");
    expect(creatorex).not.toContain("<prepPath>");
  });

  test("quotes a path with a space", () => {
    expect(redispatchCommand({ dir: "/my proj", epoch: 2, filesArg: "a.php" })).toContain("--dir '/my proj'");
  });
});

describe("recover-port CLI end to end (stub harness, no dex server needed)", () => {
  test("reconciles two files against their own worktrees, expands --files creatorex, and prints a complete re-dispatch command", async () => {
    const { repo, tips, worktrees } = await twoDirtyLeases(1);
    const run = async (args: string[]) => {
      const proc = Bun.spawn({
        cmd: [process.execPath, "run", RUN_DEMO, "recover-port", "--dir", repo, "--harness", "stub", ...args],
        stdout: "pipe",
        stderr: "pipe",
      });
      const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
      return { code, stdout };
    };

    const two = await run([
      "--epoch", "2",
      "--files", `${MONEY},${CUSTOMER}`,
      "--source-root", "/src/php",
      "--prep", "/prep/PORTING.md",
      "--flow-id", "demo-recovered",
    ]);
    expect(two.code).toBe(0);
    for (const file of [MONEY, CUSTOMER]) {
      expect(await head(worktrees[file]!)).toBe(tips[file]!);
      expect((await git(worktrees[file]!).run(["status", "--porcelain"])).trim()).toBe("");
    }
    expect(two.stdout).toContain("--source-root /src/php");
    expect(two.stdout).toContain("--prep /prep/PORTING.md");
    expect(two.stdout).toContain("--flow-id demo-recovered");

    const creatorex = await run(["--epoch", "2", "--files", "creatorex"]);
    expect(creatorex.code).toBe(0);
    // expanded to the 10 fixture files (none has a lease here)
    expect(creatorex.stdout.match(/no live lease worktree/g)?.length).toBe(10);
    expect(creatorex.stdout).toContain("--files creatorex");
  });
});
