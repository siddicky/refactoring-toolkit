/**
 * run-demo — Phase 0 exit-criteria driver (side-effect-real, retained).
 *
 * Subcommands:
 *   worker [--harness stub|opencode] [--fault <spec>]   long-running dex worker
 *   hello                                               0(a)/0(b): start+wait hello flow
 *   long-step --ms 90000 [--flow-id long-1]             0(c): start a multi-minute step (kill target)
 *   wait-flow --id <flowId>                             wait for a flow (resume observation)
 *   round --dir <repoDir> --file src/a.php --round 1 --epoch 1
 *                                                       0(d)/0(e): fixture repo + PortRound flow
 *   recover --dir <repoDir> --epoch 2                   ordered recovery: abort/confirm sessions
 *                                                       (enumeration fallback) → lease reclaim →
 *                                                       reconcile → re-dispatch
 *   agent-roundtrip                                     0(e): REAL opencode session + prompt + tokens
 *   git-selftest                                        no dex needed: op-ID crash window (0d),
 *                                                       stale-writer (0d2), differing-content
 *                                                       replay across quarantine (0d3), integration
 *
 * Requires a running dex server: `dexcli dev -open=false` (see BUILD_NOTES.md).
 */

import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  dexConfigFromEnv,
  openDexClient,
  startDexWorker,
} from "../src/dex/client.js";
import {
  OpencodeHarness,
  type AgentSessionClient,
} from "../src/harness/opencode.js";
import {
  InMemoryLeaseStore,
  WorktreePool,
  applyReconcile,
  commitLeaseChanges,
  commitObjectReadable,
  findCommitByOpId,
  isWorktreeClean,
  mergeLeaseIntoIntegration,
  operationId,
  reconcile,
  type CompletionMarker,
} from "../src/git/worktree.js";
import { git } from "../src/git/exec.js";
import {
  PortRoundFlow,
  configureProbe,
  probeFlows,
  type RoundInput,
} from "./probe-flow.js";
import {
  PortProjectFlow,
  configurePortHarness,
} from "../flows/port-project.js";
import type { Flow } from "@superdurable/dex";

// ---------------------------------------------------------------------------
// Harness selection — the stub double is explicit and labeled, never silent.
// ---------------------------------------------------------------------------

class StubHarness implements AgentSessionClient {
  #n = 0;
  async createSession(label: string) {
    this.#n += 1;
    return { id: `stub-session-${this.#n}`, title: label };
  }
  async prompt(_sessionId: string, text: string) {
    // Deterministic test double; these token counts are fixtures.
    return {
      text: `stub reply (${text.length} chars)`,
      usage: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      aborted: false,
    };
  }
  async abortSessionsNotTagged(_epoch: number) {
    // The stub owns no live server sessions.
    return [];
  }
}

async function pickHarness(name: string | undefined): Promise<AgentSessionClient> {
  if (name === "stub") return new StubHarness();
  const baseUrl = process.env.OPENCODE_BASE_URL?.trim() || undefined;
  try {
    return await OpencodeHarness.connect(
      baseUrl,
      process.env.OPENCODE_MODEL_PROVIDER && process.env.OPENCODE_MODEL_ID
        ? {
            providerID: process.env.OPENCODE_MODEL_PROVIDER,
            modelID: process.env.OPENCODE_MODEL_ID,
          }
        : undefined,
    );
  } catch (err) {
    console.error(`[run-demo] opencode harness unavailable (${(err as Error).message}); falling back to StubHarness (labeled test double)`);
    return new StubHarness();
  }
}

// ---------------------------------------------------------------------------
// Fixture repo helper (used by `round` and `git-selftest`)
// ---------------------------------------------------------------------------

export async function makeFixtureRepo(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const runner = git(dir);
  await runner.run(["init", "-b", "main"]);
  await writeFile(join(dir, "README.md"), "fixture repo\n");
  await runner.run(["add", "-A"]);
  await runner.run(["commit", "-m", "fixture init"]);
}

// ---------------------------------------------------------------------------
// git-selftest — exits 0(d)/0(d2)/0(d3) at the git-seam level (no dex server)
// ---------------------------------------------------------------------------

async function gitSelftest(): Promise<number> {
  const root = join(process.env.TMPDIR ?? "/tmp", `porting-kit-selftest-${Date.now()}`);
  await makeFixtureRepo(root);
  const wtRoot = join(root, ".worktrees");
  const pool = new WorktreePool(root, wtRoot, new InMemoryLeaseStore(), 2);
  const file = "src/a.php";
  const opId = operationId(file, 1);

  let failures = 0;
  const check = (name: string, ok: boolean, detail: string) => {
    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
    if (!ok) failures += 1;
  };

  // Lease + first commit.
  const acquired = await pool.acquire(file, 1, "selftest-run-1");
  if (!acquired.acquired) {
    console.error(`FAIL lease acquisition — ${acquired.reason}`);
    return 1;
  }
  const lease = acquired.lease;
  const contentV1 = `<?php\n// ported content v1 for ${opId}\n`;
  await mkdir(join(lease.worktreePath, "src"), { recursive: true });
  await writeFile(join(lease.worktreePath, "src", "a.php"), contentV1);

  const first = await commitLeaseChanges(lease.worktreePath, opId, "round 1");
  const keyed = await findCommitByOpId(root, opId);
  check(
    "0d: keyed commit findable by op-ID after first commit",
    keyed !== undefined && keyed.sha === first.sha,
    `keyed=${keyed?.sha} first=${first.sha}`,
  );

  // Crash-window replay: a redo produces the SAME dedup decision.
  await writeFile(join(lease.worktreePath, "src", "a.php"), contentV1 + "// redo\n");
  const keyedAgain = await findCommitByOpId(root, opId);
  check(
    "0d: crash-window replay finds the same keyed commit (no duplicate)",
    keyedAgain !== undefined && keyedAgain.sha === first.sha,
    `keyedAgain=${keyedAgain?.sha}`,
  );

  // 0(d2): stale writer dirties the worktree AFTER the keyed commit.
  await writeFile(join(lease.worktreePath, "src", "a.php"), "STALE WRITER JUNK\n");
  const dirty = await isWorktreeClean(lease.worktreePath);
  const marker: CompletionMarker = {
    round: 1,
    disposition: `committed:${opId}`,
    content_hash: first.contentHash,
  };
  const r1 = reconcile({
    marker: undefined,
    keyed: keyedAgain,
    worktree: { clean: dirty, commitObjectReadable: await commitObjectReadable(root, first.sha ?? "") },
  });
  await applyReconcile(lease, r1, keyedAgain);
  const cleanAfter = await isWorktreeClean(lease.worktreePath);
  const headAfter = (await git(lease.worktreePath).run(["rev-parse", "HEAD"])).trim();
  check(
    "0d2: after stale-writer dirtying, keyed commit is reachable at worktree HEAD",
    r1.kind === "skipped" && cleanAfter && headAfter === first.sha,
    `action=${r1.kind} clean=${cleanAfter} head=${headAfter} want=${first.sha}`,
  );

  // 0(d3): differing-content replay across a QUARANTINED lease.
  // Quarantine = lease released (worktree gone); branch + commit retained.
  await pool.release(file);
  const spare = await pool.acquire(file, 2, "selftest-run-2");
  if (!spare.acquired) {
    console.error(`FAIL spare lease — ${spare.reason}`);
    return 1;
  }
  const differing = await findCommitByOpId(root, opId);
  const contentV2 = `<?php\n// DIFFERENT content replayed on a spare worktree\n`;
  await mkdir(join(spare.lease.worktreePath, "src"), { recursive: true });
  await writeFile(join(spare.lease.worktreePath, "src", "a.php"), contentV2);
  const replay = await commitLeaseChanges(spare.lease.worktreePath, opId, "round 1 redo");
  const count = await countOpIdCommits(root, opId);
  const originalStillFound = (await findCommitByOpId(root, opId))?.sha === first.sha;
  const diverged = replay.contentHash !== differing?.contentHash;
  check(
    "0d3: op-ID dedup identity holds — lookup returns the ORIGINAL commit despite differing content",
    originalStillFound,
    `found=${(await findCommitByOpId(root, opId))?.sha} want=${first.sha}`,
  );
  check(
    "0d3: a naive second commit is DETECTABLE (2 op-ID commits) and divergence is recordable as evidence",
    count === 2 && (diverged || replay.disposition === "no-op-empty-diff"),
    `commits=${count} replayTree=${replay.contentHash} firstTree=${differing?.contentHash}`,
  );

  // Integration: one output project receives the leased work.
  const itg = await mergeLeaseIntoIntegration(root, join(root, ".worktrees", "integration"), spare.lease.branch);
  const integrated = (await git(join(root, ".worktrees", "integration")).tryRun(["cat-file", "-e", `HEAD:${file}`])).ok;
  check(
    "integration: lease branch merged into `integration` and content present",
    itg.alreadyIntegrated || itg.fastForward || !itg.alreadyIntegrated ? integrated : false,
    `integrated=${integrated} result=${JSON.stringify(itg)}`,
  );

  console.log(failures === 0 ? "git-selftest: ALL PASS" : `git-selftest: ${failures} FAILURE(S)`);
  console.log(`(fixture repo kept for inspection: ${root})`);
  return failures === 0 ? 0 : 1;
}

async function countOpIdCommits(repoRoot: string, opId: string): Promise<number> {
  const out = await git(repoRoot).run([
    "log",
    "--all",
    "--grep",
    `Operation-ID: ${opId}$`,
    "--format=%H",
  ]);
  return out.split("\n").map((s) => s.trim()).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Ordered recovery (plan §Session fencing) — used by `recover`
// ---------------------------------------------------------------------------

async function orderedRecover(repoDir: string, epoch: number): Promise<number> {
  const file = process.env.RECOVER_FILE ?? "src/a.php";
  const round = Number.parseInt(process.env.RECOVER_ROUND ?? "1", 10);
  console.log(`[recover] epoch bump → ${epoch}; target ${file} round ${round}`);

  // 1-2. Abort + confirm persisted sessions; enumeration fallback when the
  // persisted fence is unavailable (attribute reads need a live flow context,
  // so Phase 0 uses the enumeration path against the surviving server).
  const harness = await pickHarness(process.env.HARNESS);
  const aborted = await harness.abortSessionsNotTagged(epoch);
  console.log(`[recover] aborted ${aborted.length} foreign session(s): ${aborted.join(",") || "none"}`);

  // 3. Lease reclaim (stale epoch records are reclaimable at the pool).
  const pool = new WorktreePool(repoDir, join(repoDir, ".worktrees"), new InMemoryLeaseStore(), 2);
  await pool.release(file);
  const reacquired = await pool.acquire(file, epoch, `recover-${epoch}`);
  if (!reacquired.acquired) {
    console.error(`[recover] FAILED to reclaim lease: ${reacquired.reason}`);
    return 1;
  }

  // 4. Worktree reconcile — recovery preserves committed work unconditionally.
  const opId = operationId(file, round);
  const keyed = await findCommitByOpId(repoDir, opId);
  const clean = await isWorktreeClean(reacquired.lease.worktreePath);
  const action = reconcile({
    marker: undefined,
    keyed,
    worktree: {
      clean,
      commitObjectReadable: keyed !== undefined && (await commitObjectReadable(repoDir, keyed.sha)),
    },
  });
  const applied = await applyReconcile(reacquired.lease, action, keyed);
  console.log(`[recover] reconcile=${action.kind} (${action.reason}) restoredFrom=${applied.restoredFrom}`);

  // 5. Re-dispatch: start the round flow again at the new epoch.
  return startRound(repoDir, file, round, epoch);
}

// ---------------------------------------------------------------------------
// Round launcher (0d/0e live driver)
// ---------------------------------------------------------------------------

async function startRound(
  repoDir: string,
  file: string,
  round: number,
  epoch: number,
): Promise<number> {
  const config = dexConfigFromEnv();
  const pool = new WorktreePool(repoDir, join(repoDir, ".worktrees"), new InMemoryLeaseStore(), 2);
  const acquired = await pool.acquire(file, epoch, `run-demo-${epoch}`);
  if (!acquired.acquired) {
    console.error(`[round] lease failed: ${acquired.reason}`);
    return 1;
  }
  const lease = acquired.lease;
  const input: RoundInput = {
    file,
    round,
    epoch,
    repoRoot: repoDir,
    worktreePath: lease.worktreePath,
    integrationWorktreePath: join(repoDir, ".worktrees", "integration"),
    promptText: `Port ${file} round ${round} (probe).`,
    writtenContent: `<?php\n// ported content for ${file} round ${round} epoch ${epoch}\n`,
  };
  const flows: Flow<any>[] = probeFlows();
  const runtime = await openDexClient(flows, config);
  try {
    const flow = flows.find((f) => f.getFlowType() === "probe.PortRound");
    if (flow === undefined) throw new Error("probe.PortRound not registered");
    const flowId = `round-${file.replace(/\//g, "__")}-${round}-${epoch}-${Date.now()}`;
    const runId = await runtime.client.startFlow(flow, flowId, input);
    console.log(`[round] flowId=${flowId} runId=${runId} worktree=${lease.worktreePath}`);
    const result = await runtime.client.waitForFlow(flowId);
    console.log(`[round] completed: ${JSON.stringify(result)}`);
    return 0;
  } finally {
    await runtime.close();
  }
}

// ---------------------------------------------------------------------------
// Port-project (Phase 2 trial gate)
// ---------------------------------------------------------------------------

function portFlows(harness: AgentSessionClient): Flow<any>[] {
  configurePortHarness(harness);
  return [new PortProjectFlow()];
}

/**
 * Robust flow wait: dex's waitForFlow long-poll times out periodically, so
 * poll until the flow reaches a terminal state or the deadline passes.
 */
async function waitForFlowTerminal(
  runtime: { client: { waitForFlow(flowId: string): Promise<unknown> } },
  flowId: string,
  deadlineMs: number,
): Promise<unknown> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      return await runtime.client.waitForFlow(flowId);
    } catch (err) {
      const e = err as { detail?: string; subStatus?: string; message?: string };
      const transient =
        e.subStatus === "longPollTimeout" ||
        (e.detail ?? "").includes("waiting exceeded the timeout") ||
        (e.message ?? "").includes("14 UNAVAILABLE");
      if (!transient || Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

async function startDemo(): Promise<number> {
  const config = dexConfigFromEnv();
  const dir = argValue("--dir");
  if (dir === undefined) throw new Error("demo requires --dir <projectRepoDir>");
  if (!(await exists(dir))) await makeFixtureRepo(dir);
  const files = (argValue("--files") ?? "src/Money.php,src/Pricing/FlatRateDiscount.php")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const prepPath = argValue("--prep") ?? join(process.cwd(), "fixtures/stub-prep.md");
  const sourceRoot = argValue("--source-root") ?? join(process.cwd(), "fixtures/php-sample");
  const epoch = Number.parseInt(argValue("--epoch", "1") as string, 10);
  const maxRounds = Number.parseInt(argValue("--max-rounds", "1") as string, 10);
  const waitMinutes = Number.parseInt(argValue("--wait-minutes", "30") as string, 10);

  const flows: Flow<any>[] = [new PortProjectFlow()];
  const runtime = await openDexClient(flows, config);
  try {
    const flow = flows[0];
    if (flow === undefined) throw new Error("PortProjectFlow not registered");
    const flowId = argValue("--flow-id", `demo-${Date.now()}`) as string;
    const input = {
      repoRoot: dir,
      worktreeRoot: join(dir, ".worktrees"),
      integrationWorktreePath: join(dir, ".worktrees", "integration"),
      epoch,
      sourceRoot,
      prepPath,
      files,
      maxRounds,
    };
    const runId = await runtime.client.startFlow(flow, flowId, input);
    console.log(`[demo] started flowId=${flowId} runId=${runId} files=${files.join(",")} epoch=${epoch}`);
    // Optional live-dashboard hook (worker-5, plan v6.1): launch the read-only
    // status server next to the run when present; never fatal if absent.
    const serveStatus = join(import.meta.dir, "serve-status.ts");
    if (await exists(serveStatus)) {
      const child = spawn(process.execPath, [serveStatus], {
        env: { ...process.env, STATUS_REPO_ROOT: dir },
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      console.log(`[demo] dashboard: http://127.0.0.1:${process.env.PORT ?? "4646"} (pid ${child.pid})`);
    }
    if (process.argv.includes("--start-only")) return 0;
    const result = await waitForFlowTerminal(runtime, flowId, waitMinutes * 60_000);
    console.log(`[demo] completed: ${JSON.stringify(result)}`);
    return 0;
  } finally {
    await runtime.close();
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function argValue(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  const cmd = process.argv[2] ?? "";
  const config = dexConfigFromEnv();
  const fault = process.env.PORTING_KIT_FAULT;

  switch (cmd) {
    case "worker": {
      const harness = await pickHarness(argValue("--harness"));
      const flows = argValue("--flows") === "port" ? portFlows(harness) : probeFlows();
      configureProbe(harness, fault);
      const handle = await startDexWorker(flows, config);
      console.log(`[worker] up: target=${handle.workerTargetAddress} server=${config.serverAddress} fault=${fault ?? "none"} harness=${argValue("--harness") ?? "auto"} flows=${argValue("--flows") ?? "probe"}`);
      await new Promise(() => {}); // run until killed
      return 0;
    }
    case "hello": {
      const flows = probeFlows();
      const runtime = await openDexClient(flows, config);
      try {
        const flow = flows.find((f) => f.getFlowType() === "probe.Hello");
        if (flow === undefined) throw new Error("probe.Hello not registered");
        const flowId = argValue("--flow-id", `hello-${Date.now()}`) as string;
        await runtime.client.startFlow(flow, flowId, undefined);
        const result = await runtime.client.waitForFlow(flowId);
        console.log(`[hello] flowId=${flowId} result=${JSON.stringify(result)}`);
        return 0;
      } finally {
        await runtime.close();
      }
    }
    case "long-step": {
      const ms = Number.parseInt(argValue("--ms", "90000") as string, 10);
      const flows = probeFlows();
      const runtime = await openDexClient(flows, config);
      try {
        const flow = flows.find((f) => f.getFlowType() === "probe.LongStep");
        if (flow === undefined) throw new Error("probe.LongStep not registered");
        const flowId = argValue("--flow-id", "long-1") as string;
        const startOnly = process.argv.includes("--start-only");
        await runtime.client.startFlow(flow, flowId, { ms });
        console.log(`[long-step] started flowId=${flowId} ms=${ms}`);
        if (startOnly) return 0;
        const result = await runtime.client.waitForFlow(flowId);
        console.log(`[long-step] result=${JSON.stringify(result)}`);
        return 0;
      } finally {
        await runtime.close();
      }
    }
    case "wait-flow": {
      const flowId = argValue("--id");
      if (flowId === undefined) throw new Error("wait-flow requires --id");
      const waitMinutes = Number.parseInt(argValue("--wait-minutes", "30") as string, 10);
      const runtime = await openDexClient(probeFlows(), config);
      try {
        const result = await waitForFlowTerminal(runtime, flowId, waitMinutes * 60_000);
        console.log(`[wait-flow] flowId=${flowId} result=${JSON.stringify(result)}`);
        return 0;
      } finally {
        await runtime.close();
      }
    }
    case "round": {
      const dir = argValue("--dir");
      if (dir === undefined) throw new Error("round requires --dir <fixtureRepoDir>");
      if (!(await exists(dir))) await makeFixtureRepo(dir);
      const file = argValue("--file", "src/a.php") as string;
      const round = Number.parseInt(argValue("--round", "1") as string, 10);
      const epoch = Number.parseInt(argValue("--epoch", "1") as string, 10);
      return await startRound(dir, file, round, epoch);
    }
    case "recover": {
      const dir = argValue("--dir");
      if (dir === undefined) throw new Error("recover requires --dir <fixtureRepoDir>");
      const epoch = Number.parseInt(argValue("--epoch", "2") as string, 10);
      return await orderedRecover(dir, epoch);
    }
    case "agent-roundtrip": {
      const baseUrl = process.env.OPENCODE_BASE_URL?.trim() || undefined;
      const harness = await OpencodeHarness.connect(
        baseUrl,
        process.env.OPENCODE_MODEL_PROVIDER && process.env.OPENCODE_MODEL_ID
          ? {
              providerID: process.env.OPENCODE_MODEL_PROVIDER,
              modelID: process.env.OPENCODE_MODEL_ID,
            }
          : undefined,
      );
      const session = await harness.createSession("porting-kit:agent-roundtrip");
      console.log(`[agent-roundtrip] session=${session.id}`);
      const reply = await harness.prompt(session.id, "Reply with exactly: OK");
      console.log(
        `[agent-roundtrip] text=${JSON.stringify(reply.text.slice(0, 120))} usage=${JSON.stringify(reply.usage)}`,
      );
      return reply.usage === null ? 1 : 0;
    }
    case "git-selftest":
      return await gitSelftest();
    case "demo":
      return await startDemo();
    default:
      console.error("usage: run-demo.ts <worker|hello|long-step|wait-flow|round|recover|agent-roundtrip|git-selftest|demo> [flags]");
      return 2;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error("[run-demo] fatal:", err);
    process.exit(1);
  });
