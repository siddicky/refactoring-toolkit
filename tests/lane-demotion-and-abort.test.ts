/**
 * INT-6 — flows/port-project.ts consumes T4a's harness semantics.
 *
 * 1. The review-lane demotion rule lives in ONE place (isDemotedAttempt,
 *    src/harness/lanes.ts). The flow carried a private `attempt >= 2` copy for
 *    the turn-diagnosis `lane` label (and the metrics type a second one), so a
 *    threshold change would have demoted the model but mislabelled the evidence.
 * 2. PromptResult.aborted was dead against the real harness: an abort arrives
 *    as info.error = MessageAbortedError and upstreamErrorOf() threw on it before
 *    hasAbortedError() ran. runAgentTurn's abort branch was only reachable with
 *    a test double. The harness now returns aborted:true and the flow turns it
 *    into the abort failure, end to end.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "@superdurable/dex";

import { REVIEWER } from "../harness/agents/reviewer.js";
import {
  configurePortHarness,
  resetInStepVerdictMemo,
  runAgentTurn,
  runReviewTurn,
  type CapturedDiff,
} from "../flows/port-project.js";
import { configureTurnHealthAssessor } from "../flows/runtime-hooks.js";
import {
  OpencodeHarness,
  type AgentSessionClient,
  type PromptResult,
  type SessionRef,
} from "../src/harness/opencode.js";
import { isDemotedAttempt } from "../src/harness/lanes.js";
import { DIFF_HEADER_LINES, parseUnifiedDiff } from "../src/harness/runtime.js";
import { buildRetryContextDiagnosis } from "../src/metrics/types.js";
import type { TurnHealthAssessmentInput } from "../src/metrics/types.js";

const ROOT = join(import.meta.dir, "..");
const FILE = "src/Money.php";

/** Strips `//` and block comments so the guards read code, not prose. */
function code(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

const SAMPLE_DIFF = `diff --git a/src/money.ts b/src/money.ts
new file mode 100644
--- /dev/null
+++ b/src/money.ts
@@ -0,0 +1,2 @@
+export class Money {
+}`;
const DIFF: CapturedDiff = {
  diffId: "d1",
  raw: SAMPLE_DIFF,
  doc: { diff_id: "d1", file: FILE, base_ref: "HEAD", hunks: parseUnifiedDiff(SAMPLE_DIFF).hunks },
  bodyLineOffset: DIFF_HEADER_LINES,
};

/** Minimal dex context stub: attribute reads/writes against an in-memory store. */
function ctxAt(attempt: number): Context {
  const stores = new Map<unknown, Map<string, unknown>>();
  return {
    attempt,
    flowId: "int6",
    getAttribute: (attr: unknown, instance: string) => stores.get(attr)?.get(instance),
    setAttribute: (attr: unknown, value: unknown, instance: string) => {
      const store = stores.get(attr) ?? new Map<string, unknown>();
      store.set(instance, value);
      stores.set(attr, store);
    },
  } as unknown as Context;
}

afterEach(() => {
  resetInStepVerdictMemo();
  configureTurnHealthAssessor(null);
  configurePortHarness(undefined as unknown as AgentSessionClient);
});

describe("INT-6: one demotion threshold", () => {
  test("the flow and the metrics type use isDemotedAttempt; no inline `attempt >= 2` copies remain", () => {
    for (const path of ["flows/port-project.ts", "src/metrics/types.ts"]) {
      const source = code(path);
      expect(source, `${path} still compares an attempt count to 2`).not.toMatch(/\battempt(No)?\)?\s*>=\s*2\b/);
      expect(source, `${path} does not use the shared helper`).toContain("isDemotedAttempt(");
    }
    // the unread `lane` local and its helper import are gone
    const flow = code("flows/port-project.ts");
    expect(flow).not.toMatch(/\bconst lane\b/);
    expect(flow).not.toContain("demoteReviewerLane");
  });

  test("the retry-context diagnosis labels the lane exactly as the helper says", () => {
    for (const attempt of [1, 2, 3, 8]) {
      const diagnosis = buildRetryContextDiagnosis({
        file: FILE,
        stepId: "pp-review-a",
        identity: "src__Money.php#1",
        reviewer: "reviewer-A",
        attempt,
        shape: { shape: "parseable-verdict", output_tokens: 10, reasoning_tokens: 0, text_chars: 100, error: null } as never,
        recordedAtUtc: "2026-09-30T00:00:00.000Z",
      });
      expect(diagnosis.lane).toBe(isDemotedAttempt(attempt) ? "demoted" : "default");
    }
  });

  function replying(text: string): AgentSessionClient {
    let n = 0;
    return {
      createSession: (label: string): Promise<SessionRef> => Promise.resolve({ id: `s-${++n}`, title: label }),
      prompt: (): Promise<PromptResult> =>
        Promise.resolve({
          text,
          usage: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
          aborted: false,
        }),
      abortSessionsNotTagged: () => Promise.resolve([]),
    };
  }

  test("the diagnosis a failing review turn hands the assessor carries the helper's lane for every attempt", async () => {
    const seen: TurnHealthAssessmentInput[] = [];
    configureTurnHealthAssessor({
      assess: (input) => {
        seen.push(input);
        return Promise.resolve(null);
      },
    });
    configurePortHarness(replying("this is not a verdict, just prose without any JSON object"));

    for (const attempt of [1, 2, 3]) {
      await expect(
        runReviewTurn({
          ctx: ctxAt(attempt),
          reviewerId: "reviewer-A",
          file: FILE,
          round: 1,
          epoch: 1,
          diff: DIFF,
          attempt,
          maxAttempts: 99,
        }),
      ).rejects.toThrow();
      resetInStepVerdictMemo();
    }

    expect(seen.map((s) => [s.attempt, s.lane])).toEqual([
      [1, "default"],
      [2, "demoted"],
      [3, "demoted"],
    ]);
    for (const s of seen) expect(s.lane).toBe(isDemotedAttempt(s.attempt) ? "demoted" : "default");
  });
});

describe("INT-6: PromptResult.aborted is real, end to end", () => {
  /** The real OpencodeHarness over an SDK double whose turn ends in MessageAbortedError. */
  function abortedHarness(): OpencodeHarness {
    const client = {
      session: {
        create: async () => ({ data: { id: "ses_abort", title: "t" } }),
        prompt: async () => ({
          data: { info: { role: "assistant", error: { name: "MessageAbortedError" } }, parts: [] },
        }),
        messages: async () => ({ data: [] }),
      },
    } as never;
    return new OpencodeHarness(client, undefined, undefined, { waitMs: 50, pollIntervalMs: 2, callTimeoutMs: 1_000 });
  }

  test("the harness reports the abort as a result, not as an upstream failure", async () => {
    const reply = await abortedHarness().prompt("ses_abort", "hi");
    expect(reply.aborted).toBe(true);
  });

  test("runAgentTurn turns it into the abort failure naming the file and round", async () => {
    configurePortHarness(abortedHarness());
    await expect(
      runAgentTurn({ def: REVIEWER, sessionId: "ses_abort", turn: "review this", file: FILE, round: 2 }),
    ).rejects.toThrow("agent session aborted (file=src/Money.php round=2)");
  });

  test("a review turn on an aborted session fails with the abort, not a misleading upstream failure", async () => {
    configurePortHarness(abortedHarness());
    const error = await runReviewTurn({
      ctx: ctxAt(1),
      reviewerId: "reviewer-A",
      file: FILE,
      round: 1,
      epoch: 1,
      diff: DIFF,
      attempt: 1,
      maxAttempts: 99,
    }).then(
      () => null,
      (err: unknown) => err as Error,
    );
    expect(error?.message).toContain("agent session aborted");
    expect(error?.message).not.toContain("upstream failure");
  });
});
