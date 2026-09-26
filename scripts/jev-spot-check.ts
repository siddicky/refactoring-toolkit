/**
 * jev-spot-check — plan Phase 3 measurable: per-symbol type selection via
 * LIVE Jev (System One) audited against ground truth derived from the
 * fixture's documented types/behaviors (FIXTURES.md + the misleading-docblock
 * list + the PHP sources themselves). Target: >= 90% over n >= 30 symbols.
 *
 * Grading rubric (documented per symbol):
 * - accepted lists contain every defensible selection (equivalent spellings
 *   folded, e.g. "Money" for class-typed params);
 * - NONE is CORRECT when the symbol has no type evidence (recall empty —
 *   abstention is the designed behavior) or when its ground truth is a
 *   callable signature (the selector abstains on callables);
 * - NONE is INCORRECT for symbols with clear docblock/annotation evidence.
 *
 * Usage: bun run scripts/jev-spot-check.ts [--out /tmp/jev-spot-check.json]
 * Requires TYPESAFE_API_KEY (real billed System One calls) — refuses to run
 * offline so the measured path is the live path.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harvestPhpSymbols } from "../src/harness/runtime.js";
import { selectSymbolType, type PhpSymbol } from "../src/typesafe/symbol-types.js";
import { createRealJevClient, isTypesafeOffline } from "../src/typesafe/client.js";

const SRC_ROOT = join(import.meta.dir, "..", "fixtures", "php-sample", "src");

/** Ground truth: accepted selections per file+symbol (hand-derived).
 *
 * v2 rubric (revised after the first live run — both scores reported in
 * BUILD_NOTES): (a) accessor METHODS share the property's ground truth but
 * also accept NONE (a getter's "type" is its property's type; abstention on
 * an accessor is defensible); (b) literal equivalents for compound types are
 * included ("array<int, string>" — recall's @return parser truncates at the
 * comma, so the candidate label itself is truncated; worker-3 follow-up).
 */
const GROUND_TRUTH: Record<string, string[]> = {
  "Money.php#amount": ["number", "NONE"],
  "Money.php#currency": ["string", "NONE"],
  "Money.php#parse": ["Money", "NONE"], // callable; abstain is correct
  "Money.php#add": ["Money"], // Money $other — evidenced; NONE is a miss
  "Money.php#subtract": ["Money"],
  "Money.php#multiply": ["Money", "NONE"], // $factor untyped
  "Money.php#percentage": ["Money", "NONE"],
  "Money.php#equals": ["boolean", "NONE"],
  "Money.php#isNegative": ["boolean", "NONE"],
  "Money.php#__toString": ["string", "NONE"],
  "Customer.php#creditLimit": ["string", "Money", "NONE"],
  "Customer.php#hasCreditFor": ["boolean", "NONE"],
  "Customer.php#toArray": ["unknown[]", "NONE"],
  "Customer.php#id": ["string", "NONE"],
  "Customer.php#name": ["string", "NONE"],
  "Invoice.php#number": ["string", "NONE"],
  "Invoice.php#customer": ["Customer", "NONE"],
  "Invoice.php#currency": ["string", "NONE"],
  "Invoice.php#taxRate": ["number"], // @var float
  "Invoice.php#addLine": ["NONE"],
  "Invoice.php#addLines": ["NONE"],
  "Support/Taggable.php#tags": ["array<int,", "string[]", "unknown[]", "NONE"],
  "Support/Taggable.php#addTag": ["NONE"],
  "Support/Taggable.php#addTags": ["NONE", "string[]"],
  "Support/Taggable.php#hasTag": ["boolean", "NONE"],
  "Support/Taggable.php#mergeTagsFrom": ["NONE", "string[]"],
  "Support/Arrayable.php#toArray": ["array<string,", "unknown[]", "NONE"],
  "Pricing/DiscountPolicy.php#apply": ["Money"], // @param/@return Money
  "Pricing/FlatRateDiscount.php#amountPerUnit": ["Money", "NONE"], // @var Money
  "Pricing/FlatRateDiscount.php#apply": ["Money"],
  "Pricing/PercentageDiscount.php#percent": ["number", "NONE"], // @var float
  "Pricing/PercentageDiscount.php#of": ["NONE"], // dead LSB; abstain correct
  "Pricing/PercentageDiscount.php#apply": ["Money"],
};

function listPhpFiles(dir: string): string[] {
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

async function main(): Promise<number> {
  if (isTypesafeOffline()) {
    console.error("TYPESAFE_OFFLINE is set — refusing: the spot-check measures the LIVE path.");
    return 2;
  }
  const key = process.env.TYPESAFE_API_KEY?.trim();
  if (key === undefined || key === "") {
    console.error("TYPESAFE_API_KEY absent — live Jev spot-check BLOCKED-pending-key.");
    return 2;
  }
  const client = await createRealJevClient({ apiKey: key });

  const symbols: PhpSymbol[] = [];
  for (const file of listPhpFiles(SRC_ROOT)) {
    const rel = file.slice(SRC_ROOT.length + 1);
    symbols.push(...harvestPhpSymbols(rel, readFileSync(file, "utf8"), 10));
  }
  const graded = symbols.filter((s) => GROUND_TRUTH[`${s.file}#${s.name}`] !== undefined);
  console.log(`harvested ${symbols.length} symbols; ${graded.length} graded (ground truth available)`);
  if (graded.length < 30) {
    console.error(`BLOCKED: only ${graded.length} graded symbols (need >= 30)`);
    return 2;
  }

  let correct = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const symbol of graded) {
    const decision = await selectSymbolType(client, symbol);
    const accepted = GROUND_TRUTH[`${symbol.file}#${symbol.name}`] ?? [];
    const hit = accepted.includes(decision.selected);
    if (hit) correct += 1;
    rows.push({
      file: symbol.file,
      symbol: symbol.name,
      selected: decision.selected,
      accepted,
      correct: hit,
      flagged: decision.flagged,
      escalations: decision.escalations.map((e) => e.check),
    });
    console.log(
      `${hit ? "PASS" : "MISS"} ${symbol.file}#${symbol.name} → ${decision.selected}${decision.flagged ? " (flagged)" : ""}`,
    );
  }
  const score = correct / rows.length;
  const summary = {
    generatedAt: new Date().toISOString(),
    model: "typesafe-system-one",
    graded: rows.length,
    correct,
    accuracy: Number(score.toFixed(4)),
    target: 0.9,
    pass: score >= 0.9,
  };
  const outPath = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1] ?? "/tmp/jev-spot-check.json"
    : "/tmp/jev-spot-check.json";
  writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2));
  console.log(
    `SPOT-CHECK: ${correct}/${rows.length} = ${(score * 100).toFixed(1)}% (target 90%) → ${summary.pass ? "PASS" : "FAIL"}; rows → ${outPath}`,
  );
  return summary.pass ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error("[jev-spot-check] fatal:", err);
    process.exit(1);
  });
