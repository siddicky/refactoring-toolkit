/**
 * Model lane routing (wave-5 routing policy, user directive 2026-09-27):
 *
 *   planner  — planning/artifact turns (prep-generate)  → zai-coding-plan/glm-5.3       @ high
 *   executor — port/fix turns (implementer, fixer)      → zai-coding-plan/glm-5.3-flash @ max
 *   reviewer — adversarial review turns (A/B, repair)   → nano-gpt/openai/gpt-6-luna    @ high
 *
 * Defaults are IN CODE so routing never depends on launch-env luck (the cx9b
 * worker carried zero OPENCODE_* vars, silently dropping the reviewer swap).
 * Every value is overridable per lane:
 *
 *   OPENCODE_PLANNER_MODEL  / OPENCODE_EXECUTOR_MODEL  / OPENCODE_REVIEWER_MODEL
 *   OPENCODE_PLANNER_VARIANT / OPENCODE_EXECUTOR_VARIANT / OPENCODE_REVIEWER_VARIANT
 *
 * Model format: `providerID/modelID` split at the FIRST slash (modelIDs may
 * contain slashes, e.g. `nano-gpt/openai/gpt-6-luna`). Invalid formats are
 * ignored — the in-code default stands. `OPENCODE_REVIEWER_MODEL` keeps its
 * pre-lanes meaning (wave-5 reviewer swap) and stays authoritative for the
 * reviewer lane's model.
 *
 * Variants are the opencode per-model reasoning-effort ladders (server 1.18.32
 * exposes `variant` on the prompt body; glm models carry low/high/max). The
 * SDK's body type lags the server, hence the `as never` cast at the call site.
 * Every lane default carries a variant, so a model override onto a model
 * without that ladder needs `OPENCODE_<LANE>_VARIANT=none` (case-insensitive)
 * to omit the field; the same sentinel works for
 * `OPENCODE_REVIEWER_MODEL_FALLBACK_VARIANT`.
 */

import { envString as env } from "../env.js";

export type LaneName = "planner" | "executor" | "reviewer";

/** Prompt-target for one lane: explicit model ref + reasoning variant. */
export interface LaneRouting {
  /** undefined = omit the body field (server default model). */
  model: { providerID: string; modelID: string } | undefined;
  /** undefined = omit the body field (model default variant); set by `OPENCODE_<LANE>_VARIANT=none`. */
  variant: string | undefined;
}

/** `providerID/modelID` at the first slash; anything else is ignored. */
export function parseModelRef(
  v: string | undefined,
): { providerID: string; modelID: string } | undefined {
  const s = v?.trim();
  if (s === undefined || s === "") return undefined;
  const slash = s.indexOf("/");
  if (slash <= 0 || slash >= s.length - 1) return undefined;
  return { providerID: s.slice(0, slash), modelID: s.slice(slash + 1) };
}

/**
 * Variant env semantics: unset/blank keeps `defaultVariant`, the sentinel
 * `none` (any case) means "send no variant", anything else is used verbatim.
 */
function variantFrom(
  envValue: string | undefined,
  defaultVariant: string | undefined,
): string | undefined {
  if (envValue === undefined) return defaultVariant;
  return envValue.toLowerCase() === "none" ? undefined : envValue;
}

/** In-code policy defaults (see header). Not env-readable. */
const LANE_DEFAULTS: Record<LaneName, LaneRouting> = {
  planner: {
    model: { providerID: "zai-coding-plan", modelID: "glm-5.3" },
    variant: "high",
  },
  executor: {
    model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" },
    variant: "max",
  },
  reviewer: {
    model: { providerID: "nano-gpt", modelID: "openai/gpt-6-luna" },
    variant: "high",
  },
};

/**
 * Resolved routing for a lane: env override per field, in-code default
 * underneath. PURE apart from the env read.
 */
export function laneRouting(lane: LaneName): LaneRouting {
  const defaults = LANE_DEFAULTS[lane];
  const modelEnv = env(`OPENCODE_${lane.toUpperCase()}_MODEL`);
  const variantEnv = env(`OPENCODE_${lane.toUpperCase()}_VARIANT`);
  return {
    model: parseModelRef(modelEnv) ?? defaults.model,
    variant: variantFrom(variantEnv, defaults.variant),
  };
}

/** Prompt-option spreads for the fixed-lane call sites. */
export interface PromptLaneOpts {
  model?: { providerID: string; modelID: string };
  variant?: string;
}

/** Narrow a loose LaneRouting into exactOptionalPropertyTypes-clean opts. */
function toPromptOpts(r: LaneRouting): PromptLaneOpts {
  const out: PromptLaneOpts = {};
  if (r.model !== undefined) out.model = r.model;
  if (r.variant !== undefined) out.variant = r.variant;
  return out;
}

export const plannerPromptOpts = (): PromptLaneOpts => toPromptOpts(laneRouting("planner"));
export const executorPromptOpts = (): PromptLaneOpts => toPromptOpts(laneRouting("executor"));

/**
 * The review-lane demotion threshold — the ONE place the rule lives. A review
 * turn on attempt >= 2 (the dex retry count; undefined = first attempt) runs
 * on the demotion lane instead of the reviewer lane. runtime.ts
 * demoteReviewerLane and {@link reviewLaneRouting} both delegate here.
 */
export function isDemotedAttempt(attempt: number | undefined): boolean {
  return (attempt ?? 1) >= 2;
}

function reviewLaneRoutingLoose(attempt: number | undefined): LaneRouting {
  const reviewer = laneRouting("reviewer");
  if (!isDemotedAttempt(attempt)) return reviewer;
  const fallbackModel = parseModelRef(env("OPENCODE_REVIEWER_MODEL_FALLBACK"));
  if (fallbackModel !== undefined) {
    return {
      model: fallbackModel,
      variant: variantFrom(env("OPENCODE_REVIEWER_MODEL_FALLBACK_VARIANT"), reviewer.variant),
    };
  }
  return laneRouting("executor");
}

/**
 * Review-turn routing = demotion policy f(attempt) (US-002) over lanes:
 * attempt 1 runs the reviewer lane; attempt >= 2 ({@link isDemotedAttempt})
 * demotes to the fallback model (`OPENCODE_REVIEWER_MODEL_FALLBACK`) or —
 * when unset — the EXECUTOR lane, since a demoted review turn is
 * execution-grade work. The variant follows the model's lane.
 */
export const reviewLaneRouting = (attempt: number | undefined): PromptLaneOpts =>
  toPromptOpts(reviewLaneRoutingLoose(attempt));
