/**
 * The reviewer turn: one durable-step-sized review attempt (fresh fenced
 * session -> prompt -> verdict extraction/validation -> US-006 suspicion
 * repair-or-discard) plus the Tier-1 turn-health hook at ambiguous-shape
 * throw sites. Consumed by the port-loop and prep review steps.
 */

import type { Context } from "@superdurable/dex";

import { portTurnHealthAssessor } from "../runtime-hooks.js";
import { fenceLabel, OpencodePromptError, sessionFenceMap } from "../../src/harness/opencode.js";
import { REVIEWER } from "../../harness/agents/reviewer.js";
import { isDemotedAttempt, reviewLaneRouting } from "../../src/harness/lanes.js";
import {
  buildRetryContextDiagnosis,
  type DiffDocument,
  type Finding as MetricsFinding,
  type TokenUsage,
  type TurnDiagnosis,
  type TurnObservation,
  type TurnShapeClass,
  type VerdictRecord as MetricsVerdictRecord,
  type VerdictTombstone,
} from "../../src/metrics/types.js";
import { evaluateSuspicion, normalizeVerdictText } from "../../src/metrics/suspicion.js";
import { naiveCitationCheck } from "../../src/typesafe/verdict-check.js";
import {
  composeReviewerRepairTurn,
  composeReviewerTurn,
  extractJsonObject,
  mapVerdictToMetrics,
  parseUnifiedDiff,
  renderDiffForReview,
  reviewerAgentOverride,
  testPortScopeNote,
  toEnvelopeUsage,
} from "../../src/harness/runtime.js";
import { publishTurnDiagnosisEvent } from "../steps/envelope.js";
import { requireHarness, runAgentTurn } from "./agent-turns.js";
import { markerKeyOf } from "./queue-logic.js";
import type { ReviewVerdict } from "./state.js";

export interface ReviewTurnDiff {
  raw: string;
  doc: DiffDocument;
  diffId: string;
  bodyLineOffset: number;
}

/**
 * Tier-1 evidence-only diagnosis at an ambiguous-shape throw site (US-003).
 * The assessor is the INJECTED seam (flows/runtime-hooks.ts) — this module
 * never imports the turn-health implementation (import-boundary, AC-B2).
 * Fail-open end to end: no assessor, an assessor error, or a null diagnosis
 * all leave the failure path EXACTLY as it was (AC-B3). The diagnosis, when
 * produced, reaches the telemetry stream as a record-role event via the
 * existing publisher path; the throwing attempt cannot persist anything
 * durably (0(g)) — the successor attempt's re-record is the durable surface.
 */
async function diagnoseAmbiguousThrow(input: {
  ctx: Context;
  file: string;
  round: number;
  reviewerId: string;
  stepId: string;
  attempt: number;
  usage: TokenUsage | null;
  text: string;
  shape: TurnShapeClass;
  errorMessage: string;
}): Promise<void> {
  const assessor = portTurnHealthAssessor();
  if (assessor === null) return; // Tier-1 unavailable -> no-diagnosis (fail-open)
  const observation: TurnObservation = {
    shape: input.shape,
    output_tokens: input.usage?.output_tokens ?? null,
    reasoning_tokens: input.usage?.reasoning_tokens ?? null,
    text_chars: input.text.length,
    error: input.errorMessage,
  };
  try {
    const diagnosis = await assessor.assess({
      file: input.file,
      stepId: input.stepId,
      turn: `${input.stepId}@${markerKeyOf(input.file, input.round)}`,
      reviewer: input.reviewerId,
      attempt: input.attempt,
      prior_failed_attempts: Math.max(0, input.attempt - 1),
      lane: isDemotedAttempt(input.attempt) ? "demoted" : "default",
      shape: observation,
      recordedAtUtc: new Date().toISOString(),
    });
    if (diagnosis !== null) publishTurnDiagnosisEvent(input.ctx, diagnosis);
  } catch {
    // Swallowed deliberately: diagnosis is evidence-only and must never
    // alter the step's failure path (AC-B3).
  }
}

/**
 * Reviewer turn inside a durable step: fresh session → fence persisted with
 * THIS step's decision (0(g)) → prompt with the diff by value → verdict
 * extracted, validated, and mapped onto the metrics shapes. Any failure
 * throws so dex retries the whole turn on a fresh session.
 *
 * US-006 repair-or-discard (on top of the US-003 turn-health behavior):
 * - a SCHEMA-VALID verdict is checked against the deterministic suspicion
 *   predicate (src/metrics/suspicion.ts — Lane A, zero judgment input);
 * - a SUSPECT verdict gets ONE repair re-prompt through the SAME reviewer
 *   session (same config; the repair reply flows through harness.prompt, so
 *   the Tier-0 degenerateReply guard applies to it). Repair success = the
 *   repaired verdict passes schema AND is not suspect. Repair failure =
 *   TOMBSTONE;
 * - attempt EXHAUSTION (deterministic: ctx.attempt >= maxAttempts, the
 *   in-step bound REVIEW_STEP_MAX_ATTEMPTS — independent of the step's dex
 *   executeRetry budget) converts that attempt's failure into a TOMBSTONE
 *   instead of a throw — with the failed turn's usage when the failure shape
 *   exposed it (the Tier-0 degenerate class does). A no-usage exhaustion
 *   (nothing measurable to anchor — provenance never zero) stays fatal:
 *   documented limitation, per the honest ADR.
 *
 * Tombstones carry the burned tokens of the discarded attempt(s); a
 * tombstoned reviewer contributes zero kept findings and, when BOTH
 * reviewers tombstone, the round proceeds degraded/unreviewed and the flow
 * reaches terminal-success.
 *
 * Turn-health (US-003, evidence-only):
 * - an ambiguous-shape throw (text present, verdict extraction failed /
 *   validation discarded) runs the injected Tier-1 assessor and publishes the
 *   diagnosis to the stream — fire-and-forget, zero control-flow effect;
 * - a SUCCESS on attempt n >= 2 re-records the prior attempts' diagnosis
 *   context DETERMINISTICALLY (attempt count is visible here; the throwing
 *   attempt cannot persist — 0(g)) on the returned record, which the review
 *   step piggybacks onto its completion envelope. A first-attempt success
 *   records nothing (healthy turns are shape-trivial: zero Jev, zero records).
 */

/** In-step verbatim-repeat memo (US-006 predicate arm c): the previous
 *  attempt's normalized reply per `<flowId>/<runId>:<step>:<diffId>`, held in
 *  the step closure's process memory ONLY — zero durable substrate;
 *  cross-attempt replay is already cache-busted by the retry-prompt suffix.
 *  Fix-wave keying (reviewer finding 3): the key carries the flow/run
 *  identity — keyed by step+diff alone, two flows reviewing the same
 *  file+round cross-contaminated (a flow inherited another flow's pending
 *  reply as its "prior attempt" -> false repair/tombstone). */
const inStepVerdictTexts = new Map<string, string>();

/** The in-step memo key for one review execution: flow/run + step + diff. */
function inStepMemoKey(input: {
  ctx: Context;
  reviewerId: string;
  stepId?: string;
  diff: ReviewTurnDiff;
}): string {
  return `${input.ctx.flowId}/${input.ctx.runId}:${input.stepId ?? reviewStepIdOf(input.reviewerId)}:${input.diff.diffId}`;
}

/**
 * Envelope step id of a port-loop review step for a reviewer id
 * ("reviewer-A" -> "pp-review-a", matching ReviewAStep's stepId). Callers in
 * other loops (prep review) pass their own explicit `stepId`.
 */
function reviewStepIdOf(reviewerId: string): string {
  return `pp-review-${reviewerId.replace(/^reviewer-/, "").toLowerCase()}`;
}

/** Test seam: clears the in-step verbatim memo (per-test isolation). */
export function resetInStepVerdictMemo(): void {
  inStepVerdictTexts.clear();
}

/**
 * In-step exhaustion bound for a review turn: on dex attempt >= this value a
 * failing turn with measurable provider usage becomes a TOMBSTONE instead of
 * a throw. It is NOT the step's dex retry budget: the review steps run
 * MODEL_STEP_OPTIONS (RESTART_WINDOW_RETRY, 8 attempts, sized to outlive a
 * worker restart), and connection-refused attempts during a restart also
 * count toward dex's attempt number. The two bounds are deliberately
 * independent (stage 3c, BUILD_NOTES); a usage-less failure at or past this
 * bound still throws and is retried within the dex budget.
 */
export const REVIEW_STEP_MAX_ATTEMPTS = 3;

/** Sums two usage splits (original turn + repair turn burned tokens). */
function addUsage(
  a: TokenUsage | null,
  b: TokenUsage | null,
): TokenUsage | null {
  if (a === null) return b;
  if (b === null) return a;
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    ...(a.reasoning_tokens !== undefined || b.reasoning_tokens !== undefined
      ? { reasoning_tokens: (a.reasoning_tokens ?? 0) + (b.reasoning_tokens ?? 0) }
      : {}),
    ...(a.cache_read_tokens !== undefined || b.cache_read_tokens !== undefined
      ? { cache_read_tokens: (a.cache_read_tokens ?? 0) + (b.cache_read_tokens ?? 0) }
      : {}),
    ...(a.cache_write_tokens !== undefined || b.cache_write_tokens !== undefined
      ? { cache_write_tokens: (a.cache_write_tokens ?? 0) + (b.cache_write_tokens ?? 0) }
      : {}),
    ...(a.cost_usd !== undefined || b.cost_usd !== undefined
      ? { cost_usd: (a.cost_usd ?? 0) + (b.cost_usd ?? 0) }
      : {}),
  };
}

export async function runReviewTurn(input: {
  ctx: Context;
  reviewerId: string;
  file: string;
  round: number;
  epoch: number;
  diff: ReviewTurnDiff;
  /** Dex attempt (1-based). Retries get a cache-busting suffix (live finding:
   *  identical retry prompts replayed IDENTICAL truncated provider turns). */
  attempt?: number;
  /** The durable step's id (diagnosis turn identity: `<stepId>@<identity>`). */
  stepId?: string;
  /** In-step exhaustion bound (default REVIEW_STEP_MAX_ATTEMPTS); not dex's retry budget. */
  maxAttempts?: number;
}): Promise<{
  verdict: ReviewVerdict;
  tokens: number | TokenUsage | null;
  turnDiagnosis: TurnDiagnosis | null;
}> {
  const result = await runReviewTurnOnce(input);
  // Fix-wave memo hygiene (reviewer finding 3): the review execution ENDED
  // (verdict or tombstone returned) — the memo entry existed only to serve
  // throw-to-retry comparisons WITHIN this execution (a throwing attempt
  // leaves it; dex's next attempt reads it). Clearing here keeps the
  // process-global map bounded and guarantees a later execution — this
  // flow's or another's — never inherits a settled execution's reply.
  inStepVerdictTexts.delete(inStepMemoKey(input));
  return result;
}

async function runReviewTurnOnce(input: {
  ctx: Context;
  reviewerId: string;
  file: string;
  round: number;
  epoch: number;
  diff: ReviewTurnDiff;
  attempt?: number;
  stepId?: string;
  maxAttempts?: number;
}): Promise<{
  verdict: ReviewVerdict;
  tokens: number | TokenUsage | null;
  turnDiagnosis: TurnDiagnosis | null;
}> {
  const harness = requireHarness();
  // The envelope step this turn runs inside — the fence owner, the memo key
  // and every diagnosis turn label name the SAME id as the step's envelope.
  const stepId = input.stepId ?? reviewStepIdOf(input.reviewerId);
  const label = fenceLabel(input.file, input.round, input.epoch);
  const session = await harness.createSession(label);
  sessionFenceMap.set(input.ctx, label, {
    sessionId: session.id,
    stepId,
    epoch: input.epoch,
    label,
    persistedAtUtc: new Date().toISOString(),
  });

  const attemptNo = input.attempt ?? 1;
  const maxAttempts = Math.max(1, input.maxAttempts ?? REVIEW_STEP_MAX_ATTEMPTS);
  const stepKey = inStepMemoKey(input);
  // Tokens of THIS attempt's failed turn(s), reachable when the failure shape
  // exposed usage (Tier-0 degenerate throws carry it; parse/validation
  // failures had it in hand). null = nothing measurable to anchor.
  let lastUsage: TokenUsage | null = null;
  const tombstoneOf = (reason: string, usage: TokenUsage | null): {
    verdict: VerdictTombstone;
    tokens: number | TokenUsage | null;
    turnDiagnosis: TurnDiagnosis | null;
  } => {
    const tokens = usage;
    return {
      verdict: {
        reviewer: input.reviewerId,
        discarded: true,
        reason,
        attempt: attemptNo,
        tokens,
      },
      tokens,
      turnDiagnosis: null,
    };
  };

  try {
    const diffBlock = renderDiffForReview({
      diffText: input.diff.raw,
      file: input.file,
      round: input.round,
      diffId: input.diff.diffId,
    });
    // US-010: reviewers of a TEST-port diff review test code as test code.
    const scopeNote = testPortScopeNote(input.file);
    const turn = composeReviewerTurn({
      reviewerId: input.reviewerId,
      reviewerLabel: REVIEWER.name,
      diffBlock: diffBlock.block,
      ...(scopeNote !== null ? { scopeNote } : {}),
    });
    const turnText =
      attemptNo > 1
        ? `${turn}\n\n(retry attempt ${attemptNo}: a previous reply on this step was truncated or unparseable — respond with exactly one JSON object and nothing else)`
        : turn;
    // Lane routing = f(attempt) ONLY (US-002): from the demotion threshold
    // (isDemotedAttempt, src/harness/lanes.ts — the one place the rule lives)
    // a review turn leaves the reviewer lane (gpt-6-luna @ high) for
    // OPENCODE_REVIEWER_MODEL_FALLBACK or — when unset — the executor lane
    // (glm-5.3-flash @ max). Pure policy over the durable dex attempt count — no
    // env mutation, no durable flag substrate (intra-step writes don't survive;
    // 0(g)). Tier-0 retries (degenerate no-text replies) therefore land on the
    // fallback lane automatically. Table: reviewLaneRouting().
    const agent = reviewerAgentOverride();
    const routing = reviewLaneRouting(attemptNo);
    const result = await runAgentTurn({
      def: REVIEWER,
      sessionId: session.id,
      turn: turnText,
      file: input.file,
      round: input.round,
      ...(agent !== undefined ? { agent } : {}),
      ...routing,
    });
    lastUsage = result.usage;
    // In-step verbatim memo (arm c): capture the PRIOR attempt's normalized
    // reply BEFORE recording this one.
    const priorNormalized = inStepVerdictTexts.get(stepKey) ?? null;
    const replyNormalized = normalizeVerdictText(result.text);
    inStepVerdictTexts.set(stepKey, replyNormalized);

    // Deterministic successor re-record (US-003): on a retry (attempt > 1) the
    // prior attempt(s) left NO durable trace (0(g) — a throwing attempt cannot
    // persist), so THIS successful attempt records the deterministic context:
    // attempt count + resulting lane. NO Jev call — a parsed verdict is
    // shape-trivial and the battery must never fire on it (AC-B1).
    const turnDiagnosis =
      attemptNo > 1
        ? buildRetryContextDiagnosis({
            file: input.file,
            stepId,
            identity: markerKeyOf(input.file, input.round),
            reviewer: input.reviewerId,
            attempt: attemptNo,
            shape: {
              shape: "parsed",
              output_tokens: result.usage?.output_tokens ?? null,
              reasoning_tokens: result.usage?.reasoning_tokens ?? null,
              text_chars: result.text.length,
              error: null,
            },
            recordedAtUtc: new Date().toISOString(),
          })
        : null;

    let parsed: unknown;
    try {
      parsed = extractJsonObject(result.text);
    } catch (err) {
      // Ambiguous shape: parseable-length text that fails verdict extraction
      // (the 885-token case). Evidence-only Tier-1 assessment; the original
      // error still drives the retry (AC-B2/B3) — or the US-006 exhaustion
      // tombstone on the final attempt (catch below).
      await diagnoseAmbiguousThrow({
        ctx: input.ctx,
        file: input.file,
        round: input.round,
        reviewerId: input.reviewerId,
        stepId,
        attempt: attemptNo,
        usage: result.usage,
        text: result.text,
        shape: "unparseable-text",
        errorMessage: (err as Error).message,
      });
      throw err;
    }
    const parsedDiff = parseUnifiedDiff(input.diff.raw);
    const mapArgs = {
      file: input.file,
      reviewer: input.reviewerId,
      round: input.round,
      diffId: input.diff.diffId,
      // Re-parse from the stored raw text: ParsedDiff carries non-JSON helpers
      // (hunk resolution) and cannot live in the durable attribute itself.
      parsedDiff,
      bodyLineOffset: input.diff.bodyLineOffset,
      naiveCited: (finding: MetricsFinding) =>
        naiveCitationCheck(
          emptyRecordWith(input.file, input.round, input.reviewerId, input.diff.diffId, finding),
          input.diff.doc,
        ).find((c) => c.finding_id === finding.finding_id)?.p_cited ?? 0,
    } as const;
    const mapped = mapVerdictToMetrics({ raw: parsed, ...mapArgs });
    if (!mapped.ok) {
      // Extracted but invalid: the discard-class trigger (diagnosed as
      // evidence-only; the error drives the dex retry — or the US-006
      // exhaustion tombstone on the final attempt).
      const err = new Error(
        `reviewer ${input.reviewerId} verdict failed validation: ${mapped.errors.join("; ")}`,
      );
      await diagnoseAmbiguousThrow({
        ctx: input.ctx,
        file: input.file,
        round: input.round,
        reviewerId: input.reviewerId,
        stepId,
        attempt: attemptNo,
        usage: result.usage,
        text: result.text,
        shape: "discarded-verdict",
        errorMessage: err.message,
      });
      throw err;
    }

    // US-006 suspicion gate (Lane A): schema-valid does not mean trusted.
    const suspicion = evaluateSuspicion({
      record: mapped.record,
      parsedDiff,
      verdictText: result.text,
      priorNormalizedText: priorNormalized,
    });
    if (!suspicion.suspect) {
      return {
        verdict: { agent: mapped.agentRecord, metrics: mapped.record },
        tokens: result.usage ?? result.tokens,
        turnDiagnosis,
      };
    }

    // ONE repair re-prompt through the SAME reviewer session config; the
    // reply is routed through harness.prompt (Tier-0 degenerateReply guard).
    const repair = await runAgentTurn({
      def: REVIEWER,
      sessionId: session.id,
      turn: composeReviewerRepairTurn({ reasons: suspicion.reasons }),
      file: input.file,
      round: input.round,
      ...(agent !== undefined ? { agent } : {}),
      ...routing,
    });
    const burned = addUsage(result.usage, repair.usage);
    let repairedRaw: unknown;
    try {
      repairedRaw = extractJsonObject(repair.text);
    } catch {
      return tombstoneOf(
        `repair-failed-schema: repair reply had no parseable JSON object`,
        burned,
      );
    }
    const repaired = mapVerdictToMetrics({ raw: repairedRaw, ...mapArgs });
    if (!repaired.ok) {
      return tombstoneOf(
        `repair-failed-schema: ${repaired.errors.join("; ")}`,
        burned,
      );
    }
    // Repair-vs-original verbatim comparison (in-step, held in memory only).
    const suspicionAfter = evaluateSuspicion({
      record: repaired.record,
      parsedDiff,
      verdictText: repair.text,
      priorNormalizedText: replyNormalized,
    });
    if (suspicionAfter.suspect) {
      return tombstoneOf(
        `repair-still-suspect: ${suspicionAfter.reasons.join("; ")}`,
        burned,
      );
    }
    inStepVerdictTexts.set(stepKey, normalizeVerdictText(repair.text));
    return {
      verdict: { agent: repaired.agentRecord, metrics: repaired.record },
      tokens: burned ?? result.usage ?? result.tokens,
      turnDiagnosis,
    };
  } catch (err) {
    // US-006 exhaustion tombstone: deterministic ctx.attempt >= maxAttempts.
    if (attemptNo >= maxAttempts) {
      const errUsage =
        err instanceof OpencodePromptError && err.usage !== null
          ? toEnvelopeUsage(err.usage)
          : null;
      if (lastUsage !== null || errUsage !== null) {
        return tombstoneOf(
          `attempt-exhausted: ${(err as Error).message.slice(0, 300)}`,
          lastUsage ?? errUsage,
        );
      }
      // No measurable provider usage on the exhausted attempt — nothing to
      // anchor (provenance: never zero, never invented). The failure stays
      // fatal; documented US-006 limitation.
    }
    throw err;
  }
}

/** Single-finding metrics record scoping for the naive fallback citation. */
function emptyRecordWith(
  file: string,
  round: number,
  reviewer: string,
  diffId: string,
  finding: MetricsFinding,
): MetricsVerdictRecord {
  return {
    file,
    reviewer,
    round,
    diff_id: diffId,
    findings: [finding],
    citation_check: [],
  };
}
