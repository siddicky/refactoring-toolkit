/**
 * vitest verification queue — parsing + triage (plan Phase 4).
 *
 * Real vitest runs are toolkit-owned queue steps executed against the
 * integrated checkout (plan §Flow contract step 3). This module ONLY parses
 * failure output and classifies failures. It never executes agents and never
 * runs vitest itself.
 *
 * Triage contract: `classify(failure)` decides whether a failing test is fed
 * back to the port loop (port-caused) or attributed to the demo fixture /
 * test harness (fixture-problem). The interface exists so a smarter
 * classifier (e.g. a TypeSafe noul) can replace the naive code-only default
 * without touching the flow (plan principle 5: vendor-thin seams, naive impls
 * first). The naive default is a pure path heuristic over the parsed stack.
 *
 * Zero runtime deps.
 */

/** One stack frame parsed from a failure's stack trace. */
export interface StackFrame {
  file: string;
  line: number;
  column: number;
}

/** One failing test, parsed from vitest output. */
export interface VitestFailureRecord {
  /** Test file vitest reported the failure under (e.g. "tests/foo.test.ts"). */
  testFile: string;
  /** Full test name, suite segments joined with " > ". Empty if file-level. */
  testName: string;
  /** Error text: message lines (non-frame lines of the block), "\n"-joined. */
  errorMessage: string;
  /** Stack frames in printed order (innermost first, as vitest prints). */
  frames: StackFrame[];
  /** Original block text, kept as evidence. */
  raw: string;
}

/** Triage outcome: does this failure feed the port loop or the fixture? */
export type FailureClass = "port-caused" | "fixture-problem";

export interface FailureClassification {
  failureClass: FailureClass;
  /**
    * File the failure routes to in the fix-round feed: the ported output file
    * that decided "port-caused", or the fixture/test-harness file for
    * "fixture-problem". null when nothing in the stack matched a known root —
    * the class then defaults to "port-caused" (deterministic, documented) but
    * there is no file to route to, so the record stays visible in the queue
    * state without entering any per-file feed.
    */
  attributedFile: string | null;
  /** Human-readable justification (what frame/root decided the class). */
  reason: string;
}

/**
 * Seam: anything that can triage a failing test. The flow consumes this
 * interface; swap implementations without touching the loop. Judgment-backed
 * implementations (Lane-B vitest-triage, registered in
 * src/judgment-registry.ts) are async — they satisfy AsyncFailureClassifier,
 * the same seam shaped for providers that await.
 */
export interface FailureClassifier {
  classify(failure: VitestFailureRecord): FailureClassification;
}

/** Async variant of the classifier seam (Jev route). */
export interface AsyncFailureClassifier {
  classify(failure: VitestFailureRecord): Promise<FailureClassification>;
}

/** One parsed failure paired with its triage outcome. */
export interface ClassifiedVitestFailure {
  record: VitestFailureRecord;
  classification: FailureClassification;
}

/**
 * Durable queue state for one vitest queue run (plain JSON, dex-attribute
 * safe — mirrors TscQueueState). `classified` is written by classifyMany at
 * queue-build; empty when the state was built without a classifier.
 */
export interface VitestQueueState {
  kind: "vitest-queue";
  iteration: number;
  total: number;
  failures: VitestFailureRecord[];
  classified: ClassifiedVitestFailure[];
}

// ---------------------------------------------------------------------------
// US-010 honest run accounting: ran (with counts) vs not-run (with reason).
// A queue entry that did not run must NEVER present as a bare error_count 0 —
// consumers render the state alongside the count.
// ---------------------------------------------------------------------------

/** US-010: the honest outcome of one vitest queue attempt. */
export type VitestRunState =
  | {
      kind: "ran";
      /** Tests that passed (vitest summary "Tests" line). */
      passed: number;
      /**
       * Tests that failed (= the fix-loop feed's failure universe). When the
       * run exited non-zero with no failing test (unhandled errors, a
       * threshold) this is the number of such run-level failures instead, and
       * the feed carries one synthetic record: a ran 0 never hides a red run.
       */
      failed: number;
      /** Total tests executed (passed + failed + skipped as reported). */
      total: number;
    }
  | {
      kind: "not-run";
      /** Explicit machine-honest reason the runner did not execute. */
      reason: string;
    };

/** Per-suite/per-test counts parsed from a vitest default-reporter summary. */
export interface VitestSummaryCounts {
  passed: number;
  failed: number;
  total: number;
}

/** Both summary lines (`Test Files ...` and `Tests ...`), tests required. */
export interface VitestSummary {
  testFiles: VitestSummaryCounts | null;
  tests: VitestSummaryCounts;
  /**
   * The `Errors  N error(s)` line: unhandled errors vitest caught while every
   * test passed (a leaked rejection, a throw after the test ended). 0 when the
   * line is absent. Vitest exits non-zero over them.
   */
  unhandledErrors: number;
}

/**
 * Parse a vitest default-reporter tail, e.g.
 *
 *   Test Files  2 failed | 3 passed (5)
 *        Tests  4 failed | 41 passed (45)
 *
 * ANSI is stripped here (a colored `Tests` line must still anchor). Returns
 * null when no parseable `Tests` summary exists (runner crash / no run
 * happened) — the caller records that as not-run, never as a zero-failure ran.
 *
 * `output` may be stdout and stderr concatenated: vitest 3.x writes the
 * summary to stdout and every `FAIL` block plus the `Failed Tests N` banner to
 * stderr, and only the anchored `Test Files` / `Tests` lines count.
 *
 * cx6c live finding: when EVERY test file fails to COLLECT (e.g. a ported
 * module imports a file the implementer never wrote), vitest prints
 * `Tests  no tests` with `Test Files  5 failed (5)`. Reading that as a
 * numeric summary yields a fake clean `ran 0/0/0` — the exact vacuous-green
 * US-010 exists to kill. The `Test Files` line is the honest fallback:
 * file-level failures ARE failures. Null only when neither line parses.
 */
export function parseVitestSummary(output: string): VitestSummary | null {
  let testFiles: VitestSummaryCounts | null = null;
  let tests: VitestSummaryCounts | null = null;
  let unhandledErrors = 0;
  for (const line of output.replace(ANSI_ESCAPE, "").split("\n")) {
    const files = parseSummaryLine(line, TEST_FILES_LABEL);
    if (files !== null) {
      testFiles = files;
      continue;
    }
    const t = parseSummaryLine(line, TESTS_LABEL);
    if (t !== null) {
      tests = t;
      continue;
    }
    const errors = ERRORS_LINE.exec(line);
    if (errors !== null) unhandledErrors = Number(errors[1]);
  }
  if (tests === null) {
    if (testFiles !== null && testFiles.failed > 0) {
      // Collection failure: no test executed, every failing file is a failure.
      return { testFiles, tests: { passed: 0, failed: testFiles.failed, total: testFiles.total }, unhandledErrors };
    }
    return null;
  }
  // Guard the vacuous case numerically: a summary claiming a ran with ZERO
  // tests while test files exist and some failed to collect is not a clean
  // run — fall back to the file-level counts.
  if (
    tests.total === 0 &&
    tests.failed === 0 &&
    testFiles !== null &&
    (testFiles.failed > 0 || testFiles.total === 0)
  ) {
    return { testFiles, tests: { passed: 0, failed: testFiles.failed, total: testFiles.total }, unhandledErrors };
  }
  return { testFiles, tests, unhandledErrors };
}

const TEST_FILES_LABEL = /^\s*Test Files\s/;
const TESTS_LABEL = /^\s*Tests\s/;
const ERRORS_LINE = /^\s*Errors\s+(\d+)\s+errors?\b/;

/**
 * `Tests  4 failed | 41 passed (45)` → {passed: 41, failed: 4, total: 45}.
 *
 * Anchored: the label must be the first token of the line. vitest 3.x also
 * prints `⎯⎯ Failed Tests 2 ⎯⎯` banners and `FAIL  f > Tests > x` headers; an
 * indexOf match let those overwrite the real summary once stdout and stderr
 * are read together (C26).
 */
function parseSummaryLine(line: string, label: RegExp): VitestSummaryCounts | null {
  const anchored = label.exec(line);
  if (anchored === null) return null;
  const rest = line.slice(anchored[0].length);
  const failed = /(\d+)\s+failed/.exec(rest);
  const passed = /(\d+)\s+passed/.exec(rest);
  const skipped = /(\d+)\s+skipped/.exec(rest);
  const paren = /\((\d+)\)/.exec(rest);
  const passedN = passed === null ? 0 : Number(passed[1]);
  const failedN = failed === null ? 0 : Number(failed[1]);
  const skippedN = skipped === null ? 0 : Number(skipped[1]);
  // The parenthesized total is authoritative when present; otherwise the sum.
  const total = paren === null ? passedN + failedN + skippedN : Number(paren[1]);
  if (!Number.isFinite(passedN) || !Number.isFinite(failedN) || !Number.isFinite(total)) {
    return null;
  }
  return { passed: passedN, failed: failedN, total };
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

// Built from the ESC character (not a regex literal with \x1b) so the control character is explicit.
const ESC = String.fromCharCode(0x1b);
const ANSI_ESCAPE = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/**
 * Record starts: vitest's default reporter `FAIL  path > suite > test` lines
 * ONLY. The per-file `× Suite > test 12ms` bullets carry no message or stack
 * frames, duplicate the FAIL block when both streams are read, and — when the
 * FAIL blocks were dropped with stderr (C26) — produced frameless records that
 * could never be attributed to a file. A test that fails always gets a FAIL
 * block; a collection failure gets `FAIL  file [ file ]`.
 */
const RECORD_START = /^\s*FAIL\s+\S/;
const SUMMARY_START = /^\s*(?:Test Files\s|Tests\s|Duration\s|Start at\s)/;
/** `⎯⎯⎯ Failed Tests 2 ⎯⎯⎯` banners and `⎯⎯⎯[1/3]⎯` footers end a record. */
const SECTION_RULE = /^\s*⎯{2,}/;

const STACK_FRAME_LINE = /(?:^|\s)(?:❯|at)\s+(.+)$/;
const FILE_LINE_COL = /([^\s()'"]+):(\d+):(\d+)/g;

/** Parse raw vitest output (default reporter, ANSI tolerated) into records. */
export function parseVitestOutput(output: string): VitestFailureRecord[] {
  const clean = output.replace(ANSI_ESCAPE, "").replace(/file:\/\//g, "");
  const failures: VitestFailureRecord[] = [];

  let current: { record: VitestFailureRecord; messageLines: string[] } | null =
    null;

  const flush = () => {
    if (current) {
      current.record.errorMessage = current.messageLines.join("\n");
      failures.push(current.record);
      current = null;
    }
  };

  for (const line of clean.split(/\r?\n/)) {
    if (SUMMARY_START.test(line) || SECTION_RULE.test(line)) {
      flush();
      continue;
    }
    if (RECORD_START.test(line)) {
      flush();
      current = { record: parseFailHeader(line), messageLines: [] };
      continue;
    }
    if (!current) {
      continue; // banner / passed-test noise before any failure
    }
    if (isStackFrameLine(line)) {
      const frame = parseStackFrame(line);
      if (frame) {
        current.record.frames.push(frame);
        continue;
      }
    }
    if (line.trim() !== "") {
      current.messageLines.push(line);
    }
  }
  flush();
  return failures;
}

/**
 * `FAIL  tests/foo.test.ts > Suite > test name` → {testFile, testName}.
 * A collection failure prints `FAIL  tests/foo.test.ts [ tests/foo.test.ts ]`;
 * the bracketed repeat is not part of the file path.
 */
function parseFailHeader(line: string): VitestFailureRecord {
  const rest = line.trim().replace(/^FAIL\s+/, "");
  const separatorIndex = rest.indexOf(" > ");
  if (separatorIndex < 0) {
    return {
      testFile: rest.replace(/\s+\[\s.*\s\]$/, ""),
      testName: "",
      errorMessage: "",
      frames: [],
      raw: line,
    };
  }
  return {
    testFile: rest.slice(0, separatorIndex),
    testName: rest.slice(separatorIndex + 3),
    errorMessage: "",
    frames: [],
    raw: line,
  };
}

function isStackFrameLine(line: string): boolean {
  return STACK_FRAME_LINE.test(line);
}

function parseStackFrame(line: string): StackFrame | null {
  const tail = STACK_FRAME_LINE.exec(line);
  if (!tail) {
    return null;
  }
  const tailText = tail[1];
  if (tailText === undefined) {
    return null;
  }
  const matches = [...tailText.matchAll(FILE_LINE_COL)];
  const last = matches[matches.length - 1];
  if (!last) {
    return null;
  }
  const rawFile = last[1];
  const rawLine = last[2];
  const rawColumn = last[3];
  if (rawFile === undefined || rawLine === undefined || rawColumn === undefined) {
    return null;
  }
  return {
    file: rawFile,
    line: Number(rawLine),
    column: Number(rawColumn),
  };
}

const UNHANDLED_BANNER = /^\s*⎯+\s*Unhandled Errors\s*⎯+\s*$/;
const UNHANDLED_ERROR_BANNER = /^\s*⎯+\s*Unhandled (?:Rejection|Error)\s*⎯+\s*$/;
const ORIGIN_LINE = /This error originated in "([^"]+)" test file/;
/** Evidence kept on a synthetic record (vitest prints a long stack per unhandled error). */
const RAW_EVIDENCE_CAP = 4_000;

/**
 * One synthetic failure record for a vitest run that exited non-zero although
 * no test failed: vitest fails the run over unhandled errors (a leaked
 * rejection, a throw after the test ended) and over thresholds, and prints no
 * `FAIL` block for either. Without a record such a run read as a clean pass.
 *
 * The record names the exit code and the first unhandled error, carries the
 * frames of the `Unhandled Errors` section (dependencies filtered out) so the
 * triage can route it to the ported file it points at, and is attributed to the
 * test file vitest says the error originated in. A run that printed no
 * unhandled-error section still yields a record, with no frames.
 */
export function unhandledErrorRecord(output: string, exitCode: number, unhandledErrors: number): VitestFailureRecord {
  const lines = output.replace(ANSI_ESCAPE, "").replace(/file:\/\//g, "").split(/\r?\n/);
  const start = lines.findIndex((l) => UNHANDLED_BANNER.test(l));
  const block: string[] = [];
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (SUMMARY_START.test(line)) break;
      block.push(line);
    }
  }
  const frames: StackFrame[] = [];
  for (const line of block) {
    const frame = isStackFrameLine(line) ? parseStackFrame(line) : null;
    if (frame !== null && !frame.file.includes("node_modules/")) frames.push(frame);
  }
  const bannerAt = block.findIndex((l) => UNHANDLED_ERROR_BANNER.test(l));
  const firstError = bannerAt >= 0 ? block.slice(bannerAt + 1).find((l) => l.trim() !== "") : undefined;
  const origin = ORIGIN_LINE.exec(block.join("\n"))?.[1];
  const what =
    unhandledErrors > 0
      ? `${unhandledErrors} unhandled error(s)${firstError !== undefined ? `, the first: ${firstError.trim()}` : ""}`
      : "no unhandled error reported (a coverage threshold or another run-level check?)";
  return {
    testFile: origin ?? "",
    testName: "",
    errorMessage: `vitest exited with code ${exitCode} although no test failed: ${what}`,
    frames,
    raw: block.join("\n").trim().slice(0, RAW_EVIDENCE_CAP),
  };
}

/** Build durable queue state from parsed failures (unclassified). */
export function buildVitestQueueState(
  failures: readonly VitestFailureRecord[],
  iteration: number,
): VitestQueueState {
  return {
    kind: "vitest-queue",
    iteration,
    total: failures.length,
    failures: [...failures],
    classified: [],
  };
}

// ---------------------------------------------------------------------------
// Triage at queue-build: classifyMany over the parsed records (Lane-B
// vitest-triage; registered in src/judgment-registry.ts)
// ---------------------------------------------------------------------------

/** Records persisted per queue attribute write (mirrors the tsc errors cap). */
export const VITEST_RECORD_CAP = 80;

/**
 * Classify every parsed record through one classifier (naive default or the
 * async Jev route). Per-record: a classifier throwing on one record rejects
 * the whole batch — the flow-level fail-open (Jev unavailable → naive) wraps
 * THIS function, not individual records, so a half-Jev batch never persists.
 */
export async function classifyMany(
  records: readonly VitestFailureRecord[],
  classifier: FailureClassifier | AsyncFailureClassifier,
): Promise<ClassifiedVitestFailure[]> {
  const classified: ClassifiedVitestFailure[] = [];
  for (const record of records) {
    classified.push({ record, classification: await classifier.classify(record) });
  }
  return classified;
}

/**
 * Queue-build with triage: parse output → classifyMany → durable state.
 * Same attribute shape as buildVitestQueueState plus the classified records.
 */
export async function buildClassifiedVitestQueueState(
  failures: readonly VitestFailureRecord[],
  iteration: number,
  classifier: FailureClassifier | AsyncFailureClassifier,
): Promise<VitestQueueState> {
  const classified = await classifyMany(failures, classifier);
  return {
    kind: "vitest-queue",
    iteration,
    total: failures.length,
    failures: [...failures],
    classified,
  };
}

/**
 * Root configuration shared by the naive and Jev classifiers. US-010: the
 * port loop also ports the fixture's TEST files (test/*.test.ts are ported
 * OUTPUT, not fixture property), so classification accepts a lower-priority
 * `portedTestRoots` tier: a stack limited to a ported test file is
 * port-caused and routes to THAT test file's fix round, while any frame in a
 * ported source root still wins (the source module is the better fix target).
 */
export interface ClassifierRoots {
  portedRoots?: readonly string[];
  portedTestRoots?: readonly string[];
  fixtureRoots?: readonly string[];
}

/** Deterministic file attribution for an already-decided class: the first
 * stack frame under the matching root set (ported roots for "port-caused",
 * fixture roots for "fixture-problem"); null for unknown/other classes.
 * Shared by the naive classifier and the Jev route so the ATTRIBUTION step is
 * always deterministic — only the CLASS is judgment-derived.
 *
 * US-010: within "port-caused" the ported SOURCE roots are scanned across all
 * frames FIRST, then the ported TEST roots — a src frame anywhere in the stack
 * outranks a test-file frame (the assertion site is usually the innermost
 * frame; the producer is the better fix target). */
export function attributedFileOfClass(
  failure: VitestFailureRecord,
  failureClass: FailureClass,
  roots?: ClassifierRoots,
): string | null {
  const frames = failure.frames;
  if (failureClass === "port-caused") {
    const portedRoots = roots?.portedRoots ?? DEFAULT_PORTED_ROOTS;
    for (const frame of frames) {
      const root = matchRoot(frame.file, portedRoots);
      if (root !== null) return frame.file;
    }
    const portedTestRoots = roots?.portedTestRoots ?? DEFAULT_PORTED_TEST_ROOTS;
    for (const frame of frames) {
      const root = matchRoot(frame.file, portedTestRoots);
      if (root !== null) return frame.file;
    }
    return null;
  }
  if (failureClass === "fixture-problem") {
    const fixtureRoots = roots?.fixtureRoots ?? DEFAULT_FIXTURE_ROOTS;
    for (const frame of frames) {
      const root = matchRoot(frame.file, fixtureRoots);
      if (root !== null) return frame.file;
    }
    return null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Naive classifier (code-only default behind the FailureClassifier seam)
// ---------------------------------------------------------------------------

export interface NaiveClassifierOptions extends ClassifierRoots {
  /**
    * Class assigned when no frame matches any known root. Default:
    * "port-caused" — unattributable failures stay visible to the fix loop
    * instead of silently vanishing into the fixture bucket.
    */
  unknown?: FailureClass;
}

const DEFAULT_PORTED_ROOTS: readonly string[] = ["src"];
/**
 * US-010: empty by default (legacy behavior — test dirs belong to the fixture
 * bucket). The flow passes the ported test roots derived from the prep source
 * map so failures limited to a PORTED test file route to that file's fix round.
 */
const DEFAULT_PORTED_TEST_ROOTS: readonly string[] = [];
const DEFAULT_FIXTURE_ROOTS: readonly string[] = [
  "tests",
  "test",
  "__tests__",
  "fixtures",
];

/**
 * Naive default triage per task spec: a failure whose stack touches a ported
 * output file is port-caused (even if the assertion site is a test file —
 * ported code appearing in the stack means the port loop should look at it);
 * a failure whose stack only contains fixture/test-harness files is a
 * fixture-problem. Walks frames in printed order and checks all roots.
 *
 * Priority (US-010): ported SOURCE roots over frames in order, then ported
 * TEST roots over frames in order, then fixture roots — so a src frame
 * anywhere outranks a ported-test frame, and a ported-test frame outranks the
 * fixture bucket (a ported test file is ported OUTPUT, not fixture property).
 *
 * Attribution mirrors the class decision: the deciding frame's file becomes
 * attributedFile; the unknown case (no frame matched any root) keeps the
 * documented deterministic default — class "port-caused", attributedFile
 * null (visible in the queue state, routable to no per-file feed).
 */
export function createNaiveClassifier(
  options: NaiveClassifierOptions = {},
): FailureClassifier {
  const portedRoots = options.portedRoots ?? DEFAULT_PORTED_ROOTS;
  const portedTestRoots = options.portedTestRoots ?? DEFAULT_PORTED_TEST_ROOTS;
  const fixtureRoots = options.fixtureRoots ?? DEFAULT_FIXTURE_ROOTS;
  const unknownClass = options.unknown ?? "port-caused";

  return {
    classify(failure: VitestFailureRecord): FailureClassification {
      for (const frame of failure.frames) {
        const ported = matchRoot(frame.file, portedRoots);
        if (ported) {
          return {
            failureClass: "port-caused",
            attributedFile: frame.file,
            reason: `stack frame in ported output: ${frame.file}:${frame.line}:${frame.column}`,
          };
        }
      }
      for (const frame of failure.frames) {
        const portedTest = matchRoot(frame.file, portedTestRoots);
        if (portedTest) {
          return {
            failureClass: "port-caused",
            attributedFile: frame.file,
            reason: `stack limited to a PORTED test file: ${frame.file}:${frame.line}:${frame.column}`,
          };
        }
      }
      for (const frame of failure.frames) {
        const fixture = matchRoot(frame.file, fixtureRoots);
        if (fixture) {
          return {
            failureClass: "fixture-problem",
            attributedFile: frame.file,
            reason: `stack limited to fixture/test-harness file: ${frame.file}:${frame.line}:${frame.column}`,
          };
        }
      }
      return {
        failureClass: unknownClass,
        attributedFile: null,
        reason: "no stack frame matched known roots; assigned configured unknown class",
      };
    },
  };
}

/**
 * Tolerant root matching: normalized (forward slashes, no "./", no
 * "file://"), a path matches a root when it IS the root, starts with
 * `root/`, or contains `/root/` anywhere (absolute prefixes tolerated).
 */
function matchRoot(path: string, roots: readonly string[]): string | null {
  const normalized = normalizePath(path);
  for (const rawRoot of roots) {
    const root = normalizePath(rawRoot).replace(/\/+$/, "");
    if (
      normalized === root ||
      normalized.startsWith(`${root}/`) ||
      normalized.includes(`/${root}/`)
    ) {
      return root;
    }
  }
  return null;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}
