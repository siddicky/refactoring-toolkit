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
  unhandledErrorRecord,
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
  /** The runtime's raw `killed` flag: the timeout killed the process (see ExecFailure.killed). */
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

/**
 * Where the scaffolded vitest config looks for tests: these directories, files
 * named `*.test.ts`. Discovery below and the config's `include` (bootstrap.ts
 * BOOTSTRAP_TEST_GLOBS) both come from this pair, so a file the queue counts as
 * a test is a file vitest runs. (`.test.tsx` was counted by discovery but never
 * included, so a lone `.test.tsx` read as a crash and a mixed set reported
 * `ran N/N` with the tsx tests silently unrun: B32.)
 */
export const VITEST_TEST_DIRS: readonly string[] = ["test", "tests"];
export const VITEST_TEST_SUFFIX = ".test.ts";

/** Test files the integrated checkout's vitest will run (VITEST_TEST_DIRS, VITEST_TEST_SUFFIX). */
export async function findVitestTestFiles(integrationWorktreePath: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (abs: string, rel: string): Promise<void> => {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        await walk(join(abs, e.name), `${rel}/${e.name}`);
      } else if (e.isFile() && e.name.endsWith(VITEST_TEST_SUFFIX)) {
        out.push(`${rel}/${e.name}`);
      }
    }
  };
  for (const dir of VITEST_TEST_DIRS) {
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
 *
 * B2: the process exit code is evidence too. Vitest exits non-zero over
 * unhandled errors (`Errors  1 error`), thresholds and the like while every
 * test passes and no `FAIL` block exists; a ran with 0 failures there was a
 * vacuous green. A non-zero exit with nothing failing in the summary or the
 * records is therefore recorded as a failed run (one synthetic record, see
 * unhandledErrorRecord), the same way tsc treats a non-zero exit with no
 * located error as untrustworthy. An unknown exit code (omitted, or null for a
 * killed process) changes nothing.
 */
export function vitestOutcomeFromRun(
  binExists: boolean,
  testFiles: readonly string[],
  run: { stdout: string; stderr?: string; exitCode?: number | null } | null,
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
  const records = parseVitestOutput(text);
  const exitCode = run.exitCode;
  if (typeof exitCode === "number" && exitCode !== 0 && summary.tests.failed === 0 && records.length === 0) {
    return {
      vitestRun: {
        kind: "ran",
        passed: summary.tests.passed,
        failed: Math.max(summary.unhandledErrors, 1),
        total: summary.tests.total,
      },
      records: [unhandledErrorRecord(text, exitCode, summary.unhandledErrors)],
    };
  }
  return {
    vitestRun: {
      kind: "ran",
      passed: summary.tests.passed,
      failed: summary.tests.failed,
      total: summary.tests.total,
    },
    records,
  };
}
