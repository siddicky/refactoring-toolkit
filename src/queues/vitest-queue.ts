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
// Parsing
// ---------------------------------------------------------------------------

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

/**
 * Record starts: vitest's default reporter `FAIL  path > suite > test` lines,
 * plus cross/tick markers that carry a suite separator (guards against the
 * per-file summary bullets like `× applies discount 12ms`, which lack " > "
 * and would duplicate the detailed FAIL block).
 */
const RECORD_START = /^\s*(?:FAIL\s+\S|[✗×]\s+\S.*\s>\s)/;
const SUMMARY_START = /^\s*(?:Test Files\s|Tests\s|Duration\s|Start at\s)/;

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

  for (const line of clean.split("\n")) {
    if (SUMMARY_START.test(line)) {
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

/** `FAIL  tests/foo.test.ts > Suite > test name` → {testFile, testName}. */
function parseFailHeader(line: string): VitestFailureRecord {
  const rest = line.trim().replace(/^(?:FAIL|[✗×])\s+/, "");
  const separatorIndex = rest.indexOf(" > ");
  if (separatorIndex < 0) {
    return {
      testFile: rest,
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
 * Deterministic file attribution for an already-decided class: the first
 * stack frame under the matching root set (ported roots for "port-caused",
 * fixture roots for "fixture-problem"); null for unknown/other classes.
 * Shared by the naive classifier and the Jev route so the ATTRIBUTION step is
 * always deterministic — only the CLASS is judgment-derived.
 */
export function attributedFileOfClass(
  failure: VitestFailureRecord,
  failureClass: FailureClass,
  roots?: { portedRoots?: readonly string[]; fixtureRoots?: readonly string[] },
): string | null {
  const frames = failure.frames;
  if (failureClass === "port-caused") {
    const portedRoots = roots?.portedRoots ?? DEFAULT_PORTED_ROOTS;
    for (const frame of frames) {
      const root = matchRoot(frame.file, portedRoots);
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

export interface NaiveClassifierOptions {
  /** Path prefixes that belong to the ported TS output. Default: ["src"]. */
  portedRoots?: readonly string[];
  /** Path prefixes belonging to fixture/test-harness files. */
  fixtureRoots?: readonly string[];
  /**
    * Class assigned when no frame matches any known root. Default:
    * "port-caused" — unattributable failures stay visible to the fix loop
    * instead of silently vanishing into the fixture bucket.
    */
  unknown?: FailureClass;
}

export const DEFAULT_PORTED_ROOTS: readonly string[] = ["src"];
export const DEFAULT_FIXTURE_ROOTS: readonly string[] = [
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
 * Attribution mirrors the class decision: the deciding frame's file becomes
 * attributedFile; the unknown case (no frame matched any root) keeps the
 * documented deterministic default — class "port-caused", attributedFile
 * null (visible in the queue state, routable to no per-file feed).
 */
export function createNaiveClassifier(
  options: NaiveClassifierOptions = {},
): FailureClassifier {
  const portedRoots = options.portedRoots ?? DEFAULT_PORTED_ROOTS;
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
