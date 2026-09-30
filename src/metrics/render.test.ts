import { describe, expect, test } from "bun:test";
import { renderReport, runProvenanceCrossCheck, validateProvenance } from "./render.js";
import { type EnvelopeEvent, type KillEventsFile, type QueueBurnDownEvent, type VerdictRecord } from "./types.js";
import runARaw from "./fixtures/event-stream-run-a.json" with { type: "json" };
import runBRaw from "./fixtures/event-stream-run-b.json" with { type: "json" };
import killARaw from "./fixtures/kill-events-run-a.json" with { type: "json" };
import historyARaw from "./fixtures/dex-history-run-a.json" with { type: "json" };
import historyBRaw from "./fixtures/dex-history-run-b.json" with { type: "json" };

interface EventStreamFixture {
  envelopes: EnvelopeEvent[];
  verdicts: VerdictRecord[];
  burn_down: QueueBurnDownEvent[];
}

// Recorded fixture streams (JSON import types are widened; the fixtures are
// exercised by these assertions themselves).
const runA = runARaw as unknown as EventStreamFixture;
const runB = runBRaw as unknown as EventStreamFixture;
const killA = killARaw as unknown as KillEventsFile;
const historyA = historyARaw as unknown as Parameters<typeof runProvenanceCrossCheck>[0]["history"];
const historyB = historyBRaw as unknown as Parameters<typeof runProvenanceCrossCheck>[0]["history"];

describe("renderReport against recorded fixture events (run-a + dex history)", () => {
  const rendered = renderReport({
    envelopes: runA.envelopes,
    verdicts: runA.verdicts,
    burnDown: runA.burn_down,
    killEvents: killA,
    history: historyA,
    generatedAt: "2026-09-25T12:00:00.000Z",
  });

  test("provenance AND the typed dispatch anchor are both clean", () => {
    expect(rendered.json.provenance_ok).toBe(true);
    expect(rendered.json.provenance_failures).toEqual([]);
    expect(rendered.json.dispatch_anchor).not.toBeNull();
    expect(rendered.json.dispatch_anchor?.ok).toBe(true);
    expect(rendered.json.dispatch_anchor?.failures).toEqual([]);
  });

  test("dispatch anchor summary: every envelope anchored, retries visible, non-agent kinds allowed", () => {
    const anchor = rendered.json.dispatch_anchor;
    expect(anchor?.envelopes_anchored).toBe(54);
    expect(anchor?.dispatch_entries_total).toBe(57);
    expect(anchor?.non_agent_dispatch_entries).toBe(3);
    expect(anchor?.unexplained_dispatch_entries).toBe(0);
    expect(anchor?.model_steps_missing_start_marker).toBe(0);
    const fixerF1 = anchor?.groups.find(
      (g) => g.stepType === "PpFixer" && g.identity === "src__Auth__LdapAuth.php#1",
    );
    // 1 envelope : 2 retry dispatch entries, finalAttempt 2 == envelope attempt 2
    expect(fixerF1).toEqual({
      stepType: "PpFixer",
      identity: "src__Auth__LdapAuth.php#1",
      kind: "model",
      envelope_attempt: 2,
      dispatch_final_attempt: 2,
      dispatch_count: 2,
      ok: true,
    });
  });

  test("agreement outcomes per file+round: disagree, agree-clean, agree, unreviewed, disagree", () => {
    expect(
      rendered.json.file_rounds.map((fr) => `${fr.file}#${fr.round}:${fr.agreement.outcome}`),
    ).toEqual([
      "src/Auth/LdapAuth.php#1:disagree",
      "src/Util/Csv.php#1:agree-clean",
      "src/Util/RateLimiter.php#1:agree",
      "src/Util/RateLimiter.php#2:unreviewed",
      "src/Util/SizeFormatter.php#1:disagree",
    ]);
  });

  test("citation-check probabilities are carried into the report", () => {
    const ldap = rendered.json.file_rounds[0];
    expect(ldap?.citation_checks).toEqual([
      { finding_id: "F1", p_cited: 1 },
      { finding_id: "F2", p_cited: 1 },
      { finding_id: "F1", p_cited: 1 },
      { finding_id: "F2", p_cited: 1 },
    ]);
    const sizeFormatter = rendered.json.file_rounds[4];
    expect(sizeFormatter?.citation_checks[0]?.p_cited).toBeCloseTo(0.4, 5);
  });

  test("summary: markers excluded from token totals and interrupted counts", () => {
    expect(rendered.json.summary.envelope_count).toBe(54);
    expect(rendered.json.summary.start_marker_count).toBe(15);
    expect(rendered.json.summary.interrupted_envelope_count).toBe(1);
    expect(rendered.json.summary.verdict_record_count).toBe(8);
    expect(rendered.json.summary.tokens_model_roles).toBe(15640);
    expect(rendered.json.summary.wall_clock_ms_total).toBe(1049996);
    expect(rendered.json.summary.files).toEqual([
      "src/Auth/LdapAuth.php",
      "src/Util/Csv.php",
      "src/Util/RateLimiter.php",
      "src/Util/SizeFormatter.php",
    ]);
  });

  test("tokens per file per role: identity-derived files, summed totals, n/a when incomplete", () => {
    const agent = rendered.json.tokens_by_file_role.find(
      (r) => r.file === "src/Auth/LdapAuth.php" && r.role === "agent",
    );
    // pp-implement 2000 + pp-fixer 1050 + 1000 over 3 real attempts (marker excluded)
    expect(agent).toEqual({
      file: "src/Auth/LdapAuth.php",
      role: "agent",
      steps: 3,
      tokens: 4050,
      wall_clock_ms: 235000,
    });
    const flowRecord = rendered.json.tokens_by_file_role.find(
      (r) => r.file === "(flow)" && r.role === "record",
    );
    expect(flowRecord).toEqual({
      file: "(flow)",
      role: "record",
      steps: 3,
      tokens: null,
      wall_clock_ms: 16,
    });
    const interruptedReview = rendered.json.tokens_by_file_role.find(
      (r) => r.file === "src/Util/RateLimiter.php" && r.role === "review",
    );
    // round-2 reviewer was killed mid-turn (null tokens) -> aggregate is n/a
    expect(interruptedReview).toEqual({
      file: "src/Util/RateLimiter.php",
      role: "review",
      steps: 3,
      tokens: null,
      wall_clock_ms: 160200,
    });
  });

  test("fixer retry counts per file (stepId pp-fixer, attempt > 1)", () => {
    expect(rendered.json.fixer_retries).toEqual([
      { file: "src/Auth/LdapAuth.php", retries: 1 },
      { file: "src/Util/RateLimiter.php", retries: 0 },
    ]);
  });

  test("queue burn-down across iterations", () => {
    expect(rendered.json.queue_burn_down).toEqual([
      {
        queue: "tsc",
        iterations: [
          {
            iteration: 1,
            error_count: 6,
            per_file: [
              { file: "src/Auth/LdapAuth.php", error_count: 3 },
              { file: "src/Util/Csv.php", error_count: 1 },
              { file: "src/Util/RateLimiter.php", error_count: 2 },
            ],
          },
          {
            iteration: 2,
            error_count: 1,
            per_file: [
              { file: "src/Auth/LdapAuth.php", error_count: 1 },
              { file: "src/Util/Csv.php", error_count: 0 },
              { file: "src/Util/RateLimiter.php", error_count: 0 },
            ],
          },
          {
            iteration: 3,
            error_count: 0,
            per_file: [{ file: "src/Auth/LdapAuth.php", error_count: 0 }],
          },
        ],
      },
      {
        queue: "vitest",
        iterations: [
          { iteration: 1, error_count: 1, per_file: [{ file: "src/Auth/LdapAuth.php", error_count: 1 }] },
          { iteration: 2, error_count: 0, per_file: [{ file: "src/Auth/LdapAuth.php", error_count: 0 }] },
        ],
      },
    ]);
  });

  test("kill events are merged from the sidecar", () => {
    expect(rendered.json.kill_events).toEqual(killA);
    expect(rendered.markdown).toContain("## Kill events");
    expect(rendered.markdown).toContain("kill-intent run=run-a-2026-09-25");
    expect(rendered.markdown).toContain("resumed=true");
  });

  test("markdown carries the AC2 sections and key values", () => {
    expect(rendered.markdown).toContain("# Porting Run Metrics Report");
    expect(rendered.markdown).toContain("- status: OK");
    expect(rendered.markdown).toContain("### src/Auth/LdapAuth.php — round 1 (agreement: disagree)");
    expect(rendered.markdown).toContain("(agreement: agree-clean)");
    expect(rendered.markdown).toContain("(agreement: unreviewed)");
    expect(rendered.markdown).toContain("- citation checks: F1=1.00, F2=1.00");
    expect(rendered.markdown).toContain("F5=0.40");
    expect(rendered.markdown).toContain("tokens (model-calling roles): 15640");
    expect(rendered.markdown).toContain("- envelopes: 54 (start markers: 15, interrupted: 1)");
    expect(rendered.markdown).toContain("_no completed verdict records (unreviewed)_");
    expect(rendered.markdown).toContain("## Dispatch anchoring (dex typed 1:N)");
    expect(rendered.markdown).toContain("- envelopes anchored: 54");
    expect(rendered.markdown).toContain("(non-agent kinds: 3, unexplained: 0)");
  });

  test("renderer is pure: identical output across runs, inputs not mutated", () => {
    const before = JSON.stringify([runA.envelopes, runA.verdicts]);
    const again = renderReport({
      envelopes: runA.envelopes,
      verdicts: runA.verdicts,
      burnDown: runA.burn_down,
      killEvents: killA,
      history: historyA,
      generatedAt: "2026-09-25T12:00:00.000Z",
    });
    expect(again.markdown).toBe(rendered.markdown);
    expect(again.json).toEqual(rendered.json);
    expect(JSON.stringify([runA.envelopes, runA.verdicts])).toBe(before);
  });

  test("without history the anchor is not evaluated and the section says so", () => {
    const noHistory = renderReport({
      envelopes: runA.envelopes,
      verdicts: runA.verdicts,
      burnDown: runA.burn_down,
    });
    expect(noHistory.json.dispatch_anchor).toBeNull();
    expect(noHistory.json.provenance_ok).toBe(true);
    expect(noHistory.markdown).toContain("_dex history not supplied — anchoring not evaluated_");
  });
});

describe("renderReport provenance + anchor failures (run-b)", () => {
  const rendered = renderReport({
    envelopes: runB.envelopes,
    verdicts: runB.verdicts,
    burnDown: runB.burn_down,
    history: historyB,
  });

  test("12 combined failures: token contract + dispatch anchoring", () => {
    expect(rendered.json.provenance_ok).toBe(false);
    expect(rendered.json.provenance_failures.length).toBe(12);
    const failures = rendered.json.provenance_failures.join("\n");
    // envelope-internal provenance failures
    expect(failures).toContain("envelope pp-review-a (review) is model-calling but carries no token usage");
    expect(failures).toContain("envelope pp-commit (commit) is non-model but carries token usage");
    expect(failures).toContain("pp-capture-diff is interrupted but has no ended_at");
    expect(failures).toContain("attempt-0 start marker but carries token usage");
    // dispatch anchoring failures
    expect(failures).toContain("model step pp-implement (src__Http__Request.php#1) has no attempt-0 start marker");
    expect(failures).toContain("model step pp-review-a (src__Http__Request.php#1) has no attempt-0 start marker");
    expect(failures).toContain("model step pp-review-b (src__Http__Request.php#1) has no attempt-0 start marker");
    expect(failures).toContain("reached finalAttempt 3 beyond envelope attempt 1");
    expect(failures).toContain("pp-review-b (src__Http__Request.php#1) has no dispatch entry of type PpReviewB");
    expect(failures).toContain('role "verdict-check" does not match flow spec role "commit"');
    expect(failures).toContain("pp-unknown-step#1 does not match any known port-flow step type mapping");
    expect(failures).toContain('unexplained dispatch entry of type "PpEvil"');
  });

  test("anchor summary counts", () => {
    const anchor = rendered.json.dispatch_anchor;
    expect(anchor?.ok).toBe(false);
    expect(anchor?.dispatch_entries_total).toBe(7);
    expect(anchor?.non_agent_dispatch_entries).toBe(1);
    expect(anchor?.unexplained_dispatch_entries).toBe(1);
    expect(anchor?.model_steps_missing_start_marker).toBe(3);
    expect(anchor?.envelopes_anchored).toBe(5);
  });

  test("unreviewed file-rounds surfaced; failed status in markdown", () => {
    expect(
      rendered.json.file_rounds.map((fr) => `${fr.file}#${fr.round}:${fr.agreement.outcome}`),
    ).toEqual(["src/Http/Request.php#1:unreviewed", "src/Http/Response.php#1:unreviewed"]);
    expect(rendered.markdown).toContain("- status: FAILED (12 failure(s))");
    expect(rendered.markdown).toContain("## Dispatch anchoring (dex typed 1:N)\n- status: FAILED");
  });

  test("kill events are null when no sidecar is given", () => {
    expect(rendered.json.kill_events).toBeNull();
    expect(rendered.markdown).toContain("_none recorded_");
  });
});

describe("validateProvenance (unit cases)", () => {
  test("empty stream is clean", () => {
    expect(validateProvenance([])).toEqual([]);
  });

  test("TokenUsage-shaped tokens are accepted for model roles", () => {
    const env: EnvelopeEvent = {
      stepId: "pp-implement",
      role: "agent",
      file: null,
      round: null,
      attempt: 1,
      started_at: "2026-09-25T10:00:00.000Z",
      ended_at: "2026-09-25T10:01:00.000Z",
      outcome: "completed",
      tokens: { input_tokens: 30, output_tokens: 12 },
      wall_clock_ms: 60000,
      identity: "src__X.php#1",
    };
    expect(validateProvenance([env])).toEqual([]);
  });

  test("negative attempt is a failure", () => {
    const env: EnvelopeEvent = {
      stepId: "pp-implement",
      role: "agent",
      file: null,
      round: null,
      attempt: -1,
      started_at: "2026-09-25T10:00:00.000Z",
      ended_at: null,
      outcome: "interrupted",
      tokens: null,
      wall_clock_ms: null,
      identity: null,
    };
    expect(validateProvenance([env]).length).toBe(1);
  });

  test("ending before starting is a failure", () => {
    const bad = [
      {
        stepId: "x-1",
        role: "agent",
        file: null,
        round: null,
        attempt: 1,
        started_at: "2026-09-25T10:00:02.000Z",
        ended_at: "2026-09-25T10:00:01.000Z",
        outcome: "completed",
        tokens: 1,
        wall_clock_ms: 1000,
        identity: null,
      },
    ] as unknown as EnvelopeEvent[];
    const failures = validateProvenance(bad);
    expect(failures.some((f) => f.includes("ends before it starts"))).toBe(true);
  });
});

describe("runProvenanceCrossCheck (combined AC2 entry)", () => {
  test("clean stream + consistent history -> ok with zero failures", () => {
    const cross = runProvenanceCrossCheck({ envelopes: runA.envelopes, history: historyA });
    expect(cross.ok).toBe(true);
    expect(cross.failures).toEqual([]);
    expect(cross.anchor.envelopes_anchored).toBe(54);
  });

  test("violations from both surfaces merge, sorted, none lost", () => {
    const cross = runProvenanceCrossCheck({ envelopes: runB.envelopes, history: historyB });
    expect(cross.ok).toBe(false);
    expect(cross.failures.length).toBe(12);
    const sorted = [...cross.failures].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(cross.failures).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// Wave-5 cost honesty: per-role usage split + USD + ~estimated flag
// ---------------------------------------------------------------------------

describe("renderReport usage_by_role (cost honesty)", () => {
  const baseEnv = (tokens: EnvelopeEvent["tokens"], role: EnvelopeEvent["role"] = "review"): EnvelopeEvent => ({
    stepId: "pp-review-a",
    role,
    file: null,
    round: 1,
    attempt: 1,
    started_at: "2026-09-26T10:00:00Z",
    ended_at: "2026-09-26T10:01:00Z",
    outcome: "completed",
    tokens,
    wall_clock_ms: 1000,
    identity: "src__a.php#1",
  });

  test("split carried per role; plan-authed cost flagged estimated, totals via tokenTotalOf", () => {
    const rendered = renderReport({
      envelopes: [
        baseEnv({ input_tokens: 4000, output_tokens: 100, reasoning_tokens: 32, cache_read_tokens: 3500, cache_write_tokens: 8, cost_usd: 0 }),
        baseEnv({ input_tokens: 6000, output_tokens: 200, reasoning_tokens: 0, cache_read_tokens: 5000, cache_write_tokens: 0, cost_usd: 0.03 }),
        baseEnv(123, "agent"),
      ],
      verdicts: [],
      burnDown: [],
      generatedAt: "2026-09-26T12:00:00Z",
    });
    const review = rendered.json.usage_by_role.find((u) => u.role === "review");
    expect(review?.calls).toBe(2);
    expect(review?.input_tokens).toBe(10000);
    expect(review?.cache_read_tokens).toBe(8500);
    expect(review?.cost_usd).toBeCloseTo(0.03);
    const agent = rendered.json.usage_by_role.find((u) => u.role === "agent");
    expect(agent?.input_tokens).toBeNull(); // bare-total envelope: no split
    expect(agent?.calls).toBe(1);
    // Mixed lane: one review call reported cost_usd 0 and one agent call is a
    // bare 123-token total, so the USD total understates and MUST carry `~`.
    expect(rendered.json.cost_estimated).toBe(true);
    expect(rendered.json.costed_calls).toBe(1);
    expect(rendered.json.uncosted_calls).toBe(2);
    expect(review?.uncosted_calls).toBe(1);
    expect(agent?.uncosted_calls).toBe(1);
    expect(rendered.markdown).toContain("- total cost: ~$0.0300");
    // token totals normalize the object form across ALL split fields.
    expect(rendered.json.summary.tokens_model_roles).toBe(4000 + 100 + 32 + 3500 + 8 + 6000 + 200 + 5000 + 123);
    expect(rendered.markdown).toContain("## Cost per role (provider-reported split)");
    expect(rendered.markdown).toContain("cache-read");
  });

  test("all-zero provider costs mark the total estimated with the ~ footnote", () => {
    const rendered = renderReport({
      envelopes: [baseEnv({ input_tokens: 100, output_tokens: 5, cost_usd: 0 })],
      verdicts: [],
      burnDown: [],
    });
    expect(rendered.json.cost_estimated).toBe(true);
    expect(rendered.json.cost_total_usd).toBe(0);
    expect(rendered.markdown).toContain("`~` = estimated");
    expect(rendered.markdown).toContain("~$0");
  });
});

// ---------------------------------------------------------------------------
// C41: the flow's aggregate (file null) row is authoritative for the iteration
// total; per-file rows are breakdown only (the flow caps them at 8 files).
// ---------------------------------------------------------------------------

describe("renderReport queue burn-down totals (aggregate row authoritative)", () => {
  const row = (
    queue: QueueBurnDownEvent["queue"],
    file: string | null,
    iteration: number,
    error_count: number,
  ): QueueBurnDownEvent => ({
    queue,
    file,
    iteration,
    error_count,
    recorded_at: `2026-09-26T10:0${iteration}:00Z`,
  });
  const render = (burnDown: QueueBurnDownEvent[]) =>
    renderReport({ envelopes: [], verdicts: [], burnDown });

  test("total row wins over the capped per-file rows (12 errors, 8 files shown)", () => {
    // Shape the flow writes: tsc-<iter> total + byFile.slice(0, 8) rows.
    const rows: QueueBurnDownEvent[] = [
      row("tsc", null, 1, 12),
      ...["a", "b", "c", "d", "e", "f", "g", "h"].map((f) => row("tsc", `src/${f}.php`, 1, 1)),
    ];
    const rendered = render(rows);
    const tsc = rendered.json.queue_burn_down[0];
    expect(tsc?.queue).toBe("tsc");
    expect(tsc?.iterations[0]?.error_count).toBe(12);
    expect(tsc?.iterations[0]?.per_file.length).toBe(8);
    expect(rendered.json.summary.verification.tsc_final_error_count).toBe(12);
    expect(rendered.json.summary.verification.tsc_verified).toBe(false);
  });

  test("aggregate-only rows (vitest style) give empty per_file and never leak a (total) pseudo-file", () => {
    const rendered = render([row("tsc", null, 3, 0), row("vitest", null, 3, 2)]);
    for (const q of rendered.json.queue_burn_down) {
      for (const it of q.iterations) expect(it.per_file).toEqual([]);
    }
    expect(rendered.markdown).not.toContain("(total)");
    expect(rendered.json.summary.verification.tsc_final_error_count).toBe(0);
    expect(rendered.json.summary.verification.tsc_verified).toBe(true);
  });

  test("legacy (total) pseudo-file rows are treated as the total, not a file", () => {
    const rendered = render([row("tsc", "(total)", 1, 5), row("tsc", "src/a.php", 1, 3)]);
    const it = rendered.json.queue_burn_down[0]?.iterations[0];
    expect(it?.error_count).toBe(5);
    expect(it?.per_file).toEqual([{ file: "src/a.php", error_count: 3 }]);
  });

  test("without an aggregate row the per-file rows are summed (recorded fixtures)", () => {
    const rendered = render([row("tsc", "src/a.php", 1, 3), row("tsc", "src/b.php", 1, 4)]);
    expect(rendered.json.queue_burn_down[0]?.iterations[0]?.error_count).toBe(7);
  });

  test("per-iteration totals decrease monotonically without zig-zag (one y per iteration)", () => {
    const rendered = render([
      row("tsc", null, 1, 12),
      row("tsc", "src/a.php", 1, 7),
      row("tsc", "src/b.php", 1, 5),
      row("tsc", null, 2, 4),
      row("tsc", "src/a.php", 2, 3),
      row("tsc", "src/b.php", 2, 1),
    ]);
    expect(rendered.json.queue_burn_down[0]?.iterations.map((i) => i.error_count)).toEqual([12, 4]);
    expect(rendered.json.summary.verification.tsc_final_error_count).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// C06 / Contract A: tsc run accounting. A not-run tsc is never PASS / 0 errors.
// ---------------------------------------------------------------------------

describe("renderReport tsc accounting (Contract A)", () => {
  const tscRow = (
    iteration: number,
    error_count: number,
    tsc?: QueueBurnDownEvent["tsc"],
  ): QueueBurnDownEvent => ({
    queue: "tsc",
    file: null,
    iteration,
    error_count,
    recorded_at: `2026-09-26T10:0${iteration}:00Z`,
    ...(tsc !== undefined ? { tsc } : {}),
  });
  const render = (burnDown: QueueBurnDownEvent[]) =>
    renderReport({ envelopes: [], verdicts: [], burnDown });

  test("not-run tsc (TS18003, 0 parsed errors) renders NOT RUN with its reason, never PASS", () => {
    const reason = "tsc exited 2 with no located diagnostics: error TS18003: No inputs were found";
    const rendered = render([tscRow(1, 0, { state: "not-run", reason, exit_code: 2, unlocated: 1 })]);
    const v = rendered.json.summary.verification;
    expect(v.tsc_verified).toBeNull();
    expect(v.tsc_final_error_count).toBeNull();
    expect(v.tsc?.state).toBe("not-run");
    expect(rendered.markdown).toContain(`typecheck (tsc): NOT RUN (${reason})`);
    expect(rendered.markdown).not.toContain("typecheck (tsc): PASS");
    expect(rendered.markdown).toContain("| 1 | NOT RUN — tsc exited 2");
    expect(rendered.json.queue_burn_down[0]?.iterations[0]?.tsc?.state).toBe("not-run");
  });

  test("timeout and ENOENT reasons pass through verbatim", () => {
    for (const reason of ["tsc timed out after 180s", "tsc binary not found (ENOENT)"]) {
      const rendered = render([tscRow(1, 0, { state: "not-run", reason, exit_code: null, unlocated: 0 })]);
      expect(rendered.markdown).toContain(`typecheck (tsc): NOT RUN (${reason})`);
    }
  });

  test("a ran tsc with 0 errors still PASSes; unlocated diagnostics block the PASS", () => {
    const pass = render([tscRow(1, 0, { state: "ran", reason: null, exit_code: 0, unlocated: 0 })]);
    expect(pass.json.summary.verification.tsc_verified).toBe(true);
    expect(pass.markdown).toContain("typecheck (tsc): PASS at final iteration");
    const dirty = render([tscRow(1, 0, { state: "ran", reason: null, exit_code: 2, unlocated: 2 })]);
    expect(dirty.json.summary.verification.tsc_verified).toBe(false);
    expect(dirty.markdown).toContain("(+2 unlocated diagnostic(s))");
    expect(dirty.markdown).not.toContain("typecheck (tsc): PASS");
  });

  test("only the FINAL iteration decides the verification; earlier not-run rows stay visible", () => {
    const rendered = render([
      tscRow(1, 0, { state: "not-run", reason: "tsc timed out after 180s", exit_code: null, unlocated: 0 }),
      tscRow(2, 3, { state: "ran", reason: null, exit_code: 2, unlocated: 0 }),
    ]);
    expect(rendered.json.summary.verification.tsc_final_error_count).toBe(3);
    expect(rendered.markdown).toContain("| 1 | NOT RUN — tsc timed out after 180s");
  });

  test("legacy rows without tsc accounting render exactly as before", () => {
    const rendered = render([tscRow(1, 0)]);
    expect(rendered.json.summary.verification.tsc).toBeUndefined();
    expect(rendered.json.summary.verification.tsc_verified).toBe(true);
    expect(rendered.markdown).toContain("typecheck (tsc): PASS at final iteration (0 remaining errors)");
    expect(rendered.markdown).toContain("| 1 | 0 |");
  });
});

describe("renderReport cost_estimated (mixed lanes, C40)", () => {
  const review = (tokens: EnvelopeEvent["tokens"], identity = "src__a.php#1"): EnvelopeEvent => ({
    stepId: "pp-review-a",
    role: "review",
    file: null,
    round: 1,
    attempt: 1,
    started_at: "2026-09-26T10:00:00Z",
    ended_at: "2026-09-26T10:01:00Z",
    outcome: "completed",
    tokens,
    wall_clock_ms: 1000,
    identity,
  });
  const render = (envelopes: EnvelopeEvent[]) =>
    renderReport({ envelopes, verdicts: [], burnDown: [] });

  test("1M uncosted tokens next to a $0.01 call is estimated, not an exact-looking $0.0100", () => {
    const rendered = render([
      review({ input_tokens: 1_000_000, output_tokens: 0, cost_usd: 0 }),
      review({ input_tokens: 10, output_tokens: 0, cost_usd: 0.01 }, "src__b.php#1"),
    ]);
    expect(rendered.json.cost_total_usd).toBeCloseTo(0.01);
    expect(rendered.json.cost_estimated).toBe(true);
    expect(rendered.json.costed_calls).toBe(1);
    expect(rendered.json.uncosted_calls).toBe(1);
    expect(rendered.markdown).toContain("- total cost: ~$0.0100");
    expect(rendered.markdown).toContain("| review | 2 |");
    expect(rendered.markdown).toMatch(/\| ~\$0\.0100 \|/);
    expect(rendered.markdown).toContain("1 of 2 model call(s)");
  });

  test("a bare-number-token call next to a fully costed call marks the total estimated", () => {
    const rendered = render([review({ input_tokens: 10, output_tokens: 5, cost_usd: 0.02 }), review(500, "src__b.php#1")]);
    expect(rendered.json.cost_estimated).toBe(true);
    expect(rendered.json.uncosted_calls).toBe(1);
  });

  test("every call costed stays exact (no ~)", () => {
    const rendered = render([
      review({ input_tokens: 10, output_tokens: 5, cost_usd: 0.02 }),
      review({ input_tokens: 20, output_tokens: 5, cost_usd: 0.03 }, "src__b.php#1"),
    ]);
    expect(rendered.json.cost_estimated).toBe(false);
    expect(rendered.json.uncosted_calls).toBe(0);
    expect(rendered.markdown).toContain("- total cost: $0.0500");
    expect(rendered.markdown).not.toContain("~");
  });

  test("bare totals only: no USD total at all (n/a), not a fake exact zero", () => {
    const rendered = render([review(500)]);
    expect(rendered.json.cost_total_usd).toBeNull();
    expect(rendered.json.cost_estimated).toBe(false);
    expect(rendered.markdown).toContain("- total cost: n/a");
  });
});
