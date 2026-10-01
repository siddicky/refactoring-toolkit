/**
 * C90 remainder: the step logic that used to be copied between steps now lives in
 * shared helpers. The steps that use them are covered end to end elsewhere
 * (lane-b-gates, review-step-identity, port-flow-core, queue-verify-wave,
 * lane-b-fail-open); this file pins the helpers' own contracts so a later edit
 * cannot drift one caller away from the others.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Context } from "@superdurable/dex";

import {
  configurePortHarness,
  PortFileFlow,
  PortProjectFlow,
  ppDiff,
  ppJevUsage,
  ppLease,
  ppPrepDiff,
  ppPrepDraft,
  ppPrepFindings,
  ppPrepState,
  ppPrepVerdict,
  ppVerdict,
  verdictKeyOf,
  type CapturedDiff,
  type FileRoundInput,
  type PortRunInput,
  type ReviewTuple,
  type ReviewVerdict,
} from "../flows/port-project.js";
import { openFencedSession } from "../flows/port/agent-turns.js";
import { countingJevClient, keepFindings, recordJevUsage, type CitationScores } from "../flows/port/lane-b.js";
import { leasePool } from "../flows/port/leases.js";
import { fileRoundIdentity, outPathOf } from "../flows/port/queue-logic.js";
import { plannerPromptOpts } from "../src/harness/lanes.js";
import {
  fenceLabel,
  sessionFenceMap,
  type AgentSessionClient,
  type PromptResult,
  type SessionRef,
} from "../src/harness/opencode.js";
import { DIFF_HEADER_LINES, parseUnifiedDiff } from "../src/harness/runtime.js";
import type { JudgmentClient } from "../src/typesafe/client.js";
import { declaredLoads, stubContext, type AttributeStores, type DeclaresLoads } from "./support/dex-context.js";

const ctxOver = (stores: AttributeStores, loads?: readonly unknown[]) =>
  stubContext(stores, { flowId: "shared-helpers", runId: "run-1", ...(loads === undefined ? {} : { loads }) });

afterEach(() => {
  configurePortHarness(undefined as unknown as AgentSessionClient);
});

describe("openFencedSession", () => {
  test("creates the session under the label and stages the fence on the calling step's decision", async () => {
    const labels: string[] = [];
    configurePortHarness({
      createSession: (label: string) => {
        labels.push(label);
        return Promise.resolve({ id: "s-42", title: label });
      },
    } as unknown as AgentSessionClient);
    const stores: AttributeStores = new Map();

    const session = await openFencedSession(ctxOver(stores), { label: "porting-kit:src/a.php#1#3", stepId: "pp-fixer", epoch: 3 });

    expect(session.id).toBe("s-42");
    expect(labels).toEqual(["porting-kit:src/a.php#1#3"]);
    const fence = stores.get(sessionFenceMap)?.get("porting-kit:src/a.php#1#3") as Record<string, unknown>;
    expect(fence).toMatchObject({ sessionId: "s-42", stepId: "pp-fixer", epoch: 3, label: "porting-kit:src/a.php#1#3" });
    const persistedAt = String(fence.persistedAtUtc);
    expect(new Date(persistedAt).toISOString()).toBe(persistedAt);
    expect(stores.get(sessionFenceMap)?.size).toBe(1);
  });

  test("an unconfigured harness fails before any fence is staged", async () => {
    const stores: AttributeStores = new Map();
    await expect(openFencedSession(ctxOver(stores), { label: "l", stepId: "s", epoch: 1 })).rejects.toThrow(
      "configurePortHarness() was not called by the worker",
    );
    expect(stores.size).toBe(0);
  });

  test("a failing createSession stages no fence", async () => {
    configurePortHarness({
      createSession: () => Promise.reject(new Error("server down")),
    } as unknown as AgentSessionClient);
    const stores: AttributeStores = new Map();
    await expect(openFencedSession(ctxOver(stores), { label: "l", stepId: "s", epoch: 1 })).rejects.toThrow("server down");
    expect(stores.size).toBe(0);
  });
});

describe("recordJevUsage", () => {
  test("zero (or negative) spend neither reads nor writes pp-jev-usage", async () => {
    const ctx = {
      getAttribute: () => {
        throw new Error("pp-jev-usage was read although nothing was spent");
      },
      setAttribute: () => {
        throw new Error("pp-jev-usage was written although nothing was spent");
      },
    } as unknown as Context;
    await recordJevUsage(ctx, "pp-prioritize:src/a.php#1", 0);
    await recordJevUsage(ctx, "pp-prioritize:src/a.php#1", -5);
  });

  test("real spend appends one stamped entry per call", async () => {
    const stores: AttributeStores = new Map();
    const ctx = ctxOver(stores);
    await recordJevUsage(ctx, "pp-verdict-check:src/a.php#1", 120);
    await recordJevUsage(ctx, "pp-queue-verify:vitest-triage", 30);
    const log = stores.get(ppJevUsage)?.get("usage") as Array<{ stepId: string; tokens: number; atUtc: string }>;
    expect(log.map((e) => [e.stepId, e.tokens])).toEqual([
      ["pp-verdict-check:src/a.php#1", 120],
      ["pp-queue-verify:vitest-triage", 30],
    ]);
    expect(log.every((e) => new Date(e.atUtc).toISOString() === e.atUtc)).toBe(true);
  });
});

describe("countingJevClient", () => {
  const responder = (fail = false): JudgmentClient => ({
    kind: "real",
    systemOne: () =>
      fail
        ? Promise.reject(new Error("boom"))
        : Promise.resolve({ answers: {}, usage: { input_tokens: 7, output_tokens: 3 } } as never),
  });

  test("keeps the wrapped client's kind and sums input + output tokens over every call", async () => {
    const counting = countingJevClient(responder());
    expect(counting.client.kind).toBe("real");
    expect(counting.tokens()).toBe(0);
    await counting.client.systemOne({} as never);
    await counting.client.systemOne({} as never);
    expect(counting.tokens()).toBe(20);
  });

  test("a call that rejects adds nothing and still rejects", async () => {
    const counting = countingJevClient(responder(true));
    await expect(counting.client.systemOne({} as never)).rejects.toThrow("boom");
    expect(counting.tokens()).toBe(0);
  });
});

describe("keepFindings", () => {
  const tuple = (findings: Array<{ id: string; disposition: "fix" | "wontfix" }>): ReviewTuple =>
    ({
      agent: { findings: findings.map((f) => ({ finding_id: f.id, disposition: f.disposition })) },
      metrics: { findings: findings.map((f) => ({ finding_id: f.id })) },
    }) as unknown as ReviewTuple;
  const tombstone = (reviewer: string): ReviewVerdict =>
    ({ reviewer, discarded: true, reason: "suspicion repair failed", attempt: 3, tokens: null }) as ReviewVerdict;

  test("keeps findings whose citation clears the checker's threshold and whose disposition is fix; records every drop", async () => {
    const verdicts: Record<string, ReviewVerdict> = {
      "reviewer-A": tuple([
        { id: "f-keep", disposition: "fix" },
        { id: "f-uncited", disposition: "fix" },
        { id: "f-wontfix", disposition: "wontfix" },
        { id: "f-unscored", disposition: "fix" },
      ]),
      "reviewer-B": tombstone("reviewer-B"),
    };
    const kept = await keepFindings({
      verdictOf: (id) => verdicts[id] as ReviewVerdict,
      scoreCitations: () =>
        Promise.resolve({
          checker: "naive",
          fallbackReason: null,
          checks: [
            { finding_id: "f-keep", p_cited: 1 },
            { finding_id: "f-uncited", p_cited: 0.5 },
            { finding_id: "f-wontfix", p_cited: 1 },
          ],
        } as unknown as CitationScores),
    });

    expect(kept.findings).toEqual([{ finding_id: "f-keep" }] as never);
    expect(kept.dropped).toEqual([
      { finding_id: "f-uncited", reviewer: "reviewer-A", reason: "citation check failed (p_cited=0.5)", p_cited: 0.5 },
      { finding_id: "f-wontfix", reviewer: "reviewer-A", reason: 'disposition "wontfix"' },
      {
        finding_id: "tombstoned:reviewer-B",
        reviewer: "reviewer-B",
        reason: "reviewer discarded (attempt 3): suspicion repair failed",
      },
    ]);
    // The gate record covers the scored (non-tombstoned) reviewer only, with every score it produced.
    expect(kept.citationGate).toEqual([
      {
        reviewer: "reviewer-A",
        checker: "naive",
        fallbackReason: null,
        scores: [
          { finding_id: "f-keep", p_cited: 1 },
          { finding_id: "f-uncited", p_cited: 0.5 },
          { finding_id: "f-wontfix", p_cited: 1 },
        ],
      },
    ]);
    expect(Object.keys(kept)).toEqual(["findings", "dropped", "citationGate"]);
  });

  test("the live Jev threshold (0.8) applies per reviewer's checker, and a fallback reason is carried into the gate record", async () => {
    const verdicts: Record<string, ReviewVerdict> = {
      "reviewer-A": tuple([{ id: "f1", disposition: "fix" }]),
      "reviewer-B": tuple([{ id: "f2", disposition: "fix" }]),
    };
    const scores: Record<string, CitationScores> = {
      "reviewer-A": { checker: "jev", fallbackReason: null, checks: [{ finding_id: "f1", p_cited: 0.85 }] as never },
      "reviewer-B": { checker: "naive-fallback", fallbackReason: "Jev down", checks: [{ finding_id: "f2", p_cited: 0.85 }] as never },
    };
    const kept = await keepFindings({
      verdictOf: (id) => verdicts[id] as ReviewVerdict,
      scoreCitations: (id) => Promise.resolve(scores[id] as CitationScores),
    });
    // 0.85 clears the jev floor (0.8) but not the naive floor (1).
    expect(kept.findings).toEqual([{ finding_id: "f1" }] as never);
    expect(kept.dropped.map((d) => d.finding_id)).toEqual(["f2"]);
    expect(kept.citationGate?.map((g) => [g.reviewer, g.checker, g.fallbackReason])).toEqual([
      ["reviewer-A", "jev", null],
      ["reviewer-B", "naive-fallback", "Jev down"],
    ]);
  });

  test("both reviewers discarded: nothing kept, nothing scored", async () => {
    let scored = 0;
    const kept = await keepFindings({
      verdictOf: (id) => tombstone(id),
      scoreCitations: () => {
        scored++;
        return Promise.reject(new Error("must not score a tombstone"));
      },
    });
    expect(scored).toBe(0);
    expect(kept.findings).toEqual([]);
    expect(kept.citationGate).toEqual([]);
    expect(kept.dropped.map((d) => d.finding_id)).toEqual(["tombstoned:reviewer-A", "tombstoned:reviewer-B"]);
  });

  test("reviewers are handled in order, one at a time; a missing verdict surfaces the caller's error after the earlier reviewer was scored", async () => {
    const calls: string[] = [];
    await expect(
      keepFindings({
        verdictOf: (id) => {
          calls.push(`verdict ${id}`);
          if (id === "reviewer-B") throw new Error("verdict record missing for src__a.php#1#reviewer-B");
          return tuple([]);
        },
        scoreCitations: (id) => {
          calls.push(`score ${id}`);
          return Promise.resolve({ checker: "naive", fallbackReason: null, checks: [] });
        },
      }),
    ).rejects.toThrow("verdict record missing for src__a.php#1#reviewer-B");
    expect(calls).toEqual(["verdict reviewer-A", "score reviewer-A", "verdict reviewer-B"]);
  });
});

describe("queue-logic helpers shared by the per-file steps", () => {
  test("fileRoundIdentity is the sanitized file#round attribute key", () => {
    expect(fileRoundIdentity(undefined, { file: "src/Pricing/Flat.php", round: 2 })).toBe("src__Pricing__Flat.php#2");
  });

  test("outPathOf prefers the pp-out record and falls back to the prep source map (fix rounds never ran implement)", () => {
    const prep = { sourceMap: { "src/a.php": { outPath: "src/a.ts", notes: "" } } };
    expect(outPathOf({ outPath: "src/custom.ts" }, prep, "src/a.php")).toBe("src/custom.ts");
    expect(outPathOf(undefined, prep, "src/a.php")).toBe("src/a.ts");
    expect(outPathOf(undefined, prep, "src/missing.php")).toBeUndefined();
    expect(outPathOf(undefined, undefined, "src/a.php")).toBeUndefined();
  });
});

describe("leasePool", () => {
  test("is bound to the calling flow's own pp-lease store", () => {
    const record = {
      file: "src/a.php",
      worktreePath: "/w/a",
      branch: "lease/src/a.php/1",
      epoch: 1,
      baseSha: "abc",
      holderExecutionId: "run-1",
      acquiredAtUtc: "2026-09-30T00:00:00.000Z",
    };
    const stores: AttributeStores = new Map([[ppLease as unknown, new Map<string, unknown>([["pool", { "src/a.php": record }]])]]);
    const pool = leasePool(ctxOver(stores), { repoRoot: "/r", worktreeRoot: "/w" });
    expect(pool.store().get("src/a.php")).toEqual(record);
    expect(pool.store().list()).toEqual([record]);
    expect(leasePool(ctxOver(new Map()), { repoRoot: "/r", worktreeRoot: "/w" }).store().list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step level: the reviewer steps of each loop share one inner body, and the two
// prep planner turns share one session/lane helper.
// ---------------------------------------------------------------------------

const FILE = "src/Money.php";
const PREP_FILE = "PORTING.spec.md";

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

const diffAttr = (file: string): CapturedDiff => ({
  diffId: "diff-id-1",
  raw: SAMPLE_DIFF,
  doc: { diff_id: "diff-id-1", file, base_ref: "HEAD", hunks: parseUnifiedDiff(SAMPLE_DIFF).hunks },
  bodyLineOffset: DIFF_HEADER_LINES,
});

const healthyReply = (reviewer: string, file: string, round: number): string =>
  JSON.stringify({
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

function replyingHarness(reply: string): AgentSessionClient {
  let n = 0;
  return {
    createSession: (label: string): Promise<SessionRef> => Promise.resolve({ id: `sess-${++n}`, title: label }),
    prompt: (): Promise<PromptResult> =>
      Promise.resolve({
        text: reply,
        usage: { input: 100, output: 20, reasoning: 5, cacheRead: 0, cacheWrite: 0, cost: 0 },
        aborted: false,
      }),
    abortSessionsNotTagged: () => Promise.resolve([]),
  };
}

/** A Context that, like dex, only serves attribute maps the step declared in executeLoadAttributeMaps. */
const declaredCtx = (stores: AttributeStores, step: DeclaresLoads) => ctxOver(stores, declaredLoads(step));

const FRI: FileRoundInput = {
  repoRoot: "/tmp/c90",
  worktreeRoot: "/tmp/c90/.wt",
  integrationWorktreePath: "/tmp/c90/.wt/integration",
  sourceRoot: "/tmp/c90/src",
  epoch: 1,
  file: FILE,
  round: 1,
  worktreePath: "/tmp/c90/.wt/money",
  branch: "lease/money/1",
};

const RUN_INPUT: PortRunInput = {
  repoRoot: "/tmp/c90",
  worktreeRoot: "/tmp/c90/.wt",
  integrationWorktreePath: "/tmp/c90/.wt/integration",
  sourceRoot: "/tmp/c90/src",
  epoch: 1,
  prepPath: "/tmp/c90/stub-prep.md",
  files: [FILE],
  maxRounds: 2,
};

describe("the two reviewer steps of a loop share one inner body", () => {
  for (const [reviewerId, accessor] of [
    ["reviewer-A", "reviewA"],
    ["reviewer-B", "reviewB"],
  ] as const) {
    test(`port loop ${reviewerId}: reviews as that reviewer and stores the verdict under its own key`, async () => {
      configurePortHarness(replyingHarness(healthyReply(reviewerId, FILE, 1)));
      const flow = new PortFileFlow();
      const step = flow[accessor];
      const stores: AttributeStores = new Map([[ppDiff, new Map([[`src__Money.php#1`, diffAttr(FILE)]])]]);

      await step.execute(declaredCtx(stores, step) as never, FRI);

      const stored = stores.get(ppVerdict);
      expect([...(stored?.keys() ?? [])]).toEqual([verdictKeyOf(FILE, 1, reviewerId)]);
      const tuple = stored?.get(verdictKeyOf(FILE, 1, reviewerId)) as ReviewTuple | undefined;
      expect(tuple?.metrics.reviewer).toBe(reviewerId);
    });

    test(`prep loop ${reviewerId}: reviews as that reviewer and stores the verdict under its own key`, async () => {
      configurePortHarness(replyingHarness(healthyReply(reviewerId, PREP_FILE, 0)));
      const flow = new PortProjectFlow();
      const step = accessor === "reviewA" ? flow.prepReviewA : flow.prepReviewB;
      const stores: AttributeStores = new Map<unknown, Map<string, unknown>>([
        [ppPrepDiff, new Map([["diff", { ...diffAttr(PREP_FILE), iteration: 0 }]])],
        [ppPrepState, new Map([["state", { prepIteration: 0 }]])],
      ]);

      await step.execute(declaredCtx(stores, step) as never, RUN_INPUT);

      const stored = stores.get(ppPrepVerdict);
      expect([...(stored?.keys() ?? [])]).toEqual([verdictKeyOf(PREP_FILE, 0, reviewerId)]);
      const tuple = stored?.get(verdictKeyOf(PREP_FILE, 0, reviewerId)) as ReviewTuple | undefined;
      expect(tuple?.metrics.reviewer).toBe(reviewerId);
    });
  }

  test("a missing captured diff / prep diff fails the step with the loop's own message", async () => {
    configurePortHarness(replyingHarness("{}"));
    const fileFlow = new PortFileFlow();
    await expect(fileFlow.reviewA.execute(declaredCtx(new Map(), fileFlow.reviewA) as never, FRI)).rejects.toThrow(
      "captured diff missing for src/Money.php#1",
    );
    const projectFlow = new PortProjectFlow();
    await expect(projectFlow.prepReviewB.execute(declaredCtx(new Map(), projectFlow.prepReviewB) as never, RUN_INPUT)).rejects.toThrow(
      "prep diff/state missing",
    );
  });
});

describe("prep planner turns share one session + lane helper", () => {
  test("PrepReviseStep opens the epoch-tagged prep session, prompts on the planner lane, and an abort names the prep spec", async () => {
    const labels: string[] = [];
    const promptOpts: unknown[] = [];
    configurePortHarness({
      createSession: (label: string): Promise<SessionRef> => {
        labels.push(label);
        return Promise.resolve({ id: "prep-sess", title: label });
      },
      prompt: (_sessionId: string, _text: string, opts?: unknown): Promise<PromptResult> => {
        promptOpts.push(opts);
        return Promise.resolve({ text: "", usage: null, aborted: true });
      },
      abortSessionsNotTagged: () => Promise.resolve([]),
    } as unknown as AgentSessionClient);
    const flow = new PortProjectFlow();
    const stores: AttributeStores = new Map<unknown, Map<string, unknown>>([
      [ppPrepFindings, new Map([["findings", { findings: [], dropped: [] }]])],
      [ppPrepDraft, new Map([["draft", { specText: "# spec", iteration: 0 }]])],
      [ppPrepState, new Map([["state", { prepIteration: 1 }]])],
    ]);

    await expect(flow.prepRevise.execute(declaredCtx(stores, flow.prepRevise) as never, RUN_INPUT)).rejects.toThrow(
      "agent session aborted (file=PORTING.spec.md round=0)",
    );

    expect(labels).toEqual([fenceLabel(PREP_FILE, 0, RUN_INPUT.epoch)]);
    expect(promptOpts).toHaveLength(1);
    expect(promptOpts[0]).toMatchObject(plannerPromptOpts());
  });
});
