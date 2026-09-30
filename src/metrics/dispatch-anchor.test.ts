import { describe, expect, test } from "bun:test";
import {
  NON_AGENT_DEX_KINDS,
  PORT_FLOW_STEPS,
  anchorDispatch,
  anchorForRun,
  classifyDispatchStepType,
  extractDispatchEntries,
  fileFromIdentity,
  identityKeyOf,
  specForStepType,
  specsForStepId,
  type DispatchEntry,
  type DispatchHistory,
} from "./dispatch-anchor.js";
import { type EnvelopeEvent } from "./types.js";
import historyARaw from "./fixtures/dex-history-run-a.json" with { type: "json" };
import runAEnvelopesRaw from "./fixtures/event-stream-run-a.json" with { type: "json" };

const historyA = historyARaw as unknown as DispatchHistory;
const runAEnvelopes = (runAEnvelopesRaw as unknown as { envelopes: EnvelopeEvent[] }).envelopes;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

let execCounter = 0;

function envelope(overrides: Partial<EnvelopeEvent> & { stepId: string; role: EnvelopeEvent["role"] }): EnvelopeEvent {
  return {
    file: null,
    round: null,
    attempt: 1,
    started_at: "2026-09-25T10:00:00.000Z",
    ended_at: "2026-09-25T10:01:00.000Z",
    outcome: "completed",
    tokens: null,
    wall_clock_ms: 1000,
    identity: null,
    ...overrides,
  };
}

function entry(
  stepType: string,
  finalAttempt: number,
  identity: string | null,
): DispatchEntry {
  execCounter += 1;
  return { stepExecutionId: `exec-${execCounter}`, stepType, finalAttempt, identity };
}

/** A minimal consistent per-file model execution: marker + attempt-N envelope. */
function modelExecution(stepId: string, stepType: string, identity: string, attempt: number): EnvelopeEvent[] {
  const role = stepId === "pp-review-a" || stepId === "pp-review-b" ? "review" : "agent";
  const out: EnvelopeEvent[] = [
    envelope({ stepId, role, attempt: 0, outcome: "interrupted", ended_at: null, tokens: null, wall_clock_ms: null, identity }),
  ];
  for (let a = 1; a <= attempt; a++) {
    out.push(envelope({ stepId, role, attempt: a, tokens: 100 * a, identity }));
  }
  return out;
}

// ---------------------------------------------------------------------------
// wire extraction
// ---------------------------------------------------------------------------

describe("extractDispatchEntries (dexcli history -> dispatch entries)", () => {
  test("skips events without a step dispatch context and reads identity from the input echo", () => {
    const history: DispatchHistory = {
      events: [
        { eventId: "e1", type: "FlowStartedOrContinued", payload: { initialStart: {} } },
        {
          eventId: "e2",
          type: "StepStarted",
          payload: {
            context: { stepExecutionId: "x1", stepType: "PpImplement", finalAttempt: 2 },
            input: { stepInput: { file: "src/A.php", round: 3, repoRoot: "/r" } },
          },
        },
        {
          eventId: "e3",
          type: "StepStarted",
          payload: {
            context: { stepExecutionId: "x2", stepType: "PpCommit" }, // no finalAttempt -> defaults 1
            movement: { stepInput: { file: "src/B.php", round: 1 } },
          },
        },
        { eventId: "e4", payload: { context: { stepType: 42 } } }, // non-string type -> skipped
        { eventId: "e5" }, // no payload at all -> skipped
      ],
    };
    const entries = extractDispatchEntries(history);
    expect(entries).toEqual([
      { stepExecutionId: "x1", stepType: "PpImplement", finalAttempt: 2, identity: "src__A.php#3" },
      { stepExecutionId: "x2", stepType: "PpCommit", finalAttempt: 1, identity: "src__B.php#1" },
    ]);
  });

  test("finalAttempt defaults to 1 when absent or invalid", () => {
    const entries = extractDispatchEntries({
      events: [
        { payload: { context: { stepExecutionId: "a", stepType: "PpPrep", finalAttempt: 0 } } },
        { payload: { context: { stepExecutionId: "b", stepType: "PpPrep", finalAttempt: "x" } } },
      ],
    });
    expect(entries.map((e) => e.finalAttempt)).toEqual([1, 1]);
  });

  test("recorded run-a history extracts 57 entries including 3 non-agent kinds", () => {
    const entries = extractDispatchEntries(historyA);
    expect(entries.length).toBe(57);
    expect(entries.filter((e) => classifyDispatchStepType(e.stepType) === "non-agent").length).toBe(3);
  });
});

describe("identity + step table helpers", () => {
  test("identityKeyOf sanitizes slashes exactly like the flow's markerKeyOf", () => {
    expect(identityKeyOf("src/Auth/LdapAuth.php", 2)).toBe("src__Auth__LdapAuth.php#2");
  });

  test("fileFromIdentity round-trips the sanitized identity (best effort)", () => {
    const round = fileFromIdentity(identityKeyOf("src/Auth/LdapAuth.php", 2));
    expect(round).toEqual({ file: "src/Auth/LdapAuth.php", round: 2 });
    expect(fileFromIdentity("no-hash")).toBeNull();
    expect(fileFromIdentity("weird#notanumber")).toBeNull();
  });

  test("step table: model steps have marker + model specs sharing the target role", () => {
    expect(specsForStepId("pp-implement").map((s) => s.kind)).toEqual(["marker", "model"]);
    const model = specForStepType("PpImplement");
    expect(model?.role).toBe("agent");
    expect(specForStepType("PpImplementStart")?.role).toBe("agent");
    expect(specForStepType("Nope")).toBeNull();
    // Phase 3/4 (worker-1b mirror): implement, review-a, review-b, fixer,
    // symbol-table, prep-generate, prep-review-a, prep-review-b, prep-revise,
    // queue-fix.
    expect(PORT_FLOW_STEPS.filter((s) => s.kind === "model").length).toBe(10);
  });

  test("classifyDispatchStepType: flow steps, non-agent dex kinds (case-insensitive), unknown", () => {
    expect(classifyDispatchStepType("PpCommit")).toBe("flow-step");
    for (const kind of NON_AGENT_DEX_KINDS) {
      expect(classifyDispatchStepType(kind)).toBe("non-agent");
      expect(classifyDispatchStepType(kind.toUpperCase())).toBe("non-agent");
    }
    expect(classifyDispatchStepType("PpEvil")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// anchoring rules
// ---------------------------------------------------------------------------

describe("anchorDispatch — clean mappings", () => {
  test("retry fan-out: 1 envelope (final attempt) : N dispatch entries anchors clean", () => {
    const envelopes = modelExecution("pp-implement", "PpImplement", "src__X.php#1", 2);
    const entries = [
      entry("PpImplementStart", 1, "src__X.php#1"),
      entry("PpImplement", 1, "src__X.php#1"),
      entry("PpImplement", 2, "src__X.php#1"),
    ];
    const result = anchorDispatch(envelopes, entries);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    const group = result.groups.find((g) => g.stepType === "PpImplement");
    expect(group).toMatchObject({
      identity: "src__X.php#1",
      envelope_attempt: 2,
      dispatch_final_attempt: 2,
      dispatch_count: 2,
      ok: true,
    });
    // 3 envelopes (marker + attempt 1 + attempt 2) all anchored
    expect(result.envelopes_anchored).toBe(3);
  });

  test("non-agent dex kinds carry no envelopes and are allowed", () => {
    const result = anchorDispatch(
      [],
      [entry("timer", 1, null), entry("condition", 1, null), entry("channel", 1, null), entry("record", 1, null)],
    );
    expect(result.ok).toBe(true);
    expect(result.non_agent_dispatch_entries).toBe(4);
    expect(result.unexplained_dispatch_entries).toBe(0);
  });

  test("live shape (worker-1c): the start mini-step's own ':start' envelope anchors under its marker spec", () => {
    // Live stream per model step X: X#0 (attempt-0 marker, role = target role),
    // X:start#1 (the mini-step's OWN envelope, role record), X#1 (the model
    // envelope) — plus dispatch entries for the Start and model step types.
    const envelopes: EnvelopeEvent[] = [
      envelope({ stepId: "pp-implement", role: "agent", attempt: 0, outcome: "interrupted", ended_at: null, wall_clock_ms: null, identity: "src__X.php#1" }),
      envelope({ stepId: "pp-implement:start", role: "record", attempt: 1, tokens: null, wall_clock_ms: 5, identity: "src__X.php#1" }),
      envelope({ stepId: "pp-implement", role: "agent", attempt: 1, tokens: 100, identity: "src__X.php#1" }),
    ];
    const entries = [
      entry("PpImplementStart", 1, "src__X.php#1"),
      entry("PpImplement", 1, "src__X.php#1"),
    ];
    const result = anchorDispatch(envelopes, entries);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.envelopes_anchored).toBe(3);
    // No "does not match any known port-flow step type mapping" for :start ids.
    expect(result.failures.some((f) => f.includes(":start"))).toBe(false);
  });

  test("empty inputs anchor vacuously", () => {
    const result = anchorDispatch([], []);
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  test("flow-level dispatch entries (identity null) anchor flow-level envelopes", () => {
    const envelopes = [
      envelope({ stepId: "pp-prep", role: "record" }),
      envelope({ stepId: "pp-final", role: "record" }),
    ];
    const result = anchorDispatch(envelopes, [entry("PpPrep", 1, null), entry("PpFinal", 1, null)]);
    expect(result.ok).toBe(true);
    expect(result.envelopes_anchored).toBe(2);
  });
});

describe("anchorDispatch — failures", () => {
  test("envelope without a dispatch entry of matching type fails", () => {
    const envelopes = modelExecution("pp-implement", "PpImplement", "src__X.php#1", 1);
    const result = anchorDispatch(envelopes, [entry("PpImplementStart", 1, "src__X.php#1")]);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) =>
        f.includes("pp-implement (src__X.php#1) has no dispatch entry of type PpImplement"),
      ),
    ).toBe(true);
  });

  test("unexplained agent-kind dispatch entry (dispatch without envelope) fails", () => {
    const result = anchorDispatch([], [entry("PpReviewB", 2, "src__Y.php#1")]);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) =>
        f.includes('dispatch entry(ies) of type PpReviewB (src__Y.php#1) reached finalAttempt 2 with no matching envelope'),
      ),
    ).toBe(true);
  });

  test("dispatch finalAttempt beyond the envelope attempt fails (lost envelope for the final attempt)", () => {
    const envelopes = modelExecution("pp-review-a", "PpReviewA", "src__Y.php#1", 1);
    const entries = [
      entry("PpReviewAStart", 1, "src__Y.php#1"),
      entry("PpReviewA", 2, "src__Y.php#1"),
    ];
    const result = anchorDispatch(envelopes, entries);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) =>
        f.includes("reached finalAttempt 2 beyond envelope attempt 1"),
      ),
    ).toBe(true);
  });

  test("envelope attempt exceeding every dispatched finalAttempt fails", () => {
    const envelopes = modelExecution("pp-fixer", "PpFixer", "src__Z.php#1", 3);
    const entries = [
      entry("PpFixerStart", 1, "src__Z.php#1"),
      entry("PpFixer", 1, "src__Z.php#1"),
      entry("PpFixer", 2, "src__Z.php#1"),
    ];
    const result = anchorDispatch(envelopes, entries);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) =>
        f.includes("attempt 3 exceeds max dispatched finalAttempt 2"),
      ),
    ).toBe(true);
  });

  test("identity-keyed reconciliation across files: a missing dispatch for one file fails only that identity", () => {
    const envelopes = [
      ...modelExecution("pp-implement", "PpImplement", "src__A.php#1", 1),
      ...modelExecution("pp-implement", "PpImplement", "src__B.php#1", 1),
    ];
    const entries = [
      entry("PpImplementStart", 1, "src__A.php#1"),
      entry("PpImplement", 1, "src__A.php#1"),
      // nothing dispatched for src__B.php#1
    ];
    const result = anchorDispatch(envelopes, entries);
    expect(result.ok).toBe(false);
    // Both the model dispatch (PpImplement) and the marker dispatch
    // (PpImplementStart) are missing for src__B.php#1 — and ONLY for it.
    const missingB = result.failures.filter(
      (f) => f.includes("src__B.php#1") && f.includes("has no dispatch entry of type"),
    );
    expect(missingB.length).toBe(2);
    expect(missingB.some((f) => f.endsWith("of type PpImplement"))).toBe(true);
    expect(missingB.some((f) => f.endsWith("of type PpImplementStart"))).toBe(true);
    expect(result.failures.some((f) => f.includes("src__A.php#1") && f.includes("no dispatch entry"))).toBe(false);
    // the A-file envelopes (marker + attempt 1) anchored fine; B's did not
    expect(result.envelopes_anchored).toBe(2);
  });

  test("model-calling envelope without its M4 attempt-0 start marker fails", () => {
    const envelopes = [
      envelope({ stepId: "pp-implement", role: "agent", tokens: 500, identity: "src__X.php#1" }),
    ];
    const entries = [entry("PpImplement", 1, "src__X.php#1")];
    const result = anchorDispatch(envelopes, entries);
    expect(result.ok).toBe(false);
    expect(result.model_steps_missing_start_marker).toBe(1);
    expect(result.failures.some((f) => f.includes("has no attempt-0 start marker"))).toBe(true);
  });

  test("marker dispatch entry without its attempt-0 marker envelope fails (presence, not equality)", () => {
    const result = anchorDispatch(
      modelExecution("pp-implement", "PpImplement", "src__X.php#1", 1),
      [
        entry("PpImplement", 1, "src__X.php#1"),
        entry("PpImplementStart", 1, "src__W.php#9"), // marker dispatched for another identity
      ],
    );
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) =>
        f.includes("PpImplementStart (src__W.php#9) with no matching attempt-0 start-marker envelope"),
      ),
    ).toBe(true);
  });

  test("envelope role contradicting the flow spec fails", () => {
    const envelopes = [envelope({ stepId: "pp-commit", role: "agent", identity: "src__X.php#1" })];
    const entries = [entry("PpCommit", 1, "src__X.php#1")];
    const result = anchorDispatch(envelopes, entries);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.includes('role "agent" does not match flow spec role "commit"')),
    ).toBe(true);
  });

  test("envelope with an unknown stepId fails the typed mapping", () => {
    const result = anchorDispatch([envelope({ stepId: "pp-ghost", role: "record" })], []);
    expect(result.ok).toBe(false);
    expect(
      result.failures.some((f) => f.includes("pp-ghost#1 does not match any known port-flow step type mapping")),
    ).toBe(true);
  });

  test("unknown dispatch step types fail; requireStartMarkers can be disabled", () => {
    const envelopes = [
      envelope({ stepId: "pp-implement", role: "agent", tokens: 10, identity: "src__X.php#1" }),
    ];
    const entries = [entry("PpImplement", 1, "src__X.php#1"), entry("PpEvil", 2, null)];
    const strict = anchorDispatch(envelopes, entries);
    expect(strict.unexplained_dispatch_entries).toBe(1);
    expect(strict.ok).toBe(false);

    const lax = anchorDispatch(envelopes, entries.filter((e) => e.stepType === "PpImplement"), {
      requireStartMarkers: false,
    });
    expect(lax.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// integration entry (worker-1b evidence run)
// ---------------------------------------------------------------------------

describe("anchorForRun (recorded fixtures, end to end)", () => {
  test("healthy run: typed 1:N mapping holds", () => {
    const cross = anchorForRun(historyA, runAEnvelopes);
    expect(cross.ok).toBe(true);
    expect(cross.failures).toEqual([]);
    expect(cross.anchor.envelopes_anchored).toBe(54);
    expect(cross.anchor.dispatch_entries_total).toBe(57);
    expect(cross.anchor.non_agent_dispatch_entries).toBe(3);
  });

  test("result shape is {ok, failures, anchor} for the Phase 5/7 evidence run", () => {
    const cross = anchorForRun({ events: [] }, []);
    expect(Object.keys(cross).sort()).toEqual(["anchor", "failures", "ok"]);
    expect(cross.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C47: dispatch entries count step execution ATTEMPTS, not history events.
// ---------------------------------------------------------------------------

describe("extractDispatchEntries dedupes multi-event executions (C47)", () => {
  const ev = (type: string, id: string, stepType: string, finalAttempt: number, echo?: { file: string; round: number }) => ({
    eventId: `${type}-${id}-${finalAttempt}`,
    type,
    payload: {
      context: { stepExecutionId: id, stepType, finalAttempt },
      ...(echo !== undefined ? { input: { stepInput: echo } } : {}),
    },
  });

  test("one execution emitting started + execute-completed + waitFor events is ONE entry", () => {
    const history: DispatchHistory = {
      events: [
        ev("StepStarted", "x1", "PpImplement", 1),
        ev("StepExecuteCompleted", "x1", "PpImplement", 1),
        ev("StepWaitForStarted", "x1", "PpImplement", 1),
        ev("StepWaitForCompleted", "x1", "PpImplement", 1),
      ],
    };
    expect(extractDispatchEntries(history).length).toBe(1);
  });

  test("retries stay distinct: a new finalAttempt (same or new execution id) is a new entry", () => {
    const history: DispatchHistory = {
      events: [
        ev("StepExecuteFailed", "x1", "PpReviewA", 1),
        ev("StepExecuteFailed", "x1", "PpReviewA", 2),
        ev("StepExecuteCompleted", "x1", "PpReviewA", 3),
        ev("StepWaitForCompleted", "x1", "PpReviewA", 3),
        ev("StepStarted", "x2", "PpReviewA", 1),
      ],
    };
    const entries = extractDispatchEntries(history);
    expect(entries.map((e) => `${e.stepExecutionId}@${e.finalAttempt}`)).toEqual(["x1@1", "x1@2", "x1@3", "x2@1"]);
  });

  test("the duplicate that carries the file+round echo supplies the identity", () => {
    const history: DispatchHistory = {
      events: [
        ev("StepStarted", "x1", "PpImplement", 1),
        ev("StepExecuteCompleted", "x1", "PpImplement", 1, { file: "src/A.php", round: 2 }),
      ],
    };
    const entries = extractDispatchEntries(history);
    expect(entries.length).toBe(1);
    expect(entries[0]?.identity).toBe("src__A.php#2");
  });

  test("events without a stepExecutionId cannot be deduped and each count", () => {
    const history: DispatchHistory = {
      events: [{ payload: { context: { stepType: "PpPrep" } } }, { payload: { context: { stepType: "PpPrep" } } }],
    };
    expect(extractDispatchEntries(history).length).toBe(2);
  });

  test("dispatch_entries_total in the anchor result counts executions, not events (multi-event history)", () => {
    const history: DispatchHistory = {
      events: [
        ev("StepStarted", "m1", "PpImplementStart", 1, { file: "src/A.php", round: 1 }),
        ev("StepExecuteCompleted", "m1", "PpImplementStart", 1, { file: "src/A.php", round: 1 }),
        ev("StepStarted", "i1", "PpImplement", 1, { file: "src/A.php", round: 1 }),
        ev("StepExecuteCompleted", "i1", "PpImplement", 1, { file: "src/A.php", round: 1 }),
        ev("StepWaitForCompleted", "i1", "PpImplement", 1, { file: "src/A.php", round: 1 }),
      ],
    };
    const identity = "src__A.php#1";
    const cross = anchorForRun(history, [
      envelope({ stepId: "pp-implement", role: "agent", attempt: 0, outcome: "interrupted", ended_at: null, wall_clock_ms: null, identity }),
      envelope({ stepId: "pp-implement", role: "agent", attempt: 1, tokens: 10, identity }),
    ]);
    expect(cross.anchor.dispatch_entries_total).toBe(2);
    expect(cross.ok).toBe(true);
  });
});
