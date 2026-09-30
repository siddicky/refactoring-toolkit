/**
 * C30 — git failures keep their diagnostic detail.
 *
 * Before: `GitError(args, e.stderr ?? e.message)` never fell back (execFile
 * sets stderr to "" rather than undefined), so a stdout-only failure (merge
 * CONFLICT lines) or a timeout produced `git <args> failed: ` with no cause,
 * and tryRun could not tell "no" from timeout/fatal.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describeError } from "../src/dashboard/queries.js";
import { GitError, git, gitPredicate } from "../src/git/exec.js";

const execFileP = promisify(execFile);

const tmpDirs: string[] = [];
const savedPath = process.env.PATH;

afterEach(async () => {
  process.env.PATH = savedPath;
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** Puts a fake `git` that hangs on the PATH so the exec timeout fires. */
async function installHangingGit(): Promise<void> {
  const bin = await tmp("fake-git-bin-");
  const script = join(bin, "git");
  // exec: the sleep replaces the shell so the timeout's SIGTERM kills the
  // process that owns the stdio pipes (no orphaned grandchild).
  await writeFile(script, "#!/bin/sh\nexec sleep 5\n");
  await chmod(script, 0o755);
  process.env.PATH = `${bin}:${savedPath ?? ""}`;
}

describe("GitError keeps the cause", () => {
  test("a stdout-only failure (diff --no-index prints the diff to stdout, exit 1) is not blank", async () => {
    const dir = await tmp("git-exec-stdout-");
    await writeFile(join(dir, "a.txt"), "one\n");
    await writeFile(join(dir, "b.txt"), "two\n");
    let caught: unknown;
    try {
      await git(dir).run(["diff", "--no-index", "--exit-code", "a.txt", "b.txt"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitError);
    const err = caught as GitError;
    expect(err.stderr.trim()).toBe(""); // the repro premise: nothing on stderr
    expect(err.message).toContain("+two"); // the stdout diagnostic survives
    expect(err.message).toContain("exit 1");
    expect(err.exitCode).toBe(1);
    expect(err.stdout).toContain("-one");
  });

  test("stderr still wins when present", async () => {
    const dir = await tmp("git-exec-stderr-");
    let caught: unknown;
    try {
      await git(dir).run(["-C", join(dir, "missing"), "log"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitError);
    expect((caught as GitError).message).toContain("cannot change to");
    expect((caught as GitError).exitCode).toBe(128);
  });

  test("a timeout names the timeout and the signal instead of an empty message", async () => {
    await installHangingGit();
    const dir = await tmp("git-exec-timeout-");
    let caught: unknown;
    try {
      await git(dir, { timeoutMs: 200 }).run(["log", "--all"]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(GitError);
    const err = caught as GitError;
    expect(err.timedOut).toBe(true);
    expect(err.message).toContain("timed out after 200ms");
    expect(err.message).toContain("SIGTERM");
    expect(err.message.endsWith("failed: ")).toBe(false);
  });
});

describe("tryRun reports why it failed", () => {
  test("a non-zero exit carries exitCode; a timeout sets timedOut and a non-empty stderr", async () => {
    const dir = await tmp("git-exec-tryrun-");
    await git(dir).run(["init", "-q", "-b", "main"]);
    const no = await git(dir).tryRun(["rev-parse", "--verify", "--quiet", "refs/heads/absent"]);
    expect(no.ok).toBe(false);
    expect(no.exitCode).toBe(1);
    expect(no.timedOut).toBe(false);
    expect(no.spawnError).toBeNull();

    await installHangingGit();
    const hung = await git(dir, { timeoutMs: 200 }).tryRun(["status"]);
    expect(hung.ok).toBe(false);
    expect(hung.timedOut).toBe(true);
    expect(hung.exitCode).toBeNull();
    expect(hung.stderr).toContain("timed out");
  });

  test("gitPredicate: documented exit code is false, a timeout or fatal exit throws", async () => {
    const dir = await tmp("git-exec-predicate-");
    await git(dir).run(["init", "-q", "-b", "main"]);
    // exit 1 = documented "no"
    expect(await gitPredicate(git(dir), ["rev-parse", "--verify", "--quiet", "refs/heads/absent"])).toBe(false);
    // exit 128 (fatal: not a valid object) is NOT a "no" unless the caller says so
    await expect(
      gitPredicate(git(dir), ["merge-base", "--is-ancestor", "deadbeef".repeat(5), "HEAD"]),
    ).rejects.toBeInstanceOf(GitError);
    expect(
      await gitPredicate(git(dir), ["cat-file", "-e", `${"0".repeat(40)}^{commit}`], [1, 128]),
    ).toBe(false);

    await installHangingGit();
    const hungErr = await gitPredicate(git(dir, { timeoutMs: 200 }), ["diff", "--quiet"]).catch((e) => e);
    expect(hungErr).toBeInstanceOf(GitError);
    expect((hungErr as GitError).timedOut).toBe(true);
    // never reads a timeout as the documented "no"
    await expect(
      gitPredicate(git(dir, { timeoutMs: 200 }), ["diff", "--quiet"], [1, 128]),
    ).rejects.toBeInstanceOf(GitError);
  });
});

describe("dashboard describeError keeps the actionable part of execFile failures", () => {
  test("non-zero exit: first stderr line, no argv echo", async () => {
    const e = await execFileP("git", ["-C", "/nonexistent-dir-xyz", "log", "--pretty=%H\x1f%h\x1e"]).catch(
      (err: unknown) => err,
    );
    const msg = describeError(e);
    expect(msg).toContain("cannot change to");
    expect(msg).toContain("exited 128");
    expect(msg).not.toContain("Command failed");
    expect(msg).not.toContain("\x1f");
    expect(msg).not.toContain("\x1e");
  });

  test("timeout: says it timed out rather than echoing the command", async () => {
    const e = await execFileP("sleep", ["5"], { timeout: 100 }).catch((err: unknown) => err);
    const msg = describeError(e);
    expect(msg).toContain("timed out");
    expect(msg).toContain("SIGTERM");
    expect(msg).not.toContain("sleep 5");
  });

  test("spawn failure and plain errors keep their own message", async () => {
    const enoent = await execFileP("definitely-not-a-binary-xyz", []).catch((err: unknown) => err);
    expect(describeError(enoent)).toContain("definitely-not-a-binary-xyz");
    expect(describeError(new Error("boom\nsecond line"))).toBe("boom");
    expect(describeError("plain")).toBe("plain");
  });
});
