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
 *                                                       replay across quarantine (0d3)
 *   gate --flow-id <id>                                 US-002 lead-layer dispatch health gate:
 *                                                       review-step failure facts from dexcli flow
 *                                                       history; fail-open (degraded => no protection)
 *   demo [--gate-flow-id <id>] [--dispatch parallel]    port flow dispatch (gate optional pre-dispatch), integration
 *
 * Requires a running dex server: `dexcli dev -open=false` (see BUILD_NOTES.md).
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
import {
  dexConfigFromEnv,
  openDexClient,
  startDexWorker,
} from "../src/dex/client.js";
import { waitForFlowTerminal } from "../src/dex/wait-for-terminal.js";
import { DexServiceError } from "@superdurable/dex";
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
  sanitizePathSegment,
  type CompletionMarker,
  type LeaseRecord,
} from "../src/git/worktree.js";
import { git } from "../src/git/exec.js";
import { makeFixtureRepo } from "../src/git/fixture.js";
import {
  configureProbe,
  probeFlows,
  type RoundInput,
} from "./probe-flow.js";
import { PortProjectFlow, PortFileFlowInstance, configurePortHarness } from "../flows/port-project.js";
import {
  configureEnvelopeStreamPublisher,
  envelopeStream,
} from "../flows/steps/envelope.js";
import {
  configurePortFault,
  configurePortJudgment,
  configureTurnHealthAssessor,
} from "../flows/runtime-hooks.js";
import { createOfflineJevClient } from "../src/harness/runtime.js";
import { createRealJevClient, isTypesafeOffline } from "../src/typesafe/client.js";
import type { JudgmentClient } from "../src/typesafe/client.js";
import { createTurnHealthAssessor } from "../src/typesafe/turn-health.js";
import { dexCliQueries, describeError } from "../src/dashboard/queries.js";
import {
  evaluateDispatchGate,
  gateLine,
  GATE_QUERY_TIMEOUT_MS,
} from "./dispatch-gate.js";
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

// The helper lives in src/git/fixture.ts so tests share one copy; re-exported
// here for callers that import it from the script.
export { makeFixtureRepo };

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
  const clean = await isWorktreeClean(lease.worktreePath);
  const marker: CompletionMarker = {
    round: 1,
    disposition: `committed:${opId}`,
    content_hash: first.contentHash,
  };
  // The marker is passed so this check exercises the marker-present reconcile
  // branch (committed round + dirty worktree => restore from the keyed commit).
  const r1 = reconcile({
    marker,
    keyed: keyedAgain,
    worktree: { clean, commitObjectReadable: await commitObjectReadable(root, first.sha ?? "") },
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
    integrated === true,
    `integrated=${integrated} result=${JSON.stringify(itg)}`,
  );

  console.log(failures === 0 ? "git-selftest: ALL PASS" : `git-selftest: ${failures} FAILURE(S)`);
  console.log(`(fixture repo kept for inspection: ${root})`);
  return failures === 0 ? 0 : 1;
}

/**
 * Phase 4: latest committed round for a file (max op-ID trailer across all
 * branches); 0 when the file has no committed round yet.
 */
async function latestRoundFor(repoDir: string, file: string): Promise<number> {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const { stdout } = await execFileP(
    "git",
    ["log", "--all", "--grep", `Operation-ID: ${escaped}#`, "--format=%B"],
    { cwd: repoDir, maxBuffer: 16 * 1024 * 1024 },
  );
  let max = 0;
  for (const m of stdout.matchAll(new RegExp(`Operation-ID: ${escaped}#(\\d+)`, "g"))) {
    const n = Number.parseInt(m[1] ?? "0", 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max;
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
// Lead-layer dispatch health gate (US-002): dexcli flow history ONLY, 5 s
// query timeout, fail-open with 'gate: degraded' surfaced. NEVER runs inside
// PpWaveDispatch/DispatchStep — this is the runner's pre-dispatch surface.
// ---------------------------------------------------------------------------

function dispatchGateQueries() {
  const config = dexConfigFromEnv();
  return dexCliQueries({
    bin: process.env.DEXCLI_BIN?.trim() || "dexcli",
    server: config.serverAddress,
    timeoutMs: GATE_QUERY_TIMEOUT_MS,
  });
}

async function runDispatchGate(gateFlowId: string | undefined): Promise<number> {
  const report = await evaluateDispatchGate(
    dispatchGateQueries().flowHistory,
    gateFlowId,
    Date.now(),
  );
  console.log(gateLine(report));
  // Fail-open by design: the gate NEVER blocks a dispatch (exit 0 either
  // way); the degraded line above carries the explicit no-protection note.
  return 0;
}

// ---------------------------------------------------------------------------
// Port-project (Phase 2 trial gate)
// ---------------------------------------------------------------------------

function portFlows(harness: AgentSessionClient): Flow<any>[] {
  configurePortHarness(harness);
  // v1.1: the per-file child flow MUST be registered on every worker that
  // serves port.Project — the parallel wave join starts port.File SubFlows.
  // LIVE FINDING (cx-5b): dex SubFlow.run(flow, …) resolves the registry by
  // INSTANCE IDENTITY — the registered child must be the exact instance the
  // join's waitFor references. Registering `new PortFileFlow()` while the
  // join runs `SubFlow.run(PortFileFlowInstance, …)` failed waitFor with
  // "Flow instance is not registered". The shared singleton is therefore
  // the registration contract; never construct a second PortFileFlow.
  return [new PortProjectFlow(), PortFileFlowInstance];
}

/**
 * Phase 3 Jev resolution (plan: swap-in behind the seam; naive default):
 * - TYPESAFE_OFFLINE=1 → deterministic in-memory double (scripted fixtures,
 *   never reported as live usage);
 * - TYPESAFE_API_KEY set → REAL billed Jev client;
 * - no key → in-memory double for the symbol table (BLOCKED-pending-key for
 *   Jev-live + the n≥30 spot-check); verdict-check/prioritize stay NAIVE.
 */
async function resolveJudgment(): Promise<JudgmentClient> {
  if (isTypesafeOffline()) {
    console.log("[worker] Jev: OFFLINE in-memory double (scripted fixtures)");
    return createOfflineJevClient();
  }
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (key === undefined || key === "") {
    console.log("[worker] Jev: TYPESAFE_API_KEY absent — in-memory double; live Jev + n>=30 spot-check BLOCKED-pending-key");
    return createOfflineJevClient();
  }
  try {
    const client = await createRealJevClient({ apiKey: key });
    console.log("[worker] Jev: REAL client (billed System One calls)");
    return client;
  } catch (err) {
    console.error(`[worker] Jev real client unavailable (${(err as Error).message}) — in-memory double`);
    return createOfflineJevClient();
  }
}

/**
 * Robust flow wait moved to src/dex/wait-for-terminal.ts (US-007: the
 * transient classification is TYPED there — LongPollTimeoutError /
 * DexServiceError UNAVAILABLE — replacing the old human-readable text
 * matching flagged by the dex-sdk review, area 1.6).
 */

async function startDemo(): Promise<number> {
  const config = dexConfigFromEnv();
  const dir = argValue("--dir");
  if (dir === undefined) throw new Error("demo requires --dir <projectRepoDir>");
  if (!(await exists(dir))) await makeFixtureRepo(dir);
  // US-002: optional pre-dispatch health gate (lead-layer, fail-open). When
  // --gate-flow-id names a previous/current flow, its review-step facts are
  // consulted and surfaced BEFORE startFlow; a degraded gate prints the
  // explicit no-protection note and STILL dispatches.
  const gateFlowId = argValue("--gate-flow-id");
  if (gateFlowId !== undefined) {
    await runDispatchGate(gateFlowId);
  }
  const files = expandFilesArg(
    argValue("--files") ?? "src/Money.php,src/Pricing/FlatRateDiscount.php",
  );
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
      // v1.1 default: parallel per-file waves (SubFlows over the 2 slots).
      dispatchMode: (argValue("--dispatch", "parallel") as string) === "sequential" ? "sequential" : "parallel",
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
// M3 — ordered recovery for the PORT flow (epoch bump → abort stale writers →
// durable-lease reclaim + reconcile at git level → re-dispatch at new epoch)
// ---------------------------------------------------------------------------

/** A worktree as reported by `git worktree list --porcelain`. */
export interface WorktreeRef {
  path: string;
  /** Short branch name (`refs/heads/` stripped); null for a detached HEAD. */
  branch: string | null;
}

/** Parses `git worktree list --porcelain` (blank-line separated blocks). */
export function parseWorktreeList(porcelain: string): WorktreeRef[] {
  const refs: WorktreeRef[] = [];
  for (const block of porcelain.split(/\n\s*\n/)) {
    let path: string | undefined;
    let branch: string | null = null;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length).trim();
      else if (line.startsWith("branch ")) {
        branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      }
    }
    if (path !== undefined) refs.push({ path, branch });
  }
  return refs;
}

/** Worktrees registered with the repository: durable git state, never an in-memory store. */
export async function listWorktrees(repoDir: string): Promise<WorktreeRef[]> {
  const { stdout } = await execFileP("git", ["worktree", "list", "--porcelain"], { cwd: repoDir });
  return parseWorktreeList(stdout);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Picks THIS file's lease worktree: the highest lease epoch strictly below
 * `beforeEpoch` (recovery bumps the epoch, it does not have to be +1). The match
 * is exact and derived from the same sanitizePathSegment the pool uses - the
 * lease branch `lease/<safe>/<n>` (or, for a detached worktree, the directory
 * `<safe>-<n>`) - so another file's worktree, or a `-1` inside a hash or a parent
 * directory, can never be selected (the old substring predicate never used the
 * file at all).
 */
export function selectLeaseWorktree(
  worktrees: readonly WorktreeRef[],
  file: string,
  beforeEpoch: number,
): { worktree: WorktreeRef; epoch: number } | undefined {
  const safe = escapeRegExp(sanitizePathSegment(file));
  const branchRe = new RegExp(`^lease/${safe}/(\\d+)$`);
  const dirRe = new RegExp(`^${safe}-(\\d+)$`);
  let best: { worktree: WorktreeRef; epoch: number } | undefined;
  for (const worktree of worktrees) {
    const m = (worktree.branch !== null ? branchRe.exec(worktree.branch) : null) ?? dirRe.exec(basename(worktree.path));
    if (m === null) continue;
    const epoch = Number.parseInt(m[1] ?? "", 10);
    if (!Number.isInteger(epoch) || epoch >= beforeEpoch) continue;
    if (best === undefined || epoch > best.epoch) best = { worktree, epoch };
  }
  return best;
}

export interface RecoverLog {
  log(message: string): void;
  error(message: string): void;
}

/**
 * Git-level half of `recover-port`: for each file, finds ITS OWN lease worktree
 * (selectLeaseWorktree), reconciles it against the file's latest keyed commit,
 * and applies the decision. Returns the number of poisoned files.
 */
export async function reconcileLeaseWorktrees(
  opts: { dir: string; epoch: number; files: readonly string[] },
  out: RecoverLog = console,
): Promise<{ failures: number }> {
  const { dir, epoch } = opts;
  const worktrees = await listWorktrees(dir);
  let failures = 0;
  for (const file of opts.files) {
    // Phase 4: recover the LATEST round per file (round increments wired) —
    // the old round-1 pin lost fix rounds beyond the first.
    const round = await latestRoundFor(dir, file);
    const opId = operationId(file, round);
    const selected = selectLeaseWorktree(worktrees, file, epoch);
    const keyed = await findCommitByOpId(dir, opId);
    if (selected === undefined) {
      out.log(`[recover-port] ${file}: no live lease worktree below epoch ${epoch} (keyed=${keyed?.sha ?? "none"}) — re-dispatch claims fresh`);
      continue;
    }
    const wt = selected.worktree.path;
    const clean = await isWorktreeClean(wt);
    const action = reconcile({
      marker: undefined,
      keyed,
      worktree: {
        clean,
        commitObjectReadable: keyed !== undefined && (await commitObjectReadable(dir, keyed.sha)),
      },
    });
    if (action.kind === "poisoned") {
      failures += 1;
      out.error(`[recover-port] ${file}: POISONED — ${action.reason}`);
      continue;
    }
    const branch =
      selected.worktree.branch ?? (await git(wt).run(["rev-parse", "--abbrev-ref", "HEAD"])).trim();
    const baseSha = (await git(wt).run(["rev-parse", "HEAD"])).trim();
    const lease: LeaseRecord = {
      file,
      worktreePath: wt,
      branch,
      epoch: selected.epoch,
      baseSha,
      holderExecutionId: "recover-port",
      acquiredAtUtc: new Date().toISOString(),
    };
    await applyReconcile(lease, action, keyed);
    out.log(`[recover-port] ${file}: reconcile=${action.kind} (${action.reason}) keyed=${keyed?.sha ?? "none"} worktree=${wt}`);
  }
  return { failures };
}

function shellWord(value: string): string {
  return /^[\w./@:=+,-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `demo` command an operator re-dispatches after recovery. It carries the
 * flags a literal copy needs: without --source-root/--prep the defaults are the
 * php-sample fixtures, and --flow-id must be NEW (the recovered flow id exists).
 * `--files creatorex` already implies the creatorex prep/source root.
 */
export function redispatchCommand(o: {
  dir: string;
  epoch: number;
  filesArg: string | undefined;
  sourceRoot?: string | undefined;
  prepPath?: string | undefined;
  flowId?: string | undefined;
  maxRounds?: string | undefined;
}): string {
  const impliedFixtures = o.filesArg?.trim() === "creatorex";
  const parts = [
    "run-demo.ts demo",
    `--dir ${shellWord(o.dir)}`,
    `--epoch ${o.epoch}`,
    `--files ${o.filesArg !== undefined && o.filesArg !== "" ? shellWord(o.filesArg) : "<files>"}`,
  ];
  if (o.sourceRoot !== undefined) parts.push(`--source-root ${shellWord(o.sourceRoot)}`);
  else if (!impliedFixtures) parts.push("--source-root <sourceRoot>");
  if (o.prepPath !== undefined) parts.push(`--prep ${shellWord(o.prepPath)}`);
  else if (!impliedFixtures) parts.push("--prep <prepPath>");
  parts.push(`--flow-id ${o.flowId !== undefined ? shellWord(o.flowId) : "<new-flow-id>"}`);
  if (o.maxRounds !== undefined) parts.push(`--max-rounds ${shellWord(o.maxRounds)}`);
  return parts.join(" ");
}

async function recoverPort(): Promise<number> {
  const dir = argValue("--dir");
  if (dir === undefined) throw new Error("recover-port requires --dir <projectRepoDir>");
  const epoch = Number.parseInt(argValue("--epoch", "2") as string, 10);
  const filesArg = argValue("--files");
  // Same expansion as `demo` (`--files creatorex` is the 10-file fixture set).
  const files = expandFilesArg(filesArg ?? "");

  console.log(`[recover-port] epoch bump → ${epoch}; repo=${dir}`);

  // 1-2. Ordered abort: persisted fences carry epoch-tagged labels; when the
  // fence attribute is not reachable outside a flow context, use the plan's
  // ENUMERATION FALLBACK against the surviving opencode server.
  const harness = await pickHarness(argValue("--harness"));
  const aborted = await harness.abortSessionsNotTagged(epoch);
  console.log(`[recover-port] aborted ${aborted.length} foreign session(s): ${aborted.join(",") || "none"}`);

  // 3. Durable lease reclaim + reconcile at git level: lease worktrees come
  // from `git worktree list` (durable state), never an in-memory store, and each
  // file is matched to its OWN lease worktree. The flow's own pp-lease store
  // reclaims stale-epoch records on next claim.
  const { failures } = await reconcileLeaseWorktrees({ dir, epoch, files });

  // 4. Re-dispatch: the operator relaunches at the bumped epoch; the flow's
  // LeaseStep reclaims stale-epoch entries in the DURABLE pp-lease store.
  console.log(
    `[recover-port] done (failures=${failures}). Re-dispatch: ${redispatchCommand({
      dir,
      epoch,
      filesArg,
      sourceRoot: argValue("--source-root"),
      prepPath: argValue("--prep"),
      flowId: argValue("--flow-id"),
      maxRounds: argValue("--max-rounds"),
    })}`,
  );
  return failures === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function argValue(
  flag: string,
  fallback?: string,
  argv: readonly string[] = process.argv,
): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : fallback;
}

/**
 * US-010: `--files creatorex` expands to the FULL CreatorPay fixture set —
 * 5 src + 5 PHPUnit test ports (the test rows are exact rows in the fixture
 * prep stub) — so the port loop ports the tests too and vitest verifies real
 * content. Any other value keeps the comma-split list behavior.
 */
export function expandFilesArg(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed !== "creatorex") {
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [
    "src/Access/EntitlementChecker.php",
    "src/Billing/SubscriptionService.php",
    "src/Moderation/ChatSentinel.php",
    "src/Payouts/EarningsLedger.php",
    "src/Support/legacy_helpers.php",
    "tests/Access/EntitlementCheckerTest.php",
    "tests/Billing/SubscriptionServiceTest.php",
    "tests/Moderation/ChatSentinelTest.php",
    "tests/Payouts/EarningsLedgerTest.php",
    "tests/Support/LegacyHelpersTest.php",
  ];
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
      const judgment = await resolveJudgment();
      configurePortJudgment(judgment);
      configurePortFault(process.env.PORTING_KIT_FAULT);
      // US-003 Tier-1 turn-health (evidence-only, fail-open): a real client
      // when TYPESAFE_API_KEY is present, the scripted in-memory double under
      // TYPESAFE_OFFLINE=1, and NO assessor (no-diagnosis degradation) when
      // neither is available. Never throws; never affects control flow.
      const turnHealth = await createTurnHealthAssessor();
      configureTurnHealthAssessor(turnHealth);
      console.log(
        turnHealth === null
          ? "[worker] turn-health: Tier-1 unavailable — ambiguous turns run with no diagnosis (fail-open)"
          : "[worker] turn-health: Tier-1 assessor configured (evidence-only; control flow never reads it)",
      );
      // US-007 (dex-sdk review, vertical-slice wiring fix): ONE loud startup
      // line stating which judgment lane is active. The lane rides the client
      // resolveJudgment configured above; flows/port-project.ts liveJevClient()
      // resolves every consumer (verdict-check, prioritize, vitest triage)
      // from that SAME seam — the old never-called configurePortJevLive
      // second seam is gone, so the log can no longer claim REAL while the
      // steps silently run naive.
      console.log(
        `[worker] JUDGMENT LANE: ${judgment.kind === "real" ? "LIVE JEV" : "NAIVE"} — verdict-check/prioritize/vitest-triage consume ${judgment.kind === "real" ? "the real billed client" : "deterministic naive defaults (no Jev calls)"}`,
      );
      const handle = await startDexWorker(flows, config);
      // US-002 stream publish (runner-side deviation, see envelope.ts): the
      // worker process mirrors every durable envelope write onto the dex
      // Stream via Client.writeStream. US-007 (dex-sdk review, DRIFT S):
      // the swallow is BOUNDED — a DexServiceError is the expected
      // best-effort telemetry outage (silent, per contract); anything else
      // is a defect (codec/definition/programming) and is logged sanitized
      // at warn. Telemetry NEVER reaches the durable path either way.
      configureEnvelopeStreamPublisher((msg) => {
        void handle.client
          .writeStream(msg.flowId, envelopeStream, "envelope", msg)
          .catch((err: unknown) => {
            if (err instanceof DexServiceError) return;
            console.warn(
              `[worker] stream publish failed (non-service; telemetry only): flow=${msg.flowId} event=${msg.eventKey}: ${describeError(err)}`,
            );
          });
      });
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
    case "recover-port":
      return await recoverPort();
    case "gate":
      return await runDispatchGate(argValue("--flow-id"));
    case "demo":
      return await startDemo();
    default:
      console.error("usage: run-demo.ts <worker|hello|long-step|wait-flow|round|recover|recover-port|agent-roundtrip|git-selftest|gate|demo> [flags]");
      return 2;
  }
}

// Only run the CLI when executed directly; importing this module (tests, other
// scripts) must neither run a subcommand nor exit the process.
if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error("[run-demo] fatal:", err);
      process.exit(1);
    });
}
