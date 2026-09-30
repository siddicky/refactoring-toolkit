/**
 * Minimal git CLI runner shared by the toolkit-owned git steps.
 * Agents never call this module — only toolkit code does (sole-committer rule).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** Bound applied to every git exec (see the hardening note in {@link git}). */
export const GIT_TIMEOUT_MS = 30_000;

/**
 * Structured facts about a failed git exec, taken from node's execFile error.
 * `stderr`/`stdout` are always strings (never undefined).
 */
export interface GitFailure {
  stdout: string;
  stderr: string;
  /** Process exit code; null when the process was killed or never spawned. */
  exitCode: number | null;
  /** Terminating signal, when the process was killed by one. */
  signal: string | null;
  /** True when the exec timeout killed the process. */
  timedOut: boolean;
  /** The timeout that applied (ms); used to word the timed-out diagnosis. */
  timeoutMs: number;
  /** Node system/spawn error code (ENOENT, ERR_CHILD_PROCESS_STDIO_MAXBUFFER...); null otherwise. */
  spawnError: string | null;
  /** The raw error message (kept as the last-resort diagnostic). */
  message: string;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return "";
}

/** Normalizes whatever execFile threw into {@link GitFailure}. */
export function classifyExecError(err: unknown, timeoutMs: number = GIT_TIMEOUT_MS): GitFailure {
  const e = (typeof err === "object" && err !== null ? err : {}) as {
    stdout?: unknown;
    stderr?: unknown;
    code?: unknown;
    killed?: unknown;
    signal?: unknown;
    message?: unknown;
  };
  const code = e.code;
  const spawnError = typeof code === "string" ? code : null;
  return {
    stdout: asText(e.stdout),
    stderr: asText(e.stderr),
    exitCode: typeof code === "number" ? code : null,
    signal: typeof e.signal === "string" ? e.signal : null,
    // execFile's own timeout kill: killed with a null exit code. A string code
    // (spawn failure / maxBuffer) is a different failure, never a timeout.
    timedOut: e.killed === true && spawnError === null,
    timeoutMs,
    spawnError,
    message: typeof e.message === "string" ? e.message : String(err),
  };
}

/**
 * Human-readable cause for a failed git exec. stderr wins, then stdout (git
 * writes merge `CONFLICT ...` lines to stdout), then the raw message; the
 * exit code / timeout / signal facts are appended so a timeout (where node
 * leaves stderr empty) still says what happened.
 */
export function describeGitFailure(f: GitFailure): string {
  const text = f.stderr.trim() || f.stdout.trim();
  const facts: string[] = [];
  if (f.timedOut) facts.push(`timed out after ${f.timeoutMs}ms`);
  if (f.signal !== null) facts.push(`killed by ${f.signal}`);
  if (f.exitCode !== null) facts.push(`exit ${f.exitCode}`);
  if (f.spawnError !== null) facts.push(f.spawnError);
  if (text.length === 0) return facts.length > 0 ? facts.join(", ") : f.message.trim();
  return facts.length > 0 ? `${text} (${facts.join(", ")})` : text;
}

export class GitError extends Error {
  readonly args: readonly string[];
  /** Captured stderr (may be empty; `message` carries the full diagnosis). */
  readonly stderr: string;
  readonly stdout: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** `detail` is either a pre-built cause string or the structured exec failure. */
  constructor(args: readonly string[], detail: string | GitFailure, cause?: unknown) {
    const failure = typeof detail === "string" ? undefined : detail;
    const text = failure === undefined ? (detail as string) : describeGitFailure(failure);
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
  failure: GitFailure | null;
}

export interface GitRunner {
  readonly cwd: string;
  /** Runs `git <args>` and returns stdout; throws GitError on non-zero exit. */
  run(args: readonly string[]): Promise<string>;
  /** Runs `git <args>`, returning stdout and whether the exit code was zero. */
  tryRun(args: readonly string[]): Promise<TryRunResult>;
}

export interface GitOptions {
  /** Per-exec timeout in ms; defaults to {@link GIT_TIMEOUT_MS}. */
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
  const execOpts = { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs } as const;
  return {
    cwd,
    async run(args) {
      try {
        const { stdout } = await execFileP("git", [...args], execOpts);
        return stdout;
      } catch (err) {
        throw new GitError(args, classifyExecError(err, timeoutMs), err);
      }
    },
    async tryRun(args) {
      try {
        const { stdout } = await execFileP("git", [...args], execOpts);
        return { ok: true, stdout, stderr: "", exitCode: 0, timedOut: false, spawnError: null, failure: null };
      } catch (err) {
        const f = classifyExecError(err, timeoutMs);
        return {
          ok: false,
          stdout: f.stdout,
          stderr: f.stderr.trim().length > 0 ? f.stderr : describeGitFailure(f),
          exitCode: f.exitCode,
          timedOut: f.timedOut,
          spawnError: f.spawnError,
          failure: f,
        };
      }
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
