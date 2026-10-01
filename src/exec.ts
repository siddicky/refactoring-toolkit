/**
 * The one child-process runner of the toolkit. Every place that runs a tool
 * (git, bun, tsc, vitest, pgrep, dexcli) goes through here instead of its own
 * `promisify(execFile)`, so each exec is bounded the same way and a failure
 * keeps what the tool said:
 *
 * - a TIMEOUT (default {@link EXEC_TIMEOUT_MS}) so a hung tool (credential
 *   prompt, locked index, dead server) fails fast instead of burning step
 *   heartbeats until dex fails the attempt;
 * - a MAXBUFFER (default {@link EXEC_MAX_BUFFER}) well above Node's 1 MiB, so a
 *   large diff or a chatty tsc run is not killed for its output size;
 * - failures that PRESERVE stdout and stderr (never undefined) plus the exit
 *   code, signal and whether the timeout killed it; the error message carries
 *   the cause (stderr, else stdout, else the runtime's message). Some tools
 *   report on stdout (`git merge` CONFLICT lines, a diff with exit 1), and
 *   node leaves stderr empty on a timeout, so neither is dropped.
 *
 * Two entry points: `execTool` throws an `ExecError`; `execToolResult` never
 * throws and returns the failure as data (a "no" exit code is an answer, not an
 * error, for tools such as `pgrep`). src/git/exec.ts builds the git runner on
 * top of this module.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/** Default bound on one exec. */
export const EXEC_TIMEOUT_MS = 30_000;

/** Default cap on captured stdout / stderr (each), in bytes. */
export const EXEC_MAX_BUFFER = 64 * 1024 * 1024;

export interface ExecOptions {
  cwd?: string | undefined;
  env?: NodeJS.ProcessEnv | undefined;
  /** Timeout in ms; defaults to {@link EXEC_TIMEOUT_MS}. */
  timeoutMs?: number | undefined;
  /** Cap on captured stdout / stderr in bytes; defaults to {@link EXEC_MAX_BUFFER}. */
  maxBuffer?: number | undefined;
}

/** What a finished child process printed. */
export interface ExecOutput {
  stdout: string;
  stderr: string;
}

/**
 * Structured facts about a failed exec, taken from node's execFile error.
 * `stderr` / `stdout` are always strings (never undefined).
 */
export interface ExecFailure {
  stdout: string;
  stderr: string;
  /** Process exit code; null when the process was killed or never spawned. */
  exitCode: number | null;
  /** Terminating signal, when the process was killed by one. */
  signal: string | null;
  /** True when the exec timeout killed the process. */
  timedOut: boolean;
  /** The runtime's raw `killed` flag: set when the timeout killed the process (Node also sets it for a maxBuffer kill, Bun does not). */
  killed: boolean;
  /** The timeout that applied (ms); used to word the timed-out diagnosis. */
  timeoutMs: number;
  /** Node system/spawn error code (ENOENT, ERR_CHILD_PROCESS_STDIO_MAXBUFFER...); null otherwise. */
  spawnError: string | null;
  /** The raw error message (kept as the last-resort diagnostic). */
  message: string;
}

export type ExecResult =
  | ({ ok: true } & ExecOutput)
  | ({
      ok: false;
      failure: ExecFailure;
      /** The raw error execFile rejected with, for `Error.cause`. */
      cause: unknown;
    } & ExecOutput);

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return Buffer.from(value).toString("utf8");
  return "";
}

/** Normalizes whatever execFile threw into {@link ExecFailure}. */
function classifyExecError(err: unknown, timeoutMs: number = EXEC_TIMEOUT_MS): ExecFailure {
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
    killed: e.killed === true,
    timeoutMs,
    spawnError,
    message: typeof e.message === "string" ? e.message : String(err),
  };
}

/**
 * Human-readable cause for a failed exec. stderr wins, then stdout, then the
 * raw message; the exit code / timeout / signal facts are appended so a
 * timeout (where node leaves stderr empty) still says what happened.
 */
export function describeExecFailure(f: ExecFailure): string {
  const text = f.stderr.trim() || f.stdout.trim();
  const facts: string[] = [];
  if (f.timedOut) facts.push(`timed out after ${f.timeoutMs}ms`);
  if (f.signal !== null) facts.push(`killed by ${f.signal}`);
  if (f.exitCode !== null) facts.push(`exit ${f.exitCode}`);
  if (f.spawnError !== null) facts.push(f.spawnError);
  if (text.length === 0) {
    // A spawn failure (binary missing, maxBuffer) has no output; the runtime's
    // own message says why (e.g. `Executable not found in $PATH`).
    if (f.spawnError !== null) return `${f.message.trim()} (${facts.join(", ")})`;
    return facts.length > 0 ? facts.join(", ") : f.message.trim();
  }
  return facts.length > 0 ? `${text} (${facts.join(", ")})` : text;
}

/** A failed exec: the command, what it printed, and how it ended. */
export class ExecError extends Error {
  readonly bin: string;
  readonly args: readonly string[];
  readonly failure: ExecFailure;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;

  constructor(bin: string, args: readonly string[], failure: ExecFailure, cause?: unknown) {
    super(`${[bin, ...args].join(" ")} failed: ${describeExecFailure(failure).trim()}`);
    this.name = "ExecError";
    this.bin = bin;
    this.args = args;
    this.failure = failure;
    this.stdout = failure.stdout;
    this.stderr = failure.stderr;
    this.exitCode = failure.exitCode;
    this.timedOut = failure.timedOut;
    if (cause !== undefined) this.cause = cause;
  }
}

/** Runs `bin args` to completion and NEVER throws: a failure comes back as `{ ok: false, failure }`. */
export async function execToolResult(
  bin: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  const timeoutMs = options.timeoutMs ?? EXEC_TIMEOUT_MS;
  try {
    const { stdout, stderr } = await execFileP(bin, [...args], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: options.maxBuffer ?? EXEC_MAX_BUFFER,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    return { ok: true, stdout, stderr };
  } catch (err) {
    const failure = classifyExecError(err, timeoutMs);
    return { ok: false, stdout: failure.stdout, stderr: failure.stderr, failure, cause: err };
  }
}

/** Runs `bin args` to completion; throws {@link ExecError} (stdout and stderr preserved) on any failure. */
export async function execTool(
  bin: string,
  args: readonly string[],
  options: ExecOptions = {},
): Promise<ExecOutput> {
  const result = await execToolResult(bin, args, options);
  if (result.ok) return { stdout: result.stdout, stderr: result.stderr };
  throw new ExecError(bin, args, result.failure, result.cause);
}
