/**
 * B11 / B14 / C3: the two recovery commands of run-demo.
 *
 * - `recover` resolves a relative `--dir` (it used to build the lease worktree
 *   path from the raw string and die inside git with a misleading ENOENT after
 *   leaving a stray nested worktree), takes `--file`, `--round` and `--harness`
 *   as real options with env defaults, and rejects a malformed RECOVER_ROUND
 *   instead of dispatching the op-ID "<file>#NaN";
 * - `recover-port` requires `--files`: with none it reconciled nothing and
 *   still printed `done (failures=0)` and exited 0.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CLI_EXIT } from "../src/cli/args.js";
import { makeFixtureRepo } from "../src/git/fixture.js";
import { parseRunDemoArgs } from "../scripts/run-demo.js";
import { isolatedEnv } from "./support/env.js";
import { REPO_ROOT } from "./support/paths.js";

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

async function runDemo(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  const proc = Bun.spawn({
    cmd: [process.execPath, "run", RUN_DEMO, ...args],
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    // Nothing listens at that dex address: a command that gets as far as dex fails with ECONNREFUSED.
    env: isolatedEnv({ DEX_SERVER_ADDRESS: "127.0.0.1:1", ...opts.env }),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("recover: options (B11)", () => {
  const parse = (...flags: string[]) => parseRunDemoArgs(["recover", "--dir", "/p", ...flags]);

  test("--file, --round and --harness are real options", () => {
    const parsed = parse("--file", "src/b.php", "--round", "3", "--harness", "stub");
    if (!parsed.ok || parsed.command !== "recover") throw new Error("expected a recover parse");
    expect(parsed.options).toMatchObject({ file: "src/b.php", round: 3, harness: "stub", epoch: 2 });
  });

  test("absent, they are undefined here (the environment, then the default, fill them in)", () => {
    const parsed = parse();
    if (!parsed.ok || parsed.command !== "recover") throw new Error("expected a recover parse");
    expect([parsed.options.file, parsed.options.round, parsed.options.harness]).toEqual([undefined, undefined, undefined]);
  });

  test("a bad --round or --harness is a usage error, not a coerced value", () => {
    for (const flags of [["--round", "abc"], ["--round", "0"], ["--harness", "weird"]]) {
      const parsed = parse(...flags);
      expect(parsed.ok).toBe(false);
    }
  });
});

describe("recover: a relative --dir (B11)", () => {
  test("is resolved: recovery reaches the reconcile step in the repository, and leaves no nested worktree behind", async () => {
    const parent = await tmp("recover-reldir-");
    await makeFixtureRepo(join(parent, "repo"));
    // cwd is the PARENT and --dir is relative, so only an absolute path names the repository.
    const { code, stdout, stderr } = await runDemo(["recover", "--dir", "./repo", "--harness", "stub", "--epoch", "2"], { cwd: parent });
    expect(stdout).toContain("[recover] epoch bump → 2; target src/a.php round 1");
    expect(stdout).toContain("[recover] reconcile=");
    // It stops at dex (nothing listens), not inside git.
    expect(code).toBe(1);
    expect(stderr).not.toContain("posix_spawn 'git'");
    expect(stderr).not.toContain("git status --porcelain failed");
    expect(await stat(join(parent, "repo", "repo")).then(() => true, () => false)).toBe(false);
    expect(await stat(join(parent, "repo", ".worktrees")).then(() => true, () => false)).toBe(true);
  }, 30_000);
});

describe("recover: RECOVER_ROUND and RECOVER_FILE (B11, C3)", () => {
  test("a malformed RECOVER_ROUND is a usage error before anything is touched", async () => {
    const parent = await tmp("recover-badround-");
    await makeFixtureRepo(join(parent, "repo"));
    for (const bad of ["abc", "0", "1.5", "2x"]) {
      const { code, stdout, stderr } = await runDemo(["recover", "--dir", join(parent, "repo"), "--harness", "stub"], {
        env: { RECOVER_ROUND: bad },
      });
      expect(code).toBe(CLI_EXIT.usage);
      expect(stderr).toContain(`RECOVER_ROUND must be a whole number >= 1 (got "${bad}")`);
      expect(stdout).not.toContain("[recover]");
    }
    expect(await stat(join(parent, "repo", ".worktrees")).then(() => true, () => false)).toBe(false);
  }, 30_000);

  test("the flags win over the environment, and the environment over the defaults", async () => {
    const parent = await tmp("recover-envflags-");
    await makeFixtureRepo(join(parent, "repo"));
    const dir = join(parent, "repo");
    const fromEnv = await runDemo(["recover", "--dir", dir, "--harness", "stub"], {
      env: { RECOVER_FILE: "src/env.php", RECOVER_ROUND: "4" },
    });
    expect(fromEnv.stdout).toContain("target src/env.php round 4");
    const fromFlags = await runDemo(["recover", "--dir", dir, "--harness", "stub", "--file", "src/flag.php", "--round", "5"], {
      env: { RECOVER_FILE: "src/env.php", RECOVER_ROUND: "4" },
    });
    expect(fromFlags.stdout).toContain("target src/flag.php round 5");
  }, 60_000);
});

describe("recover-port requires --files (B14)", () => {
  test("omitting --files is a usage error naming the flag", async () => {
    const { code, stderr } = await runDemo(["recover-port", "--dir", "/some/repo", "--epoch", "2", "--harness", "stub"]);
    expect(code).toBe(CLI_EXIT.usage);
    expect(stderr).toContain("--files is required");
  });

  test("a --files value that names no file (`,`) is a usage error too, and reconciles nothing", async () => {
    const parent = await tmp("recover-port-nofiles-");
    await makeFixtureRepo(join(parent, "repo"));
    const { code, stdout, stderr } = await runDemo(
      ["recover-port", "--dir", join(parent, "repo"), "--epoch", "2", "--harness", "stub", "--files", ","],
    );
    expect(code).toBe(CLI_EXIT.usage);
    expect(stderr).toContain("--files names no files");
    expect(stdout).not.toContain("done (failures=0)");
  }, 30_000);
});
