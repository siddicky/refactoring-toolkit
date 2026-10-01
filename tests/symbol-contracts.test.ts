/**
 * Regression tests for the symbol-table contracts owned by team T4b:
 * C21 (harvest/recall defects + the spot-check oracle) and C18 (scripted
 * offline judgments are tagged, not presented as verified picks).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  SYMBOL_HARVEST_CAP,
  composePrepGenerateTurn,
  createOfflineJevClient,
  harvestPhpSymbols,
  harvestPhpSymbolsReport,
  judgmentLaneSummary,
  offlineJevResponder,
  renderSymbolTable,
  type SymbolTableRowView,
} from "../src/harness/runtime.js";
import {
  PortProjectFlow,
  ppPrepSeed,
  ppSymtab,
  type PortRunInput,
  type PrepSeedState,
  type SymbolTableRow,
} from "../flows/port-project.js";
import { configurePortJudgment } from "../flows/runtime-hooks.js";
import { stubContext, type AttributeStores } from "./support/dex-context.js";
import { portFlowFiles } from "./support/port-flow-source.js";
import { envelopeEvents } from "../flows/steps/envelope.js";
import type { EnvelopeEvent } from "../src/metrics/types.js";
import * as typesafeClientModule from "../src/typesafe/client.js";
import {
  createInMemoryJevClient,
  type InMemoryJudgmentClient,
  type JudgmentClient,
} from "../src/typesafe/client.js";
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

  test("code that shares a line with a comment is still harvested; a string like \"src/*\" does not open a comment", () => {
    const src = [
      "<?php",
      "class B {",
      "    /** @return int */ public function inlineDoc(): int { return 1; }",
      "    public function withGlob(): string { return glob(\"src/*\")[0]; }",
      "    public function afterGlob(): int { return 2; }",
      "    /* multi",
      "       line */ public function afterClose(): int { return 3; }",
      "}",
    ].join("\n");
    expect(harvestPhpSymbols("B.php", src).map((s) => s.name)).toEqual(["inlineDoc", "withGlob", "afterGlob", "afterClose"]);
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
    for (const rel of [...portFlowFiles(), "scripts/jev-spot-check.ts"]) {
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

// ---------------------------------------------------------------------------
// C18 — scripted/offline judgments are tagged, not presented as verified
// ---------------------------------------------------------------------------

function rowView(judge: SymbolTableRowView["judge"], symbolName = "add"): SymbolTableRowView {
  return {
    file: "src/Money.php",
    symbol: symbolName,
    kind: "method",
    candidates: ["Money"],
    selected: "Money",
    flagged: false,
    ...(judge !== undefined ? { judge } : {}),
  };
}

describe("C18: the planner's symbol table carries its provenance", () => {
  test("scripted rows: UNVERIFIED provenance banner + a Judge column saying scripted", () => {
    const table = renderSymbolTable([rowView("scripted")]);
    expect(table).toContain("PROVENANCE: SCRIPTED OFFLINE PICKS (UNVERIFIED)");
    expect(table).toContain("| Judge |");
    expect(table).toMatch(/\| Money \| no \| scripted \|/);
    expect(table).not.toContain("judged by the live Jev model");
  });

  test("live rows: LIVE provenance and no UNVERIFIED claim", () => {
    const table = renderSymbolTable([rowView("live")]);
    expect(table).toContain("PROVENANCE: LIVE");
    expect(table).not.toContain("UNVERIFIED");
    expect(table).toMatch(/\| Money \| no \| live \|/);
  });

  test("a mix counts as scripted; rows from before the tag are `unknown`, never claimed live", () => {
    expect(renderSymbolTable([rowView("live"), rowView("scripted", "sub")])).toContain("SCRIPTED OFFLINE PICKS");
    const legacy = renderSymbolTable([rowView(undefined)]);
    expect(legacy).toContain("PROVENANCE: not recorded");
    expect(legacy).toMatch(/\| no \| unknown \|/);
  });

  test("the prep turn no longer labels the table 'binding input' unconditionally", () => {
    const table = renderSymbolTable([rowView("scripted")]);
    const turn = composePrepGenerateTurn({ phpFiles: [], symbolTableText: table, stubPrepBaseline: "# stub" });
    expect(turn).not.toContain("treat as binding input");
    expect(turn).toContain("binding only where the Judge column says live");
    expect(turn).toContain("UNVERIFIED hints");
    expect(turn).toContain(table);
  });
});

describe("C18: one offline factory, and the lane banner names the symbol table", () => {
  test("createJevClient (the responder-less double that throws on first use) is gone; createOfflineJevClient is the offline factory", async () => {
    expect("createJevClient" in typesafeClientModule).toBe(false);
    expect(createOfflineJevClient().kind).toBe("in-memory");
  });

  test("the non-real lane summary says the symbol table consumes the SCRIPTED double; the live one names it as live", () => {
    const naive = judgmentLaneSummary("in-memory");
    expect(naive).toContain("symbol-table");
    expect(naive).toContain("SCRIPTED");
    expect(naive).toContain("UNVERIFIED");
    expect(naive).toContain("no Jev calls");
    const live = judgmentLaneSummary("real");
    expect(live).toContain("LIVE JEV");
    expect(live).toContain("symbol-table");
    expect(live).not.toContain("SCRIPTED");
  });

  test("the worker prints the summary under its JUDGMENT LANE label", () => {
    const src = readFileSync(join(ROOT, "scripts", "run-demo.ts"), "utf8");
    expect(src).toContain("JUDGMENT LANE: ${judgmentLaneSummary(judgment.kind)}");
  });
});

const RUN_INPUT: PortRunInput = {
  repoRoot: "/tmp/c18",
  worktreeRoot: "/tmp/c18/.wt",
  integrationWorktreePath: "/tmp/c18/.wt/integration",
  epoch: 1,
  sourceRoot: "/tmp/c18/src",
  prepPath: "/tmp/c18/PORTING.md",
  files: ["src/Money.php"],
  maxRounds: 2,
};

const TYPED: PhpSymbol = symbol({
  name: "add",
  kind: "method",
  file: "src/Money.php",
  signature: "public function add(Money $other): Money {",
});
const UNTYPED: PhpSymbol = symbol({ name: "mystery", kind: "method", file: "src/Money.php", signature: "function mystery($x) {" });

async function runSymbolTable(client: JudgmentClient, symbols: PhpSymbol[]) {
  configurePortJudgment(client);
  const stores: AttributeStores = new Map([
    [ppPrepSeed as unknown, new Map<string, unknown>([["seed", { stubRaw: "stub", symbols } satisfies PrepSeedState]])],
  ]);
  const decision = await new PortProjectFlow().symbolTable.execute(stubContext(stores, { flowId: "c18-flow" }), RUN_INPUT);
  const rows = (stores.get(ppSymtab as unknown)?.get("symtab") as { rows: SymbolTableRow[] } | undefined)?.rows ?? [];
  const envelopes = [...(stores.get(envelopeEvents as unknown)?.values() ?? [])] as EnvelopeEvent[];
  const completed = envelopes.find((e) => e.ended_at !== null);
  return { decision, rows, completed };
}

describe("C18: SymbolTableStep tags rows by client kind and excludes scripted tokens", () => {
  afterEach(() => {
    configurePortJudgment(createInMemoryJevClient());
  });

  test("the offline scripted double -> rows tagged scripted, judgment envelope tokens are 0 (not the synthetic counts, not an invented 1)", async () => {
    const offline = createOfflineJevClient();
    const { decision, rows, completed } = await runSymbolTable(offline, [TYPED, UNTYPED]);
    expect(decision.kind).toBe("next");
    expect(rows.map((r) => [r.symbol, r.judge])).toEqual([
      ["add", "scripted"],
      ["mystery", "scripted"],
    ]);
    // the double DID fabricate usage (proof the exclusion is deliberate) ...
    expect((offline as InMemoryJudgmentClient).inputTokens).toBeGreaterThan(0);
    // ... but none of it reaches the judgment-role envelope
    expect(completed?.role).toBe("judgment");
    expect(completed?.tokens).toBe(0);
  });

  test("a REAL client -> rows tagged live and the envelope carries the real usage", async () => {
    const inner = createInMemoryJevClient(offlineJevResponder);
    const real: JudgmentClient = { kind: "real", systemOne: (req) => inner.systemOne(req) };
    const { rows, completed } = await runSymbolTable(real, [TYPED, UNTYPED]);
    expect(rows.map((r) => r.judge)).toEqual(["live", "live"]);
    expect(inner.inputTokens + inner.outputTokens).toBeGreaterThan(0);
    expect(completed?.tokens).toBe(inner.inputTokens + inner.outputTokens);
  });

  test("a REAL client that made no calls (all recall-empty) reports an honest 0, not an invented 1", async () => {
    const inner = createInMemoryJevClient(offlineJevResponder);
    const real: JudgmentClient = { kind: "real", systemOne: (req) => inner.systemOne(req) };
    const { rows, completed } = await runSymbolTable(real, [UNTYPED]);
    expect(rows.map((r) => r.judge)).toEqual(["live"]);
    expect(inner.callCount).toBe(0);
    expect(completed?.tokens).toBe(0);
  });
});
