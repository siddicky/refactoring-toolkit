/**
 * C70 — `demo` / `round` input handling.
 *
 * Before: a nonexistent --dir silently became a throwaway README-only repo
 * (created BEFORE dex connectivity was checked); an existing non-git dir failed
 * later inside worktree code; default --prep/--source-root were cwd-relative;
 * `--files creatorex` expanded to 10 files without switching prep/source root
 * (the flow then failed with "prep source map lacks rows for..." after
 * dispatch); nothing was validated before startFlow.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ensureProjectRepo,
  parseRunDemoArgs,
  preflightDemoInputs,
  resolveDemoInputs,
} from "../scripts/run-demo.js";
import { git } from "../src/git/exec.js";
import { makeFixtureRepo } from "../src/git/fixture.js";

import { REPO_ROOT } from "./support/paths.js";
const FIXTURES = join(REPO_ROOT, "fixtures");
const RUN_DEMO = join(REPO_ROOT, "scripts", "run-demo.ts");
const tmpDirs: string[] = [];

afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

async function exists(p: string): Promise<boolean> {
  return stat(p).then(() => true, () => false);
}

/** Parses `demo <flags>` through the shared layer and resolves the inputs (a usage error throws here). */
function inputsFor(...flags: string[]) {
  const parsed = parseRunDemoArgs(["demo", ...flags]);
  if (!parsed.ok || parsed.command !== "demo") throw new Error(parsed.ok ? "not the demo command" : parsed.error);
  return resolveDemoInputs(parsed.options);
}

/** The usage error for `demo <flags>`. */
function usageError(...flags: string[]): string {
  const parsed = parseRunDemoArgs(["demo", ...flags]);
  if (parsed.ok) throw new Error("expected a usage error");
  return parsed.error;
}

describe("resolveDemoInputs", () => {
  test("defaults resolve from the script location, not the cwd, and are absolute", () => {
    const before = process.cwd();
    const elsewhere = tmpdir();
    process.chdir(elsewhere);
    try {
      const inputs = inputsFor("--dir", "some/relative/dir");
      expect(inputs.prepPath).toBe(join(FIXTURES, "stub-prep.md"));
      expect(inputs.sourceRoot).toBe(join(FIXTURES, "php-sample"));
      expect(inputs.dir.startsWith("/")).toBe(true);
      expect(inputs.dir.endsWith(join("some", "relative", "dir"))).toBe(true);
      expect(inputs.files).toEqual(["src/Money.php", "src/Pricing/FlatRateDiscount.php"]);
      expect(inputs.epoch).toBe(1);
      expect(inputs.maxRounds).toBe(1);
      expect(inputs.waitMinutes).toBe(30);
      expect(inputs.dispatchMode).toBe("parallel");
      expect(inputs.initFixture).toBe(false);
    } finally {
      process.chdir(before);
    }
  });

  test("`--files creatorex` implies the creatorex prep artifact and source root; explicit flags still win", () => {
    const implied = inputsFor("--dir", "/p", "--files", "creatorex");
    expect(implied.files.length).toBe(10);
    expect(implied.prepPath).toBe(join(FIXTURES, "creatorex-middleware", "prep-stub.md"));
    expect(implied.sourceRoot).toBe(join(FIXTURES, "creatorex-middleware"));

    const explicit = inputsFor(
      "--dir", "/p", "--files", "creatorex", "--prep", "/my/prep.md", "--source-root", "/my/src",
    );
    expect(explicit.prepPath).toBe("/my/prep.md");
    expect(explicit.sourceRoot).toBe("/my/src");
  });

  test("--init-fixture is an explicit opt-in flag", () => {
    expect(inputsFor("--dir", "/p", "--init-fixture").initFixture).toBe(true);
  });

  test("numeric and enum flags are validated by the parse (usage errors, never a thrown NaN)", () => {
    expect(usageError()).toContain("--dir is required");
    expect(usageError("--dir", "/p", "--epoch", "abc")).toContain("--epoch must be a whole number >= 1");
    expect(usageError("--dir", "/p", "--max-rounds", "0")).toContain("--max-rounds must be a whole number >= 1");
    expect(usageError("--dir", "/p", "--wait-minutes=-3")).toContain("--wait-minutes must be a whole number >= 1");
    expect(usageError("--dir", "/p", "--dispatch", "weird")).toContain("--dispatch must be one of parallel, sequential");
    const ok = inputsFor("--dir", "/p", "--dispatch", "sequential", "--epoch", "4", "--max-rounds", "2");
    expect([ok.dispatchMode, ok.epoch, ok.maxRounds]).toEqual(["sequential", 4, 2]);
  });

  test("a value flag with no value (last argument, or followed by another flag) is an error, not a swallowed neighbour", () => {
    expect(usageError("--dir", "/p", "--files")).toBe("--files requires a value");
    expect(usageError("--dir", "/p", "--epoch", "--max-rounds", "2")).toContain("--epoch requires a value");
    expect(usageError("--dir")).toBe("--dir requires a value");
  });
});

describe("preflightDemoInputs", () => {
  test("the shipped default and creatorex combinations pass", async () => {
    await preflightDemoInputs(inputsFor("--dir", "/p"));
    await preflightDemoInputs(inputsFor("--dir", "/p", "--files", "creatorex"));
  });

  test("creatorex files against the php-sample prep/source root (the recorded cx-1/cx-2 mistake) fail up front, in ONE message", async () => {
    const inputs = inputsFor(
      "--dir", "/p", "--files", "creatorex", "--prep", join(FIXTURES, "stub-prep.md"), "--source-root", join(FIXTURES, "php-sample"),
    );
    const err = await preflightDemoInputs(inputs).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = (err as Error).message;
    expect(msg).toContain("demo preflight failed");
    expect(msg).toContain("has no source-map row for");
    expect(msg).toContain("src/Access/EntitlementChecker.php");
    expect(msg).toContain("not found under source root");
    // both problems are listed together, each on its own line
    expect(msg.split("\n").filter((l) => l.startsWith("  - ")).length).toBe(2);
  });

  test("an unreadable prep artifact and a missing source root are reported together", async () => {
    const err = await preflightDemoInputs({
      files: ["src/A.php"],
      prepPath: "/definitely/missing/prep.md",
      sourceRoot: "/definitely/missing/src",
    }).catch((e: Error) => e);
    const msg = (err as Error).message;
    expect(msg).toContain("/definitely/missing/prep.md is not readable (ENOENT)");
    expect(msg).toContain("/definitely/missing/src is not a directory");
  });

  test("a file with a prep row but absent on disk is named", async () => {
    const dir = await tmp("demo-preflight-");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "prep.md"), "| `src/Present.php` | `src/present.ts` | |\n| `src/Absent.php` | `src/absent.ts` | |\n");
    await writeFile(join(dir, "src", "Present.php"), "<?php\n");
    const err = await preflightDemoInputs({
      files: ["src/Present.php", "src/Absent.php"],
      prepPath: join(dir, "prep.md"),
      sourceRoot: dir,
    }).catch((e: Error) => e);
    expect((err as Error).message).toContain("not found under source root");
    expect((err as Error).message).toContain("src/Absent.php");
    expect((err as Error).message).not.toContain("no source-map row");
  });
});

describe("ensureProjectRepo", () => {
  test("a nonexistent --dir is an error that names --init-fixture, and nothing is created", async () => {
    const parent = await tmp("demo-repo-missing-");
    const dir = join(parent, "typo-dir");
    await expect(ensureProjectRepo(dir, { initFixture: false })).rejects.toThrow(/does not exist.*--init-fixture/);
    expect(await exists(dir)).toBe(false);
  });

  test("--init-fixture creates the fixture repo for a path that does not exist", async () => {
    const parent = await tmp("demo-repo-init-");
    const dir = join(parent, "fixture");
    expect(await ensureProjectRepo(dir, { initFixture: true })).toBe("created");
    expect((await git(dir).run(["rev-parse", "--verify", "HEAD"])).trim().length).toBe(40);
  });

  test("an existing repository is used as-is and never recreated, even with --init-fixture", async () => {
    const dir = await tmp("demo-repo-existing-");
    await makeFixtureRepo(dir);
    await writeFile(join(dir, "marker.txt"), "keep me\n");
    await git(dir).run(["add", "-A"]);
    await git(dir).run(["commit", "-m", "add marker"]);
    const head = (await git(dir).run(["rev-parse", "HEAD"])).trim();

    expect(await ensureProjectRepo(dir, { initFixture: false })).toBe("existing");
    expect(await ensureProjectRepo(dir, { initFixture: true })).toBe("existing");
    expect(await readFile(join(dir, "marker.txt"), "utf8")).toBe("keep me\n");
    expect((await git(dir).run(["rev-parse", "HEAD"])).trim()).toBe(head);
  });

  test("an existing non-git directory fails with a clear error and is left untouched", async () => {
    const dir = await tmp("demo-repo-plain-");
    await writeFile(join(dir, "precious.txt"), "do not delete\n");
    await expect(ensureProjectRepo(dir, { initFixture: true })).rejects.toThrow(/not a git repository/);
    expect(await readFile(join(dir, "precious.txt"), "utf8")).toBe("do not delete\n");
  });

  test("a subdirectory of a repository is rejected: pass the repository root", async () => {
    const repo = await tmp("demo-repo-sub-");
    await makeFixtureRepo(repo);
    const sub = join(repo, "nested");
    await mkdir(sub);
    await expect(ensureProjectRepo(sub, { initFixture: false })).rejects.toThrow(/pass the repository root/);
  });
});

describe("demo CLI fails before contacting dex or creating anything", () => {
  async function runDemo(args: string[]) {
    const proc = Bun.spawn({
      cmd: [process.execPath, "run", RUN_DEMO, "demo", ...args],
      // A dex address nothing listens on: reaching startFlow would show up as ECONNREFUSED.
      env: { ...process.env, DEX_SERVER_ADDRESS: "127.0.0.1:1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    return { code, stderr };
  }

  test("a typo'd --dir exits 1 with the --init-fixture hint and creates no directory", async () => {
    const parent = await tmp("demo-cli-typo-");
    const dir = join(parent, "typo");
    const { code, stderr } = await runDemo(["--dir", dir]);
    expect(code).toBe(1);
    expect(stderr).toContain("does not exist");
    expect(stderr).toContain("--init-fixture");
    expect(stderr).not.toContain("ECONNREFUSED");
    expect(await exists(dir)).toBe(false);
  });

  test("a prep/source-root mismatch is reported by the preflight (no dex, no repo creation)", async () => {
    const parent = await tmp("demo-cli-preflight-");
    const dir = join(parent, "proj");
    const { code, stderr } = await runDemo([
      "--dir", dir, "--init-fixture", "--files", "src/Nope.php",
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("demo preflight failed");
    expect(stderr).toContain("src/Nope.php");
    expect(await exists(dir)).toBe(false); // preflight runs before --init-fixture creates anything
  });
});
