/**
 * US-006 (Stage 2c): verdict repair-or-discard + exhaustion tombstones.
 *
 * Coverage map (PRD AC-V):
 * - PRE-CHECK (written first, green on HEAD): agreement/metrics accept
 *   one-reviewer and zero-reviewer rounds;
 * - deterministic suspicion predicate (span-outside-diff; all-blockers > 5;
 *   in-step verbatim-repeat) — Lane A, no Tier-1 input;
 * - triggered repair / repair success / repair-fail -> tombstone;
 * - single-reviewer-discard + zero-reviewer degraded round;
 * - tombstoned tokens present on the tombstone AND the step's envelope return;
 * - degraded marker on the metrics render (AC1/AC2 report) + /api/state
 *   payload + dashboard headline;
 * - agreement.ts untouched: its exact-2-records semantics pinned as-is.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Context } from "@superdurable/dex";

import { agreementForGroup } from "../src/metrics/agreement.js";
import { renderReport } from "../src/metrics/render.js";
import { evaluateSuspicion, normalizeVerdictText } from "../src/metrics/suspicion.js";
import type {
  DiffDocument,
  EnvelopeEvent,
  Finding,
  TokenUsage,
  VerdictRecord,
  VerdictTombstone,
} from "../src/metrics/types.js";
import { isVerdictTombstone } from "../src/metrics/types.js";
import { DIFF_HEADER_LINES, parseUnifiedDiff } from "../src/harness/runtime.js";
import {
  OpencodePromptError,
  type AgentSessionClient,
  type PromptResult,
  type SessionRef,
  type TokenUsage as SeamUsage,
} from "../src/harness/opencode.js";
import {
  configurePortHarness,
  markerKeyOf,
  ppConfig,
  ppDiff,
  ppKept,
  ppPrepDiff,
  ppPrepState,
  ppPrepVerdict,
  ppVerdict,
  resetInStepVerdictMemo,
  runReviewTurn,
  PortFileFlow,
  PortProjectFlow,
  REVIEW_STEP_MAX_ATTEMPTS,
  type CapturedDiff,
  type FileRoundInput,
  type ReviewTuple,
} from "../flows/port-project.js";
import {
  buildDashboardState,
  degradedRoundsOf,
  lifecycleHeadline,
} from "../src/dashboard/state.js";
import type { DexFlowSummaryWire, DexStateWire } from "../src/dashboard/types.js";
import { stagingContext, stubContext, type AttributeStores } from "./support/dex-context.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const SAMPLE_DIFF = `diff --git a/src/money.ts b/src/money.ts
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/money.ts
@@ -0,0 +1,4 @@
+export class Money {
+  constructor(readonly cents: number) {}
+  add(other: Money): Money {
+    return new Money(this.cents + other.cents);
+  }
+}`;

const DIFF_DOC: DiffDocument = {
  diff_id: "diff-f-r1",
  file: "src/Money.php",
  base_ref: "HEAD",
  hunks: [
    {
      hunk_id: "h1",
      header: "@@ -0,0 +1,4 @@",
      old_start: 0,
      old_lines: 0,
      new_start: 1,
      new_lines: 4,
      lines: [
        "+export class Money {",
        "+  constructor(readonly cents: number) {}",
        "+  add(other: Money): Money {",
        "+    return new Money(this.cents + other.cents);",
        "+  }",
        "+}",
      ],
    },
  ],
};

function span(hunk: string, start: number, end: number): Finding["evidence"] {
  return { hunk_id: hunk, start_line: start, end_line: end, quote: "quoted evidence" };
}

function finding(id: string, severity: Finding["severity"], hunk = "h1", start = 2, end = 3): Finding {
  return { finding_id: id, severity, summary: `summary ${id}`, evidence: span(hunk, start, end) };
}

function record(
  file: string,
  reviewer: string,
  round: number,
  findings: Finding[],
): VerdictRecord {
  return {
    file,
    reviewer,
    round,
    diff_id: `${file}-r${round}`,
    findings,
    citation_check: findings.map((f) => ({ finding_id: f.finding_id, p_cited: 1 })),
  };
}

// ---------------------------------------------------------------------------
// PRE-CHECK (run + green on HEAD, before any US-006 implementation):
// agreement/metrics accept one-reviewer and zero-reviewer rounds.
// ---------------------------------------------------------------------------

describe("PRE-CHECK: agreement accepts one- and zero-reviewer rounds", () => {
  test("one-reviewer round -> unreviewed, surfaced with the observed count", () => {
    const out = agreementForGroup([record("f.php", "reviewer-A", 1, [])], "f.php", 1);
    expect(out.outcome).toBe("unreviewed");
    expect(out.reason).toContain("found 1");
  });

  test("zero-reviewer round -> unreviewed", () => {
    const out = agreementForGroup([], "f.php", 1);
    expect(out.outcome).toBe("unreviewed");
    expect(out.reason).toContain("found 0");
  });

  test("a missing side -> unreviewed (tombstoned reviewer = missing record)", () => {
    expect(agreementForGroup([record("f.php", "reviewer-A", 1, [])], "f.php", 1).outcome).toBe("unreviewed");
  });
});

describe("PRE-CHECK: metrics renderer accepts one- and zero-reviewer rounds", () => {
  const envelope: EnvelopeEvent = {
    stepId: "pp-review-a",
    role: "review",
    file: null,
    round: null,
    attempt: 1,
    started_at: "2026-09-26T00:00:00Z",
    ended_at: "2026-09-26T00:00:01Z",
    outcome: "completed",
    tokens: 100,
    wall_clock_ms: 1000,
    identity: "f.php#1",
  };

  test("one-reviewer round renders unreviewed agreement without failure", () => {
    const rendered = renderReport({
      envelopes: [envelope],
      verdicts: [record("f.php", "reviewer-A", 1, [finding("A1", "major")])],
      burnDown: [],
    });
    const fr = rendered.json.file_rounds.find((r) => r.file === "f.php");
    expect(fr !== undefined).toBe(true);
    expect(fr?.agreement.outcome).toBe("unreviewed");
    expect(rendered.json.provenance_ok).toBe(true);
  });

  test("zero-reviewer round renders unreviewed agreement without failure", () => {
    const rendered = renderReport({ envelopes: [envelope], verdicts: [], burnDown: [] });
    const fr = rendered.json.file_rounds.find((r) => r.file === "f.php");
    expect(fr !== undefined).toBe(true);
    expect(fr?.agreement.outcome).toBe("unreviewed");
    expect(rendered.markdown).toContain("unreviewed");
  });
});

// ---------------------------------------------------------------------------
// US-006: the deterministic suspicion predicate (Lane A — pure functions)
// ---------------------------------------------------------------------------

describe("suspicion predicate (span-outside-diff)", () => {
  const parsed = parseUnifiedDiff(SAMPLE_DIFF);

  test("an uncited finding (resolver-null evidence) is suspect", () => {
    const rec = record("src/Money.php", "reviewer-A", 1, [
      { finding_id: "F1", severity: "major", summary: "s", evidence: null },
    ]);
    const out = evaluateSuspicion({
      record: rec,
      parsedDiff: parsed,
      verdictText: '{"findings":[{}]}',
      priorNormalizedText: null,
    });
    expect(out.suspect).toBe(true);
    expect(out.reasons).toEqual(["span-outside-diff:F1"]);
  });

  test("a span outside the cited hunk's line-range is suspect (reuse of resolver coordinates)", () => {
    const rec = record("src/Money.php", "reviewer-A", 1, [
      { finding_id: "F1", severity: "major", summary: "s", evidence: span("h1", 300, 301) },
    ]);
    const out = evaluateSuspicion({
      record: rec,
      parsedDiff: parsed,
      verdictText: "{}",
      priorNormalizedText: null,
    });
    expect(out.suspect).toBe(true);
    expect(out.reasons).toEqual(["span-outside-diff:F1"]);
  });

  test("a span inside the hunk's range is NOT suspect on arm (a)", () => {
    // SAMPLE_DIFF: the `@@` header is raw line 6 and the hunk body occupies raw
    // lines 7..12 (1-based, the resolver's coordinates; a reviewer cites block
    // lines = raw + DIFF_HEADER_LINES).
    const rec = record("src/Money.php", "reviewer-A", 1, [
      { finding_id: "F1", severity: "major", summary: "s", evidence: span("h1", 7, 9) },
    ]);
    const out = evaluateSuspicion({
      record: rec,
      parsedDiff: parsed,
      verdictText: "{}",
      priorNormalizedText: null,
    });
    expect(out.suspect).toBe(false);
    expect(out.reasons).toEqual([]);
  });

  test("C11 boundaries: the LAST body line (raw 12) is inside; the @@ line (raw 6) is outside", () => {
    const at = (start: number, end: number) =>
      evaluateSuspicion({
        record: record("src/Money.php", "reviewer-A", 1, [
          { finding_id: "F1", severity: "major", summary: "s", evidence: span("h1", start, end) },
        ]),
        parsedDiff: parsed,
        verdictText: "{}",
        priorNormalizedText: null,
      }).reasons;
    expect(at(12, 12)).toEqual([]);
    expect(at(7, 12)).toEqual([]);
    expect(at(6, 6)).toEqual(["span-outside-diff:F1"]);
    expect(at(12, 13)).toEqual(["span-outside-diff:F1"]);
  });
});

describe("suspicion predicate (all-blockers-over-cap)", () => {
  const parsed = parseUnifiedDiff(SAMPLE_DIFF);
  const inDiff = (id: string): Finding => ({
    finding_id: id,
    severity: "blocker",
    summary: id,
    evidence: span("h1", 7, 8),
  });

  test("more than 5 findings, ALL blockers -> suspect", () => {
    const rec = record("src/Money.php", "reviewer-A", 1, [1, 2, 3, 4, 5, 6].map((i) => inDiff(`F${i}`)));
    const out = evaluateSuspicion({ record: rec, parsedDiff: parsed, verdictText: "{}", priorNormalizedText: null });
    expect(out.suspect).toBe(true);
    expect(out.reasons).toContain("all-blockers-over-cap");
  });

  test("exactly 5 blockers is NOT suspect", () => {
    const rec = record("src/Money.php", "reviewer-A", 1, [1, 2, 3, 4, 5].map((i) => inDiff(`F${i}`)));
    const out = evaluateSuspicion({ record: rec, parsedDiff: parsed, verdictText: "{}", priorNormalizedText: null });
    expect(out.reasons).not.toContain("all-blockers-over-cap");
  });

  test("6 findings with one non-blocker is NOT suspect", () => {
    const mixed = [1, 2, 3, 4, 5].map((i) => inDiff(`F${i}`));
    mixed.push({ ...inDiff("F6"), severity: "major" });
    const rec = record("src/Money.php", "reviewer-A", 1, mixed);
    const out = evaluateSuspicion({ record: rec, parsedDiff: parsed, verdictText: "{}", priorNormalizedText: null });
    expect(out.reasons).not.toContain("all-blockers-over-cap");
  });
});

describe("suspicion predicate (in-step verbatim-repeat)", () => {
  const parsed = parseUnifiedDiff(SAMPLE_DIFF);

  test("identical reply text on the same step+diff -> suspect", () => {
    const text = '{"file":"x","findings":[]}';
    const out = evaluateSuspicion({
      record: record("src/Money.php", "reviewer-A", 1, []),
      parsedDiff: parsed,
      verdictText: text,
      priorNormalizedText: normalizeVerdictText(text),
    });
    expect(out.suspect).toBe(true);
    expect(out.reasons).toEqual(["verbatim-repeat"]);
  });

  test("normalization canonicalizes JSON: key order and whitespace never mask a repeat", () => {
    expect(normalizeVerdictText('{"a": 1, "b": [2, 3]}')).toBe(
      normalizeVerdictText('{"b":[2,3],"a":1}'),
    );
  });

  test("a genuinely different reply is NOT a repeat; first reply (null prior) never is", () => {
    const rec = record("src/Money.php", "reviewer-A", 1, []);
    expect(
      evaluateSuspicion({ record: rec, parsedDiff: parsed, verdictText: '{"a":1}', priorNormalizedText: null })
        .suspect,
    ).toBe(false);
    expect(
      evaluateSuspicion({
        record: rec,
        parsedDiff: parsed,
        verdictText: '{"a":2}',
        priorNormalizedText: normalizeVerdictText('{"a":1}'),
      }).suspect,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// US-006: repair paths through runReviewTurn (scripted harness, offline)
// ---------------------------------------------------------------------------

/** Valid, non-suspect verdict (1 in-diff finding) as a raw reply text. */
const HEALTHY_REPLY = JSON.stringify({
  file: "src/Money.php",
  reviewer: "reviewer-A",
  round: 1,
  diff_id: "diff-f-r1",
  findings: [
    {
      finding_id: "A1",
      severity: "major",
      description: "add() does not guard against mixed currencies",
      evidence_span: { start_line: DIFF_HEADER_LINES + 8, end_line: DIFF_HEADER_LINES + 8, snippet: "add(other: Money): Money {" },
      disposition: "fix",
    },
  ],
  citation_check: [{ finding_id: "A1", p_cited: 1 }],
});

/** Schema-VALID but suspect reply: 6 findings, all blocker (arm b). */
function wallReply(tag: string): string {
  const findings = [1, 2, 3, 4, 5, 6].map((i) => ({
    finding_id: `${tag}${i}`,
    severity: "blocker",
    description: `wall-of-blockers finding ${i}`,
    evidence_span: {
      // raw lines 7..11 = the first five body lines (raw 6 is the @@ header)
      start_line: DIFF_HEADER_LINES + 7 + (i % 5),
      end_line: DIFF_HEADER_LINES + 7 + (i % 5),
      snippet: ["export class Money {", "constructor(readonly cents: number) {}", "add(other: Money): Money {", "return new Money(this.cents + other.cents);", "}"][i % 5],
    },
    disposition: "fix",
  }));
  return JSON.stringify({
    file: "src/Money.php",
    reviewer: "reviewer-A",
    round: 1,
    diff_id: "diff-f-r1",
    findings,
    citation_check: findings.map((f) => ({ finding_id: f.finding_id, p_cited: 1 })),
  });
}

const SEAM_USAGE: SeamUsage = { input: 100, output: 20, reasoning: 5, cacheRead: 0, cacheWrite: 0, cost: 0 };

interface ScriptedHarness extends AgentSessionClient {
  prompts: Array<{ sessionId: string; text: string }>;
  sessions: string[];
  script: Array<string | Error>;
}

/** Deterministic AgentSessionClient double: replies (or throws) in order. */
function scriptedHarness(initialScript: Array<string | Error>): ScriptedHarness {
  let sessionCounter = 0;
  let script = initialScript;
  let step = 0;
  const sessions: string[] = [];
  const prompts: Array<{ sessionId: string; text: string }> = [];
  const self: ScriptedHarness = {
    prompts,
    sessions,
    get script() {
      return script;
    },
    set script(next: Array<string | Error>) {
      script = next;
    },
    createSession(label: string): Promise<SessionRef> {
      const id = `sess-${++sessionCounter}`;
      sessions.push(id);
      return Promise.resolve({ id, title: label });
    },
    prompt(sessionId: string, text: string): Promise<PromptResult> {
      prompts.push({ sessionId, text });
      const next = script[step];
      step++;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ text: next ?? "", usage: SEAM_USAGE, aborted: false });
    },
    abortSessionsNotTagged(): Promise<string[]> {
      return Promise.resolve([]);
    },
  };
  return self;
}

function fakeCtx() {
  const { context, staged } = stagingContext({ flowId: "us006-flow" });
  return { ctx: context, staged };
}

const DIFF_TURN = {
  raw: SAMPLE_DIFF,
  doc: DIFF_DOC,
  diffId: "diff-f-r1",
  bodyLineOffset: DIFF_HEADER_LINES,
};

const FRI: FileRoundInput = {
  repoRoot: "/tmp/us006",
  worktreeRoot: "/tmp/us006/.wt",
  integrationWorktreePath: "/tmp/us006/.wt/integration",
  sourceRoot: "/tmp/us006/src",
  epoch: 1,
  file: "src/Money.php",
  round: 1,
  worktreePath: "/tmp/us006/.wt/src__Money.php",
  branch: "pp-1",
};

function tombstoneOf(v: unknown): VerdictTombstone | null {
  return isVerdictTombstone(v) ? v : null;
}

afterEach(() => {
  // bun test runs files in one process: never leak the scripted harness.
  configurePortHarness(undefined as unknown as AgentSessionClient);
});

describe("repair paths through runReviewTurn", () => {
  beforeEach(() => {
    resetInStepVerdictMemo();
  });

  test("triggered repair: a suspect verdict gets ONE repair re-prompt on the SAME session", async () => {
    const harness = scriptedHarness([wallReply("W"), HEALTHY_REPLY]);
    configurePortHarness(harness);
    const { ctx } = fakeCtx();
    const out = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-A",
      file: "src/Money.php",
      round: 1,
      epoch: 1,
      diff: DIFF_TURN,
      attempt: 1,
    });
    // Exactly two prompts, on the SAME session (same reviewer config).
    expect(harness.prompts.length).toBe(2);
    expect(harness.sessions.length).toBe(1);
    expect(harness.prompts[1]?.sessionId).toBe(harness.prompts[0]?.sessionId);
    // The repair prompt names the deterministic suspicion reason.
    expect(harness.prompts[1]?.text).toContain("all-blockers-over-cap");
    // Repair success: a healthy tuple (not a tombstone), tokens = both turns.
    expect(tombstoneOf(out.verdict)).toBeNull();
    const tuple = out.verdict as ReviewTuple;
    expect(tuple.metrics.findings.length).toBe(1);
    expect(typeof out.tokens === "object" && out.tokens !== null).toBe(true);
    expect((out.tokens as TokenUsage).input_tokens).toBe(200); // 100 + 100
  });

  test("repair-fail (schema) -> tombstone carrying the burned tokens", async () => {
    const harness = scriptedHarness([wallReply("W"), "I cannot comply — no JSON here"]);
    configurePortHarness(harness);
    const { ctx } = fakeCtx();
    const out = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-A",
      file: "src/Money.php",
      round: 1,
      epoch: 1,
      diff: DIFF_TURN,
      attempt: 1,
    });
    expect(harness.prompts.length).toBe(2); // original + ONE repair, then stop
    const tomb = tombstoneOf(out.verdict);
    expect(tomb).not.toBeNull();
    expect(tomb?.discarded).toBe(true);
    expect(tomb?.reviewer).toBe("reviewer-A");
    expect(tomb?.reason.startsWith("repair-failed-schema")).toBe(true);
    expect(tomb?.attempt).toBe(1);
    // tokens = burned tokens of the discarded attempt(s) (original + repair).
    expect(typeof tomb?.tokens).toBe("object");
    expect((tomb?.tokens as TokenUsage | undefined)?.input_tokens).toBe(200);
    expect(out.tokens).toBe(tomb?.tokens ?? null);
  });

  test("repair-still-suspect -> tombstone (repair reply remains a wall of blockers)", async () => {
    const harness = scriptedHarness([wallReply("W"), wallReply("V")]);
    configurePortHarness(harness);
    const { ctx } = fakeCtx();
    const out = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-A",
      file: "src/Money.php",
      round: 1,
      epoch: 1,
      diff: DIFF_TURN,
      attempt: 1,
    });
    const tomb = tombstoneOf(out.verdict);
    expect(tomb).not.toBeNull();
    expect(tomb?.reason.startsWith("repair-still-suspect")).toBe(true);
    expect(tomb?.reason).toContain("all-blockers-over-cap");
  });

  test("in-step verbatim-repeat across attempts: attempt 2 repeating attempt 1's verdict re-triggers repair", async () => {
    const degenerate = new OpencodePromptError("degenerate turn (fixture)", true, SEAM_USAGE);
    // attempt 1: suspect wall -> repair runs but THROWS degenerate -> dex retry.
    const harness = scriptedHarness([wallReply("W"), degenerate]);
    configurePortHarness(harness);
    const { ctx } = fakeCtx();
    await expect(
      runReviewTurn({
        ctx,
        reviewerId: "reviewer-A",
        file: "src/Money.php",
        round: 1,
        epoch: 1,
        diff: DIFF_TURN,
        attempt: 1,
      }),
    ).rejects.toBeInstanceOf(OpencodePromptError);
    expect(harness.prompts.length).toBe(2);

    // attempt 2 (same worker process, same step+diff): THE SAME wall reply —
    // arm (c) fires via the in-step memo, so repair runs and succeeds.
    harness.script.push(wallReply("W"), HEALTHY_REPLY);
    const out = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-A",
      file: "src/Money.php",
      round: 1,
      epoch: 1,
      diff: DIFF_TURN,
      attempt: 2,
    });
    expect(harness.prompts.length).toBe(4); // orig(a1) repair(a1) orig(a2) repair(a2)
    expect(tombstoneOf(out.verdict)).toBeNull();
    const tuple = out.verdict as ReviewTuple;
    expect(tuple.metrics.findings.length).toBe(1);
  });

  test("REGRESSION (fix-wave memo keying): two flows on the same step+diff never inherit each other's replies; a settled execution's entry is cleared", async () => {
    // Pre-fix the memo was keyed by step+diff ONLY (module-global), so flow Y
    // reviewing the same file+round inherited flow X's reply as its "prior
    // attempt" — an identical reply text (the poisoned-cache shape arm (c)
    // targets) triggered a FALSE repair. The key now carries flow/run
    // identity, and a settled execution (verdict returned) clears its entry.
    const ctxWith = (flowId: string, runId: string): Context =>
      ({ ...fakeCtx().ctx, flowId, runId }) as unknown as Context;

    const harness = scriptedHarness([]);
    configurePortHarness(harness);

    // Flow X, attempt 1: healthy reply -> success (the execution ENDS).
    harness.script.push(HEALTHY_REPLY);
    const outX = await runReviewTurn({
      ctx: ctxWith("flow-X", "run-X"),
      reviewerId: "reviewer-A",
      file: "src/Money.php",
      round: 1,
      epoch: 1,
      diff: DIFF_TURN,
      attempt: 1,
    });
    expect(tombstoneOf(outX.verdict)).toBeNull();

    // Flow Y, SAME step+diff, SAME reply text: must NOT see X's reply as a
    // prior (no verbatim-repeat, no repair) — exactly 1 prompt for this call.
    harness.script.push(HEALTHY_REPLY);
    const outY = await runReviewTurn({
      ctx: ctxWith("flow-Y", "run-Y"),
      reviewerId: "reviewer-A",
      file: "src/Money.php",
      round: 1,
      epoch: 1,
      diff: DIFF_TURN,
      attempt: 1,
    });
    expect(tombstoneOf(outY.verdict)).toBeNull();
    expect(harness.prompts.length).toBe(2); // 1 per flow — no repair anywhere

    // A LATER execution under Y's own key also starts clean: Y's settled
    // entry was cleared when its execution ended (no inherited prior).
    harness.script.push(HEALTHY_REPLY);
    const outY2 = await runReviewTurn({
      ctx: ctxWith("flow-Y", "run-Y"),
      reviewerId: "reviewer-A",
      file: "src/Money.php",
      round: 1,
      epoch: 1,
      diff: DIFF_TURN,
      attempt: 2,
    });
    expect(tombstoneOf(outY2.verdict)).toBeNull();
    expect(harness.prompts.length).toBe(3); // still no repair
  });

  test("REGRESSION (fix-wave memo keying, PENDING): a THROWING execution leaves its reply in the memo and another flow's execution on the same step+diff never sees it as a prior", async () => {
    // The settlement test above cannot catch a key that lacks flow/run
    // identity: X settles BEFORE Y runs, so the hygiene delete already
    // emptied the map — step+diff-only keying passes it too. This case
    // deletes nothing first: X's execution THROWS mid-attempt (repair turn
    // degenerates after the reply was memoized), leaving its reply PENDING
    // under X's key. Y (other flow/run, SAME step+diff) then replays the
    // IDENTICAL reply text. Under step+diff-only keying Y inherits X's
    // pending reply as its "prior" and its repair reason gains a FALSE
    // verbatim-repeat; keyed, Y's repair is attributed to its OWN evidence
    // (the wall of blockers) alone.
    const ctxWith = (flowId: string, runId: string): Context =>
      ({ ...fakeCtx().ctx, flowId, runId }) as unknown as Context;

    // Flow X: suspect wall reply -> repair turn throws degenerate -> the
    // execution rejects (attempt 1 < maxAttempts) with its reply PENDING.
    const degenerate = new OpencodePromptError("degenerate turn (fixture)", true, SEAM_USAGE);
    const harness = scriptedHarness([wallReply("W"), degenerate]);
    configurePortHarness(harness);
    await expect(
      runReviewTurn({
        ctx: ctxWith("flow-X", "run-X"),
        reviewerId: "reviewer-A",
        file: "src/Money.php",
        round: 1,
        epoch: 1,
        diff: DIFF_TURN,
        attempt: 1,
      }),
    ).rejects.toBeInstanceOf(OpencodePromptError);
    expect(harness.prompts.length).toBe(2); // X: original + failed repair

    // Flow Y: SAME step+diff, IDENTICAL reply text. Y repairs ONCE — for its
    // OWN all-blockers evidence — and must NOT gain a cross-flow
    // verbatim-repeat reason from X's pending reply.
    harness.script.push(wallReply("W"), HEALTHY_REPLY);
    const outY = await runReviewTurn({
      ctx: ctxWith("flow-Y", "run-Y"),
      reviewerId: "reviewer-A",
      file: "src/Money.php",
      round: 1,
      epoch: 1,
      diff: DIFF_TURN,
      attempt: 1,
    });
    expect(harness.prompts.length).toBe(4); // +Y original +Y ONE repair
    const repairTurn = harness.prompts[3]?.text ?? "";
    expect(repairTurn).toContain("all-blockers-over-cap"); // Y's own arm (b)
    expect(repairTurn).not.toContain("verbatim-repeat"); // never X's reply
    expect(tombstoneOf(outY.verdict)).toBeNull();
    const tupleY = outY.verdict as ReviewTuple;
    expect(tupleY.metrics.findings.length).toBe(1);

    // X's entry intentionally survives the throw (dex's NEXT X attempt reads
    // it); clear it so the pending map never leaks past this test.
    resetInStepVerdictMemo();
  });
});

describe("attempt-exhaustion tombstones (deterministic ctx.attempt >= maxAttempts)", () => {
  beforeEach(() => {
    resetInStepVerdictMemo();
  });

  test("final attempt: a degenerate model failure becomes a tombstone anchored on its usage", async () => {
    const degenerate = new OpencodePromptError(
      "degenerate turn: reply completed with usage but NO text part",
      true,
      SEAM_USAGE,
    );
    const harness = scriptedHarness([degenerate]);
    configurePortHarness(harness);
    const { ctx } = fakeCtx();
    const out = await runReviewTurn({
      ctx,
      reviewerId: "reviewer-A",
      file: "src/Money.php",
      round: 1,
      epoch: 1,
      diff: DIFF_TURN,
      attempt: REVIEW_STEP_MAX_ATTEMPTS,
    });
    const tomb = tombstoneOf(out.verdict);
    expect(tomb).not.toBeNull();
    expect(tomb?.reason.startsWith("attempt-exhausted")).toBe(true);
    expect(tomb?.attempt).toBe(REVIEW_STEP_MAX_ATTEMPTS);
    expect((tomb?.tokens as TokenUsage | undefined)?.input_tokens).toBe(100);
    expect(out.tokens).toBe(tomb?.tokens ?? null);
  });

  test("non-final attempt: the failure still throws (dex retry semantics unchanged)", async () => {
    const degenerate = new OpencodePromptError("degenerate turn (fixture)", true, SEAM_USAGE);
    const harness = scriptedHarness([degenerate]);
    configurePortHarness(harness);
    const { ctx } = fakeCtx();
    await expect(
      runReviewTurn({
        ctx,
        reviewerId: "reviewer-A",
        file: "src/Money.php",
        round: 1,
        epoch: 1,
        diff: DIFF_TURN,
        attempt: 1,
      }),
    ).rejects.toBeInstanceOf(OpencodePromptError);
    expect(harness.prompts.length).toBe(1); // no repair, no tombstone
  });

  test("ReviewAStep completes on an exhausted final attempt and the ENVELOPE carries the tombstone tokens", async () => {
    const degenerate = new OpencodePromptError("degenerate turn (fixture)", true, SEAM_USAGE);
    const harness = scriptedHarness([degenerate]);
    configurePortHarness(harness);
    const stores = new Map<unknown, Map<string, unknown>>([
      [
        ppDiff as unknown,
        new Map<string, unknown>([
          [
            markerKeyOf("src/Money.php", 1),
            {
              diffId: "diff-f-r1",
              raw: SAMPLE_DIFF,
              doc: DIFF_DOC,
              bodyLineOffset: DIFF_HEADER_LINES,
            } satisfies CapturedDiff,
          ],
        ]),
      ],
    ]);
    const ctx = attributeCtx(stores, REVIEW_STEP_MAX_ATTEMPTS);
    const step = new PortFileFlow().reviewA;
    const decision = await step.execute(ctx as never, FRI);
    expect(decision.kind).toBe("next"); // routed onward — the round proceeds
    // The completion envelope is a model-calling review event WITH tokens
    // (provenance-clean) — the tombstoned tokens are on the envelope. The
    // durable store UPSERTS by event key, so the completion (same key as the
    // start event) is the single surviving envelope entry.
    const envelopes = [...stores.get(envelopeEvents as unknown)?.values() ?? []] as EnvelopeEvent[];
    expect(envelopes.length).toBe(1);
    const completed = envelopes[0];
    expect(completed?.stepId).toBe("pp-review-a");
    expect(completed?.outcome).toBe("completed");
    expect(completed?.attempt).toBe(REVIEW_STEP_MAX_ATTEMPTS);
    expect((completed?.tokens as TokenUsage | undefined)?.input_tokens).toBe(100);
  });

  test("REGRESSION (fix-wave diagnosis forwarding): a successful attempt-2 review step's completion envelope carries turn_diagnosis (US-003 successor re-record)", async () => {
    // runReviewTurn returns turnDiagnosis on attempt >= 2, but the review-step
    // inner destructured only {verdict, tokens} and dropped it — the envelope
    // never persisted the successor-attempt diagnosis. Now it is forwarded.
    const harness = scriptedHarness([HEALTHY_REPLY]);
    configurePortHarness(harness);
    const stores = new Map<unknown, Map<string, unknown>>([
      [
        ppDiff as unknown,
        new Map<string, unknown>([
          [
            markerKeyOf("src/Money.php", 1),
            {
              diffId: "diff-f-r1",
              raw: SAMPLE_DIFF,
              doc: DIFF_DOC,
              bodyLineOffset: DIFF_HEADER_LINES,
            } satisfies CapturedDiff,
          ],
        ]),
      ],
    ]);
    const ctx = attributeCtx(stores, 2); // attempt 2 -> the diagnosis is built
    const step = new PortFileFlow().reviewA;
    const decision = await step.execute(ctx as never, FRI);
    expect(decision.kind).toBe("next");
    const envelopes = [...stores.get(envelopeEvents as unknown)?.values() ?? []] as EnvelopeEvent[];
    const completed = envelopes.find((e) => e.ended_at !== null);
    expect(completed?.stepId).toBe("pp-review-a");
    expect(completed?.outcome).toBe("completed");
    expect(completed?.turn_diagnosis).not.toBeNull();
    expect(completed?.turn_diagnosis?.trigger).toBe("retry-context");
    expect(completed?.turn_diagnosis?.attempt).toBe(2);
  });
});

import { envelopeEvents } from "../flows/steps/envelope.js";

// ---------------------------------------------------------------------------
// US-006: VerdictCheckStep tolerates tombstones (zero kept findings)
// ---------------------------------------------------------------------------

const attributeCtx = (stores: AttributeStores, attempt = 1) => stubContext(stores, { flowId: "us006-check", attempt });

function healthyTuple(reviewer: string, round: number): ReviewTuple {
  return {
    agent: {
      file: "src/Money.php",
      reviewer,
      round,
      diff_id: "diff-f-r1",
      findings: [
        {
          finding_id: `${reviewer === "reviewer-A" ? "A" : "B"}1`,
          severity: "major",
          description: "add() does not guard against mixed currencies",
          evidence_span: { start_line: 13, end_line: 13, snippet: "add(other: Money): Money {" },
          disposition: "fix",
        },
      ],
      citation_check: [{ finding_id: `${reviewer === "reviewer-A" ? "A" : "B"}1`, p_cited: 1 }],
    },
    metrics: record("src/Money.php", reviewer, round, [
      {
        finding_id: `${reviewer === "reviewer-A" ? "A" : "B"}1`,
        severity: "major",
        summary: "fix",
        // A REAL quote from the diff body: the naive citation check must
        // pass (p_cited = 1) so the finding survives verdict-check.
        evidence: { hunk_id: "h1", start_line: 8, end_line: 8, quote: "add(other: Money): Money {" },
      },
    ]),
  };
}

function exhaustionTombstone(reviewer: string, attempt: number): VerdictTombstone {
  return {
    reviewer,
    discarded: true,
    reason: "attempt-exhausted: degenerate turn (fixture)",
    attempt,
    tokens: { input_tokens: 100, output_tokens: 0, reasoning_tokens: 32000 },
  };
}

describe("VerdictCheckStep: tombstone tolerance (US-006)", () => {
  const DIFF_ATTR: CapturedDiff = {
    diffId: "diff-f-r1",
    raw: SAMPLE_DIFF,
    doc: DIFF_DOC,
    bodyLineOffset: DIFF_HEADER_LINES,
  };
  const DIFF_KEY = markerKeyOf("src/Money.php", 1);

  function checkStores(verdicts: Record<string, unknown>): Map<unknown, Map<string, unknown>> {
    const stores = new Map<unknown, Map<string, unknown>>();
    stores.set(ppDiff, new Map([[DIFF_KEY, DIFF_ATTR]]));
    stores.set(ppVerdict, new Map(Object.entries(verdicts)));
    return stores;
  }

  test("single-reviewer-discard: the surviving reviewer proceeds; the tombstoned side is dropped", async () => {
    const flow = new PortFileFlow();
    const stores = checkStores({
      [`${DIFF_KEY}#reviewer-A`]: exhaustionTombstone("reviewer-A", 3),
      [`${DIFF_KEY}#reviewer-B`]: healthyTuple("reviewer-B", 1),
    });
    const decision = await flow.verdictCheck.execute(
      attributeCtx(stores) as never,
      FRI,
    );
    expect(decision.kind).toBe("next");
    const movements = (decision as { movements?: Array<{ step: unknown }> }).movements ?? [];
    // The surviving reviewer's finding proceeds to prioritize...
    expect(movements[0]?.step).toBe(flow.prioritize.constructor);
    // ...the tombstoned reviewer contributed ZERO kept findings and the
    // discard is recorded under the existing dropped-findings semantics.
    const keptStore = stores.get(ppKept as unknown)?.get(markerKeyOf("src/Money.php", 1)) as
      | { findings: unknown[]; dropped: Array<{ finding_id: string; reviewer: string; reason: string }> }
      | undefined;
    expect(keptStore?.findings.length).toBe(1);
    const tombRow = keptStore?.dropped.find((d) => d.finding_id === "tombstoned:reviewer-A");
    expect(tombRow?.reviewer).toBe("reviewer-A");
    expect(tombRow?.reason).toContain("attempt-exhausted");
  });

  test("zero-reviewer degraded round: keptCount 0 -> skipped outcome -> commit route (round proceeds)", async () => {
    const flow = new PortFileFlow();
    const stores = checkStores({
      [`${DIFF_KEY}#reviewer-A`]: exhaustionTombstone("reviewer-A", 3),
      [`${DIFF_KEY}#reviewer-B`]: exhaustionTombstone("reviewer-B", 3),
    });
    stores.set(ppKept as unknown, new Map());
    const decision = await flow.verdictCheck.execute(attributeCtx(stores) as never, FRI);
    // keptCount-0 route: commit (the loop PROCEEDS — terminal-success path).
    const movements = (decision as { movements?: Array<{ step: unknown }> }).movements ?? [];
    expect(movements[0]?.step).toBe(flow.commit.constructor);
    const keptStore = stores.get(ppKept as unknown)?.get(markerKeyOf("src/Money.php", 1)) as
      | { findings: unknown[]; dropped: unknown[] }
      | undefined;
    expect(keptStore?.findings.length).toBe(0);
    expect(keptStore?.dropped.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// US-006: prep-loop termination on a fully-discarded prep round
// ---------------------------------------------------------------------------

describe("PrepVerdictCheck + PrepLoopDecision on tombstones (prep-loop termination)", () => {
  const PREP_KEY = markerKeyOf("PORTING.spec.md", 0);
  const PREP_DIFF_ATTR = {
    raw: SAMPLE_DIFF,
    doc: DIFF_DOC,
    diffId: "prep-diff-0",
    bodyLineOffset: DIFF_HEADER_LINES,
    iteration: 0,
  };

  test("both prep reviewers tombstoned -> zero findings -> PrepLoopDecision finalizes (no loopback)", async () => {
    const flow = new PortProjectFlow();
    const runInput = {
      repoRoot: "/tmp/us006",
      worktreeRoot: "/tmp/us006/.wt",
      integrationWorktreePath: "/tmp/us006/.wt/integration",
      sourceRoot: "/tmp/us006/src",
      epoch: 1,
      prepPath: "/tmp/us006/stub-prep.md",
      files: ["src/Money.php"],
      maxRounds: 2,
    };
    const stores = new Map<unknown, Map<string, unknown>>([
      [
        ppPrepVerdict as unknown,
        new Map<string, unknown>([
          [`${PREP_KEY}#reviewer-A`, exhaustionTombstone("reviewer-A", 3)],
          [`${PREP_KEY}#reviewer-B`, exhaustionTombstone("reviewer-B", 3)],
        ]),
      ],
      [ppPrepDiff as unknown, new Map<string, unknown>([["diff", PREP_DIFF_ATTR]])],
      [ppPrepState as unknown, new Map<string, unknown>([["state", { prepIteration: 0 }]])],
      [ppConfig as unknown, new Map<string, unknown>([["config", { maxRounds: 2, prepMaxRounds: 2 }]])],
    ]);
    const check = await flow.prepVerdictCheck.execute(attributeCtx(stores) as never, runInput);
    // PrepVerdictCheck routes onward to the loop decision in all cases...
    const checkMovements = (check as { movements?: Array<{ step: unknown }> }).movements ?? [];
    expect(checkMovements[0]?.step).toBe(flow.prepLoopDecision.constructor);
    // ...and the decision sees ZERO findings -> finalize (revise = false).
    const decision = await flow.prepLoopDecision.execute(attributeCtx(stores) as never, runInput);
    expect(decision.kind).toBe("next");
    const movements = (decision as { movements?: Array<{ step: unknown }> }).movements ?? [];
    expect(movements[0]?.step).toBe(flow.prepFinalize.constructor);
  });
});

// ---------------------------------------------------------------------------
// US-006: degraded marker on the metrics render (AC1/AC2 report surface)
// ---------------------------------------------------------------------------

describe("metrics render: degraded rounds + exhaustion under-count note", () => {
  const envelope: EnvelopeEvent = {
    stepId: "pp-review-a",
    role: "review",
    file: null,
    round: null,
    attempt: 3,
    started_at: "2026-09-26T00:00:00Z",
    ended_at: "2026-09-26T00:00:01Z",
    outcome: "completed",
    tokens: { input_tokens: 100, output_tokens: 0, reasoning_tokens: 32000 },
    wall_clock_ms: 1000,
    identity: "src__Money.php#1",
  };
  const tombstones = [
    { file: "src/Money.php", round: 1, ...exhaustionTombstone("reviewer-A", 3) },
    { file: "src/Money.php", round: 1, ...exhaustionTombstone("reviewer-B", 3) },
  ];

  test("a round with both reviewers tombstoned is DEGRADED, not clean", () => {
    const rendered = renderReport({ envelopes: [envelope], verdicts: [], tombstones, burnDown: [] });
    const fr = rendered.json.file_rounds.find((r) => r.file === "src/Money.php");
    expect(fr?.degraded).toBe(true);
    expect(fr?.agreement.outcome).toBe("unreviewed");
    expect(fr?.tombstones.length).toBe(2);
    expect(rendered.json.summary.degraded_round_count).toBe(1);
    expect(rendered.json.summary.tombstoned_reviewer_count).toBe(2);
    expect(rendered.json.summary.exhausted_attempt_tombstones).toBe(2);
    expect(rendered.markdown).toContain("DEGRADED");
    expect(rendered.markdown).toContain("unreviewed");
  });

  test("the AC2 exhaustion token under-count is stated explicitly", () => {
    const rendered = renderReport({ envelopes: [envelope], verdicts: [], tombstones, burnDown: [] });
    expect(rendered.markdown).toContain("token under-count (attempt exhaustion)");
    expect(rendered.markdown).toContain("attempts 1..n-1");
  });

  test("a single discarded reviewer is surfaced but the round is NOT degraded", () => {
    const rendered = renderReport({
      envelopes: [envelope],
      verdicts: [record("src/Money.php", "reviewer-B", 1, [])],
      tombstones: [tombstones[0] as (typeof tombstones)[number]],
      burnDown: [],
    });
    const fr = rendered.json.file_rounds.find((r) => r.file === "src/Money.php");
    expect(fr?.degraded).toBe(false);
    expect(rendered.json.summary.degraded_round_count).toBe(0);
  });

  test("no tombstones -> no degraded surfaces (byte-identical legacy shape)", () => {
    const rendered = renderReport({ envelopes: [envelope], verdicts: [], burnDown: [] });
    expect(rendered.json.summary.degraded_round_count).toBe(0);
    expect(rendered.markdown).not.toContain("DEGRADED");
  });
});

// ---------------------------------------------------------------------------
// US-006: degraded marker on /api/state + the dashboard headline
// ---------------------------------------------------------------------------

describe("dashboard: degraded rounds on /api/state and the headline", () => {
  function stateWireWith(verdictAttrs: Array<{ key: string; value: unknown }>): DexStateWire {
    return { activeStepExecutions: [], attributes: verdictAttrs };
  }

  test("degradedRoundsOf: >= 2 tombstones and no completed record for the round", () => {
    const state = stateWireWith([
      { key: "pp-verdict/src__Money.php#1#reviewer-A", value: exhaustionTombstone("reviewer-A", 3) },
      { key: "pp-verdict/src__Money.php#1#reviewer-B", value: exhaustionTombstone("reviewer-B", 3) },
    ]);
    const rounds = degradedRoundsOf("flow-1", state);
    expect(rounds.length).toBe(1);
    expect(rounds[0]?.flowId).toBe("flow-1");
    expect(rounds[0]?.file).toBe("src/Money.php");
    expect(rounds[0]?.round).toBe(1);
    expect(rounds[0]?.reviewers).toEqual(["reviewer-A", "reviewer-B"]);
  });

  test("a completed record on the round suppresses the degraded marker", () => {
    const state = stateWireWith([
      { key: "pp-verdict/src__Money.php#1#reviewer-A", value: exhaustionTombstone("reviewer-A", 3) },
      { key: "pp-verdict/src__Money.php#1#reviewer-B", value: healthyTuple("reviewer-B", 1) },
      { key: "pp-verdict/src__Money.php#2#reviewer-A", value: exhaustionTombstone("reviewer-A", 3) },
      { key: "pp-verdict/src__Money.php#2#reviewer-B", value: exhaustionTombstone("reviewer-B", 3) },
    ]);
    const rounds = degradedRoundsOf("flow-1", state);
    expect(rounds.length).toBe(1);
    expect(rounds[0]?.round).toBe(2);
  });

  test("the headline carries the DEGRADED marker for a terminal degraded run", () => {
    const flow = {
      flowId: "cx-6",
      flowType: "port.Project",
      status: "completed",
      startTime: "2026-09-26T00:00:00Z",
      closeTime: "2026-09-26T01:00:00Z",
      runId: "run-1",
    };
    const headline = lifecycleHeadline({
      flow,
      filesDone: 1,
      filesTotal: 1,
      killEvents: [],
      dexAvailable: true,
      feed: [],
      degradedRounds: 1,
    });
    expect(headline).toContain("DEGRADED (1 unreviewed round)");
    expect(headline).toContain("completed");
    // Zero degraded rounds -> no marker.
    const clean = lifecycleHeadline({ flow, filesDone: 1, filesTotal: 1, killEvents: [], dexAvailable: true, feed: [] });
    expect(clean).not.toContain("DEGRADED");
  });

  test("buildDashboardState surfaces degradedRounds and folds them into the headline", () => {
    const summary: DexFlowSummaryWire = {
      flowId: "cx-6",
      flowType: "port.Project",
      flowStatus: "FLOW_STATUS_COMPLETED",
      flowStatusCode: 3,
      startTime: "2026-09-26T00:00:00Z",
      closeTime: "2026-09-26T01:00:00Z",
      runId: "run-1",
    };
    const state = buildDashboardState({
      now: "2026-09-26T02:00:00Z",
      dex: {
        available: true,
        error: null,
        detail: null,
        flows: [summary],
        states: {
          "cx-6": stateWireWith([
            { key: "pp-verdict/src__Money.php#1#reviewer-A", value: exhaustionTombstone("reviewer-A", 3) },
            { key: "pp-verdict/src__Money.php#1#reviewer-B", value: exhaustionTombstone("reviewer-B", 3) },
          ]),
        },
        histories: {},
      },
      git: { available: false, error: null, repoRoot: "/tmp/x", commits: [], worktrees: [] },
      killEvents: { available: false, error: null, filesScanned: [], events: [] },
      burnDownFiles: [],
      feedLimit: 50,
      commitLimit: 50,
    });
    expect(state.degradedRounds.length).toBe(1);
    expect(state.degradedRounds[0]?.file).toBe("src/Money.php");
    expect(state.headline).toContain("DEGRADED (1 unreviewed round)");
  });
});
