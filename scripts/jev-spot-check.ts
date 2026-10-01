/**
 * jev-spot-check — plan Phase 3 measurable: per-symbol type selection via
 * LIVE Jev (System One) audited against ground truth derived from the
 * fixture's documented types/behaviors (FIXTURES.md + the misleading-docblock
 * list + the PHP sources themselves). Target: >= 90% over n >= 30 symbols AND
 * a margin over the deterministic first-candidate baseline (the offline
 * double already scores 92-95%; see src/typesafe/spot-check.ts).
 *
 * The ground truth, grading rubric and gate logic live in
 * src/typesafe/spot-check.ts (unit tested). Symbols are harvested with the
 * PRODUCTION cap (SYMBOL_HARVEST_CAP), so the graded set is the set the port
 * flow actually sends to Jev.
 *
 * Usage: bun run scripts/jev-spot-check.ts [--out /tmp/jev-spot-check.json]
 * Requires TYPESAFE_API_KEY (real billed System One calls) — refuses to run
 * offline so the measured path is the live path.
 *
 * Argument handling is the shared layer in src/cli/args.ts (option table:
 * JEV_SPOT_CHECK_CLI, `--help` prints the generated usage). A bad argument is
 * a usage error (exit 64), distinct from the BLOCKED exit 2.
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { envString } from "../src/env.js";
import {
  type CliParse,
  CLI_EXIT,
  defineCli,
  exitCodesNote,
  parseOptions,
  reportParseFailure,
} from "../src/cli/args.js";
import { harvestPhpSymbols } from "../src/harness/runtime.js";
import { selectSymbolType, type PhpSymbol } from "../src/typesafe/symbol-types.js";
import { createRealJevClient, isTypesafeOffline } from "../src/typesafe/client.js";
import {
  BASELINE_MARGIN,
  GROUND_TRUTH,
  SPOT_CHECK_TARGET,
  firstCandidateBaseline,
  spotCheckVerdict,
} from "../src/typesafe/spot-check.js";

const SRC_ROOT = join(import.meta.dir, "..", "fixtures", "php-sample", "src");

const DEFAULT_OUT_PATH = "/tmp/jev-spot-check.json";

/** Exit codes of jev-spot-check. */
export const JEV_SPOT_CHECK_EXIT = {
  pass: 0,
  /** The measured accuracy missed the gate, or a fatal error. */
  fail: 1,
  /** Offline, no API key, or fewer than 30 graded symbols: nothing was measured. */
  blocked: 2,
  usage: CLI_EXIT.usage,
} as const;

/** The CLI's option table: parsing, validation and the usage text all come from it. */
export const JEV_SPOT_CHECK_CLI = defineCli({
  name: "jev-spot-check.ts",
  summary:
    "Grades live Jev type selection against the fixture's ground truth (needs TYPESAFE_API_KEY; real billed calls).",
  options: {
    out: { kind: "string", metavar: "path", default: DEFAULT_OUT_PATH, description: "where to write the JSON rows" },
  },
  notes: [
    exitCodesNote(JEV_SPOT_CHECK_EXIT, {
      pass: "spot-check passed",
      fail: "spot-check failed, or fatal error",
      blocked: "BLOCKED: offline, no API key, or < 30 graded symbols",
      usage: "usage error",
    }),
  ],
});

/** Strict parse of jev-spot-check's argv (without the `bun run script` prefix). */
export function parseJevSpotCheckArgs(argv: readonly string[]): CliParse<{ outPath: string }> {
  const parsed = parseOptions(JEV_SPOT_CHECK_CLI, argv);
  return parsed.ok ? { ok: true, options: { outPath: parsed.options.out } } : parsed;
}

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
  const parsed = parseJevSpotCheckArgs(process.argv.slice(2));
  if (!parsed.ok) return reportParseFailure("jev-spot-check", parsed);
  const { outPath } = parsed.options;
  if (isTypesafeOffline()) {
    console.error("TYPESAFE_OFFLINE is set — refusing: the spot-check measures the LIVE path.");
    return JEV_SPOT_CHECK_EXIT.blocked;
  }
  const key = envString("TYPESAFE_API_KEY");
  if (key === undefined) {
    console.error("TYPESAFE_API_KEY absent — live Jev spot-check BLOCKED-pending-key.");
    return JEV_SPOT_CHECK_EXIT.blocked;
  }
  const client = await createRealJevClient({ apiKey: key });

  const symbols: PhpSymbol[] = [];
  for (const file of listPhpFiles(SRC_ROOT)) {
    const rel = file.slice(SRC_ROOT.length + 1);
    symbols.push(...harvestPhpSymbols(rel, readFileSync(file, "utf8")));
  }
  const graded = symbols.filter((s) => GROUND_TRUTH[`${s.file}#${s.name}`] !== undefined);
  console.log(`harvested ${symbols.length} symbols; ${graded.length} graded (ground truth available)`);
  if (graded.length < 30) {
    console.error(`BLOCKED: only ${graded.length} graded symbols (need >= 30)`);
    return JEV_SPOT_CHECK_EXIT.blocked;
  }

  // Deterministic first-candidate baseline over the SAME graded set (no model,
  // no key): the live score only counts if it clears this by a margin.
  const baseline = firstCandidateBaseline(graded);
  console.log(
    `first-candidate baseline: ${baseline.correct}/${baseline.graded} = ${(baseline.accuracy * 100).toFixed(1)}% (live must exceed it by ${(BASELINE_MARGIN * 100).toFixed(0)} points)`,
  );

  let correct = 0;
  const rows: Array<Record<string, unknown>> = [];
  // US-005 (fix-wave finding 5): band/strong-fail classification over the
  // four VERIFICATION-cascade nouls only (recall/none/choice-confidence
  // escalations have no noul p to classify).
  const BAND_LOW = 0.3;
  const BAND_HIGH = 0.7;
  const STRONG_FAIL_BELOW = 0.8;
  for (const symbol of graded) {
    const decision = await selectSymbolType(client, symbol);
    const accepted = [...(GROUND_TRUTH[`${symbol.file}#${symbol.name}`] ?? [])];
    const hit = accepted.includes(decision.selected);
    if (hit) correct += 1;
    // The cascade noul probabilities are PRESERVED per row (check/p/flagged)
    // so band and strong-fail rates are recomputable from the artifact.
    const checks = decision.checks.map((c) => ({ check: c.check, p: c.p, flagged: c.flagged }));
    const bandHit = checks.some((c) => c.p >= BAND_LOW && c.p <= BAND_HIGH);
    const strongFailHit = checks.some((c) => c.p < STRONG_FAIL_BELOW);
    rows.push({
      file: symbol.file,
      symbol: symbol.name,
      selected: decision.selected,
      accepted,
      correct: hit,
      flagged: decision.flagged,
      checks,
      band_hit: bandHit,
      strong_fail_hit: strongFailHit,
      escalations: decision.escalations.map((e) => e.check),
    });
    console.log(
      `${hit ? "PASS" : "MISS"} ${symbol.file}#${symbol.name} → ${decision.selected}${decision.flagged ? " (flagged)" : ""}${bandHit ? " [band]" : ""}${strongFailHit ? " [strong-fail]" : ""}`,
    );
  }
  const score = correct / rows.length;
  const verdict = spotCheckVerdict({ accuracy: score, baseline: baseline.accuracy });
  // US-005 (AC-S): uncertain-band and strong-fail rates, reported separately.
  // A band hit = any cascade noul p in [0.30, 0.70]; strong-fail = p < 0.8.
  const bandRate = rows.filter((r) => r.band_hit).length / rows.length;
  const strongFailRate = rows.filter((r) => r.strong_fail_hit).length / rows.length;
  const summary = {
    generatedAt: new Date().toISOString(),
    model: "typesafe-system-one",
    graded: rows.length,
    correct,
    accuracy: Number(score.toFixed(4)),
    target: SPOT_CHECK_TARGET,
    baseline_first_candidate: Number(baseline.accuracy.toFixed(4)),
    baseline_margin: BASELINE_MARGIN,
    required_accuracy: Number(verdict.required.toFixed(4)),
    pass: verdict.pass,
    fail_reasons: verdict.reasons,
    escalation_rate: rows.filter((r) => r.flagged).length / rows.length,
    band_rate: bandRate,
    strong_fail_rate: strongFailRate,
    band_definition: `any verification-cascade noul p in [${BAND_LOW}, ${BAND_HIGH}]`,
    strong_fail_definition: `any verification-cascade noul p < ${STRONG_FAIL_BELOW}`,
    escalations_by_check: rows.reduce<Record<string, number>>((acc, r) => {
      const names = (r.escalations as string[] | undefined) ?? [];
      for (const c of names) acc[c] = (acc[c] ?? 0) + 1;
      return acc;
    }, {}),
  };
  writeFileSync(outPath, JSON.stringify({ summary, rows }, null, 2));
  console.log(
    `SPOT-CHECK: ${correct}/${rows.length} = ${(score * 100).toFixed(1)}% (required ${(verdict.required * 100).toFixed(1)}%: >= ${(SPOT_CHECK_TARGET * 100).toFixed(0)}% and baseline + ${(BASELINE_MARGIN * 100).toFixed(0)} pts) → ${summary.pass ? "PASS" : "FAIL"}; rows → ${outPath}`,
  );
  for (const reason of verdict.reasons) console.log(`  FAIL: ${reason}`);
  return summary.pass ? JEV_SPOT_CHECK_EXIT.pass : JEV_SPOT_CHECK_EXIT.fail;
}

// Only run when executed directly: importing this module (tests) must not start a live, billed run.
if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error("[jev-spot-check] fatal:", err);
      process.exit(JEV_SPOT_CHECK_EXIT.fail);
    });
}
