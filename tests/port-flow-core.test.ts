/**
 * Step-execution tests for the core (non-verify) routing/state steps of
 * PortProjectFlow: Dispatch, Lease, Commit, Integrate, Release, Bootstrap.
 *
 * Audit T2 (C92): no test executed these steps, which is where the verified
 * sequential-mode bugs lived (C01 dispatchMode dropped by Release, C02 lease
 * never released). The steps are run for real through a stub dex Context:
 *   - attribute reads are checked against the step's declared
 *     executeLoadAttributeMaps, like dex (an undeclared read throws, which
 *     the live cx5c/cx6 findings hit);
 *   - git work runs on a temp fixture repo (real worktrees, real merges).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StepDecision } from "@superdurable/dex";

import { RESTART_WINDOW_RETRY } from "../flows/port/step-options.js";
import {
  BOOTSTRAP_OP_ID,
  LEASE_SLOT_CAP,
  PortProjectFlow,
  ppBootstrap,
  ppConfig,
  ppDiff,
  ppLease,
  ppMarker,
  ppOut,
  ppPrep,
  ppPrepDiff,
  ppPrepDraft,
  ppPrepSeed,
  ppPrepState,
  ppQueue,
  type BootstrapRecord,
  type CapturedDiff,
  type FileRoundInput,
  type PortQueueState,
  type PortRunInput,
} from "../flows/port-project.js";
import { envelopeEvents, type EnvelopeEvent } from "../flows/steps/envelope.js";
import { git } from "../src/git/exec.js";
import {
  commitLeaseChanges,
  findCommitByOpId,
  InMemoryLeaseStore,
  isWorktreeClean,
  operationId,
  WorktreePool,
  type CompletionMarker,
  type LeaseRecord,
} from "../src/git/worktree.js";
import { declaredLoads, peekAttribute, runStep, seedAttribute, type AttributeStores, type StepLike } from "./support/dex-context.js";

// ---------------------------------------------------------------------------
// Harness: stub dex Context with declared-load enforcement
// ---------------------------------------------------------------------------

const run = (stores: AttributeStores, step: StepLike, input: unknown) =>
  runStep(stores, step, input, { flowId: "t2-flow-core", runId: "t2-run" });

function nextOf(decision: StepDecision): { step: unknown; input: Record<string, unknown> } {
  if (decision.kind !== "next") throw new Error(`expected a next decision, got ${decision.kind}`);
  const movement = decision.movements[0];
  if (movement === undefined) throw new Error("decision carries no movement");
  return { step: movement.step, input: movement.input as Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const roots: string[] = [];

afterEach(async () => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

/**
 * Temp repo whose integration worktree is ALREADY bootstrapped (package.json,
 * tsconfig, vitest config, gitignore committed; node_modules/.bin/vitest
 * present and ignored), so BootstrapStep is a deterministic no-op with no
 * network or install.
 */
async function makeBootstrappedRepo(): Promise<{
  repo: string;
  worktreeRoot: string;
  integration: string;
}> {
  const repo = await mkdtemp(join(tmpdir(), "porting-kit-flowcore-"));
  roots.push(repo);
  const runner = git(repo);
  await runner.run(["init", "-b", "main"]);
  await writeFile(join(repo, "README.md"), "fixture repo\n");
  await writeFile(
    join(repo, "package.json"),
    JSON.stringify({ type: "module", scripts: { test: "vitest run" }, devDependencies: { vitest: "^3.2.4" } }),
  );
  await writeFile(join(repo, "tsconfig.json"), "{}\n");
  await writeFile(join(repo, "vitest.config.ts"), "export default {};\n");
  await writeFile(join(repo, ".gitignore"), "node_modules/\n.worktrees/\n");
  await runner.run(["add", "-A"]);
  await runner.run(["commit", "-m", "fixture init"]);

  const worktreeRoot = join(repo, ".worktrees");
  const integration = join(worktreeRoot, "integration");
  await runner.run(["branch", "integration", "HEAD"]);
  await runner.run(["worktree", "add", integration, "integration"]);
  await mkdir(join(integration, "node_modules", ".bin"), { recursive: true });
  await writeFile(join(integration, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");
  return { repo, worktreeRoot, integration };
}

function runInput(
  fx: { repo: string; worktreeRoot: string; integration: string },
  files: string[],
  overrides: Partial<PortRunInput> = {},
): PortRunInput {
  return {
    repoRoot: fx.repo,
    worktreeRoot: fx.worktreeRoot,
    integrationWorktreePath: fx.integration,
    epoch: 1,
    sourceRoot: join(fx.repo, "src-php"),
    prepPath: join(fx.repo, "stub-prep.md"),
    files,
    maxRounds: 2,
    ...overrides,
  };
}

const OUT_PATHS: Record<string, string> = {
  "src/A.php": "src/a.ts",
  "src/B.php": "src/b.ts",
  "src/C.php": "src/c.ts",
};

function seedRun(stores: AttributeStores, files: string[]): void {
  seedAttribute(stores, ppConfig, "config", { maxRounds: 2, prepMaxRounds: 2 });
  seedAttribute(stores, ppQueue, "queue", { pending: [...files], current: null, done: [], blocked: [] } satisfies PortQueueState);
  seedAttribute(stores, ppPrep, "prep", {
    raw: "",
    sourceMap: Object.fromEntries(Object.entries(OUT_PATHS).map(([php, outPath]) => [php, { outPath, notes: "" }])),
    symbolTable: [],
  });
}

/** What LeaseStep hands the pipeline: a FileRoundInput built by spreading the run input. */
function friOf(input: PortRunInput, file: string, worktreePath: string, branch: string): FileRoundInput {
  return { ...input, file, round: 1, worktreePath, branch } as FileRoundInput;
}

// ---------------------------------------------------------------------------
// C01: ReleaseStep keeps the run-level fields (dispatchMode survives)
// ---------------------------------------------------------------------------

describe("C01: dispatchMode survives Release -> Bootstrap -> Dispatch", () => {
  const input: PortRunInput = {
    repoRoot: "/r",
    worktreeRoot: "/r/.wt",
    integrationWorktreePath: "/r/.wt/integration",
    epoch: 3,
    sourceRoot: "/r/php",
    prepPath: "/r/stub-prep.md",
    files: ["src/A.php", "src/B.php"],
    maxRounds: 4,
    dispatchMode: "sequential",
  };

  test("ReleaseStep output keeps dispatchMode, maxRounds, prepPath and files from the run input", async () => {
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    seedAttribute(stores, ppQueue, "queue", {
      pending: ["src/B.php"],
      current: { file: "src/A.php", round: 1, epoch: 3 },
      done: [],
      blocked: [],
    } satisfies PortQueueState);
    const fri = friOf(input, "src/A.php", "/r/.wt/A-3", "lease/A/3");

    const decision = await run(stores, flow.release, fri);
    const next = nextOf(decision);
    expect(next.step).toBe(flow.bootstrap.constructor);
    expect(next.input.dispatchMode).toBe("sequential");
    expect(next.input.maxRounds).toBe(4);
    expect(next.input.prepPath).toBe("/r/stub-prep.md");
    expect(next.input.files).toEqual(["src/A.php", "src/B.php"]);
  });

  test("Dispatch on Release's output claims the NEXT file sequentially instead of routing to a parallel wave", async () => {
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    seedAttribute(stores, ppConfig, "config", { maxRounds: 4, prepMaxRounds: 2 });
    seedAttribute(stores, ppQueue, "queue", {
      pending: ["src/B.php"],
      current: { file: "src/A.php", round: 1, epoch: 3 },
      done: [],
      blocked: [],
    } satisfies PortQueueState);

    const released = nextOf(await run(stores, flow.release, friOf(input, "src/A.php", "/r/.wt/A-3", "lease/A/3")));
    const dispatched = await run(stores, flow.dispatch, released.input);
    const next = nextOf(dispatched);

    // Sequential: Dispatch claims B itself and hands off to LeaseStep.
    expect(next.step).toBe(flow.lease.constructor);
    const queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue");
    expect(queue?.current).toEqual({ file: "src/B.php", round: 1, epoch: 3 });
    expect(queue?.pending).toEqual([]);
    expect(next.input.dispatchMode).toBe("sequential");
  });

  test("a run input without dispatchMode still defaults to parallel waves (default path unchanged)", async () => {
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    seedAttribute(stores, ppConfig, "config", { maxRounds: 4, prepMaxRounds: 2 });
    seedAttribute(stores, ppQueue, "queue", { pending: ["src/B.php"], current: null, done: [], blocked: [] } satisfies PortQueueState);
    const { dispatchMode: _dropped, ...parallelInput } = input;

    const next = nextOf(await run(stores, flow.dispatch, parallelInput));
    expect(next.step).toBe(flow.waveDispatch.constructor);
    expect(next.input.mode).toBe("port");
    // Parallel dispatch never claims a file itself: pending is consumed by the wave join.
    expect(peekAttribute<PortQueueState>(stores, ppQueue, "queue")?.pending).toEqual(["src/B.php"]);
  });
});

// ---------------------------------------------------------------------------
// C02: ReleaseStep releases the lease; 3-file sequential cycle (real git)
// ---------------------------------------------------------------------------

describe("C02: sequential loop releases leases (3 files through a cap of 2)", () => {
  test("LEASE_SLOT_CAP is the pool cap the audit exercised", () => {
    expect(LEASE_SLOT_CAP).toBe(2);
  });

  test("Dispatch -> Lease -> Commit -> Integrate -> Release -> Bootstrap x3: no cap error, leases and worktrees cleaned up", async () => {
    const fx = await makeBootstrappedRepo();
    const files = ["src/A.php", "src/B.php", "src/C.php"];
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    seedRun(stores, files);

    let current: Record<string, unknown> = runInput(fx, files, { dispatchMode: "sequential" }) as unknown as Record<string, unknown>;
    for (const file of files) {
      // Dispatch (sequential) claims the file and routes to Lease.
      const dispatched = nextOf(await run(stores, flow.dispatch, current));
      expect(dispatched.step).toBe(flow.lease.constructor);
      expect(peekAttribute<PortQueueState>(stores, ppQueue, "queue")?.current?.file).toBe(file);

      // Lease acquires a real worktree; one record per file at this epoch.
      const leased = nextOf(await run(stores, flow.lease, dispatched.input));
      expect(leased.step).toBe(flow.fence.constructor);
      const fri = leased.input as unknown as FileRoundInput;
      expect(fri.file).toBe(file);
      expect(Object.keys(peekAttribute<Record<string, LeaseRecord>>(stores, ppLease, "pool") ?? {})).toEqual([file]);

      // The implementer's output, then the sole-committer commit + integrate.
      const outPath = OUT_PATHS[file] as string;
      await mkdir(join(fri.worktreePath, "src"), { recursive: true });
      await writeFile(join(fri.worktreePath, outPath), `export const v = "${file}";\n`);
      seedAttribute(stores, ppOut, `${file.replace(/\//g, "__")}#1`, { outPath });
      const committed = nextOf(await run(stores, flow.commit, fri));
      expect(committed.step).toBe(flow.integrate.constructor);
      const integrated = nextOf(await run(stores, flow.integrate, committed.input));
      expect(integrated.step).toBe(flow.release.constructor);

      // Release gives the slot back and keeps the run options.
      const released = nextOf(await run(stores, flow.release, integrated.input));
      expect(released.step).toBe(flow.bootstrap.constructor);
      expect(released.input.dispatchMode).toBe("sequential");
      expect(peekAttribute<Record<string, LeaseRecord>>(stores, ppLease, "pool")).toEqual({});
      await expect(stat(fri.worktreePath)).rejects.toThrow();

      // Bootstrap is an idempotent no-op on the pre-provisioned checkout.
      const bootstrapped = nextOf(await run(stores, flow.bootstrap, released.input));
      expect(bootstrapped.step).toBe(flow.dispatch.constructor);
      current = bootstrapped.input;
    }

    // Queue exhausted: Dispatch reports done and routes to the verify queue.
    const finalDispatch = nextOf(await run(stores, flow.dispatch, current));
    expect(finalDispatch.step).toBe(flow.queueVerify.constructor);
    const queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue");
    expect(queue?.done.map((d) => d.file)).toEqual(files);
    expect(queue?.done.every((d) => d.commitSha !== null)).toBe(true);
    expect(queue?.blocked).toEqual([]);

    // Every round landed in the one integration output.
    for (const file of files) {
      const content = await readFile(join(fx.integration, OUT_PATHS[file] as string), "utf8");
      expect(content).toContain(file);
    }
    expect(await findCommitByOpId(fx.repo, operationId("src/C.php", 1))).toBeDefined();
  }, 60_000);

  test("ReleaseStep declares ppLease (an undeclared read would throw in dex)", () => {
    const flow = new PortProjectFlow();
    expect(declaredLoads(flow.release)).toContain(ppLease);
  });
});

// ---------------------------------------------------------------------------
// C88: flow git calls go through the src/git/exec.ts hardening
// ---------------------------------------------------------------------------

describe("C88: diff capture uses the hardened git runner", () => {
  test("CaptureDiffStep captures a diff larger than Node's 1 MiB default maxBuffer", async () => {
    const repo = await mkdtemp(join(tmpdir(), "porting-kit-c88-"));
    roots.push(repo);
    const runner = git(repo);
    await runner.run(["init", "-b", "main"]);
    await writeFile(join(repo, "README.md"), "fixture\n");
    await runner.run(["add", "-A"]);
    await runner.run(["commit", "-m", "init"]);
    // ~2.4 MB of added lines: far above the 1 MiB execFile default buffer.
    const big = "export const row = 'x'.repeat(80);\n".repeat(75_000);
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "src", "big.ts"), big);

    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    const fx = { repo, worktreeRoot: join(repo, ".wt"), integration: join(repo, ".wt", "i") };
    const fri = friOf(runInput(fx, ["src/A.php"]), "src/A.php", repo, "main");
    const decision = await run(stores, flow.captureDiff, fri);
    expect(nextOf(decision).step).toBe(flow.reviewAStart.constructor);

    const captured = peekAttribute<CapturedDiff>(stores, ppDiff, "src__A.php#1");
    expect(captured).toBeDefined();
    expect(captured?.raw.length).toBeGreaterThan(1024 * 1024);
    expect(captured?.raw).toContain("+++ b/src/big.ts");
  }, 60_000);
});

describe("C88: PrepDiffCapture no longer swallows failures of its diff command", () => {
  const prepInput = (): PortRunInput => ({
    repoRoot: "/r",
    worktreeRoot: "/r/.wt",
    integrationWorktreePath: "/r/.wt/integration",
    epoch: 1,
    sourceRoot: "/r/php",
    prepPath: "/r/stub-prep.md",
    files: ["src/A.php"],
    maxRounds: 2,
  });

  function prepStores(stubRaw: string, specText: string): AttributeStores {
    const stores: AttributeStores = new Map();
    seedAttribute(stores, ppPrepDraft, "draft", { specText, iteration: 0 });
    seedAttribute(stores, ppPrepSeed, "seed", { stubRaw, symbols: [] });
    seedAttribute(stores, ppPrepState, "state", { prepIteration: 0 });
    return stores;
  }

  test("differing baseline and spec (exit 1) yield the real unified diff", async () => {
    const flow = new PortProjectFlow();
    const stores = prepStores("# baseline\nold line\n", "# baseline\nnew line\n");
    const decision = await run(stores, flow.prepDiffCapture, prepInput());
    expect(nextOf(decision).step).toBe(flow.prepReviewAStart.constructor);
    const diff = peekAttribute<{ raw: string; doc: { hunks: unknown[] } }>(stores, ppPrepDiff, "diff");
    expect(diff?.raw).toContain("-old line");
    expect(diff?.raw).toContain("+new line");
    expect(diff?.doc.hunks.length).toBe(1);
  });

  test("identical baseline and spec (exit 0) yield an empty diff, not an error", async () => {
    const flow = new PortProjectFlow();
    const stores = prepStores("same\n", "same\n");
    await run(stores, flow.prepDiffCapture, prepInput());
    const diff = peekAttribute<{ raw: string; doc: { hunks: unknown[] } }>(stores, ppPrepDiff, "diff");
    expect(diff?.raw).toBe("");
    expect(diff?.doc.hunks).toEqual([]);
  });

  test("a hard failure (exit >= 2, nothing on stdout) fails the step instead of becoming an empty diff", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "porting-kit-fakebin-"));
    roots.push(binDir);
    await writeFile(join(binDir, "git"), "#!/bin/sh\necho 'fatal: simulated failure' >&2\nexit 2\n");
    await chmod(join(binDir, "git"), 0o755);
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}:${originalPath ?? ""}`;
    try {
      const flow = new PortProjectFlow();
      const stores = prepStores("a\n", "b\n");
      await expect(run(stores, flow.prepDiffCapture, prepInput())).rejects.toThrow(/prep diff failed.*simulated failure/);
      expect(peekAttribute(stores, ppPrepDiff, "diff")).toBeUndefined();
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  });
});

// ---------------------------------------------------------------------------
// C92: the remaining core steps, arm by arm
// ---------------------------------------------------------------------------

function completedEnvelope(stores: AttributeStores): EnvelopeEvent | undefined {
  return ([...(stores.get(envelopeEvents)?.values() ?? [])] as EnvelopeEvent[]).find((e) => e.ended_at !== null);
}

const ROUND1_OPID = operationId("src/A.php", 1);

describe("C92: DispatchStep arms", () => {
  const base: PortRunInput = {
    repoRoot: "/r",
    worktreeRoot: "/r/.wt",
    integrationWorktreePath: "/r/.wt/integration",
    epoch: 4,
    sourceRoot: "/r/php",
    prepPath: "/r/stub-prep.md",
    files: ["src/A.php", "src/B.php"],
    maxRounds: 2,
    dispatchMode: "sequential",
  };

  function dispatchStores(queue: PortQueueState, maxRounds = 2): AttributeStores {
    const stores: AttributeStores = new Map();
    seedAttribute(stores, ppConfig, "config", { maxRounds, prepMaxRounds: 2 });
    seedAttribute(stores, ppQueue, "queue", queue);
    return stores;
  }

  test("sequential start: claims the first pending file at the run epoch and routes to Lease", async () => {
    const flow = new PortProjectFlow();
    const stores = dispatchStores({ pending: ["src/A.php", "src/B.php"], current: null, done: [], blocked: [] });
    const next = nextOf(await run(stores, flow.dispatch, base));
    expect(next.step).toBe(flow.lease.constructor);
    expect(next.input.done).toBe(false);
    expect(peekAttribute<PortQueueState>(stores, ppQueue, "queue")).toEqual({
      pending: ["src/B.php"],
      current: { file: "src/A.php", round: 1, epoch: 4 },
      done: [],
      blocked: [],
    });
    expect(completedEnvelope(stores)?.outcome).toBe("completed");
  });

  test("sequential resume: an in-flight file (kill mid-file) stays current; pending is untouched", async () => {
    const flow = new PortProjectFlow();
    const queue: PortQueueState = {
      pending: ["src/B.php"],
      current: { file: "src/A.php", round: 1, epoch: 3 },
      done: [],
      blocked: [],
    };
    const stores = dispatchStores(queue);
    const next = nextOf(await run(stores, flow.dispatch, base));
    expect(next.step).toBe(flow.lease.constructor);
    expect(peekAttribute<PortQueueState>(stores, ppQueue, "queue")).toEqual(queue);
  });

  test("an empty queue routes to the verify queue with done=true in both modes", async () => {
    const flow = new PortProjectFlow();
    const empty: PortQueueState = { pending: [], current: null, done: [], blocked: [] };
    for (const dispatchMode of ["sequential", "parallel"] as const) {
      const stores = dispatchStores(empty);
      const next = nextOf(await run(stores, flow.dispatch, { ...base, dispatchMode }));
      expect(next.step).toBe(flow.queueVerify.constructor);
      expect(next.input.done).toBe(true);
    }
  });

  test("blocked: an in-flight file past the round cap moves to blocked with its reason (outcome skipped)", async () => {
    const flow = new PortProjectFlow();
    const stores = dispatchStores(
      { pending: ["src/B.php"], current: { file: "src/A.php", round: 3, epoch: 4 }, done: [], blocked: [] },
      2,
    );
    await run(stores, flow.dispatch, base);
    const queue = peekAttribute<PortQueueState>(stores, ppQueue, "queue");
    expect(queue?.blocked).toEqual([{ file: "src/A.php", round: 3, reason: "round cap 2 exceeded" }]);
    expect(queue?.current).toBeNull();
    expect(completedEnvelope(stores)?.outcome).toBe("skipped");
  });
});

describe("C92: LeaseStep arms", () => {
  const input: PortRunInput = {
    repoRoot: "/nonexistent-repo",
    worktreeRoot: "/nonexistent-repo/.wt",
    integrationWorktreePath: "/nonexistent-repo/.wt/integration",
    epoch: 1,
    sourceRoot: "/r/php",
    prepPath: "/r/stub-prep.md",
    files: ["src/A.php"],
    maxRounds: 2,
    dispatchMode: "sequential",
  };
  const lease = (file: string, epoch: number): LeaseRecord => ({
    file,
    worktreePath: `/nonexistent-repo/.wt/${file.replace(/\//g, "_")}-${epoch}`,
    branch: `lease/${file}/${epoch}`,
    epoch,
    baseSha: "abc",
    holderExecutionId: `pp-${epoch}`,
    acquiredAtUtc: "2026-09-30T00:00:00.000Z",
  });

  test("a queue exhausted between dispatch and lease ends gracefully (skipped -> Final), not an error loop", async () => {
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    seedAttribute(stores, ppQueue, "queue", { pending: [], current: null, done: [], blocked: [] } satisfies PortQueueState);
    const next = nextOf(await run(stores, flow.lease, input));
    expect(next.step).toBe(flow.final.constructor);
    expect(completedEnvelope(stores)?.outcome).toBe("skipped");
  });

  test("a current-epoch lease surviving a kill is reused (no git, no second acquire)", async () => {
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    seedAttribute(stores, ppQueue, "queue", { pending: [], current: { file: "src/A.php", round: 1, epoch: 1 }, done: [], blocked: [] } satisfies PortQueueState);
    seedAttribute(stores, ppLease, "pool", { "src/A.php": lease("src/A.php", 1) });
    const next = nextOf(await run(stores, flow.lease, input));
    expect(next.step).toBe(flow.fence.constructor);
    expect(next.input.worktreePath).toBe(lease("src/A.php", 1).worktreePath);
    expect(next.input.branch).toBe("lease/src/A.php/1");
    expect(next.input.dispatchMode).toBe("sequential"); // run fields ride the file-round
  });

  test("a genuine overload still fails loudly: a third live lease at the epoch is refused by the pool cap", async () => {
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    seedAttribute(stores, ppQueue, "queue", { pending: [], current: { file: "src/C.php", round: 1, epoch: 1 }, done: [], blocked: [] } satisfies PortQueueState);
    seedAttribute(stores, ppLease, "pool", { "src/A.php": lease("src/A.php", 1), "src/B.php": lease("src/B.php", 1) });
    await expect(run(stores, flow.lease, input)).rejects.toThrow(/lease failed for src\/C\.php: worktree cap \(2\) reached/);
  });

  test("a stale-epoch lease (recovery bumped the epoch) is reclaimed and re-acquired at the new epoch", async () => {
    const fx = await makeBootstrappedRepo();
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    const run1 = runInput(fx, ["src/A.php"], { dispatchMode: "sequential" });
    seedAttribute(stores, ppQueue, "queue", { pending: [], current: { file: "src/A.php", round: 1, epoch: 1 }, done: [], blocked: [] } satisfies PortQueueState);
    const first = nextOf(await run(stores, flow.lease, run1));
    const firstPath = first.input.worktreePath as string;
    await stat(firstPath); // the epoch-1 worktree exists

    seedAttribute(stores, ppQueue, "queue", { pending: [], current: { file: "src/A.php", round: 1, epoch: 2 }, done: [], blocked: [] } satisfies PortQueueState);
    const second = nextOf(await run(stores, flow.lease, { ...run1, epoch: 2 }));
    expect(second.input.epoch).toBe(2);
    expect(second.input.branch).toContain("/2");
    const table = peekAttribute<Record<string, LeaseRecord>>(stores, ppLease, "pool") ?? {};
    expect(Object.values(table).map((l) => l.epoch)).toEqual([2]);
    await expect(stat(firstPath)).rejects.toThrow(); // the stale worktree was reclaimed
  }, 60_000);
});

describe("C92: sequential fix round re-leases a released file on its kept branch (C02 regression guard)", () => {
  test("Release -> queue verify sets current round 2 -> Lease acquires a fresh worktree that already holds the round-1 commit", async () => {
    const fx = await makeBootstrappedRepo();
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    seedRun(stores, ["src/A.php"]);

    let current: Record<string, unknown> = runInput(fx, ["src/A.php"], { dispatchMode: "sequential" }) as unknown as Record<string, unknown>;
    const dispatched = nextOf(await run(stores, flow.dispatch, current));
    const leased = nextOf(await run(stores, flow.lease, dispatched.input));
    const fri = leased.input as unknown as FileRoundInput;
    await mkdir(join(fri.worktreePath, "src"), { recursive: true });
    await writeFile(join(fri.worktreePath, "src/a.ts"), "export const a = 1;\n");
    seedAttribute(stores, ppOut, "src__A.php#1", { outPath: "src/a.ts" });
    const committed = nextOf(await run(stores, flow.commit, fri));
    const integrated = nextOf(await run(stores, flow.integrate, committed.input));
    const released = nextOf(await run(stores, flow.release, integrated.input));
    current = released.input;
    await expect(stat(fri.worktreePath)).rejects.toThrow();

    // What QueueVerifyStep does for a fixable file in sequential mode.
    seedAttribute(stores, ppQueue, "queue", {
      ...(peekAttribute<PortQueueState>(stores, ppQueue, "queue") as PortQueueState),
      current: { file: "src/A.php", round: 2, epoch: 1 },
    });
    const released2 = nextOf(await run(stores, flow.lease, current));
    const fri2 = released2.input as unknown as FileRoundInput;
    expect(fri2.round).toBe(2);
    expect(fri2.worktreePath).toBe(fri.worktreePath); // same path, re-created
    expect(await readFile(join(fri2.worktreePath, "src/a.ts"), "utf8")).toBe("export const a = 1;\n");
  }, 60_000);
});

describe("C92: CommitStep", () => {
  test("a dirty worktree with no keyed commit commits the implementer's output (why reconcile() is not wired in here)", async () => {
    const fx = await makeBootstrappedRepo();
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    const pool = new WorktreePool(fx.repo, fx.worktreeRoot, new InMemoryLeaseStore(), LEASE_SLOT_CAP);
    const acquired = await pool.acquire("src/A.php", 1, "pp-1");
    if (!acquired.acquired) throw new Error(acquired.reason);
    const fri = friOf(runInput(fx, ["src/A.php"]), "src/A.php", acquired.lease.worktreePath, acquired.lease.branch);
    await mkdir(join(fri.worktreePath, "src"), { recursive: true });
    await writeFile(join(fri.worktreePath, "src/a.ts"), "export const a = 1;\n");
    // Dirty by design: reconcile()'s `redone` arm would `reset --hard` this away.
    expect((await git(fri.worktreePath).run(["status", "--porcelain"])).trim().length).toBeGreaterThan(0);

    const decision = await run(stores, flow.commit, fri);
    expect(nextOf(decision).step).toBe(flow.integrate.constructor);
    const marker = peekAttribute<CompletionMarker>(stores, ppMarker, "src__A.php#1");
    expect(marker?.disposition).toBe(`committed:${ROUND1_OPID}`);
    const head = (await git(fri.worktreePath).run(["rev-parse", "HEAD"])).trim();
    expect(marker?.sha).toBe(head);
    expect((await git(fri.worktreePath).run(["show", "HEAD:src/a.ts"])).trim()).toBe("export const a = 1;");
    expect(completedEnvelope(stores)?.outcome).toBe("completed");
  }, 60_000);

  test("an empty diff records the no-op disposition (outcome skipped) and commits nothing", async () => {
    const fx = await makeBootstrappedRepo();
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    const fri = friOf(runInput(fx, ["src/A.php"]), "src/A.php", fx.integration, "integration");
    await run(stores, flow.commit, fri);
    const marker = peekAttribute<CompletionMarker>(stores, ppMarker, "src__A.php#1");
    expect(marker?.disposition).toBe("no-op-empty-diff");
    expect(marker?.sha ?? null).toBeNull();
    expect(completedEnvelope(stores)?.outcome).toBe("skipped");
    expect(await findCommitByOpId(fx.repo, ROUND1_OPID)).toBeUndefined();
  }, 60_000);
});

describe("C92: IntegrateStep", () => {
  async function committedLease(fx: { repo: string; worktreeRoot: string }): Promise<{ branch: string; sha: string }> {
    const pool = new WorktreePool(fx.repo, fx.worktreeRoot, new InMemoryLeaseStore(), LEASE_SLOT_CAP);
    const acquired = await pool.acquire("src/A.php", 1, "pp-1");
    if (!acquired.acquired) throw new Error(acquired.reason);
    await mkdir(join(acquired.lease.worktreePath, "src"), { recursive: true });
    await writeFile(join(acquired.lease.worktreePath, "src/a.ts"), "export const a = 1;\n");
    const res = await commitLeaseChanges(acquired.lease.worktreePath, ROUND1_OPID, "round 1");
    if (res.sha === null) throw new Error("expected a keyed commit");
    return { branch: acquired.lease.branch, sha: res.sha };
  }

  test("merges the round's lease branch into integration and routes to Release", async () => {
    const fx = await makeBootstrappedRepo();
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    const { branch, sha } = await committedLease(fx);
    const fri = friOf(runInput(fx, ["src/A.php"]), "src/A.php", "/unused", branch);
    const next = nextOf(await run(stores, flow.integrate, fri));
    expect(next.step).toBe(flow.release.constructor);
    const tip = (await git(fx.integration).run(["rev-parse", "HEAD"])).trim();
    expect(tip).toBe(sha); // fast-forward
    // Replay is idempotent.
    const again = nextOf(await run(stores, flow.integrate, fri));
    expect(again.step).toBe(flow.release.constructor);
    expect((await git(fx.integration).run(["rev-parse", "HEAD"])).trim()).toBe(sha);
  }, 60_000);

  test("C1 guard: refuses to integrate a branch that lacks the round's keyed commit", async () => {
    const fx = await makeBootstrappedRepo();
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    await committedLease(fx); // the keyed commit lands on lease/src__A.php.../1
    await git(fx.repo).run(["branch", "lacks-the-commit", "main"]);
    const fri = friOf(runInput(fx, ["src/A.php"]), "src/A.php", "/unused", "lacks-the-commit");
    await expect(run(stores, flow.integrate, fri)).rejects.toThrow(/C1: keyed commit .* is NOT reachable from integration/);
  }, 60_000);

  test("no-op round: succeeds only when the integrated output already holds the ported file", async () => {
    const fx = await makeBootstrappedRepo();
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    seedRun(stores, ["src/A.php"]);
    seedAttribute(stores, ppMarker, "src__A.php#1", { round: 1, disposition: "no-op-empty-diff", content_hash: "t" } satisfies CompletionMarker);
    await git(fx.repo).run(["branch", "noop-lease", "main"]);
    const fri = friOf(runInput(fx, ["src/A.php"]), "src/A.php", "/unused", "noop-lease");

    await expect(run(stores, flow.integrate, fri)).rejects.toThrow(/no-op round for src\/A\.php \(output src\/a\.ts\) but integrated output lacks the file/);

    await mkdir(join(fx.integration, "src"), { recursive: true });
    await writeFile(join(fx.integration, "src/a.ts"), "export const a = 1;\n");
    await git(fx.integration).run(["add", "-A"]);
    await git(fx.integration).run(["commit", "-m", "prior round content"]);
    const next = nextOf(await run(stores, flow.integrate, fri));
    expect(next.step).toBe(flow.release.constructor);
  }, 60_000);
});

describe("C92: BootstrapStep", () => {
  test("a provisioned checkout is a no-op: nothing written, no install, outcome skipped, input handed to Dispatch intact", async () => {
    const fx = await makeBootstrappedRepo();
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    const input = runInput(fx, ["src/A.php", "src/B.php"], { dispatchMode: "sequential" });
    const next = nextOf(await run(stores, flow.bootstrap, input));
    expect(next.step).toBe(flow.dispatch.constructor);
    expect(next.input).toEqual(input as unknown as Record<string, unknown>);
    const record = peekAttribute<BootstrapRecord>(stores, ppBootstrap, "bootstrap");
    expect(record).toMatchObject({ wrote: [], installRan: false, committed: false, sha: null });
    expect(completedEnvelope(stores)?.outcome).toBe("skipped");
  }, 60_000);

  test("B1: a replay that finds the scaffold on disk but never committed commits it and records the sha", async () => {
    const fx = await makeBootstrappedRepo();
    // The attempt that died after the install left the runner config uncommitted in the integration worktree.
    await writeFile(join(fx.integration, "vitest.config.ts"), "export default { test: {} };\n");
    expect(await isWorktreeClean(fx.integration)).toBe(false);

    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map();
    const next = nextOf(await run(stores, flow.bootstrap, runInput(fx, ["src/A.php"], { dispatchMode: "sequential" })));
    expect(next.step).toBe(flow.dispatch.constructor);
    const record = peekAttribute<BootstrapRecord>(stores, ppBootstrap, "bootstrap");
    expect(record).toMatchObject({ wrote: [], installRan: false, committed: true });
    expect(record?.sha).toBeString();
    expect((await findCommitByOpId(fx.repo, BOOTSTRAP_OP_ID))?.sha).toBe(record?.sha as string);
    expect(await isWorktreeClean(fx.integration)).toBe(true);
    expect(completedEnvelope(stores)?.outcome).toBe("completed");
  }, 60_000);

  test("B1: the step carries the restart-window retry budget (bun install is the longest non-model step)", () => {
    const options = new PortProjectFlow().bootstrap.getStepOptions?.() as { executeRetry?: unknown } | undefined;
    expect(options?.executeRetry).toEqual(RESTART_WINDOW_RETRY);
  });
});
