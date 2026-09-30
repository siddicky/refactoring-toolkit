/**
 * Regression tests for the symbol-table contracts owned by team T4b:
 * C21 (harvest/recall defects + the spot-check oracle) and C18 (scripted
 * offline judgments are tagged, not presented as verified picks).
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SYMBOL_HARVEST_CAP,
  harvestPhpSymbols,
  harvestPhpSymbolsReport,
  renderSymbolTable,
} from "../src/harness/runtime.js";
import { phpTypeToTsType, recallCandidates, type PhpSymbol } from "../src/typesafe/symbol-types.js";
import {
  BASELINE_MARGIN,
  GROUND_TRUTH,
  SPOT_CHECK_TARGET,
  firstCandidateBaseline,
  spotCheckVerdict,
} from "../src/typesafe/spot-check.js";

const ROOT = join(import.meta.dir, "..");

function symbol(overrides: Partial<PhpSymbol>): PhpSymbol {
  return {
    name: "x",
    kind: "property",
    file: "f.php",
    signature: "",
    docblock: null,
    literal_usages: [],
    ...overrides,
  };
}

function phpFilesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".php")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// ---------------------------------------------------------------------------
// C21 — recall
// ---------------------------------------------------------------------------

describe("C21: docblock recall keeps balanced generics whole", () => {
  test("`@return array<int, string>` is one candidate (unknown[]), not the truncated `array<int,`", () => {
    const { candidates } = recallCandidates(
      symbol({ name: "tags", kind: "method", signature: "public function tags()", docblock: "@return array<int, string>" }),
    );
    expect(candidates).toEqual([{ type: "unknown[]", origin: "docblock" }]);
  });

  test("generics with spaces, unions around them and trailing prose", () => {
    const docs = "@param array<string, int> $map the lookup\n@param list<Money>|null $xs\n@return array{id: int, name: string}";
    const types = recallCandidates(symbol({ kind: "function", signature: "function f($map, $xs)", docblock: docs })).candidates.map(
      (c) => c.type,
    );
    expect(types).toEqual(["unknown[]", "Money[] | null", "Record<string, unknown>"]);
    for (const t of types) expect(t).not.toMatch(/[<{,]$/);
  });

  test("the `{int}` brace form and plain tokens still work", () => {
    const docs = "@param {int} $a\n@param string $b\n@return int[]";
    const types = recallCandidates(symbol({ kind: "function", signature: "function f($a, $b)", docblock: docs })).candidates.map(
      (c) => c.type,
    );
    expect(types).toEqual(["number", "string", "number[]"]);
  });
});

describe("C21: signature recall ignores declaration modifiers", () => {
  test("an untyped `private $name;` yields NO candidate (was: `private`)", () => {
    for (const sig of ["private $name;", "public $name;", "protected static $count;", "private $name; — @var string"]) {
      const types = recallCandidates(symbol({ signature: sig })).candidates.map((c) => c.type);
      expect(types).not.toContain("private");
      expect(types).not.toContain("public");
      expect(types).not.toContain("protected");
      expect(types).not.toContain("static");
    }
    expect(recallCandidates(symbol({ signature: "private $name;" })).candidates).toEqual([]);
  });

  test("typed properties and `: static` returns keep their real types", () => {
    expect(recallCandidates(symbol({ signature: "private ?Money $amount;" })).candidates.map((c) => c.type)).toEqual([
      "Money | null",
    ]);
    const method = recallCandidates(symbol({ kind: "method", signature: "public static function create(int $n): static {" }));
    expect(method.candidates.map((c) => c.type)).toEqual(["number", "this"]);
  });
});

// ---------------------------------------------------------------------------
// C21 — harvest
// ---------------------------------------------------------------------------

describe("C21: harvestPhpSymbols ignores comments", () => {
  test("a function mentioned inside a docblock is not a symbol (was: phantom `helper`)", () => {
    const src = [
      "<?php",
      "/** docs mention function helper(x) here */",
      "class A {",
      "    /**",
      "     * Also see function other(y) in the manual.",
      "     */",
      "    public function real(int $x): int { return $x; } // function trailing(z)",
      "    // function commented(q)",
      "    # function hashed(q)",
      "}",
    ].join("\n");
    expect(harvestPhpSymbols("A.php", src).map((s) => s.name)).toEqual(["real"]);
  });
});

describe("C21: the symbol cap is shared and its truncation is visible", () => {
  const manyMethods = ["<?php", "class Big {", ...Array.from({ length: 25 }, (_, i) => `    public function m${i}(int $a): int { return $a; }`), "}"].join("\n");

  test("the default cap is the shared production constant and the harvest reports what it cut", () => {
    const report = harvestPhpSymbolsReport("Big.php", manyMethods);
    expect(report.symbols.length).toBe(SYMBOL_HARVEST_CAP);
    expect(report.omitted).toBe(25 - SYMBOL_HARVEST_CAP);
    expect(harvestPhpSymbols("Big.php", manyMethods).length).toBe(SYMBOL_HARVEST_CAP);
    expect(harvestPhpSymbolsReport("Big.php", manyMethods, 100).omitted).toBe(0);
  });

  test("the planner's symbol table says when a file is truncated (and stays quiet otherwise)", () => {
    const listed = harvestPhpSymbols("Big.php", manyMethods).map((s) => ({
      file: s.file,
      symbol: s.name,
      kind: s.kind,
      candidates: ["number"],
      selected: "number",
      flagged: false,
    }));
    const truncated = renderSymbolTable(listed, [{ name: "Big.php", source: manyMethods }]);
    expect(truncated).toContain(`TRUNCATED: Big.php lists ${SYMBOL_HARVEST_CAP} of 25 harvested symbols`);
    expect(truncated).toContain("NO pre-computed type");
    const small = "<?php class S { public function only(): int { return 1; } }";
    const one = harvestPhpSymbols("S.php", small).map((s) => ({
      file: s.file,
      symbol: s.name,
      kind: s.kind,
      candidates: ["number"],
      selected: "number",
      flagged: false,
    }));
    expect(renderSymbolTable(one, [{ name: "S.php", source: small }])).not.toContain("TRUNCATED");
  });

  test("neither the port flow nor the spot-check hard-codes a different cap", () => {
    for (const rel of ["flows/port-project.ts", "scripts/jev-spot-check.ts"]) {
      const source = readFileSync(join(ROOT, rel), "utf8");
      expect(source).not.toMatch(/harvestPhpSymbols\([^)]*,[^)]*,\s*\d+\s*\)/);
    }
  });
});

// ---------------------------------------------------------------------------
// C21 — the spot-check oracle
// ---------------------------------------------------------------------------

describe("C21: spot-check oracle", () => {
  const fixtureRoot = join(ROOT, "fixtures", "php-sample", "src");
  const harvested: PhpSymbol[] = [];
  for (const file of phpFilesUnder(fixtureRoot)) {
    harvested.push(...harvestPhpSymbols(file.slice(fixtureRoot.length + 1), readFileSync(file, "utf8")));
  }

  test("every ground-truth key is graded at the PRODUCTION cap (the old cap of 10 skipped Money#equals/#isNegative/#__toString)", () => {
    const harvestedKeys = new Set(harvested.map((s) => `${s.file}#${s.name}`));
    expect(Object.keys(GROUND_TRUTH).filter((k) => !harvestedKeys.has(k))).toEqual([]);
    // a property and a method can share a `file#name` key, so graded symbols >= keys
    expect(firstCandidateBaseline(harvested).graded).toBeGreaterThanOrEqual(Object.keys(GROUND_TRUTH).length);
  });

  test("no recalled candidate and no accepted label is a truncated generic (`array<int,`)", () => {
    const truncated = /[<{,(]$|^[^<]*>[^<]*$/;
    for (const s of harvested) {
      for (const c of recallCandidates(s).candidates) expect([s.name, c.type, truncated.test(c.type)]).toEqual([s.name, c.type, false]);
    }
    for (const labels of Object.values(GROUND_TRUTH)) {
      for (const label of labels) expect(label).not.toMatch(/[<{,(]$/);
    }
    // the creatorex fixture's docblocks (4 symbols used to truncate) are clean too
    const creatorexRoot = join(ROOT, "fixtures", "creatorex-middleware", "src");
    for (const file of phpFilesUnder(creatorexRoot)) {
      for (const s of harvestPhpSymbols(file.slice(creatorexRoot.length + 1), readFileSync(file, "utf8"))) {
        for (const c of recallCandidates(s).candidates) expect(c.type).not.toMatch(/[<{,(]$/);
      }
    }
  });

  test("a deterministic first-candidate baseline exists over >= 30 graded symbols", () => {
    const baseline = firstCandidateBaseline(harvested);
    expect(baseline.graded).toBeGreaterThanOrEqual(30);
    expect(baseline.correct).toBeLessThanOrEqual(baseline.graded);
    expect(baseline.accuracy).toBeGreaterThan(0.5);
  });

  test("the gate needs the target AND a margin over the baseline: matching the trivial picker fails", () => {
    const baseline = firstCandidateBaseline(harvested).accuracy;
    // exactly the offline double's score is NOT a pass, even when >= 90%
    const tie = spotCheckVerdict({ accuracy: baseline, baseline });
    expect(tie.pass).toBe(false);
    expect(tie.reasons.join(" ")).toContain("baseline");
    // clearing both passes; missing either fails
    expect(spotCheckVerdict({ accuracy: 1, baseline: 0.9 }).pass).toBe(true);
    expect(spotCheckVerdict({ accuracy: 0.94, baseline: 0.93 }).pass).toBe(false); // needs baseline + margin
    expect(spotCheckVerdict({ accuracy: 0.96, baseline: 0.93 }).pass).toBe(true);
    expect(spotCheckVerdict({ accuracy: 0.85, baseline: 0.5 }).pass).toBe(false); // below the 90% target
    // a baseline so high that baseline + margin exceeds 100% still caps at 1
    expect(spotCheckVerdict({ accuracy: 1, baseline: 0.99 }).pass).toBe(true);
    expect(spotCheckVerdict({ accuracy: 1, baseline: 0.99 }).required).toBe(1);
    expect(SPOT_CHECK_TARGET).toBe(0.9);
    expect(BASELINE_MARGIN).toBeGreaterThan(0);
  });
});

describe("C21: phpTypeToTsType handles PHPStan array shapes", () => {
  test("array shapes become Record<string, unknown> and unions around them split correctly", () => {
    expect(phpTypeToTsType("array{id: int, name: string}")).toBe("Record<string, unknown>");
    expect(phpTypeToTsType("array{id: int|string}|null")).toBe("Record<string, unknown> | null");
  });
});
