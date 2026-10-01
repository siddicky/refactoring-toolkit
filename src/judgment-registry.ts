/**
 * Judgment registry — the two-lane rule made enforceable (plan §Lane B).
 *
 * Lane A: judgment output NEVER reaches control flow (retry, demotion,
 * routing of turns). Enforced by import-boundary tests (e.g. Tier-1
 * turn-health: flows/** and src/git/** never import it — US-003).
 *
 * Lane B: judgment-derived classifications consumed by FIXED code thresholds
 * to route CONTENT are PERMITTED, but only when DECLARED here: every
 * Lane-B consumer lists its judgment, the fixed threshold, the routed
 * content effect, the provenance surface the decision is auditable in, and
 * its fail-open behavior. Lane-B absence (no client configured) and
 * unavailability (client error) degrade to the deterministic naive default —
 * never a hard failure — for every entry EXCEPT those whose failOpen says
 * otherwise (symbol-table-selection: a live Jev failure fails the step).
 *
 * A Lane-B consumer that is not in this registry is a review-blocking
 * defect. tests/judgment-registry.test.ts (AC-R) enforces it: every
 * seamModule path exists, and every call to a Lane-B seam constructor
 * (createCitationChecker, createJevPrioritizer, selectSymbolType,
 * createJevFailureClassifier) sits in a module the matching entry lists.
 * Lane B never cascades into Lane A: a triage classification cannot trigger
 * a lane change.
 */

import { DEFAULT_ESCALATION_THRESHOLD } from "./typesafe/symbol-types.js";

/**
 * Citation-gate keep thresholds (Lane-B "citation-check"): a finding is KEPT
 * iff its p_cited is at least the threshold of the checker that scored it.
 * The naive checker is binary ({0,1}); the live Jev checker returns a noul
 * probability (live reports record 0.97-0.99 for genuinely cited findings),
 * so demanding exactly 1 there dropped valid findings. The Jev floor is 0.8,
 * the repo's existing calibration for a passing verification noul
 * (DEFAULT_ESCALATION_THRESHOLD in src/typesafe/symbol-types.ts): well under
 * the observed 0.97+ for real citations, well over a coin flip for a
 * paraphrased or invented quote. flows/port-project.ts applies these; the
 * registry entry below is derived from them.
 */
export const CITATION_MIN_P_NAIVE = 1;
export const CITATION_MIN_P_JEV = 0.8;

/** One declared Lane-B consumer. */
export interface JudgmentRegistryEntry {
  /** Stable consumer id (test-asserted unique). */
  name: string;
  /** The judgment output consumed (question type / metric). */
  judgment: string;
  /** The FIXED code threshold applied to the judgment output. */
  threshold: string;
  /** What content the threshold routes, and where. */
  effect: string;
  /** Where the decision is auditable after the run. */
  provenance: string;
  /** Deterministic degradation when the judgment is unavailable (fail-open). */
  failOpen: string;
  /**
   * The seam module(s) the consumer is implemented behind: every file path
   * (repo-relative) that may call the seam constructor. AC-R parses the
   * `src|flows|scripts/...ts` paths out of this text.
   */
  seamModule: string;
}

/**
 * The registry. Checked in — changes are code review surface, exactly like
 * the thresholds they describe.
 */
export const JUDGMENT_REGISTRY: readonly JudgmentRegistryEntry[] = [
  {
    name: "vitest-triage",
    judgment: "failureClass Choice",
    threshold: "naive default / Jev when key",
    effect: "routes failure to attributedFile in fix-round feed",
    provenance:
      "envelope + queue attribute: pp-verify.vitestState (classified records) and pp-verify.vitestTriage (checker + fallback reason)",
    failOpen:
      "naive classifier (a mid-batch Jev failure re-runs the whole batch naive; checker 'naive-fallback' + reason recorded on pp-verify.vitestTriage and logged)",
    seamModule:
      "src/queues/vitest-queue.ts (Jev route: src/typesafe/vitest-triage.ts; wired in flows/port-project.ts classifyVitestRecords)",
  },
  {
    name: "citation-check",
    judgment: "p_cited (citation score per finding)",
    threshold: `naive checker: p_cited < ${CITATION_MIN_P_NAIVE} drops; live Jev checker: p_cited < ${CITATION_MIN_P_JEV} drops`,
    effect: "uncited findings are dropped from the kept set (never reach the fix loop or report)",
    provenance:
      "pp-kept gate records: citationGate (checker + p_cited per finding) and dropped[].p_cited; the reviewer verdict records carry only the reviewer's self-reported p_cited",
    failOpen:
      "live Jev failure or missing answer -> naive citation check (checker 'naive-fallback' + reason recorded on pp-kept); missing check record -> p_cited defaults to 0 (finding dropped; drop reason recorded)",
    seamModule:
      "src/typesafe/verdict-check.ts (threshold applied in flows/port-project.ts citationKept / runCitationGate)",
  },
  {
    name: "prep-citation-check",
    judgment: "none: naive code-only citation check (p_cited in {0,1}); no judgment client is consulted",
    threshold: `p_cited < ${CITATION_MIN_P_NAIVE} drops (citationKept, naive checker)`,
    effect: "uncited prep-review findings are dropped before the prep revise loop",
    provenance: "pp-prep-findings gate records: citationGate (checker 'naive') and dropped[].p_cited",
    failOpen: "not applicable: deterministic, never depends on Jev availability",
    seamModule:
      "src/typesafe/verdict-check.ts (naiveCitationCheck; applied in flows/port-project.ts PrepVerdictCheckStep)",
  },
  {
    name: "prioritize",
    judgment: "noul per finding: behavior-changing defect vs style preference",
    threshold: "none (ordering only): p desc, then severity rank, then input order",
    effect: "reorders the kept findings handed to the fixer (content order; nothing is dropped)",
    provenance:
      "pp-kept.prioritize (checker + fallback reason); live Jev token spend in pp-jev-usage",
    failOpen:
      "live Jev failure or missing answer -> naivePrioritize severity order (checker 'naive-fallback' + reason recorded on pp-kept)",
    seamModule:
      "src/typesafe/prioritize.ts (applied in flows/port-project.ts runPrioritizeGate)",
  },
  {
    name: "symbol-table-selection",
    judgment: "Choice over recalled TypeScript type candidates + verification nouls (selectSymbolType)",
    threshold: `a row is flagged/escalated when any verification noul < ${DEFAULT_ESCALATION_THRESHOLD} (DEFAULT_ESCALATION_THRESHOLD) or the choice confidence < 0.9 (CHOICE_CONFIDENCE_FLOOR)`,
    effect:
      "selects the TypeScript type per PHP symbol and flags low-confidence rows in the spec-map symbol table the prep spec is generated from",
    provenance:
      "pp-symtab rows (selected, candidates, flagged, escalations) and the judgment-role envelope tokens of pp-symbol-table",
    failOpen:
      "NONE: not fail-open. No client configured -> the worker injects the deterministic offline double; a live Jev failure fails the step (dex retry). Flagged rows are the only degradation signal",
    seamModule:
      "src/typesafe/symbol-types.ts (applied in flows/port-project.ts SymbolTableStep; scripts/jev-spot-check.ts is a diagnostic that routes no content)",
  },
] as const;

/** Look up one consumer by id (throws on unknown — registry drift is loud). */
export function judgmentRegistryEntry(name: string): JudgmentRegistryEntry {
  const entry = JUDGMENT_REGISTRY.find((e) => e.name === name);
  if (entry === undefined) {
    throw new Error(`no judgment-registry entry for "${name}" (Lane-B consumers must be declared)`);
  }
  return entry;
}
