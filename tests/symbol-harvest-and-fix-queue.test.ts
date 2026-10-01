/**
 * Phase 3+4 unit suites (offline):
 * - deterministic PHP symbol harvest (prep-analysis input),
 * - offline Jev responder + in-memory client (BLOCKED-pending-key default),
 * - fix-queue derivation incl. the termination rule,
 * - burn-down samples match the dashboard's queue-burndown/* shape,
 * - fault injection matcher.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createOfflineJevClient,
  harvestPhpSymbols,
} from "../src/harness/runtime.js";
import {
  selectFixableFiles,
} from "../flows/port-project.js";
import { configurePortFault, faultMatches } from "../flows/runtime-hooks.js";
import { burnDownFromUnknown } from "../src/dashboard/state.js";
import type { QueueBurnDownSample } from "../flows/port-project.js";
import { REPO_ROOT } from "./support/paths.js";

const MONEY_SOURCE = readFileSync(
  join(REPO_ROOT, "fixtures", "php-sample", "src", "Money.php"),
  "utf8",
);

describe("Phase 3: deterministic PHP symbol harvest", () => {
  test("finds methods and @var properties with docblocks, capped", () => {
    const symbols = harvestPhpSymbols("src/Money.php", MONEY_SOURCE, 12);
    const names = symbols.map((s) => s.name);
    expect(names).toContain("parse");
    expect(names).toContain("add");
    expect(names).toContain("subtract");
    expect(names).toContain("percentage");
    const prop = symbols.find((s) => s.name === "amount" && s.kind === "property");
    expect(prop).toBeDefined();
    expect(prop?.docblock).toContain("float");
    const parse = symbols.find((s) => s.name === "parse");
    expect(parse?.docblock ?? "").toContain("Named constructor");
    expect(symbols.length).toBeLessThanOrEqual(12);
    for (const s of symbols) {
      expect(s.file).toBe("src/Money.php");
      expect(s.signature.length).toBeGreaterThan(0);
    }
  });

  test("cap bounds the harvest (cost guard)", () => {
    expect(harvestPhpSymbols("src/Money.php", MONEY_SOURCE, 3).length).toBe(3);
  });
});

describe("Phase 3: offline Jev resolution (BLOCKED-pending-key default)", () => {
  test("responder answers every question: choice picks a non-NONE label, nouls pass threshold", async () => {
    const client = createOfflineJevClient();
    const result = await client.systemOne({
      state: { symbol: "Money", kind: "method" },
      questions: {
        type_selection: {
          type: "choice",
          criteria: { number: "candidate a", string: "candidate b", NONE: "abstain" },
        },
        type_mismatch: { type: "noul" },
        hallucinated: { type: "noul" },
        unreasonable: { type: "noul" },
        absence_wrong: { type: "noul" },
      },
    });
    expect(result.answers.type_selection.choice).toBe("number"); // first non-NONE
    expect(result.answers.type_selection.confidence).toBeGreaterThan(0.5);
    for (const noul of ["type_mismatch", "hallucinated", "unreasonable", "absence_wrong"] as const) {
      expect(result.answers[noul].noul).toBeGreaterThan(0.8);
    }
    // The double reports usage so judgment-role envelopes keep provenance.
    expect(result.usage.input_tokens).toBeGreaterThan(0);
    expect(client.inputTokens).toBeGreaterThan(0);
  });
});

describe("Phase 4: fix-queue derivation (termination rule)", () => {
  const sourceMap = {
    "src/Money.php": { outPath: "src/money.ts" },
    "src/Pricing/FlatRateDiscount.php": { outPath: "src/pricing/flat-rate-discount.ts" },
  };
  const done = [
    { file: "src/Money.php", round: 1 },
    { file: "src/Pricing/FlatRateDiscount.php", round: 2 },
  ];

  test("errors + room in the cap → fixable at round+1", () => {
    const counts = new Map([
      ["src/money.ts", 2],
      ["src/pricing/flat-rate-discount.ts", 1],
    ]);
    const { fixable, capped } = selectFixableFiles(done, sourceMap, counts, 3);
    expect(fixable).toEqual([
      { file: "src/Money.php", fromRound: 1 },
      { file: "src/Pricing/FlatRateDiscount.php", fromRound: 2 },
    ]);
    expect(capped).toEqual([]);
  });

  test("files at the round cap move to blocked (termination by cap)", () => {
    const counts = new Map([["src/money.ts", 3]]);
    const atCap = [{ file: "src/Money.php", round: 2 }];
    const { fixable, capped } = selectFixableFiles(atCap, sourceMap, counts, 2);
    expect(fixable).toEqual([]); // Money is at round 2 = maxRounds → capped
    expect(capped).toEqual([{ file: "src/Money.php", round: 2, count: 3 }]);
  });

  test("empty queues → nothing fixable (termination by empty queues)", () => {
    const { fixable, capped } = selectFixableFiles(done, sourceMap, new Map(), 3);
    expect(fixable).toEqual([]);
    expect(capped).toEqual([]);
  });
});

describe("Phase 4: burn-down samples match the dashboard contract", () => {
  test("queue-burndown/* values parse via the dashboard's shape check", () => {
    const sample: QueueBurnDownSample = {
      queue: "tsc",
      iteration: 2,
      error_count: 3,
      file: "src/money.ts",
      recorded_at: "2026-09-25T23:59:00.000Z",
    };
    const parsed = burnDownFromUnknown(sample);
    expect(parsed).not.toBeNull();
    expect(parsed?.queue).toBe("tsc");
    expect(parsed?.error_count).toBe(3);
    expect(burnDownFromUnknown({ queue: "jest", iteration: 1, error_count: 1 })).toBeNull();
  });
});

describe("Fault injection matcher (kill smokes)", () => {
  test("exact kind:target matching only", () => {
    configurePortFault("symbol-table:post:seed");
    expect(faultMatches("symbol-table:post", "seed")).toBe(true);
    expect(faultMatches("symbol-table:post", "other")).toBe(false);
    configurePortFault(undefined);
    expect(faultMatches("symbol-table:post", "seed")).toBe(false);
  });
});
