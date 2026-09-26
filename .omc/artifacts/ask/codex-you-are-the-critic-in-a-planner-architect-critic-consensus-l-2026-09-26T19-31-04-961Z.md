# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-09-26T19:31:04.962Z

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
1. Step 6 orders the scoped push before the per-AC verifier: `"push scope ...; PR body rewrite; verifier (per-AC, named)"`. A failed check can therefore leave an unverified change pushed to the PR branch, while the plan’s stated verification does not gate that push.
2. The dispatch gate is specified to fail open on stale history and query failure (Step 1, AC-B3). That allows dispatch precisely when the health signal cannot establish provider health. The plan calls this a health gate and ties it to demo protection, but provides no separate degraded-state signal or operator-visible handling for those cases.
3. AC-T’s promotion rule—`≥20 cases AND ≥5/class at ≥90% majority agreement`—does not define how majority agreement is calculated, who adjudicates disagreements, or what happens if a class has fewer than five available examples. The non-default shortfall rule is useful, but it does not make the promotion threshold reproducible.
4. The options are plausible and include honest schedule and coordination tradeoffs. However, Option C′ is described as a “compressed-window fallback” without specifying who decides the window is compressed or how the deferred scope is tracked. This leaves a decision point implicit.
REQUIRED_CHANGES:
1. Reorder Step 6 so the named verifier runs and passes all required checks before pushing; define the exact failure path that prevents the push.
2. Define the dispatch gate’s behavior for stale or unavailable history, including how that state is surfaced and reconciled with demo protection. If fail-open remains, state explicitly that it provides no protection in those cases.
3. Specify AC-T’s agreement formula, adjudication source, and per-class shortfall handling so a second reviewer can reproduce the promotion decision.
IMPROVEMENT_SUGGESTIONS:
1. Make the trigger and owner for choosing Option C′ explicit, and record which Stage 2 items remain deferred when it is used.


OpenAI Codex v0.157.0
--------
workdir: /Users/siddicky/Projects/zcode/refactoring-toolkit
model: gpt-6-luna
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: medium
reasoning summaries: none
session id: 01a0df32-ae19-7842-8831-e6290da43b53
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
I’ll compare the frozen plan against the research and Wave 4 evidence, then verify its referenced components and execution order in the repo. I’ll keep the verdict in the exact format you requested.
exec
/bin/zsh -lc 'rg -n "refactor-toolkit|post-wave5-consensus|WAVE-4|typesafe-refactor-opportunities|takeaways-synthesis" /Users/siddicky/.codex/memories/MEMORY.md' in /Users/siddicky/Projects/zcode/refactoring-toolkit
 exited 1 in 0ms:
exec
/bin/zsh -lc "sed -n '1,260p' .omc/plans/2026-09-26-post-wave5-consensus.md && sed -n '1,220p' .omc/research/typesafe-refactor-opportunities.md && sed -n '1,220p' .omc/research/takeaways-synthesis.md && rg -n -A55 -B4 'WAVE-4' BUILD_NOTES.md" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
# Consensus Plan: post-wave-5 hardening + closure wave

- **Status**: DRAFT v5 — consensus iteration 5, FINAL iteration (synthesis of round-4 Architect + Critic)
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
1. Make the wave-4 failure class deterministic and recoverable; achieve completion-certainty (terminal-success) even under total provider outage via exhaustion tombstones.
2. PR #1 is 6+ commits behind.
3. Chris-demo readiness (stream-fed live dashboard is itself a demo upgrade).

### Viable Options (critical-path to demo-ready)

**Option A — Staged sequential wave (RECOMMENDED).** Stage 1 ≈45 min; Stage 2 ≈2–3 h; Stage 3 ≈1 h. Demo protection at ≈45 min; full closure ≈4–5 h. Rollback per stage.
- Pros: zero file-conflict risk; demo never hostage to Stage 2; honest deps. Cons: longest total wall-clock.

**Option B′ — Parallel items ‖ gated closure.** ≈3–3.5 h (≈30% faster) but two PR pushes, demo record still waits on Stage 1, and two-writer coordination on `flows/port-project.ts`. No gain on the critical path that matters.

**Option C′ — Stage 1 only (≈45 min).** The compressed-window fallback, explicitly NOT equivalent scope (defers the user-approved TypeSafe items + streams consumers).

## Implementation Steps

0. **Gate**: await worker-1d; audit commits; Tier-1-polish dupe check; disarm + verify watchers (kill `/tmp/watch-kill-cx5.sh` [worker-1d's process, surfaced], fix non-exiting terminal branch `:36-44`, assert `pgrep -f watch-kill` empty + state files removed); **verify WriteStream is callable from worker step context** (tiny probe; if not, stream publishing moves to the lead-side runner — noted deviation); baseline `bun test` + `tsc`.
1. **Stage 1 — Tier-0 + demotion + history gate + stream publish**:
   - Tier-0 predicate: degenerate = `usage present AND textOut.length === 0 AND not aborted`; guard before both `src/harness/opencode.ts` `prompt()` exits (`:299` + post-poll; `:293` is usage-null-only). ≤8 arm dropped.
   - Demotion: f(attempt) only (attempt ≥ 2 → demote from `OPENCODE_REVIEWER_MODEL`); `modelOverride` threaded `runReviewTurn → runAgentTurn` (pattern of `attempt` at `flows/port-project.ts:593`). Rationale pinned: 0(g) — intra-step writes don't survive; attempt durability proven 0(f).
   - Dispatch health gate (lead layer): reads dex history only (`GetHistoryEvents`; typed parser reuse from `src/dashboard/queries.ts:76-110`); **stale = newest relevant event age > 10 min**; 5 s query timeout; fail-open on missing/stale/query-failure. Never inside dispatch steps.
   - Stream publish hook: envelope factory emits each event via `WriteStream` to `port/<flowId>/events`; **every WriteStream call site try/catch-swallowed** (telemetry outage can never fail a durable step — test-asserted).
   - Tier 1 (`src/typesafe/turn-health.ts`) evidence-only: Jev nouls on shape-ambiguous turns and discarded verdicts → stream + `record`-role envelope events. **Durable write point for throwing turns: the successor attempt re-records the diagnosis** (deterministic trigger: Tier-0 retry context visible on the next attempt) — no intra-throwing-step write (0(g)). Zero control-flow consumers (import-boundary test).
2. **Stage 2a — Vitest triage as a DECLARED Lane-B gate**: `QueueVerifyStep` persists parsed failure records into the durable vitest queue attribute; `classifyMany` at queue-build writes `{failureClass, attributedFile}` per record (Jev usage via `recordJevUsage` pattern `:498-502`; `FailureClassification` extended `src/queues/vitest-queue.ts:43-47`); the fix-round feed = the existing per-file loop reading queue state; unknown attribution → deterministic `port-caused` default; **Jev unavailability → naive classifier fallback (fail-open)**. Registered in `src/judgment-registry.ts` with provenance.
3. **Stage 2b — Symbol band**: `uncertain_band` label ([0.30, 0.70] ⊂ 0.8 strong-fail; reported separately); `choice_confidence < 0.9` → escalation; calibrated from `/tmp/jev-spot-check-after.json`; re-run `scripts/jev-spot-check.ts` (n=36).
4. **Stage 2c — Verdict repair-or-discard + exhaustion tombstones**:
   - Suspicion predicate (deterministic, exhaustive, Lane A): span-resolves-outside-diff; all-blockers count > 5; **verbatim-repeat scoped to the IN-STEP repair comparison** (invalid verdict vs repaired reply, held in memory — zero substrate; cross-attempt replay already cache-busted `:619-622`).
   - Repair: ONE re-prompt (routed through Tier-0); still-invalid/suspect → tombstone.
   - Tombstone schema: `ppVerdict`/`ppPrepVerdict` variant `{reviewer, discarded: true, reason, attempt, tokens}`; both check steps tolerate (`:1029-1034`, `:1629-1632`); discarded reviewer → zero kept findings (`:1060-1067`; keptCount-0 route `:1086-1087`); surviving reviewer proceeds; round agreement surfaces `unreviewed` side; prep-loop termination verified against `PrepLoopDecisionStep` (`:1657-1663`); tokens-on-tombstone + envelope `tokens` return (`:1010-1013`) enforce AC2 anchoring.
   - **Exhaustion tombstones (adopts architect's completion-certainty extension)**: attempt exhaustion (deterministic `ctx.attempt`/step-policy fact) → BOTH reviewers tombstoned → round proceeds as `degraded` unreviewed → flow reaches terminal-success under total provider outage. Lane A: exhaustion is a non-judgment signal.
   - Pre-check: unit test that agreement/metrics accept one-reviewer and zero-reviewer (degraded) rounds.
5. **Stage 2d — Stream consumers**: dashboard `src/dashboard/queries.ts` gains a `ReadStream` subscriber (poll fallback retained and ENGAGED on subscriber failure — asserted); kill watcher subscribes for `pp-queue-verify:start` with **30-min bounded wait + 60 s poll fallback**, fires once, exits cleanly (no-duplicate assertion). Optional SSE to the page. Projection-only: streams never read for correctness (import-boundary).
6. **Stage 3 — Closure**: push scope `origin/develop..main` (lead line-review); PR body rewrite; **verifier (per-AC, named)**: `bun test` (incl. NEW `tests/turn-health.test.ts`, `tests/verdict-repair.test.ts`, registry + import-boundary tests), `bun run typecheck`, then per-AC evidence (below); final AC1/AC2 report (inputs `/tmp/metrics-*`, BUILD_NOTES); demo re-record via the health gate; Chris package.

## Acceptance Criteria

- [ ] **AC-B1**: ten named degenerate fixtures (7 `retry` no-text incl. cx-4 out=16; 885-token `generic_retry` [no demotion — expected outcome pinned]; cache-replay `generic_retry`; persona `discard_class`) → Tier-0 handles the retry class; demotion on attempt ≥2; ZERO Jev calls on shape-trivial. **AC-B2**: routing = f(shape, attempt), no Tier-1 input; text-present/output-0 and aborted-no-text negatives pass. **AC-B3**: gate = dex history only; fail-open on missing/stale(>10 min)/query-failure; ≤5 s.
- [ ] **AC-R (registry/lanes)**: `src/judgment-registry.ts` lists every Lane-B consumer with threshold + effect; import-boundary test: Lane-A modules import no judgment modules; triage unavailability falls back to naive (fail-open test).
- [ ] **AC-D (streams, end-to-end)**: publish → subscriber receipt → event id present in `/api/state` feed payload (rendered); subscriber/query failure → poll fallback ENGAGED (asserted); watcher: exactly-once fire, clean exit, no duplicate; WriteStream outage cannot fail a step (test).
- [ ] **AC-T**: manifest (`tests/fixtures/vitest-triage/manifest.json`: id/evidence-path/label/adjudication-note); ≥20 cases AND ≥5/class at ≥90% majority agreement to promote; per-class rates; shortfall → non-default.
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

- v1–v4: iteration history (two-tier battery → evidence-only Tier-1 → finalized predicate/substrate/gate).
- v5 (round-4 synthesis, final): **two-lane judgment rule replacing "no exceptions"** (Lane A hard rule for recovery control; Lane B registered content gates incl. the pre-existing citation gate, honestly declared); triage = declared Lane-B gate with naive fail-open; **exhaustion tombstones → terminal-success under total outage**; verbatim-repeat scoped to in-step comparison; WriteStream swallow-semantics mandated + outage test + Step-0 step-context probe; Tier-1 durable write via successor-attempt re-record; watcher bounded wait + poll fallback + exactly-once; gate stale = >10 min; fixture set reconciled to ten with non-Tier-0 outcomes pinned; AC-R (registry/lanes) and expanded end-to-end AC-D added.
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

exec
/bin/zsh -lc "sed -n '614,700p' BUILD_NOTES.md; rg -n \"WriteStream|ReadStream|GetHistoryEvents|PrepLoopDecisionStep|recordJevUsage|classifyMany|createNaiveClassifier|QueueVerifyStep|ppVerdict|ppPrepVerdict|choice_confidence|uncertain_band|citation|p_cited|runReviewTurn|runAgentTurn|modelOverride|attempt\" src flows scripts tests" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
| p4-10 | + 3-probe window gate (autonomous script) | FAILED 14:11 | died at prep review-B: attempts out 3 / 885-unparseable / 1. Gate script log: `/tmp/window-dispatch.log` |
| cx-1 | creatorex 5-file PARALLEL run | FAILED in 1s | PpPrep requires source-map rows for every input file; `stub-prep.md` only covers the 2 seed files (config gap → fixed by `0ecde78`) |
| cx-2 | + prep-stub | FAILED in 1s | missing `--source-root` (defaulted to php-sample) |
| cx-3 | + source-root | FAILED 15:47 | review-B degenerates + a NEW failure mode: opencode held `session.prompt` open ~20+ min past server-side completion (hang; heartbeats kept the attempt alive) → fixed by `f731250` |
| cx-4 | + prompt-call timeout | FAILED 16:28 | prep review-A 3/3 degenerate (out 6/4/16), 16:06–16:27. Kill watcher never fired (pre-window). `dexcli flow history cx-4`, `/tmp/watch-ac1-parallel.log` |

Kill smokes: **never fired** — every post-p4-7 dispatch died in PREP, before
any commit or queue phase. The fix-round kill smoke (bound: 2 attempts) and
the parallel AC1 kill are therefore BLOCKED-BY-PROVIDER, not passed.

## Parallel wiring status

Committed and unit-tested (`tests/port-parallel.test.ts`: wave planning,
anchor registration, both flow registrations), typecheck clean — **NOT
live-proven** (cx-4 never reached wave dispatch). First live exercise will
surface dex SubFlow runtime semantics (getFlowId/getConditionResults/reuse
policy) that types cannot prove. Design + deviations: "v1.1" section above.

## State hand-off (for the next decision)

- Repo: HEAD with all commits above; 196/196 tests, tsc clean. Untracked
  `.omc/research/*` + `demo/` + `.playwright-mcp/` are not wave-4 artifacts.
- Infra at stop: dex (7233 DB) + worker (Sisyphus reviewer env) + opencode +
  dashboard :4646 (STATUS_REPO_ROOT=/tmp/pk-p4) ALL RUNNING; no flows active
  (p4-7..10, cx-1..4 all terminal). Watchers/probe loops stopped.
- Evidence paths: `/tmp/pk-p4` (p4-7 repo), `/tmp/pk-creatorex` (cx repo),
  `/tmp/metrics-p47/`, `/tmp/kill-events-{p3,p4,cx}.jsonl`,
  `/tmp/window-dispatch.log`, `/tmp/provider-health.log`,
  `/tmp/worker-1c.log`, `/tmp/watch-ac1-parallel.log`, dex flows
  p4-7..p4-10, cx-1..cx-4.
- Token cost note for the go/no-go: every failed run still burned real
  implementer/reviewer input tokens (~60–90k per review attempt, mostly
  cache-read); ~15 full/partial runs this wave. Degenerate turns themselves
  produce no output tokens — the cost is inputs + wall clock.
src/git/exec.ts:44:  // until dex fails the attempt on the heartbeat timeout.
scripts/render-metrics.ts:177:      typeof v.attempt === "number" &&
tests/phase2-flow.test.ts:141:    citation_check: [{ finding_id: "F1", p_cited: 0.9 }],
tests/phase2-flow.test.ts:168:    expect(mapped.record.citation_check.find((c) => c.finding_id === "F1")?.p_cited).toBe(0.9);
tests/phase2-flow.test.ts:169:    expect(mapped.record.citation_check.find((c) => c.finding_id === "F2")?.p_cited).toBe(0);
flows/port-parallel.ts:12: *   fails its lease attempt retryably and dex retries with backoff — the cap is
tests/opid-seam.test.ts:67:    await writeWorktreeFile(lease.worktreePath, "<?php\n// v1\n// redo attempt\n");
flows/steps/envelope.ts:8: *   {stepId, role, file, round, attempt, started_at, ended_at, outcome,
flows/steps/envelope.ts:72:  /** One-based handler attempt from the dex Context (exit 0(f): SDK-exposed). */
flows/steps/envelope.ts:73:  attempt: number;
flows/steps/envelope.ts:91: * many file-rounds) collide on `stepId#attempt` alone — the identity
flows/steps/envelope.ts:95:export function envelopeEventKey(stepId: string, attempt: number, identity?: string): string {
flows/steps/envelope.ts:97:    ? `${stepId}#${attempt}@${identity}`
flows/steps/envelope.ts:98:    : `${stepId}#${attempt}`;
flows/steps/envelope.ts:186: * Multi-minute steps are a Phase 0 exit (0c): dex fails an attempt when no
flows/steps/envelope.ts:228:  const eventKey = envelopeEventKey(spec.stepId, context.attempt, identity ?? undefined);
flows/steps/envelope.ts:229:  const attempt = context.attempt;
flows/steps/envelope.ts:236:    attempt,
flows/steps/envelope.ts:336:  attempt: number,
flows/steps/envelope.ts:340:  envelopeEvents.set(context, envelopeEventKey(stepId, attempt, identity), {
flows/steps/envelope.ts:345:    attempt,
flows/steps/envelope.ts:388:      writeRecordEvent(context, spec.stepId, context.attempt, spec.identity);
flows/steps/envelope.ts:412:      writeRecordEvent(context, spec.stepId, context.attempt, spec.identity);
flows/steps/envelope.ts:425: * a durable "step started" marker (attempt 0, outcome `interrupted`,
flows/steps/envelope.ts:431: * Markers use attempt 0 and role `record` semantics so Phase 5's AC2
flows/steps/envelope.ts:467:        attempt: 0,
src/harness/runtime.ts:154: * runReviewTurn) runs on this provider/model instead of the harness default,
src/harness/runtime.ts:380: * are advisory. Findings whose citation_check entry is missing get one from
src/harness/runtime.ts:381: * the naive citation check (the model's honest self-assessment is kept when
src/harness/runtime.ts:405:  const citedById = new Map(agentRecord.citation_check.map((c) => [c.finding_id, c.p_cited]));
src/harness/runtime.ts:432:      citation_check: findings.map((f) => {
src/harness/runtime.ts:434:        return { finding_id: f.finding_id, p_cited: given ?? naive(f) };
src/harness/runtime.ts:702:    "## Validated findings (apply all; they were citation-checked)",
src/queues/vitest-queue.test.ts:8:  createNaiveClassifier,
src/queues/vitest-queue.test.ts:98:    const classifier = createNaiveClassifier();
src/queues/vitest-queue.test.ts:109:    const classifier = createNaiveClassifier();
src/queues/vitest-queue.test.ts:137:      createNaiveClassifier().classify(unknownFailure).failureClass,
src/queues/vitest-queue.test.ts:142:      createNaiveClassifier({ unknown: "fixture-problem" }).classify(unknownFailure)
src/typesafe/verdict-check.test.ts:51:    citation_check: [],
src/typesafe/verdict-check.test.ts:66:  test("cited quote present in the diff -> p_cited 1", () => {
src/typesafe/verdict-check.test.ts:75:    expect(naiveCitationCheck(v, diff)).toEqual([{ finding_id: "F1", p_cited: 1 }]);
src/typesafe/verdict-check.test.ts:78:  test("multiline quote spanning +/- lines -> p_cited 1", () => {
src/typesafe/verdict-check.test.ts:92:    expect(naiveCitationCheck(v, diff)[0]?.p_cited).toBe(1);
src/typesafe/verdict-check.test.ts:95:  test("quote absent from the diff -> p_cited 0", () => {
src/typesafe/verdict-check.test.ts:104:    expect(naiveCitationCheck(v, diff)).toEqual([{ finding_id: "F3", p_cited: 0 }]);
src/typesafe/verdict-check.test.ts:107:  test("finding without evidence -> p_cited 0", () => {
src/typesafe/verdict-check.test.ts:109:    expect(naiveCitationCheck(v, diff)).toEqual([{ finding_id: "F4", p_cited: 0 }]);
src/typesafe/verdict-check.test.ts:112:  test("claimed hunk missing from the diff -> p_cited 0 even if text matches", () => {
src/typesafe/verdict-check.test.ts:121:    expect(naiveCitationCheck(v, diff)[0]?.p_cited).toBe(0);
src/typesafe/verdict-check.test.ts:148:      { finding_id: "F1", p_cited: 0.9 },
src/typesafe/verdict-check.test.ts:149:      { finding_id: "F2", p_cited: 0.2 },
src/typesafe/verdict-check.test.ts:150:      { finding_id: "F3", p_cited: 0 },
src/typesafe/verdict-check.test.ts:160:    expect(await jevCitationCheck(client, v, diff)).toEqual([{ finding_id: "F9", p_cited: 0 }]);
src/typesafe/verdict-check.test.ts:178:    expect(await naive.check(v, diff)).toEqual([{ finding_id: "F1", p_cited: 1 }]);
src/typesafe/verdict-check.test.ts:185:    expect(await jev.check(v, diff)).toEqual([{ finding_id: "F1", p_cited: 0.7 }]);
flows/port-project.ts:303:export const ppVerdict = new AttributeMap<ReviewTuple>("pp-verdict", jsonCodec<ReviewTuple>());
flows/port-project.ts:313:export const ppPrepVerdict = new AttributeMap<ReviewTuple>("pp-prep-verdict", jsonCodec<ReviewTuple>());
flows/port-project.ts:352:      ppVerdict,
flows/port-project.ts:360:      ppPrepVerdict,
flows/port-project.ts:498:async function recordJevUsage(ctx: Context, stepId: string, tokens: number): Promise<void> {
flows/port-project.ts:545:async function runAgentTurn(input: {
flows/port-project.ts:586:async function runReviewTurn(input: {
flows/port-project.ts:593:  /** Dex attempt (1-based). Retries get a cache-busting suffix (live finding:
flows/port-project.ts:595:  attempt?: number;
flows/port-project.ts:620:    (input.attempt ?? 1) > 1
flows/port-project.ts:621:      ? `${turn}\n\n(retry attempt ${input.attempt}: a previous reply on this step was truncated or unparseable — respond with exactly one JSON object and nothing else)`
flows/port-project.ts:625:  const result = await runAgentTurn({
flows/port-project.ts:650:      ).find((c) => c.finding_id === finding.finding_id)?.p_cited ?? 0,
flows/port-project.ts:660:/** Single-finding metrics record scoping for the naive fallback citation. */
flows/port-project.ts:674:    citation_check: [],
flows/port-project.ts:769:    if (out.done) return goTo(QueueVerifyStep, out);
flows/port-project.ts:914:    const result = await runAgentTurn({
flows/port-project.ts:971:    const { tuple, tokens } = await runReviewTurn({
flows/port-project.ts:978:      attempt: ctx.attempt,
flows/port-project.ts:980:    ppVerdict.set(ctx, verdictKeyOf(fri.file, fri.round, "reviewer-A"), tuple);
flows/port-project.ts:1003:    const { tuple, tokens } = await runReviewTurn({
flows/port-project.ts:1010:      attempt: ctx.attempt,
flows/port-project.ts:1012:    ppVerdict.set(ctx, verdictKeyOf(fri.file, fri.round, "reviewer-B"), tuple);
flows/port-project.ts:1023:  stepOptions: { executeLoadAttributeMaps: [ppVerdict, ppDiff] },
flows/port-project.ts:1031:      const tuple = ppVerdict.get(ctx, key);
flows/port-project.ts:1038:      // (p_cited === 1) and its disposition asks for a fix.
flows/port-project.ts:1040:      let citations;
flows/port-project.ts:1051:        citations = await createCitationChecker(counting).check(tuple.metrics, diff.doc);
flows/port-project.ts:1052:        if (jt > 0) await recordJevUsage(ctx, `pp-verdict-check:${fri.file}#${fri.round}`, jt);
flows/port-project.ts:1054:        citations = naiveCitationCheck(tuple.metrics, diff.doc);
flows/port-project.ts:1056:      for (const check of citations) {
flows/port-project.ts:1060:        if (check.p_cited < 1) {
flows/port-project.ts:1064:            reason: `citation check failed (p_cited=${check.p_cited})`,
flows/port-project.ts:1112:      if (jt > 0) await recordJevUsage(ctx, `pp-prioritize:${fri.file}#${fri.round}`, jt);
flows/port-project.ts:1177:    const result = await runAgentTurn({
flows/port-project.ts:1460:    const result = await runAgentTurn({ def: IMPLEMENTER, sessionId: await prepSessionId(input.epoch), turn, file: PREP_SPEC_FILE, round: 0 });
flows/port-project.ts:1556:  // M2/M4 join identity: the attempt-0 start marker carries prep<iteration>;
flows/port-project.ts:1565:    const { tuple, tokens } = await runReviewTurn({
flows/port-project.ts:1572:      attempt: ctx.attempt,
flows/port-project.ts:1574:    ppPrepVerdict.set(ctx, verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, "reviewer-A"), tuple);
flows/port-project.ts:1600:    const { tuple, tokens } = await runReviewTurn({
flows/port-project.ts:1607:      attempt: ctx.attempt,
flows/port-project.ts:1609:    ppPrepVerdict.set(ctx, verdictKeyOf(PREP_SPEC_FILE, state.prepIteration, "reviewer-B"), tuple);
flows/port-project.ts:1619:  stepOptions: { executeLoadAttributeMaps: [ppPrepVerdict, ppPrepDiff, ppPrepState, ppConfig] },
flows/port-project.ts:1631:      const tuple = ppPrepVerdict.get(ctx, key);
flows/port-project.ts:1637:        if (check.p_cited < 1) {
flows/port-project.ts:1641:            reason: `citation check failed (p_cited=${check.p_cited})`,
flows/port-project.ts:1663:  route: (_ctx, _input, input) => goTo(PrepLoopDecisionStep, input),
flows/port-project.ts:1671:const PrepLoopDecisionStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput & { revise: boolean }>({
flows/port-project.ts:1727:    const result = await runAgentTurn({
flows/port-project.ts:1781:const QueueVerifyStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<
flows/port-project.ts:2013:    const result = await runAgentTurn({
flows/port-project.ts:2144:    // 14 attempts with "AttributeMap instance was not loaded for this
flows/port-project.ts:2257:    out.mode === "fix" ? goTo(QueueVerifyStep, baseInputOf(out)) : goTo(DispatchStep, baseInputOf(out)),
flows/port-project.ts:2276:    // finding cx-5c: the child's first step failed 3 attempts with
flows/port-project.ts:2389:    const result = await runAgentTurn({
flows/port-project.ts:2511:  readonly prepLoopDecision = new PrepLoopDecisionStep();
flows/port-project.ts:2532:  readonly queueVerify = new QueueVerifyStep();
src/typesafe/verdict-check.ts:5: * `{finding_id, p_cited}` per finding (matching the verdict record's
src/typesafe/verdict-check.ts:6: * `citation_check` contract).
src/typesafe/verdict-check.ts:11: *   p_cited is exactly 1 (found) or 0 (not found / no evidence / unknown
src/typesafe/verdict-check.ts:15: *   shared diff state; p_cited is the noul probability. Findings without
src/typesafe/verdict-check.ts:16: *   evidence short-circuit to p_cited 0 (nothing was cited) without a model
src/typesafe/verdict-check.ts:46: * NAIVE code-only citation check. Deterministic: p_cited in {0, 1}.
src/typesafe/verdict-check.ts:53:    p_cited: isCitable(diff, finding.evidence) ? 1 : 0,
src/typesafe/verdict-check.ts:62: * JEV citation check: one batched systemOne request, one noul per
src/typesafe/verdict-check.ts:87:    return verdict.findings.map((finding) => ({ finding_id: finding.finding_id, p_cited: 0 }));
src/typesafe/verdict-check.ts:106:      return { finding_id: finding.finding_id, p_cited: 0 };
src/typesafe/verdict-check.ts:112:    return { finding_id: finding.finding_id, p_cited: answer.noul };
src/queues/vitest-queue.ts:228:export function createNaiveClassifier(
src/typesafe/symbol-types.ts:246:  choice_confidence: number | null;
src/typesafe/symbol-types.ts:280:      choice_confidence: null,
src/typesafe/symbol-types.ts:334:      choice_confidence: picked.confidence,
src/typesafe/symbol-types.ts:393:    choice_confidence: picked.confidence,
src/metrics/render.test.ts:52:    // 1 envelope : 2 retry dispatch entries, finalAttempt 2 == envelope attempt 2
src/metrics/render.test.ts:57:      envelope_attempt: 2,
src/metrics/render.test.ts:58:      dispatch_final_attempt: 2,
src/metrics/render.test.ts:76:  test("citation-check probabilities are carried into the report", () => {
src/metrics/render.test.ts:78:    expect(ldap?.citation_checks).toEqual([
src/metrics/render.test.ts:79:      { finding_id: "F1", p_cited: 1 },
src/metrics/render.test.ts:80:      { finding_id: "F2", p_cited: 1 },
src/metrics/render.test.ts:81:      { finding_id: "F1", p_cited: 1 },
src/metrics/render.test.ts:82:      { finding_id: "F2", p_cited: 1 },
src/metrics/render.test.ts:85:    expect(sizeFormatter?.citation_checks[0]?.p_cited).toBeCloseTo(0.4, 5);
src/metrics/render.test.ts:107:    // pp-implement 2000 + pp-fixer 1050 + 1000 over 3 real attempts (marker excluded)
src/metrics/render.test.ts:138:  test("fixer retry counts per file (stepId pp-fixer, attempt > 1)", () => {
src/metrics/render.test.ts:198:    expect(rendered.markdown).toContain("- citation checks: F1=1.00, F2=1.00");
src/metrics/render.test.ts:251:    expect(failures).toContain("attempt-0 start marker but carries token usage");
src/metrics/render.test.ts:253:    expect(failures).toContain("model step pp-implement (src__Http__Request.php#1) has no attempt-0 start marker");
src/metrics/render.test.ts:254:    expect(failures).toContain("model step pp-review-a (src__Http__Request.php#1) has no attempt-0 start marker");
src/metrics/render.test.ts:255:    expect(failures).toContain("model step pp-review-b (src__Http__Request.php#1) has no attempt-0 start marker");
src/metrics/render.test.ts:256:    expect(failures).toContain("reached finalAttempt 3 beyond envelope attempt 1");
src/metrics/render.test.ts:298:      attempt: 1,
src/metrics/render.test.ts:309:  test("negative attempt is a failure", () => {
src/metrics/render.test.ts:315:      attempt: -1,
src/metrics/render.test.ts:333:        attempt: 1,
src/metrics/render.test.ts:374:    attempt: 1,
src/dashboard/testdata.ts:40:  attempt: number,
src/dashboard/testdata.ts:51:  attempt,
src/dashboard/testdata.ts:67:        attempt: 2,
src/dashboard/testdata.ts:166: * context. Includes a retry attempt (pp-review-a#1 vs #2) and a burn-down
src/harness/opencode.ts:109: * deadline and fail RETRYABLE so dex re-dispatches on a fresh attempt.
src/harness/opencode.ts:334:    for (let attempt = 1; attempt <= tries; attempt++) {
src/metrics/agreement.test.ts:30:    citation_check: findings.map((f) => ({ finding_id: f.finding_id, p_cited: 1 })),
src/dashboard/state.test.ts:58:      attempt: 1,
src/dashboard/state.test.ts:78:    const parsed = parseEnvelope({ stepId: "pp-commit", role: "commit", attempt: 1, started_at: "x" });
src/dashboard/state.test.ts:125:  test("feed entries carry outcome/tokens/attempt from the envelope", () => {
src/dashboard/state.test.ts:129:    expect(implement?.attempt).toBe(1);
src/dashboard/state.test.ts:152:    expect(probe.feed[0]?.attempt).toBe(7);
src/dashboard/state.test.ts:185:    expect(row?.attempt).toBe(2);
src/dashboard/state.test.ts:193:  test("falls back to feed-derived stage/attempt/outcome when no step is active", () => {
src/dashboard/state.test.ts:199:    expect(row?.attempt).toBe(1);
src/dashboard/state.test.ts:526:    attempt: 1,
src/dashboard/state.test.ts:556:  test("attempt-0 markers and non-model roles are excluded", () => {
src/dashboard/state.test.ts:558:      feedEntry({ attempt: 0, usage: { input: 5, output: 5, reasoning: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 } }),
src/metrics/fixtures/event-stream-run-b.json:3:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:00:00.000Z", "ended_at": "2026-09-25T11:01:00.000Z", "outcome": "completed", "tokens": 450, "wall_clock_ms": 60000, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:4:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:01:00.000Z", "ended_at": "2026-09-25T11:02:00.000Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 60000, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:5:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:01:00.000Z", "ended_at": "2026-09-25T11:02:00.000Z", "outcome": "completed", "tokens": 100, "wall_clock_ms": 60000, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:6:    {"stepId": "pp-commit", "role": "commit", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:03:00.000Z", "ended_at": "2026-09-25T11:03:00.100Z", "outcome": "completed", "tokens": {"input_tokens": 10, "output_tokens": 5}, "wall_clock_ms": 100, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:7:    {"stepId": "pp-capture-diff", "role": "diff-capture", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:05:00.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Http__Response.php#1"},
src/metrics/fixtures/event-stream-run-b.json:8:    {"stepId": "pp-fixer", "role": "agent", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T11:06:00.000Z", "ended_at": null, "outcome": "interrupted", "tokens": 500, "wall_clock_ms": null, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:9:    {"stepId": "pp-commit", "role": "verdict-check", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:07:00.000Z", "ended_at": "2026-09-25T11:07:00.005Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 5, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:10:    {"stepId": "pp-unknown-step", "role": "record", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:08:00.000Z", "ended_at": "2026-09-25T11:08:00.001Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 1, "identity": null}
src/metrics/fixtures/event-stream-run-b.json:13:    {"file": "src/Http/Request.php", "reviewer": "reviewer-A", "round": 1, "diff_id": "diff-src__Http__Request.php-r1", "findings": [], "citation_check": []}
src/dashboard/static/index.html:179:      <td>${r.attempt == null ? '<span class="faint">-</span>' : esc(r.attempt)}</td>
src/dashboard/static/index.html:208:      <td>${esc(e.attempt)}</td>
src/metrics/types.ts:7: * - Envelope events carry `{stepId, role, file, round, attempt, started_at,
src/metrics/types.ts:13: *   `{file, reviewer, round, diff_id, findings, citation_check}`; an empty
src/metrics/types.ts:76: * - `attempt` is one-based from the dex Context (exit 0(f)) EXCEPT for M4
src/metrics/types.ts:77: *   start markers: attempt 0, outcome "interrupted", `ended_at` null, written
src/metrics/types.ts:81: * - `tokens` is REQUIRED (non-null) for model-calling roles on real attempts;
src/metrics/types.ts:89: *   record: either not yet closed by the recovery pass, or an attempt-0
src/metrics/types.ts:98:  /** 0 = M4 start marker; >= 1 = real attempt (dex Context.attempt). */
src/metrics/types.ts:99:  attempt: number;
src/metrics/types.ts:112:/** True for M4 start markers (attempt 0, record-semantics under the target role). */
src/metrics/types.ts:114:  return env.attempt === 0;
src/metrics/types.ts:187: * naive citation check matches it against the diff text.
src/metrics/types.ts:207:  p_cited: number;
src/metrics/types.ts:221:  citation_check: CitationCheckResult[];
src/dashboard/state.ts:7: * {stepId, role, file, round, attempt, started_at, ended_at, outcome, tokens,
src/dashboard/state.ts:55:  attempt: number;
src/dashboard/state.ts:71:  const attempt = rec.attempt;
src/dashboard/state.ts:74:  if (typeof attempt !== "number" || typeof startedAt !== "string") return null;
src/dashboard/state.ts:80:    attempt,
src/dashboard/state.ts:279:      attempt: parsed.attempt,
src/dashboard/state.ts:514:        attempt: activeForFile?.lastFailureInfo?.attempt ?? (latest !== null ? latest.attempt : null),
src/dashboard/state.ts:540:        attempt: null,
src/dashboard/state.ts:567:      attempt: null,
src/dashboard/state.ts:691:/** Aggregates the provider usage split per role over real-attempt feed entries. */
src/dashboard/state.ts:698:    if (e.attempt === 0 || !e.tokensRequired) continue;
src/dashboard/state.ts:819:    // yet (fresh upserts) — merge without duplicating stepId#attempt keys.
src/dashboard/state.ts:821:      const seen = new Set(flowFeed.map((e) => `${e.stepId}#${e.attempt}#${e.startedAt}`));
src/dashboard/state.ts:823:        const key = `${entry.stepId}#${entry.attempt}#${entry.startedAt}`;
src/dashboard/types.ts:46:    attempt?: number;
src/dashboard/types.ts:191:  attempt: number | null;
src/dashboard/types.ts:216:  attempt: number;
src/metrics/dispatch-anchor.ts:7: * case: one completed envelope (the final attempt) anchors N dispatch entries
src/metrics/dispatch-anchor.ts:8: * whose max `finalAttempt` must equal the envelope attempt (0(f) verified the
src/metrics/dispatch-anchor.ts:9: * live match: envelope `attempt` == dispatch `finalAttempt`).
src/metrics/dispatch-anchor.ts:18: *   `stepId#attempt@file#round` and M4 attempt-0 start markers).
src/metrics/dispatch-anchor.ts:149:   * `<targetStepId>:start` (role "record", real attempt) — in addition to the
src/metrics/dispatch-anchor.ts:150:   * attempt-0 marker it stages for the TARGET step. That self-envelope must
src/metrics/dispatch-anchor.ts:158: * their dispatch entries anchor to the attempt-0 start-marker envelope of
src/metrics/dispatch-anchor.ts:159: * the TARGET step (same stepId/role, attempt 0).
src/metrics/dispatch-anchor.ts:252:   * Require an attempt-0 start-marker envelope for every model-calling
src/metrics/dispatch-anchor.ts:263:  /** Max envelope attempt joined to this group (null = no envelope). */
src/metrics/dispatch-anchor.ts:264:  envelope_attempt: number | null;
src/metrics/dispatch-anchor.ts:266:  dispatch_final_attempt: number | null;
src/metrics/dispatch-anchor.ts:275:  /** Envelope events (real attempts + markers) joined to >= 1 dispatch entry. */
src/metrics/dispatch-anchor.ts:280:  /** Model-calling envelopes missing their M4 attempt-0 start marker. */
src/metrics/dispatch-anchor.ts:304: * 1. envelope -> dispatch: every envelope (real attempt or M4 marker) must
src/metrics/dispatch-anchor.ts:308: *    anchored by an envelope, and the max envelope attempt must EQUAL the max
src/metrics/dispatch-anchor.ts:311: * 4. model-calling envelopes must have their attempt-0 start marker (when
src/metrics/dispatch-anchor.ts:373:        `envelope ${env.stepId}#${env.attempt} does not match any known port-flow step type mapping`,
src/metrics/dispatch-anchor.ts:377:    const isMarker = env.attempt === 0;
src/metrics/dispatch-anchor.ts:379:    // attempt) anchors under its marker spec: the dispatch entry IS the same
src/metrics/dispatch-anchor.ts:380:    // step execution that staged the attempt-0 marker.
src/metrics/dispatch-anchor.ts:386:          ? `envelope ${env.stepId}#${env.attempt} is a start marker but flow spec has no marker step for it`
src/metrics/dispatch-anchor.ts:387:          : `envelope ${env.stepId}#${env.attempt} has no non-marker flow spec`,
src/metrics/dispatch-anchor.ts:395:        `envelope ${env.stepId}#${env.attempt} role "${env.role}" does not match flow spec role "${spec.role}"`,
src/metrics/dispatch-anchor.ts:406:        maxAttempt: env.attempt,
src/metrics/dispatch-anchor.ts:412:      group.maxAttempt = Math.max(group.maxAttempt ?? env.attempt, env.attempt);
src/metrics/dispatch-anchor.ts:415:    // M4: every model-calling real attempt needs its attempt-0 start marker
src/metrics/dispatch-anchor.ts:422:          (m) => m.stepId === env.stepId && m.attempt === 0 && m.identity === env.identity,
src/metrics/dispatch-anchor.ts:427:            `model step ${env.stepId} (${identityDisplay(env.identity)}) has no attempt-0 start marker`,
src/metrics/dispatch-anchor.ts:449:  // ---- dispatch -> envelope direction + attempt equality ------------------
src/metrics/dispatch-anchor.ts:469:      // Markers dispatch once but their ENVELOPE is attempt 0 by design (M4):
src/metrics/dispatch-anchor.ts:470:      // presence is the only requirement; attempt equality does not apply.
src/metrics/dispatch-anchor.ts:474:          `dispatch entry(ies) of type ${entryGroup.spec.stepType} (${identityDisplay(entryGroup.identity)}) with no matching attempt-0 start-marker envelope`,
src/metrics/dispatch-anchor.ts:485:        `envelope ${entryGroup.spec.stepId} (${identityDisplay(entryGroup.identity)}) attempt ${envelopeAttempt} exceeds max dispatched finalAttempt ${entryGroup.maxFinalAttempt} for type ${entryGroup.spec.stepType}`,
src/metrics/dispatch-anchor.ts:490:        `dispatch entry(ies) of type ${entryGroup.spec.stepType} (${identityDisplay(entryGroup.identity)}) reached finalAttempt ${entryGroup.maxFinalAttempt} beyond envelope attempt ${envelopeAttempt} (dispatch without envelope)`,
src/metrics/dispatch-anchor.ts:497:      envelope_attempt: envelopeAttempt,
src/metrics/dispatch-anchor.ts:498:      dispatch_final_attempt: entryGroup.maxFinalAttempt,
src/metrics/render.ts:12: * - attempt-0 start markers (M4) are excluded from token totals, per-role
src/metrics/render.ts:18: *   failure (the attempt was killed mid-turn — the M4 marker plus its dispatch
src/metrics/render.ts:82:    /** M4 attempt-0 start markers (excluded from token/role aggregates). */
src/metrics/render.ts:84:    /** Interrupted envelopes over REAL attempts (attempt >= 1) only. */
src/metrics/render.ts:87:    /** Total over model-calling roles, real attempts only; null when none. */
src/metrics/render.ts:96:    citation_checks: CitationCheckResult[];
src/metrics/render.ts:126:  /** Retries = fixer (stepId pp-fixer) envelope events with attempt > 1, per file. */
src/metrics/render.ts:159:    if (env.attempt < 0) {
src/metrics/render.ts:160:      failures.push(`envelope ${env.stepId} has attempt ${env.attempt} < 0`);
src/metrics/render.ts:163:    if (env.attempt === 0) {
src/metrics/render.ts:165:        failures.push(`envelope ${env.stepId} is an attempt-0 start marker but carries token usage`);
src/metrics/render.ts:289:    const citationChecks: CitationCheckResult[] = records.flatMap((r) =>
src/metrics/render.ts:290:      r.citation_check.map((c) => ({ finding_id: c.finding_id, p_cited: c.p_cited })),
src/metrics/render.ts:301:      citation_checks: citationChecks,
src/metrics/render.ts:306:  // ---- tokens + wall clock per file per role (real attempts only) --------
src/metrics/render.ts:317:    if (env.attempt === 0) continue; // M4 start markers are not step work
src/metrics/render.ts:361:    if (env.attempt === 0 || !isModelCallingRole(env.role)) continue;
src/metrics/render.ts:411:  // ---- totals over eligible (model-calling, real-attempt) steps ----------
src/metrics/render.ts:417:    if (env.attempt === 0) {
src/metrics/render.ts:432:    if (env.stepId !== FIXER_STEP_ID || env.attempt === 0) continue;
src/metrics/render.ts:435:    if (env.attempt > 1) {
src/metrics/render.ts:575:    if (fr.citation_checks.length > 0) {
src/metrics/render.ts:576:      const checks = fr.citation_checks
src/metrics/render.ts:577:        .map((c) => `${c.finding_id}=${pFmt(c.p_cited)}`)
src/metrics/render.ts:579:      lines.push(`- citation checks: ${checks}`);
src/metrics/dispatch-anchor.test.ts:33:    attempt: 1,
src/metrics/dispatch-anchor.test.ts:53:/** A minimal consistent per-file model execution: marker + attempt-N envelope. */
src/metrics/dispatch-anchor.test.ts:54:function modelExecution(stepId: string, stepType: string, identity: string, attempt: number): EnvelopeEvent[] {
src/metrics/dispatch-anchor.test.ts:57:    envelope({ stepId, role, attempt: 0, outcome: "interrupted", ended_at: null, tokens: null, wall_clock_ms: null, identity }),
src/metrics/dispatch-anchor.test.ts:59:  for (let a = 1; a <= attempt; a++) {
src/metrics/dispatch-anchor.test.ts:60:    out.push(envelope({ stepId, role, attempt: a, tokens: 100 * a, identity }));
src/metrics/dispatch-anchor.test.ts:157:  test("retry fan-out: 1 envelope (final attempt) : N dispatch entries anchors clean", () => {
src/metrics/dispatch-anchor.test.ts:170:      envelope_attempt: 2,
src/metrics/dispatch-anchor.test.ts:171:      dispatch_final_attempt: 2,
src/metrics/dispatch-anchor.test.ts:175:    // 3 envelopes (marker + attempt 1 + attempt 2) all anchored
src/metrics/dispatch-anchor.test.ts:190:    // Live stream per model step X: X#0 (attempt-0 marker, role = target role),
src/metrics/dispatch-anchor.test.ts:194:      envelope({ stepId: "pp-implement", role: "agent", attempt: 0, outcome: "interrupted", ended_at: null, wall_clock_ms: null, identity: "src__X.php#1" }),
src/metrics/dispatch-anchor.test.ts:195:      envelope({ stepId: "pp-implement:start", role: "record", attempt: 1, tokens: null, wall_clock_ms: 5, identity: "src__X.php#1" }),
src/metrics/dispatch-anchor.test.ts:196:      envelope({ stepId: "pp-implement", role: "agent", attempt: 1, tokens: 100, identity: "src__X.php#1" }),
src/metrics/dispatch-anchor.test.ts:249:  test("dispatch finalAttempt beyond the envelope attempt fails (lost envelope for the final attempt)", () => {
src/metrics/dispatch-anchor.test.ts:259:        f.includes("reached finalAttempt 2 beyond envelope attempt 1"),
src/metrics/dispatch-anchor.test.ts:264:  test("envelope attempt exceeding every dispatched finalAttempt fails", () => {
src/metrics/dispatch-anchor.test.ts:275:        f.includes("attempt 3 exceeds max dispatched finalAttempt 2"),
src/metrics/dispatch-anchor.test.ts:301:    // the A-file envelopes (marker + attempt 1) anchored fine; B's did not
src/metrics/dispatch-anchor.test.ts:305:  test("model-calling envelope without its M4 attempt-0 start marker fails", () => {
src/metrics/dispatch-anchor.test.ts:313:    expect(result.failures.some((f) => f.includes("has no attempt-0 start marker"))).toBe(true);
src/metrics/dispatch-anchor.test.ts:316:  test("marker dispatch entry without its attempt-0 marker envelope fails (presence, not equality)", () => {
src/metrics/dispatch-anchor.test.ts:327:        f.includes("PpImplementStart (src__W.php#9) with no matching attempt-0 start-marker envelope"),
src/metrics/fixtures/event-stream-run-a.json:3:    {"stepId": "pp-prep", "role": "record", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:00:00.000Z", "ended_at": "2026-09-25T10:00:00.005Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 5, "identity": null},
src/metrics/fixtures/event-stream-run-a.json:4:    {"stepId": "pp-dispatch", "role": "record", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:00:00.010Z", "ended_at": "2026-09-25T10:00:00.018Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 8, "identity": null},
src/metrics/fixtures/event-stream-run-a.json:6:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:00:10.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:7:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:00:10.010Z", "ended_at": "2026-09-25T10:02:10.010Z", "outcome": "completed", "tokens": 2000, "wall_clock_ms": 120000, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:8:    {"stepId": "pp-capture-diff", "role": "diff-capture", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:02:10.020Z", "ended_at": "2026-09-25T10:02:10.024Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 4, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:9:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:02:15.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:10:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:02:15.010Z", "ended_at": "2026-09-25T10:03:00.010Z", "outcome": "completed", "tokens": 1100, "wall_clock_ms": 45000, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:11:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:03:01.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:12:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:03:01.010Z", "ended_at": "2026-09-25T10:03:48.010Z", "outcome": "completed", "tokens": 1170, "wall_clock_ms": 47000, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:13:    {"stepId": "pp-verdict-check", "role": "verdict-check", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:03:49.000Z", "ended_at": "2026-09-25T10:03:49.900Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 900, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:14:    {"stepId": "pp-fixer", "role": "agent", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:03:50.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:15:    {"stepId": "pp-fixer", "role": "agent", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:03:50.010Z", "ended_at": "2026-09-25T10:04:50.010Z", "outcome": "completed", "tokens": 1050, "wall_clock_ms": 60000, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:16:    {"stepId": "pp-fixer", "role": "agent", "file": null, "round": null, "attempt": 2, "started_at": "2026-09-25T10:04:51.000Z", "ended_at": "2026-09-25T10:05:46.000Z", "outcome": "completed", "tokens": 1000, "wall_clock_ms": 55000, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:17:    {"stepId": "pp-commit", "role": "commit", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:06:00.000Z", "ended_at": "2026-09-25T10:06:00.120Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 120, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:18:    {"stepId": "pp-integrate", "role": "integration", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:06:01.000Z", "ended_at": "2026-09-25T10:06:01.800Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 800, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:19:    {"stepId": "pp-release", "role": "record", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:06:02.000Z", "ended_at": "2026-09-25T10:06:02.006Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 6, "identity": "src__Auth__LdapAuth.php#1"},
src/metrics/fixtures/event-stream-run-a.json:21:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:07:00.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:22:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:07:00.010Z", "ended_at": "2026-09-25T10:08:30.010Z", "outcome": "completed", "tokens": 1800, "wall_clock_ms": 90000, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:23:    {"stepId": "pp-capture-diff", "role": "diff-capture", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:08:30.020Z", "ended_at": "2026-09-25T10:08:30.024Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 4, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:24:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:08:31.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:25:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:08:31.010Z", "ended_at": "2026-09-25T10:09:41.010Z", "outcome": "completed", "tokens": 900, "wall_clock_ms": 70000, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:26:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:09:42.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:27:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:09:42.010Z", "ended_at": "2026-09-25T10:11:02.010Z", "outcome": "completed", "tokens": 910, "wall_clock_ms": 80000, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:28:    {"stepId": "pp-verdict-check", "role": "verdict-check", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:11:03.000Z", "ended_at": "2026-09-25T10:11:03.800Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 800, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:29:    {"stepId": "pp-fixer", "role": "agent", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:11:04.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:30:    {"stepId": "pp-fixer", "role": "agent", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:11:04.010Z", "ended_at": "2026-09-25T10:11:44.010Z", "outcome": "completed", "tokens": 800, "wall_clock_ms": 40000, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:31:    {"stepId": "pp-commit", "role": "commit", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:12:00.000Z", "ended_at": "2026-09-25T10:12:00.100Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 100, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:32:    {"stepId": "pp-integrate", "role": "integration", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:12:01.000Z", "ended_at": "2026-09-25T10:12:01.800Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 800, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:33:    {"stepId": "pp-release", "role": "record", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:12:02.000Z", "ended_at": "2026-09-25T10:12:02.006Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 6, "identity": "src__Util__RateLimiter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:35:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:13:00.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:36:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:13:00.010Z", "ended_at": "2026-09-25T10:14:28.010Z", "outcome": "completed", "tokens": 1500, "wall_clock_ms": 88000, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:37:    {"stepId": "pp-capture-diff", "role": "diff-capture", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:14:28.020Z", "ended_at": "2026-09-25T10:14:28.024Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 4, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:38:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:14:29.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:39:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:14:29.010Z", "ended_at": "2026-09-25T10:15:29.010Z", "outcome": "completed", "tokens": 500, "wall_clock_ms": 60000, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:40:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:15:30.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:41:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:15:30.010Z", "ended_at": "2026-09-25T10:16:35.010Z", "outcome": "completed", "tokens": 505, "wall_clock_ms": 65000, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:42:    {"stepId": "pp-verdict-check", "role": "verdict-check", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:16:36.000Z", "ended_at": "2026-09-25T10:16:36.700Z", "outcome": "skipped", "tokens": null, "wall_clock_ms": 700, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:43:    {"stepId": "pp-commit", "role": "commit", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:16:37.000Z", "ended_at": "2026-09-25T10:16:37.110Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 110, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:44:    {"stepId": "pp-integrate", "role": "integration", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:16:38.000Z", "ended_at": "2026-09-25T10:16:38.800Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 800, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:45:    {"stepId": "pp-release", "role": "record", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:16:39.000Z", "ended_at": "2026-09-25T10:16:39.006Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 6, "identity": "src__Util__Csv.php#1"},
src/metrics/fixtures/event-stream-run-a.json:47:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:17:00.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:48:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:17:00.010Z", "ended_at": "2026-09-25T10:18:28.010Z", "outcome": "completed", "tokens": 1500, "wall_clock_ms": 88000, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:49:    {"stepId": "pp-capture-diff", "role": "diff-capture", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:18:28.020Z", "ended_at": "2026-09-25T10:18:28.024Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 4, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:50:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:18:29.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:51:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:18:29.010Z", "ended_at": "2026-09-25T10:19:29.010Z", "outcome": "completed", "tokens": 450, "wall_clock_ms": 60000, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:52:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:19:30.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:53:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:19:30.010Z", "ended_at": "2026-09-25T10:20:35.010Z", "outcome": "completed", "tokens": 455, "wall_clock_ms": 65000, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:54:    {"stepId": "pp-verdict-check", "role": "verdict-check", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:20:36.000Z", "ended_at": "2026-09-25T10:20:36.700Z", "outcome": "skipped", "tokens": null, "wall_clock_ms": 700, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:55:    {"stepId": "pp-commit", "role": "commit", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:20:37.000Z", "ended_at": "2026-09-25T10:20:37.110Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 110, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:56:    {"stepId": "pp-integrate", "role": "integration", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:20:38.000Z", "ended_at": "2026-09-25T10:20:38.800Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 800, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:57:    {"stepId": "pp-release", "role": "record", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:20:39.000Z", "ended_at": "2026-09-25T10:20:39.006Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 6, "identity": "src__Util__SizeFormatter.php#1"},
src/metrics/fixtures/event-stream-run-a.json:59:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T10:29:45.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Util__RateLimiter.php#2"},
src/metrics/fixtures/event-stream-run-a.json:60:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:29:50.000Z", "ended_at": "2026-09-25T10:30:00.200Z", "outcome": "interrupted", "tokens": null, "wall_clock_ms": 10200, "identity": "src__Util__RateLimiter.php#2"},
src/metrics/fixtures/event-stream-run-a.json:62:    {"stepId": "pp-final", "role": "record", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T10:40:00.000Z", "ended_at": "2026-09-25T10:40:00.003Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 3, "identity": null}
src/metrics/fixtures/event-stream-run-a.json:68:    ], "citation_check": [{"finding_id": "F1", "p_cited": 1}, {"finding_id": "F2", "p_cited": 1}]},
src/metrics/fixtures/event-stream-run-a.json:72:    ], "citation_check": [{"finding_id": "F1", "p_cited": 1}, {"finding_id": "F2", "p_cited": 1}]},
src/metrics/fixtures/event-stream-run-a.json:75:    ], "citation_check": [{"finding_id": "F3", "p_cited": 1}]},
src/metrics/fixtures/event-stream-run-a.json:78:    ], "citation_check": [{"finding_id": "F3", "p_cited": 1}]},
src/metrics/fixtures/event-stream-run-a.json:79:    {"file": "src/Util/Csv.php", "reviewer": "reviewer-A", "round": 1, "diff_id": "diff-src__Util__Csv.php-r1", "findings": [], "citation_check": []},
src/metrics/fixtures/event-stream-run-a.json:80:    {"file": "src/Util/Csv.php", "reviewer": "reviewer-B", "round": 1, "diff_id": "diff-src__Util__Csv.php-r1", "findings": [], "citation_check": []},
src/metrics/fixtures/event-stream-run-a.json:83:    ], "citation_check": [{"finding_id": "F5", "p_cited": 0.4}]},
src/metrics/fixtures/event-stream-run-a.json:84:    {"file": "src/Util/SizeFormatter.php", "reviewer": "reviewer-B", "round": 1, "diff_id": "diff-src__Util__SizeFormatter.php-r1", "findings": [], "citation_check": []}

codex
VERDICT: REVISE
REASONS:
1. Step 6 orders the scoped push before the per-AC verifier: `"push scope ...; PR body rewrite; verifier (per-AC, named)"`. A failed check can therefore leave an unverified change pushed to the PR branch, while the plan’s stated verification does not gate that push.
2. The dispatch gate is specified to fail open on stale history and query failure (Step 1, AC-B3). That allows dispatch precisely when the health signal cannot establish provider health. The plan calls this a health gate and ties it to demo protection, but provides no separate degraded-state signal or operator-visible handling for those cases.
3. AC-T’s promotion rule—`≥20 cases AND ≥5/class at ≥90% majority agreement`—does not define how majority agreement is calculated, who adjudicates disagreements, or what happens if a class has fewer than five available examples. The non-default shortfall rule is useful, but it does not make the promotion threshold reproducible.
4. The options are plausible and include honest schedule and coordination tradeoffs. However, Option C′ is described as a “compressed-window fallback” without specifying who decides the window is compressed or how the deferred scope is tracked. This leaves a decision point implicit.
REQUIRED_CHANGES:
1. Reorder Step 6 so the named verifier runs and passes all required checks before pushing; define the exact failure path that prevents the push.
2. Define the dispatch gate’s behavior for stale or unavailable history, including how that state is surfaced and reconciled with demo protection. If fail-open remains, state explicitly that it provides no protection in those cases.
3. Specify AC-T’s agreement formula, adjudication source, and per-class shortfall handling so a second reviewer can reproduce the promotion decision.
IMPROVEMENT_SUGGESTIONS:
1. Make the trigger and owner for choosing Option C′ explicit, and record which Stage 2 items remain deferred when it is used.
hook: Stop
hook: Stop Completed
tokens used
45,408

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
