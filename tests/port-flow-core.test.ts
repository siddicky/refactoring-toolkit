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
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Context, StepDecision } from "@superdurable/dex";

import {
  LEASE_SLOT_CAP,
  PortProjectFlow,
  ppConfig,
  ppLease,
  ppOut,
  ppPrep,
  ppQueue,
  type FileRoundInput,
  type PortQueueState,
  type PortRunInput,
} from "../flows/port-project.js";
import { git } from "../src/git/exec.js";
import { findCommitByOpId, operationId, type LeaseRecord } from "../src/git/worktree.js";

// ---------------------------------------------------------------------------
// Harness: stub dex Context with declared-load enforcement
// ---------------------------------------------------------------------------

type Stores = Map<unknown, Map<string, unknown>>;

interface StepLike {
  getStepOptions?: () => unknown;
  execute: (context: never, input: never) => StepDecision | Promise<StepDecision>;
}

function declaredLoads(step: Pick<StepLike, "getStepOptions">): readonly unknown[] {
  const options = step.getStepOptions?.() as { executeLoadAttributeMaps?: readonly unknown[] } | undefined;
  return options?.executeLoadAttributeMaps ?? [];
}

/** Context stub: reads of attribute maps the step did not declare throw. */
function stubCtx(stores: Stores, step?: Pick<StepLike, "getStepOptions">, attempt = 1): Context {
  const declared = step === undefined ? [] : declaredLoads(step);
  return {
    attempt,
    flowId: "t2-flow-core",
    runId: "t2-run",
    getAttribute: (attr: unknown, instance: string) => {
      if (step !== undefined && !declared.includes(attr)) {
        throw new Error(
          `AttributeMap instance was not loaded: ${(attr as { name?: string }).name ?? "?"}/${instance}`,
        );
      }
      return stores.get(attr)?.get(instance);
    },
    setAttribute: (attr: unknown, value: unknown, instance: string) => {
      let store = stores.get(attr);
      if (store === undefined) {
        store = new Map();
        stores.set(attr, store);
      }
      store.set(instance, value);
    },
  } as unknown as Context;
}

function seed(stores: Stores, attr: unknown, key: string, value: unknown): void {
  let store = stores.get(attr);
  if (store === undefined) {
    store = new Map();
    stores.set(attr, store);
  }
  store.set(key, value);
}

function peek<T>(stores: Stores, attr: unknown, key: string): T | undefined {
  return stores.get(attr)?.get(key) as T | undefined;
}

/** Runs a step the way dex would: declared-load ctx, then execute. */
async function run(stores: Stores, step: StepLike, input: unknown): Promise<StepDecision> {
  return step.execute(stubCtx(stores, step) as never, input as never);
}

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

function seedRun(stores: Stores, files: string[]): void {
  seed(stores, ppConfig, "config", { maxRounds: 2, prepMaxRounds: 2 });
  seed(stores, ppQueue, "queue", { pending: [...files], current: null, done: [], blocked: [] } satisfies PortQueueState);
  seed(stores, ppPrep, "prep", {
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
    const stores: Stores = new Map();
    seed(stores, ppQueue, "queue", {
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
    const stores: Stores = new Map();
    seed(stores, ppConfig, "config", { maxRounds: 4, prepMaxRounds: 2 });
    seed(stores, ppQueue, "queue", {
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
    const queue = peek<PortQueueState>(stores, ppQueue, "queue");
    expect(queue?.current).toEqual({ file: "src/B.php", round: 1, epoch: 3 });
    expect(queue?.pending).toEqual([]);
    expect(next.input.dispatchMode).toBe("sequential");
  });

  test("a run input without dispatchMode still defaults to parallel waves (default path unchanged)", async () => {
    const flow = new PortProjectFlow();
    const stores: Stores = new Map();
    seed(stores, ppConfig, "config", { maxRounds: 4, prepMaxRounds: 2 });
    seed(stores, ppQueue, "queue", { pending: ["src/B.php"], current: null, done: [], blocked: [] } satisfies PortQueueState);
    const { dispatchMode: _dropped, ...parallelInput } = input;
    void _dropped;

    const next = nextOf(await run(stores, flow.dispatch, parallelInput));
    expect(next.step).toBe(flow.waveDispatch.constructor);
    expect(next.input.mode).toBe("port");
    // Parallel dispatch never claims a file itself: pending is consumed by the wave join.
    expect(peek<PortQueueState>(stores, ppQueue, "queue")?.pending).toEqual(["src/B.php"]);
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
    const stores: Stores = new Map();
    seedRun(stores, files);

    let current: Record<string, unknown> = runInput(fx, files, { dispatchMode: "sequential" }) as unknown as Record<string, unknown>;
    for (const file of files) {
      // Dispatch (sequential) claims the file and routes to Lease.
      const dispatched = nextOf(await run(stores, flow.dispatch, current));
      expect(dispatched.step).toBe(flow.lease.constructor);
      expect(peek<PortQueueState>(stores, ppQueue, "queue")?.current?.file).toBe(file);

      // Lease acquires a real worktree; one record per file at this epoch.
      const leased = nextOf(await run(stores, flow.lease, dispatched.input));
      expect(leased.step).toBe(flow.fence.constructor);
      const fri = leased.input as unknown as FileRoundInput;
      expect(fri.file).toBe(file);
      expect(Object.keys(peek<Record<string, LeaseRecord>>(stores, ppLease, "pool") ?? {})).toEqual([file]);

      // The implementer's output, then the sole-committer commit + integrate.
      const outPath = OUT_PATHS[file] as string;
      await mkdir(join(fri.worktreePath, "src"), { recursive: true });
      await writeFile(join(fri.worktreePath, outPath), `export const v = "${file}";\n`);
      seed(stores, ppOut, `${file.replace(/\//g, "__")}#1`, { outPath });
      const committed = nextOf(await run(stores, flow.commit, fri));
      expect(committed.step).toBe(flow.integrate.constructor);
      const integrated = nextOf(await run(stores, flow.integrate, committed.input));
      expect(integrated.step).toBe(flow.release.constructor);

      // Release gives the slot back and keeps the run options.
      const released = nextOf(await run(stores, flow.release, integrated.input));
      expect(released.step).toBe(flow.bootstrap.constructor);
      expect(released.input.dispatchMode).toBe("sequential");
      expect(peek<Record<string, LeaseRecord>>(stores, ppLease, "pool")).toEqual({});
      await expect(stat(fri.worktreePath)).rejects.toThrow();

      // Bootstrap is an idempotent no-op on the pre-provisioned checkout.
      const bootstrapped = nextOf(await run(stores, flow.bootstrap, released.input));
      expect(bootstrapped.step).toBe(flow.dispatch.constructor);
      current = bootstrapped.input;
    }

    // Queue exhausted: Dispatch reports done and routes to the verify queue.
    const finalDispatch = nextOf(await run(stores, flow.dispatch, current));
    expect(finalDispatch.step).toBe(flow.queueVerify.constructor);
    const queue = peek<PortQueueState>(stores, ppQueue, "queue");
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
