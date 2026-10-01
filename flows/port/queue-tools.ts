/**
 * Process and filesystem plumbing of the verification queues: tool locations
 * and timeouts (mutable so tests can redirect them), the never-throwing child
 * process runner, test-file discovery and the honest ran/not-run vitest
 * outcome. Shared by QueueVerifyStep and the integration bootstrap.
 */

import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { execToolResult } from "../../src/exec.js";
import {
  parseVitestOutput,
  parseVitestSummary,
  type VitestFailureRecord,
  type VitestRunState,
} from "../../src/queues/vitest-queue.js";

const TSC_BIN = join(import.meta.dir, "..", "..", "node_modules", ".bin", "tsc");

/**
 * Tool locations and timeouts for the verify step. Production defaults; a
 * mutable export so tests can point tsc at a missing binary or shrink the
 * timeout without spawning a 180 s process.
 */
export const queueVerifyTools = {
  tscBin: TSC_BIN,
  tscTimeoutMs: 180_000,
  vitestTimeoutMs: 180_000,
};

/** One finished child process, with everything execFile reports on failure. */
interface CapturedRun {
  stdout: string;
  stderr: string;
  /** Exit code; null when killed, signalled or never spawned. */
  exitCode: number | null;
  signal: string | null;
  /** True when execFile's timeout / maxBuffer guard killed the process. */
  killed: boolean;
  /** Spawn-level error code ("ENOENT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", ...). */
  errorCode: string | null;
}

/** Runs a tool to completion and NEVER throws: failure modes are data. */
export async function runCaptured(
  bin: string,
  args: readonly string[],
  opts: { cwd: string; timeoutMs: number },
): Promise<CapturedRun> {
  const r = await execToolResult(bin, args, { cwd: opts.cwd, timeoutMs: opts.timeoutMs });
  if (r.ok) return { stdout: r.stdout, stderr: r.stderr, exitCode: 0, signal: null, killed: false, errorCode: null };
  const f = r.failure;
  return {
    stdout: f.stdout,
    stderr: f.stderr,
    exitCode: f.exitCode,
    signal: f.signal,
    killed: f.killed,
    errorCode: f.spawnError,
  };
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** The deterministic vitest runner artifacts the bootstrap writes. */
export async function findVitestTestFiles(integrationWorktreePath: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (abs: string, rel: string): Promise<void> => {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        await walk(join(abs, e.name), `${rel}/${e.name}`);
      } else if (e.isFile() && /\.test\.tsx?$/.test(e.name)) {
        out.push(`${rel}/${e.name}`);
      }
    }
  };
  for (const dir of ["test", "tests"]) {
    const root = join(integrationWorktreePath, dir);
    if (await pathExists(root)) await walk(root, dir);
  }
  return out.sort();
}

/**
 * US-010 pure core: the honest vitest outcome from one queue attempt. The
 * runner either RAN (counts from the vitest summary + parsed failure records)
 * or did NOT run — with an explicit reason. A crashed runner (no parseable
 * summary) is NOT-RUN, never a zero-failure ran.
 *
 * C26: vitest 3.x writes the summary and per-file bullets to stdout but every
 * `FAIL` block (message, diff, `file:line:col` frames) to stderr, so `run`
 * carries both streams. They are read as stdout-then-stderr; the parsers
 * anchor the summary lines and start records on `FAIL` only, so the merge
 * neither doubles records nor lets the `Failed Tests N` banner win.
 */
export function vitestOutcomeFromRun(
  binExists: boolean,
  testFiles: readonly string[],
  run: { stdout: string; stderr?: string } | null,
): { vitestRun: VitestRunState; records: VitestFailureRecord[] } {
  if (!binExists) {
    return {
      vitestRun: {
        kind: "not-run",
        reason: "runner unavailable: vitest not installed in the integrated checkout",
      },
      records: [],
    };
  }
  if (testFiles.length === 0) {
    return {
      vitestRun: { kind: "not-run", reason: "no test files in the integrated checkout" },
      records: [],
    };
  }
  if (run === null) {
    return { vitestRun: { kind: "not-run", reason: "runner produced no output" }, records: [] };
  }
  const text = run.stderr === undefined || run.stderr === "" ? run.stdout : `${run.stdout}\n${run.stderr}`;
  const summary = parseVitestSummary(text);
  if (summary === null) {
    return {
      vitestRun: {
        kind: "not-run",
        reason: "runner produced no parseable summary (possible crash)",
      },
      records: [],
    };
  }
  return {
    vitestRun: {
      kind: "ran",
      passed: summary.tests.passed,
      failed: summary.tests.failed,
      total: summary.tests.total,
    },
    records: parseVitestOutput(text),
  };
}
