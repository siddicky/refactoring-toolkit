/**
 * The per-file pipeline shared by both flows: fence -> implement | queue-fix ->
 * capture-diff -> review-A -> review-B -> verdict-check -> prioritize -> fixer
 * -> commit, then the flow-specific tail (sequential: integrate -> release;
 * per-file child: child-release), plus the child flow's lease step.
 *
 * Import-cycle note: the sequential tail hands control back to the project
 * loop's ReleaseStep (flows/port/project-steps.ts), which itself imports this
 * module. That single back-edge goes through the forward link in ./links.ts.
 */

import { goTo } from "@superdurable/dex";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  envelopeStartMarker,
  envelopeStepClass,
  type EnvelopeOutcome,
  type EnvelopeStepClass,
} from "../steps/envelope.js";
import { fenceLabel, sessionFenceMap } from "../../src/harness/opencode.js";
import {
  commitLeaseChanges,
  findCommitByOpId,
  integratedContentExists,
  isWorktreeClean,
  keyedCommitIntegrated,
  makeCommitReachable,
  mergeLeaseIntoIntegration,
  operationId,
  WorktreePool,
} from "../../src/git/worktree.js";
import { IMPLEMENTER } from "../../harness/agents/implementer.js";
import { FIXER } from "../../harness/agents/fixer.js";
import { executorPromptOpts } from "../../src/harness/lanes.js";
import { TSC_ERRORS_PER_FILE_CAP } from "../../src/queues/tsc-queue.js";
import {
  composeFixerTurn,
  composeImplementerTurn,
  composeQueueFixTurn,
  extractCodeFence,
  parseUnifiedDiff,
  testPortScopeNote,
  DIFF_HEADER_LINES,
} from "../../src/harness/runtime.js";
import {
  isVerdictTombstone,
  type DiffDocument,
  type Finding as MetricsFinding,
} from "../../src/metrics/types.js";
import { gitDiffStaged, requireHarness, runAgentTurn, writeOutFile } from "./agent-turns.js";
import { citationKept, liveJevClient, recordJevUsage, runCitationGate, runPrioritizeGate } from "./lane-b.js";
import { bindLeaseStore } from "./leases.js";
import {
  diffKeyOf,
  keptKeyOf,
  markerKeyOf,
  outKeyOf,
  queueFixFeedForFile,
  safe,
  verdictKeyOf,
} from "./queue-logic.js";
import { runReviewTurn } from "./review-turn.js";
import { releaseStepLink } from "./links.js";
import {
  type CitationGateRecord,
  type ChildFileResult,
  type FileRoundInput,
  type KeptFindings,
  type PortFileInput,
  LEASE_SLOT_CAP,
  ppDiff,
  ppJevUsage,
  ppKept,
  ppLease,
  ppMarker,
  ppOut,
  ppPrep,
  ppQueue,
  ppVerdict,
  ppVerify,
} from "./state.js";
import { MARKER_STEP_OPTIONS, MODEL_STEP_OPTIONS, RESTART_WINDOW_RETRY } from "./step-options.js";

export const FenceStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpFence",
  stepId: "pp-fence",
  role: "record",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  inner: async (ctx, fri) => {
    const harness = requireHarness();
    const label = fenceLabel(fri.file, fri.round, fri.epoch);
    // 0(g) mini-step semantics: the session exists and the fence lands
    // durably with this step's decision BEFORE the implementer prompts.
    const session = await harness.createSession(label);
    sessionFenceMap.set(ctx, label, {
      sessionId: session.id,
      stepId: "pp-implement",
      epoch: fri.epoch,
      label,
      persistedAtUtc: new Date().toISOString(),
    });
    return { output: fri, tokens: null };
  },
  // Phase 4: fix rounds (round >= 2) enter the queue-driven fix loop instead
  // of re-implementing from scratch. One QueueFix class serves both flows: it
  // reads its feed from the ctx-bound pp-verify, which is the parent's store
  // in port.Project and the child's by-value seed (ChildLeaseStep) in port.File.
  route: (_ctx, _input, fri) =>
    fri.round >= 2 ? goTo(QueueFixStart, fri) : goTo(ImplementStart, fri),
});

// M4 (0(g)): durable PRE-start markers for model-calling steps. The
// envelope's own start event is staged with its step's decision, so a kill
// inside the step leaves no envelope; this marker's decision lands first.
export const ImplementStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpImplementStart",
  targetStepId: "pp-implement",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(ImplementStep, fri),
});

export const ImplementStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpImplement",
  stepId: "pp-implement",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: {
    ...MODEL_STEP_OPTIONS,
    executeLoadAttributeMaps: [sessionFenceMap, ppPrep, ppQueue],
  },
  inner: async (ctx, fri) => {
    const label = fenceLabel(fri.file, fri.round, fri.epoch);
    const fence = sessionFenceMap.get(ctx, label);
    if (fence === undefined) {
      throw new Error(`no durable session fence for ${label}`);
    }
    const prep = ppPrep.get(ctx, "prep");
    if (prep === undefined) {
      throw new Error("prep artifact missing from durable attributes");
    }
    const phpSource = await readFile(join(fri.sourceRoot, fri.file), "utf8");
    const outPath = prep.sourceMap[fri.file]?.outPath ?? `src/${fri.file}.ts`;
    // US-010: test-file ports (PHPUnit -> vitest) announce their scope.
    const scopeNote = testPortScopeNote(fri.file);

    const turn = composeImplementerTurn({
      phpFileName: fri.file,
      phpSource,
      prepExcerpt: prep.raw,
      outputPath: outPath,
      ...(scopeNote !== null ? { scopeNote } : {}),
      ...(prep.userContract !== undefined ? { userContract: prep.userContract } : {}),
    });
    const result = await runAgentTurn({
      def: IMPLEMENTER,
      sessionId: fence.sessionId,
      turn,
      file: fri.file,
      round: fri.round,
      ...executorPromptOpts(),
    });
    const code = extractCodeFence(result.text, ".ts");
    await writeOutFile(fri.worktreePath, outPath, code);
    ppOut.set(ctx, outKeyOf(fri.file, fri.round), { outPath });
    return { output: fri, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, fri) => goTo(CaptureDiffStep, fri),
});

export const CaptureDiffStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpCaptureDiff",
  stepId: "pp-capture-diff",
  role: "diff-capture",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  inner: async (ctx, fri) => {
    const raw = await gitDiffStaged(fri.worktreePath);
    const diffId = `diff-${safe(fri.file)}-r${fri.round}`;
    const doc: DiffDocument = {
      diff_id: diffId,
      file: fri.file,
      base_ref: "HEAD",
      hunks: parseUnifiedDiff(raw).hunks,
    };
    ppDiff.set(ctx, diffKeyOf(fri.file, fri.round), {
      diffId,
      raw,
      doc,
      bodyLineOffset: DIFF_HEADER_LINES,
    });
    return { output: fri, tokens: null };
  },
  route: (_ctx, _input, fri) => goTo(ReviewAStart, fri),
});

export const ReviewAStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpReviewAStart",
  targetStepId: "pp-review-a",
  role: "review",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(ReviewAStep, fri),
});

export const ReviewAStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpReviewA",
  stepId: "pp-review-a",
  role: "review",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppDiff] },
  inner: async (ctx, fri) => {
    const diff = ppDiff.get(ctx, diffKeyOf(fri.file, fri.round));
    if (diff === undefined) throw new Error(`captured diff missing for ${fri.file}#${fri.round}`);
    // Fix-wave (reviewer finding 4): turnDiagnosis (US-003 successor-attempt
    // re-record) is forwarded onto the step's completion envelope — it was
    // destructured away here, so the envelope never carried it.
    const { verdict, tokens, turnDiagnosis } = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-A",
      stepId: "pp-review-a",
      file: fri.file,
      round: fri.round,
      epoch: fri.epoch,
      diff,
      attempt: ctx.attempt,
    });
    ppVerdict.set(ctx, verdictKeyOf(fri.file, fri.round, "reviewer-A"), verdict);
    return { output: fri, tokens, turnDiagnosis };
  },
  route: (_ctx, _input, fri) => goTo(ReviewBStart, fri),
});

export const ReviewBStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpReviewBStart",
  targetStepId: "pp-review-b",
  role: "review",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(ReviewBStep, fri),
});

export const ReviewBStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpReviewB",
  stepId: "pp-review-b",
  role: "review",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppDiff] },
  inner: async (ctx, fri) => {
    const diff = ppDiff.get(ctx, diffKeyOf(fri.file, fri.round));
    if (diff === undefined) throw new Error(`captured diff missing for ${fri.file}#${fri.round}`);
    // Fix-wave (reviewer finding 4): forward the successor-attempt diagnosis.
    const { verdict, tokens, turnDiagnosis } = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-B",
      stepId: "pp-review-b",
      file: fri.file,
      round: fri.round,
      epoch: fri.epoch,
      diff,
      attempt: ctx.attempt,
    });
    ppVerdict.set(ctx, verdictKeyOf(fri.file, fri.round, "reviewer-B"), verdict);
    return { output: fri, tokens, turnDiagnosis };
  },
  route: (_ctx, _input, fri) => goTo(VerdictCheckStep, fri),
});

export const VerdictCheckStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput & { keptCount: number }>({
  stepType: "PpVerdictCheck",
  stepId: "pp-verdict-check",
  role: "verdict-check",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  // cx6 live finding: recordJevUsage READS pp-jev-usage when the live Jev
  // citation loop spent tokens — an undeclared read throws (retried 46x,
  // each retry re-billing the citation batch). Writes need no declaration
  // (why pp-kept never surfaced this); READS do.
  stepOptions: { executeLoadAttributeMaps: [ppVerdict, ppDiff, ppJevUsage] },
  inner: async (ctx, fri) => {
    const diff = ppDiff.get(ctx, diffKeyOf(fri.file, fri.round));
    if (diff === undefined) throw new Error(`captured diff missing for ${fri.file}#${fri.round}`);
    const kept: MetricsFinding[] = [];
    const dropped: KeptFindings["dropped"] = [];
    const gate: CitationGateRecord[] = [];
    for (const reviewerId of ["reviewer-A", "reviewer-B"] as const) {
      const key = verdictKeyOf(fri.file, fri.round, reviewerId);
      const verdict = ppVerdict.get(ctx, key);
      if (verdict === undefined) {
        throw new Error(`verdict record missing for ${key}`);
      }
      // US-006 tombstone: a discarded reviewer contributes ZERO kept findings
      // — the discard rides the existing dropped-findings semantics. With
      // both reviewers tombstoned keptCount stays 0 and the keptCount-0
      // route below proceeds (degraded, unreviewed round — never a failure).
      if (isVerdictTombstone(verdict)) {
        dropped.push({
          finding_id: `tombstoned:${reviewerId}`,
          reviewer: reviewerId,
          reason: `reviewer discarded (attempt ${verdict.attempt}): ${verdict.reason}`,
        });
        continue;
      }
      // Citation check (Lane-B "citation-check"): LIVE Jev nouls when
      // configured (Phase 3 swap-in, createCitationChecker seam), else the
      // naive code-only default; a Jev failure fails OPEN to the naive check
      // (never a thrown, re-billed step). A finding survives iff its cited
      // evidence scores at least the checker's threshold (citationKept) and
      // its disposition asks for a fix.
      const outcome = await runCitationGate(verdict.metrics, diff.doc, liveJevClient());
      if (outcome.jevTokens > 0) {
        await recordJevUsage(ctx, `pp-verdict-check:${fri.file}#${fri.round}`, outcome.jevTokens);
      }
      gate.push({
        reviewer: reviewerId,
        checker: outcome.checker,
        fallbackReason: outcome.fallbackReason,
        scores: outcome.value.map((c) => ({ finding_id: c.finding_id, p_cited: c.p_cited })),
      });
      for (const check of outcome.value) {
        const agentFinding = verdict.agent.findings.find((f) => f.finding_id === check.finding_id);
        const metricsFinding = verdict.metrics.findings.find((f) => f.finding_id === check.finding_id);
        if (agentFinding === undefined || metricsFinding === undefined) continue;
        if (!citationKept(check.p_cited, outcome.checker)) {
          dropped.push({
            finding_id: check.finding_id,
            reviewer: reviewerId,
            reason: `citation check failed (p_cited=${check.p_cited})`,
            p_cited: check.p_cited,
          });
          continue;
        }
        if (agentFinding.disposition !== "fix") {
          dropped.push({
            finding_id: check.finding_id,
            reviewer: reviewerId,
            reason: `disposition "${agentFinding.disposition}"`,
          });
          continue;
        }
        kept.push(metricsFinding);
      }
    }
    ppKept.set(ctx, keptKeyOf(fri.file, fri.round), { findings: kept, dropped, citationGate: gate });
    return {
      output: { ...fri, keptCount: kept.length },
      tokens: null,
      outcome: kept.length > 0 ? "completed" : "skipped",
    };
  },
  route: (_ctx, _input, fri) =>
    fri.keptCount > 0 ? goTo(PrioritizeStep, fri) : goTo(CommitStep, fri),
});

export const PrioritizeStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpPrioritize",
  stepId: "pp-prioritize",
  role: "prioritize",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  // cx6 live finding: ppJevUsage read via recordJevUsage (see pp-verdict-check).
  stepOptions: { executeLoadAttributeMaps: [ppKept, ppJevUsage] },
  inner: async (ctx, fri) => {
    const kept = ppKept.get(ctx, keptKeyOf(fri.file, fri.round));
    if (kept === undefined) throw new Error(`kept findings missing for ${fri.file}#${fri.round}`);
    // Lane-B "prioritize": live Jev rerank when configured, naive severity
    // order otherwise; a Jev failure fails OPEN to the naive order and the
    // degradation rides the pp-kept record (never a thrown, re-billed step).
    const outcome = await runPrioritizeGate(kept.findings, liveJevClient());
    if (outcome.jevTokens > 0) {
      await recordJevUsage(ctx, `pp-prioritize:${fri.file}#${fri.round}`, outcome.jevTokens);
    }
    ppKept.set(ctx, keptKeyOf(fri.file, fri.round), {
      ...kept,
      findings: outcome.value,
      prioritize: { checker: outcome.checker, fallbackReason: outcome.fallbackReason },
    });
    return { output: fri, tokens: null };
  },
  route: (_ctx, _input, fri) => goTo(FixerStart, fri),
});

export const FixerStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpFixerStart",
  targetStepId: "pp-fixer",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(FixerStep, fri),
});

export const FixerStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpFixer",
  stepId: "pp-fixer",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: {
    ...MODEL_STEP_OPTIONS,
    executeLoadAttributeMaps: [ppKept, ppOut, ppPrep],
  },
  inner: async (ctx, fri) => {
    const kept = ppKept.get(ctx, keptKeyOf(fri.file, fri.round));
    if (kept === undefined) throw new Error(`kept findings missing for ${fri.file}#${fri.round}`);
    if (kept.findings.length === 0) {
      // Clean review (verdict-check kept nothing): skip the fixer entirely.
      return { output: fri, tokens: null, outcome: "skipped" as EnvelopeOutcome };
    }
    // Fix rounds (round >= 2) enter via the queue-fix path which does NOT
    // run the implement step, so ppOut is never set for them — resolve the
    // output path with the prep source-map fallback exactly like the
    // queue-fix and integrate steps (live finding cx-5d fix wave).
    const out = ppOut.get(ctx, outKeyOf(fri.file, fri.round));
    const outPath =
      out?.outPath ?? ppPrep.get(ctx, "prep")?.sourceMap[fri.file]?.outPath;
    if (outPath === undefined) throw new Error(`output path missing for ${fri.file}#${fri.round}`);
    const current = await readFile(join(fri.worktreePath, outPath), "utf8");

    // Fresh fenced session for the fixer turn (fence staged with this
    // step's decision; enumeration fallback covers a mid-fix kill).
    const harness = requireHarness();
    const label = fenceLabel(`${fri.file}:fixer`, fri.round, fri.epoch);
    const session = await harness.createSession(label);
    sessionFenceMap.set(ctx, label, {
      sessionId: session.id,
      stepId: "pp-fixer",
      epoch: fri.epoch,
      label,
      persistedAtUtc: new Date().toISOString(),
    });

    const userContract = ppPrep.get(ctx, "prep")?.userContract;
    const turn = composeFixerTurn({
      currentContent: current,
      findings: kept.findings,
      outputPath: outPath,
      ...(userContract !== undefined ? { userContract } : {}),
    });
    const result = await runAgentTurn({
      def: FIXER,
      sessionId: session.id,
      turn,
      file: fri.file,
      round: fri.round,
      ...executorPromptOpts(),
    });
    const code = extractCodeFence(result.text, ".ts");
    await writeOutFile(fri.worktreePath, outPath, code);
    return { output: fri, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, fri) => goTo(CommitStep, fri),
});

export const CommitStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpCommit",
  stepId: "pp-commit",
  role: "commit",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  // This step is the COMMIT-TIME subset of the recovery decision table: keyed
  // dedup (op-ID scan across ALL branches) plus the C1 cross-branch
  // reachability fix. It deliberately does NOT call reconcile()/applyReconcile()
  // (src/git/worktree.ts): those are the round-START recovery table that
  // `recover-port` (scripts/run-demo.ts) applies to a worktree before
  // re-dispatch. At commit time the lease worktree is dirty BY DESIGN (the
  // implementer's uncommitted output), and reconcile's `redone` arm resets a
  // dirty worktree to the lease base — wiring it in here would wipe the
  // round's own work. The `poisoned` rows (marker committed but no keyed
  // commit; no-op marker beside a keyed commit) are therefore raised by
  // recovery, not by this step.
  inner: async (ctx, fri) => {
    const opId = operationId(fri.file, fri.round);
    const key = markerKeyOf(fri.file, fri.round);

    // Sole-committer dedup: keyed lookup scans ALL branches first.
    const keyed = await findCommitByOpId(fri.repoRoot, opId);
    if (keyed !== undefined) {
      // C1: the keyed commit may sit on a DIFFERENT branch than this round's
      // lease (quarantined lease / epoch bump). Making it reachable from THIS
      // branch is what lets the integration step actually ship the round —
      // without it, the lease merges a branch that lacks the commit and the
      // completed round silently never lands in the output project.
      const replayDivergent = !(await isWorktreeClean(fri.worktreePath));
      const reach = await makeCommitReachable(fri.worktreePath, keyed);
      ppMarker.set(ctx, key, {
        round: fri.round,
        disposition: `committed:${opId}`,
        content_hash: keyed.contentHash ?? keyed.sha,
        sha: keyed.sha,
        keyed_branch: keyed.branch,
        replay_divergent: replayDivergent && reach !== "already",
      });
      return { output: fri, tokens: null, outcome: "skipped" as EnvelopeOutcome };
    }

    const res = await commitLeaseChanges(
      fri.worktreePath,
      opId,
      `porting-toolkit: port ${fri.file} (round ${fri.round})`,
    );
    ppMarker.set(ctx, key, {
      round: fri.round,
      disposition: res.disposition,
      content_hash: res.contentHash,
      sha: res.sha,
    });
    return {
      output: fri,
      tokens: null,
      outcome: (res.disposition === "no-op-empty-diff" ? "skipped" : "completed") as EnvelopeOutcome,
    };
  },
  route: (_ctx, _input, fri) =>
    fri.childFlow === true ? goTo(ChildReleaseStep, fri) : goTo(IntegrateStep, fri),
});

export const IntegrateStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpIntegrate",
  stepId: "pp-integrate",
  role: "integration",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: { executeLoadAttributeMaps: [ppMarker, ppOut, ppPrep] },
  inner: async (ctx, fri) => {
    const result = await mergeLeaseIntoIntegration(
      fri.repoRoot,
      fri.integrationWorktreePath,
      fri.branch,
      "integration",
    );

    // C1 guard: when a keyed commit exists for this round it MUST be
    // reachable from integration HEAD — a no-op merge of a branch lacking
    // the commit would mark the round done while dropping its content.
    const opId = operationId(fri.file, fri.round);
    const keyed = await findCommitByOpId(fri.repoRoot, opId);
    if (keyed !== undefined && !(await keyedCommitIntegrated(fri.integrationWorktreePath, keyed))) {
      throw new Error(
        `C1: keyed commit ${keyed.sha} (${opId}) is NOT reachable from integration — refusing to mark the round integrated`,
      );
    }

    // M1: no-op rounds presuppose the ported OUTPUT file (outPath from the
    // prep map / pp-out), never the PHP source path this round ported FROM.
    const marker = ppMarker.get(ctx, markerKeyOf(fri.file, fri.round));
    if (marker !== undefined && marker.disposition === "no-op-empty-diff") {
      const out = ppOut.get(ctx, outKeyOf(fri.file, fri.round));
      const prep = ppPrep.get(ctx, "prep");
      const outPath = out?.outPath ?? prep?.sourceMap[fri.file]?.outPath;
      if (
        outPath === undefined ||
        !(await integratedContentExists(fri.integrationWorktreePath, outPath))
      ) {
        throw new Error(
          `no-op round for ${fri.file} (output ${outPath ?? "unknown"}) but integrated output lacks the file`,
        );
      }
    }
    void result;
    return { output: fri, tokens: null };
  },
  route: (_ctx, _input, fri) => goTo(releaseStepLink.get(), fri),
});

export const QueueFixStart: EnvelopeStepClass<FileRoundInput> = envelopeStartMarker<FileRoundInput>({
  stepType: "PpQueueFixStart",
  targetStepId: "pp-queue-fix",
  role: "agent",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: MARKER_STEP_OPTIONS,
  route: (fri) => goTo(QueueFixStep, fri),
});

/**
 * Queue-driven fix step (Phase 4 fix loop): the fixer receives the grouped
 * queue errors for THIS file by value and produces the fixed file. Clean
 * runs skip it entirely. Shared by port.Project (sequential mode) and
 * port.File (parallel children): the feed is read from the flow's own
 * ctx-bound pp-verify, so the step body is identical in both.
 */
export const QueueFixStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  stepType: "PpQueueFix",
  stepId: "pp-queue-fix",
  role: "agent",
  // cx-5e: identity-keyed envelope (see ChildLeaseStep note).
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: {
    ...MODEL_STEP_OPTIONS,
    executeLoadAttributeMaps: [ppVerify, ppOut, ppPrep],
  },
  inner: async (ctx, fri) => {
    const verify = ppVerify.get(ctx, "verify");
    const prep = ppPrep.get(ctx, "prep");
    const out = ppOut.get(ctx, outKeyOf(fri.file, fri.round));
    const outPath = out?.outPath ?? prep?.sourceMap[fri.file]?.outPath;
    if (outPath === undefined) throw new Error(`output path missing for ${fri.file}#${fri.round}`);
    const rel = outPath.replace(/^\.\//, "");
    // Fix-round feed: tsc errors + vitest failures triaged to this file
    // (Lane-B vitest-triage; registry-declared routing by attributedFile).
    const feed = queueFixFeedForFile(verify, rel);
    const errs = feed.errors;
    if (errs.length === 0 && feed.testFailures.length === 0) {
      // Nothing to fix: no agent turn. The envelope rejects tokens:null for a
      // model-calling role even on a skip (it threw "provenance failure"), so
      // a skip reports its true usage: an explicit 0.
      return { output: fri, tokens: 0, outcome: "skipped" as EnvelopeOutcome };
    }
    const current = await readFile(join(fri.worktreePath, outPath), "utf8");

    // Fresh fenced session (0(g): fence staged with this step's decision).
    const harness = requireHarness();
    const label = fenceLabel(`${fri.file}:queuefix`, fri.round, fri.epoch);
    const session = await harness.createSession(label);
    sessionFenceMap.set(ctx, label, {
      sessionId: session.id,
      stepId: "pp-queue-fix",
      epoch: fri.epoch,
      label,
      persistedAtUtc: new Date().toISOString(),
    });

    const turn = composeQueueFixTurn({
      currentContent: current,
      outputPath: outPath,
      errors: errs.map((e) => ({ code: e.code, message: e.message, line: e.line })),
      testFailures: feed.testFailures,
      ...(prep?.userContract !== undefined ? { userContract: prep.userContract } : {}),
    });
    const result = await runAgentTurn({
      def: FIXER,
      sessionId: session.id,
      turn,
      file: fri.file,
      round: fri.round,
      ...executorPromptOpts(),
    });
    const code = extractCodeFence(result.text, ".ts");
    await writeOutFile(fri.worktreePath, outPath, code);
    return { output: fri, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, fri) => goTo(CaptureDiffStep, fri),
});

// ---------------------------------------------------------------------------
// PortFileFlow — one file's full pipeline as an independent, kill-safe flow
// ---------------------------------------------------------------------------

export const ChildLeaseStep: EnvelopeStepClass<PortFileInput> = envelopeStepClass<PortFileInput, FileRoundInput>({
  stepType: "PpChildLease",
  stepId: "pp-child-lease",
  role: "record",
  // Live finding cx-5e: without identityOf the lease envelope keys flow-level
  // while its dispatch entry carries file#round — the AC2 anchor then reports
  // it (and the queue-fix steps below) as unanchored. Per-file steps MUST key
  // their envelopes by the sanitized file#round identity.
  identityOf: (_ctx, input) => markerKeyOf(input.file, input.round),
  stepOptions: {
    // ppLease is READ through bindLeaseStore (lease reclaim/put); live
    // finding cx-5c: the child's first step failed 3 attempts with
    // "AttributeMap instance was not loaded: pp-lease/pool" until declared.
    executeLoadAttributeMaps: [ppPrep, ppVerify, ppLease],
    // US-009-final: child-entry re-dispatch after a resume faces the same
    // restart-window connection budget (cx7: the resumed fix-wave child
    // re-executed into the gap); raised with the marker/model schedule.
    executeRetry: RESTART_WINDOW_RETRY,
  },
  inner: async (ctx, input) => {
    // Seed the child's OWN stores with the parent-provided prep + queue
    // errors: every downstream per-file step is store-local (ctx-bound), so
    // the child pipeline reads its copies exactly like the sequential path.
    // The vitest triage state rides along by value: the child's fix feed
    // (queueFixFeedForFile) re-derives the SAME routing the parent decided.
    const childVitest = [...input.queueFixVitest];
    ppPrep.set(ctx, "prep", input.prep);
    ppVerify.set(ctx, "verify", {
      iteration: input.round,
      fixQueue: [],
      tscTotal: input.queueFixErrors.length,
      vitestTotal: childVitest.length,
      vitestNote: "child flow (errors by value)",
      lastRunAt: new Date().toISOString(),
      errors: [...input.queueFixErrors].slice(0, TSC_ERRORS_PER_FILE_CAP).map((e) => ({ ...e })),
      vitestState: {
        kind: "vitest-queue",
        iteration: input.round,
        total: childVitest.length,
        failures: childVitest.map((c) => c.record),
        classified: childVitest,
      },
      // By-value feed (not a run record): no ran/not-run claim here.
      vitestRun: null,
    });
    const pool = new WorktreePool(
      input.repoRoot,
      input.worktreeRoot,
      bindLeaseStore(ctx, ppLease),
      LEASE_SLOT_CAP,
    );
    // The fix feed travels through the child's pp-verify seeded above (read by
    // queueFixFeedForFile), so the FileRoundInput carries no error copies.
    const childInput = (lease: { worktreePath: string; branch: string }): FileRoundInput => ({
      repoRoot: input.repoRoot,
      worktreeRoot: input.worktreeRoot,
      integrationWorktreePath: input.integrationWorktreePath,
      sourceRoot: input.sourceRoot,
      epoch: input.epoch,
      file: input.file,
      round: input.round,
      worktreePath: lease.worktreePath,
      branch: lease.branch,
      childFlow: true,
    });
    const existing = pool.store().get(input.file);
    if (existing !== undefined && !pool.isStale(existing, input.epoch)) {
      return { output: childInput(existing), tokens: null };
    }
    const acquired = await pool.acquire(input.file, input.epoch, `pp-child-${input.epoch}`);
    if (!acquired.acquired) {
      // The child's store holds no sibling leases, so the pool cap cannot
      // trip here; a refusal means this file's own lease is already held in
      // this store (concurrent re-acquire): retryable.
      throw new Error(`child lease failed for ${input.file}: ${acquired.reason}`);
    }
    return { output: childInput(acquired.lease), tokens: null };
  },
  route: (_ctx, _input, fri) => goTo(FenceStep, fri),
});

export const ChildReleaseStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<
  FileRoundInput,
  ChildFileResult
>({
  stepType: "PpChildRelease",
  stepId: "pp-child-release",
  role: "record",
  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  stepOptions: { executeLoadAttributeMaps: [ppLease, ppMarker] },
  inner: async (ctx, fri) => {
    const pool = new WorktreePool(
      fri.repoRoot,
      fri.worktreeRoot,
      bindLeaseStore(ctx, ppLease),
      LEASE_SLOT_CAP,
    );
    await pool.release(fri.file);
    const marker = ppMarker.get(ctx, markerKeyOf(fri.file, fri.round));
    return {
      output: {
        file: fri.file,
        round: fri.round,
        commitSha: marker?.sha ?? null,
        treeHash: marker?.content_hash ?? null,
      },
      tokens: null,
    };
  },
  // gracefulComplete(output) — the child's terminal result.
});
