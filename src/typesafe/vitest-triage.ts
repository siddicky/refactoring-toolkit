/**
 * Jev route for vitest failure triage (US-004, Stage 2a) — Lane-B consumer.
 *
 * DECLARED in src/judgment-registry.ts (entry "vitest-triage"): the
 * judgment-derived failureClass routes CONTENT (which fixer turn sees the
 * failure) through a fixed threshold — it never changes control flow (no
 * lane change, no retry/demotion decision; Lane A is untouched).
 *
 * Two implementations behind the FailureClassifier seam
 * (src/queues/vitest-queue.ts):
 * - NAIVE (deterministic default, lives in vitest-queue.ts): path heuristic
 *   over the parsed stack. Used when TYPESAFE_API_KEY is absent and as the
 *   fail-open target whenever the Jev route errors mid-batch.
 * - JEV (this module): one systemOne choice question per record
 *   ("port_caused" / "fixture_problem" / "unknown"). The CLASS is
 *   judgment-derived; the FILE attribution stays deterministic
 *   (attributedFileOfClass over the parsed stack), so the judgment only
 *   picks the bucket, never the routed path. "unknown" collapses to the
 *   documented deterministic default: class "port-caused", attributedFile
 *   null.
 *
 * Fail-open: this module THROWS on Jev errors (per the seam contract —
 * judgments are never faked silently); the flow-level consumer
 * (flows/port/lane-b.ts classifyVitestRecords) catches and re-runs the
 * naive classifier. Token usage is surfaced per call via onUsage so the flow
 * can record it in the pp-jev-usage evidence stream (recordJevUsage pattern).
 */

import type { JudgmentClient } from "./client.js";
import {
  attributedFileOfClass,
  type AsyncFailureClassifier,
  type ClassifierRoots,
  type FailureClassification,
  type VitestFailureRecord,
} from "../queues/vitest-queue.js";
import { choice } from "./client.js";

/** The choice question name (single question per systemOne call). */
const VITEST_TRIAGE_QUESTION = "failure_attribution";

/** Jev triage options: optional model override + usage sink. */
export interface JevTriageOptions {
  model?: string;
  /** Called with (input+output) tokens after EACH successful systemOne call. */
  onUsage?: (tokens: number) => void;
  /**
   * US-010: root configuration for the DETERMINISTIC attribution step (ported
   * source/test/fixture roots). The class stays judgment-derived; only the
   * file attribution consumes these.
   */
  roots?: ClassifierRoots;
}

/**
 * JEV triage: classify one record per systemOne call. Failures are typically
 * few per queue run, so per-record calls are acceptable; batching is a later
 * optimization behind the same seam.
 */
export function createJevFailureClassifier(
  client: JudgmentClient,
  options: JevTriageOptions = {},
): AsyncFailureClassifier {
  return {
    async classify(failure: VitestFailureRecord): Promise<FailureClassification> {
      const response = await client.systemOne({
        state: {
          testFile: failure.testFile,
          testName: failure.testName,
          errorMessage: failure.errorMessage,
          frames: failure.frames.map((f) => `${f.file}:${f.line}:${f.column}`),
        },
        questions: {
          [VITEST_TRIAGE_QUESTION]: choice(
            "A vitest test failed while verifying a ported TypeScript checkout. Which bucket does this failure belong to?",
            {
              port_caused:
                "the ported TypeScript output is wrong or incomplete (any stack frame inside the ported source implicates it)",
              fixture_problem:
                "the demo fixture or test harness itself is broken (every stack frame stays inside test/fixture files)",
              unknown: "the evidence does not implicate either bucket",
            },
          ),
        },
        ...(options.model === undefined ? {} : { model: options.model }),
      });
      options.onUsage?.(response.usage.input_tokens + response.usage.output_tokens);

      const answer = response.answers[VITEST_TRIAGE_QUESTION];
      if (answer.choice === "fixture_problem") {
        const file = attributedFileOfClass(failure, "fixture-problem", options.roots);
        return {
          failureClass: "fixture-problem",
          attributedFile: file,
          reason: `Jev triage: fixture_problem (${file ?? "no fixture frame in stack"})`,
        };
      }
      if (answer.choice === "port_caused") {
        const file = attributedFileOfClass(failure, "port-caused", options.roots);
        return {
          failureClass: "port-caused",
          attributedFile: file,
          reason: `Jev triage: port_caused (${file ?? "no ported frame in stack"})`,
        };
      }
      // unknown → documented deterministic default: stay visible to the fix
      // loop as port-caused, with no file to route to.
      return {
        failureClass: "port-caused",
        attributedFile: null,
        reason: "Jev triage: unknown → deterministic default port-caused (no attribution)",
      };
    },
  };
}
