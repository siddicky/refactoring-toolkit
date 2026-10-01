/**
 * Minimal git CLI runner shared by the toolkit-owned git steps, built on the
 * shared process runner (src/exec.ts: timeout, maxBuffer, stdout/stderr kept).
 * Agents never call this module — only toolkit code does (sole-committer rule).
 */

import { describeExecFailure, execToolResult, type ExecFailure } from "../exec.js";

/** Bound applied to every git exec (see the hardening note in {@link git}). */
const GIT_TIMEOUT_MS = 30_000;

export class GitError extends Error {
  readonly args: readonly string[];
  /** Captured stderr (may be empty; `message` carries the full diagnosis). */
  readonly stderr: string;
  readonly stdout: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** `detail` is either a pre-built cause string or the structured exec failure. */
  constructor(args: readonly string[], detail: string | ExecFailure, cause?: unknown) {
    const failure = typeof detail === "string" ? undefined : detail;
    const text = failure === undefined ? (detail as string) : describeExecFailure(failure);
    super(`git ${args.join(" ")} failed: ${text.trim()}`);
    this.name = "GitError";
    this.args = args;
    this.stderr = failure === undefined ? (detail as string) : failure.stderr;
    this.stdout = failure?.stdout ?? "";
    this.exitCode = failure?.exitCode ?? null;
    this.timedOut = failure?.timedOut ?? false;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Result of {@link GitRunner.tryRun}. `ok` is true only for exit code 0.
 * Callers using tryRun as a boolean predicate should inspect `exitCode` /
 * `timedOut` / `spawnError` and accept only the documented "no" exit codes:
 * a timeout or spawn failure is an error, not a "no".
 */
export interface TryRunResult {
  ok: boolean;
  stdout: string;
  /** Never silently empty on failure: falls back to the failure diagnosis. */
  stderr: string;
  /** 0 on success; the exit code on a non-zero exit; null when killed / not spawned. */
  exitCode: number | null;
  timedOut: boolean;
  spawnError: string | null;
  /** The structured failure (null when ok); lets callers raise an exact GitError. */
  failure: ExecFailure | null;
}

export interface GitRunner {
  readonly cwd: string;
  /** Runs `git <args>` and returns stdout; throws GitError on non-zero exit. */
  run(args: readonly string[]): Promise<string>;
  /** Runs `git <args>`, returning stdout and whether the exit code was zero. */
  tryRun(args: readonly string[]): Promise<TryRunResult>;
}

interface GitOptions {
  /** Per-exec timeout in ms; defaults to 30 s. */
  timeoutMs?: number;
}

export function git(cwd: string, options: GitOptions = {}): GitRunner {
  const timeoutMs = options.timeoutMs ?? GIT_TIMEOUT_MS;
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
  const execOpts = { cwd, env, timeoutMs } as const;
  return {
    cwd,
    async run(args) {
      const r = await execToolResult("git", args, execOpts);
      if (r.ok) return r.stdout;
      throw new GitError(args, r.failure, r.cause);
    },
    async tryRun(args) {
      const r = await execToolResult("git", args, execOpts);
      if (r.ok) {
        return { ok: true, stdout: r.stdout, stderr: "", exitCode: 0, timedOut: false, spawnError: null, failure: null };
      }
      const f = r.failure;
      return {
        ok: false,
        stdout: f.stdout,
        stderr: f.stderr.trim().length > 0 ? f.stderr : describeExecFailure(f),
        exitCode: f.exitCode,
        timedOut: f.timedOut,
        spawnError: f.spawnError,
        failure: f,
      };
    },
  };
}

/**
 * Runs a git command used as a yes/no predicate. Exit 0 is true; an exit code
 * in `falseExitCodes` (the command's documented "no", default 1) is false;
 * anything else - a timeout, a spawn failure, exit 128 "fatal" - throws a
 * GitError instead of being silently read as "no".
 */
export async function gitPredicate(
  runner: GitRunner,
  args: readonly string[],
  falseExitCodes: readonly number[] = [1],
): Promise<boolean> {
  const r = await runner.tryRun(args);
  if (r.ok) return true;
  if (!r.timedOut && r.spawnError === null && r.exitCode !== null && falseExitCodes.includes(r.exitCode)) {
    return false;
  }
  throw new GitError(args, r.failure ?? r.stderr);
}
