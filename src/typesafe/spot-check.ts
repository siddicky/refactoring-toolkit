/**
 * Pure logic behind scripts/jev-spot-check.ts (plan Phase 3 measurable:
 * per-symbol type selection via LIVE Jev audited against ground truth derived
 * from the fixture's documented types/behaviors). Kept here, import-safe, so
 * the oracle itself is unit tested (tests/symbol-contracts.test.ts).
 *
 * Why a baseline (audit C21): most ground-truth entries also accept NONE, so a
 * trivial deterministic picker (the first recalled candidate — exactly what the
 * offline scripted double answers) already scores 92-95%, above the 90% gate.
 * A live score therefore only means something if it CLEARS that baseline by a
 * margin; {@link spotCheckVerdict} requires it.
 *
 * Grading rubric (documented per symbol):
 * - accepted lists contain every defensible selection (equivalent spellings
 *   folded, e.g. "Money" for class-typed params);
 * - NONE is CORRECT when the symbol has no type evidence (recall empty —
 *   abstention is the designed behavior) or when its ground truth is a
 *   callable signature (the selector abstains on callables);
 * - NONE is INCORRECT for symbols with clear docblock/annotation evidence.
 */

import { recallCandidates, type PhpSymbol } from "./symbol-types.js";

/**
 * Ground truth: accepted selections per `file#symbol` (hand-derived).
 *
 * v3 rubric: (a) accessor METHODS share the property's ground truth but also
 * accept NONE (a getter's "type" is its property's type; abstention on an
 * accessor is defensible); (b) compound docblock types are accepted by their
 * REAL candidate labels only — recall keeps `array<int, string>` whole and maps
 * it to `unknown[]`, so the old truncated labels (`array<int,`) are gone and
 * can never be credited again.
 */
export const GROUND_TRUTH: Readonly<Record<string, readonly string[]>> = {
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
  "Support/Taggable.php#tags": ["string[]", "unknown[]", "NONE"],
  "Support/Taggable.php#addTag": ["NONE"],
  "Support/Taggable.php#addTags": ["NONE", "string[]"],
  "Support/Taggable.php#hasTag": ["boolean", "NONE"],
  "Support/Taggable.php#mergeTagsFrom": ["NONE", "string[]"],
  "Support/Arrayable.php#toArray": ["unknown[]", "NONE"],
  "Pricing/DiscountPolicy.php#apply": ["Money"], // @param/@return Money
  "Pricing/FlatRateDiscount.php#amountPerUnit": ["Money", "NONE"], // @var Money
  "Pricing/FlatRateDiscount.php#apply": ["Money"],
  "Pricing/PercentageDiscount.php#percent": ["number", "NONE"], // @var float
  "Pricing/PercentageDiscount.php#of": ["NONE"], // dead LSB; abstain correct
  "Pricing/PercentageDiscount.php#apply": ["Money"],
};

/** The live gate: accuracy must reach this... */
export const SPOT_CHECK_TARGET = 0.9;
/**
 * ...AND exceed the first-candidate baseline by at least this much. 2 points is
 * about one extra correct symbol at the ~39 graded: the ground truth accepts
 * NONE for most accessors, so the baseline leaves little headroom and a bigger
 * margin would be unattainable rather than discriminating.
 */
export const BASELINE_MARGIN = 0.02;

export interface BaselineScore {
  graded: number;
  correct: number;
  accuracy: number;
}

/**
 * Score of the deterministic first-candidate picker over the graded symbols:
 * the first recalled candidate, or NONE when recall is empty — exactly the
 * selection the offline scripted double makes (no model, no network). Needs
 * no API key, so the spot-check can always report it next to the live score.
 */
export function firstCandidateBaseline(
  symbols: readonly PhpSymbol[],
  groundTruth: Readonly<Record<string, readonly string[]>> = GROUND_TRUTH,
): BaselineScore {
  let graded = 0;
  let correct = 0;
  for (const symbol of symbols) {
    const accepted = groundTruth[`${symbol.file}#${symbol.name}`];
    if (accepted === undefined) continue;
    graded++;
    const pick = recallCandidates(symbol).candidates[0]?.type ?? "NONE";
    if (accepted.includes(pick)) correct++;
  }
  return { graded, correct, accuracy: graded === 0 ? 0 : correct / graded };
}

export interface SpotCheckVerdict {
  pass: boolean;
  /** The accuracy the live run had to reach: max(target, min(1, baseline + margin)). */
  required: number;
  reasons: string[];
}

/** Pass iff accuracy >= target AND accuracy >= baseline + margin (capped at 1). */
export function spotCheckVerdict(input: {
  accuracy: number;
  baseline: number;
  target?: number;
  margin?: number;
}): SpotCheckVerdict {
  const target = input.target ?? SPOT_CHECK_TARGET;
  const margin = input.margin ?? BASELINE_MARGIN;
  const overBaseline = Math.min(1, input.baseline + margin);
  const required = Math.max(target, overBaseline);
  const reasons: string[] = [];
  if (input.accuracy < target) {
    reasons.push(`accuracy ${pct(input.accuracy)} is below the ${pct(target)} target`);
  }
  if (input.accuracy < overBaseline) {
    reasons.push(
      `accuracy ${pct(input.accuracy)} does not clear the first-candidate baseline ${pct(input.baseline)} by ${pct(margin)} (needs ${pct(overBaseline)})`,
    );
  }
  return { pass: reasons.length === 0, required, reasons };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
