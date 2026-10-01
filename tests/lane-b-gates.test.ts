/**
 * Lane-B gates in the port loop (audit T2, C08): the citation gate in
 * VerdictCheckStep / PrepVerdictCheckStep and the rerank in PrioritizeStep.
 *
 * - The keep threshold is a named constant per checker kind: the naive
 *   checker is binary (keep iff 1), the live Jev checker returns a noul
 *   probability (keep iff >= CITATION_MIN_P_JEV). Live reports record
 *   0.97-0.99 for genuinely cited findings; the old inline `p_cited < 1`
 *   dropped all of them.
 * - A live-Jev failure (client error, no answer for a finding) FAILS OPEN to
 *   the naive implementation and is recorded on the pp-kept record; it is
 *   never a thrown step (dex would retry it and re-bill the batch).
 * - The gate's p_cited is persisted for kept and dropped findings.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Context } from "@superdurable/dex";

import {
  citationKept,
  markerKeyOf,
  ppConfig,
  ppDiff,
  ppJevUsage,
  ppKept,
  ppPrepDiff,
  ppPrepFindings,
  ppPrepState,
  ppPrepVerdict,
  ppVerdict,
  PortFileFlow,
  PortProjectFlow,
  type CapturedDiff,
  type FileRoundInput,
  type KeptFindings,
  type PortRunInput,
  type ReviewTuple,
} from "../flows/port-project.js";
import { configurePortJudgment } from "../flows/runtime-hooks.js";
import { DIFF_HEADER_LINES } from "../src/harness/runtime.js";
import { CITATION_MIN_P_JEV, CITATION_MIN_P_NAIVE } from "../src/judgment-registry.js";
import type { Finding, DiffDocument, VerdictRecord } from "../src/metrics/types.js";
import {
  createInMemoryJevClient,
  type JudgmentClient,
  type SystemOneRequest,
  type SystemOneResult,
} from "../src/typesafe/client.js";

// ---------------------------------------------------------------------------
// Harness (stub dex Context that enforces declared attribute loads)
// ---------------------------------------------------------------------------

type Stores = Map<unknown, Map<string, unknown>>;

function ctxFor(
  stores: Stores,
  step: { getStepOptions?: () => unknown },
): Context {
  const options = step.getStepOptions?.() as { executeLoadAttributeMaps?: readonly unknown[] } | undefined;
  const declared = options?.executeLoadAttributeMaps ?? [];
  return {
    attempt: 1,
    flowId: "t2-lane-b",
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

function put(stores: Stores, attr: unknown, key: string, value: unknown): void {
  let store = stores.get(attr);
  if (store === undefined) {
    store = new Map();
    stores.set(attr, store);
  }
  store.set(key, value);
}

function get<T>(stores: Stores, attr: unknown, key: string): T | undefined {
  return stores.get(attr)?.get(key) as T | undefined;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DIFF_RAW = `diff --git a/src/money.ts b/src/money.ts
new file mode 100644
--- /dev/null
+++ b/src/money.ts
@@ -0,0 +1,4 @@
+export class Money {
+  constructor(readonly cents: number) {}
+  add(other: Money): Money {
+    return new Money(this.cents + other.cents);
+  }
+}`;

const DIFF_DOC: DiffDocument = {
  diff_id: "diff-f-r1",
  file: "src/Money.php",
  base_ref: "HEAD",
  hunks: [
    {
      hunk_id: "h1",
      header: "@@ -0,0 +1,4 @@",
      old_start: 0,
      old_lines: 0,
      new_start: 1,
      new_lines: 4,
      lines: [
        "+export class Money {",
        "+  constructor(readonly cents: number) {}",
        "+  add(other: Money): Money {",
        "+    return new Money(this.cents + other.cents);",
        "+  }",
        "+}",
      ],
    },
  ],
};

const FILE = "src/Money.php";
const KEY = markerKeyOf(FILE, 1);
const FRI: FileRoundInput = {
  repoRoot: "/tmp/lane-b",
  worktreeRoot: "/tmp/lane-b/.wt",
  integrationWorktreePath: "/tmp/lane-b/.wt/integration",
  sourceRoot: "/tmp/lane-b/src",
  epoch: 1,
  file: FILE,
  round: 1,
  worktreePath: "/tmp/lane-b/.wt/money-1",
  branch: "lease/money/1",
};

const DIFF_ATTR: CapturedDiff = {
  diffId: "diff-f-r1",
  raw: DIFF_RAW,
  doc: DIFF_DOC,
  bodyLineOffset: DIFF_HEADER_LINES,
};

const CITED_QUOTE = "add(other: Money): Money {";
const UNCITED_QUOTE = "this line is nowhere in the diff";

function finding(id: string, quote: string, severity: Finding["severity"] = "major"): Finding {
  return {
    finding_id: id,
    severity,
    summary: `summary ${id}`,
    evidence: { hunk_id: "h1", start_line: 8, end_line: 8, quote },
  };
}

function tuple(reviewer: string, findings: Finding[], round = 1, file = FILE): ReviewTuple {
  const metrics: VerdictRecord = {
    file,
    reviewer,
    round,
    diff_id: "diff-f-r1",
    findings,
    citation_check: [],
  };
  return {
    agent: {
      file,
      reviewer,
      round,
      diff_id: "diff-f-r1",
      findings: findings.map((f) => ({
        finding_id: f.finding_id,
        severity: f.severity,
        description: f.summary,
        evidence_span: { start_line: 13, end_line: 13, snippet: f.evidence?.quote ?? "" },
        disposition: "fix" as const,
      })),
      citation_check: [],
    },
    metrics,
  };
}

function gateStores(a: Finding[], b: Finding[]): Stores {
  const stores: Stores = new Map();
  put(stores, ppDiff, KEY, DIFF_ATTR);
  put(stores, ppVerdict, `${KEY}#reviewer-A`, tuple("reviewer-A", a));
  put(stores, ppVerdict, `${KEY}#reviewer-B`, tuple("reviewer-B", b));
  return stores;
}

/** A REAL-kind (billed) client double: scripted noul answers, counts calls. */
function realClient(
  score: (findingId: string) => number | "missing",
  options: { throwOnCall?: number } = {},
): JudgmentClient & { calls: number } {
  const client = {
    kind: "real" as const,
    calls: 0,
    systemOne: async (request: SystemOneRequest): Promise<SystemOneResult> => {
      client.calls += 1;
      if (options.throwOnCall !== undefined && client.calls >= options.throwOnCall) {
        throw new Error("jev unavailable (simulated outage)");
      }
      const answers: Record<string, { type: "noul"; noul: number }> = {};
      for (const name of Object.keys(request.questions)) {
        const s = score(name);
        if (s !== "missing") answers[name] = { type: "noul", noul: s };
      }
      return {
        model: "jev-double",
        answers: answers as never,
        usage: { input_tokens: 10, output_tokens: 5 },
      };
    },
  };
  return client as unknown as JudgmentClient & { calls: number };
}

let warnings: string[] = [];
const originalWarn = console.warn;

beforeEach(() => {
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
});

afterEach(() => {
  console.warn = originalWarn;
  // A real-kind seam must never leak into other test files (one process).
  configurePortJudgment(createInMemoryJevClient());
});

const flow = new PortFileFlow();

// ---------------------------------------------------------------------------
// The threshold
// ---------------------------------------------------------------------------

describe("citationKept: one named threshold per checker kind", () => {
  test("constants: naive is binary, live Jev floor sits under the observed 0.97+ and well over a coin flip", () => {
    expect(CITATION_MIN_P_NAIVE).toBe(1);
    expect(CITATION_MIN_P_JEV).toBe(0.8);
  });

  test("naive and naive-fallback keep only a full citation", () => {
    for (const checker of ["naive", "naive-fallback"] as const) {
      expect(citationKept(1, checker)).toBe(true);
      expect(citationKept(0.99, checker)).toBe(false);
      expect(citationKept(0, checker)).toBe(false);
    }
  });

  test("live Jev keeps the 0.97-0.99 scores its own reports record, drops clear non-citations", () => {
    expect(citationKept(0.99, "jev")).toBe(true);
    expect(citationKept(0.97, "jev")).toBe(true);
    expect(citationKept(CITATION_MIN_P_JEV, "jev")).toBe(true);
    expect(citationKept(0.79, "jev")).toBe(false);
    expect(citationKept(0.6, "jev")).toBe(false); // a paraphrased / invented quote is not kept
    expect(citationKept(0.2, "jev")).toBe(false);
    expect(citationKept(Number.NaN, "jev")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// VerdictCheckStep
// ---------------------------------------------------------------------------

describe("VerdictCheckStep: live Jev scores", () => {
  test("a finding scored 0.97 by Jev is KEPT; one scored 0.2 is dropped with its score; scores and checker are persisted", async () => {
    const jev = realClient((id) => (id === "A1" ? 0.97 : 0.2));
    configurePortJudgment(jev);
    const stores = gateStores([finding("A1", CITED_QUOTE), finding("A2", UNCITED_QUOTE)], []);

    const decision = await flow.verdictCheck.execute(ctxFor(stores, flow.verdictCheck) as never, FRI);
    expect(decision.kind).toBe("next");

    const record = get<KeptFindings>(stores, ppKept, KEY);
    expect(record?.findings.map((f) => f.finding_id)).toEqual(["A1"]);
    expect(record?.dropped).toEqual([
      { finding_id: "A2", reviewer: "reviewer-A", reason: "citation check failed (p_cited=0.2)", p_cited: 0.2 },
    ]);
    const gateA = record?.citationGate?.find((g) => g.reviewer === "reviewer-A");
    expect(gateA?.checker).toBe("jev");
    expect(gateA?.fallbackReason).toBeNull();
    expect(gateA?.scores).toEqual([
      { finding_id: "A1", p_cited: 0.97 },
      { finding_id: "A2", p_cited: 0.2 },
    ]);
    // Live spend is evidence-recorded (one call: 10 + 5 tokens).
    const usage = get<Array<{ stepId: string; tokens: number }>>(stores, ppJevUsage, "usage");
    expect(usage?.map((u) => u.tokens)).toEqual([15]);
  });

  test("a finding the naive checker would drop (p 0.97 < 1) survives under live Jev", async () => {
    configurePortJudgment(realClient(() => 0.97));
    // UNCITED_QUOTE scores 0 naively; under Jev the probability is what counts.
    const stores = gateStores([finding("A1", UNCITED_QUOTE)], []);
    await flow.verdictCheck.execute(ctxFor(stores, flow.verdictCheck) as never, FRI);
    expect(get<KeptFindings>(stores, ppKept, KEY)?.findings.map((f) => f.finding_id)).toEqual(["A1"]);
  });
});

describe("VerdictCheckStep: live Jev failure fails open to the naive check", () => {
  test("systemOne throwing does not throw the step; naive scores gate the findings and the degradation is recorded", async () => {
    configurePortJudgment(realClient(() => 0.99, { throwOnCall: 1 }));
    const stores = gateStores([finding("A1", CITED_QUOTE), finding("A2", UNCITED_QUOTE)], []);

    const decision = await flow.verdictCheck.execute(ctxFor(stores, flow.verdictCheck) as never, FRI);
    expect(decision.kind).toBe("next");

    const record = get<KeptFindings>(stores, ppKept, KEY);
    // Naive semantics apply: cited quote kept (1), uncited quote dropped (0).
    expect(record?.findings.map((f) => f.finding_id)).toEqual(["A1"]);
    expect(record?.dropped.map((d) => d.finding_id)).toEqual(["A2"]);
    const gateA = record?.citationGate?.find((g) => g.reviewer === "reviewer-A");
    expect(gateA?.checker).toBe("naive-fallback");
    expect(gateA?.fallbackReason).toContain("jev unavailable");
    expect(gateA?.scores).toEqual([
      { finding_id: "A1", p_cited: 1 },
      { finding_id: "A2", p_cited: 0 },
    ]);
    // Failing open is not silent: the degradation is logged for the operator.
    expect(warnings.filter((w) => w.includes("[lane-b] live Jev failed") && w.includes("jev unavailable"))).toHaveLength(1);
  });

  test("a missing answer for a finding (jevCitationCheck throws) also fails open", async () => {
    configurePortJudgment(realClient((id) => (id === "A2" ? "missing" : 0.99)));
    const stores = gateStores([finding("A1", CITED_QUOTE), finding("A2", UNCITED_QUOTE)], []);

    const decision = await flow.verdictCheck.execute(ctxFor(stores, flow.verdictCheck) as never, FRI);
    expect(decision.kind).toBe("next");
    const gateA = get<KeptFindings>(stores, ppKept, KEY)?.citationGate?.find((g) => g.reviewer === "reviewer-A");
    expect(gateA?.checker).toBe("naive-fallback");
    expect(gateA?.fallbackReason).toContain("no answer returned");
  });

  test("tokens spent before the failure are still recorded (reviewer A ok, reviewer B outage)", async () => {
    // First call (reviewer A) succeeds; the second (reviewer B) throws.
    configurePortJudgment(realClient(() => 0.99, { throwOnCall: 2 }));
    const stores = gateStores([finding("A1", CITED_QUOTE)], [finding("B1", CITED_QUOTE)]);

    await flow.verdictCheck.execute(ctxFor(stores, flow.verdictCheck) as never, FRI);
    const record = get<KeptFindings>(stores, ppKept, KEY);
    expect(record?.citationGate?.map((g) => [g.reviewer, g.checker])).toEqual([
      ["reviewer-A", "jev"],
      ["reviewer-B", "naive-fallback"],
    ]);
    expect(record?.findings.map((f) => f.finding_id).sort()).toEqual(["A1", "B1"]);
    const usage = get<Array<{ tokens: number }>>(stores, ppJevUsage, "usage");
    expect(usage?.map((u) => u.tokens)).toEqual([15]);
  });
});

describe("VerdictCheckStep: no live client keeps the naive default", () => {
  test("naive scores are persisted with checker 'naive' and apply the binary threshold", async () => {
    const stores = gateStores([finding("A1", CITED_QUOTE), finding("A2", UNCITED_QUOTE)], []);
    await flow.verdictCheck.execute(ctxFor(stores, flow.verdictCheck) as never, FRI);
    const record = get<KeptFindings>(stores, ppKept, KEY);
    expect(record?.findings.map((f) => f.finding_id)).toEqual(["A1"]);
    expect(record?.dropped).toEqual([
      { finding_id: "A2", reviewer: "reviewer-A", reason: "citation check failed (p_cited=0)", p_cited: 0 },
    ]);
    const gateA = record?.citationGate?.find((g) => g.reviewer === "reviewer-A");
    expect(gateA?.checker).toBe("naive");
    expect(gateA?.fallbackReason).toBeNull();
    expect(get(stores, ppJevUsage, "usage")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// PrioritizeStep
// ---------------------------------------------------------------------------

describe("PrioritizeStep: live rerank with naive fail-open", () => {
  const kept: KeptFindings = {
    findings: [finding("F1", CITED_QUOTE, "nit"), finding("F2", CITED_QUOTE, "blocker"), finding("F3", CITED_QUOTE, "major")],
    dropped: [],
  };

  function prioritizeStores(): Stores {
    const stores: Stores = new Map();
    put(stores, ppKept, KEY, structuredClone(kept));
    return stores;
  }

  test("live Jev order is applied and recorded with its token spend", async () => {
    // Jev thinks the nit is the real defect.
    configurePortJudgment(realClient((id) => (id === "F1" ? 0.9 : 0.1)));
    const stores = prioritizeStores();
    const decision = await flow.prioritize.execute(ctxFor(stores, flow.prioritize) as never, FRI);
    expect(decision.kind).toBe("next");
    const record = get<KeptFindings>(stores, ppKept, KEY);
    expect(record?.findings[0]?.finding_id).toBe("F1");
    expect(record?.prioritize).toEqual({ checker: "jev", fallbackReason: null });
    expect(get<Array<{ tokens: number }>>(stores, ppJevUsage, "usage")?.map((u) => u.tokens)).toEqual([15]);
  });

  test("a Jev outage falls back to severity order and is recorded, never thrown", async () => {
    configurePortJudgment(realClient(() => 0.5, { throwOnCall: 1 }));
    const stores = prioritizeStores();
    const decision = await flow.prioritize.execute(ctxFor(stores, flow.prioritize) as never, FRI);
    expect(decision.kind).toBe("next");
    const record = get<KeptFindings>(stores, ppKept, KEY);
    expect(record?.findings.map((f) => f.finding_id)).toEqual(["F2", "F3", "F1"]); // blocker, major, nit
    expect(record?.prioritize?.checker).toBe("naive-fallback");
    expect(record?.prioritize?.fallbackReason).toContain("jev unavailable");
    expect(warnings.some((w) => w.includes("[lane-b] live Jev failed"))).toBe(true);
  });

  test("a missing answer falls back to severity order", async () => {
    configurePortJudgment(realClient((id) => (id === "F3" ? "missing" : 0.5)));
    const stores = prioritizeStores();
    await flow.prioritize.execute(ctxFor(stores, flow.prioritize) as never, FRI);
    const record = get<KeptFindings>(stores, ppKept, KEY);
    expect(record?.prioritize?.checker).toBe("naive-fallback");
    expect(record?.findings.map((f) => f.finding_id)).toEqual(["F2", "F3", "F1"]);
  });

  test("no live client: naive order, checker 'naive'", async () => {
    const stores = prioritizeStores();
    await flow.prioritize.execute(ctxFor(stores, flow.prioritize) as never, FRI);
    const record = get<KeptFindings>(stores, ppKept, KEY);
    expect(record?.findings.map((f) => f.finding_id)).toEqual(["F2", "F3", "F1"]);
    expect(record?.prioritize).toEqual({ checker: "naive", fallbackReason: null });
  });
});

// ---------------------------------------------------------------------------
// PrepVerdictCheckStep (naive-only gate, same predicate)
// ---------------------------------------------------------------------------

describe("PrepVerdictCheckStep: naive-only gate through the shared predicate", () => {
  const PREP_KEY = markerKeyOf("PORTING.spec.md", 0);
  const parent = new PortProjectFlow();
  const runInput: PortRunInput = {
    repoRoot: "/tmp/lane-b",
    worktreeRoot: "/tmp/lane-b/.wt",
    integrationWorktreePath: "/tmp/lane-b/.wt/integration",
    sourceRoot: "/tmp/lane-b/src",
    epoch: 1,
    prepPath: "/tmp/lane-b/stub-prep.md",
    files: [FILE],
    maxRounds: 2,
  };

  test("never consults a live client; scores persisted as checker 'naive'", async () => {
    const jev = realClient(() => 0.99);
    configurePortJudgment(jev);
    const stores: Stores = new Map();
    put(stores, ppPrepDiff, "diff", { raw: DIFF_RAW, doc: DIFF_DOC, diffId: "diff-f-r1", bodyLineOffset: DIFF_HEADER_LINES, iteration: 0 });
    put(stores, ppPrepState, "state", { prepIteration: 0 });
    put(stores, ppConfig, "config", { maxRounds: 2, prepMaxRounds: 2 });
    put(stores, ppPrepVerdict, `${PREP_KEY}#reviewer-A`, tuple("reviewer-A", [finding("A1", CITED_QUOTE), finding("A2", UNCITED_QUOTE)], 0, "PORTING.spec.md"));
    put(stores, ppPrepVerdict, `${PREP_KEY}#reviewer-B`, tuple("reviewer-B", [], 0, "PORTING.spec.md"));

    const decision = await parent.prepVerdictCheck.execute(ctxFor(stores, parent.prepVerdictCheck) as never, runInput);
    expect(decision.kind).toBe("next");
    expect(jev.calls).toBe(0);
    const record = get<KeptFindings>(stores, ppPrepFindings, "findings");
    expect(record?.findings.map((f) => f.finding_id)).toEqual(["A1"]);
    expect(record?.dropped).toEqual([
      { finding_id: "A2", reviewer: "reviewer-A", reason: "citation check failed (p_cited=0)", p_cited: 0 },
    ]);
    expect(record?.citationGate?.every((g) => g.checker === "naive")).toBe(true);
  });
});
