/**
 * Citation check over reviewer findings (plan TypeSafe integration point 2).
 *
 * Per finding: "does the cited evidence appear in the reviewed diff?" Returns
 * `{finding_id, p_cited}` per finding (matching the verdict record's
 * `citation_check` contract).
 *
 * Two implementations behind one checker interface:
 * - NAIVE (code-only, default from day one): whitespace/marker-normalized
 *   substring match of the finding's evidence quote against the diff text;
 *   p_cited is exactly 1 (found) or 0 (not found / no evidence / unknown
 *   hunk). The flow consumes naive first; the Jev variant is the Phase 3
 *   swap-in.
 * - JEV: one batched systemOne request with one noul per finding over the
 *   shared diff state; p_cited is the noul probability. Findings without
 *   evidence short-circuit to p_cited 0 (nothing was cited) without a model
 *   call.
 */
import { noul, type JudgmentClient } from "./client.js";
import type { CitationCheckResult, DiffDocument, VerdictRecord } from "../metrics/types.js";

/** Strip the +/- diff marker and trim, so quotes match across marker styles. */
export function normalizeForMatch(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/^[+-]/, "").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Normalized text of the whole diff (all hunks, all lines, in order). */
export function diffText(diff: DiffDocument): string {
  return normalizeForMatch(diff.hunks.flatMap((hunk) => hunk.lines).join("\n"));
}

function isCitable(diff: DiffDocument, evidence: { hunk_id: string; quote: string } | null): boolean {
  if (evidence === null) return false;
  const quote = normalizeForMatch(evidence.quote);
  if (quote.length === 0) return false;
  const hunkExists = diff.hunks.some((h) => h.hunk_id === evidence.hunk_id);
  if (!hunkExists) return false;
  return diffText(diff).includes(quote);
}

/**
 * NAIVE code-only citation check. Deterministic: p_cited in {0, 1}.
 * A finding passes iff its evidence quote appears in the diff text AND the
 * claimed hunk_id exists in the diff.
 */
export function naiveCitationCheck(verdict: VerdictRecord, diff: DiffDocument): CitationCheckResult[] {
  return verdict.findings.map((finding) => ({
    finding_id: finding.finding_id,
    p_cited: isCitable(diff, finding.evidence) ? 1 : 0,
  }));
}

export interface CitationCheckOptions {
  model?: string;
}

/**
 * JEV citation check: one batched systemOne request, one noul per
 * evidence-bearing finding, over the shared diff state.
 * Output preserves verdict.findings order.
 */
export async function jevCitationCheck(
  client: JudgmentClient,
  verdict: VerdictRecord,
  diff: DiffDocument,
  options: CitationCheckOptions = {},
): Promise<CitationCheckResult[]> {
  const evidenceByFinding = new Map<string, NonNullable<VerdictRecord["findings"][number]["evidence"]>>();
  const questions: Record<string, ReturnType<typeof noul>> = {};
  for (const finding of verdict.findings) {
    if (finding.evidence === null) continue;
    evidenceByFinding.set(finding.finding_id, finding.evidence);
    questions[finding.finding_id] = noul(
      `Finding "${finding.finding_id}" (${finding.summary}) cites this evidence: "${finding.evidence.quote}". Does the quoted evidence appear in the reviewed diff?`,
      {
        true: "the quoted evidence appears in the diff",
        false: "the quoted evidence does not appear in the diff",
      },
    );
  }

  if (Object.keys(questions).length === 0) {
    return verdict.findings.map((finding) => ({ finding_id: finding.finding_id, p_cited: 0 }));
  }

  const response = await client.systemOne({
    state: {
      diff_id: diff.diff_id,
      file: diff.file,
      hunks: diff.hunks.map((h) => ({
        hunk_id: h.hunk_id,
        header: h.header,
        lines: h.lines,
      })),
    },
    questions,
    ...(options.model === undefined ? {} : { model: options.model }),
  });

  return verdict.findings.map((finding) => {
    if (!evidenceByFinding.has(finding.finding_id)) {
      return { finding_id: finding.finding_id, p_cited: 0 };
    }
    const answer = response.answers[finding.finding_id];
    if (answer === undefined) {
      throw new Error(`jevCitationCheck: no answer returned for finding "${finding.finding_id}"`);
    }
    return { finding_id: finding.finding_id, p_cited: answer.noul };
  });
}

/** Common interface so the flow can swap naive -> Jev in Phase 3. */
export interface CitationChecker {
  readonly kind: "naive" | "jev";
  check(verdict: VerdictRecord, diff: DiffDocument): Promise<CitationCheckResult[]>;
}

/** Naive checker (no client) or Jev checker (client supplied). */
export function createCitationChecker(): CitationChecker;
export function createCitationChecker(client: JudgmentClient): CitationChecker;
export function createCitationChecker(client?: JudgmentClient): CitationChecker {
  if (client === undefined) {
    return {
      kind: "naive",
      async check(verdict, diff) {
        return naiveCitationCheck(verdict, diff);
      },
    };
  }
  return {
    kind: "jev",
    async check(verdict, diff) {
      return jevCitationCheck(client, verdict, diff);
    },
  };
}
