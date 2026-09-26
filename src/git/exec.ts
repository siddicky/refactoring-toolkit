/**
 * Minimal git CLI runner shared by the toolkit-owned git steps.
 * Agents never call this module — only toolkit code does (sole-committer rule).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

export class GitError extends Error {
  readonly args: readonly string[];
  readonly stderr: string;
  constructor(args: readonly string[], stderr: string, cause?: unknown) {
    super(`git ${args.join(" ")} failed: ${stderr.trim()}`);
    this.name = "GitError";
    this.args = args;
    this.stderr = stderr;
    if (cause !== undefined) this.cause = cause;
  }
}

export interface GitRunner {
  readonly cwd: string;
  /** Runs `git <args>` and returns stdout; throws GitError on non-zero exit. */
  run(args: readonly string[]): Promise<string>;
  /** Runs `git <args>`, returning stdout and whether the exit code was zero. */
  tryRun(args: readonly string[]): Promise<{ ok: boolean; stdout: string; stderr: string }>;
}

export function git(cwd: string): GitRunner {
  // Fresh fixture repos (tests, probes) have no git identity; default it so
  // commits never fail on author/committer configuration alone.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? "porting-toolkit",
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? "toolkit@localhost",
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? "porting-toolkit",
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? "toolkit@localhost",
  };
  // Tier-1 hardening (takeaways-synthesis #4): every git exec is bounded by a
  // 30s timeout so a hung git (e.g. credential prompt, locked index on a
  // killed worktree) fails fast instead of silently burning step heartbeats
  // until dex fails the attempt on the heartbeat timeout.
  const execOpts = { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout: 30_000 } as const;
  return {
    cwd,
    async run(args) {
      try {
        const { stdout } = await execFileP("git", [...args], execOpts);
        return stdout;
      } catch (err) {
        const e = err as { stderr?: string; message: string };
        throw new GitError(args, e.stderr ?? e.message, err);
      }
    },
    async tryRun(args) {
      try {
        const { stdout } = await execFileP("git", [...args], execOpts);
        return { ok: true, stdout, stderr: "" };
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        return { ok: false, stdout: e.stdout ?? "", stderr: e.stderr ?? e.message };
      }
    },
  };
}
