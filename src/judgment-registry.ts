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
 * its fail-open behavior (Lane-B absence/unavailability degrades to the
 * deterministic naive default — never a hard failure).
 *
 * A Lane-B consumer that is not in this registry is a review-blocking
 * defect; Stage-3's verifier (AC-R) asserts seam construction (JudgmentClient
 * injection) only in registry-listed modules. Lane B never cascades into
 * Lane A: a triage classification cannot trigger a lane change.
 */

/**
 * Citation-gate keep thresholds (Lane-B "citation-check"): a finding is KEPT
 * iff its p_cited is at least the threshold of the checker that scored it.
 * The naive checker is binary ({0,1}); the live Jev checker returns a noul
 * probability (live reports record 0.97-0.99 for genuinely cited findings),
 * so demanding exactly 1 there dropped valid findings. flows/port-project.ts
 * applies these; the registry entry below is derived from them.
 */
export const CITATION_MIN_P_NAIVE = 1;
export const CITATION_MIN_P_JEV = 0.5;

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
  /** The seam module the consumer is implemented behind. */
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
    provenance: "envelope + queue attribute",
    failOpen: "naive classifier",
    seamModule: "src/queues/vitest-queue.ts (Jev route: src/typesafe/vitest-triage.ts)",
  },
  {
    name: "citation-check",
    judgment: "p_cited (citation score per finding)",
    threshold: "p_cited < 1 drops findings",
    effect: "uncited findings are dropped from the kept set (never reach the fix loop or report)",
    provenance: "verdict records",
    failOpen: "missing check record -> p_cited defaults to 0 (finding dropped; drop reason recorded)",
    seamModule: "src/metrics/agreement.ts (threshold applied in flows/port-project.ts)",
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
