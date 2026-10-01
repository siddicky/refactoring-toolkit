/**
 * Keys and pure helpers of the port flows (unit-tested in
 * tests/flow-pure-derivations.test.ts and friends): attribute-key builders, the prep
 * source-map parser, the dispatch/fix-round derivations over the durable queue,
 * and the input rebuilders. No I/O, no step classes.
 */

import { posix } from "node:path";

import { identityKeyOf, stripDotSlash } from "../../src/file-keys.js";
import type { ClassifiedVitestFailure } from "../../src/queues/vitest-queue.js";
import type {
  FileRoundInput,
  OutPathRef,
  PortFileInput,
  PortQueueState,
  PortRunInput,
  PrepArtifact,
  QueueVerifyError,
  QueueVerifyState,
  WaveDispatchOutput,
  WaveDispatchRecord,
  WaveEntry,
} from "./state.js";

// The attribute key of a file-round is the shared identity key (src/file-keys.ts).
export const markerKeyOf = identityKeyOf;
export const diffKeyOf = markerKeyOf;
export const keptKeyOf = markerKeyOf;
export const outKeyOf = markerKeyOf;
export const verdictKeyOf = (file: string, round: number, reviewerId: string): string =>
  `${markerKeyOf(file, round)}#${reviewerId}`;

/** Envelope identity of every per-file step: the sanitized `file#round` attribute key. */
export const fileRoundIdentity = (_ctx: unknown, target: { file: string; round: number }): string =>
  markerKeyOf(target.file, target.round);

/**
 * The ported output path of a file-round: the pp-out record the implement step
 * wrote, else the prep source map. Fix rounds enter via the queue-fix path, which
 * never runs the implement step, so only the fallback exists for them.
 */
export function outPathOf(
  out: OutPathRef | undefined,
  prep: Pick<PrepArtifact, "sourceMap"> | undefined,
  file: string,
): string | undefined {
  return out?.outPath ?? prep?.sourceMap[file]?.outPath;
}

/**
 * Parses the stub-prep source-map table: rows of the form
 * `| \`src/X.php\` | \`src/x.ts\` | notes |`. Header/separator rows,
 * non-.php first cells, and glob rows (`*`) are ignored — seed lookup is
 * by exact source path only.
 */
export function parsePrepSourceMap(raw: string): Record<string, { outPath: string; notes: string }> {
  const map: Record<string, { outPath: string; notes: string }> = {};
  // A repeated source is last-wins here; sourceMapProblems reports it.
  for (const row of parsePrepSourceMapRows(raw)) map[row.source] = { outPath: row.outPath, notes: row.notes };
  return map;
}

/** One exact source-map row, in file order (a source can appear twice; the map keeps the last). */
export interface PrepSourceMapRow {
  source: string;
  outPath: string;
  notes: string;
}

export function parsePrepSourceMapRows(raw: string): PrepSourceMapRow[] {
  const rows: PrepSourceMapRow[] = [];
  for (const line of raw.split("\n")) {
    const m = /^\|\s*`([^`]+\.php)`\s*\|\s*`([^`]+)`\s*\|\s*(.*?)\s*\|?\s*$/.exec(line.trim());
    if (m === null) continue;
    const php = m[1];
    if (php === undefined || m[2] === undefined) continue;
    if (php.includes("*")) continue; // glob rows are not exact seeds
    rows.push({ source: php, outPath: m[2], notes: m[3] ?? "" });
  }
  return rows;
}

/** An output path that stays inside the checkout: relative, no `..` segment, not empty. */
function outPathProblem(outPath: string): string | null {
  const rel = stripDotSlash(outPath).trim();
  if (rel === "") return "is empty";
  if (rel.includes("\0")) return "contains a NUL byte";
  if (rel.startsWith("/") || rel.startsWith("\\") || /^[A-Za-z]:/.test(rel)) return "is absolute";
  if (rel.split(/[\\/]/).includes("..")) return "leaves the checkout (`..`)";
  return null;
}

/**
 * What is wrong with the source-map rows of the files a run will port: an
 * output path that is absolute or climbs out of the lease worktree (the
 * toolkit writes model-generated text there), a source mapped twice to
 * different outputs (the parse silently keeps the last), and two sources mapped
 * to the same output (the second lease's add/add conflicts at the wave join,
 * after the model spend). Files without a row are the caller's separate error.
 */
export function sourceMapProblems(rows: readonly PrepSourceMapRow[], files: readonly string[]): string[] {
  const problems: string[] = [];
  const bySource = new Map<string, PrepSourceMapRow[]>();
  for (const row of rows) bySource.set(row.source, [...(bySource.get(row.source) ?? []), row]);
  const owners = new Map<string, string>();
  for (const file of files) {
    const mine = bySource.get(file);
    if (mine === undefined) continue;
    const outs = [...new Set(mine.map((r) => r.outPath))];
    if (outs.length > 1) problems.push(`${file} is mapped to ${outs.map((o) => `\`${o}\``).join(" and ")}`);
    const outPath = mine[mine.length - 1]?.outPath;
    if (outPath === undefined) continue;
    const bad = outPathProblem(outPath);
    if (bad !== null) {
      problems.push(`${file} -> \`${outPath}\` ${bad}`);
      continue;
    }
    const key = posix.normalize(stripDotSlash(outPath).replaceAll("\\", "/"));
    const other = owners.get(key);
    if (other !== undefined && other !== file) problems.push(`${other} and ${file} both map to \`${key}\``);
    else owners.set(key, file);
  }
  return problems;
}

export type NextAction =
  | { kind: "resume"; file: string; round: number; epoch: number }
  | { kind: "start"; file: string }
  | { kind: "done" }
  | { kind: "blocked"; file: string; round: number; reason: string };

/**
 * Pure dispatch derivation over the durable queue: resume an in-flight
 * file-round first (kill mid-file), else start the next pending file, else
 * finish. The round cap blocks a NEW round beyond maxRounds.
 */
export function deriveNext(queue: PortQueueState, maxRounds: number): NextAction {
  const current = queue.current;
  if (current !== null) {
    if (current.round > maxRounds) {
      return { kind: "blocked", file: current.file, round: current.round, reason: `round cap ${maxRounds} exceeded` };
    }
    return { kind: "resume", file: current.file, round: current.round, epoch: current.epoch };
  }
  const next = queue.pending[0];
  if (next === undefined) return { kind: "done" };
  if (1 > maxRounds) {
    return { kind: "blocked", file: next, round: 1, reason: `round cap ${maxRounds} exceeded` };
  }
  return { kind: "start", file: next };
}

/**
 * US-010 (cx6b live finding): per-output error counts feeding fix-round
 * selection — tsc errors PLUS vitest failures Lane-B-routed to the output
 * (port-caused AND attributedFile set). Without the vitest half, failing
 * ported tests complete the run unaddressed: the fix FEED saw them, the
 * selection didn't. Counts derive from the durable classified records (same
 * 80-record cap as the tsc error list).
 */
export function errorCountsByOutput(
  tscErrors: ReadonlyArray<{ file: string }>,
  vitestClassified: ReadonlyArray<ClassifiedVitestFailure> | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const e of tscErrors) {
    const rel = stripDotSlash(e.file);
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  for (const c of vitestClassified ?? []) {
    if (c.classification.failureClass !== "port-caused") continue;
    if (c.classification.attributedFile === null) continue;
    const rel = stripDotSlash(c.classification.attributedFile);
    counts.set(rel, (counts.get(rel) ?? 0) + 1);
  }
  return counts;
}

/**
 * Phase 4 termination rule (pure): from the done-set, the prep source map
 * (php→ts outPath), and the per-output error counts, select the files that
 * get a FIX ROUND (errors remain AND round+1 stays within the cap) versus
 * files that are capped (recorded as blocked, errors remain unresolvable
 * in-run).
 */
export function selectFixableFiles(
  done: ReadonlyArray<{ file: string; round: number }>,
  sourceMap: Record<string, { outPath: string }>,
  errorCountByOutput: ReadonlyMap<string, number>,
  maxRounds: number,
): { fixable: Array<{ file: string; fromRound: number }>; capped: Array<{ file: string; round: number; count: number }> } {
  const fixable: Array<{ file: string; fromRound: number }> = [];
  const capped: Array<{ file: string; round: number; count: number }> = [];
  // cx6c live finding (loop non-termination): the cap decision must read the
  // file's LATEST done round. Iterating EVERY done entry let a file's stale
  // round-1 entry re-qualify it at round 2 forever (round cap never reached
  // for maxRounds >= 2), so a persistent error looped fix waves without end.
  const latestRound = new Map<string, number>();
  for (const entry of done) {
    latestRound.set(entry.file, Math.max(latestRound.get(entry.file) ?? 0, entry.round));
  }
  for (const [file, round] of latestRound) {
    const outPath = sourceMap[file]?.outPath;
    if (outPath === undefined) continue;
    const count = errorCountByOutput.get(stripDotSlash(outPath)) ?? 0;
    if (count === 0) continue;
    if (round + 1 > maxRounds) {
      capped.push({ file, round, count });
    } else {
      fixable.push({ file, fromRound: round });
    }
  }
  return { fixable, capped };
}

/** Start of the `blocked[].reason` the verify step writes for a file at the round cap with queue errors left. */
const CAPPED_WITH_ERRORS_REASON = "round cap reached with ";

/**
 * The blocked list after one verify iteration. A cap-with-errors entry is
 * derived state: it says "this file still has queue errors and no round left",
 * and `capped` is recomputed from the whole done set every iteration. So the
 * previous iteration's cap entries are re-derived rather than kept forever (C04
 * kept them from duplicating; B3: a file whose errors another file's fix cleared
 * is no longer blocked, and must not stay on the result with a reason that is
 * no longer true). Entries blocked by dispatch (a pending file past the round
 * cap, never run) are facts, not derived, and stay.
 */
export function blockedAfterVerify(
  prior: PortQueueState["blocked"],
  capped: ReadonlyArray<{ file: string; round: number; count: number }>,
): PortQueueState["blocked"] {
  const entryOf = (c: { file: string; round: number; count: number }): PortQueueState["blocked"][number] => ({
    file: c.file,
    round: c.round,
    reason: `${CAPPED_WITH_ERRORS_REASON}${c.count} queue error(s) remaining`,
  });
  const stillCapped = new Map(capped.map((c) => [c.file, c]));
  const kept: PortQueueState["blocked"] = [];
  const seen = new Set<string>();
  for (const entry of prior) {
    if (seen.has(entry.file)) continue;
    seen.add(entry.file);
    if (!entry.reason.startsWith(CAPPED_WITH_ERRORS_REASON)) {
      kept.push(entry);
      continue;
    }
    const current = stillCapped.get(entry.file);
    if (current !== undefined) kept.push(entryOf(current));
  }
  for (const c of capped) {
    if (!seen.has(c.file)) kept.push(entryOf(c));
  }
  return kept;
}

/**
 * US-010: ported output roots derived from the prep source map — the fix
 * loop's classification must know which output trees are PORTED (including
 * the ported test tree, whose failures belong to the port loop, not the
 * fixture bucket). A root is a top-level directory of a normalized outPath;
 * roots whose files end in `.test.ts` are ported TEST roots.
 */
export function portedRootsFromSourceMap(
  sourceMap: Record<string, { outPath: string }>,
): { portedRoots: string[]; portedTestRoots: string[] } {
  const srcRoots = new Set<string>();
  const testRoots = new Set<string>();
  for (const row of Object.values(sourceMap)) {
    const rel = stripDotSlash(row.outPath);
    const slash = rel.indexOf("/");
    if (slash <= 0) continue;
    const root = rel.slice(0, slash);
    if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) testRoots.add(root);
    else srcRoots.add(root);
  }
  return {
    portedRoots: [...srcRoots].sort(),
    portedTestRoots: [...testRoots].sort(),
  };
}

/**
 * The vitest-triage routing predicate (single authority): a record reaches a
 * per-file fix feed iff it is port-caused AND attributed to that exact
 * output path ("./"-normalized). Unattributable records (attributedFile
 * null, deterministic port-caused default) match nothing per-file.
 */
export function vitestRoutedTo(
  classified: readonly ClassifiedVitestFailure[] | undefined,
  relPath: string,
): ClassifiedVitestFailure[] {
  const rel = stripDotSlash(relPath);
  return (classified ?? []).filter(
    (c) =>
      c.classification.failureClass === "port-caused" &&
      c.classification.attributedFile !== null &&
      stripDotSlash(c.classification.attributedFile) === rel,
  );
}

/**
 * Per-file fix-round feed (consumer of the classified queue state): the tsc
 * errors for this output path PLUS the vitest failures Lane-B triage routed
 * here (failureClass port-caused AND attributedFile === this path, normalized
 * "./"-free). Fixture-problem records and unattributable records (class
 * port-caused by the deterministic default, attributedFile null) reach no
 * per-file feed — they stay visible in the durable vitest queue state.
 */
export function queueFixFeedForFile(
  verify: QueueVerifyState | undefined,
  relPath: string,
): { errors: QueueVerifyError[]; testFailures: Array<{ name: string; message: string }> } {
  const rel = stripDotSlash(relPath);
  const errors = (verify?.errors ?? []).filter((e) => stripDotSlash(e.file) === rel);
  const testFailures = vitestRoutedTo(verify?.vitestState?.classified, rel).map((c) => ({
    name:
      c.record.testName === ""
        ? c.record.testFile
        : `${c.record.testFile} > ${c.record.testName}`,
    message: c.record.errorMessage,
  }));
  return { errors, testFailures };
}

/**
 * Rebuilds the run input after a sequential file-round. The run-level fields
 * (dispatchMode, maxRounds, prepPath, files) are carried on the FileRoundInput
 * by LeaseStep's spread; the stub values below apply only to a FileRoundInput
 * that never came from a run input.
 */
export function baseInput(fri: FileRoundInput): PortRunInput {
  return {
    repoRoot: fri.repoRoot,
    worktreeRoot: fri.worktreeRoot,
    integrationWorktreePath: fri.integrationWorktreePath,
    epoch: fri.epoch,
    sourceRoot: fri.sourceRoot,
    prepPath: fri.prepPath ?? "",
    files: fri.files ?? [],
    maxRounds: fri.maxRounds ?? 1,
    ...(fri.dispatchMode !== undefined ? { dispatchMode: fri.dispatchMode } : {}),
  };
}

export function childInputOf(
  base: PortRunInput,
  prep: PrepArtifact,
  file: string,
  round: number,
  errors: ReadonlyArray<QueueVerifyError>,
  vitest: ReadonlyArray<ClassifiedVitestFailure>,
): PortFileInput {
  return {
    repoRoot: base.repoRoot,
    worktreeRoot: base.worktreeRoot,
    integrationWorktreePath: base.integrationWorktreePath,
    sourceRoot: base.sourceRoot,
    epoch: base.epoch,
    file,
    round,
    prep,
    queueFixErrors: errors,
    queueFixVitest: vitest,
  };
}

/** The round one wave entry runs at (pre-C03 records carry only the wave's). */
export function waveEntryRound(wave: Pick<WaveDispatchRecord, "round">, entry: Pick<WaveEntry, "round">): number {
  return entry.round ?? wave.round;
}

export function baseInputOf(out: WaveDispatchOutput): PortRunInput {
  const { mode: _mode, ...rest } = out;
  return rest;
}
