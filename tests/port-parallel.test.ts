/**
 * Parallel (default) dispatch topology: the parent flow (port.Project) fans
 * per-file work out to child flows (port.File) through WaveDispatch/WaveJoin.
 *
 * Audit T2 (C89/C09): this file used to import flows/port-parallel.ts — a
 * never-imported "v1.1 prep" module (its own PortFileInput, waveWait,
 * PARALLEL_SLOTS, fileFlowId) whose helpers and header contradicted the
 * production flow (production: parallel is the DEFAULT, the attribute is
 * `pp-wave-children`, the wave width is CHILD_SLOT_CAP, conditionIds are
 * `wave-<mode>-<round>-<i>`). The module is deleted; these tests cover code the
 * flow actually runs. WaveDispatch/WaveJoin/ChildLease execution is covered by
 * the queue-verify team's step tests, not here.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StepDecision } from "@superdurable/dex";

import {
  configurePortHarness,
  LEASE_SLOT_CAP,
  PortFileFlow,
  PortProjectFlow,
  ppLease,
  ppMarker,
  ppWaveChildren,
  type ChildFileResult,
  type FileRoundInput,
} from "../flows/port-project.js";
import { envelopeStepIdentityOf } from "../flows/steps/envelope.js";
import { classifyDispatchStepType, specForStepType } from "../src/metrics/dispatch-anchor.js";
import { git } from "../src/git/exec.js";
import { InMemoryLeaseStore, WorktreePool, operationId, type CompletionMarker, type LeaseRecord } from "../src/git/worktree.js";
import type { AgentSessionClient } from "../src/harness/opencode.js";
import { runStep, type AttributeStores, type StepLike } from "./support/dex-context.js";

// ---------------------------------------------------------------------------
// Harness (stub Context that enforces declared attribute loads)
// ---------------------------------------------------------------------------

const run = (stores: AttributeStores, step: StepLike, input: unknown) =>
  runStep(stores, step, input, { flowId: "t2-parallel" });

function nextStep(decision: StepDecision): unknown {
  if (decision.kind !== "next") throw new Error(`expected next, got ${decision.kind}`);
  return decision.movements[0]?.step;
}

// The dex step type of a factory-made step, read through the envelope registry (raw
// step-type access is sanctioned only inside the envelope factory: the F1 lint).
const stepTypeOf = (step: object): string => envelopeStepIdentityOf(step)?.stepType ?? "<not a factory step>";

const tmpRoots: string[] = [];

afterEach(async () => {
  configurePortHarness(undefined as unknown as AgentSessionClient);
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});

async function makeRepo(): Promise<string> {
  const repo = await mkdtemp(join(tmpdir(), "porting-kit-parallel-"));
  tmpRoots.push(repo);
  const runner = git(repo);
  await runner.run(["init", "-b", "main"]);
  await writeFile(join(repo, "README.md"), "fixture repo\n");
  await runner.run(["add", "-A"]);
  await runner.run(["commit", "-m", "fixture init"]);
  return repo;
}

function fileRound(repo: string, overrides: Partial<FileRoundInput> = {}): FileRoundInput {
  return {
    repoRoot: repo,
    worktreeRoot: join(repo, ".worktrees"),
    integrationWorktreePath: join(repo, ".worktrees", "integration"),
    sourceRoot: join(repo, "php"),
    epoch: 1,
    file: "src/A.php",
    round: 1,
    worktreePath: repo,
    branch: "main",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Registration (kept from the original suite: these DO pin production code)
// ---------------------------------------------------------------------------

describe("parallel topology registration", () => {
  test("parallel topology is anchor-registered (AC2 holds on the new shape)", () => {
    for (const stepType of ["PpWaveDispatch", "PpWaveJoin", "PpChildLease", "PpChildRelease"]) {
      expect(classifyDispatchStepType(stepType).kind).toBe("flow-step");
      expect(specForStepType(stepType)?.kind).toBe("support");
    }
  });

  test("child flow registers the full per-file pipeline (envelope-wrapped steps only)", () => {
    const child = new PortFileFlow();
    expect(stepTypeOf(child.childLease)).toBe("PpChildLease");
    expect(stepTypeOf(child.fence)).toBe("PpFence");
    expect(stepTypeOf(child.implement)).toBe("PpImplement");
    expect(stepTypeOf(child.queueFix)).toBe("PpQueueFix");
    expect(stepTypeOf(child.commit)).toBe("PpCommit");
    expect(stepTypeOf(child.release)).toBe("PpChildRelease");
    expect(child.getFlowType()).toBe("port.File");
    // The parent registers the wave orchestration steps.
    const parent = new PortProjectFlow();
    expect(stepTypeOf(parent.waveDispatch)).toBe("PpWaveDispatch");
    expect(stepTypeOf(parent.waveJoin)).toBe("PpWaveJoin");
    expect(parent.getFlowType()).toBe("port.Project");
  });

  test("the wave-children evidence attribute is pp-wave-children (not pp-wave/children)", () => {
    expect((ppWaveChildren as unknown as { name: string }).name).toBe("pp-wave-children");
  });

  test("both flows declare the wave-children attribute in their persistence schema", () => {
    expect(new PortProjectFlow().getPersistenceSchema().attributes).toContain(ppWaveChildren);
    expect(new PortFileFlow().getPersistenceSchema().attributes).toContain(ppWaveChildren);
  });
});

// ---------------------------------------------------------------------------
// Shared per-file steps route by flow kind
// ---------------------------------------------------------------------------

describe("shared per-file steps route by flow kind (parent vs child)", () => {
  const stubHarness: AgentSessionClient = {
    createSession: async (label: string) => ({ id: `session-${label}` }) as never,
    prompt: async () => {
      throw new Error("no prompts in routing tests");
    },
    abortSessionsNotTagged: async () => [],
  };

  test("FenceStep: round 1 implements in both flows; fix rounds enter the one shared queue-fix step", async () => {
    configurePortHarness(stubHarness);
    const parent = new PortProjectFlow();
    const child = new PortFileFlow();
    const stores: AttributeStores = new Map();

    const round1 = fileRound("/r", { round: 1 });
    expect(nextStep(await run(stores, parent.fence, round1))).toBe(parent.implementStart.constructor);
    expect(nextStep(await run(stores, child.fence, { ...round1, childFlow: true }))).toBe(child.implementStart.constructor);

    const fix = fileRound("/r", { round: 2 });
    // One QueueFix class serves both flows (C90): the parent reads its own
    // pp-verify store and the child reads the copy seeded by ChildLeaseStep.
    expect(nextStep(await run(stores, parent.fence, fix))).toBe(parent.queueFixStart.constructor);
    const childFix = nextStep(await run(stores, child.fence, { ...fix, childFlow: true }));
    expect(childFix).toBe(child.queueFixStart.constructor);
    expect(childFix).toBe(parent.queueFixStart.constructor);
  });

  test("CommitStep: a child's round ends at the child release; the parent's round goes to integration", async () => {
    const repo = await makeRepo();
    const parent = new PortProjectFlow();
    const child = new PortFileFlow();
    const stores: AttributeStores = new Map();
    await mkdir(join(repo, "src"), { recursive: true });
    await writeFile(join(repo, "src", "a.ts"), "export const a = 1;\n");

    const childDecision = await run(stores, child.commit, fileRound(repo, { childFlow: true }));
    expect(nextStep(childDecision)).toBe(child.release.constructor);
    const marker = stores.get(ppMarker)?.get("src__A.php#1") as CompletionMarker | undefined;
    expect(marker?.disposition).toBe(`committed:${operationId("src/A.php", 1)}`);

    // Replay of the same round dedups on the operation id and routes the parent's way.
    const parentDecision = await run(stores, parent.commit, fileRound(repo));
    expect(nextStep(parentDecision)).toBe(parent.integrate.constructor);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// ChildReleaseStep: the child's terminal receipt
// ---------------------------------------------------------------------------

describe("ChildReleaseStep (child receipt)", () => {
  test("frees the child's lease (worktree removed) and hands the round's git facts to the parent", async () => {
    const repo = await makeRepo();
    const worktreeRoot = join(repo, ".worktrees");
    const pool = new WorktreePool(repo, worktreeRoot, new InMemoryLeaseStore(), LEASE_SLOT_CAP);
    const acquired = await pool.acquire("src/A.php", 1, "pp-child-1");
    if (!acquired.acquired) throw new Error(acquired.reason);
    const lease: LeaseRecord = acquired.lease;

    const child = new PortFileFlow();
    const stores: AttributeStores = new Map();
    stores.set(ppLease, new Map([["pool", { "src/A.php": lease }]]));
    stores.set(
      ppMarker,
      new Map([
        ["src__A.php#1", { round: 1, disposition: `committed:${operationId("src/A.php", 1)}`, content_hash: "tree123", sha: "sha123" } satisfies CompletionMarker],
      ]),
    );

    const decision = await run(stores, child.release, fileRound(repo, { worktreePath: lease.worktreePath, branch: lease.branch, childFlow: true }));
    expect(decision.kind).toBe("gracefulComplete");
    const receipt = (decision as { output: ChildFileResult }).output;
    expect(receipt).toEqual({ file: "src/A.php", round: 1, commitSha: "sha123", treeHash: "tree123" });
    expect(stores.get(ppLease)?.get("pool")).toEqual({});
    await expect(stat(lease.worktreePath)).rejects.toThrow();
  }, 30_000);
});
