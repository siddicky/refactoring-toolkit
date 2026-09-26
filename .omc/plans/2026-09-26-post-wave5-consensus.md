# Consensus Plan: post-wave-5 hardening + closure wave

- **Status**: **PENDING APPROVAL** — final (v5.1). Consensus note: Architect returned SOUND-WITH-CHANGES in rounds 2–5 with monotonically narrowing scope (final round: one wording overclaim + four small assertion additions, all folded below). The codex Critic returned REVISE in all 5 rounds with strongly converging scope (round 1: judgment-on-control-flow contradiction; round 5: closure step ordering) — all round-5 items from both reviewers are folded below. Full APPROVE was not reached within the 5-iteration cap; residual risk is procedural, not architectural, and is documented in the ADR.
- **Mode**: RALPLAN-DR short | Architect: glm-5.3 via zai | Critic: codex | Date: 2026-09-26
- **Inputs**: research files, BUILD_NOTES §WAVE-4 + §0(f)–0(h), worker-1d in-flight assignment; four rounds of independent reviews; user directive (dex streams).

## Requirements Summary

After worker-1d concludes: Stage 1 — deterministic degenerate-turn detection (Tier-0) with f(attempt)-only lane demotion, a dex-history dispatch health gate, and the stream telemetry bus publish hook (user-directed). Stage 2 — vitest triage as a DECLARED content gate; symbol-type band; verdict repair-or-discard with tombstones extended to attempt-exhaustion. Stage 3 — closure (scoped push, per-AC verifier, AC1/AC2 report, demo record).

## RALPLAN-DR Summary

### Principles
1. **Two-lane judgment rule (explicit, replaces "no exceptions").**
   - **Lane A — recovery/orchestration control (HARD RULE):** retry, model-lane demotion, repair/discard TRIGGERS, dispatch gating, and attempt-exhaustion routing consume ONLY non-judgment signals (reply shape class, dex attempt count, dex history facts, schema validity). No judgment output reaches these paths; verified by import-boundary test.
   - **Lane B — declared content gates (PERMITTED, registered):** judgment-derived classifications consumed by FIXED code thresholds to route CONTENT — the pre-existing citation gate (`p_cited < 1` drops findings, `flows/port-project.ts:1039-1067`), vitest triage (`failureClass` → feed attribution), symbol-type selection. Every Lane-B consumer is declared in a checked-in registry (`src/judgment-registry.ts`): judgment output → fixed threshold → routed content effect → provenance surface. Lane B never cascades into Lane A (a triage classification cannot trigger a lane change). Lane-B absence/unavailability degrades to the deterministic naive default (fail-open). The citation gate is Lane B — pre-existing, now declared honestly instead of hand-waved as "not an exception."
2. **Deterministic core untouched** — agreement rule, reconcile(), sole-committer, provenance anchoring stay pure code.
3. **Assessment ≠ decision** — thresholds and routing live in tested code; every Lane-B effect carries envelope provenance.
4. **One wave, gated start; Stage 1 ships first** (demo-protective independently).
5. **Evidence-first closure.**

### Decision Drivers (top 3)
1. Make the wave-4 failure class deterministic and recoverable; achieve completion-certainty (terminal-success) for **verdict-step exhaustion** via exhaustion tombstones (prep-generation/implementation steps retain FLOW_FAILED semantics — scoped honestly).
2. PR #1 is 6+ commits behind.
3. Chris-demo readiness (stream-fed live dashboard is itself a demo upgrade).

### Viable Options (critical-path to demo-ready)

**Option A — Staged sequential wave (RECOMMENDED).** Stage 1 ≈45 min; Stage 2 ≈2–3 h; Stage 3 ≈1 h. Demo protection at ≈45 min; full closure ≈4–5 h. Rollback per stage.
- Pros: zero file-conflict risk; demo never hostage to Stage 2; honest deps. Cons: longest total wall-clock.

**Option B′ — Parallel items ‖ gated closure.** ≈3–3.5 h (≈30% faster) but two PR pushes, demo record still waits on Stage 1, and two-writer coordination on `flows/port-project.ts`. No gain on the critical path that matters.

**Option C′ — Stage 1 only (≈45 min).** The compressed-window fallback, explicitly NOT equivalent scope (defers the user-approved TypeSafe items + streams consumers). **Trigger/owner: the LEAD decides**, on three inputs recorded at the gate — worker-1d's completion time, live provider-window evidence (dex history), and the user's demo deadline if stated; when invoked, every deferred Stage-2 item is listed in BUILD_NOTES §DEFERRED so nothing is silently dropped.

## Implementation Steps

0. **Gate**: await worker-1d; audit commits; Tier-1-polish dupe check; disarm + verify watchers (kill `/tmp/watch-kill-cx5.sh` [worker-1d's process, surfaced], fix non-exiting terminal branch `:36-44`, assert `pgrep -f watch-kill` empty + state files removed); **verify WriteStream is callable from worker step context** (tiny probe; if not, stream publishing moves to the lead-side runner — noted deviation); baseline `bun test` + `tsc`.
1. **Stage 1 — Tier-0 + demotion + history gate + stream publish**:
   - Tier-0 predicate: degenerate = `usage present AND textOut.length === 0 AND not aborted`; guard before both `src/harness/opencode.ts` `prompt()` exits (`:299` + post-poll; `:293` is usage-null-only). ≤8 arm dropped.
   - Demotion: f(attempt) only (attempt ≥ 2 → demote from `OPENCODE_REVIEWER_MODEL`); `modelOverride` threaded `runReviewTurn → runAgentTurn` (pattern of `attempt` at `flows/port-project.ts:593`). Rationale pinned: 0(g) — intra-step writes don't survive; attempt durability proven 0(f).
   - Dispatch health gate (lead layer): reads dex history only (`GetHistoryEvents`; typed parser reuse from `src/dashboard/queries.ts:76-110`); **stale = newest relevant event age > 10 min**; 5 s query timeout; fail-open on missing/stale/query-failure — **and when it fails open it provides NO protection** (explicit): those states surface as `gate: degraded` in the runner output, a dashboard chip, and the demo log, so proceeding anyway is a visible operator decision, not a silent pass. Never inside dispatch steps.
   - Stream publish hook: envelope factory emits each event via `WriteStream` to `port/<flowId>/events`; **every WriteStream call site try/catch-swallowed** (telemetry outage can never fail a durable step — test-asserted).
   - Tier 1 (`src/typesafe/turn-health.ts`) evidence-only: Jev nouls on shape-ambiguous turns and discarded verdicts → stream + `record`-role envelope events. **Durable write point for throwing turns: the successor attempt re-records the diagnosis** (deterministic trigger: Tier-0 retry context visible on the next attempt) — no intra-throwing-step write (0(g)). Zero control-flow consumers (import-boundary test).
2. **Stage 2a — Vitest triage as a DECLARED Lane-B gate**: `QueueVerifyStep` persists parsed failure records into the durable vitest queue attribute; `classifyMany` at queue-build writes `{failureClass, attributedFile}` per record (Jev usage via `recordJevUsage` pattern `:498-502`; `FailureClassification` extended `src/queues/vitest-queue.ts:43-47`); the fix-round feed = the existing per-file loop reading queue state; unknown attribution → deterministic `port-caused` default; **Jev unavailability → naive classifier fallback (fail-open)**. Registered in `src/judgment-registry.ts` with provenance.
3. **Stage 2b — Symbol band**: `uncertain_band` label ([0.30, 0.70] ⊂ 0.8 strong-fail; reported separately); `choice_confidence < 0.9` → escalation; calibrated from `/tmp/jev-spot-check-after.json`; re-run `scripts/jev-spot-check.ts` (n=36).
4. **Stage 2c — Verdict repair-or-discard + exhaustion tombstones**:
   - Suspicion predicate (deterministic, exhaustive, Lane A): span-resolves-outside-diff; all-blockers count > 5; **verbatim-repeat scoped to the IN-STEP repair comparison** (invalid verdict vs repaired reply, held in memory — zero substrate; cross-attempt replay already cache-busted `:619-622`).
   - Repair: ONE re-prompt (routed through Tier-0); still-invalid/suspect → tombstone.
   - Tombstone schema: `ppVerdict`/`ppPrepVerdict` variant `{reviewer, discarded: true, reason, attempt, tokens}`; both check steps tolerate (`:1029-1034`, `:1629-1632`); discarded reviewer → zero kept findings (`:1060-1067`; keptCount-0 route `:1086-1087`); surviving reviewer proceeds; round agreement surfaces `unreviewed` side; prep-loop termination verified against `PrepLoopDecisionStep` (`:1657-1663`); tokens-on-tombstone + envelope `tokens` return (`:1010-1013`) enforce AC2 anchoring.
   - **Exhaustion tombstones (adopts architect's completion-certainty extension)**: attempt exhaustion (deterministic `ctx.attempt`/step-policy fact) → BOTH reviewers tombstoned → round proceeds as `degraded` unreviewed → flow reaches terminal-success under total provider outage. Lane A: exhaustion is a non-judgment signal.
   - Pre-check: unit test that agreement/metrics accept one-reviewer and zero-reviewer (degraded) rounds; **AC2 anchoring semantics for exhausted steps pinned**: per 0(g), a tombstone anchors only the FINAL attempt's tokens — attempts 1..n−1 of an exhausted step are unanchorable and the AC2 report must state this under-count explicitly rather than reconcile silently; **degraded marker asserted on every consumption surface** (metrics render, `/api/state` payload, dashboard headline, AC1/AC2 report) so no surface can read a degraded round as clean; **Tier-1 non-final-attempt diagnoses are lost on exhaustion** (only the tombstone `reason` survives) — documented limitation.
5. **Stage 2d — Stream consumers**: dashboard `src/dashboard/queries.ts` gains a `ReadStream` subscriber (poll fallback retained and ENGAGED on subscriber failure — asserted); kill watcher subscribes for `pp-queue-verify:start` with **30-min bounded wait + 60 s poll fallback**, fires once, exits cleanly (no-duplicate assertion). Optional SSE to the page. Projection-only: streams never read for correctness (import-boundary).
6. **Stage 3 — Closure (verifier gates the push)**: **verifier FIRST** (per-AC, named): `bun test` (incl. NEW `tests/turn-health.test.ts`, `tests/verdict-repair.test.ts`, registry + import-boundary + seam-construction tests), `bun run typecheck`, then per-AC evidence (below) → verdict block. **Only on PASS does the push happen**: scope `origin/develop..main` (lead line-review), PR body rewrite; on any FAIL the push is blocked, the failure is fixed or the plan reverts that stage (per-stage commits), and the verifier re-runs. Then: final AC1/AC2 report (inputs `/tmp/metrics-*`, BUILD_NOTES); demo re-record via the health gate; Chris package.

## Acceptance Criteria

- [ ] **AC-B1**: ten named degenerate fixtures (7 `retry` no-text incl. cx-4 out=16; 885-token `generic_retry` [no demotion — expected outcome pinned]; cache-replay `generic_retry`; persona `discard_class`) → Tier-0 handles the retry class; demotion on attempt ≥2; ZERO Jev calls on shape-trivial. **AC-B2**: routing = f(shape, attempt), no Tier-1 input; text-present/output-0 and aborted-no-text negatives pass. **AC-B3**: gate = dex history only; fail-open on missing/stale(>10 min)/query-failure; ≤5 s.
- [ ] **AC-R (registry/lanes)**: `src/judgment-registry.ts` lists every Lane-B consumer with threshold + effect; import-boundary test (Lane-A modules import no judgment modules) **AND a seam-construction assertion** — `JudgmentClient` instances may be constructed/injected ONLY in registry-listed modules (the runtime-injection hole the live citation gate at `flows/port-project.ts:1039-1051` demonstrates); triage unavailability falls back to naive (fail-open test).
- [ ] **AC-D (streams, end-to-end)**: publish → subscriber receipt → event id present in `/api/state` feed payload (rendered); subscriber/query failure → poll fallback ENGAGED (asserted); watcher: exactly-once fire, clean exit, no duplicate; WriteStream outage cannot fail a step (test).
- [ ] **AC-T**: manifest (`tests/fixtures/vitest-triage/manifest.json`: id/evidence-path/label/adjudication-note); promotion is REPRODUCIBLE: agreement = (classifier label == adjudicated label)/n computed per class and overall; adjudication = implementing worker labels each case from its evidence, lead double-reviews every label, disagreements resolved by joint re-read and the resolution recorded in the note; promotion requires ≥20 cases AND ≥5 per class AND ≥90% overall AND ≥80% in every class; ANY per-class shortfall (<5 cases or <80%) → that class is marked `insufficient` in the manifest AND the classifier stays non-default.
- [ ] **AC-S**: spot-check ≥90%; band vs strong-fail rates separate; abstention→escalation count; escalation rate vs ~2/36 with stated tolerance.
- [ ] **AC-V**: four repair/discard paths + zero-reviewer degraded round; tombstoned tokens AC2-anchored; one/zero-reviewer agreement semantics tested.
- [ ] **AC-C**: PR #1 = exactly `origin/develop..main` (lead-reviewed); verifier per-AC PASS; AC1/AC2 report; demo video shows headline + cost columns + stream-fed feed.

## Fixture Set

`tests/fixtures/turn-health/` — raw SDK message shapes through `OpencodeHarness.prompt`'s real extractors (SDK-boundary double). Ten degenerate + negatives (~235-token valid verdict; text-present/output-0; aborted-no-text → NOT Tier-0, handled `flows/port-project.ts:563`). Expected outcome (incl. NON-Tier-0 for the 885-token and persona cases) pinned per fixture header.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Judgment reaching Lane A | Two-lane rule + registry + import-boundary tests |
| Provider window mid-run | History gate; exhaustion tombstones → terminal-success; demo fallback = replayed history |
| Telemetry outage failing steps | Try/catch-swallow at every WriteStream; test |
| Watcher hang | Bounded wait + poll fallback; exactly-once asserted |
| One/zero-reviewer rounds break metrics | Pre-check unit tests; degraded marker |
| Stream trimming loses evidence | Projection-only; durable truth in attributes/envelopes |
| <20 triage labels or <5/class | Stays non-default; shortfall recorded |
| Tier-2 scope creep | Out of scope |

## ADR

- **Decision**: Staged sequential wave: Tier-0 deterministic degenerate detection + f(attempt) demotion + dex-history gate + stream telemetry bus (Stage 1); declared Lane-B content gates (triage, band) + tombstoned repair/discard incl. exhaustion (Stage 2); scoped closure with per-AC verifier (Stage 3).
- **Drivers**: deterministic recoverability + completion certainty; PR currency; demo readiness.
- **Alternatives**: B′ parallel-gated-closure (rejected: no critical-path gain, churn); C′ minimal (adopted AS Stage 1, not equivalent scope).
- **Why chosen**: only structure that ships demo protection first, makes the wave-4 failure class deterministic AND terminal-successful, and keeps judgment provably out of recovery control via the two-lane rule.
- **Consequences**: registry discipline required for new Lane-B consumers; exhaustion-degraded rounds must be visible in metrics (degraded marker); ~4–5 h serial.
- **Follow-ups**: pre-dispatch probe gating (ADR-noted, out of wave — wave-4 evidence shows probes are themselves degenerate-prone); SSE page upgrade; article-scale tsc taxonomy.

## Changelog

- v1–v4: iteration history (two-tier battery → evidence-only Tier-1 → finalized predicate/substrate/gate → two-lane rule + exhaustion tombstones).
- v5 (round-4 synthesis): two-lane judgment rule; triage as declared Lane-B gate; exhaustion tombstones; verbatim-repeat in-step; WriteStream swallow + probes; successor-attempt re-record; bounded watcher; per-AC verifier.
- **v5.1 (FINAL — round-5 synthesis, max-iterations exit, PENDING APPROVAL)**: outage claim scoped to verdict-step exhaustion (honest ADR); AC-R gains the seam-construction assertion (closes the runtime-injection hole); AC-V pre-check pins exhausted-step AC2 under-count + degraded-marker-on-every-surface assertions + Tier-1 non-final-attempt loss note; Stage 3 reordered — verifier gates the push, failure blocks it; dispatch-gate fail-open states "NO protection" and surfaces `gate: degraded` visibly; AC-T promotion formula + adjudication procedure + per-class thresholds fully reproducible; Option C′ trigger/owner named (lead, three recorded inputs, §DEFERRED ledger); prompt()-exit citation `:296` noted.
