/**
 * Phase 3 — prep-analysis steps of PortProjectFlow: seed + config (PpPrep), the
 * per-symbol type table, the spec-map generate -> artifact-diff -> two-reviewer
 * -> naive citation gate -> revise loop (capped), and the finalize step that
 * hands the reviewed spec to the port loop (DispatchStep).
 */

import { goTo } from "@superdurable/dex";
import type { Context } from "@superdurable/dex";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  envelopeStartMarker,
  envelopeStepClass,
  type EnvelopeSpec,
  type EnvelopeStepClass,
} from "../steps/envelope.js";
import { crashPortWorker, faultMatches, requirePortJudgment } from "../runtime-hooks.js";
import { fenceLabel } from "../../src/harness/opencode.js";
import { git } from "../../src/git/exec.js";
import { IMPLEMENTER } from "../../harness/agents/implementer.js";
import { plannerPromptOpts } from "../../src/harness/lanes.js";
import type { PhpSymbol } from "../../src/typesafe/symbol-types.js";
import { selectSymbolType } from "../../src/typesafe/symbol-types.js";
import {
  composePrepGenerateTurn,
  composePrepReviseTurn,
  extractSpecMap,
  harvestPhpSymbols,
  parseUnifiedDiff,
  renderSymbolTable,
  DIFF_HEADER_LINES,
} from "../../src/harness/runtime.js";
import { PREP_SPEC_FILE, type DiffDocument } from "../../src/metrics/types.js";
import { naiveCitationCheck } from "../../src/typesafe/verdict-check.js";
import { requireHarness, runAgentTurn } from "./agent-turns.js";
import { countingJevClient, keepFindings } from "./lane-b.js";
import { parsePrepSourceMap, verdictKeyOf } from "./queue-logic.js";
import { runReviewTurn } from "./review-turn.js";
import { DispatchStep } from "./project-steps.js";
import {
  type PortRunInput,
  type SymbolTableRow,
  ppConfig,
  ppPrep,
  ppPrepDiff,
  ppPrepDraft,
  ppPrepFindings,
  ppPrepSeed,
  ppPrepState,
  ppPrepVerdict,
  ppQueue,
  ppSymtab,
} from "./state.js";
import { MARKER_STEP_OPTIONS, MODEL_STEP_OPTIONS, RESTART_WINDOW_RETRY } from "./step-options.js";

export const PrepStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrep",
  stepId: "pp-prep",
  role: "record",
  // A prep/config failure is permanent (bad run input): never retry it.
  stepOptions: { executeRetry: { maximumAttempts: 1 } },
  inner: async (ctx, input) => {
    const raw = await readFile(input.prepPath, "utf8");
    const sourceMap = parsePrepSourceMap(raw);
    const missing = input.files.filter((f) => sourceMap[f] === undefined);
    if (missing.length > 0) {
      throw new Error(`prep source map lacks rows for: ${missing.join(", ")}`);
    }
    // Phase 3: harvest symbols (code-only, deterministic) for the per-symbol
    // table; the stub baseline is what the generated spec map supersedes.
    // ppPrep is finalized only after the capped prep-review loop.
    const symbols: PhpSymbol[] = [];
    for (const file of input.files) {
      const source = await readFile(join(input.sourceRoot, file), "utf8");
      symbols.push(...harvestPhpSymbols(file, source));
    }
    ppPrepSeed.set(ctx, "seed", { stubRaw: raw, symbols });
    ppPrepState.set(ctx, "state", { prepIteration: 0 });
    ppConfig.set(ctx, "config", { maxRounds: input.maxRounds, prepMaxRounds: 2 });
    ppQueue.set(ctx, "queue", {
      pending: [...input.files],
      current: null,
      done: [],
      blocked: [],
    });
    return { output: input, tokens: null };
  },
  route: (_ctx, _input, out) => goTo(SymbolStart, out),
});

export const SymbolStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpSymbolStart",
  targetStepId: "pp-symbol-table",
  role: "judgment",
  stepOptions: MARKER_STEP_OPTIONS,
  route: (input) => goTo(SymbolTableStep, input),
});

export const SymbolTableStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpSymbolTable",
  stepId: "pp-symbol-table",
  role: "judgment",
  stepOptions: { executeLoadAttributeMaps: [ppPrepSeed] },
  inner: async (ctx, input) => {
    const client = requirePortJudgment();
    const seed = ppPrepSeed.get(ctx, "seed");
    if (seed === undefined) throw new Error("prep seed missing");
    // Only the real client produces judgments; the offline double's answers
    // are scripted first-candidate picks and its token counts are synthetic.
    const scripted = client.kind !== "real";

    // Usage accumulator: selectSymbolType consumes the client internally, so
    // wrap it to capture System One usage for the envelope (never zero-null).
    const counting = countingJevClient(client);

    const rows: SymbolTableRow[] = [];
    for (const symbol of seed.symbols) {
      const decision = await selectSymbolType(counting.client, symbol);
      rows.push({
        file: decision.file,
        symbol: decision.symbol,
        kind: symbol.kind,
        signature: symbol.signature,
        candidates: decision.candidates.map((c) => c.type),
        selected: decision.selected,
        flagged: decision.flagged,
        escalations: decision.escalations.length,
        judge: scripted ? "scripted" : "live",
      });
    }

    // P3 smoke kill point: AFTER the Jev selection loop, BEFORE the durable
    // table write (deterministic; set PORTING_KIT_FAULT=symbol-table:post:seed).
    if (faultMatches("symbol-table:post", "seed")) {
      crashPortWorker(`symbol-table:post:seed (${rows.length} rows computed)`);
    }

    ppSymtab.set(ctx, "symtab", { rows });
    // Real usage only: the scripted double's synthetic counts must not land in
    // the judgment-role totals, and "no calls were made" is an honest 0, not an
    // invented 1.
    return { output: input, tokens: scripted ? 0 : counting.tokens() };
  },
  route: (_ctx, _input, out) => goTo(PrepStart, out),
});

export const PrepStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpPrepGenerateStart",
  targetStepId: "pp-prep-generate",
  role: "agent",
  stepOptions: MARKER_STEP_OPTIONS,
  route: (input) => goTo(PrepGenerateStep, input),
});

export const PrepGenerateStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepGenerate",
  stepId: "pp-prep-generate",
  role: "agent",
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppPrepSeed, ppSymtab] },
  inner: async (ctx, input) => {
    const seed = ppPrepSeed.get(ctx, "seed");
    const symtab = ppSymtab.get(ctx, "symtab");
    if (seed === undefined || symtab === undefined) {
      throw new Error("prep seed/symbol table missing");
    }
    const sources: Array<{ name: string; source: string }> = [];
    for (const file of input.files) {
      sources.push({ name: file, source: await readFile(join(input.sourceRoot, file), "utf8") });
    }
    const symbolTableText = renderSymbolTable(symtab.rows, sources);
    const turn = composePrepGenerateTurn({
      phpFiles: sources,
      symbolTableText,
      stubPrepBaseline: seed.stubRaw,
    });
    const result = await runPrepTurn(input.epoch, turn);
    // Outermost ```markdown block + structural check (a truncated or
    // table-less spec throws, so dex retries instead of adopting it).
    const specText = extractSpecMap(result.text, { expectedFiles: input.files });
    ppPrepDraft.set(ctx, "draft", { specText, iteration: 0 });
    return { output: input, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, input) => goTo(PrepDiffCaptureStep, input),
});

/** Prep-loop identity for envelope event keys (spec file + iteration).
 * Defensive: an unloaded attribute map must never kill a start marker —
 * fall back to the flow-level prep identity. */
function prepIdentityOf(ctx: Context): string {
  try {
    const state = ppPrepState.get(ctx, "state");
    return state === undefined ? "prep" : `prep${state.prepIteration}`;
  } catch {
    return "prep";
  }
}

async function prepSessionId(epoch: number): Promise<string> {
  const harness = requireHarness();
  const label = fenceLabel(PREP_SPEC_FILE, 0, epoch);
  const session = await harness.createSession(label);
  return session.id;
}

/** One planner turn on the prep spec session (spec generation and every revision). */
async function runPrepTurn(epoch: number, turn: string): ReturnType<typeof runAgentTurn> {
  return runAgentTurn({
    def: IMPLEMENTER,
    sessionId: await prepSessionId(epoch),
    turn,
    file: PREP_SPEC_FILE,
    round: 0,
    ...plannerPromptOpts(),
  });
}

/** Inner body shared by the two prep reviewer steps: review the prep diff, store the verdict by value. */
function prepReviewInner(
  reviewerId: "reviewer-A" | "reviewer-B",
  stepId: string,
): EnvelopeSpec<PortRunInput, PortRunInput>["inner"] {
  return async (ctx, input) => {
    const diff = ppPrepDiff.get(ctx, "diff");
    const state = ppPrepState.get(ctx, "state");
    if (diff === undefined || state === undefined) throw new Error("prep diff/state missing");
    // Fix-wave (reviewer finding 4): forward the successor-attempt diagnosis.
    const { verdict, tokens, turnDiagnosis } = await runReviewTurn({
      ctx,
      reviewerId,
      stepId,
      file: PREP_SPEC_FILE,
      round: state.prepIteration,
      epoch: input.epoch,
      diff,
      attempt: ctx.attempt,
    });
    ppPrepVerdict.set(ctx, verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, reviewerId), verdict);
    return { output: input, tokens, turnDiagnosis };
  };
}

export const PrepDiffCaptureStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<
  PortRunInput,
  PortRunInput
>({
  stepType: "PpPrepDiffCapture",
  stepId: "pp-prep-diff-capture",
  role: "diff-capture",
  stepOptions: { executeLoadAttributeMaps: [ppPrepDraft, ppPrepState, ppPrepSeed] },
  inner: async (ctx, input) => {
    const draft = ppPrepDraft.get(ctx, "draft");
    const seed = ppPrepSeed.get(ctx, "seed");
    const state = ppPrepState.get(ctx, "state");
    if (draft === undefined || seed === undefined || state === undefined) {
      throw new Error("prep draft/seed/state missing");
    }
    // Artifact-diff (plan §Flow contract): the GENERATED artifacts vs the
    // baseline they supersede, rendered as a real unified diff. git exits 1
    // when files differ — that is data, not failure.
    const tmp = await mkdtemp(join(tmpdir(), "porting-kit-prep-"));
    try {
      const baselinePath = join(tmp, "baseline.md");
      const specPath = join(tmp, "spec.md");
      await writeFile(baselinePath, seed.stubRaw);
      await writeFile(specPath, draft.specText);
      // Exit 1 (files differ) carries the diff on stdout; a real failure
      // exits >= 2 with NOTHING on stdout. The old catch-all swallowed every
      // failure into an empty diff, which reviewers then "reviewed".
      const res = await git(tmp).tryRun(["diff", "--no-index", "--", baselinePath, specPath]);
      if (!res.ok && res.stdout.length === 0) {
        throw new Error(`prep diff failed: git diff --no-index: ${res.stderr.trim()}`);
      }
      const raw = res.stdout;
      const doc: DiffDocument = {
        diff_id: `prep-diff-${state.prepIteration}`,
        file: PREP_SPEC_FILE,
        base_ref: "baseline",
        hunks: parseUnifiedDiff(raw).hunks,
      };
      ppPrepDiff.set(ctx, "diff", {
        raw,
        doc,
        diffId: doc.diff_id,
        bodyLineOffset: DIFF_HEADER_LINES,
        iteration: state.prepIteration,
      });
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
    return { output: input, tokens: null };
  },
  route: (_ctx, _input, input) => goTo(PrepReviewAStart, input),
});

export const PrepReviewAStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpPrepReviewAStart",
  targetStepId: "pp-prep-review-a",
  role: "review",
  identityOf: prepIdentityOf,
  stepOptions: { executeRetry: RESTART_WINDOW_RETRY, executeLoadAttributeMaps: [ppPrepState] },
  route: (input) => goTo(PrepReviewAStep, input),
});

export const PrepReviewAStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepReviewA",
  stepId: "pp-prep-review-a",
  role: "review",
  // M2/M4 join identity: the attempt-0 start marker carries prep<iteration>;
  // the model envelope must carry the SAME identity or the AC2 marker join
  // (by stepId+identity) cannot see it.
  identityOf: prepIdentityOf,
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppPrepDiff, ppPrepState] },
  inner: prepReviewInner("reviewer-A", "pp-prep-review-a"),
  route: (_ctx, _input, input) => goTo(PrepReviewBStart, input),
});

export const PrepReviewBStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpPrepReviewBStart",
  targetStepId: "pp-prep-review-b",
  role: "review",
  identityOf: prepIdentityOf,
  stepOptions: { executeRetry: RESTART_WINDOW_RETRY, executeLoadAttributeMaps: [ppPrepState] },
  route: (input) => goTo(PrepReviewBStep, input),
});

export const PrepReviewBStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepReviewB",
  stepId: "pp-prep-review-b",
  role: "review",
  // M2/M4 join identity — same rationale as PrepReviewAStep.
  identityOf: prepIdentityOf,
  stepOptions: { ...MODEL_STEP_OPTIONS, executeLoadAttributeMaps: [ppPrepDiff, ppPrepState] },
  inner: prepReviewInner("reviewer-B", "pp-prep-review-b"),
  route: (_ctx, _input, input) => goTo(PrepVerdictCheckStep, input),
});

export const PrepVerdictCheckStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepVerdictCheck",
  stepId: "pp-prep-verdict-check",
  role: "verdict-check",
  stepOptions: { executeLoadAttributeMaps: [ppPrepVerdict, ppPrepDiff, ppPrepState, ppConfig] },
  inner: async (ctx, input) => {
    const diff = ppPrepDiff.get(ctx, "diff");
    const state = ppPrepState.get(ctx, "state");
    const config = ppConfig.get(ctx, "config");
    if (diff === undefined || state === undefined || config === undefined) {
      throw new Error("prep diff/state/config missing");
    }
    // US-006 tombstone: a discarded prep reviewer contributes ZERO kept
    // findings; with both discarded the findings list stays empty and
    // PrepLoopDecisionStep finalizes (revise requires findings > 0) — the
    // prep loop TERMINATES on a degraded, unreviewed iteration.
    const kept = await keepFindings({
      verdictOf: (reviewerId) => {
        const key = verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, reviewerId);
        const verdict = ppPrepVerdict.get(ctx, key);
        if (verdict === undefined) throw new Error(`prep verdict missing for ${key}`);
        return verdict;
      },
      // The prep gate is deliberately NAIVE-only (registry "prep-citation-check"):
      // the spec-map diff is reviewed against a deterministic baseline and
      // never consults a judgment client.
      scoreCitations: (_reviewerId, verdict) =>
        Promise.resolve({
          checks: naiveCitationCheck(verdict.metrics, diff.doc),
          checker: "naive" as const,
          fallbackReason: null,
        }),
    });
    ppPrepFindings.set(ctx, "findings", kept);
    // Counter ownership lives in PrepLoopDecision (single place decides a
    // revision; the increment rides with that decision — no double-count).
    return { output: input, tokens: null, outcome: kept.findings.length > 0 ? "completed" : "skipped" };
  },
  route: (_ctx, _input, input) => goTo(PrepLoopDecisionStep, input),
});

/**
 * Prep loopback decision (kept separate so the loopback route is a pure
 * function of durable state): revise when unaddressed findings remain and
 * the prep cap allows; otherwise finalize and enter the port loop.
 */
export const PrepLoopDecisionStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput & { revise: boolean }>({
  stepType: "PpPrepLoopDecision",
  stepId: "pp-prep-loop-decision",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppPrepFindings, ppPrepState, ppConfig] },
  inner: async (ctx, input) => {
    const findings = ppPrepFindings.get(ctx, "findings");
    const state = ppPrepState.get(ctx, "state");
    const config = ppConfig.get(ctx, "config");
    if (findings === undefined || state === undefined || config === undefined) {
      throw new Error("prep findings/state/config missing");
    }
    // Termination: a revision is allowed only STRICTLY BELOW the cap, and
    // the counter increments WITH the decision (so each revision consumes
    // one unit of the cap — bounded loopback, no runaway).
    const revise = findings.findings.length > 0 && state.prepIteration < config.prepMaxRounds;
    if (revise) {
      ppPrepState.set(ctx, "state", { prepIteration: state.prepIteration + 1 });
    }
    return { output: { ...input, revise }, tokens: null };
  },
  route: (_ctx, _input, out) => (out.revise ? goTo(PrepReviseStart, out) : goTo(PrepFinalizeStep, out)),
});

export const PrepReviseStart: EnvelopeStepClass<PortRunInput> = envelopeStartMarker<PortRunInput>({
  stepType: "PpPrepReviseStart",
  targetStepId: "pp-prep-revise",
  role: "agent",
  identityOf: prepIdentityOf,
  stepOptions: { executeRetry: RESTART_WINDOW_RETRY, executeLoadAttributeMaps: [ppPrepState] },
  route: (input) => goTo(PrepReviseStep, input),
});

export const PrepReviseStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepRevise",
  stepId: "pp-prep-revise",
  role: "agent",
  // M2/M4 join identity — same rationale as PrepReviewAStep.
  identityOf: prepIdentityOf,
  stepOptions: {
    ...MODEL_STEP_OPTIONS,
    executeLoadAttributeMaps: [ppPrepFindings, ppPrepDraft, ppPrepState],
  },
  inner: async (ctx, input) => {
    const findings = ppPrepFindings.get(ctx, "findings");
    const draft = ppPrepDraft.get(ctx, "draft");
    if (findings === undefined || draft === undefined) throw new Error("prep findings/draft missing");
    const turn = composePrepReviseTurn({
      specMapText: draft.specText,
      findings: findings.findings.map((f) => ({
        finding_id: f.finding_id,
        severity: f.severity,
        summary: f.summary,
        evidence: f.evidence?.quote ?? "(uncited)",
      })),
    });
    const result = await runPrepTurn(input.epoch, turn);
    const specText = extractSpecMap(result.text, { expectedFiles: input.files });
    ppPrepDraft.set(ctx, "draft", { specText, iteration: draft.iteration + 1 });
    return { output: input, tokens: result.usage ?? result.tokens };
  },
  route: (_ctx, _input, input) => goTo(PrepDiffCaptureStep, input),
});

export const PrepFinalizeStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  stepType: "PpPrepFinalize",
  stepId: "pp-prep-finalize",
  role: "record",
  stepOptions: { executeLoadAttributeMaps: [ppPrepDraft, ppPrepSeed, ppSymtab] },
  inner: async (ctx, input) => {
    const draft = ppPrepDraft.get(ctx, "draft");
    const seed = ppPrepSeed.get(ctx, "seed");
    const symtab = ppSymtab.get(ctx, "symtab");
    if (draft === undefined || seed === undefined || symtab === undefined) {
      throw new Error("prep draft/seed/symtab missing at finalize");
    }
    // The port loop consumes the REVIEWED generated spec; the stub's source
    // map stays the deterministic php→ts path authority.
    ppPrep.set(ctx, "prep", {
      raw: draft.specText,
      sourceMap: parsePrepSourceMap(seed.stubRaw),
      symbolTable: symtab.rows,
      userContract: seed.stubRaw,
    });
    return { output: input, tokens: null };
  },
  route: (_ctx, _input, input) => goTo(DispatchStep, input),
});
