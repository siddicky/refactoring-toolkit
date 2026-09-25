/**
 * Fixer-queue findings rerank (plan TypeSafe integration point 3).
 *
 * Two implementations behind one FindingPrioritizer interface:
 * - NAIVE (code-only default): stable severity-class ordering
 *   (blocker > major > minor > nit); ties keep input order.
 * - JEV (Phase 3 swap-in): one batched systemOne request with one noul per
 *   finding ("behavior-changing defect vs style preference"); sort by noul
 *   probability desc, tie-break severity class, then input order.
 *
 * Both are pure over their inputs and never mutate the input array.
 * Precondition: finding_ids are unique within a batch (verdict schema).
 */
import { noul, type JudgmentClient } from "./client.js";
import { SEVERITY_RANK, type Finding } from "../metrics/types.js";

/** Common interface for both rerank implementations. */
export interface FindingPrioritizer {
  readonly kind: "naive" | "jev";
  prioritize(findings: readonly Finding[]): Promise<Finding[]>;
}

/** NAIVE: stable sort by severity class rank (blocker first, nit last). */
export function naivePrioritize(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity],
  );
}

export function createNaivePrioritizer(): FindingPrioritizer {
  return {
    kind: "naive",
    async prioritize(findings) {
      return naivePrioritize(findings);
    },
  };
}

export interface PrioritizeOptions {
  model?: string;
}

/**
 * JEV rerank: one batched systemOne request, one noul per finding.
 * Deterministic ordering: p(is-behavior-defect) desc, then severity rank,
 * then original input order.
 */
export async function jevPrioritize(
  client: JudgmentClient,
  findings: readonly Finding[],
  options: PrioritizeOptions = {},
): Promise<Finding[]> {
  if (findings.length === 0) return [];

  const questions: Record<string, ReturnType<typeof noul>> = {};
  for (const finding of findings) {
    questions[finding.finding_id] = noul(
      `Is finding "${finding.finding_id}" (${finding.summary}; severity ${finding.severity}) a behavior-changing defect rather than a style preference?`,
      { true: "behavior-changing defect", false: "style preference or cosmetic" },
    );
  }
  const response = await client.systemOne({
    state: {
      findings: findings.map((f) => ({
        id: f.finding_id,
        severity: f.severity,
        summary: f.summary,
      })),
    },
    questions,
    ...(options.model === undefined ? {} : { model: options.model }),
  });

  const pByFinding = new Map<string, number>();
  for (const finding of findings) {
    const answer = response.answers[finding.finding_id];
    if (answer === undefined) {
      throw new Error(`jevPrioritize: no answer returned for finding "${finding.finding_id}"`);
    }
    pByFinding.set(finding.finding_id, answer.noul);
  }
  const inputOrder = new Map<string, number>();
  findings.forEach((finding, index) => inputOrder.set(finding.finding_id, index));

  return [...findings].sort((a, b) => {
    const pa = pByFinding.get(a.finding_id) ?? 0;
    const pb = pByFinding.get(b.finding_id) ?? 0;
    if (pa !== pb) return pb - pa;
    const severityDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (severityDiff !== 0) return severityDiff;
    return (inputOrder.get(a.finding_id) ?? 0) - (inputOrder.get(b.finding_id) ?? 0);
  });
}

export function createJevPrioritizer(
  client: JudgmentClient,
  options: PrioritizeOptions = {},
): FindingPrioritizer {
  return {
    kind: "jev",
    async prioritize(findings) {
      return jevPrioritize(client, findings, options);
    },
  };
}
