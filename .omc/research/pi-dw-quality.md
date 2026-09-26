# pi-dynamic-workflows — quality primitives & adversarial patterns (lane: pi-dw-b)

- **Evaluated**: clone at `/tmp/pi-dw-quality` (github.com/QuintinShaw/pi-dynamic-workflows, depth-1).
- **Against**: `.omc/plans/2026-09-25-porting-toolkit-consensus.md` (v6 final) + `BUILD_NOTES.md` (Phase 0 → 3/4 evidence).
- **Scope**: quality helpers, built-in adversarial-review / code-review, agent() output validation, model tiers. Verdicts per feature at the end.
- **Guard applied**: our agreement rule is defined over **exactly 2** completed verdict records (plan §Metrics event contract) — any third reviewer/judge below is flagged as requiring a plan amendment.

---

## 1. Quality helpers (src/workflow.ts — "Quality-pattern stdlib", injected as script globals)

All helpers are built purely on `agent()`/`parallel()` so callSeq ordering stays stable and journal-resume keeps working (workflow.ts:1459-1461). Each call is journaled under a stable call index with a sha256 call-hash (prompt+model+phase+agentType+schema, workflow.ts:893-901); replay = longest-unchanged-prefix resume (workflow.ts:937-969).

### verify(item, {reviewers=2, threshold=0.5, lens}) — workflow.ts:1468-1500
- N reviewers in parallel (default **2**), each prompted: `"Adversarially review whether the following is REAL/correct. Try to refute it; default to real=false if unsure."` plus a rotating focus lens: `Focus lens: ${lenses[i % lenses.length]}` (workflow.ts:1485).
- Schema `{real: boolean, reason?: string}` required `real` (workflow.ts:1463-1467).
- **Consensus**: inclusive threshold, default 0.5; `real = realCount / successfulVotes >= threshold`; failed reviewers are OMITTED from the denominator; zero survivors → `real: false` (workflow.ts:1491-1497).
- Fan-out is **preflighted**: entire reviewer capacity is checked before any reviewer starts (`ensureAgentCapacity(reviewerSlots, "verify()")`, workflow.ts:1473-1474); invalid fan-out values throw TypeError synchronously (workflow.ts:735-741).
- Capacity accounting: verify = `reviewers` logical slots; agent-level retries stay inside their slot (references/quality-helpers.md:7-14).

### judgePanel(attempts, {judges=3, rubric}) — workflow.ts:1507-1543
- Per-candidate × per-judge scoring fan-out; judge prompt: `"Score this candidate from 0 to 1 on: ${rubric}. Reply with the score."`; schema `{score: number, reason?}` (workflow.ts:1502-1533).
- Score = **mean of surviving judges**; winner = highest mean; tie → **lower input index** (stable); empty input → `undefined`; sparse holes in `attempts` are absent candidates that consume no slots (workflow.ts:748-755, 1538-1542).
- This is a **candidate-selection** helper (pick best of N competing attempts), not a verdict-agreement mechanism. Default rubric: "overall quality and correctness" (workflow.ts:1513).

### loopUntilDry({round, key, consecutiveEmpty=2, maxRounds=50}) — workflow.ts:1545-1581
- Calls `round(index)` each iteration; dedups items by `key` (default JSON.stringify); a round is **dry** when it yields zero NEW (non-null, non-duplicate) items; terminates after `consecutiveEmpty` (default 2) dry rounds or `maxRounds` (default 50).
- **Budget/agent-limit exhaustion returns the partial array instead of throwing** (workflow.ts:1563-1567) — degraded-but-honest result.
- This is their replacement for cap-only loop termination: stop early on genuine convergence.

### completenessCheck(taskArgs, results) — workflow.ts:1588-1598
- ONE critic agent, schema `{complete: boolean, missing?: string[]}`; prompt: `"list what is still MISSING (modalities not covered, claims unverified, gaps). Be specific and concise."`; results serialized and **truncated to 4,000 chars** (workflow.ts:1593).
- Explicitly documented as **advisory** ("Treat the verdict as advisory", src/workflow-authoring-coverage.ts:154).

### retry(thunk, {attempts=3, until}) — workflow.ts:1605-1618
- Bounded loop; `until(r)` predicate decides acceptance; on exhaustion **returns the last result for caller inspection** (no throw). Each attempt is a real agent() call → journaled → resume-safe; attempt N+1's hash depends on N's live result, so retry chains cache-miss-cascade correctly on resume (workflow.ts:1600-1604). Emits `control-attempt {helper:"retry", attempt, accepted}` runtime events.

### gate(thunk, validator, {attempts=3}) — workflow.ts:1619-1636
- Retry **with feedback threading**: `validator(r)` returns `{ok, feedback?}`; the feedback string is injected into the NEXT attempt's input (`thunk(feedback, i)`). Returns `{ok, value, attempts}` — failure is a value, not an exception. Same runtime-event emission.

### checkpoint(prompt | {kind, checkpointId, payload}, options) — workflow.ts:1641-1772
- Two overloads. (a) String prompt: foreground human question via injected `confirm`; headless behavior configurable — `"default"` takes `options.default` (default `true`), `"abort"` throws (workflow.ts:1758-1768). Reply is journaled → replayable.
- (b) Durable object checkpoint: **suspends the whole run** (`WorkflowCheckpointSuspensionError`) until the manager persists state and supplies an exact response; on resume the persisted response is strictly validated (version, status, id, kind, deep-equal payload, response present) before consumption (workflow.ts:1717-1743); checkpoint IDs must be unique per run (workflow.ts:1666-1673).
- Key durability property: a durable pause does NOT abort paid in-flight siblings, and the suspension can't be swallowed into a successful run even by a script-level catch (workflow.ts:1820, 141-158).

### budget — workflow.ts:700-704 (object) + 977-1003 (enforcement) + 680-698 (phase budgets)
- `budget` global: frozen `{total, spent(), remaining()}` over the run's committed token spend.
- Global budget: **soft gate** — checked before every live call, spent accrues after each agent (in-flight wave may overshoot); `TOKEN_BUDGET_EXHAUSTED` thrown, non-recoverable. Checked AFTER the journal-replay lookup so a cache-hit replay is free and an exhausted budget can't strand a resumable run (workflow.ts:971-981, comment audit2 #1).
- **Per-phase sub-budgets**: `phase(title, {budget})` carves a soft slice; warns once at 80% (workflow.ts:997-1001), throws at 100%; first declaration wins and is persisted so the ceiling holds **cumulatively across pause/resume** instead of re-granting per resume (workflow.ts:308-315, 683-691; audit2 #4). Resume seeds spent counters via `initialTokenUsage` (workflow.ts:283-289).

### Determinism hardening (context, not a helper) — workflow.ts:514-546
- `Math.random`/`Date.now`/no-arg `new Date` throw inside the workflow vm realm (breaks resume); parse-time blocklist gives fast author feedback. Their comment is explicit that vm is best-effort against accidental nondeterminism, not a security wall — mirrors our "all nondeterminism lives inside steps."

---

## 2. Built-in workflows

### adversarial-review (src/adversarial-review.ts:23-73; registered in builtin-workflows.ts:84-91)
Three phases: **Investigate → Refute → Consensus**.
- Investigate: ONE agent lists "concrete, individually-checkable findings" (schema `{findings: string[]}`) (adversarial-review.ts:38-43).
- Refute: per-finding fan-out — each finding is judged by N independent skeptics (default 2) prompted: `"You are a skeptical reviewer. Try to REFUTE this finding for the task below. Default to real=false when uncertain. Investigate with the available tools if needed."` (adversarial-review.ts:46-53). Survival: share of `real=true` votes ≥ threshold (default 0.5); failed votes omitted, zero-valid → ratio 0 (adversarial-review.ts:54-59).
- Consensus: one writer produces the report containing ONLY survivors, "each with a short justification", and **notes how many were discarded** (adversarial-review.ts:64-70).
- Cost shape: agents = 1 + findings × reviewers + 1. Cross-review disagreement is resolved by the ratio-threshold, not by discussion — a finding with 1/2 skeptic support DIES at default threshold.

### code-review (src/code-review.ts:28-183; diff sourced by /code-review command via child_process git diff, builtin-commands.ts:13-27)
**The 7 angles** (code-review.ts:76-118), all given the diff inline plus tools ("Use the read/grep tools to pull in any additional file context you need", :73):
- **A line-by-line correctness scanner** (tier: medium) — inverted conditions, off-by-one, null deref, wrong variable, swallowed errors; "Return ONLY issues you can justify with a line in the diff."
- **B removed-behavior auditor** (medium) — "For every deleted line or block in the diff: name the invariant or contract it enforced, then find where (or prove) that contract is re-established elsewhere. Report only gaps where the invariant is NOT re-established."
- **C cross-file call-site tracer** (medium) — grep the codebase for callers of changed signatures; report call sites now broken.
- **D reuse finder** (small) — new code duplicating existing helpers; propose the existing symbol.
- **E simplification finder** (small) — redundant derivable state, copy-paste variation, dead code.
- **F efficiency finder** (small) — redundant I/O, sequentializable work, blocking on startup/hot path.
- **G altitude reviewer** (big) — right abstraction level; bandaids on shared infrastructure; fixes in the wrong layer; symptom vs cause.
- Candidate schema forces `{file, line, summary, failure_scenario}` all required (code-review.ts:50-68) — every finding carries a concrete failure scenario.
- **Dedup**: `file:line:first-40-chars-of-summary`, keep first (code-review.ts:126-133).
- **Verify pass** (code-review.ts:135-165): one verifier per candidate, 3-way enum `CONFIRMED | PLAUSIBLE | REFUTED` ("CONFIRMED = you can trace the exact failure in the diff. PLAUSIBLE = concern is valid but not certain. REFUTED = finding is wrong or already handled"). Only REFUTED is filtered. **Deliberately NOT the verify() helper** — the in-file comment (:136-142) documents why: verify()'s boolean would collapse CONFIRMED and PLAUSIBLE "and lose that signal for no behavioral gain."
- **Ranking**: correctness (A/B/C) before cleanup (D/E/F) before altitude (G), capped at 10 (code-review.ts:167-170); synthesis on big tier notes total-found vs shown.
- **Diff bound**: `MAX_DIFF_CHARS = 200_000` (:14); oversized diffs are TRUNCATED, not rejected, and the truncation is surfaced to the user and stamped into the `<diff truncated="true">` block (:39-49, 70-72) — findings past the cut are declared uncovered.
- **Disagreement resolution**: none between finders (dedup keeps first); the verify pass is a SECOND OPINION per candidate, and PLAUSIBLE is the designed hedge bucket for unresolved doubt ("worth a second look" vs "will break").

---

## 3. agent() output validation vs our verdict-schema validation

Theirs (src/agent.ts, src/structured-output.ts):
1. **Terminating structured_output tool**: with `schema`, a tool is injected whose params pi validates against the TypeBox schema BEFORE execute; `terminate: true` ends the subagent without a paid follow-up prose turn (structured-output.ts:22-47). Prompt guidelines: "call structured_output exactly once"; "Do not write a prose final answer after calling it" (structured-output.ts:32-35).
2. **Repair re-prompts**: if the tool was never called, up to `maxSchemaRetries` (default **2**) repair turns, with the session's tools RESTRICTED to only `structured_output` so the only useful next action is compliance; prompt: "You did not call the structured_output tool. Call structured_output now as your only action, with the required fields filled in." (agent.ts:155-168).
3. **Validated prose extraction (last resort)**: fenced-json or first balanced-object scan, then `Convert` + `Check` against the schema; never fabricates — undefined unless it genuinely validates; emits a "prefer a tool-reliable model" warning on success (agent.ts:60-96, 171-177).
4. **SCHEMA_NONCOMPLIANCE** thrown NON-recoverable after repair exhaustion — surfaced, never a silent null (agent.ts:183-187); a provider-limit hit during repair is re-thrown as the real cause first (agent.ts:179-181).
5. **Empty output is its own recoverable class** `AGENT_EMPTY_OUTPUT` (workflow.ts:1170-1175) — retried, not conflated with schema failure.
6. **Provider usage/quota limits**: detected from assistant-message stopReason (pi records them instead of throwing), classified with a reset hint, thrown NON-recoverable so the run checkpoints/pauses rather than retrying into the same wall (agent.ts:98-130).
7. **Timeouts**: per-call timeoutMs validated synchronously (finite, [1, 2^31-1]) and thrown before spawn (workflow.ts:771-789); run-level invalid persisted values degrade to default with a log (workflow.ts:557-573); on timeout the agent's AbortController aborts THIS session so heavy state is released and retries don't stack live sessions (workflow.ts:1065-1074).

Ours (BUILD_NOTES Phase 1/2): verdict intake validates via verdict-schema, JSON + code-fence extraction, citation fallback; envelope `maximumAttempts 3`; ODW hardenings already folded in: early upstream-error bail (retryable vs provenance classes), empty-reply as its own retryable failure class. **We are at parity on 3/5/6-shaped concerns** (retryable vs provenance ≈ recoverable vs non-recoverable; empty-reply class exists; extraction exists). The genuinely new pieces are the **restricted-tools repair re-prompt** (a cheap prompt-only repair turn BEFORE burning a full envelope attempt) and the terminating-tool pattern that stops the model from paying a prose turn after the verdict.

---

## 4. Model tiers & role routing vs our per-role opencode agent selection

Theirs:
- **Tier config** (`~/.pi/workflows/model-tiers.json`, project overlay wins — model-tier-config.ts:66-74, 281-296): tier name → ONE spec string, e.g. `"openai-codex/gpt-5.5:xhigh"`. Degenerate configs rejected on read AND write (`isValidTiersMap`, :248-253, 306-311).
- **Precedence** (workflow.ts:871-877, agent.ts:190-233): explicit `model` > agentType definition's model > `tier` > phase model (from `meta.phases[].model` regex/exact routes, model-routing.ts:25-49). **Untagged agents default to the "medium" tier** when a config exists (agent.ts:202-233) — the tier set affects the whole workflow, not just tagged agents.
- **Fallback semantics** (workflow.ts:1124-1145, agent.ts:797-801): an explicit model/tier pin that can't resolve throws `MODEL_NOT_FOUND`; an IMPLICIT route (default medium tier, or inherited main model) **degrades loudly** to the session default via `onModelFallback` logged into the run stream, with `source: "medium-tier" | "inherit-main"` discriminating the route.
- **Default tier derivation** (model-tier-config.ts:124-210): rank available models least→most capable by output price (name-hint substrings mini/flash/haiku/nano vs opus/pro/ultra as fallback when unpriced, :84-105); small = least, big = most, medium = middle; exclusion so tiers never collapse onto one model (2 models → medium=big=stronger; 1 → all fallback). A one-time actionable notice tells the user the suggested mapping when tiers are unconfigured (:212-234).
- **`provider:thinking` strings** (model-spec.ts:5-19, 88-106): `THINKING_LEVELS = off|minimal|low|medium|high|xhigh|max`; `provider/model:thinking` parsing with known-model-spec disambiguation so model ids containing colons aren't misparsed; the separate `thinking` option is validated eagerly (workflow.ts:826).
- **agentType roles** (workflow.ts:456-463): `.pi/agents/<name>.md` definitions bind tool allow/denylist + model + body prompt per role; unknown agentType → loud warning + default tools, name kept as prose hint (workflow.ts:867-869).
- Per-role observability: `onAgentModel` pushes the REAL resolved model the moment it resolves so a running agent's row stops showing the pre-resolution guess (workflow.ts:364-379, 1116-1123).

Ours: the hard-won lesson is already in BUILD_NOTES finding 3 (max-reasoning default reviewer = 25-30 min/turn vs ~45 s on the `plan` agent; fix = `OPENCODE_REVIEWER_AGENT` env with poll-to-completion seam). The difference: their tier binding is a **typed per-role config with loud degrade + fail-fast explicit pins + per-role resolved-model observability**, ours is a single env var for reviewers only.

---

## 5. VERDICT TABLE vs our loop

| # | Their feature | Evidence | Verdict | Rationale / what it changes in OUR loop |
|---|---|---|---|---|
| 1 | verify()'s adversarial prior + lens rotation ("Try to refute; default real=false if unsure" + `lens[i % lenses.length]`) | workflow.ts:1485 | **ADAPT** | Keep 2 reviewers; give each a distinct lens (e.g. A=correctness, B=removed-behavior per code-review angle B). Identical-prompt twins under-detect the same things, making agree/disagree uninformative; differentiated lenses make disagreement meaningful. **Reviewer count stays 2 → NO plan amendment** (prompt content only). |
| 2 | verify() boolean consensus (threshold 0.5 over votes) | workflow.ts:1491-1497 | **REJECT** | Strictly weaker than our per-reviewer structured verdict records + deterministic agreement rule (severity-class + hunk-span overlap). Their own /code-review abandons verify() for this reason (code-review.ts:136-142). A vote-threshold consensus would also need >2 reviewers → amendment; not wanted. |
| 3 | judgePanel (N-candidate best-of selection) | workflow.ts:1507-1543 | **REJECT (record for v2)** | Selection helper for competing attempts; our loop has no N-candidate mode and our quality signal is agreement, not scoring. Adopting it = new implementer invocations + a 3rd-party consensus over our agreement rule → amendment. Record next to deferred secondary Jev integrations. |
| 4 | loopUntilDry convergence termination (2 consecutive dry rounds; partial result on exhaustion) | workflow.ts:1545-1581 | **ADAPT (with a note)** | Upgrade prep-review loopback + queue fix-loop termination from cap-only to cap-OR-convergence: stop when 2 consecutive rounds add zero NEW (deduped) findings/errors. Implemented as an **early stop within the existing envelope caps** it does not weaken the bounded-termination guarantee → arguably no amendment; but the Flow-contract termination predicate is named in the plan, so record the predicate change in ADR follow-ups. The partial-return-on-exhaustion matches our honest-blocked semantics. |
| 5 | completenessCheck (gap-list critic, advisory, 4k-char evidence bound) | workflow.ts:1588-1598 | **ADAPT — requires plan amendment (or v2)** | This IS the thing our prep artifacts lack: nothing asks "what's MISSING" of the generated spec map/symbol table; prep-review checks artifact-vs-source correctness only. Options: (a) amend plan to add a 5th harness role (plan says ~4-6 agents, so it fits the budget line but the role inventory and prep-review wiring are named → formal amendment); (b) v2 follow-up. Their "advisory only" framing matters — it must NOT enter the 2-record agreement computation (it emits a gap list, not a verdict record). |
| 6 | retry/gate helpers | workflow.ts:1605-1636 | **REJECT** | Our envelope `maximumAttempts` + retryable/provenance classes already cover bounded retry; gate's feedback threading ≈ our findings→fixer and queue-errors→fixer feeds. No behavioral gain. |
| 7 | checkpoint (durable human-approval gate) | workflow.ts:1641-1772 | **REJECT for v1 (record for v2)** | Conflicts with AC1's autonomous-resume gate; our blocked-state-with-diagnostics is the v1 operator interaction point. A durable pause-before-integrate is a sensible v2 risk knob; adding it = amendment, not now. |
| 8 | Token budget: global soft gate + per-phase sub-budgets (warn 80%, cumulative across resume, replay-free cache hits exempt) | workflow.ts:700-704, 977-1003, 283-315 | **ADOPT (as durable knob)** | Directly serves our "cost/runaway loops" risk row; AC2 already collects per-role tokens, so enforcement is a render of data we have. Implement as durable pp-config attribute enforced in the envelope pre-prompt: warn at 80% into the report, throw to the honest-blocked path at 100%; seed spent from durable totals on resume. Envelope-internal, config-shaped → **no amendment**. Their audit2 #1 lesson (budget gate AFTER replay lookup, else a budgeted paused run is permanently unresumable) is the implementation trap to copy-avoid. |
| 9 | adversarial-review shape (1 investigator → per-finding skeptic fan-out → survivors-only report) | adversarial-review.ts:23-73 | **REJECT shape / ADAPT 2 details** | Fan-out-per-finding is expensive (findings × reviewers) and reviewers-with-tools violate our diff-by-value isolation. ADAPT: (a) the skeptic prompt prior ("Default to real=false when uncertain") into our reviewer prompt tail; (b) the report line "Note how many were discarded" — AC2 report should state findings-generated vs survived-citation-check explicitly (we record drops; make the report state them). Neither touches the agreement rule → no amendment. |
| 10 | code-review 7 angles — especially **B removed-behavior auditor** | code-review.ts:84-88 | **ADOPT (as reviewer lenses)** | Angle B ("for every deleted line: name the invariant it enforced, find where it is re-established; report only gaps") is the single best transferable prompt pattern for a PORT loop — it targets exactly the PHP→TS semantics our twin reviewers jointly miss. Map: reviewer-A lens = A/C correctness+call-sites over the diff; reviewer-B lens = B removed-behavior. Angle G (altitude) maps to our prep/spec-map review, not the per-file diff review. Prompt-only → **no amendment**. |
| 11 | 3-way CONFIRMED/PLAUSIBLE/REFUTED verify verdict + PLAUSIBLE-not-dropped ranking | code-review.ts:143-170 | **ADAPT — schema extension = amendment (small)** | Our verdict-check DROPS uncited/wontfix findings; a PLAUSIBLE middle class would route uncertain-but-cited findings to the fixer at lower priority instead of discarding. Requires extending the Phase-1 severity/verdict enum (single enum "defined in the Phase 1 verdict schema, shared by prompts and fixtures") and the agreement rule's severity-match clause → **plan amendment required**. Cheaper alternative with no amendment: keep drop semantics, but have prioritize() rank by lens class (correctness > cleanup) — ADOPT that ordering into naive prioritize regardless. |
| 12 | Dedup key + cap + found-vs-shown accounting | code-review.ts:126-133, 167-170 | **ADOPT** | Deterministic dedup (path:line:summary-prefix) and a findings cap (10) are cheap prioritize()/report additions; "total found vs surviving vs shown" belongs in AC2 report.md. No amendment. |
| 13 | Tool-enabled finders / read-grep reviewer context | code-review.ts:73 | **REJECT** | Violates our reviewer isolation (deny-list, diff-by-value). For a port loop the diff IS the complete change; cross-file correctness is enforced by our toolkit-owned queues against the INTEGRATED checkout — a stronger, deterministic substitute for their agent-side grep tracing. |
| 14 | MAX_DIFF_CHARS truncation with surfaced notice | code-review.ts:14, 39-49 | **ADAPT** | We cap diff size implicitly; make the cap explicit, truncate (not reject), stamp `truncated="true"` into the rendered artifact-diff, and surface coverage loss in the report — a reviewer can only review what it was shown; provenance should say so. No amendment. |
| 15 | Structured-output: terminating tool + restricted-tools repair re-prompts (default 2) before attempt failure | structured-output.ts:22-47; agent.ts:146-188 | **ADOPT (in opencode seam)** | Cheapest measurable win here: on empty/non-JSON reviewer reply, first spend a restricted repair turn ("call structured_output now as your only action…") before consuming an envelope attempt. Complements our existing empty-reply retryable class and JSON/code-fence extraction (parity elsewhere). Seam-internal → no amendment. |
| 16 | MODEL_NOT_FOUND for explicit pins vs loud onModelFallback for implicit routes | workflow.ts:1124-1145; agent.ts:202-233 | **ADAPT** | Generalize our `OPENCODE_REVIEWER_AGENT` into a per-role model/agent binding in the data-only agent definitions (harness/agents/*): explicit pin missing → hard fail fast; implicit/default missing → run proceeds on default with a loud log + report field. This is the productized form of our 25-min-vs-45s lesson, and makes the reviewer-model choice visible in AC2 per-role provenance. Harness config → no amendment. |
| 17 | Tier auto-derivation by price ranking + project overlay | model-tier-config.ts:124-210, 281-296 | **REJECT** | We have exactly one opencode server with curated agents; price-ranked auto-derivation solves a multi-vendor problem we don't have. Our per-role explicit bindings (#16) are the right scale. |
| 18 | `provider:thinking` spec strings + thinking validation | model-spec.ts:5-19, 88-106 | **ADAPT (optional)** | If we ever expose thinking per role, reuse their suffix grammar and known-spec disambiguation (ids with colons) rather than inventing one. Cosmetic for v1. |
| 19 | Capacity preflight for helper fan-outs + logical-slot accounting | workflow.ts:728-741; quality-helpers.md:7-14 | **REJECT** | Our concurrency cap is the 2-worktree lease cap enforced at one point; reviewer turns are sequential durable steps by design (dex convergence semantics, BUILD_NOTES finding 1). No fan-out to preflight. |
| 20 | Journal-replay determinism machinery (call-hash, longest-unchanged-prefix, phase-budget persistence) | workflow.ts:893-969 | **REJECT (already exceeded)** | Our op-ID + reconcile design is durable-state-based and stronger (SIGKILL survival vs cooperative replay-cache); same conclusion as the ODW evaluation. Noted only to confirm convergence: they hit the same audit lessons (#1 budget-vs-replay, #4 budget-across-resume) we baked into reconcile/marker semantics. |

### Amendment-requiring items (explicit guard check)
1. **completenessCheck as a 5th harness role** (#5) — role inventory + prep-review wiring are named in the plan → amend or defer to follow-ups. Recommended: record as follow-up alongside deferred secondary Jev integrations.
2. **PLAUSIBLE verdict class** (#11) — extends the single Phase-1 verdict enum + agreement severity-match semantics → amendment. Recommended: skip in v1; use lens-class ranking in prioritize() instead (amendment-free).
3. Anything making the reviewer count ≠ 2 (verify-threshold consensus, judgePanel) — agreement rule is defined over exactly two completed records → amendment. Not recommended for any of them.
4. **No amendment needed** for: reviewer lens differentiation (#1/#10), skeptic-prompt prior (#9), loopUntilDry-as-early-stop-within-cap (#4, with ADR note), token sub-budget knob (#8), truncation surfacing (#14), repair re-prompt (#15), per-role model binding with loud fallback (#16).

### Bottom line
Their quality layer is generic-purpose (boolean votes, score panels) where ours is domain-hardened (structured verdict records, deterministic agreement, citation-check). Nothing replaces our loop's core. The measurable transfers are all cheap and prompt/config-level: differentiated reviewer lenses (esp. removed-behavior), the "default to refuted when uncertain" prior, convergence-based loop termination, per-role model bindings with loud fallback, restricted repair re-prompts, an advisory completeness critic (amendment/v2), and a durable per-phase token budget — plus explicit truncation/discard/found-vs-shown accounting in the AC2 report.
