/**
 * run-demo — Phase 0 exit-criteria driver and port-flow runner (side-effect-real, retained).
 *
 *   run-demo.ts <command> [options]
 *
 * Commands: worker, hello, long-step, wait-flow, round, recover, recover-port,
 * agent-roundtrip, git-selftest, gate, demo. `run-demo.ts --help` lists them and
 * `run-demo.ts <command> --help` lists a command's options, defaults and
 * constraints. Both are GENERATED from the option tables in RUN_DEMO_CLI below
 * (src/cli/args.ts), so they cannot drift from what is parsed.
 *
 * Argument handling (audit C69) is strict: an unknown flag, a flag with no
 * value, a flag where a value belongs (`--epoch --max-rounds 2`), a repeated
 * flag, a value for a switch, an unknown command, and a number that is not a
 * whole number in range (NaN, negative, 1e3) are usage errors, as is an enum
 * flag (`--harness`, `--flows`, `--dispatch`) outside its choices. A
 * space-separated value may not start with `-`; write `--flag=-value`.
 *
 * Exit codes ({@link RUN_DEMO_EXIT}; demo / wait-flow / hello / long-step / round):
 * 0 ok, 1 failed/cancelled/terminated or fatal error, 3 completed with blocked
 * files or tsc/vitest failures, 4 wait elapsed while the flow is still running
 * (use wait-flow --id), 64 usage error (sysexits EX_USAGE, the number
 * chaos-kill and watch-queue-verify use).
 *
 * Requires a running dex server: `dexcli dev -open=false` (see BUILD_NOTES.md).
 */

import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { execFile, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
import {
  dexConfigFromEnv,
  openDexClient,
  startDexWorker,
} from "../src/dex/client.js";
import { waitForFlowTerminal } from "../src/dex/wait-for-terminal.js";
import {
  CLI_EXIT,
  defineProgram,
  exitCodesNote,
  parseCommand,
  reportParseFailure,
  type ParsedOptions,
} from "../src/cli/args.js";
import { DexServiceError, LongPollTimeoutError } from "@superdurable/dex";
import type { FlowResult, StepCompletion } from "@superdurable/dex";
import {
  OpencodeHarness,
  type AgentSessionClient,
} from "../src/harness/opencode.js";
import { describeHarness, selectHarness, type HarnessChoice } from "../src/harness/select.js";
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
  PROBE_LONG_STEP_OPTIONS,
  PROBE_ROUND_OPTIONS,
  probeFlows,
  type RoundInput,
} from "./probe-flow.js";
import {
  PortProjectFlow,
  PortFileFlowInstance,
  configurePortHarness,
  parsePrepSourceMap,
  type PortRunInput,
  type PortRunResult,
} from "../flows/port-project.js";
import {
  configureEnvelopeStreamPublisher,
  envelopeStream,
} from "../flows/steps/envelope.js";
import {
  configurePortFault,
  configurePortJudgment,
  configureTurnHealthAssessor,
} from "../flows/runtime-hooks.js";
import { createOfflineJevClient, judgmentLaneSummary } from "../src/harness/runtime.js";
import { createRealJevClient, isTypesafeOffline } from "../src/typesafe/client.js";
import type { JudgmentClient } from "../src/typesafe/client.js";
import { createTurnHealthAssessor } from "../src/typesafe/turn-health.js";
import { dexCliQueries, describeError } from "../src/dashboard/queries.js";
import {
  evaluateDispatchGate,
  GATE_FLOW_ID_OPTION,
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

/**
 * `--harness stub|opencode|auto` (absent = auto; anything else is rejected):
 * stub = the labelled test double; opencode = the real harness, FAILS when
 * the server does not answer; auto = the real harness when the server answers,
 * otherwise a loud warning and the stub. Reachability is probed
 * (src/harness/select.ts) because connect() performs no I/O. Recovery passes
 * `requireReal`: it must enumerate and abort the real server's sessions, so
 * there `auto` fails like `opencode` instead of skipping the fence on a stub.
 */
async function pickHarness(
  name: string | undefined,
  opts: { requireReal?: boolean } = {},
): Promise<AgentSessionClient> {
  return selectHarness({
    choice: name,
    requireReal: opts.requireReal,
    baseUrl: process.env.OPENCODE_BASE_URL?.trim() || undefined,
    model:
      process.env.OPENCODE_MODEL_PROVIDER && process.env.OPENCODE_MODEL_ID
        ? {
            providerID: process.env.OPENCODE_MODEL_PROVIDER,
            modelID: process.env.OPENCODE_MODEL_ID,
          }
        : undefined,
    makeStub: () => new StubHarness(),
  });
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
  const escaped = escapeRegExp(file);
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
  const harness = await pickHarness(process.env.HARNESS, { requireReal: true });
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
    return await waitAndReport(runtime, flowId, 30, "round");
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

/**
 * Exit codes for the commands that wait on a flow. The wait returning means
 * the flow is CLOSED, not that it succeeded, so the outcome is mapped
 * explicitly (an orchestrating agent keys off these):
 *   0 completed, nothing left unresolved
 *   1 failed / cancelled / terminated (also any fatal CLI error)
 *   64 usage error (sysexits EX_USAGE; see RUN_DEMO_EXIT)
 *   3 completed, but files are blocked or tsc / vitest report failures
 *   4 the wait elapsed while the flow is STILL RUNNING (healthy; keep waiting
 *     with `wait-flow --id <flowId>`, do NOT re-dispatch)
 */
export const EXIT_FLOW_FAILED = 1;
export const EXIT_UNRESOLVED = 3;
export const EXIT_STILL_RUNNING = 4;

/** Every exit code run-demo returns (the table the usage text lists). */
export const RUN_DEMO_EXIT = {
  ok: 0,
  failed: EXIT_FLOW_FAILED,
  unresolved: EXIT_UNRESOLVED,
  stillRunning: EXIT_STILL_RUNNING,
  usage: CLI_EXIT.usage,
} as const;

/** The PpFinal completion's payload (the port flow's gracefulComplete output), when present. */
export function decodePortRunResult(result: FlowResult): PortRunResult | undefined {
  const final = result.completions.find((c: StepCompletion) => c.stepType === "PpFinal");
  if (final === undefined) return undefined;
  try {
    return final.decode<PortRunResult>();
  } catch {
    return undefined;
  }
}

/** Maps a FlowResult to an exit code and the lines to print (pure; see the exit-code table above). */
export function flowOutcome(
  label: string,
  flowId: string,
  result: FlowResult,
): { code: number; lines: string[] } {
  const head = `[${label}] flowId=${flowId} status=${result.status}`;
  if (!result.isTerminal) {
    return {
      code: EXIT_STILL_RUNNING,
      lines: [`${head} — flow still running: use \`run-demo.ts wait-flow --id ${flowId}\``],
    };
  }
  if (result.status !== "completed") {
    return {
      code: EXIT_FLOW_FAILED,
      lines: [
        `${head} errorType=${result.errorType ?? "n/a"} message=${JSON.stringify(result.errorMessage ?? "")}`,
      ],
    };
  }
  const port = decodePortRunResult(result);
  if (port === undefined) return { code: 0, lines: [`${head} result=${JSON.stringify(result)}`] };
  const blocked = port.blocked.length;
  const tsc = port.verification?.tscTotal ?? 0;
  const vitest = port.verification?.vitestTotal ?? 0;
  const unresolved = blocked > 0 || tsc > 0 || vitest > 0;
  // A vitest pass that never executed is not "0 failures", and neither is a
  // typecheck that never ran: say so in the line (the exit code only reflects
  // counted failures and blocked files). tscTotal counts LOCATED diagnostics
  // only; the accounting (Contract A) says whether that count can be trusted.
  const run = port.verification?.vitestRun;
  const vitestState = run == null ? "" : run.kind === "ran" ? ` (ran ${run.passed}/${run.total})` : ` (NOT RUN: ${run.reason})`;
  const tscRun = port.verification?.tscRun;
  const tscState =
    tscRun == null
      ? ""
      : tscRun.state === "not-run"
        ? ` (NOT RUN: ${tscRun.reason ?? "reason unrecorded"})`
        : tscRun.unlocated > 0
          ? ` (+${tscRun.unlocated} unlocated diagnostic(s))`
          : "";
  return {
    code: unresolved ? EXIT_UNRESOLVED : 0,
    lines: [
      `${head} completed=${port.completed.length} blocked=${blocked} tsc=${tsc}${tscState} vitest=${vitest}${vitestState}${unresolved ? " (unresolved work remains)" : ""}`,
      `[${label}] result: ${JSON.stringify(port)}`,
    ],
  };
}

/** Waits for a flow through the typed helper, prints the outcome, and returns its exit code. */
export async function waitAndReport(
  runtime: { client: { waitForFlow(flowId: string): Promise<FlowResult> } },
  flowId: string,
  waitMinutes: number,
  label: string,
  retryDelayMs?: number,
): Promise<number> {
  try {
    const result = await waitForFlowTerminal(runtime, flowId, waitMinutes * 60_000, retryDelayMs);
    const outcome = flowOutcome(label, flowId, result);
    for (const line of outcome.lines) (outcome.code === 0 ? console.log : console.error)(line);
    return outcome.code;
  } catch (err) {
    // The deadline elapsed on a healthy long poll: the durable flow is still
    // running. Say so and use a distinct code instead of calling it fatal.
    if (err instanceof LongPollTimeoutError) {
      console.error(
        `[${label}] flowId=${flowId} — wait of ${waitMinutes} min elapsed, flow still running: use \`run-demo.ts wait-flow --id ${flowId}\` (do not re-dispatch)`,
      );
      return EXIT_STILL_RUNNING;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Demo input resolution + preflight (C70): everything that can be wrong with a
// `demo` invocation is checked BEFORE a repo is created, dex is contacted or a
// flow is started, and reported in one message.
// ---------------------------------------------------------------------------

/** Fixture inputs ship next to this script, whatever the caller's cwd is. */
const FIXTURES_DIR = join(import.meta.dir, "..", "fixtures");
const DEMO_DEFAULT_FILES = "src/Money.php,src/Pricing/FlatRateDiscount.php";

// ---------------------------------------------------------------------------
// Command line (audit C69): one option table per command, on the shared layer
// in src/cli/args.ts. Parsing, validation, typing and the usage text all come
// from these tables.
// ---------------------------------------------------------------------------

/** The values select.ts accepts for `--harness`; `satisfies` keeps this list a subset of its HarnessChoice. */
const HARNESS_CHOICES = ["stub", "opencode", "auto"] as const satisfies readonly HarnessChoice[];

const START_ONLY_OPTION = {
  kind: "flag",
  description: "start the flow and return without waiting for it",
} as const;

const INIT_FIXTURE_OPTION = {
  kind: "flag",
  description: "create a throwaway fixture repository when --dir does not exist (an existing directory is never touched)",
} as const;

const WAIT_MINUTES_OPTION = {
  kind: "int",
  min: 1,
  default: 30,
  metavar: "n",
  description: "how long to wait for the flow; a flow still running then exits 4 (resume with wait-flow --id)",
} as const;

export const RUN_DEMO_CLI = defineProgram({
  name: "run-demo.ts",
  summary:
    "Phase 0 exit-criteria driver and port-flow runner. Needs a running dex server (`dexcli dev -open=false`) except for git-selftest and gate.",
  commands: {
    worker: {
      summary: "long-running dex worker (kill target); runs until killed",
      options: {
        harness: {
          kind: "enum",
          choices: HARNESS_CHOICES,
          default: "auto",
          description:
            "stub = labelled test double; opencode = real harness, fails if the server does not answer; auto = real when reachable, else a loud warning and the stub",
        },
        flows: {
          kind: "enum",
          choices: ["probe", "port"],
          default: "probe",
          description: "flows to register: the phase-0 probe flows, or the port flows (port.Project + port.File)",
        },
        fault: {
          kind: "string",
          metavar: "spec",
          description:
            "deterministic fault injection: commit:post-commit:<file>#<round> or agent-write:mid:<file>#<round> (default: $PORTING_KIT_FAULT)",
        },
      },
    },
    hello: {
      summary: "0(a)/0(b): start the hello flow and wait for it",
      options: {
        flowId: { kind: "string", metavar: "id", description: "flow id (default: hello-<epoch ms>)" },
      },
    },
    "long-step": {
      summary: "0(c): start a multi-minute step (the kill target)",
      options: {
        ...PROBE_LONG_STEP_OPTIONS,
        flowId: { kind: "string", metavar: "id", default: "long-1", description: "flow id" },
        startOnly: START_ONLY_OPTION,
      },
    },
    "wait-flow": {
      summary: "wait for a flow (resume observation)",
      options: {
        id: { kind: "string", metavar: "flowId", required: true, description: "flow to wait for" },
        waitMinutes: WAIT_MINUTES_OPTION,
      },
    },
    round: {
      summary: "0(d)/0(e): one fixture-repo round through the probe PortRound flow",
      options: {
        dir: {
          kind: "string",
          metavar: "repoDir",
          required: true,
          description: "git repository root; must already exist unless --init-fixture creates a throwaway one",
        },
        initFixture: INIT_FIXTURE_OPTION,
        ...PROBE_ROUND_OPTIONS,
      },
    },
    recover: {
      summary:
        "ordered recovery: abort/confirm sessions (enumeration fallback), lease reclaim, reconcile, re-dispatch (env: HARNESS, RECOVER_FILE, RECOVER_ROUND)",
      options: {
        dir: { kind: "string", metavar: "repoDir", required: true, description: "git repository of the interrupted round" },
        epoch: { kind: "int", min: 1, default: 2, description: "the bumped epoch to recover to" },
      },
    },
    "recover-port": {
      summary:
        "recovery for the port flow: abort stale sessions, reconcile each file's own lease worktree; prints the next demo command (does not run it)",
      options: {
        dir: { kind: "string", metavar: "projectRepoDir", required: true, description: "project git repository root" },
        epoch: { kind: "int", min: 1, default: 2, description: "the bumped epoch; must be higher than the interrupted run's" },
        files: {
          kind: "string",
          metavar: "files",
          description: "the run's files (comma-separated, or `creatorex`); same expansion as demo",
        },
        sourceRoot: { kind: "string", metavar: "dir", description: "echoed into the printed demo command" },
        prep: { kind: "string", metavar: "path", description: "echoed into the printed demo command" },
        flowId: { kind: "string", metavar: "id", description: "echoed into the printed demo command (it must be NEW)" },
        maxRounds: { kind: "int", min: 1, description: "echoed into the printed demo command" },
        harness: {
          kind: "enum",
          choices: HARNESS_CHOICES,
          default: "auto",
          description: "recovery must reach the real server, so auto fails like opencode when it is unreachable",
        },
      },
    },
    "agent-roundtrip": {
      summary: "0(e): a REAL opencode session, prompt and token usage (env: OPENCODE_BASE_URL, OPENCODE_MODEL_PROVIDER/ID)",
      options: {},
    },
    "git-selftest": {
      summary:
        "no dex needed: op-ID crash window (0d), stale-writer (0d2), differing-content replay across quarantine (0d3)",
      options: {},
    },
    gate: {
      summary: "US-002 lead-layer dispatch health gate: review-step failure facts from dexcli flow history; fail-open",
      options: { flowId: GATE_FLOW_ID_OPTION },
    },
    demo: {
      summary: "port-flow dispatch into an existing git repository; inputs are preflighted before dex is contacted",
      options: {
        dir: {
          kind: "string",
          metavar: "repoDir",
          required: true,
          description: "project git repository root (the port target); must exist unless --init-fixture",
        },
        files: {
          kind: "string",
          metavar: "a.php,b.php|creatorex",
          default: DEMO_DEFAULT_FILES,
          description: "PHP files relative to --source-root; `creatorex` is the 10-file set and implies its --prep and --source-root",
        },
        prep: {
          kind: "string",
          metavar: "path",
          description: "prep artifact with the source-map rows (default: the php-sample stub; the creatorex stub for --files creatorex)",
        },
        sourceRoot: {
          kind: "string",
          metavar: "dir",
          description: "directory holding the source files (default: fixtures/php-sample; creatorex-middleware for --files creatorex)",
        },
        epoch: { kind: "int", min: 1, default: 1, description: "session-fence epoch" },
        maxRounds: { kind: "int", min: 1, default: 1, description: "port/fix rounds per file" },
        waitMinutes: WAIT_MINUTES_OPTION,
        flowId: { kind: "string", metavar: "id", description: "flow id (default: demo-<epoch ms>)" },
        gateFlowId: GATE_FLOW_ID_OPTION,
        dispatch: {
          kind: "enum",
          choices: ["parallel", "sequential"],
          default: "parallel",
          description: "per-file waves as SubFlows over the 2 slots (parallel), or one file at a time",
        },
        startOnly: START_ONLY_OPTION,
        initFixture: INIT_FIXTURE_OPTION,
        dashboard: {
          kind: "flag",
          description:
            "also start the read-only status server (scripts/serve-status.ts) on STATUS_PORT (default 4646) unless that port is taken; log in $TMPDIR; stop it with the printed `kill <pid>`",
        },
      },
    },
  },
  notes: [
    exitCodesNote(RUN_DEMO_EXIT, {
      ok: "ok",
      failed: "flow failed/cancelled/terminated, or fatal error",
      unresolved: "completed with blocked files or tsc/vitest failures",
      stillRunning: "wait elapsed, flow still running",
      usage: "usage error",
    }),
    "Environment: DEX_SERVER_ADDRESS, OPENCODE_BASE_URL, OPENCODE_MODEL_PROVIDER/OPENCODE_MODEL_ID, TYPESAFE_API_KEY/TYPESAFE_OFFLINE, PORTING_KIT_FAULT (worker; --fault overrides it).",
  ],
});

type CommandName = keyof (typeof RUN_DEMO_CLI)["commands"];
/** The typed options of one run-demo command. */
export type CommandOptions<K extends CommandName> = ParsedOptions<(typeof RUN_DEMO_CLI)["commands"][K]["options"]>;
export type DemoOptions = CommandOptions<"demo">;

/** Strict parse of run-demo's argv (`<command> [options]`, without the `bun run script` prefix). */
export function parseRunDemoArgs(argv: readonly string[]) {
  return parseCommand(RUN_DEMO_CLI, argv);
}

export interface DemoInputs {
  /** Absolute project repository root (the target of the port). */
  dir: string;
  /** Create a throwaway fixture repo when `dir` does not exist (opt-in). */
  initFixture: boolean;
  /** The raw --files value (kept so a printed command can echo `creatorex`). */
  filesArg: string;
  files: string[];
  /** Absolute path of the prep artifact. */
  prepPath: string;
  /** Absolute dir holding the source files named by `files`. */
  sourceRoot: string;
  epoch: number;
  maxRounds: number;
  waitMinutes: number;
  dispatchMode: "sequential" | "parallel";
}

/**
 * Resolves the parsed `demo` options. Defaults are the php-sample fixtures
 * located from THIS script (never the cwd); `--files creatorex` implies the
 * creatorex prep artifact and source root (explicit --prep / --source-root
 * still win), which is the pair its 10 files need. All paths come back
 * absolute because the flow runs in the worker process, whose cwd may differ.
 * Validation (required --dir, whole-number and enum flags) already happened in
 * the parse; see {@link parseRunDemoArgs}.
 */
export function resolveDemoInputs(options: DemoOptions, fixturesDir: string = FIXTURES_DIR): DemoInputs {
  const filesArg = options.files.trim();
  const creatorex = filesArg === "creatorex";
  const creatorexDir = join(fixturesDir, "creatorex-middleware");
  return {
    dir: resolve(options.dir),
    initFixture: options.initFixture,
    filesArg,
    files: expandFilesArg(filesArg),
    prepPath: resolve(
      options.prep ?? (creatorex ? join(creatorexDir, "prep-stub.md") : join(fixturesDir, "stub-prep.md")),
    ),
    sourceRoot: resolve(options.sourceRoot ?? (creatorex ? creatorexDir : join(fixturesDir, "php-sample"))),
    epoch: options.epoch,
    maxRounds: options.maxRounds,
    waitMinutes: options.waitMinutes,
    dispatchMode: options.dispatch,
  };
}

/**
 * Fails fast with ONE message listing every problem, instead of the flow
 * failing after dispatch (`prep source map lacks rows for: ...`): the prep
 * artifact is readable, every file has an exact row in its source map, the
 * source root is a directory, and every file exists under it.
 */
export async function preflightDemoInputs(
  inputs: Pick<DemoInputs, "files" | "prepPath" | "sourceRoot">,
): Promise<void> {
  const problems: string[] = [];
  if (inputs.files.length === 0) problems.push("--files names no files");

  let prep: string | undefined;
  try {
    prep = await readFile(inputs.prepPath, "utf8");
  } catch (err) {
    problems.push(`prep artifact ${inputs.prepPath} is not readable (${(err as NodeJS.ErrnoException).code ?? String(err)})`);
  }
  if (prep !== undefined) {
    const sourceMap = parsePrepSourceMap(prep);
    const missing = inputs.files.filter((f) => sourceMap[f] === undefined);
    if (missing.length > 0) {
      problems.push(`prep artifact ${inputs.prepPath} has no source-map row for: ${missing.join(", ")}`);
    }
  }

  const rootIsDir = await stat(inputs.sourceRoot).then((s) => s.isDirectory(), () => false);
  if (!rootIsDir) {
    problems.push(`source root ${inputs.sourceRoot} is not a directory`);
  } else {
    const absent: string[] = [];
    for (const f of inputs.files) {
      if (!(await exists(join(inputs.sourceRoot, f)))) absent.push(f);
    }
    if (absent.length > 0) problems.push(`not found under source root ${inputs.sourceRoot}: ${absent.join(", ")}`);
  }

  if (problems.length > 0) {
    throw new Error(`demo preflight failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

/**
 * The project repository must already exist (a git repository root with at
 * least one commit). A typo in --dir used to silently become a fresh README-only
 * repo; creating one is now opt-in via --init-fixture and only ever happens for
 * a path that does not exist (an existing directory is never removed).
 */
export async function ensureProjectRepo(
  dir: string,
  opts: { initFixture: boolean },
): Promise<"existing" | "created"> {
  if (!(await exists(dir))) {
    if (!opts.initFixture) {
      throw new Error(
        `--dir ${dir} does not exist. Pass the path of an existing git repository, or --init-fixture to create a throwaway fixture repository there.`,
      );
    }
    await makeFixtureRepo(dir);
    return "created";
  }
  const head = await git(dir).tryRun(["rev-parse", "--verify", "HEAD"]);
  if (!head.ok) {
    throw new Error(
      `--dir ${dir} exists but is not a git repository with at least one commit (git rev-parse --verify HEAD: ${head.stderr.trim()})`,
    );
  }
  const top = (await git(dir).run(["rev-parse", "--show-toplevel"])).trim();
  if ((await realpath(top)) !== (await realpath(dir))) {
    throw new Error(`--dir ${dir} is inside the git repository at ${top}; pass the repository root`);
  }
  return "existing";
}

// ---------------------------------------------------------------------------
// Optional status dashboard (`demo --dashboard`, C72). serve-status.ts is a
// read-only monitor; it is never started implicitly, it reports whether it
// really came up, and its output goes to a log file instead of /dev/null.
// ---------------------------------------------------------------------------

const DEFAULT_STATUS_PORT = 4646;

/** Dashboard port: STATUS_PORT (a dedicated name: PORT is generic and Bun auto-loads it from .env), default 4646. */
export function dashboardPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.STATUS_PORT?.trim();
  if (raw === undefined || raw === "") return DEFAULT_STATUS_PORT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`STATUS_PORT must be a port number 1-65535 (got ${JSON.stringify(raw)})`);
  }
  return n;
}

/** True when something already accepts connections on host:port. */
export function probePortInUse(port: number, host = "127.0.0.1", timeoutMs = 500): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port, host });
    const finish = (inUse: boolean) => {
      socket.destroy();
      done(inUse);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/**
 * Environment handed to the serve-status child. The port travels as
 * STATUS_PORT, the variable serve-status reads FIRST (src/dashboard/config.ts);
 * the generic PORT is only its deprecated fallback, so it is never what we pass
 * (an ambient PORT is ignored whenever STATUS_PORT is set). The port serve-status
 * resolves from this env is therefore always the one launchDashboard probes and logs.
 */
export function dashboardChildEnv(env: NodeJS.ProcessEnv, dir: string, port: number): NodeJS.ProcessEnv {
  return { ...env, STATUS_REPO_ROOT: dir, STATUS_PORT: String(port) };
}

export type DashboardLaunch =
  | { status: "started"; pid: number; port: number; logPath: string; message: string }
  | { status: "in-use"; port: number; message: string }
  | { status: "failed"; port: number; logPath: string; message: string }
  | { status: "missing"; message: string };

/**
 * Starts serve-status.ts for `dir` on STATUS_PORT and confirms it is really
 * listening. If the port is already taken it does NOT start a second copy (whatever
 * listens there keeps serving ITS OWN STATUS_REPO_ROOT, not `dir`) and says so.
 * The child is detached (it outlives the demo); its stdout/stderr go to a log file.
 */
export async function launchDashboard(
  dir: string,
  opts: { serveStatusPath?: string; env?: NodeJS.ProcessEnv; readyTimeoutMs?: number } = {},
): Promise<DashboardLaunch> {
  const env = opts.env ?? process.env;
  const serveStatus = opts.serveStatusPath ?? join(import.meta.dir, "serve-status.ts");
  if (!(await exists(serveStatus))) {
    return { status: "missing", message: `${serveStatus} not found; not started` };
  }
  const port = dashboardPort(env);
  const host = env.STATUS_HOST?.trim() || "127.0.0.1";
  if (await probePortInUse(port, host)) {
    return {
      status: "in-use",
      port,
      message: `${host}:${port} is already in use; NOT starting another. Whatever listens there keeps serving its own STATUS_REPO_ROOT, not ${dir}. Set STATUS_PORT to use a free port.`,
    };
  }
  const logPath = join(tmpdir(), `run-demo-dashboard-${port}.log`);
  const logFd = openSync(logPath, "a");
  const child = spawn(process.execPath, [serveStatus], {
    env: dashboardChildEnv(env, dir, port),
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });
  closeSync(logFd);
  let exitCode: number | null | undefined;
  child.once("exit", (code) => {
    exitCode = code;
  });
  child.unref();
  // Wait for the bind: a child that dies (EADDRINUSE race, bad config) must not be
  // reported as a live dashboard.
  const deadline = Date.now() + (opts.readyTimeoutMs ?? 8_000);
  while (Date.now() < deadline) {
    if (exitCode !== undefined) break;
    if (await probePortInUse(port, host)) {
      return {
        status: "started",
        pid: child.pid ?? -1,
        port,
        logPath,
        message: `http://${host}:${port} (pid ${child.pid}, log ${logPath}; stop it with: kill ${child.pid})`,
      };
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return {
    status: "failed",
    port,
    logPath,
    message:
      exitCode !== undefined
        ? `serve-status exited (code ${exitCode}) before listening on ${host}:${port}; see ${logPath}`
        : `serve-status is not listening on ${host}:${port} yet (pid ${child.pid}); see ${logPath}`,
  };
}

async function startDemo(options: DemoOptions): Promise<number> {
  const config = dexConfigFromEnv();
  const inputs = resolveDemoInputs(options);
  const { dir, files, prepPath, sourceRoot, epoch, maxRounds, waitMinutes } = inputs;
  // Validate before anything is created or contacted.
  await preflightDemoInputs(inputs);
  if ((await ensureProjectRepo(dir, { initFixture: inputs.initFixture })) === "created") {
    console.log(`[demo] --init-fixture: created throwaway fixture repository at ${dir}`);
  }
  // US-002: optional pre-dispatch health gate (lead-layer, fail-open). When
  // --gate-flow-id names a previous/current flow, its review-step facts are
  // consulted and surfaced BEFORE startFlow; a degraded gate prints the
  // explicit no-protection note and STILL dispatches.
  if (options.gateFlowId !== undefined) {
    await runDispatchGate(options.gateFlowId);
  }

  const flows: Flow<any>[] = [new PortProjectFlow()];
  const runtime = await openDexClient(flows, config);
  try {
    const flow = flows[0];
    if (flow === undefined) throw new Error("PortProjectFlow not registered");
    const flowId = options.flowId ?? `demo-${Date.now()}`;
    const input: PortRunInput = {
      repoRoot: dir,
      worktreeRoot: join(dir, ".worktrees"),
      integrationWorktreePath: join(dir, ".worktrees", "integration"),
      epoch,
      sourceRoot,
      prepPath,
      files,
      maxRounds,
      // v1.1 default: parallel per-file waves (SubFlows over the 2 slots).
      dispatchMode: inputs.dispatchMode,
    };
    const runId = await runtime.client.startFlow(flow, flowId, input);
    console.log(`[demo] started flowId=${flowId} runId=${runId} files=${files.join(",")} epoch=${epoch}`);
    // Optional live-dashboard hook (worker-5, plan v6.1), OPT-IN via --dashboard:
    // launches the read-only status server next to the run; never fatal.
    if (options.dashboard) {
      console.log(`[demo] dashboard: ${(await launchDashboard(dir)).message}`);
    }
    if (options.startOnly) return 0;
    return await waitAndReport(runtime, flowId, waitMinutes, "demo");
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
async function listWorktrees(repoDir: string): Promise<WorktreeRef[]> {
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
  // The demo default is 1 round: a run that used more must say so again, or the
  // re-dispatch silently schedules no fix rounds.
  parts.push(`--max-rounds ${o.maxRounds !== undefined ? shellWord(o.maxRounds) : "<maxRounds>"}`);
  return parts.join(" ");
}

async function recoverPort(options: CommandOptions<"recover-port">): Promise<number> {
  const { dir, epoch, files: filesArg } = options;
  // Same expansion as `demo` (`--files creatorex` is the 10-file fixture set).
  const files = expandFilesArg(filesArg ?? "");

  console.log(`[recover-port] epoch bump → ${epoch}; repo=${dir}`);

  // 1-2. Ordered abort: persisted fences carry epoch-tagged labels; when the
  // fence attribute is not reachable outside a flow context, use the plan's
  // ENUMERATION FALLBACK against the surviving opencode server.
  const harness = await pickHarness(options.harness, { requireReal: true });
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
      sourceRoot: options.sourceRoot,
      prepPath: options.prep,
      flowId: options.flowId,
      maxRounds: options.maxRounds?.toString(),
    })}`,
  );
  return failures === 0 ? 0 : 1;
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

async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const parsed = parseRunDemoArgs(argv);
  if (!parsed.ok) return reportParseFailure("run-demo", parsed);
  const config = dexConfigFromEnv();

  switch (parsed.command) {
    case "worker": {
      const { options } = parsed;
      const harness = await pickHarness(options.harness);
      const flows = options.flows === "port" ? portFlows(harness) : probeFlows();
      const fault = options.fault ?? process.env.PORTING_KIT_FAULT;
      configureProbe(harness, fault);
      const judgment = await resolveJudgment();
      configurePortJudgment(judgment);
      configurePortFault(fault);
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
        `[worker] JUDGMENT LANE: ${judgmentLaneSummary(judgment.kind)}`,
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
      console.log(`[worker] up: target=${handle.workerTargetAddress} server=${config.serverAddress} fault=${fault ?? "none"} harness=${describeHarness(harness)} (requested=${options.harness}) flows=${options.flows}`);
      await new Promise(() => {}); // run until killed
      return 0;
    }
    case "hello": {
      const flows = probeFlows();
      const runtime = await openDexClient(flows, config);
      try {
        const flow = flows.find((f) => f.getFlowType() === "probe.Hello");
        if (flow === undefined) throw new Error("probe.Hello not registered");
        const flowId = parsed.options.flowId ?? `hello-${Date.now()}`;
        await runtime.client.startFlow(flow, flowId, undefined);
        return await waitAndReport(runtime, flowId, 30, "hello");
      } finally {
        await runtime.close();
      }
    }
    case "long-step": {
      const { ms, flowId, startOnly } = parsed.options;
      const flows = probeFlows();
      const runtime = await openDexClient(flows, config);
      try {
        const flow = flows.find((f) => f.getFlowType() === "probe.LongStep");
        if (flow === undefined) throw new Error("probe.LongStep not registered");
        await runtime.client.startFlow(flow, flowId, { ms });
        console.log(`[long-step] started flowId=${flowId} ms=${ms}`);
        if (startOnly) return 0;
        // The step itself runs `ms`; allow the same again plus slack to finish.
        return await waitAndReport(runtime, flowId, Math.ceil((ms * 2) / 60_000) + 5, "long-step");
      } finally {
        await runtime.close();
      }
    }
    case "wait-flow": {
      const { id: flowId, waitMinutes } = parsed.options;
      const runtime = await openDexClient(probeFlows(), config);
      try {
        return await waitAndReport(runtime, flowId, waitMinutes, "wait-flow");
      } finally {
        await runtime.close();
      }
    }
    case "round": {
      const { options } = parsed;
      const dir = resolve(options.dir);
      // A nonexistent --dir is an error unless --init-fixture asks for a fixture.
      await ensureProjectRepo(dir, { initFixture: options.initFixture });
      return await startRound(dir, options.file, options.round, options.epoch);
    }
    case "recover":
      return await orderedRecover(parsed.options.dir, parsed.options.epoch);
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
      return await recoverPort(parsed.options);
    case "gate":
      return await runDispatchGate(parsed.options.flowId);
    case "demo":
      return await startDemo(parsed.options);
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
