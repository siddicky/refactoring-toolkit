/**
 * Turn-health Tier-1 assessment (US-003, Stage 1b) — EVIDENCE-ONLY.
 *
 * When a turn's shape is AMBIGUOUS (parseable-length output that fails verdict
 * extraction — the 885-token unparseable case from BUILD_NOTES §WAVE-4 p4-10 —
 * or a discarded verdict), ONE Jev systemOne call runs a
 * four-noul battery over the observed shape and the result is recorded as
 * evidence. The battery NEVER fires on shape-trivial turns: healthy parsed
 * verdicts, the US-002 Tier-0 degenerate no-text signature, and aborted turns
 * are all classified deterministically and make ZERO Jev calls (AC-B1).
 *
 * Hard boundaries (test-asserted in tests/turn-health.test.ts):
 * - ZERO control-flow consumers: no module under flows/** or src/git/**
 *   imports this file. Flow code reaches an assessor only through the injected
 *   TurnHealthAssessor INTERFACE (src/metrics/types.ts via
 *   flows/runtime-hooks.ts) — the implementation stays unread by control flow.
 * - Fail-open everywhere: an unavailable/erroring Jev client degrades to
 *   "no diagnosis" (null) and must never alter a step's failure path (AC-B3).
 * - Records are evidence only: `disposition: "recorded-evidence"`; no retry,
 *   demotion, gate, or routing decision may read any field (AC-B2).
 *
 * The successor-attempt re-record (the durable surface a THROWING attempt
 * cannot have, 0(g)) is the deterministic builder in src/metrics/types.ts —
 * deliberately NOT here, so flow code never imports this module.
 */

import type {
  InMemoryResponder,
  JudgmentClient,
  NoulResponse,
  Questions,
} from "./client.js";
import {
  createInMemoryJevClient,
  createRealJevClient,
  isTypesafeOffline,
} from "./client.js";
import {
  isShapeAmbiguous,
  type TurnDiagnosis,
  type TurnHealthAssessmentInput,
  type TurnHealthAssessor,
} from "../metrics/types.js";

/** The four Tier-1 questions (noul battery; one systemOne call, no more). */
const TURN_HEALTH_QUESTION_NAMES = [
  "degenerate_output",
  "reasoning_without_text",
  "truncation_risk",
  "provider_flap_signature",
] as const;

/**
 * The noul battery. Each question asks for the probability that the named
 * failure mode explains/characterizes the observed turn — evidence for the
 * report's §Turn-diagnosis table, never a routing input.
 */
function turnHealthQuestions(): Questions {
  return {
    degenerate_output: {
      type: "noul",
      instructions:
        "Does the observed turn show the degenerate-output signature: the provider reported a completed turn whose output tokens are absent or near-zero while no usable text was produced?",
      criteria: {
        true: "output tokens absent/near-zero with no usable text",
        false: "the turn produced ordinary output tokens or usable text",
      },
    },
    reasoning_without_text: {
      type: "noul",
      instructions:
        "Did the turn spend heavily on reasoning tokens while producing little or no answer text (reasoning-heavy, text-empty)?",
      criteria: {
        true: "reasoning tokens dominate and text is empty or minimal",
        false: "reasoning is proportional to the text produced",
      },
    },
    truncation_risk: {
      type: "noul",
      instructions:
        "Does the observed reply look TRUNCATED rather than empty: substantial output tokens and text length, but the verdict payload is unparseable or cut off mid-structure?",
      criteria: {
        true: "output is substantial yet fails verdict extraction like a cut-off payload",
        false: "the reply is either complete or empty — not cut off",
      },
    },
    provider_flap_signature: {
      type: "noul",
      instructions:
        "Given the attempt count and the shape of this and prior failed attempts, does the pattern look like provider-side flapping (repeated same-shaped failures within one step) rather than a one-off?",
      criteria: {
        true: "repeated failure shapes across attempts indicate provider flapping",
        false: "an isolated failure — no flapping pattern",
      },
    },
  };
}

/**
 * Runs the Tier-1 battery. ZERO client calls unless the shape is ambiguous
 * (AC-B1); one systemOne call otherwise; null (no diagnosis) on ANY client
 * failure — Tier-1 unavailability degrades to no-diagnosis and never throws
 * into the caller's failure path (AC-B3).
 */
async function assessTurnHealth(
  client: JudgmentClient,
  input: TurnHealthAssessmentInput,
): Promise<TurnDiagnosis | null> {
  if (!isShapeAmbiguous(input.shape.shape)) return null;
  try {
    const result = await client.systemOne({
      state: JSON.stringify({
        file: input.file,
        turn: input.turn,
        reviewer: input.reviewer,
        attempt: input.attempt,
        prior_failed_attempts: input.prior_failed_attempts,
        lane: input.lane,
        shape: input.shape,
        trigger: input.shape.shape === "discarded-verdict" ? "discarded-verdict" : "ambiguous-shape",
      }),
      questions: turnHealthQuestions(),
    });
    const questions = TURN_HEALTH_QUESTION_NAMES.map((name) => {
      const answer = result.answers[name] as NoulResponse | undefined;
      return {
        name,
        p: typeof answer?.noul === "number" ? answer.noul : null,
      };
    });
    return {
      file: input.file,
      turn: input.turn,
      reviewer: input.reviewer,
      attempt: input.attempt,
      prior_failed_attempts: input.prior_failed_attempts,
      lane: input.lane,
      trigger: input.shape.shape === "discarded-verdict" ? "discarded-verdict" : "ambiguous-shape",
      shape: input.shape,
      questions,
      model: result.model,
      jev_usage: {
        input_tokens: result.usage.input_tokens,
        output_tokens: result.usage.output_tokens,
      },
      disposition: "recorded-evidence",
      recorded_at_utc: input.recordedAtUtc,
    };
  } catch {
    // Fail-open: Tier-1 unavailable -> no diagnosis (AC-B3). The caller's
    // failure path proceeds exactly as if no assessor were configured.
    return null;
  }
}

/**
 * Deterministic SCRIPTED answers for the in-memory offline double (same
 * philosophy as runtime.ts offlineJevResponder: fixed fixtures, never
 * reported as live Jev usage). Fixed mid-range probabilities make offline
 * diagnosis records unmistakably scripted.
 */
const turnHealthOfflineResponder: InMemoryResponder = () => ({
  degenerate_output: { type: "noul", noul: 0.1 },
  reasoning_without_text: { type: "noul", noul: 0.2 },
  truncation_risk: { type: "noul", noul: 0.6 },
  provider_flap_signature: { type: "noul", noul: 0.3 },
});

function assessorFromClient(client: JudgmentClient): TurnHealthAssessor {
  return {
    assess: (input: TurnHealthAssessmentInput) => assessTurnHealth(client, input),
  };
}

/**
 * Env-aware factory for the runner wiring (scripts/run-demo.ts worker), same
 * seam rules as src/typesafe/client.ts (offline double / real client / none):
 * - TYPESAFE_OFFLINE=1 -> in-memory double + scripted responder (offline
 *   diagnosis evidence, model "in-memory-double");
 * - TYPESAFE_API_KEY present -> the REAL billed client;
 * - anything unavailable (no key, construction failure) -> null: the worker
 *   runs with NO assessor and ambiguous turns simply produce no diagnosis.
 * Never throws — Tier-1 is evidence-only and must stay fail-open end to end.
 */
export async function createTurnHealthAssessor(): Promise<TurnHealthAssessor | null> {
  try {
    if (isTypesafeOffline()) {
      return assessorFromClient(createInMemoryJevClient(turnHealthOfflineResponder));
    }
    return assessorFromClient(await createRealJevClient());
  } catch {
    return null;
  }
}
