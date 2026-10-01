/**
 * The project-level control steps of PortProjectFlow: dispatch, lease, release,
 * final, the verification queue (tsc + vitest) with its fix-round selection, the
 * integration bootstrap step, and the parallel wave dispatch/join over the
 * per-file child flow. Imports the per-file pipeline (file-steps.ts) and the
 * child flow (file-flow.ts); nothing it imports routes back here except through
 * the forward link in ./links.ts.
 */

import { goTo, SubFlow, Wait } from "@superdurable/dex";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  envelopeStepClass,
  type EnvelopeOutcome,
  type EnvelopeStepClass,
} from "../steps/envelope.js";
import { faultMatches } from "../runtime-hooks.js";
import {
  findCommitByOpId,
  integratedContentExists,
  keyedCommitIntegrated,
  mergeLeaseIntoIntegration,
  operationId,
} from "../../src/git/worktree.js";
import {
  buildTscQueueState,
  capErrorsPerFile,
  tscOutcomeFromRun,
} from "../../src/queues/tsc-queue.js";
import { classifyVitestRecords, liveJevClient, recordJevUsage } from "./lane-b.js";
import { leasePool } from "./leases.js";
import {
  baseInput,
  baseInputOf,
  childInputOf,
  deriveNext,
  errorCountsByOutput,
  fileRoundIdentity,
  markerKeyOf,
  portedRootsFromSourceMap,
  selectFixableFiles,
  vitestRoutedTo,
  waveEntryRound,
} from "./queue-logic.js";
import { runIntegrationBootstrap, tsconfigIncludeFromSourceMap, scaffoldTsconfigText } from "./bootstrap.js";
import {
  findVitestTestFiles,
  pathExists,
  queueVerifyTools,
  runCaptured,
  vitestOutcomeFromRun,
} from "./queue-tools.js";
import { PortFileFlowInstance } from "./file-flow.js";
import { FenceStep } from "./file-steps.js";
import { releaseStepLink } from "./links.js";
import {
  LEASE_SLOT_CAP,
  type ChildFileResult,
  type FileRoundInput,
  type PortQueueState,
  type PortRunInput,
  type PortRunResult,
  type VitestTriageRecord,
  type WaveDispatchOutput,
  type WaveEntry,
  ppBootstrap,
  ppBurndown,
  ppConfig,
  ppJevUsage,
  ppLease,
  ppMarker,
  ppPrep,
  ppQueue,
  ppVerify,
  ppWave,
  ppWaveChildren,
} from "./state.js";
import { RESTART_WINDOW_RETRY } from "./step-options.js";
import { sanitizeFileKey, stripDotSlash } from "../../src/file-keys.js";

/**
 * DispatchStep output: `done` = the port queue is exhausted; `requeue` = this
 * pass only recorded a blocked file (round cap) and must be followed by another
 * dispatch pass for the files still pending.
 */
type DispatchOutput = PortRunInput & { done: boolean; requeue?: boolean };

export const DispatchStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, DispatchOutput>({
  stepType: "PpDispatch",
  stepId: "pp-dispatch",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppConfig] },
  // Best-effort identity: the claim happens inside inner, so the start
  // event reports the in-flight file (resume) or flow-level (fresh claim).
  identityOf: (ctx) => {
    const q = ppQueue.get(ctx, "queue");
    return q?.current ? markerKeyOf(q.current.file, q.current.round) : "";
  },
  inner: async (ctx, input) => {
    const queue = ppQueue.get(ctx, "queue");
    const config = ppConfig.get(ctx, "config");
    if ((input.dispatchMode ?? "parallel") === "parallel") {
      // Parallel mode: pending is consumed by the WAVE JOIN after children
      // commit — dispatch only reports whether the port queue is exhausted
      // (deriveNext's current/popping is sequential-loop machinery).
      const nothingPending = queue.pending.length === 0;
      return { output: { ...input, done: nothingPending }, tokens: null };
    }
    const action = deriveNext(queue, config?.maxRounds ?? input.maxRounds);
    if (action.kind === "blocked") {
      const blocked: PortQueueState = {
        ...queue,
        pending: queue.pending.filter((f) => f !== action.file),
        blocked: [
          ...queue.blocked,
          { file: action.file, round: action.round, reason: action.reason },
        ],
        current: null,
      };
      ppQueue.set(ctx, "queue", blocked);
      // Not Lease: with current cleared LeaseStep reads "exhausted" and ends the
      // run, silently abandoning every file still pending behind this one. Each
      // blocked pass removes one file, so re-dispatching always terminates.
      return { output: { ...input, done: false, requeue: true }, tokens: null, outcome: "skipped" };
    }
    if (action.kind === "start") {
      ppQueue.set(ctx, "queue", {
        ...queue,
        pending: queue.pending.filter((f) => f !== action.file),
        current: { file: action.file, round: 1, epoch: input.epoch },
      });
    }
    // "resume": current already set — nothing to mutate, just re-enter the loop.
    // "done": route below must go to Final (the loop terminator).
    return { output: { ...input, done: action.kind === "done" }, tokens: null };
  },
  route: (_ctx, _input, out) => {
    const { done, requeue, ...run } = out;
    if (requeue === true) return goTo(DispatchStep, run);
    if (done) return goTo(QueueVerifyStep, out);
    if ((out.dispatchMode ?? "parallel") !== "parallel") return goTo(LeaseStep, out);
    const portWave: WaveDispatchOutput = { ...out, mode: "port" };
    return goTo(WaveDispatchStep, portWave);
  },
});

/** Lease outcome: carry the file-round forward, or report an exhausted queue. */
export type LeaseOutcome =
  | { kind: "lease"; fri: FileRoundInput }
  | { kind: "exhausted"; input: PortRunInput };

export const LeaseStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, LeaseOutcome>({
  stepType: "PpLease",
  stepId: "pp-lease",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppLease] },
  inner: async (ctx, input) => {
    const queue = ppQueue.get(ctx, "queue");
    const current = queue.current;
    if (current === null) {
      // Queue exhausted between dispatch and lease (retry-after-race or a
      // resumed replay): terminate gracefully instead of error-looping.
      return {
        output: { kind: "exhausted", input },
        tokens: null,
        outcome: "skipped" as EnvelopeOutcome,
      };
    }
    const pool = leasePool(ctx, input);
    const leased = (lease: { worktreePath: string; branch: string }): { output: LeaseOutcome; tokens: null } => ({
      output: {
        kind: "lease",
        fri: {
          ...input,
          file: current.file,
          round: current.round,
          epoch: current.epoch,
          worktreePath: lease.worktreePath,
          branch: lease.branch,
        },
      },
      tokens: null,
    });
    // Idempotent per (file, epoch): a lease surviving a kill is reused.
    const existing = pool.store().get(current.file);
    if (existing !== undefined && !pool.isStale(existing, current.epoch)) return leased(existing);
    const acquired = await pool.acquire(current.file, current.epoch, `pp-${current.epoch}`);
    if (!acquired.acquired) {
      throw new Error(`lease failed for ${current.file}: ${acquired.reason}`);
    }
    return leased(acquired.lease);
  },
  route: (_ctx, _input, out) =>
    out.kind === "lease" ? goTo(FenceStep, out.fri) : goTo(FinalStep, out.input),
});

export const ReleaseStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, PortRunInput>({
  stepType: "PpRelease",
  stepId: "pp-release",
  role: "record",
  identityOf: fileRoundIdentity,
  // ppLease: the lease is READ and removed through the lease pool below.
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppMarker, ppLease] },
  inner: async (ctx, fri) => {
    const queue = ppQueue.get(ctx, "queue");
    if (queue.current === null) {
      throw new Error("release inconsistency: no current file-round");
    }
    // Give the lease slot back (mirrors ChildReleaseStep). Without this the
    // sequential loop accumulated one pp-lease record per file at the same
    // epoch and the third file failed "worktree cap (2) reached". The merge
    // into integration happened in IntegrateStep, so dropping the worktree
    // here is safe; the lease branch stays for keyed-commit reachability.
    await leasePool(ctx, fri).release(fri.file);
    const marker = ppMarker.get(ctx, markerKeyOf(fri.file, fri.round));
    ppQueue.set(ctx, "queue", {
      ...queue,
      current: null,
      done: [
        ...queue.done,
        {
          file: fri.file,
          round: fri.round,
          commitSha: marker?.sha ?? null,
          treeHash: marker?.content_hash ?? null,
        },
      ],
    });
    return { output: baseInput(fri), tokens: null };
  },
  // US-010 (sequential path): release routes through the bootstrap step
  // before dispatch — the idempotent provisioning runs right after the first
  // integration and is a no-op thereafter.
  route: (_ctx, _input, out) => goTo(BootstrapStep, out),
});

// The one forward link (flows/port/links.ts): IntegrateStep routes here in sequential mode.
releaseStepLink.bind(ReleaseStep);

export const FinalStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunResult>({
  stepType: "PpFinal",
  stepId: "pp-final",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppVerify] },
  inner: async (ctx) => {
    const queue = ppQueue.get(ctx, "queue");
    const verify = ppVerify.get(ctx, "verify");
    return {
      output: {
        completed: queue.done,
        blocked: queue.blocked,
        verification:
          verify === undefined
            ? null
            : {
                iteration: verify.iteration,
                tscTotal: verify.tscTotal,
                vitestTotal: verify.vitestTotal,
                vitestNote: verify.vitestNote,
                vitestRun: verify.vitestRun ?? null,
                tscRun: verify.tscRun ?? null,
              },
      },
      tokens: null,
    };
  },
});

export const QueueVerifyStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<
  PortRunInput,
  PortRunInput & { exhausted: boolean }
>({
  stepType: "PpQueueVerify",
  stepId: "pp-queue-verify",
  role: "queue",
  stepOptions: {
    // ppJevUsage: vitest-triage live Jev tokens are recorded via
    // recordJevUsage (read) — undeclared-read live finding, cx6.
    executeLoadAttributeMaps: [ppVerify, ppQueue, ppConfig, ppPrep, ppMarker, ppJevUsage],
  },
  inner: async (ctx, input) => {
    const config = ppConfig.get(ctx, "config");
    const queue = ppQueue.get(ctx, "queue");
    const prep = ppPrep.get(ctx, "prep");
    const prev = ppVerify.get(ctx, "verify");
    const iteration = (prev?.iteration ?? 0) + 1;
    const recordedAt = new Date().toISOString();
    const itg = input.integrationWorktreePath;

    // Toolkit-owned scaffold: the integrated checkout needs a tsconfig for
    // tsc; queue infrastructure is toolkit code, not agent content.
    if (!(await pathExists(join(itg, "tsconfig.json")))) {
      await writeFile(
        join(itg, "tsconfig.json"),
        scaffoldTsconfigText(tsconfigIncludeFromSourceMap(prep?.sourceMap ?? {})),
      );
    }

    // tsc queue: parse + group via the proven queue module. C06: the process
    // outcome (exit code, kill/timeout, spawn error) is data, not a silent
    // "0 parsed errors": a run that could not produce a trustworthy count is
    // recorded as NOT-RUN with its reason.
    const tscRun = await runCaptured(queueVerifyTools.tscBin, ["--noEmit", "--pretty", "false"], {
      cwd: itg,
      timeoutMs: queueVerifyTools.tscTimeoutMs,
    });
    let tscOut = `${tscRun.stdout}\n${tscRun.stderr}`;
    // Deterministic kill-smoke fault (Phase 4 exit): iteration 1 only — inject
    // one synthetic, self-labeled tsc error for the first done file so the fix
    // round ACTUALLY runs and the queue/fix-round kill window exists. Never
    // active without PORTING_KIT_FAULT; the injected line names itself.
    if (faultMatches("queue-verify:inject-error", "seed") && iteration === 1) {
      const firstDone = queue.done[0];
      const injectPath = firstDone !== undefined ? prep?.sourceMap[firstDone.file]?.outPath : undefined;
      if (firstDone !== undefined && injectPath !== undefined) {
        tscOut += `\n${stripDotSlash(injectPath)}(1,1): error TS9999: injected fault queue-verify:inject-error:seed (synthetic — fix-round durability smoke, not a real port error)\n`;
      }
    }
    const tscOutcome = tscOutcomeFromRun({
      output: tscOut,
      exitCode: tscRun.exitCode,
      signal: tscRun.signal,
      killed: tscRun.killed,
      errorCode: tscRun.errorCode,
      timeoutMs: queueVerifyTools.tscTimeoutMs,
    });
    const tscState = buildTscQueueState(tscOutcome.errors, iteration);

    // vitest queue (US-010 honest accounting): the runner either RAN — counts
    // from the vitest summary plus parsed failure records — or did NOT run,
    // with an explicit reason. Runner provisioning is the bootstrap step's job
    // (pp-bootstrap); a missing runner here is an honest not-run, never a bare
    // zero. Test-file discovery drives the not-run "no test files" reason and
    // the classification roots come from the prep source map (ported test
    // trees are port OUTPUT — their failures route to the port loop).
    const vitestBin = join(itg, "node_modules", ".bin", "vitest");
    const binExists = await pathExists(vitestBin);
    const testFiles = await findVitestTestFiles(itg);
    let vitestIo: { stdout: string; stderr: string } | null = null;
    if (binExists && testFiles.length > 0) {
      // C26: vitest 3.x writes every `FAIL` block (message, diff, frames) to
      // STDERR and only the summary + per-file bullets to stdout — both
      // streams are captured. A non-zero exit = failing tests (still ran —
      // the output carries counts); no output at all on a failed spawn = null.
      const vitestProc = await runCaptured(vitestBin, ["run", "--reporter", "default"], {
        cwd: itg,
        timeoutMs: queueVerifyTools.vitestTimeoutMs,
      });
      const silent = vitestProc.stdout === "" && vitestProc.stderr === "";
      vitestIo =
        silent && vitestProc.exitCode !== 0
          ? null
          : { stdout: vitestProc.stdout, stderr: vitestProc.stderr };
    }
    const { vitestRun, records: vitestRecords } = vitestOutcomeFromRun(binExists, testFiles, vitestIo);
    const vitestNote = vitestRun.kind === "not-run" ? vitestRun.reason : null;
    const jevUsageSink: number[] = [];
    const roots = portedRootsFromSourceMap(prep?.sourceMap ?? {});
    let vitestTriage: VitestTriageRecord | undefined;
    const vitestState = await classifyVitestRecords(vitestRecords, iteration, liveJevClient(), {
      onUsage: (tokens) => {
        jevUsageSink.push(tokens);
      },
      onTriage: (triage) => {
        vitestTriage = triage;
      },
    }, roots);
    const vitestJevTokens = jevUsageSink.reduce((sum, t) => sum + t, 0);
    await recordJevUsage(ctx, "pp-queue-verify:vitest-triage", vitestJevTokens);
    const vitestTotal = vitestState.total;

    // Burn-down upserts (dashboard renders queue-burndown/*).
    ppBurndown.set(ctx, `tsc-${iteration}`, {
      queue: "tsc",
      iteration,
      // C06: error_count counts LOCATED diagnostics only; the accounting says
      // whether that count is trustworthy (ran) or vacuous (not-run).
      error_count: tscState.total,
      file: null,
      recorded_at: recordedAt,
      tsc: tscOutcome.accounting,
    });
    ppBurndown.set(ctx, `vitest-${iteration}`, {
      queue: "vitest",
      iteration,
      // US-010: the count is honest ONLY alongside the state — a not-run
      // iteration is never read as "zero failures".
      error_count: vitestRun.kind === "ran" ? vitestRun.failed : 0,
      file: null,
      recorded_at: recordedAt,
      vitest:
        vitestRun.kind === "ran"
          ? { state: "ran", reason: null, passed: vitestRun.passed, failed: vitestRun.failed, total: vitestRun.total }
          : { state: "not-run", reason: vitestRun.reason, passed: null, failed: null, total: null },
    });
    for (const group of tscState.byFile.slice(0, 8)) {
      ppBurndown.set(ctx, `tsc-${iteration}-${sanitizeFileKey(group.file)}`, {
        queue: "tsc",
        iteration,
        error_count: group.count,
        file: group.file,
        recorded_at: recordedAt,
      });
    }

    // Grouped errors feed the per-file fix loop: done files whose ported
    // output has queue errors get a FIX ROUND (round increment); files at the
    // round cap move to blocked (termination rule: caps OR empty queues).
    const errorCountByFile = errorCountsByOutput(tscState.errors, vitestState.classified);
    const { fixable, capped } = selectFixableFiles(
      queue.done,
      Object.fromEntries(
        Object.entries(prep?.sourceMap ?? {}).map(([php, v]) => [php, { outPath: v.outPath }]),
      ),
      errorCountByFile,
      config?.maxRounds ?? input.maxRounds,
    );
    // `capped` is recomputed from the WHOLE done set every iteration, so a
    // file capped earlier shows up again: append only files not already
    // blocked (C04 — else PortRunResult.blocked and the dashboard counts
    // inflate with every further iteration).
    const alreadyBlocked = new Set(queue.blocked.map((b) => b.file));
    const blocked = [
      ...queue.blocked,
      ...capped
        .filter((c) => !alreadyBlocked.has(c.file))
        .map((c) => ({
          file: c.file,
          round: c.round,
          reason: `round cap reached with ${c.count} queue error(s) remaining`,
        })),
    ];

    ppVerify.set(ctx, "verify", {
      iteration,
      fixQueue: fixable,
      tscTotal: tscState.total,
      vitestTotal,
      vitestNote,
      lastRunAt: recordedAt,
      // C05: capped PER FILE (not globally): selection above counts every
      // file's errors, so every fixable file must keep a non-empty feed.
      errors: capErrorsPerFile(tscState.errors).map((e) => ({
        file: stripDotSlash(e.file),
        code: e.code,
        message: e.message,
        line: e.line,
      })),
      vitestState,
      vitestRun,
      tscRun: tscOutcome.accounting,
      ...(vitestTriage !== undefined ? { vitestTriage } : {}),
    });
    const nextFix = fixable[0];
    ppQueue.set(ctx, "queue", {
      ...queue,
      blocked,
      current:
        nextFix !== undefined ? { file: nextFix.file, round: nextFix.fromRound + 1, epoch: input.epoch } : null,
    });

    // Remaining fixable files stay in fixQueue (release → dispatch →
    // QueueVerify pops the next one); exhausted = nothing fixable left.
    const exhausted = fixable.length === 0;
    return { output: { ...input, exhausted }, tokens: null };
  },
  route: (_ctx, input, out) => {
    if (out.exhausted) return goTo(FinalStep, out);
    if ((input.dispatchMode ?? "parallel") !== "parallel") return goTo(LeaseStep, out);
    const fixWave: WaveDispatchOutput = { ...input, mode: "fix" };
    return goTo(WaveDispatchStep, fixWave);
  },
});

/**
 * US-010 integration bootstrap (durable, deterministic, toolkit-owned): after
 * the FIRST integration the checkout is provisioned with a REAL vitest runner
 * (package.json, strict tsconfig, vitest.config.ts, bun install). Agents never
 * run installs — provisioning is this step, so the slow command lives OUTSIDE
 * every agent turn. Idempotent (skip-if-present; commit dedups on
 * BOOTSTRAP_OP_ID), so re-entry after every wave join / sequential integrate
 * is a cheap no-op and kill-replay converges. In parallel mode it sits between
 * the parent's port-wave join and the next dispatch; in sequential mode
 * between each integrate and the release.
 */
export const BootstrapStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpBootstrap",
  stepId: "pp-bootstrap",
  role: "integration",
  identityOf: () => "bootstrap",
  stepOptions: { executeRetry: { maximumAttempts: 2 }, executeLoadAttributeMaps: [ppPrep] },
  inner: async (ctx, input) => {
    // C06: the scaffold tsconfig must cover the prep source map's outputs.
    const prep = ppPrep.get(ctx, "prep");
    const outcome = await runIntegrationBootstrap({
      repoRoot: input.repoRoot,
      integrationWorktreePath: input.integrationWorktreePath,
      ...(prep !== undefined ? { tsconfigInclude: tsconfigIncludeFromSourceMap(prep.sourceMap) } : {}),
    });
    ppBootstrap.set(ctx, "bootstrap", {
      bootstrappedAtUtc: new Date().toISOString(),
      wrote: outcome.wrote,
      installRan: outcome.installRan,
      committed: outcome.committed,
      sha: outcome.sha,
    });
    return { output: input, tokens: null, outcome: outcome.changed ? "completed" : "skipped" };
  },
  // Both wiring points converge back on dispatch: parallel mode enters from
  // the port-wave join (before dispatch), sequential mode from Release
  // (integrate -> release -> bootstrap -> dispatch). Fix-wave joins skip it —
  // the idempotent skip keeps any unexpected re-entry a cheap no-op.
  route: (_ctx, _input, out) => goTo(DispatchStep, out),
});

// ---------------------------------------------------------------------------
// v1.1 — parallel per-file dispatch (dex SubFlows; default mode)
//
// WaveDispatch plans the next ≤2-file wave from the durable queue (fresh or
// fix rounds). WaveJoin declares `Wait.allOf(...SubFlow.run(PortFileFlow, …))`
// so both lease slots fill CONCURRENTLY; dex's RESTART_IF_PREVIOUS_EXITS_
// ABNORMALLY SubFlow reuse policy restarts a dead child on resume, making the
// join kill-safe. Children run the FULL per-file pipeline (lease → fence →
// implement/fix → reviews → commit) against their OWN attribute stores; the
// parent integrates serially after the join (the shared integration worktree
// never races) and appends git-derived done entries. Caps: one lease per
// child, wave width ≤ CHILD_SLOT_CAP. The WorktreePool cap is enforced per
// lease STORE and every child owns its own pp-lease store, so it can never
// trip across siblings: concurrency is bounded ONLY by the wave planner's
// slice width, never widened.
// ---------------------------------------------------------------------------

/** Wave width: one child per lease slot (the only cross-child concurrency bound). */
const CHILD_SLOT_CAP = LEASE_SLOT_CAP;

export const WaveDispatchStep: EnvelopeStepClass<WaveDispatchOutput> = envelopeStepClass<
  WaveDispatchOutput,
  WaveDispatchOutput
>({
  stepType: "PpWaveDispatch",
  stepId: "pp-wave-dispatch",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppQueue, ppVerify, ppConfig, ppPrep, ppWave] },
  inner: async (ctx, input) => {
    const queue = ppQueue.get(ctx, "queue");
    const verify = ppVerify.get(ctx, "verify");
    const prep = ppPrep.get(ctx, "prep");
    if (queue === undefined || prep === undefined) {
      throw new Error("wave dispatch requires durable queue + prep state");
    }
    let entries: WaveEntry[];
    if (input.mode === "fix") {
      const fixable = (verify?.fixQueue ?? []).slice(0, CHILD_SLOT_CAP);
      if (fixable.length === 0) throw new Error("fix wave dispatched with empty fix queue");
      const outPathOf = (file: string): string =>
        stripDotSlash(prep.sourceMap[file]?.outPath ?? "");
      // C03: a fix queue mixes files at different fromRounds. Each entry runs
      // at ITS OWN next round — one shared round skipped a round for the
      // lower-round file, or re-ran the higher-round file at a round whose
      // keyed commit already exists (the new fix deduped away).
      entries = fixable.map((f) => ({
        file: f.file,
        round: f.fromRound + 1,
        errors: (verify?.errors ?? []).filter((e) => e.file === outPathOf(f.file)),
        vitest: vitestRoutedTo(verify?.vitestState?.classified, outPathOf(f.file)),
      }));
    } else {
      const files = queue.pending.slice(0, CHILD_SLOT_CAP);
      if (files.length === 0) throw new Error("port wave dispatched with empty pending queue");
      entries = files.map((file) => ({ file, round: 1, errors: [], vitest: [] }));
    }
    ppWave.set(ctx, "wave", {
      entries,
      round: entries[0]?.round ?? 1,
      mode: input.mode,
      dispatchedAtUtc: new Date().toISOString(),
    });
    return { output: { ...input, mode: input.mode }, tokens: null };
  },
  route: (_ctx, _input, out) => goTo(WaveJoinStep, out),
});

export const WaveJoinStep: EnvelopeStepClass<WaveDispatchOutput> = envelopeStepClass<
  WaveDispatchOutput,
  WaveDispatchOutput
>({
  stepType: "PpWaveJoin",
  stepId: "pp-wave-join",
  role: "record",
  stepOptions: {
    executeLoadAttributeMaps: [ppQueue, ppVerify, ppPrep, ppWave],
    // Live finding (cx-5 first parallel dispatch): dex loads maps for the
    // EXECUTE phase via executeLoadAttributeMaps, but the WAIT-FOR phase has
    // its OWN load set — the join's waitFor reads pp-prep/pp-wave and failed
    // 14 attempts with "AttributeMap instance was not loaded for this
    // invocation: pp-prep/prep" until this declaration was added.
    waitForLoadAttributeMaps: [ppPrep, ppWave],
    // US-009-final: the join re-executes into the restart gap after a
    // kill+resume (cx7 resume fingerprint: finalAttempt 3 on the old 3-attempt
    // budget); same raised schedule as the marker/model steps.
    executeRetry: RESTART_WINDOW_RETRY,
    // The wait spans two full per-file pipelines; generous method timeout.
    waitForMethodTimeoutMs: 4 * 60 * 60_000,
  },
  waitFor: (ctx, input) => {
    const prep = ppPrep.get(ctx, "prep");
    if (prep === undefined) throw new Error("wave join requires durable prep state");
    const wave = ppWave.get(ctx, "wave");
    if (wave === undefined) throw new Error("wave join requires a durable wave record");
    const conditions = wave.entries.map((entry, i) => {
      const round = waveEntryRound(wave, entry);
      return SubFlow.run(
        PortFileFlowInstance,
        childInputOf(input, prep, entry.file, round, entry.errors, entry.vitest),
        { conditionId: `wave-${wave.mode}-${round}-${i}` },
      );
    });
    return Wait.allOf(...conditions);
  },
  inner: async (ctx, input) => {
    const wave = ppWave.get(ctx, "wave");
    const queue = ppQueue.get(ctx, "queue");
    if (wave === undefined || queue === undefined) {
      throw new Error("wave join requires durable wave + queue state");
    }
    // Publish child flow ids (metrics/dashboard fan-out surface).
    ppWaveChildren.set(ctx, "children", {
      children: wave.entries.map((entry, i) => ({
        file: entry.file,
        round: waveEntryRound(wave, entry),
        flowId: SubFlow.getFlowId(ctx, i),
      })),
    });

    // Serial integration of each child's keyed commit (git-durable; the
    // children released their leases, so this is the proven quarantine
    // geometry — branch merge from the shared object store). A child that
    // ended no-op-empty-diff has NO keyed commit: its receipt (terminal
    // SubFlow output) is the evidence, and the round-1 integrated content
    // must already exist (plan's no-op reconcile row).
    const prep = ppPrep.get(ctx, "prep");
    const done = [...queue.done];
    for (const [i, entry] of wave.entries.entries()) {
      const round = waveEntryRound(wave, entry);
      const result = SubFlow.getConditionResults(ctx, i);
      if (!result.isTerminal || result.errorType !== undefined) {
        throw new Error(`wave join: child ${entry.file}#${round} not successfully terminal (${result.status})`);
      }
      const receipt = result.singleOutput<ChildFileResult>();
      const opId = operationId(entry.file, round);
      const keyed = await findCommitByOpId(input.repoRoot, opId);
      if (keyed !== undefined) {
        await mergeLeaseIntoIntegration(
          input.repoRoot,
          input.integrationWorktreePath,
          keyed.branch,
          "integration",
        );
        if (!(await keyedCommitIntegrated(input.integrationWorktreePath, keyed))) {
          throw new Error(`C1: keyed commit ${keyed.sha} (${opId}) not reachable from integration`);
        }
        done.push({
          file: entry.file,
          round,
          commitSha: keyed.sha,
          treeHash: keyed.contentHash ?? null,
        });
      } else {
        const outPath = prep?.sourceMap[entry.file]?.outPath;
        if (
          outPath === undefined ||
          !(await integratedContentExists(input.integrationWorktreePath, outPath))
        ) {
          throw new Error(
            `wave join: no-op round for ${entry.file} (output ${outPath ?? "unknown"}) but integrated output lacks the file`,
          );
        }
        done.push({
          file: entry.file,
          round,
          commitSha: receipt.commitSha ?? null,
          treeHash: receipt.treeHash ?? null,
        });
      }
    }

    const next: PortQueueState = {
      ...queue,
      done,
      current: null,
      pending:
        input.mode === "fix"
          ? queue.pending
          : queue.pending.filter((f) => !wave.entries.some((e) => e.file === f)),
    };
    if (input.mode === "fix") {
      // Drop consumed fix-queue entries so re-verification is honest.
      const verify = ppVerify.get(ctx, "verify");
      if (verify !== undefined) {
        ppVerify.set(ctx, "verify", {
          ...verify,
          fixQueue: verify.fixQueue.filter(
            (f) => !wave.entries.some((e) => e.file === f.file),
          ),
        });
      }
    }
    ppQueue.set(ctx, "queue", next);
    return { output: input, tokens: null };
  },
  route: (_ctx, _input, out) =>
    out.mode === "fix"
      ? goTo(QueueVerifyStep, baseInputOf(out))
      : goTo(BootstrapStep, baseInputOf(out)),
});
