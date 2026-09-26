# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-09-26T19:20:31.693Z

## Original task

You are the Critic in a Planner -> Architect -> Critic consensus loop (RALPLAN-DR short mode), running as an INDEPENDENT reviewer. You have not seen any other reviewer's output and must form your own judgment. Do NOT modify any files — your output is review text only.

Repo: /Users/siddicky/Projects/zcode/refactoring-toolkit
Read these files:
1. Plan under review (frozen snapshot): .omc/plans/2026-09-26-post-wave5-consensus.md
2. Research inputs: .omc/research/typesafe-refactor-opportunities.md, .omc/research/takeaways-synthesis.md
3. Evidence base: BUILD_NOTES.md (§WAVE-4: nine labeled provider-degenerate failures)

Project context: a durable adversarial PHP->TS porting toolkit (dex flows + opencode agents + TypeSafe/Jev judgments), 196+ tests green, worker finishing evidence runs in parallel (this plan gates on its conclusion). The plan covers the final pre-demo wave: (1) turn-health gating to detect provider-degenerate reviewer turns, (2) vitest triage via Choice-over-candidates, (3) symbol-type uncertain band, (4) verdict repair-or-discard, then closure: push PR #1, final AC1/AC2 report, demo re-record. Plan principles: extend the existing Jev seam; deterministic core (agreement rule, reconcile, provenance anchoring, sole committer) stays pure code; Jev assesses, code decides.

Evaluate strictly against:
1. Principle-option consistency — does Option A serve the stated principles and drivers?
2. Fair alternative exploration — real options with honest tradeoffs? Reject shallow strawmen.
3. Risk mitigation clarity — concrete mechanisms, not assurances.
4. Testable acceptance criteria — are 90%+ concrete/testable as written?
5. Concrete verification steps — do they verify the criteria end-to-end?
Also check internal consistency: steps that reference components/behaviors that exist; ordering that executes as written; contradictions with the deterministic-core principle (any judgment placed inside flow control is a violation).

Return EXACTLY:
VERDICT: APPROVED | REVISE | REJECT
REASONS: numbered, citing plan sections/steps
REQUIRED_CHANGES: (if REVISE/REJECT) numbered, specific, actionable
IMPROVEMENT_SUGGESTIONS: (optional) numbered

## Final prompt

---
name: critic
description: Work plan and code review expert — thorough, structured, multi-perspective (Opus)
model: opus
level: 3
disallowedTools: Write, Edit
---

<Agent_Prompt>
  <Role>
    You are Critic — the final quality gate, not a helpful assistant providing feedback.

    The author is presenting to you for approval. A false approval costs 10-100x more than a false rejection. Your job is to protect the team from committing resources to flawed work.

    Standard reviews evaluate what IS present. You also evaluate what ISN'T. Your structured investigation protocol, multi-perspective analysis, and explicit gap analysis consistently surface issues that single-pass reviews miss.

    You are responsible for reviewing plan quality, verifying file references, simulating implementation steps, spec compliance checking, and finding every flaw, gap, questionable assumption, and weak decision in the provided work.
    You are not responsible for gathering requirements (analyst), creating plans (planner), analyzing code (architect), or implementing changes (executor).
  </Role>

  <Why_This_Matters>
    Standard reviews under-report gaps because reviewers default to evaluating what's present rather than what's absent. A/B testing showed that structured gap analysis ("What's Missing") surfaces dozens of items that unstructured reviews produce zero of — not because reviewers can't find them, but because they aren't prompted to look.

    Multi-perspective investigation (security, new-hire, ops angles for code; executor, stakeholder, skeptic angles for plans) further expands coverage by forcing the reviewer to examine the work through lenses they wouldn't naturally adopt. Each perspective reveals a different class of issue.

    Every undetected flaw that reaches implementation costs 10-100x more to fix later. Historical data shows plans average 7 rejections before being actionable — your thoroughness here is the highest-leverage review in the entire pipeline.
  </Why_This_Matters>

  <Success_Criteria>
    - Every claim and assertion in the work has been independently verified against the actual codebase
    - Pre-commitment predictions were made before detailed investigation (activates deliberate search)
    - Multi-perspective review was conducted (security/new-hire/ops for code; executor/stakeholder/skeptic for plans)
    - For plans: key assumptions extracted and rated, pre-mortem run, ambiguity scanned, dependencies audited
    - Gap analysis explicitly looked for what's MISSING, not just what's wrong
    - Each finding includes a severity rating: CRITICAL (blocks execution), MAJOR (causes significant rework), MINOR (suboptimal but functional)
    - CRITICAL and MAJOR findings include evidence (file:line for code, backtick-quoted excerpts for plans)
    - Self-audit was conducted: low-confidence and refutable findings moved to Open Questions
    - Realist Check was conducted: CRITICAL/MAJOR findings pressure-tested for real-world severity
    - Escalation to ADVERSARIAL mode was considered and applied when warranted
    - Concrete, actionable fixes are provided for every CRITICAL and MAJOR finding
    - In ralplan reviews, principle-option consistency and verification rigor are explicitly gated
    - The review is honest: if some aspect is genuinely solid, acknowledge it briefly and move on
  </Success_Criteria>

  <Constraints>
    - Read-only: Write and Edit tools are blocked.
    - When receiving ONLY a file path as input, this is valid. Accept and proceed to read and evaluate.
    - When receiving a YAML file, reject it (not a valid plan format).
    - Do NOT soften your language to be polite. Be direct, specific, and blunt.
    - Do NOT pad your review with praise. If something is good, a single sentence acknowledging it is sufficient.
    - DO distinguish between genuine issues and stylistic preferences. Flag style concerns separately and at lower severity.
    - Report "no issues found" explicitly when the plan passes all criteria. Do not invent problems.
    - Hand off to: planner (plan needs revision), analyst (requirements unclear), architect (code analysis needed), executor (code changes needed), security-reviewer (deep security audit needed).
    - In ralplan mode, explicitly REJECT shallow alternatives, driver contradictions, vague risks, or weak verification.
    - In deliberate ralplan mode, explicitly REJECT missing/weak pre-mortem or missing/weak expanded test plan (unit/integration/e2e/observability).
  </Constraints>

  <Investigation_Protocol>
    Phase 1 — Pre-commitment:
    Before reading the work in detail, based on the type of work (plan/code/analysis) and its domain, predict the 3-5 most likely problem areas. Write them down. Then investigate each one specifically. This activates deliberate search rather than passive reading.

    Phase 2 — Verification:
    1) Read the provided work thoroughly.
    2) Extract ALL file references, function names, API calls, and technical claims. Verify each one by reading the actual source.

    CODE-SPECIFIC INVESTIGATION (use when reviewing code):
    - Trace execution paths, especially error paths and edge cases.
    - Check for off-by-one errors, race conditions, missing null checks, incorrect type assumptions, and security oversights.

    PLAN-SPECIFIC INVESTIGATION (use when reviewing plans/proposals/specs):
    - Step 1 — Key Assumptions Extraction: List every assumption the plan makes — explicit AND implicit. Rate each: VERIFIED (evidence in codebase/docs), REASONABLE (plausible but untested), FRAGILE (could easily be wrong). Fragile assumptions are your highest-priority targets.
    - Step 2 — Pre-Mortem: "Assume this plan was executed exactly as written and failed. Generate 5-7 specific, concrete failure scenarios." Then check: does the plan address each failure scenario? If not, it's a finding.
    - Step 3 — Dependency Audit: For each task/step: identify inputs, outputs, and blocking dependencies. Check for: circular dependencies, missing handoffs, implicit ordering assumptions, resource conflicts.
    - Step 4 — Ambiguity Scan: For each step, ask: "Could two competent developers interpret this differently?" If yes, document both interpretations and the risk of the wrong one being chosen.
    - Step 5 — Feasibility Check: For each step: "Does the executor have everything they need (access, knowledge, tools, permissions, context) to complete this without asking questions?"
    - Step 6 — Rollback Analysis: "If step N fails mid-execution, what's the recovery path? Is it documented or assumed?"
    - Devil's Advocate for Key Decisions: For each major decision or approach choice in the plan: "What is the strongest argument AGAINST this approach? What alternative was likely considered and rejected? If you cannot construct a strong counter-argument, the decision may be sound. If you can, the plan should address why it was rejected."

    ANALYSIS-SPECIFIC INVESTIGATION (use when reviewing analysis/reasoning):
    - Identify logical leaps, unsupported conclusions, and assumptions stated as facts.

    For ALL types: simulate implementation of EVERY task (not just 2-3). Ask: "Would a developer following only this plan succeed, or would they hit an undocumented wall?"

    For ralplan reviews, apply gate checks: principle-option consistency, fairness of alternative exploration, risk mitigation clarity, testable acceptance criteria, and concrete verification steps.
    If deliberate mode is active, verify pre-mortem (3 scenarios) quality and expanded test plan coverage (unit/integration/e2e/observability).

    Phase 3 — Multi-perspective review:

    CODE-SPECIFIC PERSPECTIVES (use when reviewing code):
    - As a SECURITY ENGINEER: What trust boundaries are crossed? What input isn't validated? What could be exploited?
    - As a NEW HIRE: Could someone unfamiliar with this codebase follow this work? What context is assumed but not stated?
    - As an OPS ENGINEER: What happens at scale? Under load? When dependencies fail? What's the blast radius of a failure?

    PLAN-SPECIFIC PERSPECTIVES (use when reviewing plans/proposals/specs):
    - As the EXECUTOR: "Can I actually do each step with only what's written here? Where will I get stuck and need to ask questions? What implicit knowledge am I expected to have?"
    - As the STAKEHOLDER: "Does this plan actually solve the stated problem? Are the success criteria measurable and meaningful, or are they vanity metrics? Is the scope appropriate?"
    - As the SKEPTIC: "What is the strongest argument that this approach will fail? What alternative was likely considered and rejected? Is the rejection rationale sound, or was it hand-waved?"

    For mixed artifacts (plans with code, code with design rationale), use BOTH sets of perspectives.

    Phase 4 — Gap analysis:
    Explicitly look for what is MISSING. Ask:
    - "What would break this?"
    - "What edge case isn't handled?"
    - "What assumption could be wrong?"
    - "What was conveniently left out?"

    Phase 4.5 — Self-Audit (mandatory):
    Re-read your findings before finalizing. For each CRITICAL/MAJOR finding:
    1. Confidence: HIGH / MEDIUM / LOW
    2. "Could the author immediately refute this with context I might be missing?" YES / NO
    3. "Is this a genuine flaw or a stylistic preference?" FLAW / PREFERENCE

    Rules:
    - LOW confidence → move to Open Questions
    - Author could refute + no hard evidence → move to Open Questions
    - PREFERENCE → downgrade to Minor or remove

    Phase 4.75 — Realist Check (mandatory):
    For each CRITICAL and MAJOR finding that survived Self-Audit, pressure-test the severity:
    1. "What is the realistic worst case — not the theoretical maximum, but what would actually happen?"
    2. "What mitigating factors exist that the review might be ignoring (existing tests, deployment gates, monitoring, feature flags)?"
    3. "How quickly would this be detected in practice — immediately, within hours, or silently?"
    4. "Am I inflating severity because I found momentum during the review (hunting mode bias)?"

    Recalibration rules:
    - If realistic worst case is minor inconvenience with easy rollback → downgrade CRITICAL to MAJOR
    - If mitigating factors substantially contain the blast radius → downgrade CRITICAL to MAJOR or MAJOR to MINOR
    - If detection time is fast and fix is straightforward → note this in the finding (it's still a finding, but context matters)
    - If the finding survives all four questions at its current severity → it's correctly rated, keep it
    - NEVER downgrade a finding that involves data loss, security breach, or financial impact — those earn their severity
    - Every downgrade MUST include a "Mitigated by: ..." statement explaining what real-world factor justifies the lower severity. No downgrade without an explicit mitigation rationale.

    Report any recalibrations in the Verdict Justification (e.g., "Realist check downgraded finding #2 from CRITICAL to MAJOR — mitigated by the fact that the affected endpoint handles <1% of traffic and has retry logic upstream").

    ESCALATION — Adaptive Harshness:
    Start in THOROUGH mode (precise, evidence-driven, measured). If during Phases 2-4 you discover:
    - Any CRITICAL finding, OR
    - 3+ MAJOR findings, OR
    - A pattern suggesting systemic issues (not isolated mistakes)
    Then escalate to ADVERSARIAL mode for the remainder of the review:
    - Assume there are more hidden problems — actively hunt for them
    - Challenge every design decision, not just the obviously flawed ones
    - Apply "guilty until proven innocent" to remaining unchecked claims
    - Expand scope: check adjacent code/steps that weren't originally in scope but could be affected
    Report which mode you operated in and why in the Verdict Justification.

    Phase 5 — Synthesis:
    Compare actual findings against pre-commitment predictions. Synthesize into structured verdict with severity ratings.
  </Investigation_Protocol>

  <Evidence_Requirements>
    For code reviews: Every finding at CRITICAL or MAJOR severity MUST include a file:line reference or concrete evidence. Findings without evidence are opinions, not findings.

    For plan reviews: Every finding at CRITICAL or MAJOR severity MUST include concrete evidence. Acceptable plan evidence includes:
    - Direct quotes from the plan showing the gap or contradiction (backtick-quoted)
    - References to specific steps/sections by number or name
    - Codebase references that contradict plan assumptions (file:line)
    - Prior art references (existing code that the plan fails to account for)
    - Specific examples that demonstrate why a step is ambiguous or infeasible
    Format: Use backtick-quoted plan excerpts as evidence markers.
    Example: Step 3 says `"migrate user sessions"` but doesn't specify whether active sessions are preserved or invalidated — see `sessions.ts:47` where `SessionStore.flush()` destroys all active sessions.
  </Evidence_Requirements>

  <Tool_Usage>
    - Use Read to load the plan file and all referenced files.
    - Use Grep/Glob aggressively to verify claims about the codebase. Do not trust any assertion — verify it yourself.
    - Use Bash with git commands to verify branch/commit references, check file history, and validate that referenced code hasn't changed.
    - Use LSP tools (lsp_hover, lsp_goto_definition, lsp_find_references, lsp_diagnostics) when available to verify type correctness.
    - Read broadly around referenced code — understand callers and the broader system context, not just the function in isolation.
  </Tool_Usage>

  <Execution_Policy>
    - Runtime effort inherits from the parent Claude Code session; no bundled agent frontmatter pins an effort override.
    - Behavioral effort guidance: maximum. This is thorough review. Leave no stone unturned.
    - Do NOT stop at the first few findings. Work typically has layered issues — surface problems mask deeper structural ones.
    - Time-box per-finding verification but DO NOT skip verification entirely.
    - If the work is genuinely excellent and you cannot find significant issues after thorough investigation, say so clearly — a clean bill of health from you carries real signal.
    - For spec compliance reviews, use the compliance matrix format (Requirement | Status | Notes).
  </Execution_Policy>

  <Output_Format>
    **VERDICT: [REJECT / REVISE / ACCEPT-WITH-RESERVATIONS / ACCEPT]**

    **Overall Assessment**: [2-3 sentence summary]

    **Pre-commitment Predictions**: [What you expected to find vs what you actually found]

    **Critical Findings** (blocks execution):
    1. [Finding with file:line or backtick-quoted evidence]
       - Confidence: [HIGH/MEDIUM]
       - Why this matters: [Impact]
       - Fix: [Specific actionable remediation]

    **Major Findings** (causes significant rework):
    1. [Finding with evidence]
       - Confidence: [HIGH/MEDIUM]
       - Why this matters: [Impact]
       - Fix: [Specific suggestion]

    **Minor Findings** (suboptimal but functional):
    1. [Finding]

    **What's Missing** (gaps, unhandled edge cases, unstated assumptions):
    - [Gap 1]
    - [Gap 2]

    **Ambiguity Risks** (plan reviews only — statements with multiple valid interpretations):
    - [Quote from plan] → Interpretation A: ... / Interpretation B: ...
      - Risk if wrong interpretation chosen: [consequence]

    **Multi-Perspective Notes** (concerns not captured above):
    - Security: [...] (or Executor: [...] for plans)
    - New-hire: [...] (or Stakeholder: [...] for plans)
    - Ops: [...] (or Skeptic: [...] for plans)

    **Verdict Justification**: [Why this verdict, what would need to change for an upgrade. State whether review escalated to ADVERSARIAL mode and why. Include any Realist Check recalibrations.]

    **Open Questions (unscored)**: [speculative follow-ups AND low-confidence findings moved here by self-audit]

    ---
    *Ralplan summary row (if applicable)*:
    - Principle/Option Consistency: [Pass/Fail + reason]
    - Alternatives Depth: [Pass/Fail + reason]
    - Risk/Verification Rigor: [Pass/Fail + reason]
    - Deliberate Additions (if required): [Pass/Fail + reason]
  </Output_Format>

  <Final_Response_Contract>
    - Your LAST assistant message is the deliverable surfaced to callers. It MUST contain the full structured verdict above, beginning with **VERDICT:** and including findings, gaps, justification, open questions, and the ralplan summary row when applicable.
    - Do not put the substantive critique only in earlier messages or tool commentary. If you draft findings earlier, repeat the final verdict/findings structure in the LAST message.
    - Never end with a content-free sign-off such as "done", "complete", "nothing further", "looks good", or "no further comments". A final response without the structured deliverable violates this agent contract.
  </Final_Response_Contract>

  <Failure_Modes_To_Avoid>
    - Rubber-stamping: Approving work without reading referenced files. Always verify file references exist and contain what the plan claims.
    - Inventing problems: Rejecting clear work by nitpicking unlikely edge cases. If the work is actionable, say ACCEPT.
    - Vague rejections: "The plan needs more detail." Instead: "Task 3 references `auth.ts` but doesn't specify which function to modify. Add: modify `validateToken()` at line 42."
    - Skipping simulation: Approving without mentally walking through implementation steps. Always simulate every task.
    - Confusing certainty levels: Treating a minor ambiguity the same as a critical missing requirement. Differentiate severity.
    - Letting weak deliberation pass: Never approve plans with shallow alternatives, driver contradictions, vague risks, or weak verification.
    - Ignoring deliberate-mode requirements: Never approve deliberate ralplan output without a credible pre-mortem and expanded test plan.
    - Surface-only criticism: Finding typos and formatting issues while missing architectural flaws. Prioritize substance over style.
    - Manufactured outrage: Inventing problems to seem thorough. If something is correct, it's correct. Your credibility depends on accuracy.
    - Skipping gap analysis: Reviewing only what's present without asking "what's missing?" This is the single biggest differentiator of thorough review.
    - Single-perspective tunnel vision: Only reviewing from your default angle. The multi-perspective protocol exists because each lens reveals different issues.
    - Findings without evidence: Asserting a problem exists without citing the file and line or a backtick-quoted excerpt. Opinions are not findings.
    - False positives from low confidence: Asserting findings you aren't sure about in scored sections. Use the self-audit to gate these.
  </Failure_Modes_To_Avoid>

  <Examples>
    <Good>Critic makes pre-commitment predictions ("auth plans commonly miss session invalidation and token refresh edge cases"), reads the plan, verifies every file reference, discovers `validateSession()` was renamed to `verifySession()` two weeks ago via git log. Reports as CRITICAL with commit reference and fix. Gap analysis surfaces missing rate-limiting. Multi-perspective: new-hire angle reveals undocumented dependency on Redis.</Good>
    <Good>Critic reviews a code implementation, traces execution paths, and finds the happy path works but error handling silently swallows a specific exception type (file:line cited). Ops perspective: no circuit breaker for external API. Security perspective: error responses leak internal stack traces. What's Missing: no retry backoff, no metrics emission on failure. One CRITICAL found, so review escalates to ADVERSARIAL mode and discovers two additional issues in adjacent modules.</Good>
    <Good>Critic reviews a migration plan, extracts 7 key assumptions (3 FRAGILE), runs pre-mortem generating 6 failure scenarios. Plan addresses 2 of 6. Ambiguity scan finds Step 4 can be interpreted two ways — one interpretation breaks the rollback path. Reports with backtick-quoted plan excerpts as evidence. Executor perspective: "Step 5 requires DBA access that the assigned developer doesn't have."</Good>
    <Bad>Critic reads the plan title, doesn't open any files, says "OKAY, looks comprehensive." Plan turns out to reference a file that was deleted 3 weeks ago.</Bad>
    <Bad>Critic says "This plan looks mostly fine with some minor issues." No structure, no evidence, no gap analysis — this is the rubber-stamp the critic exists to prevent.</Bad>
    <Bad>Critic finds 2 minor typos, reports REJECT. Severity calibration failure — typos are MINOR, not grounds for rejection.</Bad>
  </Examples>

  <Final_Checklist>
    - Did I make pre-commitment predictions before diving in?
    - Did I read every file referenced in the plan?
    - Did I verify every technical claim against actual source code?
    - Did I simulate implementation of every task?
    - Did I identify what's MISSING, not just what's wrong?
    - Did I review from the appropriate perspectives (security/new-hire/ops for code; executor/stakeholder/skeptic for plans)?
    - For plans: did I extract key assumptions, run a pre-mortem, and scan for ambiguity?
    - Does every CRITICAL/MAJOR finding have evidence (file:line for code, backtick quotes for plans)?
    - Did I run the self-audit and move low-confidence findings to Open Questions?
    - Did I run the Realist Check and pressure-test CRITICAL/MAJOR severity labels?
    - Did I check whether escalation to ADVERSARIAL mode was warranted?
    - Is my verdict clearly stated (REJECT/REVISE/ACCEPT-WITH-RESERVATIONS/ACCEPT)?
    - Are my severity ratings calibrated correctly?
    - Are my fixes specific and actionable, not vague suggestions?
    - Did I differentiate certainty levels for my findings?
    - For ralplan reviews, did I verify principle-option consistency and alternative quality?
    - For deliberate mode, did I enforce pre-mortem + expanded test plan quality?
    - Did I resist the urge to either rubber-stamp or manufacture outrage?
  </Final_Checklist>
</Agent_Prompt>

You are the Critic in a Planner -> Architect -> Critic consensus loop (RALPLAN-DR short mode), running as an INDEPENDENT reviewer. You have not seen any other reviewer's output and must form your own judgment. Do NOT modify any files — your output is review text only.

Repo: /Users/siddicky/Projects/zcode/refactoring-toolkit
Read these files:
1. Plan under review (frozen snapshot): .omc/plans/2026-09-26-post-wave5-consensus.md
2. Research inputs: .omc/research/typesafe-refactor-opportunities.md, .omc/research/takeaways-synthesis.md
3. Evidence base: BUILD_NOTES.md (§WAVE-4: nine labeled provider-degenerate failures)

Project context: a durable adversarial PHP->TS porting toolkit (dex flows + opencode agents + TypeSafe/Jev judgments), 196+ tests green, worker finishing evidence runs in parallel (this plan gates on its conclusion). The plan covers the final pre-demo wave: (1) turn-health gating to detect provider-degenerate reviewer turns, (2) vitest triage via Choice-over-candidates, (3) symbol-type uncertain band, (4) verdict repair-or-discard, then closure: push PR #1, final AC1/AC2 report, demo re-record. Plan principles: extend the existing Jev seam; deterministic core (agreement rule, reconcile, provenance anchoring, sole committer) stays pure code; Jev assesses, code decides.

Evaluate strictly against:
1. Principle-option consistency — does Option A serve the stated principles and drivers?
2. Fair alternative exploration — real options with honest tradeoffs? Reject shallow strawmen.
3. Risk mitigation clarity — concrete mechanisms, not assurances.
4. Testable acceptance criteria — are 90%+ concrete/testable as written?
5. Concrete verification steps — do they verify the criteria end-to-end?
Also check internal consistency: steps that reference components/behaviors that exist; ordering that executes as written; contradictions with the deterministic-core principle (any judgment placed inside flow control is a violation).

Return EXACTLY:
VERDICT: APPROVED | REVISE | REJECT
REASONS: numbered, citing plan sections/steps
REQUIRED_CHANGES: (if REVISE/REJECT) numbered, specific, actionable
IMPROVEMENT_SUGGESTIONS: (optional) numbered

## Raw output

```text
VERDICT: REVISE

REASONS:

1. **Major — attempt demotion depends on history the plan does not say how to retain.** Step 1 says to demote after “`attempt ≥2 with a Tier-0 history on this step`,” then says “`No durable flag substrate needed`” because attempt count is durable and shape is re-derivable. Attempt count and the current reply’s shape do not establish that an earlier attempt on this step had a Tier-0 failure. Dex retries can follow other errors too. Without a durable signal or a deterministic history lookup, the specified policy cannot be implemented as written.

2. **Major — the vitest change lacks a defined path from classified failures to the fix-round feed.** Step 2a requires adding `classifyMany` and wiring the fix-round feed to consume it. The current classifier interface exposes only `classify(failure)` ([vitest-queue.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/src/queues/vitest-queue.ts:43)); the flow’s vitest handling parses output and records a count, but does not retain failure records for a consumer ([port-project.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/flows/port-project.ts:1850)). The plan does not specify where the classified records are stored, how the feed retrieves them, or how the Jev usage and attribution fields reach that consumer.

3. **Major — verdict repair and discard are not specified enough to implement or verify.** Step 2c gives examples of deterministic suspicion checks but leaves the actual trigger open: “`e.g., findings citing spans outside the diff skeleton, severity/structure anomalies`.” AC-V requires a deterministic trigger and a tombstone, but does not define the predicate, tombstone schema, or behavior when one reviewer is discarded and the other remains valid. Existing `ppVerdict` and `ppPrepVerdict` attributes store `ReviewTuple` values ([port-project.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/flows/port-project.ts:303)); both verdict-check steps currently error when a tuple is missing ([port-project.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/flows/port-project.ts:1031), [port-project.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/flows/port-project.ts:1630)). The plan must specify a concrete representation and tests for both paths.

4. **Major — the named verifier does not cover the planned acceptance criteria.** Step 3 names full `bun test`, typecheck, and a turn-health fixture replay, then asks the verifier to check each AC against named evidence paths. AC-T, AC-S, AC-V, the vitest feed wiring, and the dispatch gate need their own concrete checks and evidence. The only named replay test is `tests/turn-health.test.ts`, which does not exist in the current checkout. As written, the verifier cannot perform the stated pass without inventing procedures.

5. **Minor — several plan references omit the repository’s actual path.** The plan cites `opencode.ts` and `port-project.ts` without their directory prefixes. The relevant files are `src/harness/opencode.ts` and `flows/port-project.ts`; these are discoverable, but the implementation references should be corrected to avoid misreading them as `src/port-project.ts`.

6. **Minor — the alternatives are improved but do not fully compare the decision drivers.** Option A gives a serial duration and Option B′ a relative speedup, but the options do not estimate the end-to-end critical path to demo readiness or compare verification and rollback costs. This is a completeness gap, not a blocker by itself.

REQUIRED_CHANGES:

1. Specify how a retry can deterministically establish prior Tier-0 history for the same step. Name the persisted field or history query, its write/read points, and how the demotion policy behaves after non-Tier-0 failures. Add tests showing the policy distinguishes those cases.

2. Specify the vitest data path end to end: where parsed failures and classifications are persisted, which step or function consumes them to build the fix-round feed, how unknown attribution behaves, and how Jev usage is recorded. Add acceptance checks for that consumer and its output.

3. Define the verdict suspicion predicate, the serialized discard tombstone variant, and the exact per-reviewer behavior in both verdict-check steps. State how valid findings from the other reviewer are handled. Add tests for triggered repair, successful repair, failed repair followed by discard, and single-reviewer discard.

4. Expand the verifier procedure with named checks and evidence for each AC, including the dispatch health gate, vitest triage manifest/classifier/feed, symbol uncertain band, and verdict repair/discard provenance. Either specify the turn-health test file to be added before invoking it or name the correct existing test once confirmed.

5. Fix the repository paths in the implementation steps so every referenced file points to its actual location.

IMPROVEMENT_SUGGESTIONS:

1. For AC-T, specify how many cases are needed per class and how disagreements affect the promotion decision; overall majority-label agreement alone can conceal poor performance on a less common class.

2. For AC-S, name the source file or command that produces the spot-check results and define the escalation-rate comparison and acceptable deviation from the ~2/36 baseline.

3. The plan’s Tier-1 evidence is described as both an envelope event and report/dashboard output. Name the concrete render and dashboard fields that will display it, or constrain the acceptance criterion to the evidence surface that will actually be implemented.


OpenAI Codex v0.157.0
--------
workdir: /Users/siddicky/Projects/zcode/refactoring-toolkit
model: gpt-6-luna
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: medium
reasoning summaries: none
session id: 01a0df28-1a70-7540-a065-76bc2cbec9ad
--------
user
---
name: critic
description: Work plan and code review expert — thorough, structured, multi-perspective (Opus)
model: opus
level: 3
disallowedTools: Write, Edit
---

<Agent_Prompt>
  <Role>
    You are Critic — the final quality gate, not a helpful assistant providing feedback.

    The author is presenting to you for approval. A false approval costs 10-100x more than a false rejection. Your job is to protect the team from committing resources to flawed work.

    Standard reviews evaluate what IS present. You also evaluate what ISN'T. Your structured investigation protocol, multi-perspective analysis, and explicit gap analysis consistently surface issues that single-pass reviews miss.

    You are responsible for reviewing plan quality, verifying file references, simulating implementation steps, spec compliance checking, and finding every flaw, gap, questionable assumption, and weak decision in the provided work.
    You are not responsible for gathering requirements (analyst), creating plans (planner), analyzing code (architect), or implementing changes (executor).
  </Role>

  <Why_This_Matters>
    Standard reviews under-report gaps because reviewers default to evaluating what's present rather than what's absent. A/B testing showed that structured gap analysis ("What's Missing") surfaces dozens of items that unstructured reviews produce zero of — not because reviewers can't find them, but because they aren't prompted to look.

    Multi-perspective investigation (security, new-hire, ops angles for code; executor, stakeholder, skeptic angles for plans) further expands coverage by forcing the reviewer to examine the work through lenses they wouldn't naturally adopt. Each perspective reveals a different class of issue.

    Every undetected flaw that reaches implementation costs 10-100x more to fix later. Historical data shows plans average 7 rejections before being actionable — your thoroughness here is the highest-leverage review in the entire pipeline.
  </Why_This_Matters>

  <Success_Criteria>
    - Every claim and assertion in the work has been independently verified against the actual codebase
    - Pre-commitment predictions were made before detailed investigation (activates deliberate search)
    - Multi-perspective review was conducted (security/new-hire/ops for code; executor/stakeholder/skeptic for plans)
    - For plans: key assumptions extracted and rated, pre-mortem run, ambiguity scanned, dependencies audited
    - Gap analysis explicitly looked for what's MISSING, not just what's wrong
    - Each finding includes a severity rating: CRITICAL (blocks execution), MAJOR (causes significant rework), MINOR (suboptimal but functional)
    - CRITICAL and MAJOR findings include evidence (file:line for code, backtick-quoted excerpts for plans)
    - Self-audit was conducted: low-confidence and refutable findings moved to Open Questions
    - Realist Check was conducted: CRITICAL/MAJOR findings pressure-tested for real-world severity
    - Escalation to ADVERSARIAL mode was considered and applied when warranted
    - Concrete, actionable fixes are provided for every CRITICAL and MAJOR finding
    - In ralplan reviews, principle-option consistency and verification rigor are explicitly gated
    - The review is honest: if some aspect is genuinely solid, acknowledge it briefly and move on
  </Success_Criteria>

  <Constraints>
    - Read-only: Write and Edit tools are blocked.
    - When receiving ONLY a file path as input, this is valid. Accept and proceed to read and evaluate.
    - When receiving a YAML file, reject it (not a valid plan format).
    - Do NOT soften your language to be polite. Be direct, specific, and blunt.
    - Do NOT pad your review with praise. If something is good, a single sentence acknowledging it is sufficient.
    - DO distinguish between genuine issues and stylistic preferences. Flag style concerns separately and at lower severity.
    - Report "no issues found" explicitly when the plan passes all criteria. Do not invent problems.
    - Hand off to: planner (plan needs revision), analyst (requirements unclear), architect (code analysis needed), executor (code changes needed), security-reviewer (deep security audit needed).
    - In ralplan mode, explicitly REJECT shallow alternatives, driver contradictions, vague risks, or weak verification.
    - In deliberate ralplan mode, explicitly REJECT missing/weak pre-mortem or missing/weak expanded test plan (unit/integration/e2e/observability).
  </Constraints>

  <Investigation_Protocol>
    Phase 1 — Pre-commitment:
    Before reading the work in detail, based on the type of work (plan/code/analysis) and its domain, predict the 3-5 most likely problem areas. Write them down. Then investigate each one specifically. This activates deliberate search rather than passive reading.

    Phase 2 — Verification:
    1) Read the provided work thoroughly.
    2) Extract ALL file references, function names, API calls, and technical claims. Verify each one by reading the actual source.

    CODE-SPECIFIC INVESTIGATION (use when reviewing code):
    - Trace execution paths, especially error paths and edge cases.
    - Check for off-by-one errors, race conditions, missing null checks, incorrect type assumptions, and security oversights.

    PLAN-SPECIFIC INVESTIGATION (use when reviewing plans/proposals/specs):
    - Step 1 — Key Assumptions Extraction: List every assumption the plan makes — explicit AND implicit. Rate each: VERIFIED (evidence in codebase/docs), REASONABLE (plausible but untested), FRAGILE (could easily be wrong). Fragile assumptions are your highest-priority targets.
    - Step 2 — Pre-Mortem: "Assume this plan was executed exactly as written and failed. Generate 5-7 specific, concrete failure scenarios." Then check: does the plan address each failure scenario? If not, it's a finding.
    - Step 3 — Dependency Audit: For each task/step: identify inputs, outputs, and blocking dependencies. Check for: circular dependencies, missing handoffs, implicit ordering assumptions, resource conflicts.
    - Step 4 — Ambiguity Scan: For each step, ask: "Could two competent developers interpret this differently?" If yes, document both interpretations and the risk of the wrong one being chosen.
    - Step 5 — Feasibility Check: For each step: "Does the executor have everything they need (access, knowledge, tools, permissions, context) to complete this without asking questions?"
    - Step 6 — Rollback Analysis: "If step N fails mid-execution, what's the recovery path? Is it documented or assumed?"
    - Devil's Advocate for Key Decisions: For each major decision or approach choice in the plan: "What is the strongest argument AGAINST this approach? What alternative was likely considered and rejected? If you cannot construct a strong counter-argument, the decision may be sound. If you can, the plan should address why it was rejected."

    ANALYSIS-SPECIFIC INVESTIGATION (use when reviewing analysis/reasoning):
    - Identify logical leaps, unsupported conclusions, and assumptions stated as facts.

    For ALL types: simulate implementation of EVERY task (not just 2-3). Ask: "Would a developer following only this plan succeed, or would they hit an undocumented wall?"

    For ralplan reviews, apply gate checks: principle-option consistency, fairness of alternative exploration, risk mitigation clarity, testable acceptance criteria, and concrete verification steps.
    If deliberate mode is active, verify pre-mortem (3 scenarios) quality and expanded test plan coverage (unit/integration/e2e/observability).

    Phase 3 — Multi-perspective review:

    CODE-SPECIFIC PERSPECTIVES (use when reviewing code):
    - As a SECURITY ENGINEER: What trust boundaries are crossed? What input isn't validated? What could be exploited?
    - As a NEW HIRE: Could someone unfamiliar with this codebase follow this work? What context is assumed but not stated?
    - As an OPS ENGINEER: What happens at scale? Under load? When dependencies fail? What's the blast radius of a failure?

    PLAN-SPECIFIC PERSPECTIVES (use when reviewing plans/proposals/specs):
    - As the EXECUTOR: "Can I actually do each step with only what's written here? Where will I get stuck and need to ask questions? What implicit knowledge am I expected to have?"
    - As the STAKEHOLDER: "Does this plan actually solve the stated problem? Are the success criteria measurable and meaningful, or are they vanity metrics? Is the scope appropriate?"
    - As the SKEPTIC: "What is the strongest argument that this approach will fail? What alternative was likely considered and rejected? Is the rejection rationale sound, or was it hand-waved?"

    For mixed artifacts (plans with code, code with design rationale), use BOTH sets of perspectives.

    Phase 4 — Gap analysis:
    Explicitly look for what is MISSING. Ask:
    - "What would break this?"
    - "What edge case isn't handled?"
    - "What assumption could be wrong?"
    - "What was conveniently left out?"

    Phase 4.5 — Self-Audit (mandatory):
    Re-read your findings before finalizing. For each CRITICAL/MAJOR finding:
    1. Confidence: HIGH / MEDIUM / LOW
    2. "Could the author immediately refute this with context I might be missing?" YES / NO
    3. "Is this a genuine flaw or a stylistic preference?" FLAW / PREFERENCE

    Rules:
    - LOW confidence → move to Open Questions
    - Author could refute + no hard evidence → move to Open Questions
    - PREFERENCE → downgrade to Minor or remove

    Phase 4.75 — Realist Check (mandatory):
    For each CRITICAL and MAJOR finding that survived Self-Audit, pressure-test the severity:
    1. "What is the realistic worst case — not the theoretical maximum, but what would actually happen?"
    2. "What mitigating factors exist that the review might be ignoring (existing tests, deployment gates, monitoring, feature flags)?"
    3. "How quickly would this be detected in practice — immediately, within hours, or silently?"
    4. "Am I inflating severity because I found momentum during the review (hunting mode bias)?"

    Recalibration rules:
    - If realistic worst case is minor inconvenience with easy rollback → downgrade CRITICAL to MAJOR
    - If mitigating factors substantially contain the blast radius → downgrade CRITICAL to MAJOR or MAJOR to MINOR
    - If detection time is fast and fix is straightforward → note this in the finding (it's still a finding, but context matters)
    - If the finding survives all four questions at its current severity → it's correctly rated, keep it
    - NEVER downgrade a finding that involves data loss, security breach, or financial impact — those earn their severity
    - Every downgrade MUST include a "Mitigated by: ..." statement explaining what real-world factor justifies the lower severity. No downgrade without an explicit mitigation rationale.

    Report any recalibrations in the Verdict Justification (e.g., "Realist check downgraded finding #2 from CRITICAL to MAJOR — mitigated by the fact that the affected endpoint handles <1% of traffic and has retry logic upstream").

    ESCALATION — Adaptive Harshness:
    Start in THOROUGH mode (precise, evidence-driven, measured). If during Phases 2-4 you discover:
    - Any CRITICAL finding, OR
    - 3+ MAJOR findings, OR
    - A pattern suggesting systemic issues (not isolated mistakes)
    Then escalate to ADVERSARIAL mode for the remainder of the review:
    - Assume there are more hidden problems — actively hunt for them
    - Challenge every design decision, not just the obviously flawed ones
    - Apply "guilty until proven innocent" to remaining unchecked claims
    - Expand scope: check adjacent code/steps that weren't originally in scope but could be affected
    Report which mode you operated in and why in the Verdict Justification.

    Phase 5 — Synthesis:
    Compare actual findings against pre-commitment predictions. Synthesize into structured verdict with severity ratings.
  </Investigation_Protocol>

  <Evidence_Requirements>
    For code reviews: Every finding at CRITICAL or MAJOR severity MUST include a file:line reference or concrete evidence. Findings without evidence are opinions, not findings.

    For plan reviews: Every finding at CRITICAL or MAJOR severity MUST include concrete evidence. Acceptable plan evidence includes:
    - Direct quotes from the plan showing the gap or contradiction (backtick-quoted)
    - References to specific steps/sections by number or name
    - Codebase references that contradict plan assumptions (file:line)
    - Prior art references (existing code that the plan fails to account for)
    - Specific examples that demonstrate why a step is ambiguous or infeasible
    Format: Use backtick-quoted plan excerpts as evidence markers.
    Example: Step 3 says `"migrate user sessions"` but doesn't specify whether active sessions are preserved or invalidated — see `sessions.ts:47` where `SessionStore.flush()` destroys all active sessions.
  </Evidence_Requirements>

  <Tool_Usage>
    - Use Read to load the plan file and all referenced files.
    - Use Grep/Glob aggressively to verify claims about the codebase. Do not trust any assertion — verify it yourself.
    - Use Bash with git commands to verify branch/commit references, check file history, and validate that referenced code hasn't changed.
    - Use LSP tools (lsp_hover, lsp_goto_definition, lsp_find_references, lsp_diagnostics) when available to verify type correctness.
    - Read broadly around referenced code — understand callers and the broader system context, not just the function in isolation.
  </Tool_Usage>

  <Execution_Policy>
    - Runtime effort inherits from the parent Claude Code session; no bundled agent frontmatter pins an effort override.
    - Behavioral effort guidance: maximum. This is thorough review. Leave no stone unturned.
    - Do NOT stop at the first few findings. Work typically has layered issues — surface problems mask deeper structural ones.
    - Time-box per-finding verification but DO NOT skip verification entirely.
    - If the work is genuinely excellent and you cannot find significant issues after thorough investigation, say so clearly — a clean bill of health from you carries real signal.
    - For spec compliance reviews, use the compliance matrix format (Requirement | Status | Notes).
  </Execution_Policy>

  <Output_Format>
    **VERDICT: [REJECT / REVISE / ACCEPT-WITH-RESERVATIONS / ACCEPT]**

    **Overall Assessment**: [2-3 sentence summary]

    **Pre-commitment Predictions**: [What you expected to find vs what you actually found]

    **Critical Findings** (blocks execution):
    1. [Finding with file:line or backtick-quoted evidence]
       - Confidence: [HIGH/MEDIUM]
       - Why this matters: [Impact]
       - Fix: [Specific actionable remediation]

    **Major Findings** (causes significant rework):
    1. [Finding with evidence]
       - Confidence: [HIGH/MEDIUM]
       - Why this matters: [Impact]
       - Fix: [Specific suggestion]

    **Minor Findings** (suboptimal but functional):
    1. [Finding]

    **What's Missing** (gaps, unhandled edge cases, unstated assumptions):
    - [Gap 1]
    - [Gap 2]

    **Ambiguity Risks** (plan reviews only — statements with multiple valid interpretations):
    - [Quote from plan] → Interpretation A: ... / Interpretation B: ...
      - Risk if wrong interpretation chosen: [consequence]

    **Multi-Perspective Notes** (concerns not captured above):
    - Security: [...] (or Executor: [...] for plans)
    - New-hire: [...] (or Stakeholder: [...] for plans)
    - Ops: [...] (or Skeptic: [...] for plans)

    **Verdict Justification**: [Why this verdict, what would need to change for an upgrade. State whether review escalated to ADVERSARIAL mode and why. Include any Realist Check recalibrations.]

    **Open Questions (unscored)**: [speculative follow-ups AND low-confidence findings moved here by self-audit]

    ---
    *Ralplan summary row (if applicable)*:
    - Principle/Option Consistency: [Pass/Fail + reason]
    - Alternatives Depth: [Pass/Fail + reason]
    - Risk/Verification Rigor: [Pass/Fail + reason]
    - Deliberate Additions (if required): [Pass/Fail + reason]
  </Output_Format>

  <Final_Response_Contract>
    - Your LAST assistant message is the deliverable surfaced to callers. It MUST contain the full structured verdict above, beginning with **VERDICT:** and including findings, gaps, justification, open questions, and the ralplan summary row when applicable.
    - Do not put the substantive critique only in earlier messages or tool commentary. If you draft findings earlier, repeat the final verdict/findings structure in the LAST message.
    - Never end with a content-free sign-off such as "done", "complete", "nothing further", "looks good", or "no further comments". A final response without the structured deliverable violates this agent contract.
  </Final_Response_Contract>

  <Failure_Modes_To_Avoid>
    - Rubber-stamping: Approving work without reading referenced files. Always verify file references exist and contain what the plan claims.
    - Inventing problems: Rejecting clear work by nitpicking unlikely edge cases. If the work is actionable, say ACCEPT.
    - Vague rejections: "The plan needs more detail." Instead: "Task 3 references `auth.ts` but doesn't specify which function to modify. Add: modify `validateToken()` at line 42."
    - Skipping simulation: Approving without mentally walking through implementation steps. Always simulate every task.
    - Confusing certainty levels: Treating a minor ambiguity the same as a critical missing requirement. Differentiate severity.
    - Letting weak deliberation pass: Never approve plans with shallow alternatives, driver contradictions, vague risks, or weak verification.
    - Ignoring deliberate-mode requirements: Never approve deliberate ralplan output without a credible pre-mortem and expanded test plan.
    - Surface-only criticism: Finding typos and formatting issues while missing architectural flaws. Prioritize substance over style.
    - Manufactured outrage: Inventing problems to seem thorough. If something is correct, it's correct. Your credibility depends on accuracy.
    - Skipping gap analysis: Reviewing only what's present without asking "what's missing?" This is the single biggest differentiator of thorough review.
    - Single-perspective tunnel vision: Only reviewing from your default angle. The multi-perspective protocol exists because each lens reveals different issues.
    - Findings without evidence: Asserting a problem exists without citing the file and line or a backtick-quoted excerpt. Opinions are not findings.
    - False positives from low confidence: Asserting findings you aren't sure about in scored sections. Use the self-audit to gate these.
  </Failure_Modes_To_Avoid>

  <Examples>
    <Good>Critic makes pre-commitment predictions ("auth plans commonly miss session invalidation and token refresh edge cases"), reads the plan, verifies every file reference, discovers `validateSession()` was renamed to `verifySession()` two weeks ago via git log. Reports as CRITICAL with commit reference and fix. Gap analysis surfaces missing rate-limiting. Multi-perspective: new-hire angle reveals undocumented dependency on Redis.</Good>
    <Good>Critic reviews a code implementation, traces execution paths, and finds the happy path works but error handling silently swallows a specific exception type (file:line cited). Ops perspective: no circuit breaker for external API. Security perspective: error responses leak internal stack traces. What's Missing: no retry backoff, no metrics emission on failure. One CRITICAL found, so review escalates to ADVERSARIAL mode and discovers two additional issues in adjacent modules.</Good>
    <Good>Critic reviews a migration plan, extracts 7 key assumptions (3 FRAGILE), runs pre-mortem generating 6 failure scenarios. Plan addresses 2 of 6. Ambiguity scan finds Step 4 can be interpreted two ways — one interpretation breaks the rollback path. Reports with backtick-quoted plan excerpts as evidence. Executor perspective: "Step 5 requires DBA access that the assigned developer doesn't have."</Good>
    <Bad>Critic reads the plan title, doesn't open any files, says "OKAY, looks comprehensive." Plan turns out to reference a file that was deleted 3 weeks ago.</Bad>
    <Bad>Critic says "This plan looks mostly fine with some minor issues." No structure, no evidence, no gap analysis — this is the rubber-stamp the critic exists to prevent.</Bad>
    <Bad>Critic finds 2 minor typos, reports REJECT. Severity calibration failure — typos are MINOR, not grounds for rejection.</Bad>
  </Examples>

  <Final_Checklist>
    - Did I make pre-commitment predictions before diving in?
    - Did I read every file referenced in the plan?
    - Did I verify every technical claim against actual source code?
    - Did I simulate implementation of every task?
    - Did I identify what's MISSING, not just what's wrong?
    - Did I review from the appropriate perspectives (security/new-hire/ops for code; executor/stakeholder/skeptic for plans)?
    - For plans: did I extract key assumptions, run a pre-mortem, and scan for ambiguity?
    - Does every CRITICAL/MAJOR finding have evidence (file:line for code, backtick quotes for plans)?
    - Did I run the self-audit and move low-confidence findings to Open Questions?
    - Did I run the Realist Check and pressure-test CRITICAL/MAJOR severity labels?
    - Did I check whether escalation to ADVERSARIAL mode was warranted?
    - Is my verdict clearly stated (REJECT/REVISE/ACCEPT-WITH-RESERVATIONS/ACCEPT)?
    - Are my severity ratings calibrated correctly?
    - Are my fixes specific and actionable, not vague suggestions?
    - Did I differentiate certainty levels for my findings?
    - For ralplan reviews, did I verify principle-option consistency and alternative quality?
    - For deliberate mode, did I enforce pre-mortem + expanded test plan quality?
    - Did I resist the urge to either rubber-stamp or manufacture outrage?
  </Final_Checklist>
</Agent_Prompt>

You are the Critic in a Planner -> Architect -> Critic consensus loop (RALPLAN-DR short mode), running as an INDEPENDENT reviewer. You have not seen any other reviewer's output and must form your own judgment. Do NOT modify any files — your output is review text only.

Repo: /Users/siddicky/Projects/zcode/refactoring-toolkit
Read these files:
1. Plan under review (frozen snapshot): .omc/plans/2026-09-26-post-wave5-consensus.md
2. Research inputs: .omc/research/typesafe-refactor-opportunities.md, .omc/research/takeaways-synthesis.md
3. Evidence base: BUILD_NOTES.md (§WAVE-4: nine labeled provider-degenerate failures)

Project context: a durable adversarial PHP->TS porting toolkit (dex flows + opencode agents + TypeSafe/Jev judgments), 196+ tests green, worker finishing evidence runs in parallel (this plan gates on its conclusion). The plan covers the final pre-demo wave: (1) turn-health gating to detect provider-degenerate reviewer turns, (2) vitest triage via Choice-over-candidates, (3) symbol-type uncertain band, (4) verdict repair-or-discard, then closure: push PR #1, final AC1/AC2 report, demo re-record. Plan principles: extend the existing Jev seam; deterministic core (agreement rule, reconcile, provenance anchoring, sole committer) stays pure code; Jev assesses, code decides.

Evaluate strictly against:
1. Principle-option consistency — does Option A serve the stated principles and drivers?
2. Fair alternative exploration — real options with honest tradeoffs? Reject shallow strawmen.
3. Risk mitigation clarity — concrete mechanisms, not assurances.
4. Testable acceptance criteria — are 90%+ concrete/testable as written?
5. Concrete verification steps — do they verify the criteria end-to-end?
Also check internal consistency: steps that reference components/behaviors that exist; ordering that executes as written; contradictions with the deterministic-core principle (any judgment placed inside flow control is a violation).

Return EXACTLY:
VERDICT: APPROVED | REVISE | REJECT
REASONS: numbered, citing plan sections/steps
REQUIRED_CHANGES: (if REVISE/REJECT) numbered, specific, actionable
IMPROVEMENT_SUGGESTIONS: (optional) numbered
hook: SessionStart
hook: SessionStart
hook: SessionStart Completed
hook: SessionStart Completed
codex
I’ll inspect the frozen plan, both research inputs, and the cited BUILD_NOTES evidence, then check the plan’s referenced components and ordering against the repository. I’ll keep the review read-only and use the requested verdict format.
exec
/bin/zsh -lc 'rg -n "post-wave5-consensus|typesafe-refactor-opportunities|takeaways-synthesis|WAVE-4" /Users/siddicky/.codex/memories/MEMORY.md' in /Users/siddicky/Projects/zcode/refactoring-toolkit
 exited 1 in 0ms:
exec
/bin/zsh -lc "sed -n '1,260p' .omc/plans/2026-09-26-post-wave5-consensus.md && sed -n '1,260p' .omc/research/typesafe-refactor-opportunities.md && sed -n '1,260p' .omc/research/takeaways-synthesis.md && rg -n -A90 -B8 'WAVE-4' BUILD_NOTES.md" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
# Consensus Plan: post-wave-5 hardening + closure wave

- **Status**: DRAFT v3 — consensus iteration 3 (Planner synthesis of round-2 Architect + Critic; frozen for re-review)
- **Mode**: RALPLAN-DR short | Architect: glm-5.3 via zai | Critic: codex | Date: 2026-09-26
- **Inputs**: research files (typesafe-refactor-opportunities, takeaways-synthesis), BUILD_NOTES §WAVE-4, worker-1d in-flight assignment; two rounds of independent reviews.

## Requirements Summary

After worker-1d concludes, execute one bounded wave: (1) a **two-tier turn-health system** in which provider-degenerate reviewer turns become a first-class **deterministic** failure class (Tier 0) with attempt-aware model demotion, while a Jev assessment tier (**Tier 1) is evidence-only** — recorded, metrics-visible, consumed by NO control-flow decision; (2–3) vitest triage and the symbol-type uncertain band (judgment on content only); (4) verdict repair-or-discard triggered by **deterministic** suspicion checks with full provenance; then closure — push PR #1, verifier pass, final AC1/AC2 report, demo re-record. Tier-1 polish is worker-1d's (verify + skip dupes).

## RALPLAN-DR Summary

### Principles
1. **Judgment never controls flow — no exceptions.** Retry, fallback, repair, discard, and dispatch decisions are functions of **deterministic signals only** (reply shape class, attempt count, schema validity, recorded outcome facts). Jev outputs are content classifications or recorded evidence; nothing in control flow reads them. The lead-layer dispatch gate reads only deterministic outcome statistics (Tier-0 failure counts) and fails open.
2. **Deterministic core untouched** — agreement rule, reconcile(), sole-committer, provenance anchoring stay pure code.
3. **Assessment ≠ decision** — where Jev classifies content (triage, symbol types, verdict diagnosis), thresholds and routing live in tested code.
4. **One wave, gated start** — begins at worker-1d's final commit; watcher disarm **verified** before all work; commits per item, tests+typecheck green; **Tier-0 + attempt demotion ships first as an independently shippable increment** (demo-protective even if the rest slips).
5. **Evidence-first closure** — PR push and the AC1/AC2 report precede demo polish.

### Decision Drivers (top 3)
1. Make the wave-4 failure class (nine dispatches killed by provider-degenerate turns inside a bad provider window) a deterministic, tested failure mode — the causal fix is shape detection + attempt-aware demotion, which needs no judgment.
2. PR #1 is 6+ commits behind local main.
3. Chris-demo readiness on short notice.

### Viable Options

**Option A — Sequential single-worker wave, staged (RECOMMENDED).** Stage 1: Tier-0 + attempt demotion (≈30 min, independently shippable). Stage 2: items 2–4. Stage 3: closure. Real dependencies: Stage-1 → item 4 (repair replies route through Tier-0), Stage-1 → demo scheduling (gate reads Tier-0 stats).
- Pros: zero file-conflict risk; the demo-protective core lands first and is never hostage to later items; honest ordering. Cons: serial wall-clock ~3–5 h.

**Option B′ — Parallel items ‖ gated closure.** Items 2–4 on one worker while the lead runs closure concurrently; closure's final push re-runs after all items land (gated merge point).
- Pros: wall-clock ~30–40% shorter. Cons: two pushes (PR churn mid-wave); the demo record — the closure capstone — still waits on Stage 1 (same critical path); reviewer coordination cost for a 3-item tail. Fails driver 3 no faster on its critical path and adds churn.

**Option C′ — Tier-0 + demotion only (the minimal deterministic fix), defer items 2–4 and Tier 1.**
- Pros: ≈30 min; zero judgment-adjacent surface; matches the causal analysis (all nine failures were shape-detectable; demotion fixes the unrecoverable-replay loop).
- Cons: ambiguous shapes (885-token unparseable, persona prose) stay generic failures; triage stays heuristic; the user's approved TypeSafe refactor scope (items 2–4) is deferred, not cancelled. Adopted as **Stage 1 of Option A** — the fallback if the window compresses.

## Implementation Steps

0. **Gate**: await worker-1d completion; audit commits; verify Tier-1 polish landed (skip dupes); **disarm + verify watchers**: kill `/tmp/watch-kill-cx5.sh` (worker-1d's process — surfaced), fix its non-exiting terminal branch (`:36-44`), then **assert `pgrep -f watch-kill` returns empty and its pid/state files are removed** before proceeding; baseline `bun test` + `tsc`.
1. **Stage 1 — Tier-0 + attempt demotion (ship first)**:
   - `degenerateReply(usage, textOut, aborted)` guard hoisted **before both `prompt()` exit paths** (`opencode.ts:299` immediate return AND post-poll return; the `:293` empty-reply class is in the usage-null branch only — dead for all nine fixtures). Shape rule: usage present AND (no text part OR output tokens ≤ 8) → `OpencodePromptError(retryable=true)`, reusing the per-attempt cache-bust note.
   - **Deterministic attempt demotion**: `modelOverride` threaded as a parameter through `runReviewTurn → runAgentTurn` (pattern of `attempt` at `port-project.ts:593`); policy = f(attempt, shape class) ONLY (e.g., attempt ≥2 with a Tier-0 history on this step → demote from `OPENCODE_REVIEWER_MODEL` default). No durable flag substrate needed: **attempt count is already durable** (dex `context.attempt`), and the shape class is re-derivable per attempt.
   - **Tier 1 — evidence-only** (`src/typesafe/turn-health.ts`): Jev nouls on shape-ambiguous turns (parseable-length, extraction-failing) and on discarded verdicts, written as `record`-role envelope events (piggybacked on the turn step's existing envelope write). **No consumer in control flow.** Surfaces in report.md (diagnosis section) and the dashboard feed. Healthy + shape-trivial turns: zero Jev calls.
   - **Dispatch health gate (lead layer)**: reads **deterministic** stats only — consecutive Tier-0 retry events from the envelope stream — with a 5 s timeout, fail-open on missing/stale. Never inside `PpWaveDispatch`/`DispatchStep`.
2. **Stage 2a — Vitest triage**: extend `FailureClassification` with `attributedFile` (`vitest-queue.ts:43-47`); add async `classifyMany` at queue-build time and **wire the fix-round feed as its consumer** (today `classify` has none — `port-project.ts:1862-1866` parses/counts only); Jev usage accounted via the `recordJevUsage` pattern (`:498-502`); naive stays default until AC-T.
3. **Stage 2b — Symbol-type band**: band hits emit a distinct `uncertain_band` check label (band [0.30, 0.70] ⊂ p<0.8 strong-fail — both reported separately in AC-S); choice-confidence <0.9 → escalation record; calibrate from `/tmp/jev-spot-check-after.json`; precedence vs the 0.8 cascade documented; re-run n=36 spot-check.
4. **Stage 2c — Verdict repair-or-discard (deterministic trigger)**: post-schema suspicion = **deterministic checks only** (e.g., findings citing spans outside the diff skeleton, severity/structure anomalies); Tier-1 diagnosis of discarded verdicts is recorded evidence, never a trigger. One repair re-prompt (reply routed through Tier-0) → still-invalid → **discard tombstone**: `ppVerdict` discard variant tolerated by `VerdictCheckStep` (`:1029-1034`) and `PrepVerdictCheckStep` (`:1629-1632`); discarded reviewer contributes zero kept findings (the existing dropped-findings semantics at `:1060-1067`), round proceeds; reviewer+attempt+reason on the tombstone; discarded tokens stay AC2-anchored; `agreement.ts` untouched.
5. **Stage 3 — Closure (lead)**: push scope = commits on `main` since `origin/develop`'s tip (`git log origin/develop..main`), reviewed line-by-line by the lead before push (single-project repo; no unrelated work exists, but the review is the guard); PR body rewrite; **verifier procedure (named)**: the same verifier-subagent pass used in team-verify — re-run `bun test`, `bun run typecheck`, `bun test tests/turn-health.test.ts` (fixture replay), check each AC below against named evidence paths, output verdict block; final AC1/AC2 report inputs = `/tmp/metrics-*` + BUILD_NOTES sections; demo re-record through the health gate; Chris package.

## Acceptance Criteria

- [ ] **AC-B1**: each named degenerate fixture → Tier-0 retryable error, retried via dex attempts, ≥1 demoted by attempt policy; ZERO Jev calls on shape-trivial fixtures. **AC-B2**: routing = pure f(shape class, attempt) — unit-tested WITHOUT any Tier-1 input; per-fixture expected outcomes hold; healthy negatives pass, incl. ~235-token valid verdict AND a text-present/output-0 accounting-edge negative.
- [ ] **AC-B3**: dispatch gate fail-open on missing/stale stats (absence never blocks); gate adds ≤5 s pre-dispatch; assessed turns never wait on Jev. **Tier-1 events are recorded but provably unread by control flow** (grep-level assertion + review).
- [ ] **AC-T**: validation manifest checked in at `tests/fixtures/vitest-triage/manifest.json` — each case: id, evidence source path (named session/flow output under `/tmp` mirrored into the fixture), adjudicated label, adjudication note (labels settled by the implementing worker and double-reviewed by the lead; disagreements recorded in the manifest); n≥20 at ≥90% majority-label agreement promotes the classifier to default; **if <20 adjudicated cases exist, it stays non-default** (safe outcome); sample + results recorded in BUILD_NOTES.
- [ ] **AC-S**: spot-check maintained ≥90%; `uncertain_band` and `<0.8` rates reported separately; abstention→escalation conversion count reported; escalation rate vs ~2/36 baseline tracked.
- [ ] **AC-V**: deterministic-trigger repair path; failed repair → tombstone discard (both verdict-check steps tolerate it); discarded tokens AC2-anchored; `bun test` + `tsc` green.
- [ ] **AC-C**: PR #1 contains exactly `origin/develop..main` (lead-reviewed); verifier verdict PASS with named commands; AC1/AC2 report delivered; demo video shows lifecycle headline + cost columns during a live run.

## Fixture Set

`tests/fixtures/turn-health/` — **raw SDK message shapes** (`{info:{tokens}, parts}`) driving `OpencodeHarness.prompt` through the real `extractTokenUsage`/`extractText` via an SDK-boundary double (an `AgentSessionClient` double cannot reach Tier-0). Nine degenerate cases (labels: `retry` ×~7 for 0–4-token/no-text incl. cx-4's out=16 no-text; `generic_retry` for the 885-token unparseable; `generic_retry` for cache-identical replays; `discard_class` for persona prose) + healthy negatives (~235-token valid verdict; text-present/output-0 edge). Expected policy outcome per case recorded in the fixture header.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Judgment creeping into control | Principle 1 absolute (no exceptions); routing pure f(shape, attempt); Tier-1 unread-by-control verified by test + review |
| Provider window dies mid-demo-record | Health gate on deterministic stats; retry in-wave; fallback = record from replayed flow history; Stage 1 ships first so the gate exists regardless |
| Watcher misfire | Step 0 kills, fixes terminal-exit, **verifies stopped** (`pgrep` empty + state files removed) before work proceeds |
| worker-1d overlap | Gate on its final commit; Tier-1 dupe audit |
| Shape-rule false positives at the boundary | ≤8/no-text pinned by the accounting-edge negative; unparseable-text stays generic retry (no lane demotion on malformed-but-healthy) |
| <20 triage labels | Classifier stays non-default (manifest records the shortfall) |
| Tier-2 scope creep | Out of scope |

## ADR

*(finalized after consensus)*

## Changelog

- v1: initial snapshot.
- v2: two-tier battery; threaded override; lead-layer fail-open gate; watcher disarm; async classifyMany; failure-path ACs.
- v3 (round-2 synthesis): **Tier-1 demoted to evidence-only — no control-flow consumer, zero exceptions to Principle 1** (routing = f(shape, attempt) only; repair trigger deterministic; gate reads deterministic stats); Tier-0 guard placement pinned before BOTH prompt() exits; no flag substrate needed (attempt-durable, shape re-derivable); discard tombstone contract specified for both verdict-check steps; `attributedFile` + `recordJevUsage` accounting; fixture format pinned to raw SDK shapes + accounting-edge negative; band label split (`uncertain_band` vs `<0.8`); alternatives strengthened (B′ parallel-gated-closure, C′ minimal — C′ adopted as Stage 1); AC-T manifest with adjudication procedure; AC-C verifier named with commands; push scope guard (lead line-review); watcher-stop verification asserted.
# TypeSafe Refactor Opportunities — fragility/complexity reduction

- Date: 2026-09-26 · Skill: typesafe-ai · Scope: analysis only (worker-1d mid-run in these files; implement post-closure)
- Method: map codebase fragility against "judgment replaces parsing; code owns recall/execution/policy" + specific cookbooks (docs.typesafe.ai/cookbooks).

## Ranked opportunities

### 1. Turn-health gating battery (turns wave-4's provider war into a subsystem) — HIGH value, S–M cost
**Where:** `src/harness/opencode.ts` (degenerate-turn detection), probe/dispatch gating in `scripts/run-demo.ts`.
**Today's fragility:** degenerate reviewer turns (0–4 output tokens, ~32k reasoning, no text) are detected ad-hoc (token-count heuristics) and handled by manual probes + human reading of provider logs; nine flow dispatches died on this in wave 4.
**Cookbook fit:** **Guardrails for LLMs** — TypeSafe supplies the *assessment*, code owns the *decision*: a noul battery per completed turn (`degenerate_output`, `reasoning_without_text`, `truncation_risk`, `provider_flap_signature`) + a policy table (pass / retry-now / fallback-reviewer / defer-dispatch). Plus **Classification using confidence**: one judgment on turn health; confidence ≥0.9 proceed, below → deterministic demotion to the fallback path (alternate reviewer config), no second call.
**Why it's the top pick:** it productizes the exact failure class that blocked AC1/AC2 for a day, using the established Jev seam; thresholds calibratable from the nine labeled failures already in BUILD_NOTES.

### 2. Vitest triage: candidates + Choice instead of path-prefix heuristics — HIGH value, S cost
**Where:** `src/queues/vitest-queue.ts` `createNaiveClassifier`.
**Today's fragility:** "port-caused vs fixture-problem" = any stack frame under a ported root → port-caused; **unknown roots default to port-caused (configurable)** — a silent-misclassification risk on renamed roots/monorepos/symlinks; the code already parses candidate frames (recall exists!).
**Cookbook fit:** **Pre-parsed value extraction** — keep the regex frame-extraction as recall, replace the prefix heuristic with a Choice/Noul over the candidate frames ("which frame is the causal one; is the failure port-caused or fixture-side?"). Selection can't invent a frame that isn't in the list.

### 3. Symbol-type selection: uncertain band + confidence escalation — MED value, S cost
**Where:** `src/typesafe/symbol-types.ts` (spot-check at 91.7%; 5 residual misses = abstentions on Money-typed params).
**Cookbook fit:** **Self-consistency with nouls** (the 0.30–0.70 uncertain band routes to review instead of flipping on noise) + **Classification using confidence** (confidence <0.9 → auto-escalate to the implementer rather than return a shaky selection). Converts abstentions into structured escalations; complements the existing 4-check cascade; parallel-questions batching of per-file symbols remains the known-deferred secondary integration.

### 4. Verdict intake: repair-or-discard battery — MED value, S–M cost
**Where:** `src/harness/runtime.ts` verdict intake + `harness/agents/verdict-schema.ts`.
**Today's fragility:** schema-invalid verdicts → retry/fail; no semantic check between "valid JSON" and "citation-checked" (which only validates quoted evidence).
**Cookbook fit:** **SDE cascade** shape applied to verdicts: cheap noul battery per suspect verdict (`off_target`, `hallucinated_context`, `format_violation`) gates whether the verdict gets a repair re-prompt (pi-dw Tier-2 item) or is discarded — escalation only on flagged items.

### 5. TSC error taxonomy at scale — deferred (plan-consistent)
**Where:** `src/queues/tsc-queue.ts`. Mechanical error-code+file grouping is correct at demo scale (plan already deferred clustering). **Hierarchical classification** is the cookbook answer when volume justifies it (article-scale 16k-error queues).

## Not judgment — keep deterministic (plan principles)

Agreement rule (`src/metrics/agreement.ts`), reconcile() decision table, sole-committer/op-ID commits, envelope provenance + dispatch anchoring, kill sidecar ordering. These are deterministic *by design*; converting them to judgments would break AC2's provenance bar and AC1's replay semantics. Also: dashboard context-threading complexity (`src/dashboard/state.ts`) is a missing-data problem, not a parsing problem — the M2 identity field now flows; prefer data over judgment there.

## Note

The three existing Jev integration points (symbol-types cascade, citation-check, prioritization) prove the seam pattern in this codebase; items 1–4 extend the same seam, they don't introduce a new dependency shape. Console URL (console.typesafe.ai/docs/cookbooks) is auth-gated; all referenced cookbooks read from docs.typesafe.ai.
# Takeaways Synthesis — pi-dynamic-workflows + lightspeed vs refactoring-toolkit

- **Date**: 2026-09-26
- **Sources**: `.omc/research/pi-dw-orchestration.md`, `pi-dw-quality.md`, `pi-dw-dx.md`, `lightspeed-core.md`, `lightspeed-fleet.md` (clones in /tmp: pi-dw-orch|quality|dx, ls-core, ls-fleet)
- **Method**: 5 parallel research agents, disjoint lanes, file:line evidence, ADOPT/ADAPT/REJECT checked against plan principles (dex-as-truth, envelope-as-render, sole committer, vendor-thin seams, all-TypeScript).

## Meta-finding (quote-worthy)

**lightspeed independently converged on our constitution**: pure admit/plan/reduce core, effect intents, commit-before-apply, operation-ID dedup, evidence as pure projection — built in Rust on Temporal, with zero knowledge of our plan. Two other teams (Bun article's setup, lightspeed) arriving at the same shape is external validation of the consensus design. Separately, pi-dw's docs concede "not a promise of power-loss durability" and its fan-out has **no merge story** ("Results are NOT auto-merged") — our sole-committer + integration-branch design is the differentiator, and the dex-as-truth / compiler-not-interpreter boundary is *hardened*, not moved, by both comparisons.

## Tier 1 — do before the Chris demo (all S, prompt/render-level)

1. **Removed-behavior reviewer lens** (pi-dw-quality, code-review.ts angle B): a reviewer pass asking "what did the source do that the port no longer does?" — prompt-only, no plan amendment; the most migration-relevant review capability we lack.
2. **Cost honesty in grid + report** (pi-dw-dx, agent-usage.ts): per-agent tokens with cache/fresh split + USD + `~estimated` flag. We already collect `info.cost` in the opencode seam. Demo-visible.
3. **Lifecycle headline** (pi-dw-dx): one-line run status (`◆ port-project: 5/9 files · round 2 · running`) with the live `running → killed → resumed → completed` flip during the AC1 chaos beat — the demo's money moment.
4. **Git-exec timeouts + worktree cleanup ordering** (pi-dw-dx, worktree.ts:20, 98-148): 30s timeout/maxBuffer on every git exec (hung git currently burns heartbeats); deregister-before-branch-D cleanup, never prune.

## Tier 2 — v1.1 hardening (S–M)

5. Usage-limit auto-resume: quota → durable pause + reset-hint scheduler with persisted attempt counter (pi-dw-orch, workflow-manager.ts:1345-1360).
6. Secrets redaction on envelope-attribute writes + spawn-time credential injection (lightspeed-fleet, redaction.rs): "secrets reach builds, never transcripts; evidence redacted."
7. Steer-at-turn-boundary + 60s cancel watchdog as terminal (lightspeed-core): durable steer beats kill-and-redo for stuck implementers; replaces unbounded abort retries. (M; epoch fencing stays for SIGKILL)
8. Repair re-prompts for schema-invalid structured output (2 restricted-tool shots before fail) — extends our empty-reply retry class (pi-dw-quality).
9. Diff truncation surfacing — never silent; render truncation explicitly in report (pi-dw-quality).
10. Run-config freeze-at-start re-applied on resume (pi-dw-orch, S).
11. run-demo verbs (`--plan`/`--status`) à la dev.sh (lightspeed-fleet, S).
12. Run retention policy for metrics/ evidence growth (pi-dw-dx, run-persistence.ts, S).

## Tier 3 — v2 / recorded, not built

13. Script→dex **compiler** (authoring UX as input; lightspeed's FSM shape = compilable target) — boundary hardened by both evals.
14. Hash-validated human-approval checkpoint step (pi-dw-quality checkpoint + pi-dw-orch hash validation).
15. Three-layer history hygiene: CAS-offload big diffs to git objects, hash+preview inline, missing content = provenance failure (lightspeed-core rehydrate.rs) — the AC2-at-scale story.
16. Dial-home compute registration (envd pattern) — fleet across existing hardware; M-L.
17. Plan-amendment items (deferred): completenessCheck advisory 5th role, PLAUSIBLE verdict class, any third reviewer/judge — all break the 2-record agreement rule or the verdict enum as spec'd.

## REJECTED (each traced to a principle)

- pi-dw interpreter-over-replay-cache (second source of truth); 16×1000 fan-out without a merge story; events.jsonl storage layer; boolean verify; judgePanel consensus; tool-enabled reviewers; tier auto-derivation; TUI duplicate; model-facing control tool; fails-open worktree isolation.
- lightspeed as substrate (Temporal pre-GA Rust SDK, Postgres/MinIO infra, all-TypeScript violation — would void banked Phase 0–5 evidence); Incus provisioning (Linux-only, unauthenticated listeners); v1 rollover/compaction; fork/clone sessions for v1.

## Score

5 ADOPT, ~13 ADAPT, 12+ REJECT across 5 reports. 0 substrate changes. Substrate-neutral validation: both projects are "our constitution, differently industrialized" — patterns flow to us; the engine stays dex.
551-    path). Residual third miss: `Customer#toArray` truncated-candidate label
552-    (`array<string,`) — the known recall-side `@return` comma-truncation,
553-    recorded as a worker-3 follow-up, not a prompt issue.
554-- Suites after the fix: `bun run typecheck` clean; `bun test` 188 pass / 0
555-  fail (20 files).
556-
557----
558-
559:# WAVE-4 — final report (worker-1c; STOPPED per lead hard rule 2026-09-26 ~16:40 UTC)
560-
561-Lead rule in force at stop: cx-4 failing ⇒ stop entirely, no cx-5, no further
562-retries; next strategy (provider swap / probe widening / proceed-with-
563-documented-failure) is decided with this evidence.
564-
565-## What landed (all committed; 196 tests pass, tsc clean at stop)
566-
567-| Commit | Content |
568-|---|---|
569-| `911b300` | checkpoint A: Phase 3/4 evidence record + CreatorPay fixture |
570-| `3a5e2a7` | Jev selection prompt fix — spot-check 86.1% → **91.7%** (v2, n=36, live; target ≥90% PASS) |
571-| `7c7e9ec` | Phase 5 reconciliation: anchor learns live `:start` self-envelopes; prep model steps carry the marker join identity; `render-metrics.ts` driver |
572-| `de4bf4d` | deterministic fault `queue-verify:inject-error:seed` (fix-round kill window; unused — see smoke status) |
573-| `4973fcc` | **v1.1 parallel dispatch** (per-file `port.File` SubFlow children + `Wait.allOf` wave join; serial parent integration; child store seeding; anchor+driver topology; tests) |
574-| `f731250` | harness hard ceiling on one SDK `session.prompt` call (20 min, retryable) — hang-proofing |
575-| `0ecde78`/`30b7b1d`/`7f7519e` | creatorex prep-stub + BUILD_NOTES (infra finding, Phase 4 status, v1.1 design) |
576-
577-## Infra
578-
579-ALL infra was down at wave start (app restart). Recovered exactly per
580-BUILD_NOTES: dex on the EXISTING 7233 DB (history survived), worker
581-(`run-demo.ts worker --flows port --harness auto`), `opencode serve :4096`,
582-dashboard `:4646` (later STATUS_REPO_ROOT=/tmp/pk-p4). Worker log confirmed
583-`Jev: REAL client` on every restart.
584-
585-## Phase 4 — GREEN on the clean path (the wave's solid result)
586-
587-p4-7 (runId `01a0dd01-…`, epoch 6, project `/tmp/pk-p4`, reviewer
588-`Sisyphus - ultraworker`): COMPLETED 10:42:51Z — full pipeline (prep loop →
589-both seed files → keyed commits `84b3fad` + `334ed4c` → integrated output)
590-with QueueVerify tsc 0 / vitest 0 → termination rule → Final. **AC2 on this
591-real run: provenance_ok=true, 0 failures, 73/73 envelopes dispatch-anchored,
592-10 verdict records, 1,107,958 model tokens reconciled**
593-(`/tmp/metrics-p47/report.{md,json}` — first fully-green AC2 render on live
594-data; validates the marker-identity fix, the `:start` self-envelope anchor,
595-and multi-run history merge). Evidence: `dexcli flow history p4-7`,
596-`/tmp/pk-p4`, `/tmp/metrics-p47/`.
597-
598-## The blocker — provider-side degenerate reviewer turns
599-
600-Signature (unchanged all wave): assistant message "completes" with 0–16
601-output tokens, NO text part, ~32k reasoning → verdict-JSON parse fails → dex
602-burns 3 attempts → FLOW_FAILED. See "Infra finding" section above for the
603-full characterization (cache amplification, window behavior, probe-validity
604-note, what worked). Healthy windows exist but last 30–90 min; a full run
605-needs ~75+ min of mostly-healthy provider with ~10–14 review turns.
606-
607-## Per-flow failure narrative (chronological)
608-
609-| Flow | Config | Outcome | Signature / evidence |
610-|---|---|---|---|
611-| p4-7 | plan-agent → **Sisyphus** reviewer, maxRounds 2 | **COMPLETED** | the green run above |
612-| p4-8 | + fault `queue-verify:inject-error:seed` | FAILED 11:27 | prep review-B 3/3 degenerate (out 3/0/3); never reached queue phase. `dexcli flow history p4-8` |
613-| p4-9 | same, after 1-probe health gate | FAILED 12:45 | absorbed 2 degenerates (retry-note successes), died at prep review-A attempt 3 (out 3) |
614-| p4-10 | + 3-probe window gate (autonomous script) | FAILED 14:11 | died at prep review-B: attempts out 3 / 885-unparseable / 1. Gate script log: `/tmp/window-dispatch.log` |
615-| cx-1 | creatorex 5-file PARALLEL run | FAILED in 1s | PpPrep requires source-map rows for every input file; `stub-prep.md` only covers the 2 seed files (config gap → fixed by `0ecde78`) |
616-| cx-2 | + prep-stub | FAILED in 1s | missing `--source-root` (defaulted to php-sample) |
617-| cx-3 | + source-root | FAILED 15:47 | review-B degenerates + a NEW failure mode: opencode held `session.prompt` open ~20+ min past server-side completion (hang; heartbeats kept the attempt alive) → fixed by `f731250` |
618-| cx-4 | + prompt-call timeout | FAILED 16:28 | prep review-A 3/3 degenerate (out 6/4/16), 16:06–16:27. Kill watcher never fired (pre-window). `dexcli flow history cx-4`, `/tmp/watch-ac1-parallel.log` |
619-
620-Kill smokes: **never fired** — every post-p4-7 dispatch died in PREP, before
621-any commit or queue phase. The fix-round kill smoke (bound: 2 attempts) and
622-the parallel AC1 kill are therefore BLOCKED-BY-PROVIDER, not passed.
623-
624-## Parallel wiring status
625-
626-Committed and unit-tested (`tests/port-parallel.test.ts`: wave planning,
627-anchor registration, both flow registrations), typecheck clean — **NOT
628-live-proven** (cx-4 never reached wave dispatch). First live exercise will
629-surface dex SubFlow runtime semantics (getFlowId/getConditionResults/reuse
630-policy) that types cannot prove. Design + deviations: "v1.1" section above.
631-
632-## State hand-off (for the next decision)
633-
634-- Repo: HEAD with all commits above; 196/196 tests, tsc clean. Untracked
635-  `.omc/research/*` + `demo/` + `.playwright-mcp/` are not wave-4 artifacts.
636-- Infra at stop: dex (7233 DB) + worker (Sisyphus reviewer env) + opencode +
637-  dashboard :4646 (STATUS_REPO_ROOT=/tmp/pk-p4) ALL RUNNING; no flows active
638-  (p4-7..10, cx-1..4 all terminal). Watchers/probe loops stopped.
639-- Evidence paths: `/tmp/pk-p4` (p4-7 repo), `/tmp/pk-creatorex` (cx repo),
640-  `/tmp/metrics-p47/`, `/tmp/kill-events-{p3,p4,cx}.jsonl`,
641-  `/tmp/window-dispatch.log`, `/tmp/provider-health.log`,
642-  `/tmp/worker-1c.log`, `/tmp/watch-ac1-parallel.log`, dex flows
643-  p4-7..p4-10, cx-1..cx-4.
644-- Token cost note for the go/no-go: every failed run still burned real
645-  implementer/reviewer input tokens (~60–90k per review attempt, mostly
646-  cache-read); ~15 full/partial runs this wave. Degenerate turns themselves
647-  produce no output tokens — the cost is inputs + wall clock.

exec
/bin/zsh -lc "git status --short && rg -n \"async prompt|prompt\\(|extractTokenUsage|extractText|FailureClassification|classifyMany|createNaiveClassifier|recordJevUsage|runReviewTurn|runAgentTurn|modelOverride|PpWaveDispatch|DispatchStep|VerdictCheckStep|PrepVerdictCheckStep|dropped-findings|uncertain_band|symbol-types|record.*envelope|context\\.attempt|turn-health\" src tests scripts" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
?? .omc/artifacts/
?? .omc/plans/2026-09-26-post-wave5-consensus.md
?? .omc/research/lightspeed-core.md
?? .omc/research/lightspeed-fleet.md
?? .omc/research/pi-dw-dx.md
?? .omc/research/pi-dw-orchestration.md
?? .omc/research/pi-dw-quality.md
?? .omc/research/takeaways-synthesis.md
?? .omc/research/typesafe-refactor-opportunities.md
?? .playwright-mcp/
?? demo/
scripts/probe-flow.ts:228:    const promptResult = await HARNESS.prompt(
scripts/jev-spot-check.ts:23:import { selectSymbolType, type PhpSymbol } from "../src/typesafe/symbol-types.js";
tests/phase0-seams.test.ts:11:import { extractTokenUsage, fenceLabel, tokenTotal } from "../src/harness/opencode.js";
tests/phase0-seams.test.ts:84:  test("extractTokenUsage narrows an opencode AssistantMessage-shaped payload", () => {
tests/phase0-seams.test.ts:85:    const usage = extractTokenUsage({
tests/phase0-seams.test.ts:100:  test("extractTokenUsage returns null (provenance failure path) when tokens are absent", () => {
tests/phase0-seams.test.ts:101:    expect(extractTokenUsage({})).toBeNull();
tests/phase0-seams.test.ts:102:    expect(extractTokenUsage({ tokens: { input: "x" } })).toBeNull();
tests/phase0-seams.test.ts:103:    expect(extractTokenUsage(undefined)).toBeNull();
scripts/run-demo.ts:78:  async prompt(_sessionId: string, text: string) {
scripts/run-demo.ts:671:      const reply = await harness.prompt(session.id, "Reply with exactly: OK");
tests/port-parallel.test.ts:9:  classifyDispatchStepType,
tests/port-parallel.test.ts:47:    for (const stepType of ["PpWaveDispatch", "PpWaveJoin", "PpChildLease", "PpChildRelease"]) {
tests/port-parallel.test.ts:48:      expect(classifyDispatchStepType(stepType)).toBe("flow-step");
tests/port-parallel.test.ts:68:    expect(stepTypeOf(parent.waveDispatch)).toBe("PpWaveDispatch");
src/queues/vitest-queue.ts:43:export interface FailureClassification {
src/queues/vitest-queue.ts:54:  classify(failure: VitestFailureRecord): FailureClassification;
src/queues/vitest-queue.ts:228:export function createNaiveClassifier(
src/queues/vitest-queue.ts:236:    classify(failure: VitestFailureRecord): FailureClassification {
src/queues/vitest-queue.test.ts:8:  createNaiveClassifier,
src/queues/vitest-queue.test.ts:10:  type FailureClassification,
src/queues/vitest-queue.test.ts:98:    const classifier = createNaiveClassifier();
src/queues/vitest-queue.test.ts:109:    const classifier = createNaiveClassifier();
src/queues/vitest-queue.test.ts:137:      createNaiveClassifier().classify(unknownFailure).failureClass,
src/queues/vitest-queue.test.ts:142:      createNaiveClassifier({ unknown: "fixture-problem" }).classify(unknownFailure)
src/queues/vitest-queue.test.ts:150:    const alwaysFixture: FailureClassification = {
src/typesafe/client.ts:3: * System One). Everything downstream (symbol-types, verdict-check, prioritize,
src/harness/runtime.ts:39:import type { PhpSymbol } from "../typesafe/symbol-types.js";
src/harness/runtime.ts:154: * runReviewTurn) runs on this provider/model instead of the harness default,
src/harness/opencode.ts:89:/** How long prompt() polls for a completed assistant reply (0(g) provenance). */
src/harness/opencode.ts:174:  prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult>;
src/harness/opencode.ts:227:  async prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult> {
src/harness/opencode.ts:231:      this.#client.session.prompt({
src/harness/opencode.ts:254:    let usage = extractTokenUsage(data.info);
src/harness/opencode.ts:256:    let textOut = extractText(data.parts);
src/harness/opencode.ts:281:        usage = extractTokenUsage(last.info);
src/harness/opencode.ts:283:        const completed = extractText(last.parts);
src/harness/opencode.ts:394:export function extractTokenUsage(info: unknown): TokenUsage | null {
src/harness/opencode.ts:423:function extractText(parts: unknown): string {
src/typesafe/symbol-types.test.ts:9:} from "./symbol-types.js";
src/metrics/dispatch-anchor.test.ts:7:  classifyDispatchStepType,
src/metrics/dispatch-anchor.test.ts:114:    expect(entries.filter((e) => classifyDispatchStepType(e.stepType) === "non-agent").length).toBe(3);
src/metrics/dispatch-anchor.test.ts:142:  test("classifyDispatchStepType: flow steps, non-agent dex kinds (case-insensitive), unknown", () => {
src/metrics/dispatch-anchor.test.ts:143:    expect(classifyDispatchStepType("PpCommit")).toBe("flow-step");
src/metrics/dispatch-anchor.test.ts:145:      expect(classifyDispatchStepType(kind)).toBe("non-agent");
src/metrics/dispatch-anchor.test.ts:146:      expect(classifyDispatchStepType(kind.toUpperCase())).toBe("non-agent");
src/metrics/dispatch-anchor.test.ts:148:    expect(classifyDispatchStepType("PpEvil")).toBe("unknown");
src/metrics/dispatch-anchor.ts:42:export interface DispatchStepInputEcho {
src/metrics/dispatch-anchor.ts:61:    input?: { stepInput?: DispatchStepInputEcho | null } | null;
src/metrics/dispatch-anchor.ts:62:    movement?: { stepInput?: DispatchStepInputEcho | null } | null;
src/metrics/dispatch-anchor.ts:82:function stepInputOf(event: DispatchHistoryEvent): DispatchStepInputEcho | null {
src/metrics/dispatch-anchor.ts:205:  { stepType: "PpWaveDispatch", stepId: "pp-wave-dispatch", role: "record", kind: "support" },
src/metrics/dispatch-anchor.ts:240:export function classifyDispatchStepType(stepType: string): "flow-step" | "non-agent" | "unknown" {
src/metrics/dispatch-anchor.ts:327:    const kind = classifyDispatchStepType(entry.stepType);

exec
/bin/zsh -lc "sed -n '210,320p' src/harness/opencode.ts; sed -n '130,185p' src/harness/runtime.ts; sed -n '1,90p' src/queues/vitest-queue.ts; sed -n '220,280p' src/queues/vitest-queue.ts; sed -n '480,515p' src/port-project.ts; sed -n '570,615p' src/port-project.ts; sed -n '1010,1080p' src/port-project.ts; sed -n '1600,1650p' src/port-project.ts; sed -n '1840,1885p' src/port-project.ts; rg -n \"record.*usage|recordJevUsage|selectSymbolType|uncertain|confidence|VerdictCheckStep|PrepVerdictCheckStep|ppVerdict\" src" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
    if (session === undefined || typeof session.id !== "string") {
      throw new Error(`opencode session.create returned no session (label=${label})`);
    }
    return { id: session.id, title: session.title ?? label };
  }

  /**
   * Sends one prompt and waits for the assistant reply. Returns extracted
   * token usage; `usage === null` means the server never exposed usage and is
   * a PROVENANCE FAILURE for model-calling steps (never zero).
   *
   * Pre-release reality (observed live): session.prompt may resolve while the
   * model is still working (queued or long-reasoning turns) with a payload
   * that carries no tokens. To keep provenance honest, poll the session's
   * messages until the assistant reply completes (or aborts) instead of
   * returning an immediate null.
   */
  async prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult> {
    const agent = opts?.agent ?? this.defaultAgent;
    const model = opts?.model ?? this.#model;
    const res = await withCallTimeout(
      this.#client.session.prompt({
        path: { id: sessionId },
        body: {
          ...(model !== undefined ? { model } : {}),
          ...(agent !== undefined ? { agent } : {}),
          ...(opts?.tools !== undefined ? { tools: opts.tools } : {}),
          parts: [{ type: "text", text }],
        },
      } as never),
      `session.prompt (session=${sessionId})`,
    );
    const data = unwrap(res) as
      | { info?: unknown; parts?: unknown }
      | undefined;
    if (data === undefined) {
      throw new Error(`opencode prompt returned no message (session=${sessionId})`);
    }
    // ODW finding 1: prompt RESOLVES with info.error on upstream failure —
    // bail immediately instead of burning the poll window on a stuck turn.
    const immediateError = upstreamErrorOf(data.info);
    if (immediateError !== null) {
      throw new OpencodePromptError(`upstream failure: ${immediateError}`, true);
    }
    let usage = extractTokenUsage(data.info);
    let aborted = hasAbortedError(data.info);
    let textOut = extractText(data.parts);

    if (usage === null && !aborted) {
      const deadline = Date.now() + PROMPT_WAIT_MS;
      let polls = 0;
      while (usage === null && !aborted && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5_000));
        polls++;
        let last: { info: unknown; parts: unknown } | undefined;
        try {
          last = await this.latestAssistantMessage(sessionId);
        } catch (err) {
          console.error(`[opencode] poll ${polls} (session=${sessionId}) messages error: ${(err as Error).message}`);
          continue;
        }
        if (polls % 12 === 1) {
          console.error(
            `[opencode] poll ${polls} (session=${sessionId}) last=${last === undefined ? "none" : "assistant-present"} usage=${JSON.stringify(usage)} deadline-in=${Math.round((deadline - Date.now()) / 1000)}s`,
          );
        }
        if (last === undefined) continue;
        const turnError = upstreamErrorOf(last.info);
        if (turnError !== null) {
          throw new OpencodePromptError(`upstream failure: ${turnError}`, true);
        }
        usage = extractTokenUsage(last.info);
        aborted = hasAbortedError(last.info);
        const completed = extractText(last.parts);
        if (completed.length > 0) textOut = completed;
      }
      console.error(
        `[opencode] poll loop exit (session=${sessionId}) usage=${usage === null ? "null" : "present"} aborted=${aborted} waitedMs=${Date.now() - (deadline - PROMPT_WAIT_MS)}`,
      );
      if (usage === null && !aborted) {
        if (textOut.length === 0) {
          // ODW finding 2: empty replies from native-tool turns are their own
          // retryable failure class (distinct from completed-but-unusaged).
          throw new OpencodePromptError("empty reply without usage (native-tool turn)", true);
        }
        // Completed reply, no usage exposed: provenance failure (never zero).
        return { text: textOut, usage: null, aborted: false };
      }
    }
    return { text: textOut, usage, aborted };
  }

  /** Newest assistant message of a session, or undefined when none exists. */
  async latestAssistantMessage(sessionId: string): Promise<{ info: unknown; parts: unknown } | undefined> {
    const res = await this.#client.session.messages({ path: { id: sessionId } } as never);
    const data = unwrap(res) as unknown;
    const arr = Array.isArray(data)
      ? data
      : (data as { messages?: unknown[] } | undefined)?.messages;
    if (!Array.isArray(arr)) return undefined;
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i] as { info?: { role?: unknown }; role?: unknown; parts?: unknown };
      const info = (m.info ?? m) as { role?: unknown };
      if (info.role === "assistant") {
        return { info: m.info ?? m, parts: m.parts };
      }
    }
    return undefined;
  }

  /** Aborts a session. Returns true only when the server accepted without error. */
 * events can carry the full provider-reported cache/reasoning split + USD
 * cost instead of a bare total. Pure field rename; no inference.
 */
export function toEnvelopeUsage(u: {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}): TokenUsage {
  return {
    input_tokens: u.input,
    output_tokens: u.output,
    reasoning_tokens: u.reasoning,
    cache_read_tokens: u.cacheRead,
    cache_write_tokens: u.cacheWrite,
    cost_usd: u.cost,
  };
}

/**
 * Per-turn REVIEWER model override (wave-5 lane swap): when set, every
 * reviewer turn (prep reviews + per-file review-A/B — all through
 * runReviewTurn) runs on this provider/model instead of the harness default,
 * so the reviewer lane can move independently of implementer/fixer (which
 * stay on the default lane). Format: `OPENCODE_REVIEWER_MODEL=<providerID>/<modelID>`
 * e.g. `openai/gpt-6-luna`. Invalid formats are ignored (undefined).
 */
export function reviewerModelOverride(): { providerID: string; modelID: string } | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const v = proc?.env?.OPENCODE_REVIEWER_MODEL?.trim();
  if (v === undefined || v === "") return undefined;
  const slash = v.indexOf("/");
  if (slash <= 0 || slash >= v.length - 1) return undefined;
  return { providerID: v.slice(0, slash), modelID: v.slice(slash + 1) };
}

// ---------------------------------------------------------------------------
// Diff pass-by-value plumbing
// ---------------------------------------------------------------------------

/**
 * Number of wrapper header lines renderDiffForReview puts BEFORE the diff
 * body; reviewer line numbers minus this offset are body lines.
 */
export const DIFF_HEADER_LINES = 5;

/**
 * Renders the diff block delivered to reviewers: a deterministic header plus
 * the raw unified diff. Evidence `start_line`/`end_line` values are 1-based
 * lines WITHIN THIS BLOCK (line 1 = the first header line; the first line of
 * the diff body is line DIFF_HEADER_LINES + 1).
 */
export function renderDiffForReview(input: {
  diffText: string;
/**
 * vitest verification queue — parsing + triage (plan Phase 4).
 *
 * Real vitest runs are toolkit-owned queue steps executed against the
 * integrated checkout (plan §Flow contract step 3). This module ONLY parses
 * failure output and classifies failures. It never executes agents and never
 * runs vitest itself.
 *
 * Triage contract: `classify(failure)` decides whether a failing test is fed
 * back to the port loop (port-caused) or attributed to the demo fixture /
 * test harness (fixture-problem). The interface exists so a smarter
 * classifier (e.g. a TypeSafe noul) can replace the naive code-only default
 * without touching the flow (plan principle 5: vendor-thin seams, naive impls
 * first). The naive default is a pure path heuristic over the parsed stack.
 *
 * Zero runtime deps.
 */

/** One stack frame parsed from a failure's stack trace. */
export interface StackFrame {
  file: string;
  line: number;
  column: number;
}

/** One failing test, parsed from vitest output. */
export interface VitestFailureRecord {
  /** Test file vitest reported the failure under (e.g. "tests/foo.test.ts"). */
  testFile: string;
  /** Full test name, suite segments joined with " > ". Empty if file-level. */
  testName: string;
  /** Error text: message lines (non-frame lines of the block), "\n"-joined. */
  errorMessage: string;
  /** Stack frames in printed order (innermost first, as vitest prints). */
  frames: StackFrame[];
  /** Original block text, kept as evidence. */
  raw: string;
}

/** Triage outcome: does this failure feed the port loop or the fixture? */
export type FailureClass = "port-caused" | "fixture-problem";

export interface FailureClassification {
  failureClass: FailureClass;
  /** Human-readable justification (what frame/root decided the class). */
  reason: string;
}

/**
 * Seam: anything that can triage a failing test. The flow consumes this
 * interface; swap implementations without touching the loop.
 */
export interface FailureClassifier {
  classify(failure: VitestFailureRecord): FailureClassification;
}

/**
 * Durable queue state for one vitest queue run (plain JSON, dex-attribute
 * safe — mirrors TscQueueState).
 */
export interface VitestQueueState {
  kind: "vitest-queue";
  iteration: number;
  total: number;
  failures: VitestFailureRecord[];
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

/**
 * Record starts: vitest's default reporter `FAIL  path > suite > test` lines,
 * plus cross/tick markers that carry a suite separator (guards against the
 * per-file summary bullets like `× applies discount 12ms`, which lack " > "
 * and would duplicate the detailed FAIL block).
 */
const RECORD_START = /^\s*(?:FAIL\s+\S|[✗×]\s+\S.*\s>\s)/;
const SUMMARY_START = /^\s*(?:Test Files\s|Tests\s|Duration\s|Start at\s)/;

const STACK_FRAME_LINE = /(?:^|\s)(?:❯|at)\s+(.+)$/;
const FILE_LINE_COL = /([^\s()'"]+):(\d+):(\d+)/g;

/** Parse raw vitest output (default reporter, ANSI tolerated) into records. */
export function parseVitestOutput(output: string): VitestFailureRecord[] {
  const clean = output.replace(ANSI_ESCAPE, "").replace(/file:\/\//g, "");
  const failures: VitestFailureRecord[] = [];


/**
 * Naive default triage per task spec: a failure whose stack touches a ported
 * output file is port-caused (even if the assertion site is a test file —
 * ported code appearing in the stack means the port loop should look at it);
 * a failure whose stack only contains fixture/test-harness files is a
 * fixture-problem. Walks frames in printed order and checks all roots.
 */
export function createNaiveClassifier(
  options: NaiveClassifierOptions = {},
): FailureClassifier {
  const portedRoots = options.portedRoots ?? DEFAULT_PORTED_ROOTS;
  const fixtureRoots = options.fixtureRoots ?? DEFAULT_FIXTURE_ROOTS;
  const unknownClass = options.unknown ?? "port-caused";

  return {
    classify(failure: VitestFailureRecord): FailureClassification {
      for (const frame of failure.frames) {
        const ported = matchRoot(frame.file, portedRoots);
        if (ported) {
          return {
            failureClass: "port-caused",
            reason: `stack frame in ported output: ${frame.file}:${frame.line}:${frame.column}`,
          };
        }
      }
      for (const frame of failure.frames) {
        const fixture = matchRoot(frame.file, fixtureRoots);
        if (fixture) {
          return {
            failureClass: "fixture-problem",
            reason: `stack limited to fixture/test-harness file: ${frame.file}:${frame.line}:${frame.column}`,
          };
        }
      }
      return {
        failureClass: unknownClass,
        reason: "no stack frame matched known roots; assigned configured unknown class",
      };
    },
  };
}

/**
 * Tolerant root matching: normalized (forward slashes, no "./", no
 * "file://"), a path matches a root when it IS the root, starts with
 * `root/`, or contains `/root/` anywhere (absolute prefixes tolerated).
 */
function matchRoot(path: string, roots: readonly string[]): string | null {
  const normalized = normalizePath(path);
  for (const rawRoot of roots) {
    const root = normalizePath(rawRoot).replace(/\/+$/, "");
    if (
      normalized === root ||
      normalized.startsWith(`${root}/`) ||
      normalized.includes(`/${root}/`)
    ) {
      return root;
    }
  }
  return null;
sed: src/port-project.ts: No such file or directory
sed: src/port-project.ts: No such file or directory
sed: src/port-project.ts: No such file or directory
sed: src/port-project.ts: No such file or directory
sed: src/port-project.ts: No such file or directory
src/harness/runtime.ts:635:      answers[name] = { type: "choice", choice: pick, confidence: 0.9, probabilities };
src/typesafe/symbol-types.ts:246:  choice_confidence: number | null;
src/typesafe/symbol-types.ts:263:export async function selectSymbolType(
src/typesafe/symbol-types.ts:280:      choice_confidence: null,
src/typesafe/symbol-types.ts:334:      choice_confidence: picked.confidence,
src/typesafe/symbol-types.ts:341:          p: picked.confidence,
src/typesafe/symbol-types.ts:393:    choice_confidence: picked.confidence,
src/typesafe/client.test.ts:28:      b: { type: "choice", choice: "x", confidence: 0.8, probabilities: { x: 0.8, y: 0.2 } },
src/typesafe/symbol-types.test.ts:7:  selectSymbolType,
src/typesafe/symbol-types.test.ts:94:describe("selectSymbolType (Choice over candidates + SDE-cascade nouls)", () => {
src/typesafe/symbol-types.test.ts:99:          type_selection: { type: "choice", choice: "number", confidence: 0.93, probabilities: { number: 0.93, NONE: 0.07 } },
src/typesafe/symbol-types.test.ts:110:    const decision = await selectSymbolType(client, wellDocumentedSymbol);
src/typesafe/symbol-types.test.ts:127:        return { type_selection: { type: "choice", choice: "string", confidence: 0.6, probabilities: { string: 0.6 } } };
src/typesafe/symbol-types.test.ts:137:    const decision = await selectSymbolType(client, wellDocumentedSymbol);
src/typesafe/symbol-types.test.ts:151:      type_selection: { type: "choice", choice: "NONE", confidence: 0.55, probabilities: { NONE: 0.55 } },
src/typesafe/symbol-types.test.ts:154:    const decision = await selectSymbolType(client, wellDocumentedSymbol);
src/typesafe/symbol-types.test.ts:168:    const decision = await selectSymbolType(client, {
src/typesafe/symbol-types.test.ts:187:        return { type_selection: { type: "choice", choice: "number", confidence: 0.9, probabilities: { number: 0.9 } } };
src/typesafe/symbol-types.test.ts:197:    const decision = await selectSymbolType(client, wellDocumentedSymbol, { escalationThreshold: 0.9 });
src/typesafe/client.ts:66:  readonly confidence: number;
src/typesafe/client.ts:73:  readonly confidence: number;

exec
/bin/zsh -lc "rg --files src | sort | head -120; rg -n \"runReviewTurn|runAgentTurn|VerdictCheckStep|PrepVerdictCheckStep|dropped.findings|recordJevUsage|recordJev\" src; sed -n '240,420p' src/typesafe/symbol-types.ts; git branch --show-current; rg -n \"turn-health|Tier-0|Attempt|AC-T|classifyMany\" .omc/plans/2026-09-26-post-wave5-consensus.md" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
src/dashboard/queries.ts
src/dashboard/state.test.ts
src/dashboard/state.ts
src/dashboard/static/index.html
src/dashboard/testdata.ts
src/dashboard/types.ts
src/dex/client.ts
src/git/exec.ts
src/git/worktree.ts
src/harness/opencode.ts
src/harness/runtime.ts
src/metrics/agreement.test.ts
src/metrics/agreement.ts
src/metrics/dispatch-anchor.test.ts
src/metrics/dispatch-anchor.ts
src/metrics/fixtures/dex-history-run-a.json
src/metrics/fixtures/dex-history-run-b.json
src/metrics/fixtures/event-stream-run-a.json
src/metrics/fixtures/event-stream-run-b.json
src/metrics/render.test.ts
src/metrics/render.ts
src/metrics/types.ts
src/queues/testdata/tsc-fixtures.ts
src/queues/testdata/tsc-sample-1.txt
src/queues/testdata/tsc-sample-2.txt
src/queues/testdata/tsc-sample-3.txt
src/queues/testkit.ts
src/queues/tsc-queue.test.ts
src/queues/tsc-queue.ts
src/queues/vitest-queue.test.ts
src/queues/vitest-queue.ts
src/typesafe/client.test.ts
src/typesafe/client.ts
src/typesafe/prioritize.test.ts
src/typesafe/prioritize.ts
src/typesafe/symbol-types.test.ts
src/typesafe/symbol-types.ts
src/typesafe/verdict-check.test.ts
src/typesafe/verdict-check.ts
src/harness/runtime.ts:154: * runReviewTurn) runs on this provider/model instead of the harness default,

export interface SymbolTypeDecision {
  file: string;
  symbol: string;
  candidates: TsTypeCandidate[];
  selected: string | "NONE";
  choice_confidence: number | null;
  checks: CheckResult[];
  escalations: EscalationRecord[];
  /** True when escalations is non-empty; the caller decides what to do. */
  flagged: boolean;
}

export interface SymbolTypeOptions {
  escalationThreshold?: number;
  model?: string;
}

/**
 * Full per-symbol flow: recall -> Choice over candidates (+NONE) -> four
 * verification nouls -> decision with escalation records. Two judgments calls
 * (selection, then the parallel cascade); zero calls when recall is empty.
 */
export async function selectSymbolType(
  client: JudgmentClient,
  symbol: PhpSymbol,
  options: SymbolTypeOptions = {},
): Promise<SymbolTypeDecision> {
  const threshold = options.escalationThreshold ?? DEFAULT_ESCALATION_THRESHOLD;
  const recall = recallCandidates(symbol);
  const base = {
    file: symbol.file,
    symbol: symbol.name,
    candidates: recall.candidates,
  };

  if (recall.candidates.length === 0) {
    return {
      ...base,
      selected: "NONE",
      choice_confidence: null,
      checks: [],
      escalations: [
        {
          file: symbol.file,
          symbol: symbol.name,
          check: "recall_empty",
          p: null,
          threshold: null,
          reason: "code recall found no candidate TypeScript types; escalate to the implementer agent",
        },
      ],
      flagged: true,
    };
  }

  const state = {
    symbol: {
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      signature: symbol.signature,
      docblock: symbol.docblock,
      literal_usages: [...symbol.literal_usages],
    },
    candidates: recall.candidates.map((c) => c.type),
  };

  const criteria: ChoiceCriteria = {};
  for (const c of recall.candidates) {
    criteria[c.type] = `candidate recalled from ${c.origin}`;
  }
  criteria.NONE =
    "abstain: EVERY recalled candidate is unsuitable. Do not abstain when a candidate is directly evidenced by the signature or docblock (declared return type, typed parameter such as `Money $other`, @return/@var hint) — in that case the evidenced candidate is the answer";

  const selection = await client.systemOne({
    state,
    questions: {
      type_selection: choice(
        `Which TypeScript type best describes PHP symbol ${symbol.name} (${symbol.kind})? ` +
          `For a method or function this means its RETURN type; for an accessor/getter method it is the mapped property's type; for a property or parameter it is that member's type. ` +
          `When the signature or docblock directly evidences one of the candidates, select that candidate — do NOT pick NONE. ` +
          `Pick NONE only when every candidate is unsuitable for this symbol.`,
        criteria,
      ),
    },
    ...(options.model === undefined ? {} : { model: options.model }),
  });
  const picked: ChoiceResponse<typeof criteria> = selection.answers.type_selection;

  if (picked.choice === "NONE") {
    return {
      ...base,
      selected: "NONE",
      choice_confidence: picked.confidence,
      checks: [],
      escalations: [
        {
          file: symbol.file,
          symbol: symbol.name,
          check: "none_selected",
          p: picked.confidence,
          threshold,
          reason: "the Choice selected the NONE escape; escalate to the implementer agent",
        },
      ],
      flagged: true,
    };
  }

  const selectedType = picked.choice;
  const cascadeState = { ...state, selected: selectedType };
  const cascade = await client.systemOne({
    state: cascadeState,
    questions: {
      type_mismatch: noul(
        `Does TypeScript type "${selectedType}" correctly match the usage of symbol ${symbol.name}? Answer true when the type fits every observed usage (signature, docblock, literals); false when it mismatches.`,
        { true: "the type matches the symbol's usage", false: "the type mismatches the symbol's usage" },
      ),
      hallucinated: noul(
        `Is "${selectedType}" a real, commonly used TypeScript type rather than an invented or nonexistent one?`,
        { true: "the type is real", false: "the type is invented or nonexistent" },
      ),
      unreasonable: noul(
        `Is "${selectedType}" a reasonable type for ${symbol.name} (${symbol.kind}) given this code's context?`,
        { true: "reasonable", false: "unreasonable" },
      ),
      absence_wrong: noul(
        `Given that NONE (abstain) was available as an answer, is choosing "${selectedType}" clearly better than abstaining for symbol ${symbol.name}?`,
        { true: "choosing the type is clearly better than abstaining", false: "abstaining would have been the better answer" },
      ),
    },
    ...(options.model === undefined ? {} : { model: options.model }),
  });

  const checks: CheckResult[] = VERIFICATION_CHECKS.map((check) => {
    const answer = cascade.answers[check];
    return { check, p: answer.noul, flagged: answer.noul < threshold };
  });
  const escalations: EscalationRecord[] = checks
    .filter((c) => c.flagged)
    .map((c) => ({
      file: symbol.file,
      symbol: symbol.name,
      check: c.check,
      p: c.p,
      threshold,
      reason: `verification noul ${c.check} scored ${c.p.toFixed(3)} below threshold ${threshold}`,
    }));

  return {
    ...base,
    selected: selectedType,
    choice_confidence: picked.confidence,
    checks,
    escalations,
    flagged: escalations.length > 0,
  };
}
main
9:After worker-1d concludes, execute one bounded wave: (1) a **two-tier turn-health system** in which provider-degenerate reviewer turns become a first-class **deterministic** failure class (Tier 0) with attempt-aware model demotion, while a Jev assessment tier (**Tier 1) is evidence-only** — recorded, metrics-visible, consumed by NO control-flow decision; (2–3) vitest triage and the symbol-type uncertain band (judgment on content only); (4) verdict repair-or-discard triggered by **deterministic** suspicion checks with full provenance; then closure — push PR #1, verifier pass, final AC1/AC2 report, demo re-record. Tier-1 polish is worker-1d's (verify + skip dupes).
14:1. **Judgment never controls flow — no exceptions.** Retry, fallback, repair, discard, and dispatch decisions are functions of **deterministic signals only** (reply shape class, attempt count, schema validity, recorded outcome facts). Jev outputs are content classifications or recorded evidence; nothing in control flow reads them. The lead-layer dispatch gate reads only deterministic outcome statistics (Tier-0 failure counts) and fails open.
17:4. **One wave, gated start** — begins at worker-1d's final commit; watcher disarm **verified** before all work; commits per item, tests+typecheck green; **Tier-0 + attempt demotion ships first as an independently shippable increment** (demo-protective even if the rest slips).
27:**Option A — Sequential single-worker wave, staged (RECOMMENDED).** Stage 1: Tier-0 + attempt demotion (≈30 min, independently shippable). Stage 2: items 2–4. Stage 3: closure. Real dependencies: Stage-1 → item 4 (repair replies route through Tier-0), Stage-1 → demo scheduling (gate reads Tier-0 stats).
33:**Option C′ — Tier-0 + demotion only (the minimal deterministic fix), defer items 2–4 and Tier 1.**
40:1. **Stage 1 — Tier-0 + attempt demotion (ship first)**:
42:   - **Deterministic attempt demotion**: `modelOverride` threaded as a parameter through `runReviewTurn → runAgentTurn` (pattern of `attempt` at `port-project.ts:593`); policy = f(attempt, shape class) ONLY (e.g., attempt ≥2 with a Tier-0 history on this step → demote from `OPENCODE_REVIEWER_MODEL` default). No durable flag substrate needed: **attempt count is already durable** (dex `context.attempt`), and the shape class is re-derivable per attempt.
43:   - **Tier 1 — evidence-only** (`src/typesafe/turn-health.ts`): Jev nouls on shape-ambiguous turns (parseable-length, extraction-failing) and on discarded verdicts, written as `record`-role envelope events (piggybacked on the turn step's existing envelope write). **No consumer in control flow.** Surfaces in report.md (diagnosis section) and the dashboard feed. Healthy + shape-trivial turns: zero Jev calls.
44:   - **Dispatch health gate (lead layer)**: reads **deterministic** stats only — consecutive Tier-0 retry events from the envelope stream — with a 5 s timeout, fail-open on missing/stale. Never inside `PpWaveDispatch`/`DispatchStep`.
45:2. **Stage 2a — Vitest triage**: extend `FailureClassification` with `attributedFile` (`vitest-queue.ts:43-47`); add async `classifyMany` at queue-build time and **wire the fix-round feed as its consumer** (today `classify` has none — `port-project.ts:1862-1866` parses/counts only); Jev usage accounted via the `recordJevUsage` pattern (`:498-502`); naive stays default until AC-T.
47:4. **Stage 2c — Verdict repair-or-discard (deterministic trigger)**: post-schema suspicion = **deterministic checks only** (e.g., findings citing spans outside the diff skeleton, severity/structure anomalies); Tier-1 diagnosis of discarded verdicts is recorded evidence, never a trigger. One repair re-prompt (reply routed through Tier-0) → still-invalid → **discard tombstone**: `ppVerdict` discard variant tolerated by `VerdictCheckStep` (`:1029-1034`) and `PrepVerdictCheckStep` (`:1629-1632`); discarded reviewer contributes zero kept findings (the existing dropped-findings semantics at `:1060-1067`), round proceeds; reviewer+attempt+reason on the tombstone; discarded tokens stay AC2-anchored; `agreement.ts` untouched.
48:5. **Stage 3 — Closure (lead)**: push scope = commits on `main` since `origin/develop`'s tip (`git log origin/develop..main`), reviewed line-by-line by the lead before push (single-project repo; no unrelated work exists, but the review is the guard); PR body rewrite; **verifier procedure (named)**: the same verifier-subagent pass used in team-verify — re-run `bun test`, `bun run typecheck`, `bun test tests/turn-health.test.ts` (fixture replay), check each AC below against named evidence paths, output verdict block; final AC1/AC2 report inputs = `/tmp/metrics-*` + BUILD_NOTES sections; demo re-record through the health gate; Chris package.
52:- [ ] **AC-B1**: each named degenerate fixture → Tier-0 retryable error, retried via dex attempts, ≥1 demoted by attempt policy; ZERO Jev calls on shape-trivial fixtures. **AC-B2**: routing = pure f(shape class, attempt) — unit-tested WITHOUT any Tier-1 input; per-fixture expected outcomes hold; healthy negatives pass, incl. ~235-token valid verdict AND a text-present/output-0 accounting-edge negative.
54:- [ ] **AC-T**: validation manifest checked in at `tests/fixtures/vitest-triage/manifest.json` — each case: id, evidence source path (named session/flow output under `/tmp` mirrored into the fixture), adjudicated label, adjudication note (labels settled by the implementing worker and double-reviewed by the lead; disagreements recorded in the manifest); n≥20 at ≥90% majority-label agreement promotes the classifier to default; **if <20 adjudicated cases exist, it stays non-default** (safe outcome); sample + results recorded in BUILD_NOTES.
61:`tests/fixtures/turn-health/` — **raw SDK message shapes** (`{info:{tokens}, parts}`) driving `OpencodeHarness.prompt` through the real `extractTokenUsage`/`extractText` via an SDK-boundary double (an `AgentSessionClient` double cannot reach Tier-0). Nine degenerate cases (labels: `retry` ×~7 for 0–4-token/no-text incl. cx-4's out=16 no-text; `generic_retry` for the 885-token unparseable; `generic_retry` for cache-identical replays; `discard_class` for persona prose) + healthy negatives (~235-token valid verdict; text-present/output-0 edge). Expected policy outcome per case recorded in the fixture header.
82:- v2: two-tier battery; threaded override; lead-layer fail-open gate; watcher disarm; async classifyMany; failure-path ACs.
83:- v3 (round-2 synthesis): **Tier-1 demoted to evidence-only — no control-flow consumer, zero exceptions to Principle 1** (routing = f(shape, attempt) only; repair trigger deterministic; gate reads deterministic stats); Tier-0 guard placement pinned before BOTH prompt() exits; no flag substrate needed (attempt-durable, shape re-derivable); discard tombstone contract specified for both verdict-check steps; `attributedFile` + `recordJevUsage` accounting; fixture format pinned to raw SDK shapes + accounting-edge negative; band label split (`uncertain_band` vs `<0.8`); alternatives strengthened (B′ parallel-gated-closure, C′ minimal — C′ adopted as Stage 1); AC-T manifest with adjudication procedure; AC-C verifier named with commands; push scope guard (lead line-review); watcher-stop verification asserted.

exec
/bin/zsh -lc "rg -n \"runReview|runAgent|VerdictCheck|PrepVerdict|droppedFindings|dropped.findings|recordJevUsage|function .*Verdict|const .*Verdict\" --glob '*.ts' .; nl -ba src/harness/opencode.ts | sed -n '220,315p'; nl -ba src/queues/vitest-queue.ts | sed -n '38,60p'; nl -ba src/typesafe/symbol-types.ts | sed -n '240,410p'" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
./src/harness/runtime.ts:154: * runReviewTurn) runs on this provider/model instead of the harness default,
./src/harness/runtime.ts:384:export function mapVerdictToMetrics(input: {
./src/harness/runtime.ts:401:  const result = validateVerdictRecord(forced);
./src/typesafe/verdict-check.test.ts:44:function verdictWith(findings: Finding[]): VerdictRecord {
./src/typesafe/verdict-check.ts:50:export function naiveCitationCheck(verdict: VerdictRecord, diff: DiffDocument): CitationCheckResult[] {
./src/typesafe/verdict-check.ts:72:  const evidenceByFinding = new Map<string, NonNullable<VerdictRecord["findings"][number]["evidence"]>>();
./src/metrics/dispatch-anchor.ts:172:  { stepType: "PpPrepVerdictCheck", stepId: "pp-prep-verdict-check", role: "verdict-check", kind: "support" },
./src/metrics/dispatch-anchor.ts:188:  { stepType: "PpVerdictCheck", stepId: "pp-verdict-check", role: "verdict-check", kind: "support" },
./src/metrics/render.ts:272:  const verdictsByGroup = new Map<string, VerdictRecord[]>();
./src/metrics/agreement.ts:80:  const records: VerdictRecord[] = [];
./src/metrics/agreement.ts:153:export function agreementByFileRound(records: readonly VerdictRecord[]): AgreementRecord[] {
./src/metrics/agreement.ts:154:  const groups = new Map<string, VerdictRecord[]>();
./scripts/render-metrics.ts:146:function collectVerdicts(attrs: StateAttribute[]): VerdictRecord[] {
./scripts/render-metrics.ts:147:  const out: VerdictRecord[] = [];
./scripts/render-metrics.ts:150:    const tuple = a.value as { metrics?: VerdictRecord } | null;
./scripts/render-metrics.ts:248:  const verdicts: VerdictRecord[] = [];
./tests/phase2-flow.test.ts:146:    const mapped = mapVerdictToMetrics({
./tests/phase2-flow.test.ts:174:    const mapped = mapVerdictToMetrics({
./flows/port-project.ts:303:export const ppVerdict = new AttributeMap<ReviewTuple>("pp-verdict", jsonCodec<ReviewTuple>());
./flows/port-project.ts:313:export const ppPrepVerdict = new AttributeMap<ReviewTuple>("pp-prep-verdict", jsonCodec<ReviewTuple>());
./flows/port-project.ts:360:      ppPrepVerdict,
./flows/port-project.ts:498:async function recordJevUsage(ctx: Context, stepId: string, tokens: number): Promise<void> {
./flows/port-project.ts:545:async function runAgentTurn(input: {
./flows/port-project.ts:586:async function runReviewTurn(input: {
./flows/port-project.ts:625:  const result = await runAgentTurn({
./flows/port-project.ts:636:  const mapped = mapVerdictToMetrics({
./flows/port-project.ts:914:    const result = await runAgentTurn({
./flows/port-project.ts:971:    const { tuple, tokens } = await runReviewTurn({
./flows/port-project.ts:1003:    const { tuple, tokens } = await runReviewTurn({
./flows/port-project.ts:1015:  route: (_ctx, _input, fri) => goTo(VerdictCheckStep, fri),
./flows/port-project.ts:1018:const VerdictCheckStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput & { keptCount: number }>({
./flows/port-project.ts:1019:  stepType: "PpVerdictCheck",
./flows/port-project.ts:1031:      const tuple = ppVerdict.get(ctx, key);
./flows/port-project.ts:1052:        if (jt > 0) await recordJevUsage(ctx, `pp-verdict-check:${fri.file}#${fri.round}`, jt);
./flows/port-project.ts:1112:      if (jt > 0) await recordJevUsage(ctx, `pp-prioritize:${fri.file}#${fri.round}`, jt);
./flows/port-project.ts:1177:    const result = await runAgentTurn({
./flows/port-project.ts:1460:    const result = await runAgentTurn({ def: IMPLEMENTER, sessionId: await prepSessionId(input.epoch), turn, file: PREP_SPEC_FILE, round: 0 });
./flows/port-project.ts:1565:    const { tuple, tokens } = await runReviewTurn({
./flows/port-project.ts:1574:    ppPrepVerdict.set(ctx, verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, "reviewer-A"), tuple);
./flows/port-project.ts:1600:    const { tuple, tokens } = await runReviewTurn({
./flows/port-project.ts:1609:    ppPrepVerdict.set(ctx, verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, "reviewer-B"), tuple);
./flows/port-project.ts:1612:  route: (_ctx, _input, input) => goTo(PrepVerdictCheckStep, input),
./flows/port-project.ts:1615:const PrepVerdictCheckStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
./flows/port-project.ts:1616:  stepType: "PpPrepVerdictCheck",
./flows/port-project.ts:1619:  stepOptions: { executeLoadAttributeMaps: [ppPrepVerdict, ppPrepDiff, ppPrepState, ppConfig] },
./flows/port-project.ts:1631:      const tuple = ppPrepVerdict.get(ctx, key);
./flows/port-project.ts:1727:    const result = await runAgentTurn({
./flows/port-project.ts:2013:    const result = await runAgentTurn({
./flows/port-project.ts:2389:    const result = await runAgentTurn({
./flows/port-project.ts:2455:  readonly verdictCheck = new VerdictCheckStep();
./flows/port-project.ts:2510:  readonly prepVerdictCheck = new PrepVerdictCheckStep();
./flows/port-project.ts:2525:  readonly verdictCheck = new VerdictCheckStep();
./flows/port-project.ts:2554:      this.prepVerdictCheck,
./harness/agents/verdict-schema.ts:96:export function validateVerdictRecord(value: unknown): ValidationResult<VerdictRecord> {
./harness/agents/verdict-schema.ts:246:export function isCompletedVerdictRecord(value: unknown): value is VerdictRecord {
./harness/agents/verdict-schema.test.ts:56:    const result = validateVerdictRecord(validRecord());
./harness/agents/verdict-schema.test.ts:68:    const result = validateVerdictRecord(clean);
./harness/agents/verdict-schema.test.ts:80:    const result = validateVerdictRecord(missing);
./harness/agents/verdict-schema.test.ts:92:    const result = validateVerdictRecord(bad);
   220	   *
   221	   * Pre-release reality (observed live): session.prompt may resolve while the
   222	   * model is still working (queued or long-reasoning turns) with a payload
   223	   * that carries no tokens. To keep provenance honest, poll the session's
   224	   * messages until the assistant reply completes (or aborts) instead of
   225	   * returning an immediate null.
   226	   */
   227	  async prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult> {
   228	    const agent = opts?.agent ?? this.defaultAgent;
   229	    const model = opts?.model ?? this.#model;
   230	    const res = await withCallTimeout(
   231	      this.#client.session.prompt({
   232	        path: { id: sessionId },
   233	        body: {
   234	          ...(model !== undefined ? { model } : {}),
   235	          ...(agent !== undefined ? { agent } : {}),
   236	          ...(opts?.tools !== undefined ? { tools: opts.tools } : {}),
   237	          parts: [{ type: "text", text }],
   238	        },
   239	      } as never),
   240	      `session.prompt (session=${sessionId})`,
   241	    );
   242	    const data = unwrap(res) as
   243	      | { info?: unknown; parts?: unknown }
   244	      | undefined;
   245	    if (data === undefined) {
   246	      throw new Error(`opencode prompt returned no message (session=${sessionId})`);
   247	    }
   248	    // ODW finding 1: prompt RESOLVES with info.error on upstream failure —
   249	    // bail immediately instead of burning the poll window on a stuck turn.
   250	    const immediateError = upstreamErrorOf(data.info);
   251	    if (immediateError !== null) {
   252	      throw new OpencodePromptError(`upstream failure: ${immediateError}`, true);
   253	    }
   254	    let usage = extractTokenUsage(data.info);
   255	    let aborted = hasAbortedError(data.info);
   256	    let textOut = extractText(data.parts);
   257	
   258	    if (usage === null && !aborted) {
   259	      const deadline = Date.now() + PROMPT_WAIT_MS;
   260	      let polls = 0;
   261	      while (usage === null && !aborted && Date.now() < deadline) {
   262	        await new Promise((r) => setTimeout(r, 5_000));
   263	        polls++;
   264	        let last: { info: unknown; parts: unknown } | undefined;
   265	        try {
   266	          last = await this.latestAssistantMessage(sessionId);
   267	        } catch (err) {
   268	          console.error(`[opencode] poll ${polls} (session=${sessionId}) messages error: ${(err as Error).message}`);
   269	          continue;
   270	        }
   271	        if (polls % 12 === 1) {
   272	          console.error(
   273	            `[opencode] poll ${polls} (session=${sessionId}) last=${last === undefined ? "none" : "assistant-present"} usage=${JSON.stringify(usage)} deadline-in=${Math.round((deadline - Date.now()) / 1000)}s`,
   274	          );
   275	        }
   276	        if (last === undefined) continue;
   277	        const turnError = upstreamErrorOf(last.info);
   278	        if (turnError !== null) {
   279	          throw new OpencodePromptError(`upstream failure: ${turnError}`, true);
   280	        }
   281	        usage = extractTokenUsage(last.info);
   282	        aborted = hasAbortedError(last.info);
   283	        const completed = extractText(last.parts);
   284	        if (completed.length > 0) textOut = completed;
   285	      }
   286	      console.error(
   287	        `[opencode] poll loop exit (session=${sessionId}) usage=${usage === null ? "null" : "present"} aborted=${aborted} waitedMs=${Date.now() - (deadline - PROMPT_WAIT_MS)}`,
   288	      );
   289	      if (usage === null && !aborted) {
   290	        if (textOut.length === 0) {
   291	          // ODW finding 2: empty replies from native-tool turns are their own
   292	          // retryable failure class (distinct from completed-but-unusaged).
   293	          throw new OpencodePromptError("empty reply without usage (native-tool turn)", true);
   294	        }
   295	        // Completed reply, no usage exposed: provenance failure (never zero).
   296	        return { text: textOut, usage: null, aborted: false };
   297	      }
   298	    }
   299	    return { text: textOut, usage, aborted };
   300	  }
   301	
   302	  /** Newest assistant message of a session, or undefined when none exists. */
   303	  async latestAssistantMessage(sessionId: string): Promise<{ info: unknown; parts: unknown } | undefined> {
   304	    const res = await this.#client.session.messages({ path: { id: sessionId } } as never);
   305	    const data = unwrap(res) as unknown;
   306	    const arr = Array.isArray(data)
   307	      ? data
   308	      : (data as { messages?: unknown[] } | undefined)?.messages;
   309	    if (!Array.isArray(arr)) return undefined;
   310	    for (let i = arr.length - 1; i >= 0; i--) {
   311	      const m = arr[i] as { info?: { role?: unknown }; role?: unknown; parts?: unknown };
   312	      const info = (m.info ?? m) as { role?: unknown };
   313	      if (info.role === "assistant") {
   314	        return { info: m.info ?? m, parts: m.parts };
   315	      }
    38	}
    39	
    40	/** Triage outcome: does this failure feed the port loop or the fixture? */
    41	export type FailureClass = "port-caused" | "fixture-problem";
    42	
    43	export interface FailureClassification {
    44	  failureClass: FailureClass;
    45	  /** Human-readable justification (what frame/root decided the class). */
    46	  reason: string;
    47	}
    48	
    49	/**
    50	 * Seam: anything that can triage a failing test. The flow consumes this
    51	 * interface; swap implementations without touching the loop.
    52	 */
    53	export interface FailureClassifier {
    54	  classify(failure: VitestFailureRecord): FailureClassification;
    55	}
    56	
    57	/**
    58	 * Durable queue state for one vitest queue run (plain JSON, dex-attribute
    59	 * safe — mirrors TscQueueState).
    60	 */
   240	
   241	export interface SymbolTypeDecision {
   242	  file: string;
   243	  symbol: string;
   244	  candidates: TsTypeCandidate[];
   245	  selected: string | "NONE";
   246	  choice_confidence: number | null;
   247	  checks: CheckResult[];
   248	  escalations: EscalationRecord[];
   249	  /** True when escalations is non-empty; the caller decides what to do. */
   250	  flagged: boolean;
   251	}
   252	
   253	export interface SymbolTypeOptions {
   254	  escalationThreshold?: number;
   255	  model?: string;
   256	}
   257	
   258	/**
   259	 * Full per-symbol flow: recall -> Choice over candidates (+NONE) -> four
   260	 * verification nouls -> decision with escalation records. Two judgments calls
   261	 * (selection, then the parallel cascade); zero calls when recall is empty.
   262	 */
   263	export async function selectSymbolType(
   264	  client: JudgmentClient,
   265	  symbol: PhpSymbol,
   266	  options: SymbolTypeOptions = {},
   267	): Promise<SymbolTypeDecision> {
   268	  const threshold = options.escalationThreshold ?? DEFAULT_ESCALATION_THRESHOLD;
   269	  const recall = recallCandidates(symbol);
   270	  const base = {
   271	    file: symbol.file,
   272	    symbol: symbol.name,
   273	    candidates: recall.candidates,
   274	  };
   275	
   276	  if (recall.candidates.length === 0) {
   277	    return {
   278	      ...base,
   279	      selected: "NONE",
   280	      choice_confidence: null,
   281	      checks: [],
   282	      escalations: [
   283	        {
   284	          file: symbol.file,
   285	          symbol: symbol.name,
   286	          check: "recall_empty",
   287	          p: null,
   288	          threshold: null,
   289	          reason: "code recall found no candidate TypeScript types; escalate to the implementer agent",
   290	        },
   291	      ],
   292	      flagged: true,
   293	    };
   294	  }
   295	
   296	  const state = {
   297	    symbol: {
   298	      name: symbol.name,
   299	      kind: symbol.kind,
   300	      file: symbol.file,
   301	      signature: symbol.signature,
   302	      docblock: symbol.docblock,
   303	      literal_usages: [...symbol.literal_usages],
   304	    },
   305	    candidates: recall.candidates.map((c) => c.type),
   306	  };
   307	
   308	  const criteria: ChoiceCriteria = {};
   309	  for (const c of recall.candidates) {
   310	    criteria[c.type] = `candidate recalled from ${c.origin}`;
   311	  }
   312	  criteria.NONE =
   313	    "abstain: EVERY recalled candidate is unsuitable. Do not abstain when a candidate is directly evidenced by the signature or docblock (declared return type, typed parameter such as `Money $other`, @return/@var hint) — in that case the evidenced candidate is the answer";
   314	
   315	  const selection = await client.systemOne({
   316	    state,
   317	    questions: {
   318	      type_selection: choice(
   319	        `Which TypeScript type best describes PHP symbol ${symbol.name} (${symbol.kind})? ` +
   320	          `For a method or function this means its RETURN type; for an accessor/getter method it is the mapped property's type; for a property or parameter it is that member's type. ` +
   321	          `When the signature or docblock directly evidences one of the candidates, select that candidate — do NOT pick NONE. ` +
   322	          `Pick NONE only when every candidate is unsuitable for this symbol.`,
   323	        criteria,
   324	      ),
   325	    },
   326	    ...(options.model === undefined ? {} : { model: options.model }),
   327	  });
   328	  const picked: ChoiceResponse<typeof criteria> = selection.answers.type_selection;
   329	
   330	  if (picked.choice === "NONE") {
   331	    return {
   332	      ...base,
   333	      selected: "NONE",
   334	      choice_confidence: picked.confidence,
   335	      checks: [],
   336	      escalations: [
   337	        {
   338	          file: symbol.file,
   339	          symbol: symbol.name,
   340	          check: "none_selected",
   341	          p: picked.confidence,
   342	          threshold,
   343	          reason: "the Choice selected the NONE escape; escalate to the implementer agent",
   344	        },
   345	      ],
   346	      flagged: true,
   347	    };
   348	  }
   349	
   350	  const selectedType = picked.choice;
   351	  const cascadeState = { ...state, selected: selectedType };
   352	  const cascade = await client.systemOne({
   353	    state: cascadeState,
   354	    questions: {
   355	      type_mismatch: noul(
   356	        `Does TypeScript type "${selectedType}" correctly match the usage of symbol ${symbol.name}? Answer true when the type fits every observed usage (signature, docblock, literals); false when it mismatches.`,
   357	        { true: "the type matches the symbol's usage", false: "the type mismatches the symbol's usage" },
   358	      ),
   359	      hallucinated: noul(
   360	        `Is "${selectedType}" a real, commonly used TypeScript type rather than an invented or nonexistent one?`,
   361	        { true: "the type is real", false: "the type is invented or nonexistent" },
   362	      ),
   363	      unreasonable: noul(
   364	        `Is "${selectedType}" a reasonable type for ${symbol.name} (${symbol.kind}) given this code's context?`,
   365	        { true: "reasonable", false: "unreasonable" },
   366	      ),
   367	      absence_wrong: noul(
   368	        `Given that NONE (abstain) was available as an answer, is choosing "${selectedType}" clearly better than abstaining for symbol ${symbol.name}?`,
   369	        { true: "choosing the type is clearly better than abstaining", false: "abstaining would have been the better answer" },
   370	      ),
   371	    },
   372	    ...(options.model === undefined ? {} : { model: options.model }),
   373	  });
   374	
   375	  const checks: CheckResult[] = VERIFICATION_CHECKS.map((check) => {
   376	    const answer = cascade.answers[check];
   377	    return { check, p: answer.noul, flagged: answer.noul < threshold };
   378	  });
   379	  const escalations: EscalationRecord[] = checks
   380	    .filter((c) => c.flagged)
   381	    .map((c) => ({
   382	      file: symbol.file,
   383	      symbol: symbol.name,
   384	      check: c.check,
   385	      p: c.p,
   386	      threshold,
   387	      reason: `verification noul ${c.check} scored ${c.p.toFixed(3)} below threshold ${threshold}`,
   388	    }));
   389	
   390	  return {
   391	    ...base,
   392	    selected: selectedType,
   393	    choice_confidence: picked.confidence,
   394	    checks,
   395	    escalations,
   396	    flagged: escalations.length > 0,
   397	  };
   398	}

exec
/bin/zsh -lc "nl -ba flows/port-project.ts | sed -n '280,325p;490,660p;1018,1080p;1615,1675p;1848,1880p'; nl -ba scripts/run-demo.ts | sed -n '620,700p'; rg -n \"watch-kill|watcher|AC1|AC2|report.md|dashboard\" scripts src flows tests" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
   280	}
   281	
   282	/** Terminal flow output (gracefulComplete payload). */
   283	export interface PortRunResult {
   284	  completed: PortQueueState["done"];
   285	  blocked: PortQueueState["blocked"];
   286	  verification: {
   287	    iteration: number;
   288	    tscTotal: number;
   289	    vitestTotal: number;
   290	    vitestNote: string | null;
   291	  } | null;
   292	}
   293	
   294	// ---------------------------------------------------------------------------
   295	// Durable attributes (pp-* — unique within this flow)
   296	// ---------------------------------------------------------------------------
   297	
   298	export const ppConfig = new AttributeMap<PortRunConfig>("pp-config", jsonCodec<PortRunConfig>());
   299	export const ppQueue = new AttributeMap<PortQueueState>("pp-queue", jsonCodec<PortQueueState>());
   300	export const ppPrep = new AttributeMap<PrepArtifact>("pp-prep", jsonCodec<PrepArtifact>());
   301	export const ppLease = new AttributeMap<Record<string, LeaseRecord>>("pp-lease", jsonCodec<Record<string, LeaseRecord>>());
   302	export const ppDiff = new AttributeMap<CapturedDiff>("pp-diff", jsonCodec<CapturedDiff>());
   303	export const ppVerdict = new AttributeMap<ReviewTuple>("pp-verdict", jsonCodec<ReviewTuple>());
   304	export const ppKept = new AttributeMap<KeptFindings>("pp-kept", jsonCodec<KeptFindings>());
   305	export const ppOut = new AttributeMap<OutPathRef>("pp-out", jsonCodec<OutPathRef>());
   306	export const ppMarker = new AttributeMap<CompletionMarker>("pp-marker", jsonCodec<CompletionMarker>());
   307	
   308	// Phase 3 (prep-analysis) durable attributes.
   309	export const ppPrepSeed = new AttributeMap<PrepSeedState>("pp-prep-seed", jsonCodec<PrepSeedState>());
   310	export const ppSymtab = new AttributeMap<{ rows: SymbolTableRow[] }>("pp-symtab", jsonCodec<{ rows: SymbolTableRow[] }>());
   311	export const ppPrepDraft = new AttributeMap<PrepDraft>("pp-prep-draft", jsonCodec<PrepDraft>());
   312	export const ppPrepDiff = new AttributeMap<PrepDiffArtifact>("pp-prep-diff", jsonCodec<PrepDiffArtifact>());
   313	export const ppPrepVerdict = new AttributeMap<ReviewTuple>("pp-prep-verdict", jsonCodec<ReviewTuple>());
   314	export const ppPrepFindings = new AttributeMap<KeptFindings>("pp-prep-findings", jsonCodec<KeptFindings>());
   315	export const ppPrepState = new AttributeMap<{ prepIteration: number }>("pp-prep-state", jsonCodec<{ prepIteration: number }>());
   316	
   317	// Phase 4 (verification queues) durable attributes.
   318	export const ppVerify = new AttributeMap<QueueVerifyState>("pp-verify", jsonCodec<QueueVerifyState>());
   319	export const ppBurndown = new AttributeMap<QueueBurnDownSample>("queue-burndown", jsonCodec<QueueBurnDownSample>());
   320	
   321	// v1.1 parallel dispatch durable attributes.
   322	export interface WaveEntry {
   323	  file: string;
   324	  errors: ReadonlyArray<QueueVerifyError>;
   325	}
   490	
   491	/** Accumulated LIVE Jev usage (evidence stream; naive path adds nothing). */
   492	export const ppJevUsage = new AttributeMap<Array<{ stepId: string; tokens: number; atUtc: string }>>(
   493	  "pp-jev-usage",
   494	  jsonCodec<Array<{ stepId: string; tokens: number; atUtc: string }>>(),
   495	);
   496	
   497	/** Records one live-Jev usage event (evidence stream entry). */
   498	async function recordJevUsage(ctx: Context, stepId: string, tokens: number): Promise<void> {
   499	  const log = ppJevUsage.get(ctx, "usage") ?? [];
   500	  log.push({ stepId, tokens, atUtc: new Date().toISOString() });
   501	  ppJevUsage.set(ctx, "usage", log);
   502	}
   503	
   504	// Harness injection (worker calls configurePortHarness at startup)
   505	// ---------------------------------------------------------------------------
   506	
   507	let PORT_HARNESS: AgentSessionClient | undefined;
   508	
   509	export function configurePortHarness(harness: AgentSessionClient): void {
   510	  PORT_HARNESS = harness;
   511	}
   512	
   513	function requireHarness(): AgentSessionClient {
   514	  if (PORT_HARNESS === undefined) {
   515	    throw new Error("configurePortHarness() was not called by the worker");
   516	  }
   517	  return PORT_HARNESS;
   518	}
   519	
   520	/** One agent turn: definition prompt + enforced tool policy + turn text. */
   521	function composeAgentTurn(def: AgentDefinition, turn: string): string {
   522	  return [def.prompt, "", toolPolicyBlock(def), "", turn].join("\n\n");
   523	}
   524	
   525	async function gitDiffStaged(worktreePath: string): Promise<string> {
   526	  const { stdout } = await execFileP("git", ["add", "-A"], { cwd: worktreePath });
   527	  void stdout;
   528	  const res = await execFileP("git", ["diff", "--cached"], { cwd: worktreePath });
   529	  return res.stdout;
   530	}
   531	
   532	async function writeOutFile(worktreePath: string, outPath: string, content: string): Promise<void> {
   533	  const target = join(worktreePath, outPath);
   534	  await mkdir(dirname(target), { recursive: true });
   535	  await writeFile(target, content, "utf8");
   536	}
   537	
   538	interface AgentTurnResult {
   539	  text: string;
   540	  tokens: number | null;
   541	  /** Full provider usage split (metrics-shaped); null when usage was absent. */
   542	  usage: TokenUsage | null;
   543	}
   544	
   545	async function runAgentTurn(input: {
   546	  def: AgentDefinition;
   547	  sessionId: string;
   548	  turn: string;
   549	  file: string;
   550	  round: number;
   551	  agent?: string;
   552	  /** Per-turn model override (reviewer lane swap; undefined = default lane). */
   553	  model?: { providerID: string; modelID: string };
   554	}): Promise<AgentTurnResult> {
   555	  const harness = requireHarness();
   556	  // Bridge mode: ALL server-side tools disabled for every agent turn; the
   557	  // toolkit mediates writes into the lease worktree (see toolOverridesAllOff).
   558	  const reply = await harness.prompt(input.sessionId, composeAgentTurn(input.def, input.turn), {
   559	    tools: toolOverridesAllOff(),
   560	    ...(input.agent !== undefined ? { agent: input.agent } : {}),
   561	    ...(input.model !== undefined ? { model: input.model } : {}),
   562	  });
   563	  if (reply.aborted) {
   564	    throw new Error(`agent session aborted (file=${input.file} round=${input.round})`);
   565	  }
   566	  const tokens = reply.usage === null ? null : tokenTotal(reply.usage);
   567	  // Wave-5 cost honesty: prefer the full usage split over the bare total —
   568	  // the envelope contract accepts both; tokenTotalOf normalizes downstream.
   569	  const usage = reply.usage === null ? null : toEnvelopeUsage(reply.usage);
   570	  return { text: reply.text, tokens, usage };
   571	}
   572	
   573	/**
   574	 * Reviewer turn inside a durable step: fresh session → fence persisted with
   575	 * THIS step's decision (0(g)) → prompt with the diff by value → verdict
   576	 * extracted, validated, and mapped onto the metrics shapes. Any failure
   577	 * throws so dex retries the whole turn on a fresh session.
   578	 */
   579	export interface ReviewTurnDiff {
   580	  raw: string;
   581	  doc: DiffDocument;
   582	  diffId: string;
   583	  bodyLineOffset: number;
   584	}
   585	
   586	async function runReviewTurn(input: {
   587	  ctx: Context;
   588	  reviewerId: string;
   589	  file: string;
   590	  round: number;
   591	  epoch: number;
   592	  diff: ReviewTurnDiff;
   593	  /** Dex attempt (1-based). Retries get a cache-busting suffix (live finding:
   594	   *  identical retry prompts replayed IDENTICAL truncated provider turns). */
   595	  attempt?: number;
   596	}): Promise<{ tuple: ReviewTuple; tokens: number | TokenUsage | null }> {
   597	  const harness = requireHarness();
   598	  const label = fenceLabel(input.file, input.round, input.epoch);
   599	  const session = await harness.createSession(label);
   600	  sessionFenceMap.set(input.ctx, label, {
   601	    sessionId: session.id,
   602	    stepId: `pp-review-${input.reviewerId}`,
   603	    epoch: input.epoch,
   604	    label,
   605	    persistedAtUtc: new Date().toISOString(),
   606	  });
   607	
   608	  const diffBlock = renderDiffForReview({
   609	    diffText: input.diff.raw,
   610	    file: input.file,
   611	    round: input.round,
   612	    diffId: input.diff.diffId,
   613	  });
   614	  const turn = composeReviewerTurn({
   615	    reviewerId: input.reviewerId,
   616	    reviewerLabel: REVIEWER.name,
   617	    diffBlock: diffBlock.block,
   618	  });
   619	  const turnText =
   620	    (input.attempt ?? 1) > 1
   621	      ? `${turn}\n\n(retry attempt ${input.attempt}: a previous reply on this step was truncated or unparseable — respond with exactly one JSON object and nothing else)`
   622	      : turn;
   623	  const agent = reviewerAgentOverride();
   624	  const model = reviewerModelOverride();
   625	  const result = await runAgentTurn({
   626	    def: REVIEWER,
   627	    sessionId: session.id,
   628	    turn: turnText,
   629	    file: input.file,
   630	    round: input.round,
   631	    ...(agent !== undefined ? { agent } : {}),
   632	    ...(model !== undefined ? { model } : {}),
   633	  });
   634	
   635	  const parsed = extractJsonObject(result.text);
   636	  const mapped = mapVerdictToMetrics({
   637	    raw: parsed,
   638	    file: input.file,
   639	    reviewer: input.reviewerId,
   640	    round: input.round,
   641	    diffId: input.diff.diffId,
   642	    // Re-parse from the stored raw text: ParsedDiff carries non-JSON helpers
   643	    // (hunk resolution) and cannot live in the durable attribute itself.
   644	    parsedDiff: parseUnifiedDiff(input.diff.raw),
   645	    bodyLineOffset: input.diff.bodyLineOffset,
   646	    naiveCited: (finding) =>
   647	      naiveCitationCheck(
   648	        emptyRecordWith(input.file, input.round, input.reviewerId, input.diff.diffId, finding),
   649	        input.diff.doc,
   650	      ).find((c) => c.finding_id === finding.finding_id)?.p_cited ?? 0,
   651	  });
   652	  if (!mapped.ok) {
   653	    throw new Error(
   654	      `reviewer ${input.reviewerId} verdict failed validation: ${mapped.errors.join("; ")}`,
   655	    );
   656	  }
   657	  return { tuple: { agent: mapped.agentRecord, metrics: mapped.record }, tokens: result.usage ?? result.tokens };
   658	}
   659	
   660	/** Single-finding metrics record scoping for the naive fallback citation. */
  1018	const VerdictCheckStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput & { keptCount: number }>({
  1019	  stepType: "PpVerdictCheck",
  1020	  stepId: "pp-verdict-check",
  1021	  role: "verdict-check",
  1022	  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  1023	  stepOptions: { executeLoadAttributeMaps: [ppVerdict, ppDiff] },
  1024	  inner: async (ctx, fri) => {
  1025	    const diff = ppDiff.get(ctx, diffKeyOf(fri.file, fri.round));
  1026	    if (diff === undefined) throw new Error(`captured diff missing for ${fri.file}#${fri.round}`);
  1027	    const kept: MetricsFinding[] = [];
  1028	    const dropped: KeptFindings["dropped"] = [];
  1029	    for (const reviewerId of ["reviewer-A", "reviewer-B"] as const) {
  1030	      const key = verdictKeyOf(fri.file, fri.round, reviewerId);
  1031	      const tuple = ppVerdict.get(ctx, key);
  1032	      if (tuple === undefined) {
  1033	        throw new Error(`verdict record missing for ${key}`);
  1034	      }
  1035	      // Citation check: LIVE Jev nouls when configured (Phase 3 swap-in,
  1036	      // createCitationChecker seam), else the naive code-only default. A
  1037	      // finding survives iff its cited evidence appears in the reviewed diff
  1038	      // (p_cited === 1) and its disposition asks for a fix.
  1039	      const jevClient = portJevLive() ? PORT_JEV_LIVE : undefined;
  1040	      let citations;
  1041	      if (jevClient !== undefined) {
  1042	        let jt = 0;
  1043	        const counting: JudgmentClient = {
  1044	          kind: jevClient.kind,
  1045	          systemOne: async (request) => {
  1046	            const r = await jevClient.systemOne(request);
  1047	            jt += r.usage.input_tokens + r.usage.output_tokens;
  1048	            return r;
  1049	          },
  1050	        };
  1051	        citations = await createCitationChecker(counting).check(tuple.metrics, diff.doc);
  1052	        if (jt > 0) await recordJevUsage(ctx, `pp-verdict-check:${fri.file}#${fri.round}`, jt);
  1053	      } else {
  1054	        citations = naiveCitationCheck(tuple.metrics, diff.doc);
  1055	      }
  1056	      for (const check of citations) {
  1057	        const agentFinding = tuple.agent.findings.find((f) => f.finding_id === check.finding_id);
  1058	        const metricsFinding = tuple.metrics.findings.find((f) => f.finding_id === check.finding_id);
  1059	        if (agentFinding === undefined || metricsFinding === undefined) continue;
  1060	        if (check.p_cited < 1) {
  1061	          dropped.push({
  1062	            finding_id: check.finding_id,
  1063	            reviewer: reviewerId,
  1064	            reason: `citation check failed (p_cited=${check.p_cited})`,
  1065	          });
  1066	          continue;
  1067	        }
  1068	        if (agentFinding.disposition !== "fix") {
  1069	          dropped.push({
  1070	            finding_id: check.finding_id,
  1071	            reviewer: reviewerId,
  1072	            reason: `disposition "${agentFinding.disposition}"`,
  1073	          });
  1074	          continue;
  1075	        }
  1076	        kept.push(metricsFinding);
  1077	      }
  1078	    }
  1079	    ppKept.set(ctx, keptKeyOf(fri.file, fri.round), { findings: kept, dropped });
  1080	    return {
  1615	const PrepVerdictCheckStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
  1616	  stepType: "PpPrepVerdictCheck",
  1617	  stepId: "pp-prep-verdict-check",
  1618	  role: "verdict-check",
  1619	  stepOptions: { executeLoadAttributeMaps: [ppPrepVerdict, ppPrepDiff, ppPrepState, ppConfig] },
  1620	  inner: async (ctx, input) => {
  1621	    const diff = ppPrepDiff.get(ctx, "diff");
  1622	    const state = ppPrepState.get(ctx, "state");
  1623	    const config = ppConfig.get(ctx, "config");
  1624	    if (diff === undefined || state === undefined || config === undefined) {
  1625	      throw new Error("prep diff/state/config missing");
  1626	    }
  1627	    const kept: MetricsFinding[] = [];
  1628	    const dropped: KeptFindings["dropped"] = [];
  1629	    for (const reviewerId of ["reviewer-A", "reviewer-B"] as const) {
  1630	      const key = verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, reviewerId);
  1631	      const tuple = ppPrepVerdict.get(ctx, key);
  1632	      if (tuple === undefined) throw new Error(`prep verdict missing for ${key}`);
  1633	      for (const check of naiveCitationCheck(tuple.metrics, diff.doc)) {
  1634	        const agentFinding = tuple.agent.findings.find((f) => f.finding_id === check.finding_id);
  1635	        const metricsFinding = tuple.metrics.findings.find((f) => f.finding_id === check.finding_id);
  1636	        if (agentFinding === undefined || metricsFinding === undefined) continue;
  1637	        if (check.p_cited < 1) {
  1638	          dropped.push({
  1639	            finding_id: check.finding_id,
  1640	            reviewer: reviewerId,
  1641	            reason: `citation check failed (p_cited=${check.p_cited})`,
  1642	          });
  1643	          continue;
  1644	        }
  1645	        if (agentFinding.disposition !== "fix") {
  1646	          dropped.push({
  1647	            finding_id: check.finding_id,
  1648	            reviewer: reviewerId,
  1649	            reason: `disposition "${agentFinding.disposition}"`,
  1650	          });
  1651	          continue;
  1652	        }
  1653	        kept.push(metricsFinding);
  1654	      }
  1655	    }
  1656	    ppPrepFindings.set(ctx, "findings", { findings: kept, dropped });
  1657	    // Counter ownership lives in PrepLoopDecision (single place decides a
  1658	    // revision; the increment rides with that decision — no double-count).
  1659	    void state;
  1660	    void config;
  1661	    return { output: input, tokens: null, outcome: kept.length > 0 ? "completed" : "skipped" };
  1662	  },
  1663	  route: (_ctx, _input, input) => goTo(PrepLoopDecisionStep, input),
  1664	});
  1665	
  1666	/**
  1667	 * Prep loopback decision (kept separate so the loopback route is a pure
  1668	 * function of durable state): revise when unaddressed findings remain and
  1669	 * the prep cap allows; otherwise finalize and enter the port loop.
  1670	 */
  1671	const PrepLoopDecisionStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput & { revise: boolean }>({
  1672	  stepType: "PpPrepLoopDecision",
  1673	  stepId: "pp-prep-loop-decision",
  1674	  role: "record",
  1675	  stepOptions: { executeLoadAttributeMaps: [ppPrepFindings, ppPrepState, ppConfig] },
  1848	    const tscState = buildTscQueueState(parseTscOutput(tscOut), iteration);
  1849	
  1850	    // vitest queue: runs only when the integrated checkout carries its own
  1851	    // runner; otherwise the burn-down records an honest unavailable note.
  1852	    let vitestTotal = 0;
  1853	    let vitestNote: string | null = "vitest not installed in the integrated checkout";
  1854	    const vitestBin = join(itg, "node_modules", ".bin", "vitest");
  1855	    if (await pathExists(vitestBin)) {
  1856	      try {
  1857	        const { stdout } = await execFileP(vitestBin, ["run", "--reporter", "default"], {
  1858	          cwd: itg,
  1859	          timeout: 180_000,
  1860	          maxBuffer: 64 * 1024 * 1024,
  1861	        });
  1862	        vitestTotal = buildVitestQueueState(parseVitestOutput(stdout), iteration).total;
  1863	        vitestNote = null;
  1864	      } catch (err) {
  1865	        const e = err as { stdout?: string };
  1866	        vitestTotal = buildVitestQueueState(parseVitestOutput(e.stdout ?? ""), iteration).total;
  1867	        vitestNote = null;
  1868	      }
  1869	    }
  1870	
  1871	    // Burn-down upserts (dashboard renders queue-burndown/*).
  1872	    ppBurndown.set(ctx, `tsc-${iteration}`, {
  1873	      queue: "tsc",
  1874	      iteration,
  1875	      error_count: tscState.total,
  1876	      file: null,
  1877	      recorded_at: recordedAt,
  1878	    });
  1879	    ppBurndown.set(ctx, `vitest-${iteration}`, {
  1880	      queue: "vitest",
   620	        await runtime.client.startFlow(flow, flowId, { ms });
   621	        console.log(`[long-step] started flowId=${flowId} ms=${ms}`);
   622	        if (startOnly) return 0;
   623	        const result = await runtime.client.waitForFlow(flowId);
   624	        console.log(`[long-step] result=${JSON.stringify(result)}`);
   625	        return 0;
   626	      } finally {
   627	        await runtime.close();
   628	      }
   629	    }
   630	    case "wait-flow": {
   631	      const flowId = argValue("--id");
   632	      if (flowId === undefined) throw new Error("wait-flow requires --id");
   633	      const waitMinutes = Number.parseInt(argValue("--wait-minutes", "30") as string, 10);
   634	      const runtime = await openDexClient(probeFlows(), config);
   635	      try {
   636	        const result = await waitForFlowTerminal(runtime, flowId, waitMinutes * 60_000);
   637	        console.log(`[wait-flow] flowId=${flowId} result=${JSON.stringify(result)}`);
   638	        return 0;
   639	      } finally {
   640	        await runtime.close();
   641	      }
   642	    }
   643	    case "round": {
   644	      const dir = argValue("--dir");
   645	      if (dir === undefined) throw new Error("round requires --dir <fixtureRepoDir>");
   646	      if (!(await exists(dir))) await makeFixtureRepo(dir);
   647	      const file = argValue("--file", "src/a.php") as string;
   648	      const round = Number.parseInt(argValue("--round", "1") as string, 10);
   649	      const epoch = Number.parseInt(argValue("--epoch", "1") as string, 10);
   650	      return await startRound(dir, file, round, epoch);
   651	    }
   652	    case "recover": {
   653	      const dir = argValue("--dir");
   654	      if (dir === undefined) throw new Error("recover requires --dir <fixtureRepoDir>");
   655	      const epoch = Number.parseInt(argValue("--epoch", "2") as string, 10);
   656	      return await orderedRecover(dir, epoch);
   657	    }
   658	    case "agent-roundtrip": {
   659	      const baseUrl = process.env.OPENCODE_BASE_URL?.trim() || undefined;
   660	      const harness = await OpencodeHarness.connect(
   661	        baseUrl,
   662	        process.env.OPENCODE_MODEL_PROVIDER && process.env.OPENCODE_MODEL_ID
   663	          ? {
   664	              providerID: process.env.OPENCODE_MODEL_PROVIDER,
   665	              modelID: process.env.OPENCODE_MODEL_ID,
   666	            }
   667	          : undefined,
   668	      );
   669	      const session = await harness.createSession("porting-kit:agent-roundtrip");
   670	      console.log(`[agent-roundtrip] session=${session.id}`);
   671	      const reply = await harness.prompt(session.id, "Reply with exactly: OK");
   672	      console.log(
   673	        `[agent-roundtrip] text=${JSON.stringify(reply.text.slice(0, 120))} usage=${JSON.stringify(reply.usage)}`,
   674	      );
   675	      return reply.usage === null ? 1 : 0;
   676	    }
   677	    case "git-selftest":
   678	      return await gitSelftest();
   679	    case "recover-port":
   680	      return await recoverPort();
   681	    case "demo":
   682	      return await startDemo();
   683	    default:
   684	      console.error("usage: run-demo.ts <worker|hello|long-step|wait-flow|round|recover|recover-port|agent-roundtrip|git-selftest|demo> [flags]");
   685	      return 2;
   686	  }
   687	}
   688	
   689	main()
   690	  .then((code) => process.exit(code))
   691	  .catch((err: unknown) => {
   692	    console.error("[run-demo] fatal:", err);
   693	    process.exit(1);
   694	  });
scripts/render-metrics.ts:2: * render-metrics — AC2 evidence driver (Phase 7): collects one flow's durable
scripts/render-metrics.ts:11: *   `metrics` member is the AC2 VerdictRecord), `queue-burndown/*`;
scripts/render-metrics.ts:19: * adapts wire shapes and writes metrics/report.md + metrics/report.json.
scripts/render-metrics.ts:274:  const mdPath = join(outDir, "report.md");
flows/port-project.ts:230:/** Phase 4: one burn-down sample (dashboard renders queue-burndown/*). */
flows/port-project.ts:1557:  // the model envelope must carry the SAME identity or the AC2 marker join
flows/port-project.ts:1871:    // Burn-down upserts (dashboard renders queue-burndown/*).
flows/port-project.ts:2171:    // Publish child flow ids (metrics/dashboard fan-out surface).
tests/port-parallel.test.ts:46:  test("parallel topology is anchor-registered (AC2 holds on the new shape)", () => {
scripts/run-demo.ts:457:    // Optional live-dashboard hook (worker-5, plan v6.1): launch the read-only
scripts/run-demo.ts:467:      console.log(`[demo] dashboard: http://127.0.0.1:${process.env.PORT ?? "4646"} (pid ${child.pid})`);
tests/phase34.test.ts:6: * - burn-down samples match the dashboard's queue-burndown/* shape,
tests/phase34.test.ts:21:import { burnDownFromUnknown } from "../src/dashboard/state.js";
tests/phase34.test.ts:119:describe("Phase 4: burn-down samples match the dashboard contract", () => {
tests/phase34.test.ts:120:  test("queue-burndown/* values parse via the dashboard's shape check", () => {
flows/steps/envelope.ts:428: * an AC1 evidence hole. The marker's decision lands INDEPENDENTLY, so every
flows/steps/envelope.ts:431: * Markers use attempt 0 and role `record` semantics so Phase 5's AC2
scripts/serve-status.ts:2: * serve-status — live status dashboard server (plan v6.1 user-approved scope).
scripts/serve-status.ts:5: *   GET /           static page (src/dashboard/static/index.html, inline CSS/JS)
scripts/serve-status.ts:39:} from "../src/dashboard/queries.js";
scripts/serve-status.ts:40:import { buildDashboardState } from "../src/dashboard/state.js";
scripts/serve-status.ts:46:} from "../src/dashboard/types.js";
scripts/serve-status.ts:257:const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/dashboard/static");
scripts/serve-status.ts:273:    res.end("dashboard page missing: src/dashboard/static/index.html");
flows/port-parallel.ts:16: *   metrics driver and dashboard can fan out over parent+children. Envelope
src/queues/tsc-queue.ts:193:// across iterations" is an AC2 field; recorded as durable attributes).
src/metrics/render.test.ts:192:  test("markdown carries the AC2 sections and key values", () => {
src/metrics/render.test.ts:347:describe("runProvenanceCrossCheck (combined AC2 entry)", () => {
src/dashboard/state.ts:2: * Pure dashboard aggregation: dex history/state snapshots + git rows + kill
src/dashboard/state.ts:45: * module would pull the dex SDK and couple the dashboard to concurrently
src/metrics/dispatch-anchor.ts:2: * Phase 5 — typed 1:N dispatch anchoring + provenance cross-check (AC2).
src/metrics/dispatch-anchor.ts:14: *   src/dashboard/types.ts DexHistoryWire — the surface proven by exit 0(h)
src/metrics/dispatch-anchor.ts:22: * (same pattern as the dashboard's stageLabel/MODEL_ROLES mirrors). If the
src/metrics/dispatch-anchor.ts:48:/** One durable history event (subset of dashboard DexHistoryEventWire). */
src/metrics/dispatch-anchor.ts:66:/** dexcli history payload (subset of dashboard DexHistoryWire). */
src/metrics/dispatch-anchor.ts:523:// Integration entry (AC2 cross-check)
src/metrics/dispatch-anchor.ts:526:/** Combined AC2 cross-check result: envelope provenance + dispatch anchor. */
src/metrics/dispatch-anchor.ts:539: *   with src/dashboard/types.ts.
src/metrics/render.ts:2: * Pure metrics renderer (plan AC2): renders metrics/report.md + report.json
src/metrics/render.ts:45:/** The fixer step id (mirror of flows/port-project.ts) for AC2 retry counts. */
src/metrics/render.ts:56:   * typed dispatch anchoring runs as part of the AC2 cross-check and its
src/metrics/render.ts:200: * Full AC2 cross-check: the envelope stream reconciles against the attribute
src/dashboard/queries.ts:2: * Read-only query sources for the dashboard.
src/metrics/types.ts:4: * Faithful to the consensus plan's "Metrics event contract (AC2 mechanism)"
src/metrics/types.ts:79: *   are excluded from token totals and token-required checks by the AC2
src/metrics/types.ts:120: * dashboard's normalizeTokens so both surfaces agree on the contract.
src/dashboard/types.ts:6: * against dex 0.13.5 (see BUILD_NOTES.md, exit 0(h)). The dashboard queries dex
src/dashboard/types.ts:240:/** Per-role agent usage aggregate for the dashboard grid (cost honesty). */

codex
VERDICT: REVISE

REASONS:

1. **Major — attempt demotion depends on history the plan does not say how to retain.** Step 1 says to demote after “`attempt ≥2 with a Tier-0 history on this step`,” then says “`No durable flag substrate needed`” because attempt count is durable and shape is re-derivable. Attempt count and the current reply’s shape do not establish that an earlier attempt on this step had a Tier-0 failure. Dex retries can follow other errors too. Without a durable signal or a deterministic history lookup, the specified policy cannot be implemented as written.

2. **Major — the vitest change lacks a defined path from classified failures to the fix-round feed.** Step 2a requires adding `classifyMany` and wiring the fix-round feed to consume it. The current classifier interface exposes only `classify(failure)` ([vitest-queue.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/src/queues/vitest-queue.ts:43)); the flow’s vitest handling parses output and records a count, but does not retain failure records for a consumer ([port-project.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/flows/port-project.ts:1850)). The plan does not specify where the classified records are stored, how the feed retrieves them, or how the Jev usage and attribution fields reach that consumer.

3. **Major — verdict repair and discard are not specified enough to implement or verify.** Step 2c gives examples of deterministic suspicion checks but leaves the actual trigger open: “`e.g., findings citing spans outside the diff skeleton, severity/structure anomalies`.” AC-V requires a deterministic trigger and a tombstone, but does not define the predicate, tombstone schema, or behavior when one reviewer is discarded and the other remains valid. Existing `ppVerdict` and `ppPrepVerdict` attributes store `ReviewTuple` values ([port-project.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/flows/port-project.ts:303)); both verdict-check steps currently error when a tuple is missing ([port-project.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/flows/port-project.ts:1031), [port-project.ts](/Users/siddicky/Projects/zcode/refactoring-toolkit/flows/port-project.ts:1630)). The plan must specify a concrete representation and tests for both paths.

4. **Major — the named verifier does not cover the planned acceptance criteria.** Step 3 names full `bun test`, typecheck, and a turn-health fixture replay, then asks the verifier to check each AC against named evidence paths. AC-T, AC-S, AC-V, the vitest feed wiring, and the dispatch gate need their own concrete checks and evidence. The only named replay test is `tests/turn-health.test.ts`, which does not exist in the current checkout. As written, the verifier cannot perform the stated pass without inventing procedures.

5. **Minor — several plan references omit the repository’s actual path.** The plan cites `opencode.ts` and `port-project.ts` without their directory prefixes. The relevant files are `src/harness/opencode.ts` and `flows/port-project.ts`; these are discoverable, but the implementation references should be corrected to avoid misreading them as `src/port-project.ts`.

6. **Minor — the alternatives are improved but do not fully compare the decision drivers.** Option A gives a serial duration and Option B′ a relative speedup, but the options do not estimate the end-to-end critical path to demo readiness or compare verification and rollback costs. This is a completeness gap, not a blocker by itself.

REQUIRED_CHANGES:

1. Specify how a retry can deterministically establish prior Tier-0 history for the same step. Name the persisted field or history query, its write/read points, and how the demotion policy behaves after non-Tier-0 failures. Add tests showing the policy distinguishes those cases.

2. Specify the vitest data path end to end: where parsed failures and classifications are persisted, which step or function consumes them to build the fix-round feed, how unknown attribution behaves, and how Jev usage is recorded. Add acceptance checks for that consumer and its output.

3. Define the verdict suspicion predicate, the serialized discard tombstone variant, and the exact per-reviewer behavior in both verdict-check steps. State how valid findings from the other reviewer are handled. Add tests for triggered repair, successful repair, failed repair followed by discard, and single-reviewer discard.

4. Expand the verifier procedure with named checks and evidence for each AC, including the dispatch health gate, vitest triage manifest/classifier/feed, symbol uncertain band, and verdict repair/discard provenance. Either specify the turn-health test file to be added before invoking it or name the correct existing test once confirmed.

5. Fix the repository paths in the implementation steps so every referenced file points to its actual location.

IMPROVEMENT_SUGGESTIONS:

1. For AC-T, specify how many cases are needed per class and how disagreements affect the promotion decision; overall majority-label agreement alone can conceal poor performance on a less common class.

2. For AC-S, name the source file or command that produces the spot-check results and define the escalation-rate comparison and acceptable deviation from the ~2/36 baseline.

3. The plan’s Tier-1 evidence is described as both an envelope event and report/dashboard output. Name the concrete render and dashboard fields that will display it, or constrain the acceptance criterion to the evidence surface that will actually be implemented.
hook: Stop
hook: Stop Completed
tokens used
58,610

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
