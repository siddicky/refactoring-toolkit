/**
 * tsc verification queue — mechanical parsing + grouping (plan Phase 4).
 *
 * Scope per plan §Flow contract step 3: tsc runs as a toolkit-owned queue step
 * against the integrated checkout. This module ONLY parses `tsc --noEmit
 * --pretty false` output and derives grouped, durable queue state. It never
 * executes agents and never runs tsc itself.
 *
 * Durability: all exported shapes are plain JSON (attribute-serializable) so
 * they can be stored directly as dex attributes (plan §State ownership:
 * "queue contents, burn-down" live in dex attributes).
 *
 * Zero runtime deps: tolerant line parser, no external packages.
 *
 * Honest accounting (C06, Contract A): "0 parsed errors" is only meaningful
 * when tsc actually produced a trustworthy result. {@link tscOutcomeFromRun}
 * turns one captured tsc process into `ran` / `not-run`, so a missing binary,
 * a timeout, or a global failure (TS18003 no inputs, TS5083 unreadable
 * tsconfig, TS2688 missing type library) is never read as a clean typecheck.
 */

import { stripDotSlash } from "../file-keys.js";

/** Location of a single tsc diagnostic. */
export interface TscErrorLocation {
  file: string;
  line: number;
  column: number;
}

/** One parsed tsc error record (multi-line messages are joined with "\n"). */
export interface TscErrorRecord extends TscErrorLocation {
  /** TS error code including the "TS" prefix, e.g. "TS2304". */
  code: string;
  /** Full message text; continuation lines joined with "\n". */
  message: string;
  /** The original first line of the diagnostic, kept as evidence. */
  raw: string;
}

/**
 * Durable queue state for one tsc queue run. Plain JSON only — safe to store
 * as a dex attribute and to JSON round-trip.
 */
export interface TscQueueState {
  /** Discriminator so mixed attribute stores stay unambiguous. */
  kind: "tsc-queue";
  /** The loop iteration this queue run belongs to. */
  iteration: number;
  /** Total number of parsed errors. */
  total: number;
  /** Flat error list in original (tsc output) order. */
  errors: TscErrorRecord[];
  /** Mechanical grouping by error code; sorted by code. */
  byCode: TscCodeGroup[];
  /** Mechanical grouping by file; sorted by file path. */
  byFile: TscFileGroup[];
}

export interface TscCodeGroup {
  code: string;
  count: number;
  /** Distinct files with this code, sorted ascending. */
  files: string[];
}

export interface TscFileGroup {
  file: string;
  count: number;
  /** Distinct error codes in this file, sorted ascending. */
  codes: string[];
}

/**
 * Matches `tsc --pretty false` diagnostic first-lines:
 *   src/foo.ts(12,3): error TS2304: Cannot find name 'x'.
 * Non-greedy file match tolerates parentheses inside paths before the
 * mandatory `(line,column)` marker.
 */
const TSC_ERROR_LINE =
  /^(.+?)\((\d+),(\d+)\):\s+(?:error|warning)\s+(TS\d+):\s?(.*)$/;

/** tsc's trailing summary, intentionally ignored (the records are the truth). */
const TSC_SUMMARY_LINE = /^Found \d+ errors?( in .*)?\.$/;

/**
 * Matches file-less (global) diagnostics, which `tsc --pretty false` prints
 * for config/environment failures:
 *   error TS18003: No inputs were found in config file '...'.
 *   error TS5083: Cannot read file '...'.
 *   error TS2688: Cannot find type definition file for '...'.
 */
const TSC_GLOBAL_ERROR_LINE = /^error\s+(TS\d+):\s?(.*)$/;

/** One global (file-less) `error TSnnnn:` diagnostic. */
export interface TscUnlocatedDiagnostic {
  code: string;
  /** Message text; indented detail lines joined with "\n". */
  message: string;
  /** The original first line of the diagnostic, kept as evidence. */
  raw: string;
}

/** Located error records plus the global diagnostics seen in the same output. */
export interface TscParseResult {
  errors: TscErrorRecord[];
  unlocated: TscUnlocatedDiagnostic[];
}

/**
 * Parse raw `tsc --noEmit --pretty false` output (LF or CRLF) into located
 * error records plus global diagnostics.
 *
 * Tolerant line parser: a line matching the located shape starts a record; a
 * line matching the global shape starts an unlocated diagnostic (it never
 * glues onto the previous located record); any other non-empty, non-summary
 * line becomes a continuation of the previous diagnostic's message (tsc emits
 * indented detail lines for multi-line "not assignable" errors). Unmatched
 * leading lines are ignored.
 */
export function parseTscDiagnostics(output: string): TscParseResult {
  const errors: TscErrorRecord[] = [];
  const unlocated: TscUnlocatedDiagnostic[] = [];
  let last: { message: string; raw: string } | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.trim() === "" || TSC_SUMMARY_LINE.test(line.trim())) {
      continue;
    }
    const match = TSC_ERROR_LINE.exec(line);
    if (match) {
      const [, file, lineNo, colNo, code, message] = match;
      if (
        file !== undefined &&
        lineNo !== undefined &&
        colNo !== undefined &&
        code !== undefined &&
        message !== undefined
      ) {
        const record: TscErrorRecord = {
          file,
          line: Number(lineNo),
          column: Number(colNo),
          code,
          message,
          raw: line,
        };
        errors.push(record);
        last = record;
      }
      continue;
    }
    const globalMatch = TSC_GLOBAL_ERROR_LINE.exec(line);
    if (globalMatch) {
      const diagnostic: TscUnlocatedDiagnostic = {
        code: globalMatch[1] ?? "",
        message: globalMatch[2] ?? "",
        raw: line,
      };
      unlocated.push(diagnostic);
      last = diagnostic;
    } else if (last !== null) {
      // Continuation of the previous diagnostic's message.
      last.message = `${last.message}\n${line}`;
      last.raw = `${last.raw}\n${line}`;
    }
    // Unmatched line before any record: ignore (banner/progress noise).
  }
  return { errors, unlocated };
}

/** Located error records only (see {@link parseTscDiagnostics}). */
export function parseTscOutput(output: string): TscErrorRecord[] {
  return parseTscDiagnostics(output).errors;
}

/**
 * Build durable grouped queue state from parsed errors (mechanical grouping
 * per plan — no LLM, no judgment; TypeSafe is deliberately not integrated
 * here, see spec §Deliberate non-integrations).
 */
export function buildTscQueueState(
  errors: readonly TscErrorRecord[],
  iteration: number,
): TscQueueState {
  const byCode = new Map<string, Set<string>>();
  const byFile = new Map<string, Set<string>>();
  for (const err of errors) {
    let files = byCode.get(err.code);
    if (!files) {
      files = new Set<string>();
      byCode.set(err.code, files);
    }
    files.add(err.file);

    let codes = byFile.get(err.file);
    if (!codes) {
      codes = new Set<string>();
      byFile.set(err.file, codes);
    }
    codes.add(err.code);
  }

  const byCodeGroups: TscCodeGroup[] = [...byCode.entries()].map(
    ([code, files]) => ({
      code: code!,
      count: countWhere(errors, (e) => e.code === code),
      files: [...files].sort(compareStrings),
    }),
  );
  byCodeGroups.sort((a, b) => compareStrings(a.code, b.code));

  const byFileGroups: TscFileGroup[] = [...byFile.entries()].map(
    ([file, codes]) => ({
      file: file!,
      count: countWhere(errors, (e) => e.file === file),
      codes: [...codes].sort(compareStrings),
    }),
  );
  byFileGroups.sort((a, b) => compareStrings(a.file, b.file));

  return {
    kind: "tsc-queue",
    iteration,
    total: errors.length,
    errors: [...errors],
    byCode: byCodeGroups,
    byFile: byFileGroups,
  };
}

/** Convenience: parse output and derive queue state in one call. */
export function parseTscQueueState(
  output: string,
  iteration: number,
): TscQueueState {
  return buildTscQueueState(parseTscOutput(output), iteration);
}

// ---------------------------------------------------------------------------
// Honest run accounting (C06 / Contract A). Mirrors the vitest ran/not-run
// accounting (US-010): a typecheck that did not produce a trustworthy count is
// never a bare error_count 0.
// ---------------------------------------------------------------------------

/**
 * Accounting for one tsc attempt, carried on the tsc TOTAL burn-down row
 * (`file: null`) as `tsc`. Snake_case to match the vitest accounting shape
 * and the metrics event contract.
 */
export interface TscRunAccounting {
  state: "ran" | "not-run";
  /**
   * Explicit reason when not-run, e.g. "tsc exited 2 with no located
   * diagnostics: error TS18003: No inputs were found...", "tsc timed out
   * after 180s", "tsc binary not found (ENOENT)". null when ran.
   */
  reason: string | null;
  /** Process exit code; null when killed / not spawned. */
  exit_code: number | null;
  /** Count of global (file-less) `error TSnnnn:` diagnostics seen. */
  unlocated: number;
}

/** One captured tsc process, as the verify step observed it. */
export interface TscProcessRun {
  /** stdout and stderr text (tsc prints diagnostics to stdout; both merged). */
  output: string;
  /** Exit code; null when the process was killed or never spawned. */
  exitCode: number | null;
  /** Terminating signal, when one ended the process. */
  signal: string | null;
  /** True when the caller's timeout / buffer guard killed the process. */
  killed: boolean;
  /** Spawn-level error code (e.g. "ENOENT"); null when the process ran. */
  errorCode: string | null;
  /** The timeout the caller applied, for the reason text. */
  timeoutMs: number;
}

export interface TscRunOutcome {
  /** Located error records (the durable queue's source of truth). */
  errors: TscErrorRecord[];
  accounting: TscRunAccounting;
}

const REASON_DETAIL_CAP = 240;

/** The not-run reason for one captured process; null when tsc produced a trustworthy count. */
function notRunReason(
  run: TscProcessRun,
  located: number,
  unlocated: readonly TscUnlocatedDiagnostic[],
): string | null {
  if (run.errorCode === "ENOENT") return "tsc binary not found (ENOENT)";
  if (run.errorCode === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return "tsc output exceeded the capture buffer (ERR_CHILD_PROCESS_STDIO_MAXBUFFER)";
  }
  if (run.errorCode !== null) return `tsc failed to run (${run.errorCode})`;
  if (run.killed) return `tsc timed out after ${Math.round(run.timeoutMs / 1000)}s`;
  if (run.signal !== null) return `tsc terminated by ${run.signal}`;
  if (run.exitCode !== 0 && located === 0) {
    const firstLine = run.output.split(/\r?\n/).find((l) => l.trim() !== "");
    const detail = (unlocated[0]?.raw ?? firstLine ?? "no output").trim().slice(0, REASON_DETAIL_CAP);
    return `tsc exited ${run.exitCode ?? "without a code"} with no located diagnostics: ${detail}`;
  }
  return null;
}

/**
 * Pure core: the honest tsc outcome from one captured process.
 *
 * `not-run` when tsc could not produce a trustworthy count: spawn error
 * (ENOENT, buffer overflow), timeout/kill, or a non-zero exit with ZERO
 * located diagnostics (TS18003 / TS5083 / TS2688 / empty output all parse to
 * zero records). Otherwise `ran`: exit 0 is a clean typecheck, and a non-zero
 * exit with located diagnostics is a genuine error count.
 */
export function tscOutcomeFromRun(run: TscProcessRun): TscRunOutcome {
  const { errors, unlocated } = parseTscDiagnostics(run.output);
  const reason = notRunReason(run, errors.length, unlocated);
  return {
    errors,
    accounting: {
      state: reason === null ? "ran" : "not-run",
      reason,
      exit_code: run.exitCode,
      unlocated: unlocated.length,
    },
  };
}

/**
 * Durable error records kept PER FILE by the verify step (C05). The fix feed
 * for a file is read from this list, so a global cap starved files whose
 * errors sorted past it (selected for a fix round with an empty feed). Keeps
 * original order; each file retains at most `perFileCap` records.
 */
export const TSC_ERRORS_PER_FILE_CAP = 80;

export function capErrorsPerFile<T extends { file: string }>(
  errors: readonly T[],
  perFileCap: number = TSC_ERRORS_PER_FILE_CAP,
): T[] {
  const seen = new Map<string, number>();
  const kept: T[] = [];
  for (const err of errors) {
    const file = stripDotSlash(err.file);
    const n = seen.get(file) ?? 0;
    if (n >= perFileCap) continue;
    seen.set(file, n + 1);
    kept.push(err);
  }
  return kept;
}

// ---------------------------------------------------------------------------
// helpers (local, deterministic; no deps)
// ---------------------------------------------------------------------------

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function countWhere<T>(
  items: readonly T[],
  predicate: (item: T) => boolean,
): number {
  let n = 0;
  for (const item of items) {
    if (predicate(item)) {
      n += 1;
    }
  }
  return n;
}
