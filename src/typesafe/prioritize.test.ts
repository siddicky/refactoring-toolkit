import { describe, expect, test } from "bun:test";
import {
  createJevPrioritizer,
  createNaivePrioritizer,
  jevPrioritize,
  naivePrioritize,
  type FindingPrioritizer,
} from "./prioritize.js";
import { createInMemoryJevClient } from "./client.js";
import type { Finding } from "../metrics/types.js";

function f(id: string, severity: Finding["severity"]): Finding {
  return { finding_id: id, severity, summary: `summary ${id}`, evidence: null };
}

describe("naivePrioritize (severity-class ordering)", () => {
  test("orders blocker > major > minor > nit", () => {
    const input = [f("a", "minor"), f("b", "blocker"), f("c", "nit"), f("d", "major"), f("e", "minor")];
    expect(naivePrioritize(input).map((x) => x.finding_id)).toEqual(["b", "d", "a", "e", "c"]);
  });

  test("stable within a severity class and never mutates the input", () => {
    const input = [f("x1", "nit"), f("x2", "nit"), f("x3", "blocker"), f("x4", "nit")];
    const out = naivePrioritize(input);
    expect(out.map((x) => x.finding_id)).toEqual(["x3", "x1", "x2", "x4"]);
    expect(input.map((x) => x.finding_id)).toEqual(["x1", "x2", "x3", "x4"]);
  });

  test("empty input -> empty output", () => {
    expect(naivePrioritize([])).toEqual([]);
  });
});

describe("jevPrioritize (noul rerank behind the same interface)", () => {
  test("sorts by behavior-defect probability desc, severity tie-break, then input order", async () => {
    const input = [
      f("style-1", "nit"),
      f("behavior-1", "minor"),
      f("behavior-2", "blocker"),
      f("style-2", "minor"),
    ];
    const client = createInMemoryJevClient((request) => {
      expect(Object.keys(request.questions).sort()).toEqual([
        "behavior-1",
        "behavior-2",
        "style-1",
        "style-2",
      ]);
      const p: Record<string, number> = {
        "style-1": 0.1,
        "behavior-1": 0.9,
        "behavior-2": 0.95,
        "style-2": 0.9,
      };
      const answers: Record<string, unknown> = {};
      for (const id of Object.keys(p)) answers[id] = { type: "noul", noul: p[id] };
      return answers;
    });
    const out = await jevPrioritize(client, input);
    // behavior-2 first (0.95); behavior-1 vs style-2 tie at 0.9 -> severity tie-break (blocker < minor) picks behavior-1... behavior-1 is minor, style-2 is minor -> tie-break falls to severity: equal, then input order.
    expect(out.map((x) => x.finding_id)).toEqual(["behavior-2", "behavior-1", "style-2", "style-1"]);
    expect(client.callCount).toBe(1); // single batched request
  });

  test("empty input -> empty output without any model call", async () => {
    const client = createInMemoryJevClient(() => {
      throw new Error("must not be called");
    });
    expect(await jevPrioritize(client, [])).toEqual([]);
    expect(client.callCount).toBe(0);
  });
});

describe("jevPrioritize state (C12)", () => {
  test("the judge sees the defect description AND the cited evidence, not just id + severity", async () => {
    const finding: Finding = {
      finding_id: "F1",
      severity: "major",
      summary: "add() drops the currency check",
      evidence: { hunk_id: "h1", start_line: 9, end_line: 9, quote: "return new Money(this.cents + other.cents);" },
    };
    const uncited: Finding = { finding_id: "F2", severity: "nit", summary: "naming", evidence: null };
    const client = createInMemoryJevClient(() => ({
      F1: { type: "noul", noul: 0.9 },
      F2: { type: "noul", noul: 0.1 },
    }));
    await jevPrioritize(client, [finding, uncited]);
    const state = client.requests[0]?.state as { findings: Array<Record<string, unknown>> };
    expect(state.findings[0]).toEqual({
      id: "F1",
      severity: "major",
      summary: "add() drops the currency check",
      evidence: "return new Money(this.cents + other.cents);",
    });
    expect(state.findings[1]?.evidence).toBeNull();
    const question = client.requests[0]?.questions.F1 as { instructions?: string };
    expect(question.instructions).toContain("add() drops the currency check");
  });
});

describe("FindingPrioritizer interface parity (naive default, Jev swap-in)", () => {
  test("both implementations satisfy the same interface", async () => {
    const input = [f("a", "nit"), f("b", "blocker")];
    const prioritizers: FindingPrioritizer[] = [createNaivePrioritizer(), createJevPrioritizer(createInMemoryJevClient(() => ({ a: { type: "noul", noul: 0.2 }, b: { type: "noul", noul: 0.8 } })))];
    const naive = prioritizers[0];
    const jev = prioritizers[1];
    if (naive === undefined || jev === undefined) throw new Error("expected both prioritizers");
    expect(naive.kind).toBe("naive");
    expect(jev.kind).toBe("jev");
    expect((await naive.prioritize(input)).map((x) => x.finding_id)).toEqual(["b", "a"]);
    expect((await jev.prioritize(input)).map((x) => x.finding_id)).toEqual(["b", "a"]);
  });
});
