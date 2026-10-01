/**
 * Review-step identity and exhaustion-bound relation (audit T2, C07).
 *
 * - The step id a review turn runs under ('pp-review-a' / 'pp-review-b'; prep:
 *   'pp-prep-review-a' / 'pp-prep-review-b') must be the SAME id the envelope
 *   carries. The four runReviewTurn call sites passed none, so the fence
 *   owner, the in-step memo key and turn_diagnosis.turn were labelled
 *   'pp-review-reviewer-A' while the envelope said 'pp-review-a'.
 * - REVIEW_STEP_MAX_ATTEMPTS is an in-step exhaustion bound and is
 *   deliberately independent of (strictly inside) the dex retry budget of the
 *   review steps (RESTART_WINDOW_RETRY, 8 attempts).
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Context } from "@superdurable/dex";

import {
  configurePortHarness,
  markerKeyOf,
  PortFileFlow,
  PortProjectFlow,
  ppDiff,
  ppPrepDiff,
  ppPrepState,
  REVIEW_STEP_MAX_ATTEMPTS,
  resetInStepVerdictMemo,
  runReviewTurn,
  type CapturedDiff,
  type FileRoundInput,
  type PortRunInput,
} from "../flows/port-project.js";
import { envelopeEvents, type EnvelopeEvent } from "../flows/steps/envelope.js";
import {
  fenceLabel,
  sessionFenceMap,
  type AgentSessionClient,
  type PromptResult,
  type SessionFence,
  type SessionRef,
} from "../src/harness/opencode.js";
import { DIFF_HEADER_LINES, parseUnifiedDiff } from "../src/harness/runtime.js";

type Stores = Map<unknown, Map<string, unknown>>;

const SAMPLE_DIFF = `diff --git a/src/money.ts b/src/money.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/money.ts
@@ -0,0 +1,4 @@
+export class Money {
+  constructor(readonly cents: number) {}
+  add(other: Money): Money {
+    return new Money(this.cents + other.cents);
+  }
+}`;

const FILE = "src/Money.php";
const PREP_FILE = "PORTING.spec.md";

function diffAttr(file: string): CapturedDiff {
  return {
    diffId: "diff-id-1",
    raw: SAMPLE_DIFF,
    doc: { diff_id: "diff-id-1", file, base_ref: "HEAD", hunks: parseUnifiedDiff(SAMPLE_DIFF).hunks },
    bodyLineOffset: DIFF_HEADER_LINES,
  };
}

/** Schema-valid, non-suspect verdict for `reviewer` (one in-diff finding). */
function healthyReply(reviewer: string, file: string, round: number): string {
  return JSON.stringify({
    file,
    reviewer,
    round,
    diff_id: "diff-id-1",
    findings: [
      {
        finding_id: "F1",
        severity: "major",
        description: "add() drops the currency check",
        evidence_span: { start_line: DIFF_HEADER_LINES + 8, end_line: DIFF_HEADER_LINES + 8, snippet: "add(other: Money): Money {" },
        disposition: "fix",
      },
    ],
    citation_check: [{ finding_id: "F1", p_cited: 1 }],
  });
}

function harnessReplying(reply: string): AgentSessionClient {
  let n = 0;
  return {
    createSession: (label: string): Promise<SessionRef> => Promise.resolve({ id: `sess-${++n}`, title: label }),
    prompt: (): Promise<PromptResult> =>
      Promise.resolve({ text: reply, usage: { input: 100, output: 20, reasoning: 5, cacheRead: 0, cacheWrite: 0, cost: 0 }, aborted: false }),
    abortSessionsNotTagged: () => Promise.resolve([]),
  };
}

function ctxFor(stores: Stores, step: { getStepOptions?: () => unknown }, attempt: number): Context {
  const options = step.getStepOptions?.() as { executeLoadAttributeMaps?: readonly unknown[] } | undefined;
  const declared = options?.executeLoadAttributeMaps ?? [];
  return {
    attempt,
    flowId: "t2-review-identity",
    runId: "run-1",
    getAttribute: (attr: unknown, instance: string) => {
      if (!declared.includes(attr)) {
        throw new Error(`AttributeMap instance was not loaded: ${(attr as { name?: string }).name ?? "?"}/${instance}`);
      }
      return stores.get(attr)?.get(instance);
    },
    setAttribute: (attr: unknown, value: unknown, instance: string) => {
      let store = stores.get(attr);
      if (store === undefined) {
        store = new Map();
        stores.set(attr, store);
      }
      store.set(instance, value);
    },
  } as unknown as Context;
}

const FRI: FileRoundInput = {
  repoRoot: "/tmp/t2",
  worktreeRoot: "/tmp/t2/.wt",
  integrationWorktreePath: "/tmp/t2/.wt/integration",
  sourceRoot: "/tmp/t2/src",
  epoch: 1,
  file: FILE,
  round: 1,
  worktreePath: "/tmp/t2/.wt/money",
  branch: "lease/money/1",
};

const RUN_INPUT: PortRunInput = {
  repoRoot: "/tmp/t2",
  worktreeRoot: "/tmp/t2/.wt",
  integrationWorktreePath: "/tmp/t2/.wt/integration",
  sourceRoot: "/tmp/t2/src",
  epoch: 1,
  prepPath: "/tmp/t2/stub-prep.md",
  files: [FILE],
  maxRounds: 2,
};

afterEach(() => {
  resetInStepVerdictMemo();
  configurePortHarness(undefined as unknown as AgentSessionClient);
});

function fenceOf(stores: Stores, file: string, round: number): SessionFence | undefined {
  return stores.get(sessionFenceMap)?.get(fenceLabel(file, round, 1)) as SessionFence | undefined;
}

describe("port-loop review steps carry their envelope step id everywhere", () => {
  for (const [reviewerId, stepId, accessor] of [
    ["reviewer-A", "pp-review-a", "reviewA"],
    ["reviewer-B", "pp-review-b", "reviewB"],
  ] as const) {
    test(`${stepId}: fence owner and diagnosis turn name the envelope step`, async () => {
      configurePortHarness(harnessReplying(healthyReply(reviewerId, FILE, 1)));
      const flow = new PortFileFlow();
      const step = accessor === "reviewA" ? flow.reviewA : flow.reviewB;
      const stores: Stores = new Map([[ppDiff, new Map([[markerKeyOf(FILE, 1), diffAttr(FILE)]])]]);

      // Attempt 2 so the retry-context diagnosis (labelled with the step id) is built.
      const decision = await step.execute(ctxFor(stores, step, 2) as never, FRI);
      expect(decision.kind).toBe("next");

      expect(fenceOf(stores, FILE, 1)?.stepId).toBe(stepId);
      const envelopes = [...(stores.get(envelopeEvents)?.values() ?? [])] as EnvelopeEvent[];
      const completed = envelopes.find((e) => e.ended_at !== null);
      expect(completed?.stepId).toBe(stepId);
      expect(completed?.turn_diagnosis?.turn).toBe(`${stepId}@${markerKeyOf(FILE, 1)}`);
    });
  }

  test("a caller that passes no stepId still gets the envelope id, not 'pp-review-reviewer-A'", async () => {
    configurePortHarness(harnessReplying(healthyReply("reviewer-A", FILE, 1)));
    const stores: Stores = new Map();
    const ctx = ctxFor(stores, {}, 2);
    const out = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-A",
      file: FILE,
      round: 1,
      epoch: 1,
      diff: diffAttr(FILE),
      attempt: 2,
    });
    expect(fenceOf(stores, FILE, 1)?.stepId).toBe("pp-review-a");
    expect(out.turnDiagnosis?.turn).toBe(`pp-review-a@${markerKeyOf(FILE, 1)}`);
  });
});

describe("prep-loop review steps carry their own envelope step ids", () => {
  for (const [reviewerId, stepId, accessor] of [
    ["reviewer-A", "pp-prep-review-a", "prepReviewA"],
    ["reviewer-B", "pp-prep-review-b", "prepReviewB"],
  ] as const) {
    test(`${stepId}: fence owner and diagnosis turn name the envelope step`, async () => {
      configurePortHarness(harnessReplying(healthyReply(reviewerId, PREP_FILE, 0)));
      const flow = new PortProjectFlow();
      const step = accessor === "prepReviewA" ? flow.prepReviewA : flow.prepReviewB;
      const stores: Stores = new Map();
      stores.set(ppPrepDiff, new Map([["diff", { ...diffAttr(PREP_FILE), iteration: 0 }]]));
      stores.set(ppPrepState, new Map([["state", { prepIteration: 0 }]]));

      const decision = await step.execute(ctxFor(stores, step, 2) as never, RUN_INPUT);
      expect(decision.kind).toBe("next");

      expect(fenceOf(stores, PREP_FILE, 0)?.stepId).toBe(stepId);
      const envelopes = [...(stores.get(envelopeEvents)?.values() ?? [])] as EnvelopeEvent[];
      const completed = envelopes.find((e) => e.ended_at !== null);
      expect(completed?.stepId).toBe(stepId);
      expect(completed?.turn_diagnosis?.turn.startsWith(`${stepId}@`)).toBe(true);
    });
  }
});

describe("REVIEW_STEP_MAX_ATTEMPTS vs the dex retry budget", () => {
  test("the in-step exhaustion bound sits strictly inside the review steps' dex retry budget", () => {
    const flow = new PortFileFlow();
    for (const step of [flow.reviewA, flow.reviewB]) {
      const options = step.getStepOptions?.() as { executeRetry?: { maximumAttempts?: number } } | undefined;
      const budget = options?.executeRetry?.maximumAttempts;
      expect(budget).toBeDefined();
      // Tombstoning must be reachable before dex gives up; equality or more would make it dead code.
      expect(REVIEW_STEP_MAX_ATTEMPTS).toBeLessThan(budget as number);
    }
  });
});
