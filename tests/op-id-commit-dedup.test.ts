import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PortProjectFlow, ppMarker, type FileRoundInput } from "../flows/port-project.js";
import { git } from "../src/git/exec.js";
import { makeFixtureRepo } from "../src/git/fixture.js";
import {
  InMemoryLeaseStore,
  WorktreePool,
  applyReconcile,
  commitLeaseChanges,
  commitObjectReadable,
  findCommitByOpId,
  isWorktreeClean,
  mergeLeaseIntoIntegration,
  operationId,
  reconcile,
} from "../src/git/worktree.js";

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function setup(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "porting-kit-opid-"));
  await makeFixtureRepo(root);
  return root;
}

const FILE = "src/a.php";
const OP = operationId(FILE, 1);

async function writeWorktreeFile(wt: string, content: string): Promise<void> {
  await mkdir(join(wt, "src"), { recursive: true });
  await writeFile(join(wt, "src", "a.php"), content);
}

describe("op-ID seam — 0(d) crash window, 0(d2) stale writer, 0(d3) quarantine replay", () => {
  test("0d: commit lands once; replay finds the same keyed commit", async () => {
    const repo = await setup();
    const pool = new WorktreePool(repo, join(repo, ".worktrees"), new InMemoryLeaseStore(), 2);
    const acquired = await pool.acquire(FILE, 1, "run-1");
    if (!acquired.acquired) throw new Error(acquired.reason);
    const lease = acquired.lease;

    await writeWorktreeFile(lease.worktreePath, "<?php\n// v1\n");
    const first = await commitLeaseChanges(lease.worktreePath, OP, "round 1");
    if (first.sha === null) throw new Error("expected a keyed commit");
    expect(first.disposition).toBe(`committed:${OP}`);

    const keyed = await findCommitByOpId(repo, OP);
    expect(keyed?.sha).toBe(first.sha);

    // The lookup is over commit history (trailers), independent of the worktree state.
    await writeWorktreeFile(lease.worktreePath, "<?php\n// v1\n// redo attempt\n");
    const keyedAgain = await findCommitByOpId(repo, OP);
    expect(keyedAgain?.sha).toBe(first.sha);
  });

  test("0d (crash window): the process dies AFTER the keyed commit lands and BEFORE the completion marker persists; the replay dedups", async () => {
    const repo = await setup();
    const pool = new WorktreePool(repo, join(repo, ".worktrees"), new InMemoryLeaseStore(), 2);
    const acquired = await pool.acquire(FILE, 1, "run-1");
    if (!acquired.acquired) throw new Error(acquired.reason);
    const lease = acquired.lease;
    const fri: FileRoundInput = {
      repoRoot: repo,
      worktreeRoot: join(repo, ".worktrees"),
      integrationWorktreePath: join(repo, ".worktrees", "integration"),
      sourceRoot: join(repo, "php"),
      epoch: 1,
      file: FILE,
      round: 1,
      worktreePath: lease.worktreePath,
      branch: lease.branch,
    };
    const commitStep = new PortProjectFlow().commit;
    const markers = new Map<string, unknown>();
    const ctxWith = (crashOnMarker: boolean): never =>
      ({
        attempt: crashOnMarker ? 1 : 2,
        flowId: "opid-crash-window",
        getAttribute: () => undefined,
        setAttribute: (attr: unknown, value: unknown, instance: string) => {
          if (attr !== ppMarker) return; // envelope events etc.: staged, irrelevant here
          if (crashOnMarker) throw new Error("simulated SIGKILL: marker write never persisted");
          markers.set(instance, value);
        },
      }) as never;

    // Attempt 1: the implementer's output is committed, then the step dies
    // at the marker write.
    await writeWorktreeFile(lease.worktreePath, "<?php\n// v1\n");
    await expect(commitStep.execute(ctxWith(true), fri as never)).rejects.toThrow(/simulated SIGKILL/);
    const landed = await findCommitByOpId(repo, OP);
    expect(landed).toBeDefined(); // the commit IS in git...
    expect(markers.size).toBe(0); // ...and no marker was persisted: the crash window.

    // Attempt 2 (dex re-dispatch): a stale/redone writer left different
    // uncommitted content in the worktree. The replay must NOT commit again.
    await writeWorktreeFile(lease.worktreePath, "<?php\n// v1\n// redo attempt\n");
    const decision = await commitStep.execute(ctxWith(false), fri as never);
    expect(decision.kind).toBe("next");

    const opIdCommits = (await git(repo).run(["log", "--all", "--grep", `Operation-ID: ${OP}`, "--format=%H"]))
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(opIdCommits).toEqual([landed?.sha ?? "missing"]); // exactly one commit carries the op id
    const marker = markers.get("src__a.php#1") as { disposition: string; sha?: string | null } | undefined;
    expect(marker?.disposition).toBe(`committed:${OP}`);
    expect(marker?.sha).toBe(landed?.sha ?? null); // backfilled from the keyed commit
  });

  test("0d2: stale writer dirties worktree after commit; reset preserves the keyed commit at HEAD", async () => {
    const repo = await setup();
    const pool = new WorktreePool(repo, join(repo, ".worktrees"), new InMemoryLeaseStore(), 2);
    const acquired = await pool.acquire(FILE, 1, "run-1");
    if (!acquired.acquired) throw new Error(acquired.reason);
    const lease = acquired.lease;

    await writeWorktreeFile(lease.worktreePath, "<?php\n// v1\n");
    const first = await commitLeaseChanges(lease.worktreePath, OP, "round 1");
    if (first.sha === null) throw new Error("expected a keyed commit");
    const keyed = (await findCommitByOpId(repo, OP)) ?? (() => { throw new Error("keyed missing"); })();

    // Stale writer dirties the worktree.
    await writeWorktreeFile(lease.worktreePath, "STALE WRITER JUNK\n");
    expect(await isWorktreeClean(lease.worktreePath)).toBe(false);

    const readable = await commitObjectReadable(repo, keyed.sha);
    const action = reconcile({
      marker: undefined,
      keyed,
      worktree: { clean: false, commitObjectReadable: readable },
    });
    expect(action.kind).toBe("skipped");
    await applyReconcile(lease, action, keyed);

    expect(await isWorktreeClean(lease.worktreePath)).toBe(true);
    const head = (await git(lease.worktreePath).run(["rev-parse", "HEAD"])).trim();
    expect(head).toBe(first.sha);
  });

  test("0d3: differing-content replay across a quarantined lease keeps op-ID dedup; divergence is detectable", async () => {
    const repo = await setup();
    const pool = new WorktreePool(repo, join(repo, ".worktrees"), new InMemoryLeaseStore(), 2);
    const a1 = await pool.acquire(FILE, 1, "run-1");
    if (!a1.acquired) throw new Error(a1.reason);
    await writeWorktreeFile(a1.lease.worktreePath, "<?php\n// v1 original\n");
    const first = await commitLeaseChanges(a1.lease.worktreePath, OP, "round 1");
    if (first.sha === null) throw new Error("expected a keyed commit");

    // Quarantine: release (worktree removed), branch + object retained.
    await pool.release(FILE);
    await expect(stat(a1.lease.worktreePath)).rejects.toThrow();

    // Spare worktree at a NEW epoch replays the same op-ID with DIFFERENT content.
    const a2 = await pool.acquire(FILE, 2, "run-2");
    if (!a2.acquired) throw new Error(a2.reason);
    await writeWorktreeFile(a2.lease.worktreePath, "<?php\n// v2 DIFFERENT content\n");
    const keyedOnSpare = await findCommitByOpId(repo, OP);
    expect(keyedOnSpare?.sha).toBe(first.sha);

    // The toolkit commit step would take the dedup branch (no second commit).
    // A naive re-commit here must be detectable as divergence for the report:
    const replay = await commitLeaseChanges(a2.lease.worktreePath, OP, "round 1 redo");
    const opIdCount = (await git(repo).run(["log", "--all", "--grep", `Operation-ID: ${OP}`, "--format=%H"]))
      .split("\n").filter((l) => l.trim().length > 0).length;
    expect(opIdCount).toBe(2); // naive double-commit IS detectable via op-ID grep
    expect(replay.contentHash).not.toBe(first.contentHash); // divergence evidence
  });

  test("integration: lease branch merges into one `integration` output branch", async () => {
    const repo = await setup();
    const pool = new WorktreePool(repo, join(repo, ".worktrees"), new InMemoryLeaseStore(), 2);
    const a = await pool.acquire(FILE, 1, "run-1");
    if (!a.acquired) throw new Error(a.reason);
    await writeWorktreeFile(a.lease.worktreePath, "<?php\n// integrated content\n");
    await commitLeaseChanges(a.lease.worktreePath, OP, "round 1");

    const result = await mergeLeaseIntoIntegration(
      repo,
      join(repo, ".worktrees", "integration"),
      a.lease.branch,
    );
    expect(result.alreadyIntegrated).toBe(false);

    // Idempotent replay of the same merge.
    const again = await mergeLeaseIntoIntegration(
      repo,
      join(repo, ".worktrees", "integration"),
      a.lease.branch,
    );
    expect(again.alreadyIntegrated).toBe(true);
    expect(again.sha).toBe(result.sha);

    const cat = git(join(repo, ".worktrees", "integration"));
    const out = await cat.run(["show", `HEAD:${FILE}`]);
    expect(out).toContain("integrated content");
  });

  test("leasing: cap enforced at the pool; stale-epoch leases reclaimable", async () => {
    const repo = await setup();
    const store = new InMemoryLeaseStore();
    const pool = new WorktreePool(repo, join(repo, ".worktrees"), store, 2);
    const f1 = "src/a.php";
    const f2 = "src/b.php";
    const f3 = "src/c.php";

    const a1 = await pool.acquire(f1, 1, "r1");
    const a2 = await pool.acquire(f2, 1, "r1");
    expect(a1.acquired).toBe(true);
    expect(a2.acquired).toBe(true);
    const a3 = await pool.acquire(f3, 1, "r1");
    expect(a3.acquired).toBe(false); // cap of 2 reached

    // Stale epoch record is reclaimed by a same-file acquire at a bumped epoch.
    const bumped = await pool.acquire(f1, 2, "r2");
    if (!bumped.acquired) throw new Error(bumped.reason);
    expect(bumped.lease.epoch).toBe(2);
    expect(store.get(f1)?.holderExecutionId).toBe("r2");
  });
});
