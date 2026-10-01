/**
 * Lane-B judgment gates of the port flows (registry: src/judgment-registry.ts):
 * the live-Jev client seam, the citation / prioritize / vitest-triage gates
 * with their fail-open fallback, and the live-usage evidence stream. Each gate
 * runs live Jev when a REAL client is configured and otherwise (or on failure)
 * the deterministic naive default; the degradation is returned for the caller
 * to record.
 */

import type { Context } from "@superdurable/dex";

import { portJevLive, requirePortJudgment } from "../runtime-hooks.js";
import type { JudgmentClient } from "../../src/typesafe/client.js";
import { createJevFailureClassifier } from "../../src/typesafe/vitest-triage.js";
import { CITATION_MIN_P_JEV, CITATION_MIN_P_NAIVE } from "../../src/judgment-registry.js";
import type {
  CitationCheckResult,
  DiffDocument,
  Finding as MetricsFinding,
  VerdictRecord as MetricsVerdictRecord,
} from "../../src/metrics/types.js";
import { createCitationChecker, naiveCitationCheck } from "../../src/typesafe/verdict-check.js";
import { createJevPrioritizer, naivePrioritize } from "../../src/typesafe/prioritize.js";
import {
  buildClassifiedVitestQueueState,
  createNaiveClassifier,
  VITEST_RECORD_CAP,
  type ClassifierRoots,
  type VitestFailureRecord,
  type VitestQueueState,
} from "../../src/queues/vitest-queue.js";
import { ppJevUsage, type JudgmentChecker, type VitestTriageRecord } from "./state.js";

/**
 * The LIVE Jev client when a REAL (billed) client is wired through the
 * runtime-hooks seam; `undefined` → every consumer below (verdict-check,
 * prioritize, vitest triage) runs its deterministic naive default.
 *
 * dex-sdk review fix (DRIFT S, silent naive fallback): this used to be a
 * SECOND module global (`PORT_JEV_LIVE` + configurePortJevLive) that was
 * NEVER called by the worker — a keyed worker silently ran naive here while
 * its startup log claimed "Jev: REAL client". There is deliberately no
 * second seam anymore: the single resolution point is what the worker
 * configures via configurePortJudgment (scripts/run-demo.ts resolveJudgment).
 */
export function liveJevClient(): JudgmentClient | undefined {
  // portJevLive() is false when nothing is configured, so requirePortJudgment
  // cannot throw on this path (tests without a worker keep the naive default).
  return portJevLive() ? requirePortJudgment() : undefined;
}

/** Records one live-Jev usage event (evidence stream entry). */
export async function recordJevUsage(ctx: Context, stepId: string, tokens: number): Promise<void> {
  const log = ppJevUsage.get(ctx, "usage") ?? [];
  log.push({ stepId, tokens, atUtc: new Date().toISOString() });
  ppJevUsage.set(ctx, "usage", log);
}

/**
 * The citation gate's keep decision — the single authority for the port-loop
 * gate (VerdictCheckStep) and the prep gate (PrepVerdictCheckStep). Thresholds
 * live in src/judgment-registry.ts next to the registry entry that documents
 * them: the naive checker is binary (keep iff 1), the live Jev checker returns
 * a probability (keep iff >= CITATION_MIN_P_JEV).
 */
export function citationKept(pCited: number, checker: JudgmentChecker): boolean {
  return pCited >= (checker === "jev" ? CITATION_MIN_P_JEV : CITATION_MIN_P_NAIVE);
}

/** Counts System One tokens across every call, including calls that fail later. */
function countingJevClient(client: JudgmentClient): { client: JudgmentClient; tokens: () => number } {
  let total = 0;
  return {
    client: {
      kind: client.kind,
      systemOne: async (request) => {
        const r = await client.systemOne(request);
        total += r.usage.input_tokens + r.usage.output_tokens;
        return r;
      },
    },
    tokens: () => total,
  };
}

function failureReason(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 300);
}

/** A Lane-B gate's result plus how it was produced. */
export interface JevGateResult<T> {
  value: T;
  checker: JudgmentChecker;
  fallbackReason: string | null;
  /** Live Jev tokens spent, including before a failure (0 on the naive path). */
  jevTokens: number;
}

/**
 * Runs `live` against the Jev client when one is configured, else (or when it
 * FAILS — client error, no answer for a finding) the deterministic `naive`
 * default. Failing open is deliberate: a thrown step is retried by dex and
 * re-bills the batch. The degradation is returned for the caller to record.
 */
async function withJevFallback<T>(
  gate: "citation-check" | "prioritize" | "vitest-triage",
  jev: JudgmentClient | undefined,
  live: (client: JudgmentClient) => Promise<T>,
  naive: () => T | Promise<T>,
): Promise<JevGateResult<T>> {
  if (jev === undefined) return { value: await naive(), checker: "naive", fallbackReason: null, jevTokens: 0 };
  const counting = countingJevClient(jev);
  try {
    const value = await live(counting.client);
    return { value, checker: "jev", fallbackReason: null, jevTokens: counting.tokens() };
  } catch (err) {
    const fallbackReason = failureReason(err);
    // Failing open must not be silent: a persistent client/auth defect would
    // otherwise degrade the whole run to naive with no signal beyond the
    // durable pp-kept record.
    console.warn(`[lane-b] live Jev failed in ${gate}; using the naive default (${fallbackReason})`);
    return { value: await naive(), checker: "naive-fallback", fallbackReason, jevTokens: counting.tokens() };
  }
}

/** Citation scores for one reviewer's verdict (registry "citation-check"). */
export function runCitationGate(
  verdict: MetricsVerdictRecord,
  diff: DiffDocument,
  jev: JudgmentClient | undefined,
): Promise<JevGateResult<CitationCheckResult[]>> {
  return withJevFallback(
    "citation-check",
    jev,
    (client) => createCitationChecker(client).check(verdict, diff),
    () => naiveCitationCheck(verdict, diff),
  );
}

/** Fixer-queue ordering (registry "prioritize"); nothing to rank stays naive. */
export function runPrioritizeGate(
  findings: readonly MetricsFinding[],
  jev: JudgmentClient | undefined,
): Promise<JevGateResult<MetricsFinding[]>> {
  return withJevFallback(
    "prioritize",
    findings.length === 0 ? undefined : jev,
    (client) => createJevPrioritizer(client).prioritize(findings),
    () => naivePrioritize(findings),
  );
}

/**
 * Queue-build triage for the parsed vitest records: Jev classifier when a
 * live client is injected (TYPESAFE_API_KEY), naive path-heuristic default
 * otherwise; Jev failing MID-batch fails open to the naive classifier (the
 * whole batch re-runs naive — no half-Jev state persists). Failing open is
 * not silent: the degradation is logged and reported through
 * `hooks.onTriage` ({checker: "naive-fallback", fallbackReason}) for the
 * caller to persist next to the queue state, like the citation gate's
 * records. Usage tokens are surfaced through hooks.onUsage as each Jev call
 * completes, so tokens spent before a failure are still accounted. `roots`
 * (US-010) carries the ported source/test/fixture roots derived from the prep
 * source map, so failures limited to a PORTED TEST file classify port-caused
 * and route to that file.
 */
export async function classifyVitestRecords(
  records: readonly VitestFailureRecord[],
  iteration: number,
  jev: JudgmentClient | undefined,
  hooks: { onUsage?: (tokens: number) => void; onTriage?: (triage: VitestTriageRecord) => void } = {},
  roots?: ClassifierRoots,
): Promise<VitestQueueState> {
  const naive = createNaiveClassifier(roots ?? {});
  const jevOptions: { onUsage?: (tokens: number) => void; roots?: ClassifierRoots } = {
    ...(hooks.onUsage !== undefined ? { onUsage: hooks.onUsage } : {}),
    ...(roots !== undefined ? { roots } : {}),
  };
  const gate = await withJevFallback(
    "vitest-triage",
    jev,
    (client) =>
      buildClassifiedVitestQueueState(records, iteration, createJevFailureClassifier(client, jevOptions)),
    () => buildClassifiedVitestQueueState(records, iteration, naive),
  );
  hooks.onTriage?.({ checker: gate.checker, fallbackReason: gate.fallbackReason });
  // `total` stays the TRUE failure count (burn-down honesty); the durable
  // per-record evidence is capped like the tsc error list.
  return {
    ...gate.value,
    failures: gate.value.failures.slice(0, VITEST_RECORD_CAP),
    classified: gate.value.classified.slice(0, VITEST_RECORD_CAP),
  };
}
