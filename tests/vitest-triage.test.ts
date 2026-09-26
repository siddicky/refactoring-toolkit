/**
 * US-004 (Stage 2a): vitest triage as a DECLARED Lane-B gate.
 *
 * - classifyMany writes {failureClass, attributedFile, reason} per record at
 *   queue-build; unknown attribution collapses to the deterministic
 *   port-caused default with attributedFile null (documented).
 * - Jev route behind the FailureClassifier seam: real client when injected
 *   (TYPESAFE_API_KEY), naive path-heuristic default otherwise; usage is
 *   surfaced per call (recordJevUsage accounting happens in the flow).
 * - Fail-open: a Jev client that errors mid-batch degrades to the naive
 *   classifier — the whole batch re-runs naive, no half-Jev state persists.
 * - Consumer routing: the per-file fix-round feed (queueFixFeedForFile, used
 *   by both fix steps and the fix-wave dispatch) receives exactly the
 *   port-caused records attributed to that file.
 * - The registry (src/judgment-registry.ts) declares vitest-triage AND the
 *   pre-existing citation-check gate.
 */

import { describe, expect, test } from "bun:test";
import {
  attributedFileOfClass,
  buildVitestQueueState,
  classifyMany,
  createNaiveClassifier,
  parseVitestOutput,
  VITEST_RECORD_CAP,
  type ClassifiedVitestFailure,
  type VitestFailureRecord,
  type VitestQueueState,
} from "../src/queues/vitest-queue.js";
import { createJevFailureClassifier } from "../src/typesafe/vitest-triage.js";
import {
  createInMemoryJevClient,
  type InMemoryResponder,
  type JudgmentClient,
} from "../src/typesafe/client.js";
import { classifyVitestRecords, queueFixFeedForFile, vitestRoutedTo } from "../flows/port-project.js";
import { JUDGMENT_REGISTRY } from "../src/judgment-registry.js";

const SAMPLE = `
 FAIL  tests/discount.test.ts > PriceCalculator > applies member discount
AssertionError: expected 100 to be 90
 ❯ tests/discount.test.ts:18:26
 ❯ src/pricing/discount.ts:41:5

 FAIL  tests/discount.test.ts > PriceCalculator > rejects negative price
Error: price must be positive
 ❯ tests/discount.test.ts:30:16

 FAIL  tests/harness-selfcheck.test.ts > Reporter > renders header
TypeError: Cannot read properties of undefined
 ❯ tests/harness-selfcheck.test.ts:9:11

 FAIL  tests/orphan.test.ts > Legacy > loads
Error: module not found
`;

function record(testFile: string, testName: string, frames: string[]): VitestFailureRecord {
  return {
    testFile,
    testName,
    errorMessage: "synthetic failure",
    frames: frames.map((f, i) => ({ file: f, line: i + 1, column: 1 })),
    raw: `FAIL ${testFile} > ${testName}`,
  };
}

function choiceResponder(answer: "port_caused" | "fixture_problem" | "unknown"): InMemoryResponder {
  return () => ({
    failure_attribution: {
      type: "choice",
      choice: answer,
      confidence: 0.99,
      probabilities: { port_caused: 0.9, fixture_problem: 0.05, unknown: 0.05 },
    },
  });
}

describe("classifyMany at queue-build (US-004)", () => {
  test("writes {failureClass, attributedFile, reason} per record (naive default)", async () => {
    const records = parseVitestOutput(SAMPLE);
    expect(records.length).toBe(4);
    const classified = await classifyMany(records, createNaiveClassifier());

    expect(classified.length).toBe(4);
    const ported = classified[0]!;
    expect(ported.classification.failureClass).toBe("port-caused");
    expect(ported.classification.attributedFile).toBe("src/pricing/discount.ts");
    expect(ported.classification.reason).toContain("ported output");

    const fixture = classified[2]!;
    expect(fixture.classification.failureClass).toBe("fixture-problem");
    expect(fixture.classification.attributedFile).toBe("tests/harness-selfcheck.test.ts");

    const unknown = classified[3]!;
    // Documented deterministic default: unknown attribution -> port-caused,
    // no file to route to.
    expect(unknown.classification.failureClass).toBe("port-caused");
    expect(unknown.classification.attributedFile).toBeNull();
  });

  test("attributedFileOfClass: deterministic attribution per class, null when unmatched", () => {
    const r = record("tests/x.test.ts", "x", ["tests/x.test.ts", "src/a.ts"]);
    expect(attributedFileOfClass(r, "port-caused")).toBe("src/a.ts");
    expect(attributedFileOfClass(r, "fixture-problem")).toBe("tests/x.test.ts");
    expect(attributedFileOfClass(record("t", "t", []), "port-caused")).toBeNull();
  });

  test("unclassified builder keeps an empty classified list (shape stable)", () => {
    const state: VitestQueueState = buildVitestQueueState(parseVitestOutput(SAMPLE), 3);
    expect(state.total).toBe(4);
    expect(state.classified).toEqual([]);
    const restored = JSON.parse(JSON.stringify(state)) as VitestQueueState;
    expect(restored).toEqual(state);
  });
});

describe("Jev route behind the FailureClassifier seam (US-004)", () => {
  const records = parseVitestOutput(SAMPLE);

  test("scripted choice answers drive the class; file attribution stays deterministic", async () => {
    const client = createInMemoryJevClient(choiceResponder("port_caused"));
    const classifier = createJevFailureClassifier(client);
    const c = await classifier.classify(records[0]!);
    expect(c.failureClass).toBe("port-caused");
    expect(c.attributedFile).toBe("src/pricing/discount.ts");
    expect(c.reason).toContain("Jev triage");
    expect(client.callCount).toBe(1);

    const fixtureClient = createInMemoryJevClient(choiceResponder("fixture_problem"));
    const fc = await createJevFailureClassifier(fixtureClient).classify(records[0]!);
    expect(fc.failureClass).toBe("fixture-problem");
    // The judgment picks the bucket; the routed path is still the parsed
    // stack's fixture frame (record 0's assertion site).
    expect(fc.attributedFile).toBe("tests/discount.test.ts");
  });

  test("Jev 'unknown' collapses to the deterministic port-caused default", async () => {
    const client = createInMemoryJevClient(choiceResponder("unknown"));
    const c = await createJevFailureClassifier(client).classify(records[0]!);
    expect(c.failureClass).toBe("port-caused");
    expect(c.attributedFile).toBeNull();
    expect(c.reason).toContain("deterministic default");
  });

  test("usage is surfaced per call (recordJevUsage accounting input)", async () => {
    const client = createInMemoryJevClient(choiceResponder("port_caused"));
    const usage: number[] = [];
    const classifier = createJevFailureClassifier(client, { onUsage: (t) => usage.push(t) });
    await classifier.classify(records[0]!);
    await classifier.classify(records[1]!);
    expect(usage.length).toBe(2);
    // In-memory double: 10 input + 1 output tokens per single-question call.
    expect(usage[0]).toBe(11);
    // Surfaced usage reconciles exactly with the client's own totals.
    expect(usage.reduce((a, b) => a + b, 0)).toBe(client.inputTokens + client.outputTokens);
  });

  test("no injected client -> naive default, zero judgment calls", async () => {
    // classifyVitestRecords with jev === undefined never constructs a Jev
    // classifier; classifications come from the path heuristic.
    const state = await classifyVitestRecords(records, 1, undefined);
    expect(state.total).toBe(4);
    expect(state.classified.length).toBe(4);
    expect(state.classified[0]!.classification.attributedFile).toBe("src/pricing/discount.ts");
    expect(state.classified[3]!.classification.attributedFile).toBeNull();
  });
});

describe("fail-open: Jev unavailability degrades to the naive classifier", () => {
  const records = parseVitestOutput(SAMPLE);

  test("client that throws on every call -> naive classification, clean result", async () => {
    const hostile: JudgmentClient = {
      kind: "in-memory",
      async systemOne() {
        throw new Error("Jev provider unreachable (simulated outage)");
      },
    };
    const usage: number[] = [];
    const state = await classifyVitestRecords(records, 2, hostile, { onUsage: (t) => usage.push(t) });
    expect(state.total).toBe(4);
    expect(state.classified.length).toBe(4);
    expect(state.classified[0]!.classification.attributedFile).toBe("src/pricing/discount.ts");
    expect(state.classified[2]!.classification.failureClass).toBe("fixture-problem");
    expect(usage.length).toBe(0);
  });

  test("client that fails MID-batch: earlier usage kept, final state fully naive", async () => {
    let calls = 0;
    const flaky: JudgmentClient = {
      kind: "in-memory",
      async systemOne() {
        calls += 1;
        if (calls > 2) throw new Error("Jev flap after two calls");
        return {
          model: "in-memory-double",
          answers: {
            failure_attribution: {
              type: "choice",
              choice: "port_caused",
              confidence: 0.99,
              probabilities: { port_caused: 0.9, fixture_problem: 0.05, unknown: 0.05 },
            },
          },
          usage: { input_tokens: 10, output_tokens: 1 },
        } as never;
      },
    };
    const usage: number[] = [];
    const state = await classifyVitestRecords(records, 2, flaky, { onUsage: (t) => usage.push(t) });
    // Tokens spent BEFORE the flap are still accounted for the evidence stream.
    expect(usage.length).toBe(2);
    // But the persisted batch is wholly naive (no half-Jev state).
    for (const c of state.classified) {
      expect(c.classification.reason).not.toContain("Jev triage");
    }
    expect(state.classified[3]!.classification.attributedFile).toBeNull();
  });
});

describe("fix-round feed routes classified records to attributedFile (consumer)", () => {
  test("records reach the feed of their attributed file and no other file", async () => {
    const records = parseVitestOutput(SAMPLE);
    const state = await classifyVitestRecords(records, 1, undefined);
    const verify = {
      iteration: 1,
      fixQueue: [],
      tscTotal: 0,
      vitestTotal: state.total,
      vitestNote: null,
      lastRunAt: "2026-09-26T00:00:00.000Z",
      errors: [
        { file: "src/billing.ts", code: "TS2304", message: "Cannot find name 'X'", line: 3 },
      ],
      vitestState: state,
    };

    // The ported file implicated by record 0's stack gets BOTH the tsc error
    // and the vitest failure; the failure travels under its attributed path.
    const discountFeed = queueFixFeedForFile(verify as never, "src/pricing/discount.ts");
    expect(discountFeed.errors).toEqual([]);
    expect(discountFeed.testFailures.length).toBe(1);
    expect(discountFeed.testFailures[0]!.name).toBe(
      "tests/discount.test.ts > PriceCalculator > applies member discount",
    );
    expect(discountFeed.testFailures[0]!.message).toContain("AssertionError");

    const second = queueFixFeedForFile(verify as never, "./src/pricing/discount.ts");
    expect(second.testFailures.length).toBe(1);

    // Any other ported file: no vitest failures routed (only its tsc errors).
    const other = queueFixFeedForFile(verify as never, "src/billing.ts");
    expect(other.errors.length).toBe(1);
    expect(other.testFailures).toEqual([]);

    // Fixture-problem and unknown-attribution records reach NO per-file feed.
    for (const rel of ["tests/harness-selfcheck.test.ts", "tests/orphan.test.ts", "src/nothing.ts"]) {
      expect(queueFixFeedForFile(verify as never, rel).testFailures).toEqual([]);
    }
  });

  test("routing predicate agrees with the feed for fix-wave by-value dispatch", async () => {
    const state = await classifyVitestRecords(parseVitestOutput(SAMPLE), 1, undefined);
    const routed: ClassifiedVitestFailure[] = vitestRoutedTo(state.classified, "src/pricing/discount.ts");
    expect(routed.length).toBe(1);
    expect(routed[0]!.classification.attributedFile).toBe("src/pricing/discount.ts");
    // Old persisted states without the field behave like "no vitest state".
    expect(vitestRoutedTo(undefined, "src/pricing/discount.ts")).toEqual([]);
    expect(queueFixFeedForFile(undefined, "src/x.ts")).toEqual({ errors: [], testFailures: [] });
  });

  test("durable cap: evidence lists are bounded while total stays true", async () => {
    const many: VitestFailureRecord[] = Array.from({ length: VITEST_RECORD_CAP + 10 }, (_, i) =>
      record("tests/f.test.ts", `t${i}`, ["src/a.ts"]),
    );
    const state = await classifyVitestRecords(many, 1, undefined);
    expect(state.total).toBe(VITEST_RECORD_CAP + 10);
    expect(state.classified.length).toBe(VITEST_RECORD_CAP);
    expect(state.failures.length).toBe(VITEST_RECORD_CAP);
  });
});

describe("judgment registry (Lane-B declarations)", () => {
  test("declares vitest-triage and the pre-existing citation-check gate", () => {
    const names = JUDGMENT_REGISTRY.map((e) => e.name);
    expect(names).toContain("vitest-triage");
    expect(names).toContain("citation-check");
    expect(new Set(names).size).toBe(names.length);
  });

  test("every entry carries threshold, effect, provenance, and fail-open", () => {
    for (const entry of JUDGMENT_REGISTRY) {
      expect(entry.judgment.length).toBeGreaterThan(0);
      expect(entry.threshold.length).toBeGreaterThan(0);
      expect(entry.effect.length).toBeGreaterThan(0);
      expect(entry.provenance.length).toBeGreaterThan(0);
      expect(entry.failOpen.length).toBeGreaterThan(0);
      expect(entry.seamModule.length).toBeGreaterThan(0);
    }
  });

  test("vitest-triage is declared as the declared Lane-B gate it is", () => {
    const entry = JUDGMENT_REGISTRY.find((e) => e.name === "vitest-triage")!;
    expect(entry.judgment).toContain("failureClass");
    expect(entry.threshold).toContain("naive default");
    expect(entry.effect).toContain("attributedFile");
    expect(entry.failOpen).toContain("naive classifier");
  });

  test("citation-check declares the fixed p_cited threshold", () => {
    const entry = JUDGMENT_REGISTRY.find((e) => e.name === "citation-check")!;
    expect(entry.threshold).toContain("p_cited < 1");
    expect(entry.provenance).toContain("verdict records");
  });
});
