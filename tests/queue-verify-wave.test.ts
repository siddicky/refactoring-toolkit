/**
 * T1-flow-verify: EXECUTION tests (stub ctx, real git / real tsc where the
 * behaviour lives there) for the verification + wave steps of
 * flows/port-project.ts — QueueVerifyStep, WaveDispatchStep, WaveJoinStep,
 * ChildLeaseStep and the shared QueueFix step. They assert the durable
 * attribute outputs (pp-verify, queue-burndown, pp-queue, pp-wave, pp-lease),
 * not source text.
 *
 * Covers audit clusters C26 (vitest stderr), C06 (tsc honest accounting),
 * C05 (per-file error cap), C04 (blocked dedupe), C03 (per-entry wave round),
 * C90 (one QueueFix class in both flows) and C92 (the execution-test gap).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncContext } from "@superdurable/dex";

// dex keeps SubFlow result access behind an InvocationContext instance check;
// the stub below is a prototype-derived instance so SubFlow.getConditionResults
// and SubFlow.getFlowId work without a dex server.
import { InvocationContext } from "../node_modules/@superdurable/dex/dist/src/invocation-context.js";

import {
  configurePortHarness,
  PortFileFlow,
  PortProjectFlow,
  ppBurndown,
  ppConfig,
  ppLease,
  ppPrep,
  ppQueue,
  ppVerify,
  ppWave,
  ppWaveChildren,
  queueFixFeedForFile,
  queueVerifyTools,
  runIntegrationBootstrap,
  scaffoldTsconfigText,
  selectFixableFiles,
  tsconfigIncludeFromSourceMap,
  vitestOutcomeFromRun,
  waveEntryRound,
  type PortFileInput,
  type PortQueueState,
  type PortRunInput,
  type PrepArtifact,
  type QueueBurnDownSample,
  type QueueVerifyError,
  type QueueVerifyState,
  type WaveDispatchOutput,
  type WaveDispatchRecord,
} from "../flows/port-project.js";
import { blockedAfterVerify } from "../flows/port/queue-logic.js";
import { envelopeEvents, envelopeStepIdentityOf } from "../flows/steps/envelope.js";
import { sessionFenceMap, type AgentSessionClient } from "../src/harness/opencode.js";
import { git } from "../src/git/exec.js";
import {
  InMemoryLeaseStore,
  WorktreePool,
  commitLeaseChanges,
  findCommitByOpId,
  operationId,
  type LeaseRecord,
} from "../src/git/worktree.js";
import { parseVitestOutput, parseVitestSummary } from "../src/queues/vitest-queue.js";
import { peekAttribute, seedAttribute, stubContext, type AttributeStores } from "./support/dex-context.js";

// ---------------------------------------------------------------------------
// Real vitest 3.2.4 output, captured with `vitest run --reporter default`
// piped through execFile (stdout and stderr SEPARATELY), scratch project paths
// rewritten to /itg. Project: test/price.test.ts (describe-nested test +
// top-level test, both failing, one passing) and test/broken.test.ts (imports
// a module that does not exist -> collection failure).
// ---------------------------------------------------------------------------

const FULL_STDOUT = "\n RUN  v3.2.4 /itg\n\n ❯ test/price.test.ts (3 tests | 2 failed) 5ms\n   × PriceCalculator > applies member discount 4ms\n     → expected 90 to be 80 // Object.is equality\n   ✓ PriceCalculator > non-member pays full 0ms\n   × top-level tax 0ms\n     → expected 120 to be 110 // Object.is equality\n\n Test Files  2 failed (2)\n      Tests  2 failed | 1 passed (3)\n   Start at  00:00:00\n   Duration  457ms\n\n";

const FULL_STDERR = "\n⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  test/broken.test.ts [ test/broken.test.ts ]\nError: Cannot find module '../src/does-not-exist' imported from '/itg/test/broken.test.ts'\n ❯ test/broken.test.ts:2:1\n      1| import { expect, test } from \"vitest\";\n      2| import { missing } from \"../src/does-not-exist\";\n       | ^\n      3| \n      4| test(\"never runs\", () => {\n\nCaused by: Error: Failed to load url ../src/does-not-exist (resolved id: ../src/does-not-exist) in /itg/test/broken.test.ts. Does the file exist?\n ❯ loadAndTransform node_modules/vite/dist/node/chunks/config.js:22739:33\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯\n\n\n⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  test/price.test.ts > PriceCalculator > applies member discount\nAssertionError: expected 90 to be 80 // Object.is equality\n\n\u001b[32m- Expected\u001b[39m\n\u001b[31m+ Received\u001b[39m\n\n\u001b[32m- 80\u001b[39m\n\u001b[31m+ 90\u001b[39m\n\n ❯ test/price.test.ts:6:33\n      4| describe(\"PriceCalculator\", () => {\n      5|   test(\"applies member discount\", () => {\n      6|     expect(discount(100, true)).toBe(80);\n       |                                 ^\n      7|   });\n      8|   test(\"non-member pays full\", () => {\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯\n\n FAIL  test/price.test.ts > top-level tax\nAssertionError: expected 120 to be 110 // Object.is equality\n\n\u001b[32m- Expected\u001b[39m\n\u001b[31m+ Received\u001b[39m\n\n\u001b[32m- 110\u001b[39m\n\u001b[31m+ 120\u001b[39m\n\n ❯ test/price.test.ts:14:20\n     12| \n     13| test(\"top-level tax\", () => {\n     14|   expect(tax(100)).toBe(110);\n       |                    ^\n     15| });\n     16| \n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯\n\n";

const COLLECT_STDOUT = "\n RUN  v3.2.4 /itg\n\n\n Test Files  1 failed (1)\n      Tests  no tests\n   Start at  00:00:00\n   Duration  457ms\n\n";

const COLLECT_STDERR = "\n⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯\n\n FAIL  test/broken.test.ts [ test/broken.test.ts ]\nError: Cannot find module '../src/does-not-exist' imported from '/itg/test/broken.test.ts'\n ❯ test/broken.test.ts:2:1\n      1| import { expect, test } from \"vitest\";\n      2| import { missing } from \"../src/does-not-exist\";\n       | ^\n      3| \n      4| test(\"never runs\", () => {\n\nCaused by: Error: Failed to load url ../src/does-not-exist (resolved id: ../src/does-not-exist) in /itg/test/broken.test.ts. Does the file exist?\n ❯ loadAndTransform node_modules/vite/dist/node/chunks/config.js:22739:33\n\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯\n\n";

// ---------------------------------------------------------------------------
// Harness: stub ctx + temp checkouts + fake tools
// ---------------------------------------------------------------------------

function store(): AttributeStores {
  return new Map();
}

const ctxOver = (stores: AttributeStores, attempt = 1) => stubContext(stores, { flowId: "t1-flow-verify", attempt });

interface FakeChild {
  status: "completed" | "running";
  receipt?: { file: string; round: number; commitSha: string | null; treeHash: string | null };
}

/**
 * A real dex InvocationContext instance (so SubFlow.getConditionResults /
 * getFlowId run their real code) whose sub-flow results are synthetic and
 * whose attribute access is the same in-memory stub.
 */
function subFlowCtx(stores: AttributeStores, children: readonly FakeChild[]): AsyncContext {
  const encoder = new TextEncoder();
  const attributes = stubContext(stores);
  const ctx = Object.create(InvocationContext.prototype) as Record<string, unknown>;
  Object.assign(ctx, {
    method: "execute",
    attempt: 1,
    flowId: "t1-parent",
    stepExecutionId: "se-1",
    conditionResults: {
      subFlowResults: children.map((child) => ({
        flowStatus: child.status === "completed" ? 2 : 1,
        errorType: 0,
        errorMessage: "",
        results:
          child.receipt === undefined
            ? []
            : [
                {
                  completedStepType: "PpChildRelease",
                  completedStepExecutionId: "child-release",
                  completedStepOutput: {
                    kind: {
                      $case: "objValue",
                      value: { encoding: "json", payload: encoder.encode(JSON.stringify(child.receipt)) },
                    },
                  },
                },
              ],
      })),
    },
    getAttribute: attributes.getAttribute,
    setAttribute: attributes.setAttribute,
  });
  return ctx as unknown as AsyncContext;
}

interface Decision {
  kind: string;
  movements?: Array<{ step: unknown; input: unknown }>;
}

function routedTo(decision: unknown): unknown {
  return (decision as Decision).movements?.[0]?.step;
}

function routedInput<T>(decision: unknown): T {
  return (decision as Decision).movements?.[0]?.input as T;
}

const tempDirs: string[] = [];
const PRODUCTION_TOOLS = { ...queueVerifyTools };

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `t1-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  Object.assign(queueVerifyTools, PRODUCTION_TOOLS);
  configurePortHarness(undefined as unknown as AgentSessionClient);
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Integrated checkout with an (initially empty) src tree. */
async function makeCheckout(): Promise<string> {
  const dir = await tempDir("checkout");
  await mkdir(join(dir, "src"), { recursive: true });
  return dir;
}

interface FakeBinSpec {
  stdout?: string;
  stderr?: string;
  exit?: number;
  /** Replace the process (so a timeout kill hits the sleeper itself). */
  exec?: string;
}

/** Writes an executable shell script that replays canned stdout/stderr. */
async function writeFakeBin(path: string, spec: FakeBinSpec): Promise<string> {
  const data = await tempDir("fakebin");
  await writeFile(join(data, "stdout"), spec.stdout ?? "");
  await writeFile(join(data, "stderr"), spec.stderr ?? "");
  const script =
    spec.exec !== undefined
      ? `#!/bin/sh\nexec ${spec.exec}\n`
      : `#!/bin/sh\ncat "${join(data, "stdout")}"\ncat "${join(data, "stderr")}" >&2\nexit ${spec.exit ?? 0}\n`;
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, script);
  await chmod(path, 0o755);
  return path;
}

function baseInput(itg: string, over: Partial<PortRunInput> = {}): PortRunInput {
  return {
    repoRoot: itg,
    worktreeRoot: join(itg, ".wt"),
    integrationWorktreePath: itg,
    epoch: 1,
    sourceRoot: itg,
    prepPath: "",
    files: [],
    maxRounds: 3,
    dispatchMode: "parallel",
    ...over,
  };
}

type SourceMap = Record<string, { outPath: string; notes: string }>;

function sourceMapOf(rows: Record<string, string>): SourceMap {
  return Object.fromEntries(Object.entries(rows).map(([php, out]) => [php, { outPath: out, notes: "" }]));
}

function prepOf(sourceMap: SourceMap): PrepArtifact {
  return { raw: "", sourceMap, symbolTable: [] };
}

function seedQueueVerify(
  stores: AttributeStores,
  opts: {
    sourceMap: SourceMap;
    done: Array<{ file: string; round: number }>;
    maxRounds: number;
    blocked?: PortQueueState["blocked"];
  },
): void {
  const queue: PortQueueState = {
    pending: [],
    current: null,
    done: opts.done.map((d) => ({ ...d, commitSha: null, treeHash: null })),
    blocked: opts.blocked ?? [],
  };
  seedAttribute(stores, ppQueue, "queue", queue);
  seedAttribute(stores, ppConfig, "config", { maxRounds: opts.maxRounds, prepMaxRounds: 1 });
  seedAttribute(stores, ppPrep, "prep", prepOf(opts.sourceMap));
}

const projectFlow = new PortProjectFlow();
const fileFlow = new PortFileFlow();

/** `src/<file>(line,1): error TS2322: ...` x count. */
function tscErrorLines(file: string, count: number): string {
  return Array.from(
    { length: count },
    (_, i) => `${file}(${i + 1},1): error TS2322: Type 'string' is not assignable to type 'number'.`,
  ).join("\n");
}

// ===========================================================================
// C06: honest tsc accounting (Contract A)
// ===========================================================================

describe("QueueVerifyStep: tsc run accounting (C06)", () => {
  const MAP = sourceMapOf({ "src/A.php": "src/a.ts" });
  const DONE = [{ file: "src/A.php", round: 1 }];

  test("real tsc with no inputs (TS18003) is NOT-RUN on the tsc total row, never a bare 0", async () => {
    const itg = await makeCheckout(); // empty src/: the scaffold include matches nothing
    const stores = store();
    seedQueueVerify(stores, { sourceMap: MAP, done: DONE, maxRounds: 2 });

    const decision = await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const row = peekAttribute<QueueBurnDownSample>(stores, ppBurndown, "tsc-1");
    expect(row?.file).toBeNull();
    expect(row?.error_count).toBe(0);
    expect(row?.tsc?.state).toBe("not-run");
    expect(row?.tsc?.exit_code).toBe(2);
    expect(row?.tsc?.unlocated).toBe(1);
    expect(row?.tsc?.reason).toContain("tsc exited 2 with no located diagnostics");
    expect(row?.tsc?.reason).toContain("TS18003");
    const verify = peekAttribute<QueueVerifyState>(stores, ppVerify, "verify");
    expect(verify?.tscRun).toEqual(row?.tsc);
    expect(routedTo(decision)).toBe(projectFlow.final.constructor);
  }, 60_000);

  test("real tsc, clean project: RAN with exit 0 (a genuine zero)", async () => {
    const itg = await makeCheckout();
    await writeFile(join(itg, "src", "a.ts"), "export const a: number = 1;\n");
    const stores = store();
    seedQueueVerify(stores, { sourceMap: MAP, done: DONE, maxRounds: 2 });

    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const row = peekAttribute<QueueBurnDownSample>(stores, ppBurndown, "tsc-1");
    expect(row?.tsc).toEqual({ state: "ran", reason: null, exit_code: 0, unlocated: 0 });
    expect(row?.error_count).toBe(0);
  }, 60_000);

  test("real tsc: a source map with output OUTSIDE src/test/tests still typechecks (derived include)", async () => {
    const itg = await makeCheckout();
    await mkdir(join(itg, "lib"), { recursive: true });
    await writeFile(join(itg, "lib", "a.ts"), "export const a: number = 'nope';\n");
    const stores = store();
    seedQueueVerify(stores, { sourceMap: sourceMapOf({ "src/A.php": "lib/a.ts" }), done: DONE, maxRounds: 2 });

    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const row = peekAttribute<QueueBurnDownSample>(stores, ppBurndown, "tsc-1");
    // With the fixed default globs tsc reported TS18003 here (no inputs) and
    // the run read as a vacuous pass; the derived include sees lib/.
    expect(row?.tsc?.state).toBe("ran");
    expect(row?.error_count).toBe(1);
    const verify = peekAttribute<QueueVerifyState>(stores, ppVerify, "verify");
    expect(verify?.fixQueue).toEqual([{ file: "src/A.php", fromRound: 1 }]);
  }, 60_000);

  test("missing tsc binary (ENOENT) is NOT-RUN", async () => {
    const itg = await makeCheckout();
    queueVerifyTools.tscBin = join(itg, "no-such-tsc");
    const stores = store();
    seedQueueVerify(stores, { sourceMap: MAP, done: DONE, maxRounds: 2 });

    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const row = peekAttribute<QueueBurnDownSample>(stores, ppBurndown, "tsc-1");
    expect(row?.tsc).toEqual({ state: "not-run", reason: "tsc binary not found (ENOENT)", exit_code: null, unlocated: 0 });
    expect(row?.error_count).toBe(0);
  });

  test("a timed-out tsc is NOT-RUN with the timeout in the reason", async () => {
    const itg = await makeCheckout();
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), { exec: "sleep 30" });
    queueVerifyTools.tscTimeoutMs = 1000;
    const stores = store();
    seedQueueVerify(stores, { sourceMap: MAP, done: DONE, maxRounds: 2 });

    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const row = peekAttribute<QueueBurnDownSample>(stores, ppBurndown, "tsc-1");
    expect(row?.tsc?.state).toBe("not-run");
    expect(row?.tsc?.reason).toBe("tsc timed out after 1s");
    expect(row?.tsc?.exit_code).toBeNull();
  }, 30_000);

  test("located diagnostics present: RAN with the real count (and only the total row carries accounting)", async () => {
    const itg = await makeCheckout();
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), {
      stdout: `${tscErrorLines("src/a.ts", 3)}\n`,
      exit: 2,
    });
    const stores = store();
    seedQueueVerify(stores, { sourceMap: MAP, done: DONE, maxRounds: 2 });

    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const total = peekAttribute<QueueBurnDownSample>(stores, ppBurndown, "tsc-1");
    expect(total?.tsc).toEqual({ state: "ran", reason: null, exit_code: 2, unlocated: 0 });
    expect(total?.error_count).toBe(3);
    const perFile = peekAttribute<QueueBurnDownSample>(stores, ppBurndown, "tsc-1-src__a.ts");
    expect(perFile?.file).toBe("src/a.ts");
    expect(perFile?.tsc).toBeUndefined();
  });
});

// ===========================================================================
// C05: per-file cap keeps every fixable file's feed non-empty
// ===========================================================================

describe("QueueVerifyStep: per-file error cap (C05)", () => {
  test("a file whose errors sort past the 80th still gets a fix feed", async () => {
    const itg = await makeCheckout();
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), {
      stdout: `${tscErrorLines("src/a.ts", 85)}\n${tscErrorLines("src/b.ts", 1)}\n`,
      exit: 2,
    });
    const stores = store();
    seedQueueVerify(stores, {
      sourceMap: sourceMapOf({ "src/A.php": "src/a.ts", "src/B.php": "src/b.ts" }),
      done: [
        { file: "src/A.php", round: 1 },
        { file: "src/B.php", round: 1 },
      ],
      maxRounds: 3,
    });

    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const verify = peekAttribute<QueueVerifyState>(stores, ppVerify, "verify");
    expect(verify?.tscTotal).toBe(86); // the TRUE count stays honest
    expect(verify?.fixQueue.map((f) => f.file)).toEqual(["src/A.php", "src/B.php"]);
    // Every file selected for a fix round has something to fix (before the
    // fix b.ts was selected with an EMPTY feed and burned a round as a no-op).
    expect(queueFixFeedForFile(verify, "src/a.ts").errors.length).toBe(80);
    expect(queueFixFeedForFile(verify, "src/b.ts").errors.length).toBe(1);
    const outputs: Record<string, string> = { "src/A.php": "src/a.ts", "src/B.php": "src/b.ts" };
    for (const f of verify?.fixQueue ?? []) {
      const feed = queueFixFeedForFile(verify, outputs[f.file]!);
      expect(feed.errors.length + feed.testFailures.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// C04: blocked list stays deduplicated across iterations
// ===========================================================================

describe("QueueVerifyStep: blocked dedupe across iterations (C04)", () => {
  test("a capped file is blocked once, not re-appended by every later iteration", async () => {
    const itg = await makeCheckout();
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), {
      stdout: `${tscErrorLines("src/a.ts", 1)}\n${tscErrorLines("src/b.ts", 1)}\n`,
      exit: 2,
    });
    const stores = store();
    seedQueueVerify(stores, {
      sourceMap: sourceMapOf({ "src/A.php": "src/a.ts", "src/B.php": "src/b.ts" }),
      // A is already at round 3 == maxRounds with errors remaining (capped);
      // B is at round 1 with errors (fixable) so the loop keeps iterating.
      done: [
        { file: "src/A.php", round: 3 },
        { file: "src/B.php", round: 1 },
      ],
      maxRounds: 3,
    });

    const blockedAfter: string[][] = [];
    for (let iteration = 1; iteration <= 3; iteration++) {
      await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));
      const queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue");
      blockedAfter.push(queue?.blocked.map((b) => b.file) ?? []);
      expect(peekAttribute<QueueVerifyState>(stores, ppVerify, "verify")?.iteration).toBe(iteration);
    }

    expect(blockedAfter).toEqual([["src/A.php"], ["src/A.php"], ["src/A.php"]]);
    const queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue");
    expect(queue?.blocked[0]?.reason).toContain("round cap reached with 1 queue error(s) remaining");
  }, 30_000);

  test("files blocked by an EARLIER stage are not duplicated either; a new capped file is still appended", async () => {
    const itg = await makeCheckout();
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), {
      stdout: `${tscErrorLines("src/a.ts", 1)}\n${tscErrorLines("src/c.ts", 2)}\n`,
      exit: 2,
    });
    const stores = store();
    seedQueueVerify(stores, {
      sourceMap: sourceMapOf({ "src/A.php": "src/a.ts", "src/C.php": "src/c.ts" }),
      done: [
        { file: "src/A.php", round: 2 },
        { file: "src/C.php", round: 2 },
      ],
      maxRounds: 2,
      blocked: [{ file: "src/A.php", round: 2, reason: "round cap reached with 1 queue error(s) remaining" }],
    });

    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue");
    expect(queue?.blocked.map((b) => b.file)).toEqual(["src/A.php", "src/C.php"]);
  });

  test("B3: a file blocked at the cap is unblocked once its errors are gone (another file's fix cleared them)", async () => {
    const itg = await makeCheckout();
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), {
      stdout: `${tscErrorLines("src/a.ts", 1)}\n${tscErrorLines("src/b.ts", 1)}\n`,
      exit: 2,
    });
    const stores = store();
    seedQueueVerify(stores, {
      sourceMap: sourceMapOf({ "src/A.php": "src/a.ts", "src/B.php": "src/b.ts" }),
      // A's errors are B's fault: A is at the cap, B still has a round left.
      done: [
        { file: "src/A.php", round: 2 },
        { file: "src/B.php", round: 1 },
      ],
      maxRounds: 2,
    });

    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));
    let queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue");
    expect(queue?.blocked).toEqual([{ file: "src/A.php", round: 2, reason: "round cap reached with 1 queue error(s) remaining" }]);
    expect(peekAttribute<QueueVerifyState>(stores, ppVerify, "verify")?.fixQueue.map((f) => f.file)).toEqual(["src/B.php"]);

    // B's fix round lands and the typecheck is clean: nothing is left to block A.
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), { exit: 0 });
    queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue") as PortQueueState;
    seedAttribute(stores, ppQueue, "queue", { ...queue, done: [...queue.done, { file: "src/B.php", round: 2, commitSha: null, treeHash: null }] });
    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    expect(peekAttribute<QueueVerifyState>(stores, ppVerify, "verify")?.tscTotal).toBe(0);
    expect(peekAttribute<QueueVerifyState>(stores, ppVerify, "verify")?.fixQueue).toEqual([]);
    expect(peekAttribute<PortQueueState>(stores, ppQueue, "queue")?.blocked).toEqual([]);
  }, 30_000);

  test("B3: a file blocked by DISPATCH (never run) stays blocked whatever the verify run finds", async () => {
    const itg = await makeCheckout();
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), { exit: 0 });
    const stores = store();
    seedQueueVerify(stores, {
      sourceMap: sourceMapOf({ "src/A.php": "src/a.ts" }),
      done: [{ file: "src/A.php", round: 1 }],
      maxRounds: 2,
      blocked: [{ file: "src/Z.php", round: 1, reason: "round cap 0 exceeded" }],
    });

    await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    expect(peekAttribute<PortQueueState>(stores, ppQueue, "queue")?.blocked.map((b) => b.file)).toEqual(["src/Z.php"]);
  });

  test("blockedAfterVerify: re-derives cap entries (fresh count and round), keeps dispatch entries, appends new caps once", () => {
    const prior = [
      { file: "src/Z.php", round: 1, reason: "round cap 0 exceeded" },
      { file: "src/A.php", round: 2, reason: "round cap reached with 3 queue error(s) remaining" },
      { file: "src/A.php", round: 2, reason: "round cap reached with 3 queue error(s) remaining" },
      { file: "src/G.php", round: 2, reason: "round cap reached with 1 queue error(s) remaining" },
    ];
    const capped = [
      { file: "src/A.php", round: 2, count: 1 },
      { file: "src/N.php", round: 3, count: 2 },
    ];
    expect(blockedAfterVerify(prior, capped)).toEqual([
      { file: "src/Z.php", round: 1, reason: "round cap 0 exceeded" },
      { file: "src/A.php", round: 2, reason: "round cap reached with 1 queue error(s) remaining" },
      { file: "src/N.php", round: 3, reason: "round cap reached with 2 queue error(s) remaining" },
    ]);
  });
});

// ===========================================================================
// C26: vitest stdout + stderr (golden, real captured output)
// ===========================================================================

describe("vitest 3.2.4 golden output: FAIL blocks live on stderr (C26)", () => {
  const MERGED = `${FULL_STDOUT}\n${FULL_STDERR}`;

  test("parser: merged streams give the real summary and exactly one record per failure", () => {
    expect(parseVitestSummary(MERGED)?.tests).toEqual({ passed: 1, failed: 2, total: 3 });
    expect(parseVitestSummary(MERGED)?.testFiles).toEqual({ passed: 0, failed: 2, total: 2 });

    const records = parseVitestOutput(MERGED);
    expect(records.map((r) => [r.testFile, r.testName])).toEqual([
      ["test/broken.test.ts", ""],
      ["test/price.test.ts", "PriceCalculator > applies member discount"],
      ["test/price.test.ts", "top-level tax"],
    ]);
    expect(records[0]?.frames[0]).toEqual({ file: "test/broken.test.ts", line: 2, column: 1 });
    expect(records[1]?.frames).toEqual([{ file: "test/price.test.ts", line: 6, column: 33 }]);
    expect(records[2]?.frames).toEqual([{ file: "test/price.test.ts", line: 14, column: 20 }]);
    expect(records[1]?.errorMessage).toContain("AssertionError: expected 90 to be 80");
    expect(records[1]?.errorMessage).not.toContain("⎯");
  });

  test("outcome: stderr is required for records; both streams give ran 1/2/3 and 3 attributable records", () => {
    const withBoth = vitestOutcomeFromRun(true, ["test/price.test.ts"], { stdout: FULL_STDOUT, stderr: FULL_STDERR });
    expect(withBoth.vitestRun).toEqual({ kind: "ran", passed: 1, failed: 2, total: 3 });
    expect(withBoth.records.length).toBe(3);
    expect(withBoth.records.every((r) => r.frames.length > 0)).toBe(true);

    // What the step used to do (stdout only): the summary survives but the
    // detail that makes a failure attributable is gone.
    const stdoutOnly = vitestOutcomeFromRun(true, ["test/price.test.ts"], { stdout: FULL_STDOUT });
    expect(stdoutOnly.vitestRun).toEqual({ kind: "ran", passed: 1, failed: 2, total: 3 });
    expect(stdoutOnly.records.filter((r) => r.frames.length > 0).length).toBe(0);
  });

  test("collection-failure-only run: failed=1 AND one record (stdout alone had summary failed=1 but 0 records)", () => {
    const both = vitestOutcomeFromRun(true, ["test/broken.test.ts"], { stdout: COLLECT_STDOUT, stderr: COLLECT_STDERR });
    expect(both.vitestRun).toEqual({ kind: "ran", passed: 0, failed: 1, total: 1 });
    expect(both.records.length).toBe(1);
    expect(both.records[0]?.testFile).toBe("test/broken.test.ts");
    expect(both.records[0]?.testName).toBe("");

    const stdoutOnly = vitestOutcomeFromRun(true, ["test/broken.test.ts"], { stdout: COLLECT_STDOUT });
    expect(stdoutOnly.vitestRun).toEqual({ kind: "ran", passed: 0, failed: 1, total: 1 });
    expect(stdoutOnly.records.length).toBe(0);
  });

  test("QueueVerifyStep end to end (fake vitest replays the golden streams): failures reach the fix queue with a feed", async () => {
    const itg = await makeCheckout();
    await mkdir(join(itg, "test"), { recursive: true });
    await writeFile(join(itg, "src", "price.ts"), "export const p = 1;\n");
    await writeFile(join(itg, "test", "price.test.ts"), "// ported test\n");
    await writeFile(join(itg, "test", "broken.test.ts"), "// ported test\n");
    await writeFakeBin(join(itg, "node_modules", ".bin", "vitest"), { stdout: FULL_STDOUT, stderr: FULL_STDERR, exit: 1 });
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), { exit: 0 });
    const stores = store();
    seedQueueVerify(stores, {
      sourceMap: sourceMapOf({
        "src/Price.php": "src/price.ts",
        "test/PriceTest.php": "test/price.test.ts",
        "test/BrokenTest.php": "test/broken.test.ts",
      }),
      done: [
        { file: "src/Price.php", round: 1 },
        { file: "test/PriceTest.php", round: 1 },
        { file: "test/BrokenTest.php", round: 1 },
      ],
      maxRounds: 3,
    });

    const decision = await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const verify = peekAttribute<QueueVerifyState>(stores, ppVerify, "verify");
    expect(verify?.vitestRun).toEqual({ kind: "ran", passed: 1, failed: 2, total: 3 });
    expect(verify?.vitestState?.failures.length).toBe(3);
    expect(verify?.vitestState?.classified.every((c) => c.classification.attributedFile !== null)).toBe(true);
    expect(verify?.fixQueue.map((f) => f.file).sort()).toEqual(["test/BrokenTest.php", "test/PriceTest.php"]);
    expect(queueFixFeedForFile(verify, "test/price.test.ts").testFailures.map((t) => t.name)).toEqual([
      "test/price.test.ts > PriceCalculator > applies member discount",
      "test/price.test.ts > top-level tax",
    ]);
    expect(queueFixFeedForFile(verify, "test/broken.test.ts").testFailures.length).toBe(1);
    const vitestRow = peekAttribute<QueueBurnDownSample>(stores, ppBurndown, "vitest-1");
    expect(vitestRow?.error_count).toBe(2);
    expect(vitestRow?.vitest?.state).toBe("ran");
    // Failures exist, so the loop continues into a fix wave instead of Final.
    expect(routedTo(decision)).toBe(projectFlow.waveDispatch.constructor);
  }, 30_000);
});

// ===========================================================================
// B2: a non-zero vitest exit with no failing test is not a clean ran
// ===========================================================================

// Real vitest 3.2.4 output of a project whose two tests pass while one of them
// leaks a rejected promise (`void Promise.reject(...)`): exit code 1, every test
// green, no FAIL block. Captured with stdout and stderr separate; the scratch
// project paths are rewritten to /itg and the dependency frames shortened.
const UNHANDLED_STDOUT =
  "\n RUN  v3.2.4 /itg\n\n ✓ test/a.test.ts (2 tests) 1ms\n\n Test Files  1 passed (1)\n      Tests  2 passed (2)\n     Errors  1 error\n   Start at  00:00:00\n   Duration  193ms\n\n";

const UNHANDLED_STDERR =
  "\n⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯\n\nVitest caught 1 unhandled error during the test run.\nThis might cause false positive tests. Resolve unhandled errors to make sure your tests are not affected.\n\n⎯⎯⎯⎯⎯ Unhandled Rejection ⎯⎯⎯⎯⎯⎯\nError: boom\n ❯ boom src/x.ts:2:23\n      1| export function boom(): void {\n      2|   void Promise.reject(new Error(\"boom\"));\n       |                       ^\n      3| }\n      4| \n ❯ test/a.test.ts:3:19\n ❯ node_modules/@vitest/runner/dist/chunk-hooks.js:155:11\n ❯ runWithTimeout node_modules/@vitest/runner/dist/chunk-hooks.js:1863:10\n\nThis error originated in \"test/a.test.ts\" test file. It doesn't mean the error was thrown inside the file itself, but while it was running.\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n\n";

describe("vitest exit code vs the summary (B2)", () => {
  test("parser: the `Errors  N error` line is read", () => {
    expect(parseVitestSummary(UNHANDLED_STDOUT)?.unhandledErrors).toBe(1);
    expect(parseVitestSummary(FULL_STDOUT)?.unhandledErrors).toBe(0);
  });

  test("exit 1 with every test passing is a failed run with one attributable record, not 'ran 2/2, 0 failed'", () => {
    const out = vitestOutcomeFromRun(true, ["test/a.test.ts"], { stdout: UNHANDLED_STDOUT, stderr: UNHANDLED_STDERR, exitCode: 1 });
    expect(out.vitestRun).toEqual({ kind: "ran", passed: 2, failed: 1, total: 2 });
    expect(out.records.length).toBe(1);
    const record = out.records[0];
    expect(record?.errorMessage).toContain("vitest exited with code 1 although no test failed");
    expect(record?.errorMessage).toContain("1 unhandled error(s), the first: Error: boom");
    expect(record?.testFile).toBe("test/a.test.ts");
    // The frames that can route it to a ported file survive; dependency frames do not.
    expect(record?.frames).toEqual([
      { file: "src/x.ts", line: 2, column: 23 },
      { file: "test/a.test.ts", line: 3, column: 19 },
    ]);
  });

  test("the exit code is what makes it a failure: the same output with no exit code (or exit 0) reads as before", () => {
    const streams = { stdout: UNHANDLED_STDOUT, stderr: UNHANDLED_STDERR };
    for (const run of [streams, { ...streams, exitCode: null }, { ...streams, exitCode: 0 }]) {
      const out = vitestOutcomeFromRun(true, ["test/a.test.ts"], run);
      expect(out.vitestRun).toEqual({ kind: "ran", passed: 2, failed: 0, total: 2 });
      expect(out.records).toEqual([]);
    }
  });

  test("a non-zero exit with no `Errors` line (a threshold, say) is still a failed run, and says so", () => {
    const out = vitestOutcomeFromRun(true, ["test/a.test.ts"], {
      stdout: " Test Files  1 passed (1)\n      Tests  2 passed (2)\n",
      exitCode: 1,
    });
    expect(out.vitestRun).toEqual({ kind: "ran", passed: 2, failed: 1, total: 2 });
    expect(out.records[0]?.errorMessage).toContain("no unhandled error reported");
    expect(out.records[0]?.frames).toEqual([]);
  });

  test("failing tests keep their own accounting: a non-zero exit adds nothing on top of parsed failures", () => {
    const out = vitestOutcomeFromRun(true, ["test/price.test.ts"], { stdout: FULL_STDOUT, stderr: FULL_STDERR, exitCode: 1 });
    expect(out.vitestRun).toEqual({ kind: "ran", passed: 1, failed: 2, total: 3 });
    expect(out.records.length).toBe(3);
  });

  test("QueueVerifyStep end to end (fake vitest replays the real streams, exit 1): the run is unresolved and the ported file is queued for a fix", async () => {
    const itg = await makeCheckout();
    await mkdir(join(itg, "test"), { recursive: true });
    await writeFile(join(itg, "src", "x.ts"), "export function boom(): void {}\n");
    await writeFile(join(itg, "test", "a.test.ts"), "// ported test\n");
    await writeFakeBin(join(itg, "node_modules", ".bin", "vitest"), { stdout: UNHANDLED_STDOUT, stderr: UNHANDLED_STDERR, exit: 1 });
    queueVerifyTools.tscBin = await writeFakeBin(join(await tempDir("tsc"), "tsc"), { exit: 0 });
    const stores = store();
    seedQueueVerify(stores, {
      sourceMap: sourceMapOf({ "src/X.php": "src/x.ts", "test/ATest.php": "test/a.test.ts" }),
      done: [
        { file: "src/X.php", round: 1 },
        { file: "test/ATest.php", round: 1 },
      ],
      maxRounds: 3,
    });

    const decision = await projectFlow.queueVerify.execute(ctxOver(stores), baseInput(itg));

    const verify = peekAttribute<QueueVerifyState>(stores, ppVerify, "verify");
    expect(verify?.vitestRun).toEqual({ kind: "ran", passed: 2, failed: 1, total: 2 });
    expect(verify?.vitestTotal).toBe(1);
    expect(verify?.fixQueue.map((f) => f.file)).toEqual(["src/X.php"]);
    expect(peekAttribute<QueueBurnDownSample>(stores, ppBurndown, "vitest-1")?.error_count).toBe(1);
    expect(routedTo(decision)).toBe(projectFlow.waveDispatch.constructor);
  }, 30_000);
});

// ===========================================================================
// C03: per-entry wave round
// ===========================================================================

function verifyStateOf(fixQueue: QueueVerifyState["fixQueue"], errors: QueueVerifyError[] = []): QueueVerifyState {
  return {
    iteration: 1,
    fixQueue,
    tscTotal: errors.length,
    vitestTotal: 0,
    vitestNote: null,
    lastRunAt: "2026-01-01T00:00:00.000Z",
    errors,
    vitestState: null,
    vitestRun: null,
  };
}

const WAVE_MAP = sourceMapOf({
  "src/a.php": "src/a.ts",
  "src/b.php": "src/b.ts",
  "src/c.php": "src/c.ts",
});

function waveInput(mode: "fix" | "port"): WaveDispatchOutput {
  return { ...baseInput("/unused"), mode };
}

function fixErr(file: string): QueueVerifyError {
  return { file, code: "TS2322", message: "boom", line: 1 };
}

describe("WaveDispatchStep: per-entry rounds (C03)", () => {
  function derivedFixQueue(doneOrder: Array<{ file: string; round: number }>): QueueVerifyState["fixQueue"] {
    const counts = new Map([
      ["src/a.ts", 1],
      ["src/c.ts", 1],
    ]);
    const { fixable } = selectFixableFiles(doneOrder, WAVE_MAP, counts, 5);
    return fixable;
  }

  async function dispatchFix(fixQueue: QueueVerifyState["fixQueue"]): Promise<WaveDispatchRecord> {
    const stores = store();
    seedAttribute(stores, ppQueue, "queue", { pending: [], current: null, done: [], blocked: [] } satisfies PortQueueState);
    seedAttribute(stores, ppPrep, "prep", prepOf(WAVE_MAP));
    seedAttribute(stores, ppVerify, "verify", verifyStateOf(fixQueue, [fixErr("src/a.ts"), fixErr("src/c.ts")]));
    const decision = await projectFlow.waveDispatch.execute(ctxOver(stores), waveInput("fix"));
    expect(routedTo(decision)).toBe(projectFlow.waveJoin.constructor);
    return peekAttribute<WaveDispatchRecord>(stores, ppWave, "wave")!;
  }

  test("higher-round file first (a at round 2, c at round 1): each file gets its OWN next round", async () => {
    const fixQueue = derivedFixQueue([
      { file: "src/a.php", round: 1 },
      { file: "src/b.php", round: 1 },
      { file: "src/c.php", round: 1 },
      { file: "src/a.php", round: 2 },
    ]);
    expect(fixQueue).toEqual([
      { file: "src/a.php", fromRound: 2 },
      { file: "src/c.php", fromRound: 1 },
    ]);

    const wave = await dispatchFix(fixQueue);

    // Before: one round for the whole wave (a's 3), so c skipped round 2.
    expect(wave.entries.map((e) => [e.file, e.round])).toEqual([
      ["src/a.php", 3],
      ["src/c.php", 2],
    ]);
    expect(wave.mode).toBe("fix");
  });

  test("lower-round file first (c at round 1, a at round 2): a is NOT re-dispatched at an already-committed round", async () => {
    const fixQueue = derivedFixQueue([
      { file: "src/c.php", round: 1 },
      { file: "src/a.php", round: 1 },
      { file: "src/a.php", round: 2 },
    ]);
    expect(fixQueue).toEqual([
      { file: "src/c.php", fromRound: 1 },
      { file: "src/a.php", fromRound: 2 },
    ]);

    const wave = await dispatchFix(fixQueue);

    // Before: the wave used c's round 2 for a as well; a's round-2 op-ID
    // already has a keyed commit, so the new fix deduped away.
    expect(wave.entries.map((e) => [e.file, e.round])).toEqual([
      ["src/c.php", 2],
      ["src/a.php", 3],
    ]);
    // The feed stays per file.
    expect(wave.entries[0]?.errors.map((e) => e.file)).toEqual(["src/c.ts"]);
    expect(wave.entries[1]?.errors.map((e) => e.file)).toEqual(["src/a.ts"]);
  });

  test("port wave: entries run at round 1; an empty fix queue is refused", async () => {
    const stores = store();
    seedAttribute(stores, ppQueue, "queue", { pending: ["src/a.php", "src/b.php", "src/c.php"], current: null, done: [], blocked: [] } satisfies PortQueueState);
    seedAttribute(stores, ppPrep, "prep", prepOf(WAVE_MAP));
    await projectFlow.waveDispatch.execute(ctxOver(stores), waveInput("port"));
    const wave = peekAttribute<WaveDispatchRecord>(stores, ppWave, "wave")!;
    expect(wave.entries.map((e) => [e.file, e.round])).toEqual([
      ["src/a.php", 1],
      ["src/b.php", 1],
    ]);
    expect(wave.round).toBe(1);

    const empty = store();
    seedAttribute(empty, ppQueue, "queue", { pending: [], current: null, done: [], blocked: [] } satisfies PortQueueState);
    seedAttribute(empty, ppPrep, "prep", prepOf(WAVE_MAP));
    seedAttribute(empty, ppVerify, "verify", verifyStateOf([]));
    await expect(projectFlow.waveDispatch.execute(ctxOver(empty), waveInput("fix"))).rejects.toThrow("empty fix queue");
  });

  test("waveEntryRound falls back to the wave round for records persisted before C03", () => {
    expect(waveEntryRound({ round: 4 }, {})).toBe(4);
    expect(waveEntryRound({ round: 4 }, { round: 2 })).toBe(2);
  });
});

// ===========================================================================
// WaveJoinStep: waitFor (children per entry round) + join (real git)
// ===========================================================================

async function makeRepoFixture(): Promise<{ repoRoot: string; itg: string }> {
  const repoRoot = await tempDir("repo");
  const runner = git(repoRoot);
  await runner.run(["init", "-b", "main"]);
  await runner.run(["config", "user.email", "t1@example.test"]);
  await runner.run(["config", "user.name", "t1"]);
  await writeFile(join(repoRoot, "README.md"), "fixture\n");
  await runner.run(["add", "-A"]);
  await runner.run(["commit", "-m", "init"]);
  const itg = join(repoRoot, ".worktrees", "integration");
  await runner.run(["worktree", "add", "-b", "integration", itg]);
  return { repoRoot, itg };
}

function waveRecord(entries: Array<{ file: string; round?: number }>, round: number, mode: "fix" | "port" = "fix"): WaveDispatchRecord {
  return {
    entries: entries.map((e) => ({ file: e.file, ...(e.round !== undefined ? { round: e.round } : {}), errors: [], vitest: [] })),
    round,
    mode,
    dispatchedAtUtc: "2026-01-01T00:00:00.000Z",
  };
}

describe("WaveJoinStep (C03)", () => {
  test("waitFor starts each child at its own entry round, with a distinct conditionId", async () => {
    const stores = store();
    seedAttribute(stores, ppPrep, "prep", prepOf(WAVE_MAP));
    seedAttribute(stores, ppWave, "wave", waveRecord([{ file: "src/a.php", round: 3 }, { file: "src/c.php", round: 2 }], 3));

    const wait = (await projectFlow.waveJoin.waitFor!(ctxOver(stores), waveInput("fix"))) as unknown as {
      kind: string;
      conditions: Array<{ subFlowInput: PortFileInput; subFlowOptions: { conditionId: string } }>;
    };

    expect(wait.kind).toBe("allOf");
    expect(wait.conditions.map((c) => [c.subFlowInput.file, c.subFlowInput.round, c.subFlowOptions.conditionId])).toEqual([
      ["src/a.php", 3, "wave-fix-3-0"],
      ["src/c.php", 2, "wave-fix-2-1"],
    ]);
  });

  test("waitFor on a record persisted before C03 (no per-entry round) still uses the wave round", async () => {
    const stores = store();
    seedAttribute(stores, ppPrep, "prep", prepOf(WAVE_MAP));
    seedAttribute(stores, ppWave, "wave", waveRecord([{ file: "src/a.php" }, { file: "src/b.php" }], 2));

    const wait = (await projectFlow.waveJoin.waitFor!(ctxOver(stores), waveInput("fix"))) as unknown as {
      conditions: Array<{ subFlowInput: PortFileInput }>;
    };

    expect(wait.conditions.map((c) => c.subFlowInput.round)).toEqual([2, 2]);
  });

  test("join integrates each child's keyed commit at ITS round and records done(file, entry round)", async () => {
    const { repoRoot, itg } = await makeRepoFixture();
    const pool = new WorktreePool(repoRoot, join(repoRoot, ".worktrees"), new InMemoryLeaseStore(), 2);

    // Two children committed at DIFFERENT rounds: a at round 3, c at round 2.
    const committed: Record<string, string> = {};
    for (const [file, outPath, round] of [
      ["src/a.php", "src/a.ts", 3],
      ["src/c.php", "src/c.ts", 2],
    ] as const) {
      const acquired = await pool.acquire(file, 1, "t1");
      if (!acquired.acquired) throw new Error(acquired.reason);
      await mkdir(join(acquired.lease.worktreePath, "src"), { recursive: true });
      await writeFile(join(acquired.lease.worktreePath, outPath), `export const v = ${round};\n`);
      const res = await commitLeaseChanges(acquired.lease.worktreePath, operationId(file, round), `${file} round ${round}`);
      committed[file] = res.sha ?? "";
      await pool.release(file);
    }

    const stores = store();
    seedAttribute(stores, ppPrep, "prep", prepOf(WAVE_MAP));
    seedAttribute(stores, ppQueue, "queue", { pending: [], current: null, done: [], blocked: [] } satisfies PortQueueState);
    seedAttribute(stores, ppVerify, "verify", verifyStateOf([{ file: "src/a.php", fromRound: 2 }, { file: "src/c.php", fromRound: 1 }]));
    // wave.round is the FIRST entry's round, exactly as WaveDispatch writes it.
    seedAttribute(stores, ppWave, "wave", waveRecord([{ file: "src/a.php", round: 3 }, { file: "src/c.php", round: 2 }], 3));
    const receipt = (file: string, round: number) => ({ file, round, commitSha: committed[file] ?? null, treeHash: null });
    const ctx = subFlowCtx(stores, [
      { status: "completed", receipt: receipt("src/a.php", 3) },
      { status: "completed", receipt: receipt("src/c.php", 2) },
    ]);

    const input: WaveDispatchOutput = { ...baseInput(itg, { repoRoot }), mode: "fix" };
    const decision = await projectFlow.waveJoin.execute(ctx, input);

    const queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue");
    // Before: both entries used wave.round (3), so c's lookup of op-ID
    // `src/c.php#3` missed and the join threw "no-op round ... lacks the file".
    expect(queue?.done.map((d) => [d.file, d.round, d.commitSha ?? undefined])).toEqual([
      ["src/a.php", 3, committed["src/a.php"]],
      ["src/c.php", 2, committed["src/c.php"]],
    ]);
    const children = peekAttribute<{ children: Array<{ file: string; round: number; flowId: string }> }>(stores, ppWaveChildren, "children");
    expect(children?.children.map((c) => [c.file, c.round])).toEqual([["src/a.php", 3], ["src/c.php", 2]]);
    expect(children?.children[0]?.flowId).toBe("SubFlow:t1-parent-se-1-0");
    // Fix-mode join drops the consumed fix-queue entries and re-verifies.
    expect(peekAttribute<QueueVerifyState>(stores, ppVerify, "verify")?.fixQueue).toEqual([]);
    expect(routedTo(decision)).toBe(projectFlow.queueVerify.constructor);
    expect((await findCommitByOpId(repoRoot, operationId("src/c.php", 2)))?.sha).toBe(committed["src/c.php"]);
  }, 60_000);

  test("join: a no-op child (no keyed commit) needs the integrated output; a non-terminal child fails the join", async () => {
    const { repoRoot, itg } = await makeRepoFixture();
    const stores = store();
    seedAttribute(stores, ppPrep, "prep", prepOf(WAVE_MAP));
    seedAttribute(stores, ppQueue, "queue", { pending: ["src/a.php", "src/b.php"], current: null, done: [], blocked: [] } satisfies PortQueueState);
    seedAttribute(stores, ppWave, "wave", waveRecord([{ file: "src/a.php", round: 1 }], 1, "port"));

    const input: WaveDispatchOutput = { ...baseInput(itg, { repoRoot }), mode: "port" };
    const receipt = { file: "src/a.php", round: 1, commitSha: null, treeHash: null };

    // No keyed commit and src/a.ts absent from integration: refuse.
    await expect(
      projectFlow.waveJoin.execute(subFlowCtx(stores, [{ status: "completed", receipt }]), input),
    ).rejects.toThrow("integrated output lacks the file");

    // A running child is not a joinable result.
    await expect(
      projectFlow.waveJoin.execute(subFlowCtx(stores, [{ status: "running" }]), input),
    ).rejects.toThrow("not successfully terminal");

    // With the output integrated, the no-op round is recorded from the receipt.
    await mkdir(join(itg, "src"), { recursive: true });
    await writeFile(join(itg, "src", "a.ts"), "export const a = 1;\n");
    const itgGit = git(itg);
    await itgGit.run(["add", "-A"]);
    await itgGit.run(["commit", "-m", "integrated a"]);
    const decision = await projectFlow.waveJoin.execute(subFlowCtx(stores, [{ status: "completed", receipt }]), input);
    const queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue");
    expect(queue?.done.map((d) => [d.file, d.round])).toEqual([["src/a.php", 1]]);
    expect(queue?.pending).toEqual(["src/b.php"]); // port mode consumes the dispatched entry
    expect(routedTo(decision)).toBe(projectFlow.bootstrap.constructor);
  }, 60_000);
});

// ===========================================================================
// ChildLeaseStep
// ===========================================================================

describe("ChildLeaseStep", () => {
  test("seeds the child's stores by value (per-file cap), takes the lease, and drops the unused error copies", async () => {
    const { repoRoot } = await makeRepoFixture();
    const worktreeRoot = join(repoRoot, ".worktrees");
    const errors: QueueVerifyError[] = Array.from({ length: 100 }, (_, i) => ({
      file: "src/a.ts",
      code: "TS2322",
      message: `error ${i}`,
      line: i + 1,
    }));
    const input: PortFileInput = {
      repoRoot,
      worktreeRoot,
      integrationWorktreePath: join(worktreeRoot, "integration"),
      sourceRoot: repoRoot,
      epoch: 1,
      file: "src/a.php",
      round: 2,
      maxRounds: 3,
      prep: prepOf(WAVE_MAP),
      queueFixErrors: errors,
      queueFixVitest: [],
    };
    const stores = store();

    const decision = await fileFlow.childLease.execute(ctxOver(stores), input);

    expect(routedTo(decision)).toBe(fileFlow.fence.constructor);
    const fri = routedInput<Record<string, unknown>>(decision);
    expect(fri.childFlow).toBe(true);
    expect(fri.file).toBe("src/a.php");
    expect(fri.round).toBe(2);
    expect(String(fri.worktreePath)).toContain(worktreeRoot);
    expect("queueFixErrors" in fri).toBe(false);
    expect("queueFixVitest" in fri).toBe(false);

    const verify = peekAttribute<QueueVerifyState>(stores, ppVerify, "verify");
    expect(verify?.errors.length).toBe(80); // per-file cap constant, was a literal
    expect(verify?.tscTotal).toBe(100);
    expect(verify?.vitestRun).toBeNull();
    expect(verify?.tscRun).toBeUndefined(); // a by-value feed makes no ran/not-run claim
    expect(queueFixFeedForFile(verify, "src/a.ts").errors.length).toBe(80);
    expect(peekAttribute<PrepArtifact>(stores, ppPrep, "prep")?.sourceMap["src/a.php"]?.outPath).toBe("src/a.ts");
    const pool = peekAttribute<Record<string, LeaseRecord>>(stores, ppLease, "pool");
    expect(Object.keys(pool ?? {})).toEqual(["src/a.php"]);
    expect(pool?.["src/a.php"]?.epoch).toBe(1);

    // Replay (same epoch): the held lease is reused, not re-acquired.
    const replay = await fileFlow.childLease.execute(ctxOver(stores), input);
    expect(routedInput<{ worktreePath: string }>(replay).worktreePath).toBe(String(fri.worktreePath));
  }, 60_000);
});

// ===========================================================================
// C90: one QueueFix class for both flows
// ===========================================================================

describe("QueueFix is one step class in both flows (C90)", () => {
  test("port.Project and port.File register the SAME QueueFixStart / QueueFix classes", () => {
    expect(fileFlow.queueFix.constructor).toBe(projectFlow.queueFix.constructor);
    expect(fileFlow.queueFixStart.constructor).toBe(projectFlow.queueFixStart.constructor);
    // The envelope registry, not raw step-type access: the F1 lint
    // (verification-fix-regressions.test.ts) greps source text for that outside the factory.
    const stepTypeOf = (step: object): string => envelopeStepIdentityOf(step)?.stepType ?? "<not a factory step>";
    expect(stepTypeOf(projectFlow.queueFix)).toBe("PpQueueFix");
    expect(stepTypeOf(projectFlow.queueFixStart)).toBe("PpQueueFixStart");
  });

  test("FenceStep routes fix rounds to that one QueueFixStart for parent and child inputs alike", async () => {
    const harness = { createSession: async () => ({ id: "s-1" }) } as unknown as AgentSessionClient;
    configurePortHarness(harness);
    const fri = (childFlow: boolean) => ({
      repoRoot: "/r",
      worktreeRoot: "/w",
      integrationWorktreePath: "/i",
      sourceRoot: "/s",
      epoch: 1,
      file: "src/a.php",
      round: 2,
      worktreePath: "/w/a",
      branch: "lease/a/1",
      ...(childFlow ? { childFlow: true } : {}),
    });
    for (const child of [false, true]) {
      const stores = store();
      const flow = child ? fileFlow : projectFlow;
      const decision = await flow.fence.execute(ctxOver(stores), fri(child));
      expect(routedTo(decision)).toBe(projectFlow.queueFixStart.constructor);
      expect(stores.get(sessionFenceMap)?.size).toBe(1);
    }
    // Round 1 still implements from scratch.
    const round1 = await projectFlow.fence.execute(ctxOver(store()), { ...fri(false), round: 1 });
    expect(routedTo(round1)).toBe(projectFlow.implementStart.constructor);
  });

  test("the shared QueueFix step skips (no agent turn) when a file's feed is empty", async () => {
    const stores = store();
    seedAttribute(stores, ppPrep, "prep", prepOf(WAVE_MAP));
    seedAttribute(stores, ppVerify, "verify", verifyStateOf([], [fixErr("src/other.ts")]));
    const fri = {
      repoRoot: "/r",
      worktreeRoot: "/w",
      integrationWorktreePath: "/i",
      sourceRoot: "/s",
      epoch: 1,
      file: "src/a.php",
      round: 2,
      worktreePath: "/w/a",
      branch: "lease/a/1",
      childFlow: true,
    };

    const decision = await fileFlow.queueFix.execute(ctxOver(stores), fri);

    expect(routedTo(decision)).toBe(fileFlow.captureDiff.constructor);
    // A skip used to THROW here ("provenance failure: step pp-queue-fix (role
    // agent) returned no token usage"): the agent role rejects tokens:null.
    const events = [...(stores.get(envelopeEvents)?.values() ?? [])] as Array<{
      stepId: string;
      outcome: string;
      tokens: number | null;
      ended_at: string | null;
    }>;
    const completed = events.find((e) => e.ended_at !== null);
    expect(completed?.stepId).toBe("pp-queue-fix");
    expect(completed?.outcome).toBe("skipped");
    expect(completed?.tokens).toBe(0);
  });
});

// ===========================================================================
// C06: scaffold tsconfig include derived from the prep source map
// ===========================================================================

describe("scaffold tsconfig include (C06)", () => {
  test("defaults stay; source-map roots outside them are added; unsafe outputs are ignored", () => {
    expect(tsconfigIncludeFromSourceMap({})).toEqual(["src/**/*.ts", "test/**/*.ts", "tests/**/*.ts"]);
    expect(
      tsconfigIncludeFromSourceMap({
        "a.php": { outPath: "./lib/a.ts" },
        "b.php": { outPath: "app/ui/b.tsx" },
        "c.php": { outPath: "main.ts" },
        "d.php": { outPath: "src/d.ts" },
        "e.php": { outPath: "../escape/e.ts" },
        "f.php": { outPath: "/abs/f.ts" },
        "g.php": { outPath: "glob/*.ts" },
      }),
    ).toEqual(["app/**/*.tsx", "lib/**/*.ts", "main.ts", "src/**/*.ts", "test/**/*.ts", "tests/**/*.ts"]);
  });

  test("the bootstrap writes the derived include into a fresh tsconfig (and the old default without one)", async () => {
    const { repoRoot, itg } = await makeRepoFixture();
    const noInstall = { install: async (): Promise<void> => {} };

    const derived = await runIntegrationBootstrap(
      { repoRoot, integrationWorktreePath: itg, tsconfigInclude: tsconfigIncludeFromSourceMap({ "a.php": { outPath: "lib/a.ts" } }) },
      noInstall,
    );
    expect(derived.wrote).toContain("tsconfig.json");
    const written = JSON.parse(await Bun.file(join(itg, "tsconfig.json")).text()) as { include: string[] };
    expect(written.include).toEqual(["lib/**/*.ts", "src/**/*.ts", "test/**/*.ts", "tests/**/*.ts"]);

    const second = await makeRepoFixture();
    await runIntegrationBootstrap({ repoRoot: second.repoRoot, integrationWorktreePath: second.itg }, noInstall);
    expect(await Bun.file(join(second.itg, "tsconfig.json")).text()).toBe(scaffoldTsconfigText());
  }, 60_000);
});
