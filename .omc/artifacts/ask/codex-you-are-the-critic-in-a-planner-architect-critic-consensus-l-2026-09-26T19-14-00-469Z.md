# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-09-26T19:14:00.470Z

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

1. The plan contradicts its deterministic-core principle. Principle 1 says retry, fallback, repair, and discard are decided from “non-judgment signals,” but Step 1 makes fallback routing depend on “Tier-0/1 flags,” Step 4 lets “Tier-1 advisory flags” trigger repair, and AC-B2 tests routing as a function of the “tier-1 flag.” An advisory label still influences control when the route changes based on it. The explicit lead-layer dispatch-gate exception does not cover these in-flow decisions.
2. The alternative analysis is incomplete. Option B is rejected because closure “would miss new items or churn” and demo recording “depends on item 1,” but the plan does not compare a parallel implementation with a gated closure after all items land. Option C also compares closure-only against adding the whole wave, without evaluating narrower alternatives such as deterministic turn-health only. Those comparisons do not establish that Option A best serves the drivers.
3. Some acceptance criteria depend on evidence and procedures that are not sufficiently specified in the plan. AC-T calls for a ≥20-case sample “drawn from cx-5d/p4-7 evidence dirs,” but does not name the directories, define how labels are adjudicated beyond “majority-label match,” or identify a reproducible fixture manifest. AC-C refers to “the established verifier agent procedure” without identifying it. These gaps make independent reproduction and sign-off uncertain.

REQUIRED_CHANGES:

1. Resolve the judgment/control contradiction before implementation. Either make Tier-1 outputs purely recorded evidence that cannot affect retry, fallback, repair, discard, or dispatch decisions, or revise the stated principle and justify each judgment-driven route with explicit policy and failure-path criteria. Update Steps 1 and 4 and AC-B2 to match.
2. Strengthen the alternatives section: compare Option A with at least one concrete parallel implementation plus gated closure, and a narrower-scope option. State their dependencies, tradeoffs, and why the rejected options fail the decision drivers.
3. Make AC-T reproducible by naming the exact evidence paths or checked-in fixture manifest, specifying how labels are settled, and recording the sample and results. Identify the verifier procedure used by AC-C, or spell out its commands and evidence checks in the plan.

IMPROVEMENT_SUGGESTIONS:

1. Clarify the push scope in Step 5 so “every commit on local `main` absent from `origin/develop`” cannot pull unrelated work into PR #1; name the intended base and inclusion boundary.
2. The initial risk table says the watcher “never disarms,” while Step 0 specifies killing it and fixing its terminal branch. State how the plan verifies the watcher is stopped before proceeding.




OpenAI Codex v0.157.0
--------
workdir: /Users/siddicky/Projects/zcode/refactoring-toolkit
model: gpt-6-luna
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: medium
reasoning summaries: none
session id: 01a0df22-8fe8-7613-bfac-c504be87a5ab
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
I’ll inspect the frozen plan and its research/evidence inputs, then check the referenced code and flow behavior for consistency with the deterministic-core rule. I’ll keep the response to your exact verdict format.
exec
/bin/zsh -lc 'rg -n "refactoring-toolkit|post-wave5|typesafe-refactor" /Users/siddicky/.codex/memories/MEMORY.md' in /Users/siddicky/Projects/zcode/refactoring-toolkit
 exited 1 in 0ms:
codex
Before reading the artifacts, the likely failure points are: proposed components or seams that do not exist, Jev judgments accidentally controlling flow, vague gates between parallel evidence work and the plan, acceptance criteria without observable proofs, and alternatives that do not meaningfully challenge Option A. I’ll check each directly against the plan, inputs, and repository.
exec
/bin/zsh -lc "pwd && git status --short && sed -n '1,260p' .omc/plans/2026-09-26-post-wave5-consensus.md && sed -n '1,240p' .omc/research/typesafe-refactor-opportunities.md && sed -n '1,240p' .omc/research/takeaways-synthesis.md && rg -n -C 3 \"WAVE-4|provider-degenerate|degenerate\" BUILD_NOTES.md" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
/Users/siddicky/Projects/zcode/refactoring-toolkit
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
# Consensus Plan: post-wave-5 hardening + closure wave

- **Status**: DRAFT v2 — consensus iteration 2 (Planner synthesis of round-1 Architect + Critic; frozen for re-review)
- **Mode**: RALPLAN-DR short | Architect: glm-5.3 via zai | Critic: codex | Date: 2026-09-26
- **Inputs**: `.omc/research/typesafe-refactor-opportunities.md`, `.omc/research/takeaways-synthesis.md`, BUILD_NOTES §WAVE-4 (nine labeled degenerate failures), worker-1d in-flight assignment; round-1 reviews (independent).

## Requirements Summary

After worker-1d concludes, execute one bounded wave: (1) a **two-tier turn-health system** making provider-degenerate reviewer turns a first-class, deterministic failure class with advisory Jev assessment for ambiguous shapes; (2–4) three judgment-over-parsing refactors (vitest triage, symbol-type uncertain band, verdict repair-or-discard) — all strictly **advisory to deterministic flow**; then closure — push PR #1, final AC1/AC2 report, demo re-record, Chris package. Tier-1 polish is worker-1d's (verify + skip duplicates).

## RALPLAN-DR Summary

### Principles
1. **Judgment at the seams, advice-only on control** — Jev outputs are advisory records (envelope `record` role / escalation records); **in-flow failure handling (retry, fallback, repair, discard) is decided deterministically** from non-judgment signals (shape heuristics, schema validity, attempt counts). The single bounded exception: the lead-layer dispatch gate may READ advisory health records but **fail-opens** on missing/stale/unavailable — absence never blocks.
2. **Deterministic core untouched** — agreement rule, reconcile(), sole-committer, provenance anchoring stay pure code.
3. **Assessment ≠ decision** — probabilities from Jev; policy tables, thresholds, and routing in tested code, calibrated from the nine labeled failures.
4. **One wave, gated start** — begins only at worker-1d's final commit; watcher disarm precedes all work; commits per item, tests+typecheck green.
5. **Evidence-first closure** — PR push and the AC1/AC2 report precede demo polish.

### Decision Drivers (top 3)
1. Make the wave-4 failure class (nine dispatches killed by provider-degenerate turns) a deterministic, tested failure mode.
2. PR #1 is 6+ commits behind local main.
3. Chris-demo readiness on short notice.

### Viable Options

**Option A — Sequential single-worker wave (RECOMMENDED)** — real dependencies: item 1 → 4 (repair re-prompt routes through turn-health), item 1 → 5 (demo scheduling uses the health gate); items 2–3 are independent.
- Pros: zero file-conflict risk; cheapest; honest dependency ordering. Cons: serial wall-clock ~3–5 h.

**Option B — Parallel split** — REJECTED: closure's push would miss new items or churn; demo record depends on item 1 (inverted).

**Option C — Closure only** — REJECTED: leaves degenerate turns exiting the seam as *successful* empty-text results (today's actual behavior — verified `opencode.ts:227-300`); the failure class stays undetected.

## Implementation Steps

0. **Gate**: await worker-1d completion; audit commits; verify Tier-1 landed (skip dupes); **disarm live watchers** — kill `/tmp/watch-kill-cx5.sh` (pid class 72922; started by worker-1d, surfaced to user) and fix its non-exiting terminal branch (`:36-44`) before any re-arm; baseline `bun test` + `tsc`.
1. **Two-tier turn-health system**:
   - **Tier 0 — deterministic, in-seam** (`src/harness/opencode.ts`): degenerate shape = usage present AND (no text part OR output tokens ≤ 8) → `OpencodePromptError(retryable=true)` sibling of the existing empty-reply class (`:293`), reusing the per-attempt cache-bust note (`port-project.ts:619-622`). Zero Jev calls. Catches ~7 of 9 labeled failures shape-trivially.
   - **Tier 1 — Jev, advisory** (`src/typesafe/turn-health.ts` over `JudgmentClient`): fires ONLY on shape-ambiguous turns (parseable-length output that fails extraction, e.g. p4-10's 885-token case; cross-attempt flap signature). Emits an advisory `record`-role envelope event (piggybacked on the turn step's existing envelope write — no separate mini-step). Healthy turns: zero Jev calls.
   - **Fallback routing — deterministic**: the seam threads a per-turn model-override PARAMETER through `runReviewTurn → runAgentTurn` (pattern of `attempt` at `:593`); the deterministic policy (attempt count + Tier-0/1 flags) demotes from the `OPENCODE_REVIEWER_MODEL` operator default. No env mutation mid-flight.
   - **Dispatch health gate — lead-layer only** (never inside `PpWaveDispatch`/`DispatchStep`): the demo/runner script reads advisory records with a **5 s timeout, fail-open** on missing/stale/Jev-unavailable (0(g): staged writes lost on kill ⇒ absence = proceed). Adds ≤5 s pre-dispatch latency, zero in-flow latency.
2. **Vitest triage** (`src/queues/vitest-queue.ts`): add **async `classifyMany`** at queue-build time (existing sync `classify` has no production consumer — `port-project.ts:1850-1867` parses/counts only); **wire the fix-round feed as the consumer in this item**; Jev Choice-over-candidates behind the interface, naive default until validation.
3. **Symbol-type uncertain band** (`src/typesafe/symbol-types.ts`): band [0.30, 0.70] OR choice-confidence <0.9 → structured escalation record (mechanism exists `:230-251`); calibrate 0.9 from `/tmp/jev-spot-check-after.json` raw data; document precedence vs the 0.8 cascade threshold (`:222`); re-run n=36 spot-check.
4. **Verdict repair-or-discard** (`src/harness/runtime.ts`), deterministic-decided: post-schema, a **deterministic suspicion check** (deterministic battery: off-target heuristics + Tier-1 advisory flags when present) → suspect verdicts get ONE repair re-prompt (reply routed through item-1 turn-health) → still-invalid → **discard with full provenance**: reviewer, attempt, reason on the discard envelope event; **discarded verdicts' tokens remain anchored to their dispatch attempts in AC2** (they were real calls); intake-side discard never touches `agreement.ts`.
5. **Closure (lead)**: push scope = every commit on local `main` absent from `origin/develop` (since `4cf8fa1`); PR body rewrite (wave-4/5 narrative, AC2 render, provider finding); **verifier pass = the established verifier agent procedure**: run `bun test`, `bun run typecheck`, replay the named turn-health fixtures, check each AC below against evidence paths, verdict block PASS/FAIL; final AC1/AC2 report inputs = `/tmp/metrics-*` + BUILD_NOTES sections; demo re-record during a live run scheduled through the health gate; Chris package (one-pager + video + report.md).

## Acceptance Criteria

- [ ] **AC-B1 (Tier 0)**: each of the nine named degenerate fixtures (see Fixture Set) → retryable error, ≥1 retried via dex attempts, ZERO Jev calls on shape-trivial cases.
- [ ] **AC-B2 (routing)**: per-fixture expected policy outcome holds (retry / repair / fallback-reviewer / discard) — routing tested as a pure function of (shape, tier-1 flag, attempt); healthy-but-short negative (~235-token valid verdict) routes PASS (false-positive pin).
- [ ] **AC-B3 (failure paths)**: Jev unavailable/stale/missing ⇒ dispatch gate proceeds (fail-open), no crash, absence recorded; assessed turn never waits on the battery; pre-dispatch gate ≤5 s.
- [ ] **AC-T**: classifier validated n≥20 (sampling: hand-labeled failures drawn from cx-5d/p4-7 evidence dirs, labels recorded in the test fixture, agreement = majority-label match; if <20 labeled cases exist, classifier STAYS non-default — safe outcome) at ≥90%.
- [ ] **AC-S**: spot-check maintained ≥90% with the band; abstention→escalation conversion count reported; escalation rate over the ~2/36 baseline tracked (explosion visible).
- [ ] **AC-V**: valid-but-suspicious → repair path; failed repair → discard with reviewer+attempt+reason provenance; discarded tokens anchored in AC2 reconciliation; `bun test` + `tsc` green.
- [ ] **AC-C**: PR #1 contains all in-scope commits; verifier verdict PASS; AC1/AC2 report delivered; demo video shows lifecycle headline + cost columns during a live run.

## Fixture Set (named, in `tests/fixtures/turn-health/`)

Sourced from BUILD_NOTES-indexed session logs (ses_f23c63ab/out1, ses_f23bae4ed/out1, ses_f23b4f390/out2, ses_f23ae9b39/out4, cx-3 session, cx-4 attempt-1) + healthy p4-7 Sisyphus turns. Labels: `retry` (0–4 tok, no text), `repair_or_fallback` (885-token unparseable), `fallback` (cache-identical replays), `discard` (persona prose, e.g. Momus 31-token), `pass` (healthy, incl. ~235-token valid verdict). Nine degenerate + ≥3 healthy negatives.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Judgment creeping into flow control | Principles 1 (advice-only, fail-open) enforced by review; deterministic routing tested as pure functions |
| Provider window dies mid-demo-record | Health-gated scheduling; retry within wave; fallback = record from replayed flow history |
| Armed watcher misfire / never disarms | Step 0 kills + fixes terminal-exit before re-arm (surfaced: worker-1d's process) |
| worker-1d overlap | Gate on its final commit; audit Tier-1 dupes |
| Jev cost/latency | Tier-0 handles clear-cut cases with zero calls; Tier-1 only ambiguous; post-turn piggyback; ~$0.00004/call class |
| <20 triage labels available | Classifier stays non-default (safe outcome) |
| Tier-2 scope creep | Explicitly out of scope |

## ADR

*(finalized after consensus)*

## Changelog

- v1: initial snapshot.
- v2 (round-1 synthesis): two-tier battery (Tier-0 deterministic in-seam; Jev advisory-only for ambiguous shapes) resolving the judgment-on-control-flow contradiction; deterministic fallback routing via threaded per-turn parameter (no env mutation); dispatch gate lead-layer, 5 s fail-open; step 0 disarms the live watcher; honest FailureClassifier contract (async classifyMany + wired consumer); named 9+3 fixture set with labels/expected outcomes; failure-path ACs (Jev-unavailable, repair-failure, discard provenance + AC2 anchoring); calibration sources + escalation-rate metric; concrete closure procedure (push scope, verifier = established procedure, report inputs); dependency honesty (1→4, 1→5 real; 2–3 independent).
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
417-  DELIVERED; determinism re-verified by worker-1c (generator re-run digest
418-  `b692f358…` == FIXTURES.md recorded digest; tree unchanged).
419-
420:## Infra finding (beyond this project): glm-5.3 "default"-variant degenerate turns
421-
422-Recorded 2026-09-26 (worker-1c) — provider-side failure mode hit during Phase 4
423-re-dispatches; valuable for anyone building on opencode + zai-coding-plan:
--
429-  tokens. The turn is "completed" with usage, so the seam's poll loop is
430-  skipped (fast path) and the verdict JSON parse fails downstream.
431-- **Cache amplification**: consecutive retry attempts on the identical prompt
432:  replayed IDENTICAL degenerate turns (reasoning token count 31,996 twice,
433-  then 3 identical failures on the same step) — the provider response-caches
434-  the prefix. Fix `3cab591` appends a per-attempt retry note (cache-bust):
435-  necessary but NOT sufficient — p4-6 prep0/prep1/prep2 review-A retries
436-  succeeded with the note (74–80k-token real verdicts, visible in flow
437:  history as non-degenerate attempt-2 envelopes), yet p4-6 prep2 review-B
438-  still failed 3/3 with distinct prompts.
439-- **Window**: 05:00–08:05 UTC 2026-09-26, ~50% of plan-agent review turns
440:  degenerate (vs 100% healthy 02:30–04:41 on the same agent/model — p3-4 and
441-  p4-1 completed 14 review turns). Not deterministic per prompt; the default
442-  variant was effectively unusable for heavy-reasoning turns during the window.
443-- **What did NOT work**: Momus (`gpt-5.6-terra xhigh`) returns 31-token
--
512-  anchor, and multi-run history merge).
513-- **Fix-round kill smoke: BLOCKED-BY-PROVIDER after the bound.** The queue/
514-  fix-round kill needs a run that survives to the fix round. Three window-
515:  gated dispatches failed PRE-window to the degenerate-turn provider window
516:  (see the infra finding above): p4-8 (10:46, 3/3 degenerate review-B),
517:  p4-9 (11:33, died at prep review-A after 2 absorbed degenerates), p4-10
518-  (13:16, dispatched by the 3-probe window gate; died 14:11 at prep review-B
519-  — attempts produced 3, 885 (unparseable), 1 output tokens). **The chaos
520-  kill never fired; per the max-2-attempts smoke bound this is documented,
--
556-
557----
558-
559:# WAVE-4 — final report (worker-1c; STOPPED per lead hard rule 2026-09-26 ~16:40 UTC)
560-
561-Lead rule in force at stop: cx-4 failing ⇒ stop entirely, no cx-5, no further
562-retries; next strategy (provider swap / probe widening / proceed-with-
--
595-and multi-run history merge). Evidence: `dexcli flow history p4-7`,
596-`/tmp/pk-p4`, `/tmp/metrics-p47/`.
597-
598:## The blocker — provider-side degenerate reviewer turns
599-
600-Signature (unchanged all wave): assistant message "completes" with 0–16
601-output tokens, NO text part, ~32k reasoning → verdict-JSON parse fails → dex
--
609-| Flow | Config | Outcome | Signature / evidence |
610-|---|---|---|---|
611-| p4-7 | plan-agent → **Sisyphus** reviewer, maxRounds 2 | **COMPLETED** | the green run above |
612:| p4-8 | + fault `queue-verify:inject-error:seed` | FAILED 11:27 | prep review-B 3/3 degenerate (out 3/0/3); never reached queue phase. `dexcli flow history p4-8` |
613:| p4-9 | same, after 1-probe health gate | FAILED 12:45 | absorbed 2 degenerates (retry-note successes), died at prep review-A attempt 3 (out 3) |
614-| p4-10 | + 3-probe window gate (autonomous script) | FAILED 14:11 | died at prep review-B: attempts out 3 / 885-unparseable / 1. Gate script log: `/tmp/window-dispatch.log` |
615-| cx-1 | creatorex 5-file PARALLEL run | FAILED in 1s | PpPrep requires source-map rows for every input file; `stub-prep.md` only covers the 2 seed files (config gap → fixed by `0ecde78`) |
616-| cx-2 | + prep-stub | FAILED in 1s | missing `--source-root` (defaulted to php-sample) |
617:| cx-3 | + source-root | FAILED 15:47 | review-B degenerates + a NEW failure mode: opencode held `session.prompt` open ~20+ min past server-side completion (hang; heartbeats kept the attempt alive) → fixed by `f731250` |
618:| cx-4 | + prompt-call timeout | FAILED 16:28 | prep review-A 3/3 degenerate (out 6/4/16), 16:06–16:27. Kill watcher never fired (pre-window). `dexcli flow history cx-4`, `/tmp/watch-ac1-parallel.log` |
619-
620-Kill smokes: **never fired** — every post-p4-7 dispatch died in PREP, before
621-any commit or queue phase. The fix-round kill smoke (bound: 2 attempts) and

exec
/bin/zsh -lc "rg -n \"runReviewTurn|runAgentTurn|OpencodePromptError|classifyMany|createNaiveClassifier|Choice|symbol-types|confidence|cascade|verdict|DispatchStep|PpWaveDispatch|record|envelope|watch-kill|verifier\" src scripts tests .omc/agents .omc 2>/dev/null | head -260 && nl -ba src/harness/opencode.ts | sed -n '210,320p' && nl -ba src/queues/vitest-queue.ts | sed -n '1,250p' && nl -ba src/typesafe/symbol-types.ts | sed -n '200,275p' && nl -ba src/harness/runtime.ts | sed -n '1,240p'" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
scripts/probe-flow.ts:3: * 0(a)-0(e). These flows exercise the REAL seams (envelope factory, git
scripts/probe-flow.ts:30:  envelopeStepClass,
scripts/probe-flow.ts:33:} from "../flows/steps/envelope.js";
scripts/probe-flow.ts:134:const HelloStep = envelopeStepClass<void, { message: string }>({
scripts/probe-flow.ts:137:  role: "record",
scripts/probe-flow.ts:158:const LongSleepStep = envelopeStepClass<{ ms: number }, { sleptMs: number }>({
scripts/probe-flow.ts:161:  role: "record",
scripts/probe-flow.ts:186:const ProbeFenceStep = envelopeStepClass<RoundInput, { sessionId: string }>({
scripts/probe-flow.ts:189:  role: "record",
scripts/probe-flow.ts:208:const ProbeAgentWriteStep = envelopeStepClass<RoundInput, { tokensTotal: number | null }>({
scripts/probe-flow.ts:244:const ProbeCaptureDiffStep = envelopeStepClass<RoundInput, { diffChars: number }>({
scripts/probe-flow.ts:256:const ProbeCommitStep = envelopeStepClass<RoundInput, { opId: string; dedup: boolean; sha: string | null }>({
scripts/probe-flow.ts:308:const ProbeIntegrateStep = envelopeStepClass<RoundInput, { integratedSha: string; fastForward: boolean }>({
tests/phase1-isolation.test.ts:9: *    surface at all — recorded deviation, see BUILD_NOTES).
tests/phase1-isolation.test.ts:97:      "harness/agents/verdict-schema.ts",
tests/phase1-isolation.test.ts:157:    // finds the original, the marker records `committed:<op-id>` with the
.omc/handoffs/team-fix.md:3:- **Decided**: verify-fix loop CLOSED — verifier delta re-verify of 497ff5c: CLOSURE VERIFIED, all 10 items confirmed (F1/F2 lint+assertion tests, C1 regression reproduces geometry then proves fix, M1 outPath assertion, M2 identity keys, M3 durable recover-port, M4 start mini-steps wired to all 4 model steps, M6 integration-based leases + ff re-rounds), fresh runs 150/0 + tsc clean, .omo hygiene confirmed. Two recorded minors: recoverPort pins round 1 (re-touch in Phase 4 when round increments wire); smoke-3 dex history not re-queryable in the verify pass (repo-state corroborated).
.omc/handoffs/team-fix.md:5:  - Phase 3 (worker-1b): real prep-analysis — spec map via implementer agent; per-symbol table via src/typesafe/symbol-types.ts with Jev swap-in (TYPESAFE_API_KEY env; if absent: in-memory double + BLOCKED note for the spot-check); prep-review wiring (artifact-diff, capped loopback); Jev verdict-check/prioritize swap-in behind existing interfaces. Exit: seed-scale kill smoke incl. kill during a Jev call AND a reviewer-turn kill (per BUILD_NOTES); Jev spot-check n≥30 symbols vs human ground truth ≥90% (Phase 3 dev lane owns; BLOCKED if no key).
.omc/handoffs/team-fix.md:7:  - Phase 5 (worker-3): typed 1:N dispatch anchoring (envelope↔dex dispatch log via dexcli history, step-type-filtered) + provenance cross-check integration; metrics render against a real run's attribute log.
.omc/handoffs/team-plan.md:3:- **Decided**: Execute the approved consensus plan v6 (`.omc/plans/2026-09-25-porting-toolkit-consensus.md`) — Option A′ layered build. Sole-committer commit step (agents hold no git); operation-ID (file+round) commit identity with content-hash as evidence; commit-preserving reconcile(); single envelope step-factory; session fencing (persist session ID → abort-confirm → lease reclaim → reconcile → re-dispatch); durable integration step to one `integration` branch that tsc/vitest verify; TypeSafe (Jev) at 3 points behind naive-impl interfaces; all-TypeScript incl. scripts; Phase 0 owns minimal lease/commit/integration/fencing implementations and is retained as production seams + regression kill-tests.
.omc/handoffs/team-plan.md:5:- **Risks**: dex TS SDK + opencode plugin are pre-release — Phase 0's job is to surface reality; workers must report blockers with evidence, never fake durability results. Docker may be unavailable locally (compose fallback: dex binary if distributable; else record blocker). TYPESAFE_API_KEY may be absent (test doubles + blocker note). Environment unknowns: bun/node versions, opencode CLI presence.
.omc/handoffs/team-plan.md:8:- **Worker scope boundaries (conflict avoidance)**: worker-1: repo bootstrap, package.json/tsconfig/.gitignore/docker-compose, `src/dex/`, `src/harness/`, `src/git/`, `scripts/`, git commits. worker-2: `fixtures/`. worker-3: `src/typesafe/`, `src/metrics/`. worker-4: `src/queues/`, `harness/` (agents + skills + verdict schema). Only worker-1 runs git; baseline commit covers only `.gitignore` + `.omc/**`.
.omc/handoffs/team-exec.md:3:- **Decided**: Phase 0 substrate proven (0(a)–0(h) PASS, commit 933a56d); Phase 1 harness + isolation tests green; Phase 2 `flows/port-project.ts` implements the plan's Flow contract (prep→lease→fence→implement→diff-capture→review-A/B→verdict-check→prioritize→fixer→op-ID commit→integration→release); TRIAL GATE GREEN on 2-file seed (commit 162d2eb): reviewer-pair + fixer cycles observed on both files, one mid-run chaos kill (server+worker, intent-before-kill sidecar `/tmp/kill-events-trial.jsonl`), resumed to FLOW_STATUS_COMPLETED, exactly 2 op-ID commits, integration branch carries both ports, no dirty-worktree deadlock. Repo-wide: `bun test` 142/0, `tsc --noEmit` clean.
.omc/handoffs/team-exec.md:4:- **Rejected/Deviated (recorded in BUILD_NOTES §TRIAL GATE)**: reviewers as sequential durable steps instead of `goToMany` parallel (dex 0.12 convergence undocumented); reviewer sessions moved to `plan` agent + completion-polling after max-reasoning default agent (~25–30 min/turn) killed trials 2–4 on token provenance (~45 s/turn after); server-side tool surface disabled entirely for agent turns after a live isolation leak (writers could write via server cwd).
.omc/handoffs/team-exec.md:5:- **Risks for verify**: envelope event keys collide across step re-entries (Phase 5 mapping caveat); burn-down not yet wired (Phase 4); AC2's full provenance run and AC1's Phase 7 demo-run kill are still ahead — this verify covers the build + trial gate, not the final evidence runs.
.omc/handoffs/team-exec.md:7:- **Verify scope**: (1) verifier — AC/criteria audit vs plan §Acceptance Criteria (hygiene gates + trial-gate criteria), independently run bun test + tsc, check BUILD_NOTES §TRIAL GATE claims vs evidence paths; (2) code-reviewer — severity-rated review of the new code, focusing on the durable-correctness invariants (sole committer, reconcile table, fencing order, envelope capture) and the isolation changes.
scripts/render-metrics.ts:9: * - `dexcli flow state <flowId>` attribute store: `envelope-event/*` (the
scripts/render-metrics.ts:10: *   envelope stream), `pp-verdict/*` + `pp-prep-verdict/*` (ReviewTuple — the
scripts/render-metrics.ts:13: * - optional chaos sidecar (JSON lines, intent/completed records) merged into
scripts/render-metrics.ts:81: * (dex housekeeping at its event threshold) accumulates envelopes across runs
scripts/render-metrics.ts:83: * run's dispatch entries or first-run envelopes fail as anchorless.
scripts/render-metrics.ts:118:      typeof v.recorded_at !== "string"
scripts/render-metrics.ts:130:      recorded_at: v.recorded_at,
scripts/render-metrics.ts:149:    if (!a.key.startsWith("pp-verdict/") && !a.key.startsWith("pp-prep-verdict/")) continue;
scripts/render-metrics.ts:170:    if (!a.key.startsWith("envelope-event/")) continue;
scripts/render-metrics.ts:237:  // `pp-wave/children`; merge every child's envelope/verdict/burn-down
scripts/render-metrics.ts:247:  const envelopes: EnvelopeEvent[] = [];
scripts/render-metrics.ts:248:  const verdicts: VerdictRecord[] = [];
scripts/render-metrics.ts:252:    envelopes.push(...collectEnvelopes(s.attributes ?? []));
scripts/render-metrics.ts:253:    verdicts.push(...collectVerdicts(s.attributes ?? []));
scripts/render-metrics.ts:265:    envelopes,
scripts/render-metrics.ts:266:    verdicts,
scripts/render-metrics.ts:280:    `[render-metrics] flow=${flowId} run=${runId} envelopes=${envelopes.length} verdicts=${verdicts.length} burnDown=${burnDown.length} killEvents=${killEvents?.events.length ?? 0} provenance_ok=${report.json.provenance_ok}`,
tests/phase2-flow.test.ts:5: * parts (diff parsing/rendering, JSON + code extraction, verdict intake and
tests/phase2-flow.test.ts:26:  verdictKeyOf,
tests/phase2-flow.test.ts:102:    const prose = 'Here is my verdict:\n{"findings": [], "note": "clean"} — done.';
tests/phase2-flow.test.ts:121:describe("verdict intake: validate + map onto metrics shapes", () => {
tests/phase2-flow.test.ts:157:    expect(mapped.record.file).toBe("src/Money.php");
tests/phase2-flow.test.ts:158:    expect(mapped.record.reviewer).toBe("reviewer-A");
tests/phase2-flow.test.ts:159:    expect(mapped.record.round).toBe(2);
tests/phase2-flow.test.ts:160:    expect(mapped.record.diff_id).toBe("diff-x-r2");
tests/phase2-flow.test.ts:162:    const f1 = mapped.record.findings.find((f) => f.finding_id === "F1");
tests/phase2-flow.test.ts:168:    expect(mapped.record.citation_check.find((c) => c.finding_id === "F1")?.p_cited).toBe(0.9);
tests/phase2-flow.test.ts:169:    expect(mapped.record.citation_check.find((c) => c.finding_id === "F2")?.p_cited).toBe(0);
tests/phase2-flow.test.ts:172:  test("structurally invalid verdicts are rejected with all errors", () => {
tests/phase2-flow.test.ts:223:    expect(verdictKeyOf("src/Money.php", 2, "reviewer-A")).toBe("src__Money.php#2#reviewer-A");
.omc/handoffs/team-verify.md:4:- **Must fix before Phase 3**: [C1] cross-branch dedup → committed round never reaches integration (CommitStep skips commit, IntegrateStep merges wrong branch, `alreadyIntegrated:true` misleading; live-reproduced). Fix: make keyed commit reachable from this round's branch (record keyed.branch in marker, merge keyed.branch or ff lease branch to keyed.sha when clean) + IntegrateStep verifies `merge-base --is-ancestor keyed.sha integration` and throws otherwise + regression test. [M1] no-op assertion checks PHP source path instead of `ppOut` outPath (retry-deadlock or vacuous). [M2] envelope events have no file/round identity — collide across files (blocks AC2 + Phase 5 anchoring): add `identityOf` to EnvelopeSpec, use in event key + start event. [M5] reviewer numbering header says body line 1 but resolver subtracts DIFF_HEADER_LINES=5 → legitimate early findings silently dropped (p_cited=0). [F1] step-factory completeness lint test (extend phase1 tree-walk). [F2] `toolOverridesAllOff()` assertion test.
.omc/handoffs/team-verify.md:5:- **Must fix before Phase 6 (do now, context hot)**: [M3] ordered recovery (epoch bump → abort+confirm → reclaim → reconcile → re-dispatch) not wired into port flow — probe uses InMemoryLeaseStore, disconnected from pp-lease; add recover mode for the port flow. [M4] envelope-start events staged inside the step they describe → killed steps leave no envelope (0(g) fallback built but unused); persist start events via recordStep mini-steps for model-calling roles. [M6] lease branches created from main HEAD not `integration` → re-round geometry forces non-ff same-path merges (worktree.ts:488 throws); base new leases on integration when it exists + explicit re-round merge strategy + test.
.omc/handoffs/team-verify.md:6:- **Fold (cheap)**: [m1] commitSha field stores tree hash + backfill round −1; [m2] abort() success logic; [m3] sanitizePathSegment hash suffix; [m4] PROMPT_WAIT_MS validation; [m5] gitSelftest tautology → assert integrated===true; [m6] .gitignore kill-events*.jsonl; verifier F3-analog: chaosKill accepts dex runId so sidecar self-anchors; BUILD_NOTES: document fence-in-same-step + add reviewer-turn kill to Phase 3 smoke plan; recordStep dedup extraction; pidAlive EPERM. **Defer**: round-increment wiring (Phase 4 note), prep role `record`→`queue` cosmetic.
.omc/handoffs/team-verify.md:7:- **Risks**: C1/M2 fixes touch the flow + envelope cores — regression risk on trial-5 behavior; require full bun test + typecheck green and new regression tests; targeted C1 integration test must reproduce the cross-branch scenario from the review. No full trial-gate re-run required (cost guard) unless C1 fix touches commit/integration runtime paths — then one single-file smoke.
.omc/handoffs/team-verify.md:8:- **Files**: flows/port-project.ts, flows/steps/envelope.ts, src/git/worktree.ts, src/harness/{runtime,opencode}.ts, scripts/{run-demo,chaos-kill}.ts, tests/**, BUILD_NOTES.md. Commit as verify-fix.
tests/phase34.test.ts:71:    expect(result.answers.type_selection.confidence).toBeGreaterThan(0.5);
tests/phase34.test.ts:75:    // The double reports usage so judgment-role envelopes keep provenance.
tests/phase34.test.ts:126:      recorded_at: "2026-09-25T23:59:00.000Z",
tests/port-parallel.test.ts:9:  classifyDispatchStepType,
tests/port-parallel.test.ts:47:    for (const stepType of ["PpWaveDispatch", "PpWaveJoin", "PpChildLease", "PpChildRelease"]) {
tests/port-parallel.test.ts:48:      expect(classifyDispatchStepType(stepType)).toBe("flow-step");
tests/port-parallel.test.ts:53:  test("child flow registers the full per-file pipeline (envelope-wrapped steps only)", () => {
tests/port-parallel.test.ts:56:    // sanctioned only inside the envelope factory, and that lint matches
tests/port-parallel.test.ts:68:    expect(stepTypeOf(parent.waveDispatch)).toBe("PpWaveDispatch");
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:29:| Core adversarial loop | active | Implementer → 2+ read-only adversarial reviewers (diff-in, structured verdict-out) → fixer, all as opencode agents driven by dex steps | Covered by AC1, AC2; execution mode settled in Round 9 |
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:38:Build a reusable toolkit in this repo (`refactoring-toolkit`) that recreates the article's dynamic workflow setup: durable multi-agent orchestration in which a custom opencode harness (oh-my-openagent-style TypeScript plugin: agents and skills as TS modules) supplies the agents — one implementer, two read-only adversarial reviewers that receive only the diff, and one fixer — orchestrated by dex flows so every agent invocation, verdict, and file commit is a durable step. The toolkit runs a full pipeline: prep-analysis (PHP→TS spec map + per-symbol table, adversarially reviewed), per-file porting loop, and verification queues (tsc errors, failing vitest tests). It is validated end-to-end on a generated in-repo demo fixture porting a small PHP module (~6–10 files, ~400–700 LOC, plus test files) to TypeScript at minimal v1 scale.
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:43:- **All roles are opencode sessions** with scoped tools: implementer and fixer get worktree write access; each adversarial reviewer is read-only (no write/edit tools) and emits a structured verdict from the diff alone.
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:44:- **Durable orchestration**: dex flows own sequencing and state (attributes); agent calls, reviews, verdicts, and commits are durable steps; local dex server via docker compose or binary; blob store per dex defaults.
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:61:- [ ] **AC1 — Durability: kill + resume.** During a demo run, after at least one PHP file has been ported and committed, the dex server and all workers are killed (SIGKILL). After restart, the flow resumes from its last completed durable step, does not re-port or duplicate commits for already-completed files, and reaches its terminal state. An evidence artifact records kill time, resume time, affected step IDs, and which work was skipped vs. redone.
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:70:| Reviewers as raw in-process API calls (Round 3 hybrid) | Round 8 put the whole stack on opencode — direct conflict | All roles execute as opencode sessions; reviewers read-only with structured verdict output (Round 9) |
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:80:  1. **Per-symbol type analysis** (LIFETIMES.tsv equivalent): code recall (regex/tokenizer) finds candidate TS types per PHP symbol from docblocks, literals, and signatures; a `Choice` whose options are the candidates selects the intended type (`NONE` escape); verification nouls (SDE-cascade shape) escalate flagged symbols to the implementer agent. (Pre-parsed value extraction + SDE cascade cookbooks.)
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:81:  2. **Reviewer-verdict verification**: a noul per finding confirms the cited evidence actually appears in the reviewed diff (citation-check pattern) before the fixer acts; probabilities feed the metrics report.
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:92:| Agent Role | core domain | implementer / adversarial reviewer (read-only) / fixer | Reviewer reviews Diff → Review Verdict; Fixer applies verdict feedback |
.omc/specs/deep-interview-dex-opencode-porting-toolkit.md:169:**A:** All roles in opencode; reviewers are read-only sessions, diff-in/verdict-out.
tests/phase0-seams.test.ts:13:import { requiresTokens } from "../flows/steps/envelope.js";
tests/phase0-seams.test.ts:21:  test("intent record is written BEFORE SIGKILL and completion AFTER; target dies", async () => {
tests/phase0-seams.test.ts:49:    // UTC ordering across records (cross-process ordering asserts UTC only).
tests/phase0-seams.test.ts:121:    expect(requiresTokens("record")).toBe(false);
src/git/worktree.ts:13: *   is recorded as evidence, never as the dedup key.
src/git/worktree.ts:32:/** Disposition of a completed file-round, recorded in the durable marker. */
src/git/worktree.ts:39: * C1 cross-branch fields recorded when dedup found the keyed commit on a
src/git/worktree.ts:65:  /** Content hash trailer if recorded; evidence only. */
src/git/worktree.ts:96: * `redone` applies only where durable records agree no completed round exists.
src/git/worktree.ts:168:    return { kind: "redone", resetTo: "lease-base", reason: "no records; clean worktree" };
src/git/worktree.ts:170:  return { kind: "redone", resetTo: "lease-base", reason: "no records; reset dirty worktree to lease-base" };
src/git/worktree.ts:174:// Durable lease records (epoch + base SHA)
src/git/worktree.ts:191: * Persistence backend for lease records. In production flows this is backed by
src/git/worktree.ts:196:  put(record: LeaseRecord): void;
src/git/worktree.ts:206:  put(record: LeaseRecord): void {
src/git/worktree.ts:207:    this.#byFile.set(record.file, record);
src/git/worktree.ts:330:    // deregister step, it runs BEFORE the lease record is dropped, `git
src/git/worktree.ts:374:  // Content-hash is EVIDENCE recorded in the commit body (plan: op-ID is the
src/git/worktree.ts:409:  const records = out.split("\x1e").map((r) => r.trim()).filter(Boolean);
src/git/worktree.ts:410:  for (const record of records) {
src/git/worktree.ts:411:    const fields = record.split("\x1f").map((p) => p.trim());
src/git/worktree.ts:444: * record `replay_divergent` evidence before calling.
scripts/chaos-kill.ts:4: * Writes a kill-INTENT record (run ID, UTC + monotonic, target PIDs) BEFORE
scripts/chaos-kill.ts:5: * sending SIGKILL, and appends the completion record after. The recovery pass
scripts/chaos-kill.ts:6: * accepts the intent record as the kill time, so the evidence chain cannot be
scripts/chaos-kill.ts:81:  /** Dex flow run id (verifier F3-analog): written into both sidecar records. */
tests/verify-fix.test.ts:9: *   flows/steps/envelope.ts).
tests/verify-fix.test.ts:11: * - M2: envelope event keys carry per-target identity.
tests/verify-fix.test.ts:38:import { envelopeEventKey } from "../flows/steps/envelope.js";
tests/verify-fix.test.ts:172:  test("raw dex step creation exists only in flows/steps/envelope.ts", async () => {
tests/verify-fix.test.ts:189:        const sanctioned = rel === "flows/steps/envelope.ts";
tests/verify-fix.test.ts:213:describe("M2: envelope event keys carry per-target identity", () => {
tests/verify-fix.test.ts:215:    expect(envelopeEventKey("pp-implement", 1)).toBe("pp-implement#1");
tests/verify-fix.test.ts:216:    expect(envelopeEventKey("pp-implement", 1, "src__Money.php#1")).toBe(
tests/verify-fix.test.ts:219:    expect(envelopeEventKey("pp-implement", 1, "src__Money.php#1")).not.toBe(
tests/verify-fix.test.ts:220:      envelopeEventKey("pp-implement", 1, "src__Pricing__FlatRateDiscount.php#1"),
tests/verify-fix.test.ts:222:    expect(envelopeEventKey("pp-review-a", 2, "src__Money.php#1")).not.toBe(
tests/verify-fix.test.ts:223:      envelopeEventKey("pp-review-b", 2, "src__Money.php#1"),
scripts/run-demo.ts:215:    "0d3: a naive second commit is DETECTABLE (2 op-ID commits) and divergence is recordable as evidence",
scripts/run-demo.ts:280:  // 3. Lease reclaim (stale epoch records are reclaimable at the pool).
scripts/run-demo.ts:375: *   Jev-live + the n≥30 spot-check); verdict-check/prioritize stay NAIVE.
scripts/run-demo.ts:510:  // flow's own pp-lease store reclaims stale-epoch records on next claim.
tests/opid-seam.test.ts:175:    // Stale epoch record is reclaimed by a same-file acquire at a bumped epoch.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:17:Project context: a durable adversarial PHP->TS porting toolkit (dex flows + opencode agents + TypeSafe/Jev judgments), 196+ tests green, worker finishing evidence runs in parallel (this plan gates on its conclusion). The plan covers the final pre-demo wave: (1) turn-health gating to detect provider-degenerate reviewer turns, (2) vitest triage via Choice-over-candidates, (3) symbol-type uncertain band, (4) verdict repair-or-discard, then closure: push PR #1, final AC1/AC2 report, demo re-record. Plan principles: extend the existing Jev seam; deterministic core (agreement rule, reconcile, provenance anchoring, sole committer) stays pure code; Jev assesses, code decides.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:71:    - Self-audit was conducted: low-confidence and refutable findings moved to Open Questions
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:149:    - LOW confidence → move to Open Questions
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:183:    Compare actual findings against pre-commitment predictions. Synthesize into structured verdict with severity ratings.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:251:    **Verdict Justification**: [Why this verdict, what would need to change for an upgrade. State whether review escalated to ADVERSARIAL mode and why. Include any Realist Check recalibrations.]
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:253:    **Open Questions (unscored)**: [speculative follow-ups AND low-confidence findings moved here by self-audit]
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:264:    - Your LAST assistant message is the deliverable surfaced to callers. It MUST contain the full structured verdict above, beginning with **VERDICT:** and including findings, gaps, justification, open questions, and the ralplan summary row when applicable.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:265:    - Do not put the substantive critique only in earlier messages or tool commentary. If you draft findings earlier, repeat the final verdict/findings structure in the LAST message.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:282:    - False positives from low confidence: Asserting findings you aren't sure about in scored sections. Use the self-audit to gate these.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:303:    - Did I run the self-audit and move low-confidence findings to Open Questions?
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:306:    - Is my verdict clearly stated (REJECT/REVISE/ACCEPT-WITH-RESERVATIONS/ACCEPT)?
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:324:Project context: a durable adversarial PHP->TS porting toolkit (dex flows + opencode agents + TypeSafe/Jev judgments), 196+ tests green, worker finishing evidence runs in parallel (this plan gates on its conclusion). The plan covers the final pre-demo wave: (1) turn-health gating to detect provider-degenerate reviewer turns, (2) vitest triage via Choice-over-candidates, (3) symbol-type uncertain band, (4) verdict repair-or-discard, then closure: push PR #1, final AC1/AC2 report, demo re-record. Plan principles: extend the existing Jev seam; deterministic core (agreement rule, reconcile, provenance anchoring, sole committer) stays pure code; Jev assesses, code decides.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:347:1. **Steps 1 and 4 contradict the deterministic-core principle.** Step 1 says `dispatch gating reads [the turn-health assessment] before next turn`; Step 4 says a flagged verdict triggers a repair prompt and then discard. Both put Jev judgments on flow-control paths. The plan’s principle says “policy tables and thresholds live in tested code,” but a code policy table does not resolve the explicit constraint that judgment must not control flow. Define these judgments as advisory records and keep retry, fallback, defer, repair, and discard decisions deterministic from non-judgment signals—or revise the principle with an explicit, bounded exception.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:353:4. **The criteria do not verify several promised behaviors end to end.** AC-B checks that fixtures fire or pass, but not whether the policy routes each result correctly or what happens when Jev fails. AC-V checks that repair/discard decisions appear in the envelope stream, but does not require tests for valid-but-suspicious verdicts, failed repairs, or preservation of evidence and authoritative identity. Add explicit routing and failure-path criteria and verification steps.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:355:5. **The plan’s dependency and verification steps are underspecified for closure.** Step 5 says “verifier pass over the new items” without defining the verifier, the required commands, or which acceptance criteria it must check. “Push all commits to PR #1” and “final AC1/AC2 status report” likewise lack a specified push scope and report inputs. Define the verifier procedure and closure evidence so the executor can determine completion consistently.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:359:1. Resolve the deterministic-core conflict explicitly. Keep Jev outputs out of flow-control decisions under the current stated principles, or amend the principle and bound the permitted control use. Apply the resolution consistently to turn-health routing and verdict repair/discard.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:365:4. Expand AC-B and AC-V to cover decision outcomes and failure paths, including Jev unavailability, repair failure, evidence retention, and authoritative verdict identity.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:422:    - Self-audit was conducted: low-confidence and refutable findings moved to Open Questions
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:500:    - LOW confidence → move to Open Questions
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:534:    Compare actual findings against pre-commitment predictions. Synthesize into structured verdict with severity ratings.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:602:    **Verdict Justification**: [Why this verdict, what would need to change for an upgrade. State whether review escalated to ADVERSARIAL mode and why. Include any Realist Check recalibrations.]
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:604:    **Open Questions (unscored)**: [speculative follow-ups AND low-confidence findings moved here by self-audit]
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:615:    - Your LAST assistant message is the deliverable surfaced to callers. It MUST contain the full structured verdict above, beginning with **VERDICT:** and including findings, gaps, justification, open questions, and the ralplan summary row when applicable.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:616:    - Do not put the substantive critique only in earlier messages or tool commentary. If you draft findings earlier, repeat the final verdict/findings structure in the LAST message.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:633:    - False positives from low confidence: Asserting findings you aren't sure about in scored sections. Use the self-audit to gate these.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:654:    - Did I run the self-audit and move low-confidence findings to Open Questions?
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:657:    - Is my verdict clearly stated (REJECT/REVISE/ACCEPT-WITH-RESERVATIONS/ACCEPT)?
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:675:Project context: a durable adversarial PHP->TS porting toolkit (dex flows + opencode agents + TypeSafe/Jev judgments), 196+ tests green, worker finishing evidence runs in parallel (this plan gates on its conclusion). The plan covers the final pre-demo wave: (1) turn-health gating to detect provider-degenerate reviewer turns, (2) vitest triage via Choice-over-candidates, (3) symbol-type uncertain band, (4) verdict repair-or-discard, then closure: push PR #1, final AC1/AC2 report, demo re-record. Plan principles: extend the existing Jev seam; deterministic core (agreement rule, reconcile, provenance anchoring, sole committer) stays pure code; Jev assesses, code decides.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:695:I’ll inspect the frozen plan, its research inputs, and the cited Wave 4 evidence, then verify referenced components against the repository. I’ll keep the review read-only and use the requested verdict format.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:720:After worker-1d concludes, execute one bounded wave: (1) productize provider-degenerate-turn handling as a turn-health gating battery; (2–4) three smaller judgment-over-parsing refactors (vitest triage, symbol-type uncertain band, verdict repair-or-discard); then closure — push all unpushed commits to PR #1 with updated narrative, produce the final AC1/AC2 report, re-record the dashboard demo during a live run, and assemble the Chris-demo package. Tier-1 polish (removed-behavior lens, cost columns, lifecycle headline, git timeouts) is ALREADY assigned to worker-1d step 4 — this wave verifies it landed and skips duplicates.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:739:One worker, dependency order: turn-health battery → vitest triage → symbol-type band → verdict battery → closure (lead runs verification + demo record).
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:745:- Cons: closure's PR push would miss the new items or churn (push twice); demo record needs a live run that item 1's battery makes schedulable — inverted dependency.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:754:1. **Turn-health gating battery** (`src/typesafe/turn-health.ts` + seam wiring): noul battery per completed turn (`degenerate_output`, `reasoning_without_text`, `truncation_risk`, `flap_signature`) + confidence-routed policy table (pass ≥0.9 / retry / fallback-reviewer / defer-dispatch). Post-turn, non-blocking (assessment lands in the envelope stream as `record` role; dispatch gating reads it before next turn). Unit tests replay the nine labeled failures as fixtures (must fire) + healthy turns from p4-7/cx-5d (must pass). Calibration table in BUILD_NOTES.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:755:2. **Vitest triage** (`src/queues/vitest-queue.ts`): keep frame extraction as recall; Choice-over-candidates classifier behind the existing `FailureClassifier` interface; naive stays default until a labeled validation (n≥20 triage decisions, ≥90% agreement with hand-labeled ground truth) promotes it.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:756:3. **Symbol-type uncertain band** (`src/typesafe/symbol-types.ts`): p in [0.30, 0.70] or choice-confidence <0.9 → structured escalation record instead of abstention/weak-selection; re-run the n=36 spot-check; bar: maintain ≥90%, report abstention→escalation conversion count.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:757:4. **Verdict repair-or-discard** (`src/harness/runtime.ts`): post-schema, pre-fixer noul battery (`off_target`, `hallucinated_context`, `format_violation`); flagged → one repair re-prompt (reuses retry machinery) → still-flagged → discard with envelope evidence. Metrics: repair/discard counts in report.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:758:5. **Closure (lead)**: push all commits to PR #1 + rewrite PR body (wave-4/5 narrative, AC2 render results, provider-degeneracy finding); verifier pass over the new items; final AC1/AC2 status report; re-record demo during a live run (battery-gated scheduling); Chris-package summary (one-pager + video + report.md).
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:765:- [ ] AC-V: verdict battery wired; repair-or-discard decisions present in the envelope stream; `bun test` + `tsc` green throughout.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:772:| Provider window dies mid-demo-record | Battery-gated scheduling (item 1 enables it); retry within the wave; fallback: record from a replayed flow history |
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:795:**Cookbook fit:** **Guardrails for LLMs** — TypeSafe supplies the *assessment*, code owns the *decision*: a noul battery per completed turn (`degenerate_output`, `reasoning_without_text`, `truncation_risk`, `provider_flap_signature`) + a policy table (pass / retry-now / fallback-reviewer / defer-dispatch). Plus **Classification using confidence**: one judgment on turn health; confidence ≥0.9 proceed, below → deterministic demotion to the fallback path (alternate reviewer config), no second call.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:798:### 2. Vitest triage: candidates + Choice instead of path-prefix heuristics — HIGH value, S cost
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:799:**Where:** `src/queues/vitest-queue.ts` `createNaiveClassifier`.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:801:**Cookbook fit:** **Pre-parsed value extraction** — keep the regex frame-extraction as recall, replace the prefix heuristic with a Choice/Noul over the candidate frames ("which frame is the causal one; is the failure port-caused or fixture-side?"). Selection can't invent a frame that isn't in the list.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:803:### 3. Symbol-type selection: uncertain band + confidence escalation — MED value, S cost
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:804:**Where:** `src/typesafe/symbol-types.ts` (spot-check at 91.7%; 5 residual misses = abstentions on Money-typed params).
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:805:**Cookbook fit:** **Self-consistency with nouls** (the 0.30–0.70 uncertain band routes to review instead of flipping on noise) + **Classification using confidence** (confidence <0.9 → auto-escalate to the implementer rather than return a shaky selection). Converts abstentions into structured escalations; complements the existing 4-check cascade; parallel-questions batching of per-file symbols remains the known-deferred secondary integration.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:808:**Where:** `src/harness/runtime.ts` verdict intake + `harness/agents/verdict-schema.ts`.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:809:**Today's fragility:** schema-invalid verdicts → retry/fail; no semantic check between "valid JSON" and "citation-checked" (which only validates quoted evidence).
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:810:**Cookbook fit:** **SDE cascade** shape applied to verdicts: cheap noul battery per suspect verdict (`off_target`, `hallucinated_context`, `format_violation`) gates whether the verdict gets a repair re-prompt (pi-dw Tier-2 item) or is discarded — escalation only on flagged items.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:817:Agreement rule (`src/metrics/agreement.ts`), reconcile() decision table, sole-committer/op-ID commits, envelope provenance + dispatch anchoring, kill sidecar ordering. These are deterministic *by design*; converting them to judgments would break AC2's provenance bar and AC1's replay semantics. Also: dashboard context-threading complexity (`src/dashboard/state.ts`) is a missing-data problem, not a parsing problem — the M2 identity field now flows; prefer data over judgment there.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:821:The three existing Jev integration points (symbol-types cascade, citation-check, prioritization) prove the seam pattern in this codebase; items 1–4 extend the same seam, they don't introduce a new dependency shape. Console URL (console.typesafe.ai/docs/cookbooks) is auth-gated; all referenced cookbooks read from docs.typesafe.ai.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:826:- **Method**: 5 parallel research agents, disjoint lanes, file:line evidence, ADOPT/ADAPT/REJECT checked against plan principles (dex-as-truth, envelope-as-render, sole committer, vendor-thin seams, all-TypeScript).
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:842:6. Secrets redaction on envelope-attribute writes + spawn-time credential injection (lightspeed-fleet, redaction.rs): "secrets reach builds, never transcripts; evidence redacted."
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:850:## Tier 3 — v2 / recorded, not built
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:856:17. Plan-amendment items (deferred): completenessCheck advisory 5th role, PLAUSIBLE verdict class, any third reviewer/judge — all break the 2-record agreement rule or the verdict enum as spec'd.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:868:553-    recorded as a worker-3 follow-up, not a prompt issue.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:884:569-| `911b300` | checkpoint A: Phase 3/4 evidence record + CreatorPay fixture |
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:886:571-| `7c7e9ec` | Phase 5 reconciliation: anchor learns live `:start` self-envelopes; prep model steps carry the marker join identity; `render-metrics.ts` driver |
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:906:591-real run: provenance_ok=true, 0 failures, 73/73 envelopes dispatch-anchored,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:907:592-10 verdict records, 1,107,958 model tokens reconciled**
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:909:594-data; validates the marker-identity fix, the `:start` self-envelope anchor,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:916:601-output tokens, NO text part, ~32k reasoning → verdict-JSON parse fails → dex
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:923:/bin/zsh -lc "sed -n '598,685p' BUILD_NOTES.md; sed -n '1,220p' src/typesafe/client.ts; sed -n '1,240p' src/harness/opencode.ts; sed -n '1,220p' src/queues/vitest-queue.ts; sed -n '1,220p' src/typesafe/symbol-types.ts; rg -n \"FailureClassifier|envelope stream|record'|role.*record|repair|retry|verdict|confidence\" src/harness/runtime.ts src/harness/agents/verdict-schema.ts src/queues src/typesafe scripts/run-demo.ts" in /Users/siddicky/Projects/zcode/refactoring-toolkit
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:928:output tokens, NO text part, ~32k reasoning → verdict-JSON parse fails → dex
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:977: * System One). Everything downstream (symbol-types, verdict-check, prioritize,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1007:export type ChoiceCriteria = { [label: string]: EntryType };
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1010:export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1025:export type Question = NoulQuestion | ScoreQuestion | ChoiceQuestion;
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1037:export interface ChoiceResponse<T extends ChoiceCriteria = ChoiceCriteria> {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1040:  readonly confidence: number;
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1047:  readonly confidence: number;
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1055:    : Q extends ChoiceQuestion<infer C>
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1056:      ? ChoiceResponse<C>
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1090:export function choice<const T extends ChoiceCriteria>(
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1093:): ChoiceQuestion<T> {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1111: * and the real SDK adapter — always provide them so judgment-role envelopes
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1164: * question name (same shapes as the SDK's NoulResponse/ChoiceResponse).
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1317:        () => reject(new OpencodePromptError(`SDK call timed out after ${PROMPT_CALL_TIMEOUT_MS}ms (${what})`, true)),
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1331:export class OpencodePromptError extends Error {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1335:    this.name = "OpencodePromptError";
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1520:/** Parse raw vitest output (default reporter, ANSI tolerated) into records. */
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1525:  let current: { record: VitestFailureRecord; messageLines: string[] } | null =
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1530:      current.record.errorMessage = current.messageLines.join("\n");
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1531:      failures.push(current.record);
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1543:      current = { record: parseFailHeader(line), messageLines: [] };
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1552:        current.record.frames.push(frame);
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1662: * 2. SELECTION: a TypeSafe Choice question whose options ARE the candidates
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1668: *    return escalation records — the CALLER decides (plan: escalate to the
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1671:import { choice, noul, type ChoiceCriteria, type ChoiceResponse, type JudgmentClient } from "./client.js";
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1862:// ---- selection + verification cascade ------------------------------------------
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1875:rg: src/harness/agents/verdict-schema.ts: No such file or directory (os error 2)
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1876:scripts/run-demo.ts:375: *   Jev-live + the n≥30 spot-check); verdict-check/prioritize stay NAIVE.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1877:src/harness/runtime.ts:4: * (src/harness/opencode.ts), and owns the diff/verdict plumbing of the
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1878:src/harness/runtime.ts:14: * - verdict intake: extract the reviewer's JSON object, validate it against
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1879:src/harness/runtime.ts:15: *   the verdict schema (harness/agents/verdict-schema.ts), and map it onto
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1880:src/harness/runtime.ts:32:} from "../../harness/agents/verdict-schema.js";
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1881:src/harness/runtime.ts:317: * verdict.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1882:src/harness/runtime.ts:377: * Validates the reviewer's raw verdict and maps it onto the metrics event
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1883:src/harness/runtime.ts:477:    `Reviewer id: ${input.reviewerId} (use exactly this value as "reviewer" in your verdict).`,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1884:src/harness/runtime.ts:478:    "Review the diff below and emit your verdict JSON per your standing instructions.",
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1885:src/harness/runtime.ts:635:      answers[name] = { type: "choice", choice: pick, confidence: 0.9, probabilities };
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1886:src/typesafe/client.ts:3: * System One). Everything downstream (symbol-types, verdict-check, prioritize,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1887:src/typesafe/client.ts:66:  readonly confidence: number;
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1888:src/typesafe/client.ts:73:  readonly confidence: number;
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1889:src/typesafe/symbol-types.ts:246:  choice_confidence: number | null;
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1890:src/typesafe/symbol-types.ts:280:      choice_confidence: null,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1891:src/typesafe/symbol-types.ts:334:      choice_confidence: picked.confidence,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1892:src/typesafe/symbol-types.ts:341:          p: picked.confidence,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1893:src/typesafe/symbol-types.ts:393:    choice_confidence: picked.confidence,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1897:src/typesafe/client.test.ts:28:      b: { type: "choice", choice: "x", confidence: 0.8, probabilities: { x: 0.8, y: 0.2 } },
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1898:src/typesafe/verdict-check.ts:5: * `{finding_id, p_cited}` per finding (matching the verdict record's
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1899:src/typesafe/verdict-check.ts:50:export function naiveCitationCheck(verdict: VerdictRecord, diff: DiffDocument): CitationCheckResult[] {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1900:src/typesafe/verdict-check.ts:51:  return verdict.findings.map((finding) => ({
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1901:src/typesafe/verdict-check.ts:64: * Output preserves verdict.findings order.
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1902:src/typesafe/verdict-check.ts:68:  verdict: VerdictRecord,
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1903:src/typesafe/verdict-check.ts:74:  for (const finding of verdict.findings) {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1904:src/typesafe/verdict-check.ts:87:    return verdict.findings.map((finding) => ({ finding_id: finding.finding_id, p_cited: 0 }));
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1905:src/typesafe/verdict-check.ts:104:  return verdict.findings.map((finding) => {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1906:src/typesafe/verdict-check.ts:119:  check(verdict: VerdictRecord, diff: DiffDocument): Promise<CitationCheckResult[]>;
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1907:src/typesafe/verdict-check.ts:129:      async check(verdict, diff) {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1908:src/typesafe/verdict-check.ts:130:        return naiveCitationCheck(verdict, diff);
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1909:src/typesafe/verdict-check.ts:136:    async check(verdict, diff) {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1910:src/typesafe/verdict-check.ts:137:      return jevCitationCheck(client, verdict, diff);
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1914:src/typesafe/verdict-check.test.ts:8:} from "./verdict-check.js";
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1915:src/typesafe/verdict-check.test.ts:44:function verdictWith(findings: Finding[]): VerdictRecord {
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1916:src/typesafe/verdict-check.test.ts:67:    const v = verdictWith([
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1917:src/typesafe/verdict-check.test.ts:79:    const v = verdictWith([
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1918:src/typesafe/verdict-check.test.ts:96:    const v = verdictWith([
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1919:src/typesafe/verdict-check.test.ts:108:    const v = verdictWith([{ finding_id: "F4", severity: "nit", summary: "vague", evidence: null }]);
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1920:src/typesafe/verdict-check.test.ts:113:    const v = verdictWith([
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1921:src/typesafe/verdict-check.test.ts:127:    const v = verdictWith([
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1922:src/typesafe/verdict-check.test.ts:156:    const v = verdictWith([{ finding_id: "F9", severity: "nit", summary: "vague", evidence: null }]);
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1923:src/typesafe/verdict-check.test.ts:170:    const v = verdictWith([
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1924:src/typesafe/prioritize.ts:12: * Precondition: finding_ids are unique within a batch (verdict schema).
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1925:src/typesafe/symbol-types.test.ts:99:          type_selection: { type: "choice", choice: "number", confidence: 0.93, probabilities: { number: 0.93, NONE: 0.07 } },
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1926:src/typesafe/symbol-types.test.ts:127:        return { type_selection: { type: "choice", choice: "string", confidence: 0.6, probabilities: { string: 0.6 } } };
.omc/artifacts/ask/codex-you-are-the-critic-in-a-planner-architect-critic-consensus-l-2026-09-26T19-07-58-919Z.md:1927:src/typesafe/symbol-types.test.ts:151:      type_selection: { type: "choice", choice: "NONE", confidence: 0.55, probabilities: { NONE: 0.55 } },
   210	    if (session === undefined || typeof session.id !== "string") {
   211	      throw new Error(`opencode session.create returned no session (label=${label})`);
   212	    }
   213	    return { id: session.id, title: session.title ?? label };
   214	  }
   215	
   216	  /**
   217	   * Sends one prompt and waits for the assistant reply. Returns extracted
   218	   * token usage; `usage === null` means the server never exposed usage and is
   219	   * a PROVENANCE FAILURE for model-calling steps (never zero).
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
   316	    }
   317	    return undefined;
   318	  }
   319	
   320	  /** Aborts a session. Returns true only when the server accepted without error. */
     1	/**
     2	 * vitest verification queue — parsing + triage (plan Phase 4).
     3	 *
     4	 * Real vitest runs are toolkit-owned queue steps executed against the
     5	 * integrated checkout (plan §Flow contract step 3). This module ONLY parses
     6	 * failure output and classifies failures. It never executes agents and never
     7	 * runs vitest itself.
     8	 *
     9	 * Triage contract: `classify(failure)` decides whether a failing test is fed
    10	 * back to the port loop (port-caused) or attributed to the demo fixture /
    11	 * test harness (fixture-problem). The interface exists so a smarter
    12	 * classifier (e.g. a TypeSafe noul) can replace the naive code-only default
    13	 * without touching the flow (plan principle 5: vendor-thin seams, naive impls
    14	 * first). The naive default is a pure path heuristic over the parsed stack.
    15	 *
    16	 * Zero runtime deps.
    17	 */
    18	
    19	/** One stack frame parsed from a failure's stack trace. */
    20	export interface StackFrame {
    21	  file: string;
    22	  line: number;
    23	  column: number;
    24	}
    25	
    26	/** One failing test, parsed from vitest output. */
    27	export interface VitestFailureRecord {
    28	  /** Test file vitest reported the failure under (e.g. "tests/foo.test.ts"). */
    29	  testFile: string;
    30	  /** Full test name, suite segments joined with " > ". Empty if file-level. */
    31	  testName: string;
    32	  /** Error text: message lines (non-frame lines of the block), "\n"-joined. */
    33	  errorMessage: string;
    34	  /** Stack frames in printed order (innermost first, as vitest prints). */
    35	  frames: StackFrame[];
    36	  /** Original block text, kept as evidence. */
    37	  raw: string;
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
    61	export interface VitestQueueState {
    62	  kind: "vitest-queue";
    63	  iteration: number;
    64	  total: number;
    65	  failures: VitestFailureRecord[];
    66	}
    67	
    68	// ---------------------------------------------------------------------------
    69	// Parsing
    70	// ---------------------------------------------------------------------------
    71	
    72	const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;
    73	
    74	/**
    75	 * Record starts: vitest's default reporter `FAIL  path > suite > test` lines,
    76	 * plus cross/tick markers that carry a suite separator (guards against the
    77	 * per-file summary bullets like `× applies discount 12ms`, which lack " > "
    78	 * and would duplicate the detailed FAIL block).
    79	 */
    80	const RECORD_START = /^\s*(?:FAIL\s+\S|[✗×]\s+\S.*\s>\s)/;
    81	const SUMMARY_START = /^\s*(?:Test Files\s|Tests\s|Duration\s|Start at\s)/;
    82	
    83	const STACK_FRAME_LINE = /(?:^|\s)(?:❯|at)\s+(.+)$/;
    84	const FILE_LINE_COL = /([^\s()'"]+):(\d+):(\d+)/g;
    85	
    86	/** Parse raw vitest output (default reporter, ANSI tolerated) into records. */
    87	export function parseVitestOutput(output: string): VitestFailureRecord[] {
    88	  const clean = output.replace(ANSI_ESCAPE, "").replace(/file:\/\//g, "");
    89	  const failures: VitestFailureRecord[] = [];
    90	
    91	  let current: { record: VitestFailureRecord; messageLines: string[] } | null =
    92	    null;
    93	
    94	  const flush = () => {
    95	    if (current) {
    96	      current.record.errorMessage = current.messageLines.join("\n");
    97	      failures.push(current.record);
    98	      current = null;
    99	    }
   100	  };
   101	
   102	  for (const line of clean.split("\n")) {
   103	    if (SUMMARY_START.test(line)) {
   104	      flush();
   105	      continue;
   106	    }
   107	    if (RECORD_START.test(line)) {
   108	      flush();
   109	      current = { record: parseFailHeader(line), messageLines: [] };
   110	      continue;
   111	    }
   112	    if (!current) {
   113	      continue; // banner / passed-test noise before any failure
   114	    }
   115	    if (isStackFrameLine(line)) {
   116	      const frame = parseStackFrame(line);
   117	      if (frame) {
   118	        current.record.frames.push(frame);
   119	        continue;
   120	      }
   121	    }
   122	    if (line.trim() !== "") {
   123	      current.messageLines.push(line);
   124	    }
   125	  }
   126	  flush();
   127	  return failures;
   128	}
   129	
   130	/** `FAIL  tests/foo.test.ts > Suite > test name` → {testFile, testName}. */
   131	function parseFailHeader(line: string): VitestFailureRecord {
   132	  const rest = line.trim().replace(/^(?:FAIL|[✗×])\s+/, "");
   133	  const separatorIndex = rest.indexOf(" > ");
   134	  if (separatorIndex < 0) {
   135	    return {
   136	      testFile: rest,
   137	      testName: "",
   138	      errorMessage: "",
   139	      frames: [],
   140	      raw: line,
   141	    };
   142	  }
   143	  return {
   144	    testFile: rest.slice(0, separatorIndex),
   145	    testName: rest.slice(separatorIndex + 3),
   146	    errorMessage: "",
   147	    frames: [],
   148	    raw: line,
   149	  };
   150	}
   151	
   152	function isStackFrameLine(line: string): boolean {
   153	  return STACK_FRAME_LINE.test(line);
   154	}
   155	
   156	function parseStackFrame(line: string): StackFrame | null {
   157	  const tail = STACK_FRAME_LINE.exec(line);
   158	  if (!tail) {
   159	    return null;
   160	  }
   161	  const tailText = tail[1];
   162	  if (tailText === undefined) {
   163	    return null;
   164	  }
   165	  const matches = [...tailText.matchAll(FILE_LINE_COL)];
   166	  const last = matches[matches.length - 1];
   167	  if (!last) {
   168	    return null;
   169	  }
   170	  const rawFile = last[1];
   171	  const rawLine = last[2];
   172	  const rawColumn = last[3];
   173	  if (rawFile === undefined || rawLine === undefined || rawColumn === undefined) {
   174	    return null;
   175	  }
   176	  return {
   177	    file: rawFile,
   178	    line: Number(rawLine),
   179	    column: Number(rawColumn),
   180	  };
   181	}
   182	
   183	/** Build durable queue state from parsed failures. */
   184	export function buildVitestQueueState(
   185	  failures: readonly VitestFailureRecord[],
   186	  iteration: number,
   187	): VitestQueueState {
   188	  return {
   189	    kind: "vitest-queue",
   190	    iteration,
   191	    total: failures.length,
   192	    failures: [...failures],
   193	  };
   194	}
   195	
   196	// ---------------------------------------------------------------------------
   197	// Naive classifier (code-only default behind the FailureClassifier seam)
   198	// ---------------------------------------------------------------------------
   199	
   200	export interface NaiveClassifierOptions {
   201	  /** Path prefixes that belong to the ported TS output. Default: ["src"]. */
   202	  portedRoots?: readonly string[];
   203	  /** Path prefixes belonging to fixture/test-harness files. */
   204	  fixtureRoots?: readonly string[];
   205	  /**
   206	    * Class assigned when no frame matches any known root. Default:
   207	    * "port-caused" — unattributable failures stay visible to the fix loop
   208	    * instead of silently vanishing into the fixture bucket.
   209	    */
   210	  unknown?: FailureClass;
   211	}
   212	
   213	export const DEFAULT_PORTED_ROOTS: readonly string[] = ["src"];
   214	export const DEFAULT_FIXTURE_ROOTS: readonly string[] = [
   215	  "tests",
   216	  "test",
   217	  "__tests__",
   218	  "fixtures",
   219	];
   220	
   221	/**
   222	 * Naive default triage per task spec: a failure whose stack touches a ported
   223	 * output file is port-caused (even if the assertion site is a test file —
   224	 * ported code appearing in the stack means the port loop should look at it);
   225	 * a failure whose stack only contains fixture/test-harness files is a
   226	 * fixture-problem. Walks frames in printed order and checks all roots.
   227	 */
   228	export function createNaiveClassifier(
   229	  options: NaiveClassifierOptions = {},
   230	): FailureClassifier {
   231	  const portedRoots = options.portedRoots ?? DEFAULT_PORTED_ROOTS;
   232	  const fixtureRoots = options.fixtureRoots ?? DEFAULT_FIXTURE_ROOTS;
   233	  const unknownClass = options.unknown ?? "port-caused";
   234	
   235	  return {
   236	    classify(failure: VitestFailureRecord): FailureClassification {
   237	      for (const frame of failure.frames) {
   238	        const ported = matchRoot(frame.file, portedRoots);
   239	        if (ported) {
   240	          return {
   241	            failureClass: "port-caused",
   242	            reason: `stack frame in ported output: ${frame.file}:${frame.line}:${frame.column}`,
   243	          };
   244	        }
   245	      }
   246	      for (const frame of failure.frames) {
   247	        const fixture = matchRoot(frame.file, fixtureRoots);
   248	        if (fixture) {
   249	          return {
   250	            failureClass: "fixture-problem",
   200	  // 4. observed literal usages
   201	  for (const lit of symbol.literal_usages) {
   202	    push(literalTypeToTs(lit), "literal");
   203	  }
   204	
   205	  return { candidates };
   206	}
   207	
   208	// ---- selection + verification cascade ------------------------------------------
   209	
   210	export type VerificationCheck = "type_mismatch" | "hallucinated" | "unreasonable" | "absence_wrong";
   211	
   212	export const VERIFICATION_CHECKS: readonly VerificationCheck[] = [
   213	  "type_mismatch",
   214	  "hallucinated",
   215	  "unreasonable",
   216	  "absence_wrong",
   217	];
   218	
   219	export type EscalationCheck = VerificationCheck | "recall_empty" | "none_selected";
   220	
   221	/** Default threshold: a verification noul scoring below this flags the symbol. */
   222	export const DEFAULT_ESCALATION_THRESHOLD = 0.8;
   223	
   224	export interface CheckResult {
   225	  check: VerificationCheck;
   226	  p: number;
   227	  flagged: boolean;
   228	}
   229	
   230	export interface EscalationRecord {
   231	  file: string;
   232	  symbol: string;
   233	  check: EscalationCheck;
   234	  /** Noul probability when known; null for recall-level escalations. */
   235	  p: number | null;
   236	  /** Threshold applied when known; null for recall-level escalations. */
   237	  threshold: number | null;
   238	  reason: string;
   239	}
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
     1	/**
     2	 * Harness runtime bridge (Phase 1 wiring): connects the DATA-ONLY agent
     3	 * definitions (harness/agents/*) to the opencode runtime seam
     4	 * (src/harness/opencode.ts), and owns the diff/verdict plumbing of the
     5	 * review loop.
     6	 *
     7	 * Responsibilities (plan §Reviewer isolation enforcement + §Flow contract):
     8	 * - effective-permission merge: agent tool config merged with the opencode
     9	 *   plugin tool surface, DENY AUTHORITATIVE. The merged reviewer agent must
    10	 *   have zero effective tools (tested in tests/phase1-isolation.test.ts).
    11	 * - diff pass-by-value: the reviewed diff is rendered into the prompt with a
    12	 *   stable 1-based line numbering shared with the hunk resolver, so reviewer
    13	 *   evidence spans can be mapped back onto diff hunks.
    14	 * - verdict intake: extract the reviewer's JSON object, validate it against
    15	 *   the verdict schema (harness/agents/verdict-schema.ts), and map it onto
    16	 *   the metrics event contract's VerdictRecord/Finding/EvidenceSpan shapes
    17	 *   (src/metrics/types.ts) consumed by naiveCitationCheck/naivePrioritize.
    18	 *
    19	 * v1 tooling reality (recorded deviation): agent turns are prompt-in /
    20	 * content-out through this bridge — the toolkit writes files into the lease
    21	 * worktree and runs every git operation. Agents therefore have NO tool
    22	 * surface at all (stronger than deny-lists); "scoped write tools" are
    23	 * enforced by toolkit mediation. Revisit when opencode per-agent tool config
    24	 * is wired for real server-side execution.
    25	 */
    26	
    27	import type { AgentDefinition, ToolCategory } from "../../harness/agents/types.js";
    28	import { TOOL_CATEGORIES } from "../../harness/agents/types.js";
    29	import {
    30	  validateVerdictRecord,
    31	  type VerdictRecord as AgentVerdictRecord,
    32	} from "../../harness/agents/verdict-schema.js";
    33	import type {
    34	  DiffDocument,
    35	  EvidenceSpan as MetricsEvidenceSpan,
    36	  Finding as MetricsFinding,
    37	  VerdictRecord as MetricsVerdictRecord,
    38	} from "../metrics/types.js";
    39	import type { PhpSymbol } from "../typesafe/symbol-types.js";
    40	import { createInMemoryJevClient, type InMemoryResponder, type JudgmentClient } from "../typesafe/client.js";
    41	import type { TokenUsage } from "../metrics/types.js";
    42	
    43	// ---------------------------------------------------------------------------
    44	// Effective permissions (config + plugin merge, deny authoritative)
    45	// ---------------------------------------------------------------------------
    46	
    47	/**
    48	 * The tool surface the opencode plugin merge exposes by default: every known
    49	 * category is present unless the agent config denies it. Merged effective
    50	 * tools = (plugin surface ∩ allow) − deny.
    51	 */
    52	export function pluginToolSurface(): readonly ToolCategory[] {
    53	  return TOOL_CATEGORIES;
    54	}
    55	
    56	/** Effective tools for one agent after config + plugin merge. */
    57	export function effectiveTools(def: AgentDefinition): readonly ToolCategory[] {
    58	  return TOOL_CATEGORIES.filter(
    59	    (c) => def.tools.allow.includes(c) && !def.tools.deny.includes(c),
    60	  );
    61	}
    62	
    63	/**
    64	 * Deny-authoritative per-turn `tools` map for the opencode prompt body:
    65	 * every plugin-surface category is explicitly allowed (true) or denied
    66	 * (false). Reviewers come out all-false — server-side, not just prompt text.
    67	 */
    68	export function toolOverridesFor(def: AgentDefinition): Record<string, boolean> {
    69	  const overrides: Record<string, boolean> = {};
    70	  for (const category of TOOL_CATEGORIES) {
    71	    overrides[category] = def.tools.allow.includes(category) && !def.tools.deny.includes(category);
    72	  }
    73	  return overrides;
    74	}
    75	
    76	/**
    77	 * BRIDGE-MODE enforcement (v1): EVERY agent turn runs with the entire tool
    78	 * surface disabled server-side. The toolkit mediates all writes into the
    79	 * lease worktree and is the sole git operator, so writer agents need no
    80	 * server-side tools either. LIVE-VERIFIED LEAK (trial gate, recorded in
    81	 * BUILD_NOTES): writer agents on opencode's `build` agent (cwd = the
    82	 * toolkit repo, write tools enabled) wrote their "output path" files
    83	 * directly into the repo instead of only replying — the leak this helper
    84	 * closes. `toolOverridesFor` above remains the declarative config view.
    85	 */
    86	export function toolOverridesAllOff(): Record<string, boolean> {
    87	  const overrides: Record<string, boolean> = {};
    88	  for (const category of TOOL_CATEGORIES) overrides[category] = false;
    89	  return overrides;
    90	}
    91	
    92	/** True when the merged agent holds zero effective tools (reviewer rule). */
    93	export function hasZeroEffectiveTools(def: AgentDefinition): boolean {
    94	  return effectiveTools(def).length === 0;
    95	}
    96	
    97	/**
    98	 * The hard tool policy block appended to every agent turn. This is the
    99	 * runtime enforcement of the deny list in the prompt-in/content-out bridge:
   100	 * the model is told its limits verbatim on every turn.
   101	 */
   102	export function toolPolicyBlock(def: AgentDefinition): string {
   103	  const denied = def.tools.deny.length > 0 ? def.tools.deny.join(", ") : "none";
   104	  const allowed = effectiveTools(def);
   105	  return [
   106	    "## Tool policy (enforced)",
   107	    `- Effective tools after the config + plugin merge: ${allowed.length === 0 ? "NONE — you have no tools at all" : allowed.join(", ")}`,
   108	    `- Denied (cannot be re-enabled): ${denied}`,
   109	    "- No git operations of any kind: the toolkit is the sole committer.",
   110	    "- Everything you need is inside this prompt; answer in your reply text.",
   111	  ].join("\n");
   112	}
   113	
   114	/**
   115	 * Optional opencode agent override for REVIEWER sessions
   116	 * (OPENCODE_REVIEWER_AGENT env). ODW defense-in-depth: launching reviewers
   117	 * on a read-only/text-only agent (e.g. opencode's "plan") in addition to the
   118	 * tool deny list keeps diff isolation enforced even if the tools map is
   119	 * ignored by a future plugin merge.
   120	 */
   121	export function reviewerAgentOverride(): string | undefined {
   122	  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
   123	  const v = proc?.env?.OPENCODE_REVIEWER_AGENT?.trim();
   124	  return v !== undefined && v !== "" ? v : undefined;
   125	}
   126	
   127	/**
   128	 * Wave-5 cost honesty (takeaways-synthesis #2): maps the opencode seam's
   129	 * TokenUsage onto the metrics event contract's TokenUsage split so envelope
   130	 * events can carry the full provider-reported cache/reasoning split + USD
   131	 * cost instead of a bare total. Pure field rename; no inference.
   132	 */
   133	export function toEnvelopeUsage(u: {
   134	  input: number;
   135	  output: number;
   136	  reasoning: number;
   137	  cacheRead: number;
   138	  cacheWrite: number;
   139	  cost: number;
   140	}): TokenUsage {
   141	  return {
   142	    input_tokens: u.input,
   143	    output_tokens: u.output,
   144	    reasoning_tokens: u.reasoning,
   145	    cache_read_tokens: u.cacheRead,
   146	    cache_write_tokens: u.cacheWrite,
   147	    cost_usd: u.cost,
   148	  };
   149	}
   150	
   151	/**
   152	 * Per-turn REVIEWER model override (wave-5 lane swap): when set, every
   153	 * reviewer turn (prep reviews + per-file review-A/B — all through
   154	 * runReviewTurn) runs on this provider/model instead of the harness default,
   155	 * so the reviewer lane can move independently of implementer/fixer (which
   156	 * stay on the default lane). Format: `OPENCODE_REVIEWER_MODEL=<providerID>/<modelID>`
   157	 * e.g. `openai/gpt-6-luna`. Invalid formats are ignored (undefined).
   158	 */
   159	export function reviewerModelOverride(): { providerID: string; modelID: string } | undefined {
   160	  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
   161	  const v = proc?.env?.OPENCODE_REVIEWER_MODEL?.trim();
   162	  if (v === undefined || v === "") return undefined;
   163	  const slash = v.indexOf("/");
   164	  if (slash <= 0 || slash >= v.length - 1) return undefined;
   165	  return { providerID: v.slice(0, slash), modelID: v.slice(slash + 1) };
   166	}
   167	
   168	// ---------------------------------------------------------------------------
   169	// Diff pass-by-value plumbing
   170	// ---------------------------------------------------------------------------
   171	
   172	/**
   173	 * Number of wrapper header lines renderDiffForReview puts BEFORE the diff
   174	 * body; reviewer line numbers minus this offset are body lines.
   175	 */
   176	export const DIFF_HEADER_LINES = 5;
   177	
   178	/**
   179	 * Renders the diff block delivered to reviewers: a deterministic header plus
   180	 * the raw unified diff. Evidence `start_line`/`end_line` values are 1-based
   181	 * lines WITHIN THIS BLOCK (line 1 = the first header line; the first line of
   182	 * the diff body is line DIFF_HEADER_LINES + 1).
   183	 */
   184	export function renderDiffForReview(input: {
   185	  diffText: string;
   186	  file: string;
   187	  round: number;
   188	  diffId: string;
   189	}): { block: string; lineCount: number } {
   190	  const header = [
   191	    `DIFF_ID: ${input.diffId}`,
   192	    `FILE: ${input.file}`,
   193	    `ROUND: ${input.round}`,
   194	    `Evidence line numbers are 1-based positions IN THIS BLOCK: lines 1-${DIFF_HEADER_LINES} are this header and the diff body starts at line ${DIFF_HEADER_LINES + 1}.`,
   195	    "--- BEGIN DIFF ---",
   196	  ];
   197	  const body = input.diffText.replace(/\n$/, "").split("\n");
   198	  const block = [...header, ...body].join("\n");
   199	  return { block, lineCount: block.split("\n").length };
   200	}
   201	
   202	/**
   203	 * The shape of the parsed diff used for evidence resolution: the metrics
   204	 * DiffDocument plus the body-line index and raw body lines. The durable
   205	 * diff attribute stores only JSON-safe parts (raw text + doc); the index is
   206	 * rebuilt deterministically via {@link parseUnifiedDiff} at use time.
   207	 */
   208	export interface ParsedDiff extends DiffDocument {
   209	  /** The diff body split into lines (trailing newline removed). */
   210	  lines: string[];
   211	  /** Hunk id for a 1-based body line, undefined outside every hunk. */
   212	  hunkIdForBodyLine(line: number): string | undefined;
   213	}
   214	
   215	export function parseUnifiedDiff(diffText: string): ParsedDiff {
   216	  const lines = diffText.split("\n");
   217	  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
   218	
   219	  const hunks: DiffDocument["hunks"] = [];
   220	  const ranges: Array<{ from: number; to: number; id: string }> = [];
   221	  let current: { from: number; id: string } | undefined;
   222	
   223	  for (let i = 0; i < lines.length; i++) {
   224	    const line = lines[i] ?? "";
   225	    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
   226	    if (m !== null) {
   227	      if (current !== undefined) {
   228	        ranges.push({ from: current.from, to: i, id: current.id });
   229	      }
   230	      const hunk: DiffDocument["hunks"][number] = {
   231	        hunk_id: `h${hunks.length + 1}`,
   232	        header: line,
   233	        old_start: Number(m[1] ?? 0),
   234	        old_lines: m[2] === undefined ? 1 : Number(m[2]),
   235	        new_start: Number(m[3] ?? 0),
   236	        new_lines: m[4] === undefined ? 1 : Number(m[4]),
   237	        lines: [],
   238	      };
   239	      hunks.push(hunk);
   240	      current = { from: i + 1, id: hunk.hunk_id }; // body starts AFTER the @@ header

exec
/bin/zsh -lc "nl -ba src/harness/opencode.ts | sed -n '270,315p;560,640p' && nl -ba flows/port-project.ts | sed -n '180,205p;600,635p' && nl -ba scripts/run-demo.ts | sed -n '1,220p' && nl -ba flows/steps/envelope.ts | sed -n '1,220p' && nl -ba src/typesafe/client.ts | sed -n '1,180p' && git branch -vv && git log --oneline --decorate -8" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
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
   180	/** Phase 3: harvested PHP symbols + the stub baseline they supersede. */
   181	export interface PrepSeedState {
   182	  stubRaw: string;
   183	  symbols: PhpSymbol[];
   184	}
   185	
   186	/** Phase 3: one per-symbol table row (symbol-types decision, flattened). */
   187	export interface SymbolTableRow {
   188	  file: string;
   189	  symbol: string;
   190	  kind: string;
   191	  signature: string;
   192	  candidates: string[];
   193	  selected: string;
   194	  flagged: boolean;
   195	  escalations: number;
   196	}
   197	
   198	export interface PrepDraft {
   199	  specText: string;
   200	  iteration: number;
   201	}
   202	
   203	export interface PrepDiffArtifact {
   204	  raw: string;
   205	  doc: DiffDocument;
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
     1	/**
     2	 * run-demo — Phase 0 exit-criteria driver (side-effect-real, retained).
     3	 *
     4	 * Subcommands:
     5	 *   worker [--harness stub|opencode] [--fault <spec>]   long-running dex worker
     6	 *   hello                                               0(a)/0(b): start+wait hello flow
     7	 *   long-step --ms 90000 [--flow-id long-1]             0(c): start a multi-minute step (kill target)
     8	 *   wait-flow --id <flowId>                             wait for a flow (resume observation)
     9	 *   round --dir <repoDir> --file src/a.php --round 1 --epoch 1
    10	 *                                                       0(d)/0(e): fixture repo + PortRound flow
    11	 *   recover --dir <repoDir> --epoch 2                   ordered recovery: abort/confirm sessions
    12	 *                                                       (enumeration fallback) → lease reclaim →
    13	 *                                                       reconcile → re-dispatch
    14	 *   agent-roundtrip                                     0(e): REAL opencode session + prompt + tokens
    15	 *   git-selftest                                        no dex needed: op-ID crash window (0d),
    16	 *                                                       stale-writer (0d2), differing-content
    17	 *                                                       replay across quarantine (0d3), integration
    18	 *
    19	 * Requires a running dex server: `dexcli dev -open=false` (see BUILD_NOTES.md).
    20	 */
    21	
    22	import { mkdir, rm, stat, writeFile } from "node:fs/promises";
    23	import { join } from "node:path";
    24	import { execFile, spawn } from "node:child_process";
    25	import { promisify } from "node:util";
    26	
    27	const execFileP = promisify(execFile);
    28	import {
    29	  dexConfigFromEnv,
    30	  openDexClient,
    31	  startDexWorker,
    32	} from "../src/dex/client.js";
    33	import {
    34	  OpencodeHarness,
    35	  type AgentSessionClient,
    36	} from "../src/harness/opencode.js";
    37	import {
    38	  InMemoryLeaseStore,
    39	  WorktreePool,
    40	  applyReconcile,
    41	  commitLeaseChanges,
    42	  commitObjectReadable,
    43	  findCommitByOpId,
    44	  isWorktreeClean,
    45	  mergeLeaseIntoIntegration,
    46	  operationId,
    47	  reconcile,
    48	  type CompletionMarker,
    49	  type LeaseRecord,
    50	} from "../src/git/worktree.js";
    51	import { git } from "../src/git/exec.js";
    52	import {
    53	  PortRoundFlow,
    54	  configureProbe,
    55	  probeFlows,
    56	  type RoundInput,
    57	} from "./probe-flow.js";
    58	import { PortProjectFlow, PortFileFlowInstance, configurePortHarness } from "../flows/port-project.js";
    59	import {
    60	  configurePortFault,
    61	  configurePortJudgment,
    62	} from "../flows/runtime-hooks.js";
    63	import { createOfflineJevClient } from "../src/harness/runtime.js";
    64	import { createRealJevClient, isTypesafeOffline } from "../src/typesafe/client.js";
    65	import type { JudgmentClient } from "../src/typesafe/client.js";
    66	import type { Flow } from "@superdurable/dex";
    67	
    68	// ---------------------------------------------------------------------------
    69	// Harness selection — the stub double is explicit and labeled, never silent.
    70	// ---------------------------------------------------------------------------
    71	
    72	class StubHarness implements AgentSessionClient {
    73	  #n = 0;
    74	  async createSession(label: string) {
    75	    this.#n += 1;
    76	    return { id: `stub-session-${this.#n}`, title: label };
    77	  }
    78	  async prompt(_sessionId: string, text: string) {
    79	    // Deterministic test double; these token counts are fixtures.
    80	    return {
    81	      text: `stub reply (${text.length} chars)`,
    82	      usage: { input: 10, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    83	      aborted: false,
    84	    };
    85	  }
    86	  async abortSessionsNotTagged(_epoch: number) {
    87	    // The stub owns no live server sessions.
    88	    return [];
    89	  }
    90	}
    91	
    92	async function pickHarness(name: string | undefined): Promise<AgentSessionClient> {
    93	  if (name === "stub") return new StubHarness();
    94	  const baseUrl = process.env.OPENCODE_BASE_URL?.trim() || undefined;
    95	  try {
    96	    return await OpencodeHarness.connect(
    97	      baseUrl,
    98	      process.env.OPENCODE_MODEL_PROVIDER && process.env.OPENCODE_MODEL_ID
    99	        ? {
   100	            providerID: process.env.OPENCODE_MODEL_PROVIDER,
   101	            modelID: process.env.OPENCODE_MODEL_ID,
   102	          }
   103	        : undefined,
   104	    );
   105	  } catch (err) {
   106	    console.error(`[run-demo] opencode harness unavailable (${(err as Error).message}); falling back to StubHarness (labeled test double)`);
   107	    return new StubHarness();
   108	  }
   109	}
   110	
   111	// ---------------------------------------------------------------------------
   112	// Fixture repo helper (used by `round` and `git-selftest`)
   113	// ---------------------------------------------------------------------------
   114	
   115	export async function makeFixtureRepo(dir: string): Promise<void> {
   116	  await rm(dir, { recursive: true, force: true });
   117	  await mkdir(dir, { recursive: true });
   118	  const runner = git(dir);
   119	  await runner.run(["init", "-b", "main"]);
   120	  await writeFile(join(dir, "README.md"), "fixture repo\n");
   121	  await runner.run(["add", "-A"]);
   122	  await runner.run(["commit", "-m", "fixture init"]);
   123	}
   124	
   125	// ---------------------------------------------------------------------------
   126	// git-selftest — exits 0(d)/0(d2)/0(d3) at the git-seam level (no dex server)
   127	// ---------------------------------------------------------------------------
   128	
   129	async function gitSelftest(): Promise<number> {
   130	  const root = join(process.env.TMPDIR ?? "/tmp", `porting-kit-selftest-${Date.now()}`);
   131	  await makeFixtureRepo(root);
   132	  const wtRoot = join(root, ".worktrees");
   133	  const pool = new WorktreePool(root, wtRoot, new InMemoryLeaseStore(), 2);
   134	  const file = "src/a.php";
   135	  const opId = operationId(file, 1);
   136	
   137	  let failures = 0;
   138	  const check = (name: string, ok: boolean, detail: string) => {
   139	    console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
   140	    if (!ok) failures += 1;
   141	  };
   142	
   143	  // Lease + first commit.
   144	  const acquired = await pool.acquire(file, 1, "selftest-run-1");
   145	  if (!acquired.acquired) {
   146	    console.error(`FAIL lease acquisition — ${acquired.reason}`);
   147	    return 1;
   148	  }
   149	  const lease = acquired.lease;
   150	  const contentV1 = `<?php\n// ported content v1 for ${opId}\n`;
   151	  await mkdir(join(lease.worktreePath, "src"), { recursive: true });
   152	  await writeFile(join(lease.worktreePath, "src", "a.php"), contentV1);
   153	
   154	  const first = await commitLeaseChanges(lease.worktreePath, opId, "round 1");
   155	  const keyed = await findCommitByOpId(root, opId);
   156	  check(
   157	    "0d: keyed commit findable by op-ID after first commit",
   158	    keyed !== undefined && keyed.sha === first.sha,
   159	    `keyed=${keyed?.sha} first=${first.sha}`,
   160	  );
   161	
   162	  // Crash-window replay: a redo produces the SAME dedup decision.
   163	  await writeFile(join(lease.worktreePath, "src", "a.php"), contentV1 + "// redo\n");
   164	  const keyedAgain = await findCommitByOpId(root, opId);
   165	  check(
   166	    "0d: crash-window replay finds the same keyed commit (no duplicate)",
   167	    keyedAgain !== undefined && keyedAgain.sha === first.sha,
   168	    `keyedAgain=${keyedAgain?.sha}`,
   169	  );
   170	
   171	  // 0(d2): stale writer dirties the worktree AFTER the keyed commit.
   172	  await writeFile(join(lease.worktreePath, "src", "a.php"), "STALE WRITER JUNK\n");
   173	  const dirty = await isWorktreeClean(lease.worktreePath);
   174	  const marker: CompletionMarker = {
   175	    round: 1,
   176	    disposition: `committed:${opId}`,
   177	    content_hash: first.contentHash,
   178	  };
   179	  const r1 = reconcile({
   180	    marker: undefined,
   181	    keyed: keyedAgain,
   182	    worktree: { clean: dirty, commitObjectReadable: await commitObjectReadable(root, first.sha ?? "") },
   183	  });
   184	  await applyReconcile(lease, r1, keyedAgain);
   185	  const cleanAfter = await isWorktreeClean(lease.worktreePath);
   186	  const headAfter = (await git(lease.worktreePath).run(["rev-parse", "HEAD"])).trim();
   187	  check(
   188	    "0d2: after stale-writer dirtying, keyed commit is reachable at worktree HEAD",
   189	    r1.kind === "skipped" && cleanAfter && headAfter === first.sha,
   190	    `action=${r1.kind} clean=${cleanAfter} head=${headAfter} want=${first.sha}`,
   191	  );
   192	
   193	  // 0(d3): differing-content replay across a QUARANTINED lease.
   194	  // Quarantine = lease released (worktree gone); branch + commit retained.
   195	  await pool.release(file);
   196	  const spare = await pool.acquire(file, 2, "selftest-run-2");
   197	  if (!spare.acquired) {
   198	    console.error(`FAIL spare lease — ${spare.reason}`);
   199	    return 1;
   200	  }
   201	  const differing = await findCommitByOpId(root, opId);
   202	  const contentV2 = `<?php\n// DIFFERENT content replayed on a spare worktree\n`;
   203	  await mkdir(join(spare.lease.worktreePath, "src"), { recursive: true });
   204	  await writeFile(join(spare.lease.worktreePath, "src", "a.php"), contentV2);
   205	  const replay = await commitLeaseChanges(spare.lease.worktreePath, opId, "round 1 redo");
   206	  const count = await countOpIdCommits(root, opId);
   207	  const originalStillFound = (await findCommitByOpId(root, opId))?.sha === first.sha;
   208	  const diverged = replay.contentHash !== differing?.contentHash;
   209	  check(
   210	    "0d3: op-ID dedup identity holds — lookup returns the ORIGINAL commit despite differing content",
   211	    originalStillFound,
   212	    `found=${(await findCommitByOpId(root, opId))?.sha} want=${first.sha}`,
   213	  );
   214	  check(
   215	    "0d3: a naive second commit is DETECTABLE (2 op-ID commits) and divergence is recordable as evidence",
   216	    count === 2 && (diverged || replay.disposition === "no-op-empty-diff"),
   217	    `commits=${count} replayTree=${replay.contentHash} firstTree=${differing?.contentHash}`,
   218	  );
   219	
   220	  // Integration: one output project receives the leased work.
     1	/**
     2	 * The ONLY step factory in the toolkit (plan §Metrics event contract).
     3	 * Every durable step is created through {@link envelopeStep} or
     4	 * {@link recordStep}; raw step creation elsewhere is forbidden and policed by
     5	 * the Phase 1 module-boundary lint check.
     6	 *
     7	 * Each execution emits an envelope event:
     8	 *   {stepId, role, file, round, attempt, started_at, ended_at, outcome,
     9	 *    tokens, wall_clock_ms}
    10	 *
    11	 * `tokens` is REQUIRED (non-null) for model-calling roles (agent, review,
    12	 * judgment) and null-as-not-applicable for non-model roles (commit, queue,
    13	 * diff-capture, integration, record). A missing required token value is a
    14	 * provenance failure, never zero.
    15	 *
    16	 * Phase 0(g) note: attribute writes are staged with a step's decision. Whether
    17	 * they survive SIGKILL inside an uncompleted step is decided empirically in
    18	 * Phase 0; the pre-decided fallback — persisting session-ID and envelope-start
    19	 * writes via a preceding durable mini-step (role `record`) — is provided by
    20	 * {@link recordStep} so 0(g)'s outcome cannot force a later redesign.
    21	 */
    22	
    23	import {
    24	  AttributeMap,
    25	  jsonCodec,
    26	  StepList,
    27	  Wait,
    28	  gracefulComplete,
    29	  goTo,
    30	} from "@superdurable/dex";
    31	import type {
    32	  AsyncContext,
    33	  Context,
    34	  Step,
    35	  StepDecision,
    36	  StepOptions,
    37	  Flow,
    38	  StepClass,
    39	  Wait as DexWait,
    40	} from "@superdurable/dex";
    41	import {
    42	  sessionFenceMap,
    43	  type SessionFence,
    44	} from "../../src/harness/opencode.js";
    45	import type { TokenUsage } from "../../src/metrics/types.js";
    46	
    47	// ---------------------------------------------------------------------------
    48	// Envelope event contract
    49	// ---------------------------------------------------------------------------
    50	
    51	export type EnvelopeRole =
    52	  | "agent"
    53	  | "review"
    54	  | "judgment"
    55	  | "verdict-check"
    56	  | "prioritize"
    57	  | "commit"
    58	  | "integration"
    59	  | "queue"
    60	  | "diff-capture"
    61	  | "record";
    62	
    63	export type EnvelopeOutcome =
    64	  "skipped" | "redone" | "interrupted" | "completed";
    65	
    66	export interface EnvelopeEvent {
    67	  stepId: string;
    68	  role: EnvelopeRole;
    69	  /** Lease file key; null for flow-level steps. */
    70	  file: string | null;
    71	  round: number | null;
    72	  /** One-based handler attempt from the dex Context (exit 0(f): SDK-exposed). */
    73	  attempt: number;
    74	  /** UTC ISO-8601 timestamps; cross-process ordering asserts UTC only. */
    75	  started_at: string;
    76	  ended_at: string | null;
    77	  outcome: EnvelopeOutcome;
    78	  /**
    79	   * Token TOTAL (number) or the full provider usage split (TokenUsage object,
    80	   * wave-5 cost honesty: cache/reasoning split + USD cost) for model-calling
    81	   * roles; null = not applicable. Consumers normalize via tokenTotalOf.
    82	   */
    83	  tokens: number | TokenUsage | null;
    84	  wall_clock_ms: number | null;
    85	  /** Per-target identity (sanitized file#round) appended to the event key. */
    86	  identity: string | null;
    87	}
    88	
    89	/**
    90	 * Event key for one envelope execution. M2: multi-target runs (one flow,
    91	 * many file-rounds) collide on `stepId#attempt` alone — the identity
    92	 * (sanitized file#round for per-file steps) keeps every execution's event
    93	 * distinct. AttributeMap keys prohibit `/`; callers sanitize.
    94	 */
    95	export function envelopeEventKey(stepId: string, attempt: number, identity?: string): string {
    96	  return identity !== undefined && identity !== ""
    97	    ? `${stepId}#${attempt}@${identity}`
    98	    : `${stepId}#${attempt}`;
    99	}
   100	
   101	/** AttributeMap instance; flows must include it via persistenceAttributes(). */
   102	export const envelopeEvents = new AttributeMap<EnvelopeEvent>(
   103	  "envelope-event",
   104	  jsonCodec<EnvelopeEvent>(),
   105	);
   106	
   107	/** Roles whose steps call a model: tokens are REQUIRED, never null. */
   108	const MODEL_CALLING_ROLES: readonly EnvelopeRole[] = [
   109	  "agent",
   110	  "review",
   111	  "judgment",
   112	];
   113	
   114	export function requiresTokens(role: EnvelopeRole): boolean {
   115	  return MODEL_CALLING_ROLES.includes(role);
   116	}
   117	
   118	/**
   119	 * Roles that sit at TypeSafe integration points but are CODE-ONLY in Phase 2
   120	 * (naive verdict-check / naive prioritize): they call no model, so their
   121	 * tokens are null-as-not-applicable. When Phase 3 swaps in Jev these steps
   122	 * move to the model-calling `judgment` role and tokens become required.
   123	 */
   124	export const NAIVE_JUDGMENT_ROLES: readonly EnvelopeRole[] = ["verdict-check", "prioritize"];
   125	
   126	/**
   127	 * Persistence schema fragment that every flow must return from
   128	 * getPersistenceSchema() so envelope events and session fences are durable.
   129	 */
   130	export function persistenceAttributes(): [
   131	  AttributeMap<EnvelopeEvent>,
   132	  AttributeMap<SessionFence>,
   133	] {
   134	  return [envelopeEvents, sessionFenceMap];
   135	}
   136	
   137	// ---------------------------------------------------------------------------
   138	// envelopeStep — the single wrapped step factory
   139	// ---------------------------------------------------------------------------
   140	
   141	export interface EnvelopeSpec<I, O> {
   142	  /** Unique durable Step type (protocol name). */
   143	  stepType: string;
   144	  /** Envelope step identity used as the event key prefix. */
   145	  stepId: string;
   146	  role: EnvelopeRole;
   147	  file?: string | undefined;
   148	  round?: number | undefined;
   149	  /**
   150	   * Static dex Step options (heartbeats, retries, timeouts). When omitted the
   151	   * server defaults apply, including the 60s heartbeat timeout.
   152	   */
   153	  stepOptions?: StepOptions | undefined;
   154	  /**
   155	   * Inner handler. Returns the step output plus the token usage observed by
   156	   * the model call — a bare total (number) or the full provider split
   157	   * (TokenUsage object; wave-5 cost honesty). null for non-model work.
   158	   * Throwing triggers dex retry.
   159	   */
   160	  inner: (
   161	    context: Context,
   162	    input: I,
   163	  ) => Promise<{ output: O; tokens: number | TokenUsage | null; outcome?: EnvelopeOutcome }>;
   164	  /**
   165	   * Optional routing decision after a successful inner run. Defaults to
   166	   * gracefulComplete(output). Chain with goTo(nextClass, input) for linear
   167	   * flows; the final step of a flow uses the default.
   168	   */
   169	  route?: (context: Context, input: I, output: O) => StepDecision;
   170	  /**
   171	   * M2: per-target identity for the event key (e.g. sanitized `file#round`
   172	   * for per-file steps). Flow-level steps omit it. Called for the start
   173	   * event (before inner) and the completion event with the same value.
   174	   */
   175	  identityOf?: (context: Context, input: I) => string;
   176	  /**
   177	   * Optional durable readiness conditions evaluated BEFORE execute (dex
   178	   * `waitFor` handler) — e.g. `Wait.allOf(...SubFlow.run(child))` for the
   179	   * v1.1 parallel wave join. Passed through unchanged; heartbeats apply to
   180	   * inner work only.
   181	   */
   182	  waitFor?: (context: Context, input: I) => DexWait | Promise<DexWait>;
   183	}
   184	
   185	/**
   186	 * Multi-minute steps are a Phase 0 exit (0c): dex fails an attempt when no
   187	 * heartbeat arrives within `heartbeatTimeoutMs` (server default 60s; observed
   188	 * live as `backendError: "Heartbeat"` retry loops). The envelope therefore
   189	 * records heartbeats for the duration of the inner handler — long inner work
   190	 * survives worker restarts with no per-step bookkeeping.
   191	 */
   192	const HEARTBEAT_INTERVAL_MS = 15_000;
   193	
   194	function heartbeatLoop(
   195	  context: AsyncContext,
   196	  eventKey: string,
   197	): { stop(): void } {
   198	  const record = context.recordHeartbeat?.bind(context);
   199	  if (typeof record !== "function") return { stop(): void {} };
   200	  const timer = setInterval(() => {
   201	    try {
   202	      void Promise.resolve(
   203	        record({ envelope: eventKey, atUtc: new Date().toISOString() }),
   204	      ).catch(() => {});
   205	    } catch {
   206	      // dex's recordHeartbeat throws synchronously (not via rejection) once
   207	      // the invocation is dead — this catch is the crash guard.
   208	      clearInterval(timer);
   209	    }
   210	  }, HEARTBEAT_INTERVAL_MS);
   211	  // A pending heartbeat timer must never keep the worker process alive.
   212	  (timer as unknown as { unref?: () => void }).unref?.();
   213	  return {
   214	    stop(): void {
   215	      clearInterval(timer);
   216	    },
   217	  };
   218	}
   219	
   220	async function executeEnvelope<I, O>(
     1	/**
     2	 * Vendor-thin seam over the TypeSafe JavaScript SDK (@typesafe-ai/sdk, Jev /
     3	 * System One). Everything downstream (symbol-types, verdict-check, prioritize,
     4	 * tests) depends ONLY on this module's types and the `JudgmentClient`
     5	 * interface — never on the SDK directly.
     6	 *
     7	 * - The REAL client (`createRealJevClient`) dynamically imports
     8	 *   `@typesafe-ai/sdk`, reads the API key from the TYPESAFE_API_KEY env var
     9	 *   only (never hardcoded), and adapts the SDK's `systemOne` to the seam.
    10	 * - The IN-MEMORY double (`createInMemoryJevClient`) answers from a scripted
    11	 *   responder: deterministic, offline, and used by all unit tests. With no
    12	 *   responder it throws — it never fabricates judgments silently.
    13	 * - `createJevClient()` is the env-aware factory: TYPESAFE_OFFLINE=1 forces
    14	 *   the in-memory double so real network calls are skippable in tests/CI.
    15	 */
    16	
    17	// ---- seam types (structural mirrors of @typesafe-ai/sdk 0.6.0) ---------------
    18	
    19	/** A JSON-compatible value. */
    20	export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
    21	
    22	/** Text, a JSON object or array, or null — for state, instructions, criteria. */
    23	export type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null;
    24	
    25	/** A yes/no question; the answer is the probability of "yes". */
    26	export interface NoulQuestion {
    27	  type: "noul";
    28	  instructions?: EntryType;
    29	  criteria?: { true?: EntryType; false?: EntryType } | null;
    30	}
    31	
    32	/** Labels mapped to descriptions. */
    33	export type ChoiceCriteria = { [label: string]: EntryType };
    34	
    35	/** A question that selects between named alternatives. */
    36	export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
    37	  type: "choice";
    38	  instructions?: EntryType;
    39	  criteria: T;
    40	}
    41	
    42	/** A question that assigns a score on an ordered rubric (>= 2 levels). */
    43	export type ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]];
    44	
    45	export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
    46	  type: "score";
    47	  instructions?: EntryType;
    48	  criteria: T;
    49	}
    50	
    51	export type Question = NoulQuestion | ScoreQuestion | ChoiceQuestion;
    52	
    53	export interface Questions {
    54	  [name: string]: Question;
    55	}
    56	
    57	export interface NoulResponse {
    58	  readonly type: "noul";
    59	  /** Probability of a yes answer, 0..1. */
    60	  readonly noul: number;
    61	}
    62	
    63	export interface ChoiceResponse<T extends ChoiceCriteria = ChoiceCriteria> {
    64	  readonly type: "choice";
    65	  readonly choice: keyof T & string;
    66	  readonly confidence: number;
    67	  readonly probabilities: { readonly [K in keyof T]: number };
    68	}
    69	
    70	export interface ScoreResponse {
    71	  readonly type: "score";
    72	  readonly score: number;
    73	  readonly confidence: number;
    74	  readonly probabilities: Readonly<Record<string, number>>;
    75	}
    76	
    77	export type ResultFor<Q extends Question> = Q extends NoulQuestion
    78	  ? NoulResponse
    79	  : Q extends ScoreQuestion
    80	    ? ScoreResponse
    81	    : Q extends ChoiceQuestion<infer C>
    82	      ? ChoiceResponse<C>
    83	      : never;
    84	
    85	export interface Usage {
    86	  readonly input_tokens: number;
    87	  readonly output_tokens: number;
    88	}
    89	
    90	export interface SystemOneRequest<Q extends Questions = Questions> {
    91	  state: EntryType;
    92	  questions: Q;
    93	  model?: string;
    94	}
    95	
    96	export interface SystemOneResult<Q extends Questions = Questions> {
    97	  readonly model: string;
    98	  readonly answers: { readonly [K in keyof Q]: ResultFor<Q[K]> };
    99	  readonly usage: Usage;
   100	}
   101	
   102	// ---- question builders (same shape as the SDK's choice/noul/score) -----------
   103	
   104	export function noul(
   105	  instructions?: EntryType,
   106	  criteria?: { true?: EntryType; false?: EntryType } | null,
   107	): NoulQuestion {
   108	  // exactOptionalPropertyTypes: omit the key instead of passing undefined.
   109	  return {
   110	    type: "noul",
   111	    ...(instructions === undefined ? {} : { instructions }),
   112	    criteria: criteria ?? null,
   113	  };
   114	}
   115	
   116	export function choice<const T extends ChoiceCriteria>(
   117	  instructions: EntryType,
   118	  criteria: T,
   119	): ChoiceQuestion<T> {
   120	  return { type: "choice", instructions, criteria };
   121	}
   122	
   123	export function score<const T extends ScoreCriteria>(
   124	  instructions: EntryType,
   125	  criteria: T,
   126	): ScoreQuestion<T> {
   127	  return { type: "score", instructions, criteria };
   128	}
   129	
   130	// ---- the seam ------------------------------------------------------------------
   131	
   132	/**
   133	 * Vendor-neutral judgment client. The ONLY TypeSafe surface other modules see.
   134	 * `inputTokens`/`outputTokens` are OPTIONAL cumulative diagnostics over this
   135	 * client's own calls (delegating wrappers omit them — the wrapped client
   136	 * carries the totals). The canonical implementations — the in-memory double
   137	 * and the real SDK adapter — always provide them so judgment-role envelopes
   138	 * keep token provenance offline.
   139	 */
   140	export interface JudgmentClient {
   141	  readonly kind: "real" | "in-memory";
   142	  readonly inputTokens?: number;
   143	  readonly outputTokens?: number;
   144	  systemOne<const Q extends Questions>(request: SystemOneRequest<Q>): Promise<SystemOneResult<Q>>;
   145	}
   146	
   147	// ---- env handling ---------------------------------------------------------------
   148	
   149	/** Env var names. The API key comes from TYPESAFE_API_KEY only — never from code. */
   150	export const TYPESAFE_ENV_VARS = {
   151	  apiKey: "TYPESAFE_API_KEY",
   152	  offline: "TYPESAFE_OFFLINE",
   153	  baseURL: "TYPESAFE_BASE_URL",
   154	  defaultModel: "TYPESAFE_DEFAULT_MODEL",
   155	} as const;
   156	
   157	/**
   158	 * Read an env var without importing node typings (this slice must typecheck
   159	 * standalone before the repo-root toolchain lands). Bun/Node both expose
   160	 * `process` on globalThis.
   161	 */
   162	function readEnv(name: string): string | undefined {
   163	  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
   164	  return proc?.env?.[name];
   165	}
   166	
   167	/**
   168	 * True when TYPESAFE_OFFLINE is set to anything truthy (1, true, yes...).
   169	 * "0", "false", "" and unset count as online. Offline mode forces the
   170	 * in-memory double so tests never touch the network.
   171	 */
   172	export function isTypesafeOffline(): boolean {
   173	  const v = readEnv(TYPESAFE_ENV_VARS.offline);
   174	  if (v === undefined || v === "" || v === "0") return false;
   175	  return v.toLowerCase() !== "false";
   176	}
   177	
   178	/** Raised when the real client is requested without an API key. */
   179	export class JevConfigError extends Error {
   180	  constructor(message: string) {
* main 531b753 flows: FixerStep resolves the output path with the prep source-map fallback (cx-5d live finding: fix rounds enter via queue-fix which never sets ppOut for the round — the never-live-proven fix-round pipeline threw 'output path missing file#2'); same fallback as queue-fix/integrate
531b753 (HEAD -> main) flows: FixerStep resolves the output path with the prep source-map fallback (cx-5d live finding: fix rounds enter via queue-fix which never sets ppOut for the round — the never-live-proven fix-round pipeline threw 'output path missing file#2'); same fallback as queue-fix/integrate
7d65601 flows: executeLoadAttributeMaps += ppLease on PpChildLease (cx-5c live finding: child lease read pp-lease/pool via bindLeaseStore undeclared); full reads-only audit of every step — only remaining undeclared read is prepIdentityOf's deliberate try/catch fallback
467ee06 worker: register the PortFileFlowInstance singleton — dex SubFlow.run resolves the registry by INSTANCE identity; registering a fresh PortFileFlow() while the wave join runs SubFlow.run(PortFileFlowInstance) failed waitFor with 'Flow instance is not registered' (cx-5b live finding)
be61be3 flows: waitForLoadAttributeMaps on PpWaveJoin — live cx-5 finding: dex loads waitFor-phase maps separately from execute-phase; the join burned 14 attempts on 'AttributeMap not loaded: pp-prep/prep' at first live parallel dispatch
e7fec97 tier-1 polish (b,c,d): cost honesty — envelopes carry the full provider usage split (cache/reasoning/USD), report + dashboard render per-role tables with ~estimated flag for plan-authed lanes; dashboard lifecycle headline (running→killed→resumed→completed); git exec 30s timeout + verified cleanup-ordering docs; 8 new tests (204 total)
e55b321 harness: per-turn reviewer model override (OPENCODE_REVIEWER_MODEL=provider/model) — lane swap seam for wave-5 reviewer runs; implementer/fixer stay on default lane
fcfc7df BUILD_NOTES §WAVE-4: full failure narrative (per-flow config/signature/evidence), Phase 4 green result, parallel wiring status, state hand-off — STOPPED per lead hard rule
f731250 harness: hard ceiling on one SDK prompt call (opencode can hold session.prompt open past server-side completion — race it and fail retryable so dex re-dispatches)

codex
VERDICT: REVISE

REASONS:

1. The plan contradicts its deterministic-core principle. Principle 1 says retry, fallback, repair, and discard are decided from “non-judgment signals,” but Step 1 makes fallback routing depend on “Tier-0/1 flags,” Step 4 lets “Tier-1 advisory flags” trigger repair, and AC-B2 tests routing as a function of the “tier-1 flag.” An advisory label still influences control when the route changes based on it. The explicit lead-layer dispatch-gate exception does not cover these in-flow decisions.
2. The alternative analysis is incomplete. Option B is rejected because closure “would miss new items or churn” and demo recording “depends on item 1,” but the plan does not compare a parallel implementation with a gated closure after all items land. Option C also compares closure-only against adding the whole wave, without evaluating narrower alternatives such as deterministic turn-health only. Those comparisons do not establish that Option A best serves the drivers.
3. Some acceptance criteria depend on evidence and procedures that are not sufficiently specified in the plan. AC-T calls for a ≥20-case sample “drawn from cx-5d/p4-7 evidence dirs,” but does not name the directories, define how labels are adjudicated beyond “majority-label match,” or identify a reproducible fixture manifest. AC-C refers to “the established verifier agent procedure” without identifying it. These gaps make independent reproduction and sign-off uncertain.

REQUIRED_CHANGES:

1. Resolve the judgment/control contradiction before implementation. Either make Tier-1 outputs purely recorded evidence that cannot affect retry, fallback, repair, discard, or dispatch decisions, or revise the stated principle and justify each judgment-driven route with explicit policy and failure-path criteria. Update Steps 1 and 4 and AC-B2 to match.
2. Strengthen the alternatives section: compare Option A with at least one concrete parallel implementation plus gated closure, and a narrower-scope option. State their dependencies, tradeoffs, and why the rejected options fail the decision drivers.
3. Make AC-T reproducible by naming the exact evidence paths or checked-in fixture manifest, specifying how labels are settled, and recording the sample and results. Identify the verifier procedure used by AC-C, or spell out its commands and evidence checks in the plan.

IMPROVEMENT_SUGGESTIONS:

1. Clarify the push scope in Step 5 so “every commit on local `main` absent from `origin/develop`” cannot pull unrelated work into PR #1; name the intended base and inclusion boundary.
2. The initial risk table says the watcher “never disarms,” while Step 0 specifies killing it and fixing its terminal branch. State how the plan verifies the watcher is stopped before proceeding.


hook: Stop
hook: Stop Completed
tokens used
56,334

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
