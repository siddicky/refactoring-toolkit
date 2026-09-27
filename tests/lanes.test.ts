/**
 * Lane routing (user policy 2026-09-27): planning = glm-5.3 @ high,
 * execution = glm-5.3-flash @ max, reviewers = gpt-6-luna @ high.
 *
 * Covered:
 * 1. In-code defaults — routing never depends on launch env (cx9b worker ran
 *    with ZERO OPENCODE_* vars, silently dropping the reviewer swap).
 * 2. Env overrides per lane (model first-slash parse; variant string), with
 *    invalid model refs ignored (in-code default stands).
 * 3. OPENCODE_REVIEWER_MODEL keeps its wave-5 meaning (reviewer lane alias).
 * 4. Review demotion f(attempt): attempt 1 = reviewer lane; attempt >= 2 =
 *    OPENCODE_REVIEWER_MODEL_FALLBACK when set, else the executor lane.
 * 5. Prompt-body wiring: PromptOptions.variant reaches session.prompt's body
 *    (server 1.18.32 field; SDK type lags) and is ABSENT when unset.
 */

import { describe, expect, test, afterEach } from "bun:test";
import {
  executorPromptOpts,
  laneRouting,
  parseModelRef,
  plannerPromptOpts,
  reviewLaneRouting,
} from "../src/harness/lanes.js";
import { OpencodeHarness } from "../src/harness/opencode.js";

const ENV_KEYS = [
  "OPENCODE_PLANNER_MODEL",
  "OPENCODE_PLANNER_VARIANT",
  "OPENCODE_EXECUTOR_MODEL",
  "OPENCODE_EXECUTOR_VARIANT",
  "OPENCODE_REVIEWER_MODEL",
  "OPENCODE_REVIEWER_VARIANT",
  "OPENCODE_REVIEWER_MODEL_FALLBACK",
  "OPENCODE_REVIEWER_MODEL_FALLBACK_VARIANT",
] as const;

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("lane defaults (in code — no env required)", () => {
  test("planner = glm-5.3 @ high", () => {
    expect(laneRouting("planner")).toEqual({
      model: { providerID: "zai-coding-plan", modelID: "glm-5.3" },
      variant: "high",
    });
  });

  test("executor = glm-5.3-flash @ max", () => {
    expect(laneRouting("executor")).toEqual({
      model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" },
      variant: "max",
    });
  });

  test("reviewer = gpt-6-luna @ high", () => {
    expect(laneRouting("reviewer")).toEqual({
      model: { providerID: "nano-gpt", modelID: "openai/gpt-6-luna" },
      variant: "high",
    });
  });

  test("prompt-opt spreads carry both fields, undefined-free", () => {
    expect(plannerPromptOpts()).toEqual({
      model: { providerID: "zai-coding-plan", modelID: "glm-5.3" },
      variant: "high",
    });
    expect(executorPromptOpts()).toEqual({
      model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" },
      variant: "max",
    });
  });
});

describe("env overrides", () => {
  test("model override parses at the FIRST slash (modelIDs may contain slashes)", () => {
    process.env.OPENCODE_REVIEWER_MODEL = "nano-gpt/openai/gpt-6-luna";
    expect(laneRouting("reviewer").model).toEqual({
      providerID: "nano-gpt",
      modelID: "openai/gpt-6-luna",
    });
  });

  test("invalid model refs are ignored — in-code default stands", () => {
    for (const bad of ["no-slash", "/leading", "trailing/", "", "  "]) {
      process.env.OPENCODE_EXECUTOR_MODEL = bad;
      expect(laneRouting("executor").model).toEqual({
        providerID: "zai-coding-plan",
        modelID: "glm-5.3-flash",
      });
    }
  });

  test("variant override replaces the default", () => {
    process.env.OPENCODE_EXECUTOR_VARIANT = "low";
    expect(laneRouting("executor").variant).toBe("low");
  });

  test("parseModelRef contract", () => {
    expect(parseModelRef("a/b/c")).toEqual({ providerID: "a", modelID: "b/c" });
    expect(parseModelRef(undefined)).toBeUndefined();
    expect(parseModelRef("  ")).toBeUndefined();
    expect(parseModelRef("x/")).toBeUndefined();
    expect(parseModelRef("/y")).toBeUndefined();
  });
});

describe("review demotion over lanes (f(attempt), US-002)", () => {
  test("attempt 1 (and undefined) = reviewer lane", () => {
    for (const a of [undefined, 1]) {
      expect(reviewLaneRouting(a)).toEqual({
        model: { providerID: "nano-gpt", modelID: "openai/gpt-6-luna" },
        variant: "high",
      });
    }
  });

  test("attempt >= 2 with no fallback env = executor lane (execution-grade work)", () => {
    expect(reviewLaneRouting(2)).toEqual({
      model: { providerID: "zai-coding-plan", modelID: "glm-5.3-flash" },
      variant: "max",
    });
    expect(reviewLaneRouting(3)).toEqual(reviewLaneRouting(2));
  });

  test("attempt >= 2 with explicit fallback model keeps the reviewer variant unless overridden", () => {
    process.env.OPENCODE_REVIEWER_MODEL_FALLBACK = "zai-coding-plan/glm-5.3";
    expect(reviewLaneRouting(2)).toEqual({
      model: { providerID: "zai-coding-plan", modelID: "glm-5.3" },
      variant: "high",
    });
    process.env.OPENCODE_REVIEWER_MODEL_FALLBACK_VARIANT = "low";
    expect(reviewLaneRouting(2)?.variant).toBe("low");
  });
});

describe("prompt-body wiring", () => {
  /** Recording double: captures the session.prompt args verbatim. */
  function recordingHarness() {
    const seen: Array<Record<string, unknown>> = [];
    const client = {
      session: {
        prompt: async (args: unknown) => {
          seen.push(args as Record<string, unknown>);
          return {
            data: {
              info: { tokens: { input: 5, output: 4, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 },
              parts: [{ type: "text", text: "ok" }],
            },
          };
        },
        messages: async () => {
          throw new Error("SDK double: session.messages must not be called");
        },
      },
    } as never;
    return { harness: new OpencodeHarness(client), seen };
  }

  test("variant set -> body carries it", async () => {
    const { harness, seen } = recordingHarness();
    const h = harness as unknown as {
      prompt: (s: string, t: string, o?: { variant?: string }) => Promise<unknown>;
    };
    await h.prompt("s", "hello", { variant: "max" });
    const body = (seen[0]?.body ?? {}) as Record<string, unknown>;
    expect(body.variant).toBe("max");
  });

  test("variant unset -> body field ABSENT (server default applies)", async () => {
    const { harness, seen } = recordingHarness();
    const h = harness as unknown as {
      prompt: (s: string, t: string, o?: { variant?: string }) => Promise<unknown>;
    };
    await h.prompt("s", "hello");
    const body = (seen[0]?.body ?? {}) as Record<string, unknown>;
    expect("variant" in body).toBe(false);
  });
});
