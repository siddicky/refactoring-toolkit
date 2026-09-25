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
 */

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
 * Parse raw `tsc --noEmit --pretty false` output into error records.
 *
 * Tolerant line parser: a line matching the diagnostic shape starts a record;
 * any non-empty, non-summary line that does not match becomes a continuation
 * of the previous record's message (tsc emits indented detail lines for
 * multi-line "not assignable" errors). Unmatched leading lines are ignored.
 */
export function parseTscOutput(output: string): TscErrorRecord[] {
  const errors: TscErrorRecord[] = [];
  for (const line of output.split("\n")) {
    if (line.trim() === "" || TSC_SUMMARY_LINE.test(line.trim())) {
      continue;
    }
    const match = TSC_ERROR_LINE.exec(line);
    if (match) {
      const file = match[1];
      const lineNo = match[2];
      const colNo = match[3];
      const code = match[4];
      const message = match[5];
      if (
        file !== undefined &&
        lineNo !== undefined &&
        colNo !== undefined &&
        code !== undefined &&
        message !== undefined
      ) {
        errors.push({
          file,
          line: Number(lineNo),
          column: Number(colNo),
          code,
          message,
          raw: line,
        });
      }
    } else if (errors.length > 0) {
      // Continuation of the previous diagnostic's message.
      const last = errors[errors.length - 1];
      if (last) {
        last.message = `${last.message}\n${line}`;
        last.raw = `${last.raw}\n${line}`;
      }
    }
    // Unmatched line before any record: ignore (banner/progress noise).
  }
  return errors;
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
// Burn-down series (plan §Metrics: "typecheck-queue error-count burn-down
// across iterations" is an AC2 field; recorded as durable attributes).
// ---------------------------------------------------------------------------

export interface BurnDownEntry {
  /** Loop iteration the count was taken at. */
  iteration: number;
  errorCount: number;
}

export interface BurnDownSeries {
  kind: "tsc-burndown";
  /** Entries in ascending iteration order (append/replace keeps order). */
  entries: BurnDownEntry[];
}

export function emptyBurnDown(): BurnDownSeries {
  return { kind: "tsc-burndown", entries: [] };
}

/**
 * Pure recorder: returns a NEW series with the count appended, or replacing
 * the entry for an already-recorded iteration (re-running a queue step for
 * the same iteration must not duplicate entries).
 */
export function recordBurnDown(
  series: BurnDownSeries,
  iteration: number,
  errorCount: number,
): BurnDownSeries {
  const existing = series.entries.findIndex((e) => e.iteration === iteration);
  const entries = [...series.entries];
  if (existing >= 0) {
    entries[existing] = { iteration, errorCount };
  } else {
    entries.push({ iteration, errorCount });
    entries.sort((a, b) => a.iteration - b.iteration);
  }
  return { kind: "tsc-burndown", entries };
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
