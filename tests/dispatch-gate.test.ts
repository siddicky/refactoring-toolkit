/**
 * scripts/dispatch-gate.ts — US-002 lead-layer dispatch health gate (AC-B3).
 *
 * The module is pure control flow over an injected flowHistory query and an
 * injected clock, so every fail-open branch is testable without dexcli. Its
 * header promises tests import it; this is that test.
 */
import { describe, expect, test } from "bun:test";

import {
  GATE_QUERY_TIMEOUT_MS,
  GATE_STALE_MS,
  REVIEW_STEP_TYPES,
  evaluateDispatchGate,
  gateLine,
  isReviewStepType,
  reviewFailureFacts,
} from "../scripts/dispatch-gate.js";
import type { QueryResult } from "../src/dashboard/queries.js";
import type { DexHistoryWire } from "../src/dashboard/types.js";
import { PORT_FLOW_STEPS } from "../src/metrics/dispatch-anchor.js";
import { portFlowSource } from "./support/port-flow-source.js";

const NOW = Date.parse("2026-09-30T12:00:00.000Z");
const isoAgo = (ms: number): string => new Date(NOW - ms).toISOString();

let counter = 0;
function ev(
  type: string,
  stepType: string,
  ageMs: number | string,
  finalAttempt?: unknown,
): DexHistoryWire["events"][number] {
  counter += 1;
  return {
    eventId: `e${counter}`,
    eventTime: typeof ageMs === "string" ? ageMs : isoAgo(ageMs),
    type,
    payload: {
      context: {
        stepExecutionId: `x${counter}`,
        stepType,
        ...(finalAttempt !== undefined ? { finalAttempt: finalAttempt as number } : {}),
      },
    },
  };
}
const hist = (...events: DexHistoryWire["events"]): DexHistoryWire => ({ flowId: "f", runId: "r", events });
const okQuery =
  (h: DexHistoryWire) =>
  async (): Promise<QueryResult<DexHistoryWire>> => ({ ok: true, value: h });

describe("gate constants", () => {
  test("5 s query timeout and 10 min staleness", () => {
    expect(GATE_QUERY_TIMEOUT_MS).toBe(5_000);
    expect(GATE_STALE_MS).toBe(600_000);
  });
});

describe("isReviewStepType", () => {
  test("recognizes exactly the four review step types", () => {
    for (const t of ["PpReviewA", "PpReviewB", "PpPrepReviewA", "PpPrepReviewB"]) {
      expect(isReviewStepType(t)).toBe(true);
    }
    expect(isReviewStepType("PpImplement")).toBe(false);
    expect(isReviewStepType("PpReviewAStart")).toBe(false);
    expect(isReviewStepType(undefined)).toBe(false);
    expect(isReviewStepType(42)).toBe(false);
  });
});

describe("reviewFailureFacts (pure; nowMs injected)", () => {
  test("no review events: zero facts, null age and attempt", () => {
    const facts = reviewFailureFacts(hist(ev("StepExecuteFailed", "PpImplement", 1000)), NOW);
    expect(facts).toEqual({
      consecutiveReviewFailures: 0,
      newestFinalAttempt: null,
      newestRelevantEventAgeMs: null,
      relevantEventCount: 0,
    });
  });

  test("counts the TRAILING run of failed review executions", () => {
    const facts = reviewFailureFacts(
      hist(
        ev("StepExecuteCompleted", "PpReviewA", 50_000, 1),
        ev("StepExecuteFailed", "PpReviewA", 40_000, 1),
        ev("StepExecuteFailed", "PpReviewB", 30_000, 2),
        ev("StepExecuteFailed", "PpReviewA", 20_000, 3),
      ),
      NOW,
    );
    expect(facts.consecutiveReviewFailures).toBe(3);
    expect(facts.newestFinalAttempt).toBe(3);
    expect(facts.relevantEventCount).toBe(4);
    expect(facts.newestRelevantEventAgeMs).toBe(20_000);
  });

  test("a completed execution resets the chain; a completed newest event means zero", () => {
    const reset = reviewFailureFacts(
      hist(
        ev("StepExecuteFailed", "PpReviewA", 50_000),
        ev("StepExecuteCompleted", "PpReviewA", 40_000),
        ev("StepExecuteFailed", "PpReviewA", 30_000),
      ),
      NOW,
    );
    expect(reset.consecutiveReviewFailures).toBe(1);
    const healthy = reviewFailureFacts(
      hist(ev("StepExecuteFailed", "PpReviewA", 50_000), ev("StepExecuteCompleted", "PpReviewA", 40_000)),
      NOW,
    );
    expect(healthy.consecutiveReviewFailures).toBe(0);
  });

  test("waitFor-phase and unknown event kinds never break the failure chain", () => {
    const facts = reviewFailureFacts(
      hist(
        ev("StepExecuteFailed", "PpReviewA", 50_000),
        ev("StepWaitForCompleted", "PpReviewA", 45_000),
        ev("StepWaitForStarted", "PpReviewA", 44_000),
        ev("StepExecuteFailed", "PpReviewA", 40_000),
        ev("SomethingElse", "PpReviewA", 30_000),
      ),
      NOW,
    );
    expect(facts.consecutiveReviewFailures).toBe(2);
    expect(facts.relevantEventCount).toBe(5);
  });

  test("failures of non-review steps are ignored", () => {
    const facts = reviewFailureFacts(
      hist(
        ev("StepExecuteFailed", "PpReviewA", 50_000),
        ev("StepExecuteFailed", "PpImplement", 40_000),
        ev("StepExecuteFailed", "PpFixer", 30_000),
      ),
      NOW,
    );
    expect(facts.consecutiveReviewFailures).toBe(1);
    expect(facts.relevantEventCount).toBe(1);
  });

  test("malformed finalAttempt and eventTime degrade to null instead of throwing", () => {
    const facts = reviewFailureFacts(
      hist(
        ev("StepExecuteFailed", "PpReviewA", 10_000, 1.5),
        ev("StepExecuteFailed", "PpReviewA", "not-a-date", "3"),
      ),
      NOW,
    );
    expect(facts.consecutiveReviewFailures).toBe(2);
    expect(facts.newestFinalAttempt).toBeNull();
    expect(facts.newestRelevantEventAgeMs).toBeNull();
  });

  test("an event time in the future clamps the age to 0", () => {
    const facts = reviewFailureFacts(hist(ev("StepExecuteCompleted", "PpReviewB", -5_000)), NOW);
    expect(facts.newestRelevantEventAgeMs).toBe(0);
  });

  test("the prep review steps count like the per-file ones", () => {
    const facts = reviewFailureFacts(
      hist(ev("StepExecuteFailed", "PpPrepReviewA", 2_000), ev("StepExecuteFailed", "PpPrepReviewB", 1_000)),
      NOW,
    );
    expect(facts.consecutiveReviewFailures).toBe(2);
  });
});

describe("evaluateDispatchGate fail-open branches (AC-B3)", () => {
  const failOpen = (report: Awaited<ReturnType<typeof evaluateDispatchGate>>): void => {
    expect(report.verdict).toBe("degraded");
    expect(report.protection).toBe("none");
  };

  test("no flow id (undefined or empty): degraded without calling the query", async () => {
    let calls = 0;
    const query = async (): Promise<QueryResult<DexHistoryWire>> => {
      calls += 1;
      return { ok: true, value: hist() };
    };
    for (const id of [undefined, ""]) {
      const report = await evaluateDispatchGate(query, id, NOW);
      failOpen(report);
      expect(report.reason).toContain("no flow history available");
      expect(report.facts).toBeNull();
    }
    expect(calls).toBe(0);
  });

  test("a throwing query is degraded, never propagated", async () => {
    const report = await evaluateDispatchGate(
      async () => {
        throw new Error("boom");
      },
      "f",
      NOW,
    );
    failOpen(report);
    expect(report.reason).toBe("flow history query threw: boom");
    expect(report.facts).toBeNull();
  });

  test("an !ok query result is degraded with its error", async () => {
    const report = await evaluateDispatchGate(
      async () => ({ ok: false as const, error: "dexcli exited 1" }),
      "f",
      NOW,
    );
    failOpen(report);
    expect(report.reason).toBe("flow history query failed: dexcli exited 1");
  });

  test("empty history (or a non-array events field) is degraded", async () => {
    const report = await evaluateDispatchGate(okQuery(hist()), "f", NOW);
    failOpen(report);
    expect(report.reason).toBe("flow history for f is empty");
    const weird = await evaluateDispatchGate(
      okQuery({ flowId: "f", runId: "r" } as unknown as DexHistoryWire),
      "f",
      NOW,
    );
    failOpen(weird);
  });

  test("history with no review-step events has nothing to vouch on (facts still returned)", async () => {
    const report = await evaluateDispatchGate(
      okQuery(hist(ev("StepExecuteCompleted", "PpImplement", 1_000))),
      "f",
      NOW,
    );
    failOpen(report);
    expect(report.reason).toContain("no review-step events in f history");
    expect(report.facts?.relevantEventCount).toBe(0);
  });

  test("a review event with an unparsable time cannot be aged, so it cannot vouch either", async () => {
    const report = await evaluateDispatchGate(
      okQuery(hist(ev("StepExecuteCompleted", "PpReviewA", "garbage"))),
      "f",
      NOW,
    );
    failOpen(report);
    expect(report.reason).toContain("no review-step events");
  });

  test("stale newest review event (> 10 min) is degraded; exactly 10 min is still fresh", async () => {
    const stale = await evaluateDispatchGate(
      okQuery(hist(ev("StepExecuteCompleted", "PpReviewA", GATE_STALE_MS + 1_000))),
      "f",
      NOW,
    );
    failOpen(stale);
    expect(stale.reason).toBe("newest review event is 601s old (> 600s stale threshold)");
    const boundary = await evaluateDispatchGate(
      okQuery(hist(ev("StepExecuteCompleted", "PpReviewA", GATE_STALE_MS))),
      "f",
      NOW,
    );
    expect(boundary.verdict).toBe("ok");
  });
});

describe("evaluateDispatchGate healthy path", () => {
  test("fresh history with zero failures: ok, protection active", async () => {
    const report = await evaluateDispatchGate(
      okQuery(hist(ev("StepExecuteCompleted", "PpReviewA", 30_000, 1))),
      "f",
      NOW,
    );
    expect(report.verdict).toBe("ok");
    expect(report.protection).toBe("active");
    expect(report.reason).toBe("newest review event 30s old; no failed review executions");
    expect(report.facts?.consecutiveReviewFailures).toBe(0);
  });

  test("fresh history with N trailing failures is still ok by design (protection active) and says so in the reason", async () => {
    const report = await evaluateDispatchGate(
      okQuery(
        hist(
          ev("StepExecuteFailed", "PpReviewA", 40_000, 1),
          ev("StepExecuteFailed", "PpReviewA", 30_000, 2),
          ev("StepExecuteFailed", "PpReviewB", 20_000, 3),
        ),
      ),
      "f",
      NOW,
    );
    expect(report.verdict).toBe("ok");
    expect(report.protection).toBe("active");
    expect(report.facts?.consecutiveReviewFailures).toBe(3);
    expect(report.reason).toContain("3 consecutive failed review execution(s)");
  });
});

describe("gateLine (the runner's single output line)", () => {
  test("ok reports the basis; degraded states the missing protection explicitly", async () => {
    const ok = await evaluateDispatchGate(
      okQuery(hist(ev("StepExecuteCompleted", "PpReviewA", 10_000))),
      "f",
      NOW,
    );
    expect(gateLine(ok)).toMatch(/^gate: ok \(newest review event 10s old/);
    const degraded = await evaluateDispatchGate(okQuery(hist()), "f", NOW);
    expect(gateLine(degraded)).toContain("gate: degraded (flow history for f is empty)");
    expect(gateLine(degraded)).toContain("dispatch protection NOT active (fail-open)");
  });
});

describe("REVIEW_STEP_TYPES (derived from the dispatch-anchor step table, no flow imports)", () => {
  const sorted = (xs: readonly string[]): string[] => [...xs].sort();

  test("is the review-role MODEL steps of the step table: the two prep reviewers and the two file reviewers", () => {
    expect(sorted(REVIEW_STEP_TYPES)).toEqual(["PpPrepReviewA", "PpPrepReviewB", "PpReviewA", "PpReviewB"]);
    expect(REVIEW_STEP_TYPES.every((t) => PORT_FLOW_STEPS.some((s) => s.stepType === t && s.kind === "model"))).toBe(true);
  });

  test("equals the review step types the flow itself registers (flows/port-project.ts + flows/port/*)", () => {
    const source = portFlowSource();
    const inFlow = new Set([...source.matchAll(/stepType:\s*"(Pp(?:Prep)?Review[AB])"/g)].map((m) => m[1] ?? ""));
    expect(sorted([...inFlow])).toEqual(sorted(REVIEW_STEP_TYPES));
  });
});
