import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ESCALATION_THRESHOLD,
  literalTypeToTs,
  phpTypeToTsType,
  recallCandidates,
  selectSymbolType,
  type PhpSymbol,
} from "./symbol-types.js";
import { createInMemoryJevClient, type InMemoryResponder } from "./client.js";

function noulAnswer(p: number): Record<string, unknown> {
  return { type: "noul", noul: p };
}

const wellDocumentedSymbol: PhpSymbol = {
  name: "countItems",
  kind: "function",
  file: "src/Util/Counter.php",
  signature: "function countItems(array $items, ?int $limit = 10): int",
  docblock: "/**\n * @param {array} $items\n * @return int\n */",
  literal_usages: ['"abc"', "true", "42"],
};

describe("phpTypeToTsType (recall mapping)", () => {
  test("PHPDoc keywords map to TS equivalents", () => {
    expect(phpTypeToTsType("int")).toBe("number");
    expect(phpTypeToTsType("integer")).toBe("number");
    expect(phpTypeToTsType("float")).toBe("number");
    expect(phpTypeToTsType("bool")).toBe("boolean");
    expect(phpTypeToTsType("string")).toBe("string");
    expect(phpTypeToTsType("array")).toBe("unknown[]");
    expect(phpTypeToTsType("mixed")).toBe("unknown");
    expect(phpTypeToTsType("callable")).toBe("(...args: unknown[]) => unknown");
  });

  test("nullable, unions, indexed sugar and generics", () => {
    expect(phpTypeToTsType("?string")).toBe("string | null");
    expect(phpTypeToTsType("?float")).toBe("number | null");
    expect(phpTypeToTsType("int|string")).toBe("number | string");
    expect(phpTypeToTsType("int[]")).toBe("number[]");
    expect(phpTypeToTsType("array<string, int>")).toBe("unknown[]");
    expect(phpTypeToTsType("iterable<User>")).toBe("User[]");
    expect(phpTypeToTsType("App\\Support\\Money")).toBe("Money");
  });
});

describe("literalTypeToTs", () => {
  test("classifies literal source text", () => {
    expect(literalTypeToTs("42")).toBe("number");
    expect(literalTypeToTs("-3.14")).toBe("number");
    expect(literalTypeToTs('"abc"')).toBe("string");
    expect(literalTypeToTs("'abc'")).toBe("string");
    expect(literalTypeToTs("true")).toBe("boolean");
    expect(literalTypeToTs("false")).toBe("boolean");
    expect(literalTypeToTs("null")).toBe("null");
    expect(literalTypeToTs("[1, 2]")).toBe("unknown[]");
    expect(literalTypeToTs("someIdentifier()")).toBeNull();
  });
});

describe("recallCandidates (code-only recall)", () => {
  test("gathers candidates from docblock, signature and literals, deduped in order", () => {
    const { candidates } = recallCandidates(wellDocumentedSymbol);
    expect(candidates.map((c) => c.type)).toEqual([
      "unknown[]",
      "number",
      "number | null",
      "string",
      "boolean",
    ]);
    expect(candidates.map((c) => c.origin)).toEqual([
      "docblock",
      "docblock",
      "signature",
      "literal",
      "literal",
    ]);
  });

  test("empty recall yields no candidates", () => {
    const { candidates } = recallCandidates({
      name: "f",
      kind: "function",
      file: "f.php",
      signature: "function f($x) {",
      docblock: null,
      literal_usages: [],
    });
    expect(candidates).toEqual([]);
  });
});

describe("selectSymbolType (Choice over candidates + SDE-cascade nouls)", () => {
  test("happy path: selection accepted when all verification nouls pass", async () => {
    const responder: InMemoryResponder = (request) => {
      if ("type_selection" in request.questions) {
        return {
          type_selection: { type: "choice", choice: "number", confidence: 0.93, probabilities: { number: 0.93, NONE: 0.07 } },
        };
      }
      return {
        type_mismatch: noulAnswer(0.95),
        hallucinated: noulAnswer(0.97),
        unreasonable: noulAnswer(0.9),
        absence_wrong: noulAnswer(0.92),
      };
    };
    const client = createInMemoryJevClient(responder);
    const decision = await selectSymbolType(client, wellDocumentedSymbol);

    expect(decision.selected).toBe("number");
    expect(decision.flagged).toBe(false);
    expect(decision.escalations).toEqual([]);
    expect(decision.checks.map((c) => [c.check, c.flagged])).toEqual([
      ["type_mismatch", false],
      ["hallucinated", false],
      ["unreasonable", false],
      ["absence_wrong", false],
    ]);
    expect(client.callCount).toBe(2); // one selection request + one batched cascade
  });

  test("cascade flags and escalates when a verification noul is below threshold", async () => {
    const responder: InMemoryResponder = (request) => {
      if ("type_selection" in request.questions) {
        return { type_selection: { type: "choice", choice: "string", confidence: 0.6, probabilities: { string: 0.6 } } };
      }
      return {
        type_mismatch: noulAnswer(0.95),
        hallucinated: noulAnswer(0.9),
        unreasonable: noulAnswer(0.3),
        absence_wrong: noulAnswer(DEFAULT_ESCALATION_THRESHOLD),
      };
    };
    const client = createInMemoryJevClient(responder);
    const decision = await selectSymbolType(client, wellDocumentedSymbol);

    expect(decision.selected).toBe("string");
    expect(decision.flagged).toBe(true);
    expect(decision.escalations.length).toBe(1);
    expect(decision.escalations[0]?.check).toBe("unreasonable");
    expect(decision.escalations[0]?.p).toBeCloseTo(0.3, 5);
    expect(decision.escalations[0]?.threshold).toBe(DEFAULT_ESCALATION_THRESHOLD);
    // absence_wrong exactly AT the threshold is not flagged (strictly below only)
    expect(decision.checks.find((c) => c.check === "absence_wrong")?.flagged).toBe(false);
  });

  test("NONE escape: no cascade call, escalation record returned", async () => {
    const responder: InMemoryResponder = () => ({
      type_selection: { type: "choice", choice: "NONE", confidence: 0.55, probabilities: { NONE: 0.55 } },
    });
    const client = createInMemoryJevClient(responder);
    const decision = await selectSymbolType(client, wellDocumentedSymbol);

    expect(decision.selected).toBe("NONE");
    expect(decision.flagged).toBe(true);
    expect(decision.checks).toEqual([]);
    expect(decision.escalations.length).toBe(1);
    expect(decision.escalations[0]?.check).toBe("none_selected");
    expect(client.callCount).toBe(1); // cascade never runs for the escape
  });

  test("empty recall escalates without any model call", async () => {
    const client = createInMemoryJevClient(() => {
      throw new Error("must not be called");
    });
    const decision = await selectSymbolType(client, {
      name: "mystery",
      kind: "variable",
      file: "src/x.php",
      signature: "$mystery = $other;",
      docblock: null,
      literal_usages: [],
    });

    expect(decision.candidates).toEqual([]);
    expect(decision.selected).toBe("NONE");
    expect(decision.flagged).toBe(true);
    expect(decision.escalations[0]?.check).toBe("recall_empty");
    expect(client.callCount).toBe(0);
  });

  test("custom threshold tightens the cascade gate", async () => {
    const responder: InMemoryResponder = (request) => {
      if ("type_selection" in request.questions) {
        return { type_selection: { type: "choice", choice: "number", confidence: 0.9, probabilities: { number: 0.9 } } };
      }
      return {
        type_mismatch: noulAnswer(0.85),
        hallucinated: noulAnswer(0.95),
        unreasonable: noulAnswer(0.95),
        absence_wrong: noulAnswer(0.95),
      };
    };
    const client = createInMemoryJevClient(responder);
    const decision = await selectSymbolType(client, wellDocumentedSymbol, { escalationThreshold: 0.9 });
    expect(decision.flagged).toBe(true);
    expect(decision.escalations[0]?.check).toBe("type_mismatch");
  });
});
