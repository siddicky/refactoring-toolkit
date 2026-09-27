/**
 * Turn-health — US-002 Tier-0 pieces (plan v5.1 §Stage 1; US-003 extends this
 * file with the Tier-1/Jev + AC-B matrix).
 *
 * Covered here:
 * 1. Raw SDK message-shape fixtures ({info:{tokens}, parts}) driving
 *    OpencodeHarness.prompt through the REAL extractors (extractTokenUsage /
 *    extractText / hasAbortedError) via an SDK-boundary double.
 * 2. TEN degenerate no-text fixtures (BUILD_NOTES §WAVE-4 session
 *    signatures: 0-16 output tokens, no text part, heavy reasoning,
 *    usage-present fast path -> OpencodePromptError retryable; the 10th
 *    (fix-wave finding 7) is the MINIMUM-usage arm: 2 output tokens, zero
 *    reasoning, zero cache — usage-presence alone is Tier-0).
 * 3. Healthy negatives pass through: ~235-output-token valid verdict
 *    (wave-5 Sisyphus signature), text-present/output-0 (the case the
 *    deliberately DROPPED ≤8-output-token arm would have misclassified),
 *    aborted-no-text (recovery path, handled at flows/port-project.ts:563).
 * 4. Demotion policy = pure function of (attempt): attempt >= 2 on a review
 *    turn demotes OPENCODE_REVIEWER_MODEL to the fallback lane.
 * 5. WriteStream outage cannot fail a durable step (try/catch-swallow).
 */

import { describe, expect, test, afterEach } from "bun:test";
import {
  OpencodeHarness,
  OpencodePromptError,
  degenerateReply,
  type TokenUsage,
} from "../src/harness/opencode.js";
import { demoteReviewerLane } from "../src/harness/runtime.js";
import {
  configureEnvelopeStreamPublisher,
  envelopeStep,
  type EnvelopeStreamMessage,
} from "../flows/steps/envelope.js";
import type { Context } from "@superdurable/dex";

// ---------------------------------------------------------------------------
// SDK-boundary double: raw {info, parts} shapes, real extractors downstream.
// ---------------------------------------------------------------------------

/** One raw assistant message exactly as the opencode SDK returns it. */
interface RawMessage {
  info: unknown;
  parts: unknown;
}

/** Builds a fake OpencodeClient speaking raw {info, parts} SDK shapes. */
function sdkDouble(reply: RawMessage, seen?: { promptCalls: number }) {
  return {
    session: {
      prompt: async (_args: unknown) => {
        if (seen !== undefined) seen.promptCalls += 1;
        return { data: reply };
      },
      // Fast-path fixtures must never poll; poll-path use throws loudly.
      messages: async (_args: unknown) => {
        throw new Error("SDK double: session.messages must not be called");
      },
    },
    // The seam constructs clients with `as never`; the double mirrors that
    // looseness at the same boundary (pre-release SDK churn guard).
  } as never;
}

function harness(reply: RawMessage, seen?: { promptCalls: number }) {
  return new OpencodeHarness(sdkDouble(reply, seen));
}

/** Wave-4 degenerate shape: usage present, NO text part, heavy reasoning. */
function degenerateFixture(
  output: number,
  reasoning: number,
  parts: unknown[] = [],
): RawMessage {
  return {
    info: {
      tokens: { input: 61234, output, reasoning, cache: { read: 88000, write: 512 } },
      cost: 0,
    },
    parts,
  };
}

// ---------------------------------------------------------------------------
// 1+2: ten degenerate no-text fixtures -> retryable (BUILD_NOTES §WAVE-4)
// ---------------------------------------------------------------------------

const DEGENERATE_FIXTURES: ReadonlyArray<{ label: string; fixture: RawMessage }> = [
  {
    label: "p4-6 prep review-A: 0 out / 31996 reasoning (first cache-amplified replay)",
    fixture: degenerateFixture(0, 31996),
  },
  {
    label: "p4-6 prep review-A: 0 out / 31996 reasoning (IDENTICAL retry — cache amplification)",
    fixture: degenerateFixture(0, 31996),
  },
  {
    label: "p4-8 prep review-B: 3 out / 31996 reasoning",
    fixture: degenerateFixture(3, 31996),
  },
  {
    label: "p4-8 prep review-B: 0 out / non-text part only",
    fixture: degenerateFixture(0, 31996, [{ type: "reasoning", text: "reasoning part, no text part" }]),
  },
  {
    label: "p4-9 prep review-A attempt 3: 3 out",
    fixture: degenerateFixture(3, 0),
  },
  {
    label: "p4-10 prep review-B: 1 out",
    fixture: degenerateFixture(1, 31204),
  },
  {
    label: "cx-4 prep review-A: 6 out",
    fixture: degenerateFixture(6, 2877),
  },
  {
    label: "cx-4 prep review-A: 4 out",
    fixture: degenerateFixture(4, 2877),
  },
  {
    label: "cx-4 prep review-A: 16 out (WAVE-4 observed ceiling 0-16)",
    fixture: degenerateFixture(16, 2877),
  },
  {
    // 10th degenerate (fix-wave finding 7): the MINIMUM-measurable-usage arm —
    // 2 output tokens, ZERO reasoning, ZERO cache. Distinct from every wave-4
    // signature (all carried heavy reasoning and/or amplified cache): the
    // predicate fires on usage-presence alone. A text-part-present variant is
    // NOT Tier-0 (degenerateReply requires an empty text part), so this — not
    // the suggested text+reasoning shape — is the uncovered Tier-0 class.
    label: "fix-wave: 2 out / 0 reasoning / zero cache (minimum-measurable usage — Tier-0 at ANY usage magnitude)",
    fixture: {
      info: {
        tokens: { input: 61234, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0,
      },
      parts: [],
    },
  },
];

describe("Tier-0 degenerate-turn detection (raw SDK shapes through the real extractors)", () => {
  test("all ten degenerate no-text fixtures throw retryable OpencodePromptError", async () => {
    expect(DEGENERATE_FIXTURES.length).toBe(10);
    for (const { label, fixture } of DEGENERATE_FIXTURES) {
      const h = harness(fixture);
      let caught: unknown;
      try {
        await h.prompt("ses_degenerate", "review this diff");
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(OpencodePromptError);
      const e = caught as OpencodePromptError;
      expect(e.retryable).toBe(true);
      expect(e.message).toContain("degenerate turn");
      expect(e.message).toContain("NO text part");
    }
  });

  test("degenerateReply predicate: usage-present + empty text + not aborted; the ≤8-output-token arm is DROPPED", () => {
    const usage: TokenUsage = { input: 100, output: 3, reasoning: 31996, cacheRead: 0, cacheWrite: 0, cost: 0 };
    expect(degenerateReply(usage, "", false)).toBe(true);
    expect(degenerateReply(null, "", false)).toBe(false);
    expect(degenerateReply(usage, "", true)).toBe(false); // aborted-no-text excluded
    // Deliberately dropped arm: text-present/output-0 is HEALTHY at ANY
    // output-token count (including 0) — no token-count arm may fire.
    expect(degenerateReply({ ...usage, output: 0 }, "verdict text", false)).toBe(false);
    expect(degenerateReply(usage, "some text", false)).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 3: healthy negatives pass through (NOT Tier-0)
  // -----------------------------------------------------------------------

  test("~235-output-token valid verdict passes through untouched", async () => {
    const verdict = JSON.stringify({
      findings: [
        { finding_id: "F1", severity: "major", title: "sum overflow", evidence: { start_line: 7, end_line: 7 } },
        { finding_id: "F2", severity: "minor", title: "naming", evidence: { start_line: 19, end_line: 20 } },
      ],
    });
    const h = harness({
      info: {
        tokens: { input: 40123, output: 235, reasoning: 512, cache: { read: 90000, write: 1024 } },
        cost: 0,
      },
      parts: [{ type: "text", text: verdict }],
    });
    const reply = await h.prompt("ses_healthy", "review this diff");
    expect(reply.aborted).toBe(false);
    expect(reply.usage).not.toBeNull();
    expect(reply.usage?.output).toBe(235);
    const parsed = JSON.parse(reply.text) as { findings: unknown[] };
    expect(parsed.findings.length).toBe(2);
  });

  test("text-present/output-0 is NOT Tier-0 (the dropped ≤8-output-token arm would misclassify it)", async () => {
    const h = harness({
      info: {
        tokens: { input: 1234, output: 0, reasoning: 4096, cache: { read: 0, write: 0 } },
        cost: 0,
      },
      parts: [{ type: "text", text: "no findings — the diff is behavior-preserving" }],
    });
    const reply = await h.prompt("ses_zero_out", "review this diff");
    expect(reply.aborted).toBe(false);
    expect(reply.usage?.output).toBe(0);
    expect(reply.text.length).toBeGreaterThan(0);
  });

  test("aborted-no-text is NOT classified Tier-0: it surfaces as the ODW upstream-failure retryable class (runAgentTurn:563 stays the abort handler)", async () => {
    // Observed seam reality: an aborted assistant message carries
    // info.error = MessageAbortedError, and the ODW finding-1 check bails
    // BEFORE the Tier-0 guard — so an abort must never be misreported as a
    // degenerate turn (the Tier-0 predicate also excludes aborted shapes).
    const h = harness({
      info: {
        tokens: { input: 500, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        cost: 0,
        error: { name: "MessageAbortedError", message: "aborted by recovery" },
      },
      parts: [],
    });
    let caught: unknown;
    try {
      await h.prompt("ses_aborted", "review this diff");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OpencodePromptError);
    const e = caught as OpencodePromptError;
    expect(e.retryable).toBe(true);
    expect(e.message).toContain("upstream failure");
    expect(e.message).not.toContain("degenerate turn");
  });
});

// ---------------------------------------------------------------------------
// 4: demotion policy = pure f(attempt)
// ---------------------------------------------------------------------------

describe("reviewer-lane demotion policy (pure f(attempt))", () => {
  const luna = { providerID: "openai", modelID: "gpt-6-luna" };
  const glm = { providerID: "zai", modelID: "glm-5.3-flash" };

  test("attempt 1 (and undefined) keeps the OPENCODE_REVIEWER_MODEL default lane", () => {
    expect(demoteReviewerLane(1, luna, glm)).toEqual(luna);
    expect(demoteReviewerLane(undefined, luna, glm)).toEqual(luna);
    expect(demoteReviewerLane(0, luna, glm)).toEqual(luna);
  });

  test("attempt >= 2 demotes to the fallback lane", () => {
    expect(demoteReviewerLane(2, luna, glm)).toEqual(glm);
    expect(demoteReviewerLane(3, luna, glm)).toEqual(glm);
  });

  test("fallback unset -> the demoted lane IS the implementer lane (no override)", () => {
    expect(demoteReviewerLane(2, luna, undefined)).toBeUndefined();
    // No default override configured: policy is a no-op either way.
    expect(demoteReviewerLane(1, undefined, glm)).toBeUndefined();
  });

  test("policy depends on NOTHING but the attempt: same inputs, same answer", () => {
    const a = demoteReviewerLane(2, luna, glm);
    const b = demoteReviewerLane(2, luna, glm);
    expect(a).toEqual(b);
    expect(demoteReviewerLane(2, undefined, undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5: WriteStream outage cannot fail a durable step
// ---------------------------------------------------------------------------

describe("envelope telemetry stream (US-002)", () => {
  function fakeContext(): {
    context: Context;
    staged: Array<{ instance: string; value: unknown }>;
  } {
    const staged: Array<{ instance: string; value: unknown }> = [];
    const context = {
      attempt: 1,
      flowId: "gate-outage-flow",
      setAttribute: (attr: unknown, value: unknown, instance: string) => {
        void attr;
        staged.push({ instance, value });
      },
    } as unknown as Context;
    return { context, staged };
  }

  const step = envelopeStep<{ n: number }, { n: number }>({
    stepType: "ProbeStreamOutage",
    stepId: "pp-stream-outage",
    role: "record",
    inner: async (_ctx, input) => ({ output: { n: input.n }, tokens: null }),
  });

  afterEach(() => {
    configureEnvelopeStreamPublisher(undefined);
  });

  test("a publisher that throws synchronously never fails the step; both durable envelopes still land", async () => {
    const probe = fakeContext();
    const seen: EnvelopeStreamMessage[] = [];
    configureEnvelopeStreamPublisher((msg) => {
      seen.push(msg);
      throw new Error("stream store unreachable (simulated telemetry outage)");
    });
    const decision = await step.execute(probe.context as never, { n: 7 });
    expect(decision.kind).toBe("gracefulComplete");
    expect((decision as { output?: { n: number } }).output).toEqual({ n: 7 });
    // Start + completion envelopes were staged durably DESPITE the outage...
    expect(probe.staged.length).toBe(2);
    // ...and the publish hook attempted the stream write after EACH write.
    expect(seen.length).toBe(2);
    for (const row of probe.staged) {
      expect(row.instance).toBe("pp-stream-outage#1");
    }
    // Message contract: topic + flowId + event key + mirrored event.
    expect(seen[0]?.topic).toBe("port/gate-outage-flow/events");
    expect(seen[0]?.flowId).toBe("gate-outage-flow");
    expect(seen[0]?.eventKey).toBe("pp-stream-outage#1");
    expect(seen[0]?.event.outcome).toBe("interrupted");
    expect(seen[1]?.event.outcome).toBe("completed");
  });

  test("a publisher whose promise rejects never fails the step", async () => {
    const probe = fakeContext();
    configureEnvelopeStreamPublisher(() => {
      return Promise.reject(new Error("STREAM UNAVAILABLE"));
    });
    const decision = await step.execute(probe.context as never, { n: 7 });
    expect(decision.kind).toBe("gracefulComplete");
    expect(probe.staged.length).toBe(2);
  });

  test("no publisher configured -> hook is a no-op (step unaffected)", async () => {
    const probe = fakeContext();
    const decision = await step.execute(probe.context as never, { n: 7 });
    expect(decision.kind).toBe("gracefulComplete");
    expect(probe.staged.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// US-003: fixture-directory set (raw SDK shapes as checked-in JSON) + AC-B2
// import boundary. The nine inline degenerate fixtures above stay canonical
// for Tier-0; this block proves the checked-in fixture FILES agree with the
// same predicate and that Tier-1 evidence has zero control-flow consumers.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "turn-health",
);

describe("US-003 fixture directory (checked-in raw SDK shapes)", () => {
  type Case = {
    _id: string;
    _expected: "retry" | "generic_retry" | "discard_class" | "pass" | "abort_path";
    info: unknown;
    parts: unknown;
  };

  const files = readdirSync(FIXTURE_DIR)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .sort();

  test("manifest lists every fixture file with its expected class", () => {
    const manifest = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "manifest.json"), "utf8"),
    );
    const listed = manifest.cases.map((c: { id: string }) => c.id + ".json");
    expect(listed.sort()).toEqual(files);
  });

  test("retry-class fixtures are Tier-0; every other class passes through without a Tier-0 error", async () => {
    for (const file of files) {
      const doc: Case = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8"));
      const h = harness(doc as RawMessage);
      if (doc._expected === "retry") {
        await expect(h.prompt("ses_fixture", "review this diff")).rejects.toThrow(
          /degenerate turn/,
        );
      // abort_path removed: aborted turns are an SDK error path, not a reply shape
      // (covered by the inline aborted-no-text test above via the upstream-failure class)
      } else {
        // generic_retry / discard_class / pass: no Tier-0 classification
        const result = await h.prompt("ses_fixture", "review this diff");
        expect(String(result?.text ?? result)).not.toContain("degenerate turn");
      }
    }
  });

  test("degenerate fixtures are all no-text with usage present (predicate agreement)", () => {
    for (const file of files) {
      const doc: Case = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8"));
      const usage = (doc.info as { tokens?: { output?: number } }).tokens;
      if (doc._expected === "retry") {
        const parts = (doc.parts as Array<{ type: string; text?: string }>) ?? [];
        const hasText = parts.some((p) => p.type === "text");
        expect(hasText).toBe(false);
        expect(usage).toBeDefined();
      }
    }
  });
});

describe("US-003 import boundary (AC-B2): Tier-1 evidence has zero control-flow consumers", () => {
  test("flows/ and src/git/ never import src/typesafe/turn-health", () => {
    const roots = ["flows", "src/git"];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".ts")) {
          const src = readFileSync(p, "utf8");
          if (/from\s+["'].*turn-health/.test(src)) offenders.push(p);
        }
      }
    };
    for (const r of roots) walk(r);
    expect(offenders).toEqual([]);
  });
});
