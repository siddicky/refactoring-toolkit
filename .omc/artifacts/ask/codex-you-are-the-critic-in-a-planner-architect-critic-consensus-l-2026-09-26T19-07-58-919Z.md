# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-09-26T19:07:58.921Z

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

1. **Steps 1 and 4 contradict the deterministic-core principle.** Step 1 says `dispatch gating reads [the turn-health assessment] before next turn`; Step 4 says a flagged verdict triggers a repair prompt and then discard. Both put Jev judgments on flow-control paths. The plan’s principle says “policy tables and thresholds live in tested code,” but a code policy table does not resolve the explicit constraint that judgment must not control flow. Define these judgments as advisory records and keep retry, fallback, defer, repair, and discard decisions deterministic from non-judgment signals—or revise the principle with an explicit, bounded exception.

2. **Step 1’s “post-turn, non-blocking” behavior conflicts with its gating behavior and AC-B.** The plan requires the assessment to be read before the next turn, while AC-B requires no added turn latency. A synchronous Jev call before dispatch blocks the next turn; an asynchronous call cannot gate that dispatch unless the dispatch waits for it. Specify the ordering and behavior when assessment is pending or fails, then make the latency criterion measurable.

3. **AC-B and Step 1 do not define a concrete, reproducible validation set.** The plan calls for “healthy turns from p4-7/cx-5d,” but BUILD_NOTES §WAVE-4 documents p4-7 and failures only through cx-4; it provides no cx-5d evidence. Nine labeled failure cases are documented, but the plan does not identify their fixture paths or define the health labels and expected policy outcomes. Name the actual fixtures and labels, and replace or substantiate the cx-5d reference.

4. **The criteria do not verify several promised behaviors end to end.** AC-B checks that fixtures fire or pass, but not whether the policy routes each result correctly or what happens when Jev fails. AC-V checks that repair/discard decisions appear in the envelope stream, but does not require tests for valid-but-suspicious verdicts, failed repairs, or preservation of evidence and authoritative identity. Add explicit routing and failure-path criteria and verification steps.

5. **The plan’s dependency and verification steps are underspecified for closure.** Step 5 says “verifier pass over the new items” without defining the verifier, the required commands, or which acceptance criteria it must check. “Push all commits to PR #1” and “final AC1/AC2 status report” likewise lack a specified push scope and report inputs. Define the verifier procedure and closure evidence so the executor can determine completion consistently.

REQUIRED_CHANGES:

1. Resolve the deterministic-core conflict explicitly. Keep Jev outputs out of flow-control decisions under the current stated principles, or amend the principle and bound the permitted control use. Apply the resolution consistently to turn-health routing and verdict repair/discard.

2. Reconcile “non-blocking” assessment with pre-dispatch gating. Specify whether the next dispatch waits, what happens on timeout/provider failure, and a testable latency bound or remove the no-added-latency criterion.

3. Correct the healthy-fixture reference and enumerate the nine degenerate fixtures, healthy fixtures, labels, expected results, and their repository paths.

4. Expand AC-B and AC-V to cover decision outcomes and failure paths, including Jev unavailability, repair failure, evidence retention, and authoritative verdict identity.

5. Specify concrete closure verification commands and artifacts, and define which commits are in scope for the PR update.

IMPROVEMENT_SUGGESTIONS:

1. For AC-T, state how the 20 triage cases are sampled and labeled, how agreement is calculated, and what happens if fewer than 20 labeled cases are available. Keep the classifier’s non-default status as the safe outcome unless the stated threshold is met.


OpenAI Codex v0.157.0
--------
workdir: /Users/siddicky/Projects/zcode/refactoring-toolkit
model: gpt-6-luna
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: medium
reasoning summaries: none
session id: 01a0df1d-59c1-7b81-9b33-c4a529d7983c
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
I’ll inspect the frozen plan, its research inputs, and the cited Wave 4 evidence, then verify referenced components against the repository. I’ll keep the review read-only and use the requested verdict format.
exec
/bin/zsh -lc 'rg -n "post-wave5|typesafe-refactor-opportunities|takeaways-synthesis|WAVE-4" /Users/siddicky/.codex/memories/MEMORY.md' in /Users/siddicky/Projects/zcode/refactoring-toolkit
 exited 1 in 0ms:
exec
/bin/zsh -lc "git status --short && sed -n '1,260p' .omc/plans/2026-09-26-post-wave5-consensus.md && sed -n '1,220p' .omc/research/typesafe-refactor-opportunities.md && sed -n '1,220p' .omc/research/takeaways-synthesis.md && rg -n -A45 -B8 'WAVE-4' BUILD_NOTES.md" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
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

- **Status**: DRAFT v1 — consensus iteration 1 (Planner snapshot, frozen for review)
- **Mode**: RALPLAN-DR short | Architect: glm-5.3 via zai | Critic: codex | Date: 2026-09-26
- **Inputs**: `.omc/research/typesafe-refactor-opportunities.md` (ranked items 1–4), `.omc/research/takeaways-synthesis.md` (Tier-1/2), BUILD_NOTES §WAVE-4 (nine labeled provider-degenerate failures), worker-1d in-flight assignment (reviewer swap + evidence runs + Tier-1 polish)

## Requirements Summary

After worker-1d concludes, execute one bounded wave: (1) productize provider-degenerate-turn handling as a turn-health gating battery; (2–4) three smaller judgment-over-parsing refactors (vitest triage, symbol-type uncertain band, verdict repair-or-discard); then closure — push all unpushed commits to PR #1 with updated narrative, produce the final AC1/AC2 report, re-record the dashboard demo during a live run, and assemble the Chris-demo package. Tier-1 polish (removed-behavior lens, cost columns, lifecycle headline, git timeouts) is ALREADY assigned to worker-1d step 4 — this wave verifies it landed and skips duplicates.

## RALPLAN-DR Summary

### Principles
1. **Judgment at the seams** — extend the proven Jev seam (`src/typesafe/client.ts`); no new dependency shape.
2. **Deterministic core untouched** — agreement rule, reconcile(), sole-committer, provenance anchoring stay pure code (plan constitution).
3. **Assessment ≠ decision** — Jev supplies probabilities; policy tables and thresholds live in tested code, calibrated from BUILD_NOTES' nine labeled failures.
4. **One wave, gated start** — begins only after worker-1d concludes; commit per item with tests+typecheck green.
5. **Evidence-first closure** — PR push and the AC1/AC2 report precede demo polish.

### Decision Drivers (top 3)
1. Kill the wave-4 failure class permanently (nine dispatches died to provider degeneracy; detection is currently ad-hoc).
2. PR #1 is 6+ commits behind local main — the public narrative is stale.
3. Chris-demo readiness (round-2 conversation can materialize on short notice).

### Viable Options

**Option A — Sequential single-worker wave (RECOMMENDED)**
One worker, dependency order: turn-health battery → vitest triage → symbol-type band → verdict battery → closure (lead runs verification + demo record).
- Pros: zero file-conflict risk (all items touch harness/typesafe/metrics — same neighborhoods); cheapest; each item gates the next.
- Cons: serial wall-clock (~3–5 h total including closure).

**Option B — Parallel split (typesafe items ‖ closure)**
- Pros: faster to an updated PR.
- Cons: closure's PR push would miss the new items or churn (push twice); demo record needs a live run that item 1's battery makes schedulable — inverted dependency.

**Option C — Closure only; defer all refactors**
- Pros: fastest PR currency.
- Cons: leaves provider flakiness undetected-by-design — the exact class that burned a day; contradicts the user's approved "sure" on Tier-1+ and the TypeSafe analysis request.

## Implementation Steps

0. **Gate**: await worker-1d completion report; `git log` audit of its commits; verify Tier-1 items landed (skip any duplicates); re-run `bun test` + `tsc` baseline.
1. **Turn-health gating battery** (`src/typesafe/turn-health.ts` + seam wiring): noul battery per completed turn (`degenerate_output`, `reasoning_without_text`, `truncation_risk`, `flap_signature`) + confidence-routed policy table (pass ≥0.9 / retry / fallback-reviewer / defer-dispatch). Post-turn, non-blocking (assessment lands in the envelope stream as `record` role; dispatch gating reads it before next turn). Unit tests replay the nine labeled failures as fixtures (must fire) + healthy turns from p4-7/cx-5d (must pass). Calibration table in BUILD_NOTES.
2. **Vitest triage** (`src/queues/vitest-queue.ts`): keep frame extraction as recall; Choice-over-candidates classifier behind the existing `FailureClassifier` interface; naive stays default until a labeled validation (n≥20 triage decisions, ≥90% agreement with hand-labeled ground truth) promotes it.
3. **Symbol-type uncertain band** (`src/typesafe/symbol-types.ts`): p in [0.30, 0.70] or choice-confidence <0.9 → structured escalation record instead of abstention/weak-selection; re-run the n=36 spot-check; bar: maintain ≥90%, report abstention→escalation conversion count.
4. **Verdict repair-or-discard** (`src/harness/runtime.ts`): post-schema, pre-fixer noul battery (`off_target`, `hallucinated_context`, `format_violation`); flagged → one repair re-prompt (reuses retry machinery) → still-flagged → discard with envelope evidence. Metrics: repair/discard counts in report.
5. **Closure (lead)**: push all commits to PR #1 + rewrite PR body (wave-4/5 narrative, AC2 render results, provider-degeneracy finding); verifier pass over the new items; final AC1/AC2 status report; re-record demo during a live run (battery-gated scheduling); Chris-package summary (one-pager + video + report.md).

## Acceptance Criteria

- [ ] AC-B: battery fires on all nine replayed degenerate fixtures, passes healthy-turn fixtures; policy table unit-tested; runs non-blocking (no added turn latency in the hot path).
- [ ] AC-T: triage classifier validated n≥20 at ≥90% vs labeled ground truth before becoming default (else stays behind the interface).
- [ ] AC-S: spot-check maintained ≥90% with the uncertain band; abstentions converted to escalations (count reported).
- [ ] AC-V: verdict battery wired; repair-or-discard decisions present in the envelope stream; `bun test` + `tsc` green throughout.
- [ ] AC-C: PR #1 updated with all commits + narrative; final AC1/AC2 report delivered; demo video captured during a live run with lifecycle headline + cost columns visible.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Provider window dies mid-demo-record | Battery-gated scheduling (item 1 enables it); retry within the wave; fallback: record from a replayed flow history |
| worker-1d leaves overlapping uncommitted state | Gate step 0 audits; wave starts from its final commit only |
| Jev call cost in per-turn battery | Post-turn async; cache; nouls are ~$0.00004/call class |
| Triage validation set is expensive to hand-label | Label from cx-5d/p4-7 real failures already in evidence dirs |
| Scope creep into Tier-2 | Tier-2 explicitly out of scope this wave |

## ADR

*(finalized after consensus)*

## Changelog

- v1: initial Planner snapshot.
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

2026-09-26T19:07:29.545649Z ERROR codex_core::tools::router: error=collab spawn failed: no thread with id: 01a0df1d-5cbd-7020-8067-dfc4a68108e1
exec
/bin/zsh -lc "sed -n '598,685p' BUILD_NOTES.md; sed -n '1,220p' src/typesafe/client.ts; sed -n '1,240p' src/harness/opencode.ts; sed -n '1,220p' src/queues/vitest-queue.ts; sed -n '1,220p' src/typesafe/symbol-types.ts; rg -n \"FailureClassifier|envelope stream|record'|role.*record|repair|retry|verdict|confidence\" src/harness/runtime.ts src/harness/agents/verdict-schema.ts src/queues src/typesafe scripts/run-demo.ts" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 exited 2 in 0ms:
## The blocker — provider-side degenerate reviewer turns

Signature (unchanged all wave): assistant message "completes" with 0–16
output tokens, NO text part, ~32k reasoning → verdict-JSON parse fails → dex
burns 3 attempts → FLOW_FAILED. See "Infra finding" section above for the
full characterization (cache amplification, window behavior, probe-validity
note, what worked). Healthy windows exist but last 30–90 min; a full run
needs ~75+ min of mostly-healthy provider with ~10–14 review turns.

## Per-flow failure narrative (chronological)

| Flow | Config | Outcome | Signature / evidence |
|---|---|---|---|
| p4-7 | plan-agent → **Sisyphus** reviewer, maxRounds 2 | **COMPLETED** | the green run above |
| p4-8 | + fault `queue-verify:inject-error:seed` | FAILED 11:27 | prep review-B 3/3 degenerate (out 3/0/3); never reached queue phase. `dexcli flow history p4-8` |
| p4-9 | same, after 1-probe health gate | FAILED 12:45 | absorbed 2 degenerates (retry-note successes), died at prep review-A attempt 3 (out 3) |
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
/**
 * Vendor-thin seam over the TypeSafe JavaScript SDK (@typesafe-ai/sdk, Jev /
 * System One). Everything downstream (symbol-types, verdict-check, prioritize,
 * tests) depends ONLY on this module's types and the `JudgmentClient`
 * interface — never on the SDK directly.
 *
 * - The REAL client (`createRealJevClient`) dynamically imports
 *   `@typesafe-ai/sdk`, reads the API key from the TYPESAFE_API_KEY env var
 *   only (never hardcoded), and adapts the SDK's `systemOne` to the seam.
 * - The IN-MEMORY double (`createInMemoryJevClient`) answers from a scripted
 *   responder: deterministic, offline, and used by all unit tests. With no
 *   responder it throws — it never fabricates judgments silently.
 * - `createJevClient()` is the env-aware factory: TYPESAFE_OFFLINE=1 forces
 *   the in-memory double so real network calls are skippable in tests/CI.
 */

// ---- seam types (structural mirrors of @typesafe-ai/sdk 0.6.0) ---------------

/** A JSON-compatible value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Text, a JSON object or array, or null — for state, instructions, criteria. */
export type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null;

/** A yes/no question; the answer is the probability of "yes". */
export interface NoulQuestion {
  type: "noul";
  instructions?: EntryType;
  criteria?: { true?: EntryType; false?: EntryType } | null;
}

/** Labels mapped to descriptions. */
export type ChoiceCriteria = { [label: string]: EntryType };

/** A question that selects between named alternatives. */
export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  type: "choice";
  instructions?: EntryType;
  criteria: T;
}

/** A question that assigns a score on an ordered rubric (>= 2 levels). */
export type ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]];

export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
  type: "score";
  instructions?: EntryType;
  criteria: T;
}

export type Question = NoulQuestion | ScoreQuestion | ChoiceQuestion;

export interface Questions {
  [name: string]: Question;
}

export interface NoulResponse {
  readonly type: "noul";
  /** Probability of a yes answer, 0..1. */
  readonly noul: number;
}

export interface ChoiceResponse<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "choice";
  readonly choice: keyof T & string;
  readonly confidence: number;
  readonly probabilities: { readonly [K in keyof T]: number };
}

export interface ScoreResponse {
  readonly type: "score";
  readonly score: number;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export type ResultFor<Q extends Question> = Q extends NoulQuestion
  ? NoulResponse
  : Q extends ScoreQuestion
    ? ScoreResponse
    : Q extends ChoiceQuestion<infer C>
      ? ChoiceResponse<C>
      : never;

export interface Usage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export interface SystemOneRequest<Q extends Questions = Questions> {
  state: EntryType;
  questions: Q;
  model?: string;
}

export interface SystemOneResult<Q extends Questions = Questions> {
  readonly model: string;
  readonly answers: { readonly [K in keyof Q]: ResultFor<Q[K]> };
  readonly usage: Usage;
}

// ---- question builders (same shape as the SDK's choice/noul/score) -----------

export function noul(
  instructions?: EntryType,
  criteria?: { true?: EntryType; false?: EntryType } | null,
): NoulQuestion {
  // exactOptionalPropertyTypes: omit the key instead of passing undefined.
  return {
    type: "noul",
    ...(instructions === undefined ? {} : { instructions }),
    criteria: criteria ?? null,
  };
}

export function choice<const T extends ChoiceCriteria>(
  instructions: EntryType,
  criteria: T,
): ChoiceQuestion<T> {
  return { type: "choice", instructions, criteria };
}

export function score<const T extends ScoreCriteria>(
  instructions: EntryType,
  criteria: T,
): ScoreQuestion<T> {
  return { type: "score", instructions, criteria };
}

// ---- the seam ------------------------------------------------------------------

/**
 * Vendor-neutral judgment client. The ONLY TypeSafe surface other modules see.
 * `inputTokens`/`outputTokens` are OPTIONAL cumulative diagnostics over this
 * client's own calls (delegating wrappers omit them — the wrapped client
 * carries the totals). The canonical implementations — the in-memory double
 * and the real SDK adapter — always provide them so judgment-role envelopes
 * keep token provenance offline.
 */
export interface JudgmentClient {
  readonly kind: "real" | "in-memory";
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  systemOne<const Q extends Questions>(request: SystemOneRequest<Q>): Promise<SystemOneResult<Q>>;
}

// ---- env handling ---------------------------------------------------------------

/** Env var names. The API key comes from TYPESAFE_API_KEY only — never from code. */
export const TYPESAFE_ENV_VARS = {
  apiKey: "TYPESAFE_API_KEY",
  offline: "TYPESAFE_OFFLINE",
  baseURL: "TYPESAFE_BASE_URL",
  defaultModel: "TYPESAFE_DEFAULT_MODEL",
} as const;

/**
 * Read an env var without importing node typings (this slice must typecheck
 * standalone before the repo-root toolchain lands). Bun/Node both expose
 * `process` on globalThis.
 */
function readEnv(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
}

/**
 * True when TYPESAFE_OFFLINE is set to anything truthy (1, true, yes...).
 * "0", "false", "" and unset count as online. Offline mode forces the
 * in-memory double so tests never touch the network.
 */
export function isTypesafeOffline(): boolean {
  const v = readEnv(TYPESAFE_ENV_VARS.offline);
  if (v === undefined || v === "" || v === "0") return false;
  return v.toLowerCase() !== "false";
}

/** Raised when the real client is requested without an API key. */
export class JevConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevConfigError";
  }
}

// ---- in-memory test double --------------------------------------------------------

/**
 * Scripted responder: given a request, return raw answer payloads keyed by
 * question name (same shapes as the SDK's NoulResponse/ChoiceResponse).
 */
export type InMemoryResponder = (
  request: SystemOneRequest<Questions>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * Deterministic, offline JudgmentClient. Records every request for
 * assertions and counts token usage with a fixed per-question rule.
 * Without a responder, calling it throws — judgments are never faked silently.
 */
export class InMemoryJudgmentClient implements JudgmentClient {
  readonly kind = "in-memory" as const;
  readonly requests: SystemOneRequest<Questions>[] = [];
  inputTokens = 0;
  outputTokens = 0;

  constructor(private readonly respond?: InMemoryResponder) {}

  get callCount(): number {
    return this.requests.length;
  }

  async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>): Promise<SystemOneResult<Q>> {
    this.requests.push(request);
    if (!this.respond) {
      throw new Error(
        "InMemoryJudgmentClient has no scripted responder; pass one to createInMemoryJevClient()",
      );
    }
    const scripted = await this.respond(request);
/**
 * Seam over the opencode server (@opencode-ai/sdk) — sessions, token usage,
 * abort, and the session-fencing primitives.
 *
 * opencode is pre-release: this module is the single place that touches its
 * SDK; exact version pinned in package.json and matched to the installed CLI.
 *
 * Fencing rule (plan §State ownership): every agent step persists its
 * opencode session ID (epoch-tagged label) to a DURABLE ATTRIBUTE BEFORE
 * prompting. Ordered recovery: epoch bump → abort+confirm persisted session
 * (or enumeration fallback) → lease reclaim → reconcile → re-dispatch.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { AttributeMap, jsonCodec } from "@superdurable/dex";

// ---------------------------------------------------------------------------
// Durable session-fence attribute (source of truth for fencing)
// ---------------------------------------------------------------------------

export interface SessionFence {
  /** opencode session ID persisted BEFORE the first prompt is sent. */
  sessionId: string;
  /** Owning step ID (agent step that created the session). */
  stepId: string;
  /** Fencing epoch at creation time. */
  epoch: number;
  /** Human-auditable epoch-tagged label: `porting-kit:<file>#<round>#<epoch>`. */
  label: string;
  persistedAtUtc: string;
}

/** AttributeMap instance; flows must include it via persistenceAttributes(). */
export const sessionFenceMap = new AttributeMap<SessionFence>(
  "session-fence",
  jsonCodec<SessionFence>(),
);

/** AttributeMap instance keys prohibit `/`, so file paths are sanitized. */
export function fenceLabel(file: string, round: number, epoch: number): string {
  return `porting-kit:${file.replace(/\//g, "__")}#${round}#${epoch}`;
}

// ---------------------------------------------------------------------------
// Token usage (required for model-calling steps; provenance failure if absent)
// ---------------------------------------------------------------------------

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export function tokenTotal(usage: TokenUsage): number {
  return usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export interface PromptResult {
  text: string;
  usage: TokenUsage | null;
  aborted: boolean;
}

export interface PromptOptions {
  /**
   * Per-tool overrides merged into the prompt body (opencode `tools` map).
   * The harness bridge passes DENY-authoritative maps so reviewer turns run
   * with every tool disabled SERVER-SIDE, not just in the prompt text.
   */
  tools?: Record<string, boolean>;
  /** opencode agent name; defaults to OPENCODE_AGENT env or server default. */
  agent?: string;
  /**
   * Per-turn model override (lane swap, wave-5): when set, THIS turn runs on
   * the given provider/model instead of the harness default — e.g. reviewer
   * turns on `openai/gpt-6-luna` while implementer/fixer stay on the default
   * zai lane. Takes precedence over the constructor model.
   */
  model?: { providerID: string; modelID: string };
}

/** How long prompt() polls for a completed assistant reply (0(g) provenance). */
const PROMPT_WAIT_MS = parseWaitMs(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.OPENCODE_PROMPT_WAIT_MS,
);

/** m4: invalid values (NaN, ≤0, absurdly large) fall back to 15 minutes. */
function parseWaitMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24 * 60 * 60_000) {
    return 900_000;
  }
  return parsed;
}

/**
 * Hard ceiling on ONE SDK prompt call (live finding, worker-1c 2026-09-26):
 * opencode can hold the session.prompt HTTP call open indefinitely after the
 * assistant message has completed server-side — the turn hangs, heartbeats
 * keep the step alive, and the flow stalls. Race the call against this
 * deadline and fail RETRYABLE so dex re-dispatches on a fresh attempt.
 * OPENCODE_PROMPT_CALL_TIMEOUT_MS; default 20 minutes.
 */
const PROMPT_CALL_TIMEOUT_MS = parseWaitMs(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.OPENCODE_PROMPT_CALL_TIMEOUT_MS,
) *  (4 / 3); // 20 min default (parseWaitMs falls back to 15 min; ×4/3 = 20)

/** Races one promise against the prompt-call deadline (retryable timeout). */
function withCallTimeout<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      const t = setTimeout(
        () => reject(new OpencodePromptError(`SDK call timed out after ${PROMPT_CALL_TIMEOUT_MS}ms (${what})`, true)),
        PROMPT_CALL_TIMEOUT_MS,
      );
      void (t as unknown as { unref?: () => void }).unref?.();
    }),
  ]);
}

/**
 * Typed failure for one prompt turn. `retryable` failures (upstream aborts,
 * empty native-tool replies) should be retried on a FRESH session by the
 * caller (dex step retry); non-retryable means the reply completed but
 * carried no usage — a provenance failure for model-calling steps.
 */
export class OpencodePromptError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "OpencodePromptError";
    this.retryable = retryable;
  }
}

/**
 * Extracts the upstream error of an assistant message, if any.
 * ODW finding (live-verified): session.prompt RESOLVES (does not throw) with
 * info.error set when the upstream provider fails — callers must check.
 */
function upstreamErrorOf(info: unknown): string | null {
  if (typeof info !== "object" || info === null) return null;
  const err = (info as { error?: unknown }).error;
  if (err === undefined || err === null) return null;
  const e = err as { name?: unknown; message?: unknown };
  const name = typeof e.name === "string" ? e.name : "UnknownError";
  const message = typeof e.message === "string" ? e.message : "";
  return message.length > 0 ? `${name}: ${message}` : name;
}

export interface SessionRef {
  id: string;
  title: string;
}

export const DEFAULT_OPENCODE_BASE_URL = "http://127.0.0.1:4096";

/**
 * Structural interface used by durable agent steps, so flows can run against
 * the real harness or an explicit test double (never silently).
 */
export interface AgentSessionClient {
  createSession(label: string): Promise<SessionRef>;
  prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult>;
  /** Enumeration fallback orchestration used by ordered recovery. */
  abortSessionsNotTagged(epoch: number): Promise<string[]>;
}

export class OpencodeHarness {
  readonly #client: OpencodeClient;
  readonly #model: { providerID: string; modelID: string } | undefined;
  /** Default opencode agent for turns (OPENCODE_AGENT env), if configured. */
  readonly defaultAgent: string | undefined;

  constructor(
    client: OpencodeClient,
    model?: { providerID: string; modelID: string } | undefined,
    defaultAgent?: string | undefined,
  ) {
    this.#client = client;
    this.#model = model;
    this.defaultAgent = defaultAgent;
  }

  static async connect(
    baseUrl: string = DEFAULT_OPENCODE_BASE_URL,
    model?: { providerID: string; modelID: string } | undefined,
  ): Promise<OpencodeHarness> {
    const client = createOpencodeClient({ baseUrl } as never);
    const defaultAgent = readEnvVar("OPENCODE_AGENT");
    return new OpencodeHarness(client, model, defaultAgent);
  }

  /** Creates a session with an epoch-tagged label as its title (fencing tag). */
  async createSession(label: string): Promise<SessionRef> {
    const res = await this.#client.session.create({
      body: { title: label },
    });
    const session = unwrap<{ id?: string; title?: string } | undefined>(res);
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

  let current: { record: VitestFailureRecord; messageLines: string[] } | null =
    null;

  const flush = () => {
    if (current) {
      current.record.errorMessage = current.messageLines.join("\n");
      failures.push(current.record);
      current = null;
    }
  };

  for (const line of clean.split("\n")) {
    if (SUMMARY_START.test(line)) {
      flush();
      continue;
    }
    if (RECORD_START.test(line)) {
      flush();
      current = { record: parseFailHeader(line), messageLines: [] };
      continue;
    }
    if (!current) {
      continue; // banner / passed-test noise before any failure
    }
    if (isStackFrameLine(line)) {
      const frame = parseStackFrame(line);
      if (frame) {
        current.record.frames.push(frame);
        continue;
      }
    }
    if (line.trim() !== "") {
      current.messageLines.push(line);
    }
  }
  flush();
  return failures;
}

/** `FAIL  tests/foo.test.ts > Suite > test name` → {testFile, testName}. */
function parseFailHeader(line: string): VitestFailureRecord {
  const rest = line.trim().replace(/^(?:FAIL|[✗×])\s+/, "");
  const separatorIndex = rest.indexOf(" > ");
  if (separatorIndex < 0) {
    return {
      testFile: rest,
      testName: "",
      errorMessage: "",
      frames: [],
      raw: line,
    };
  }
  return {
    testFile: rest.slice(0, separatorIndex),
    testName: rest.slice(separatorIndex + 3),
    errorMessage: "",
    frames: [],
    raw: line,
  };
}

function isStackFrameLine(line: string): boolean {
  return STACK_FRAME_LINE.test(line);
}

function parseStackFrame(line: string): StackFrame | null {
  const tail = STACK_FRAME_LINE.exec(line);
  if (!tail) {
    return null;
  }
  const tailText = tail[1];
  if (tailText === undefined) {
    return null;
  }
  const matches = [...tailText.matchAll(FILE_LINE_COL)];
  const last = matches[matches.length - 1];
  if (!last) {
    return null;
  }
  const rawFile = last[1];
  const rawLine = last[2];
  const rawColumn = last[3];
  if (rawFile === undefined || rawLine === undefined || rawColumn === undefined) {
    return null;
  }
  return {
    file: rawFile,
    line: Number(rawLine),
    column: Number(rawColumn),
  };
}

/** Build durable queue state from parsed failures. */
export function buildVitestQueueState(
  failures: readonly VitestFailureRecord[],
  iteration: number,
): VitestQueueState {
  return {
    kind: "vitest-queue",
    iteration,
    total: failures.length,
    failures: [...failures],
  };
}

// ---------------------------------------------------------------------------
// Naive classifier (code-only default behind the FailureClassifier seam)
// ---------------------------------------------------------------------------

export interface NaiveClassifierOptions {
  /** Path prefixes that belong to the ported TS output. Default: ["src"]. */
  portedRoots?: readonly string[];
  /** Path prefixes belonging to fixture/test-harness files. */
  fixtureRoots?: readonly string[];
  /**
    * Class assigned when no frame matches any known root. Default:
    * "port-caused" — unattributable failures stay visible to the fix loop
    * instead of silently vanishing into the fixture bucket.
    */
  unknown?: FailureClass;
}

export const DEFAULT_PORTED_ROOTS: readonly string[] = ["src"];
export const DEFAULT_FIXTURE_ROOTS: readonly string[] = [
  "tests",
  "test",
  "__tests__",
  "fixtures",
];

/**
 * Per-symbol TS-type selection (plan TypeSafe integration point 1).
 *
 * 1. CODE RECALL (pure code, no model): gather candidate TypeScript types for
 *    a PHP symbol from docblock hints, declared signature types (params,
 *    returns, properties), signature default literals, and observed literal
 *    usages — regex/tokenizer only, mapped through a PHP-doc -> TS type map.
 * 2. SELECTION: a TypeSafe Choice question whose options ARE the candidates
 *    (+ a NONE escape) picks the intended type.
 * 3. VERIFICATION CASCADE (SDE shape): four nouls — type_mismatch,
 *    hallucinated, unreasonable, absence_wrong — gate the selection. Any noul
 *    scoring below the escalation threshold flags the symbol.
 * 4. ESCALATION: flagged symbols (including the NONE escape and empty recall)
 *    return escalation records — the CALLER decides (plan: escalate to the
 *    implementer agent).
 */
import { choice, noul, type ChoiceCriteria, type ChoiceResponse, type JudgmentClient } from "./client.js";

// ---- inputs -----------------------------------------------------------------

export type PhpSymbolKind =
  | "function"
  | "method"
  | "property"
  | "parameter"
  | "variable"
  | "class"
  | "constant";

/** A PHP symbol extracted by the prep-analysis phase (read-only input). */
export interface PhpSymbol {
  name: string;
  kind: PhpSymbolKind;
  file: string;
  /** Raw signature line, e.g. `function countItems(array $items): int`. */
  signature: string;
  /** Raw docblock text (without delimiters is fine); null when absent. */
  docblock: string | null;
  /** Literal values observed at usages, e.g. `"42"`, `'"abc"'`, `"true"`. */
  literal_usages: readonly string[];
}

// ---- recall -------------------------------------------------------------------

export type CandidateOrigin = "docblock" | "signature" | "literal";

export interface TsTypeCandidate {
  type: string;
  origin: CandidateOrigin;
}

export interface RecallResult {
  candidates: TsTypeCandidate[];
}

/**
 * PHPDoc/PHP type hint -> TypeScript type. Handles nullable (`?T`), unions,
 * indexed sugar (`T[]`), common generics (`array<K,V>`, `list<T>`,
 * `iterable<T>`), PHPDoc keywords, and class-name passthrough (last
 * namespace segment).
 */
export function phpTypeToTsType(phpType: string): string {
  const t = phpType.trim();
  if (t === "") return "unknown";
  if (t.startsWith("?")) return `${phpTypeToTsType(t.slice(1))} | null`;

  const unionParts = splitTopLevel(t, "|");
  if (unionParts.length > 1) {
    return uniqueInOrder(unionParts.map((p) => phpTypeToTsType(p))).join(" | ");
  }
  if (t.endsWith("[]")) return `${phpTypeToTsType(t.slice(0, -2))}[]`;

  const genericStart = t.indexOf("<");
  if (genericStart > 0 && t.endsWith(">")) {
    const head = t.slice(0, genericStart).trim().toLowerCase();
    const args = splitTopLevel(t.slice(genericStart + 1, -1), ",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    if (head === "array" || head === "list" || head === "iterable") {
      const firstArg = args[0];
      if (args.length === 1 && firstArg !== undefined) return `${phpTypeToTsType(firstArg)}[]`;
      return "unknown[]";
    }
    return t; // unknown generic class: passthrough
  }

  const simple = PHP_TYPE_TO_TS[t.toLowerCase()];
  if (simple !== undefined) return simple;
  const segments = t.split("\\");
  return segments[segments.length - 1] ?? t;
}

const PHP_TYPE_TO_TS: Readonly<Record<string, string>> = {
  int: "number",
  integer: "number",
  long: "number",
  float: "number",
  double: "number",
  real: "number",
  number: "number",
  numeric: "number",
  string: "string",
  bool: "boolean",
  boolean: "boolean",
  true: "true",
  false: "false",
  null: "null",
  mixed: "unknown",
  array: "unknown[]",
  list: "unknown[]",
  iterable: "unknown[]",
  callable: "(...args: unknown[]) => unknown",
  object: "Record<string, unknown>",
  scalar: "string | number",
  void: "void",
  self: "self",
  static: "static",
};

/** Classify one PHP literal (source text) into a TS type; null when unrecognizable. */
export function literalTypeToTs(literal: string): string | null {
  const t = literal.trim();
  if (/^-?\d+$/.test(t) || /^-?\d+\.\d+$/.test(t)) return "number";
  if (t === "true" || t === "false") return "boolean";
  if (t === "null") return "null";
  if (t.length >= 2 && /^["']/.test(t) && /["']$/.test(t)) return "string";
  if (t.startsWith("[") && t.endsWith("]")) return "unknown[]";
  return null;
}

/** Split on `sep` only at angle-bracket/paren depth 0 (for unions and generics). */
function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of input) {
    if (ch === "<" || ch === "(") depth++;
    else if (ch === ">" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Code recall: candidate TS types for a symbol, deduplicated preserving
 * first-seen order across sources in this order: docblock hints, signature
 * declared types (+ signature default literals), observed literal usages.
 */
export function recallCandidates(symbol: PhpSymbol): RecallResult {
  const candidates: TsTypeCandidate[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined, origin: CandidateOrigin): void => {
    if (raw === null || raw === undefined) return;
    const type = phpTypeToTsType(raw);
    if (type.trim() === "" || seen.has(type)) return;
    seen.add(type);
    candidates.push({ type, origin });
  };

  // 1. docblock hints: @param {int} $x / @param int $x / @return int[] / @var float
  for (const m of symbol.docblock?.matchAll(/@(?:param|return|var)\s+(?:\{([^}]+)\}|([^\s$]+))/g) ??
    []) {
    push(m[1] ?? m[2], "docblock");
  }

  // 2. signature declared types: "?Type $name", "Type $name", return after "): Type"
  for (const m of symbol.signature.matchAll(/(\??[A-Za-z_][\w\\|<>[\]]*)\s+\$[A-Za-z_]\w*/g)) {
    push(m[1], "signature");
  }
  const returnType = symbol.signature.match(/\)\s*:\s*(\??[A-Za-z_][\w\\<>[\]|]*)\s*(?:\{|;|$)/);
  if (returnType) push(returnType[1], "signature");

  // 3. signature default literals: `$x = 10,` / `$x = 'a')`
  for (const m of symbol.signature.matchAll(
    /=\s*(-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|null)\s*[,)]/g,
  )) {
    const literal = m[1];
    if (literal !== undefined) push(literalTypeToTs(literal), "literal");
  }

  // 4. observed literal usages
  for (const lit of symbol.literal_usages) {
    push(literalTypeToTs(lit), "literal");
  }

  return { candidates };
}

// ---- selection + verification cascade ------------------------------------------

export type VerificationCheck = "type_mismatch" | "hallucinated" | "unreasonable" | "absence_wrong";

export const VERIFICATION_CHECKS: readonly VerificationCheck[] = [
  "type_mismatch",
  "hallucinated",
  "unreasonable",
  "absence_wrong",
];

export type EscalationCheck = VerificationCheck | "recall_empty" | "none_selected";

rg: src/harness/agents/verdict-schema.ts: No such file or directory (os error 2)
scripts/run-demo.ts:375: *   Jev-live + the n≥30 spot-check); verdict-check/prioritize stay NAIVE.
src/harness/runtime.ts:4: * (src/harness/opencode.ts), and owns the diff/verdict plumbing of the
src/harness/runtime.ts:14: * - verdict intake: extract the reviewer's JSON object, validate it against
src/harness/runtime.ts:15: *   the verdict schema (harness/agents/verdict-schema.ts), and map it onto
src/harness/runtime.ts:32:} from "../../harness/agents/verdict-schema.js";
src/harness/runtime.ts:317: * verdict.
src/harness/runtime.ts:377: * Validates the reviewer's raw verdict and maps it onto the metrics event
src/harness/runtime.ts:477:    `Reviewer id: ${input.reviewerId} (use exactly this value as "reviewer" in your verdict).`,
src/harness/runtime.ts:478:    "Review the diff below and emit your verdict JSON per your standing instructions.",
src/harness/runtime.ts:635:      answers[name] = { type: "choice", choice: pick, confidence: 0.9, probabilities };
src/typesafe/client.ts:3: * System One). Everything downstream (symbol-types, verdict-check, prioritize,
src/typesafe/client.ts:66:  readonly confidence: number;
src/typesafe/client.ts:73:  readonly confidence: number;
src/typesafe/symbol-types.ts:246:  choice_confidence: number | null;
src/typesafe/symbol-types.ts:280:      choice_confidence: null,
src/typesafe/symbol-types.ts:334:      choice_confidence: picked.confidence,
src/typesafe/symbol-types.ts:341:          p: picked.confidence,
src/typesafe/symbol-types.ts:393:    choice_confidence: picked.confidence,
src/queues/vitest-queue.test.ts:11:  type FailureClassifier,
src/queues/vitest-queue.test.ts:154:    const classifier: FailureClassifier = { classify: () => alwaysFixture };
src/queues/vitest-queue.test.ts:159:      "the FailureClassifier seam accepts any implementation",
src/typesafe/client.test.ts:28:      b: { type: "choice", choice: "x", confidence: 0.8, probabilities: { x: 0.8, y: 0.2 } },
src/typesafe/verdict-check.ts:5: * `{finding_id, p_cited}` per finding (matching the verdict record's
src/typesafe/verdict-check.ts:50:export function naiveCitationCheck(verdict: VerdictRecord, diff: DiffDocument): CitationCheckResult[] {
src/typesafe/verdict-check.ts:51:  return verdict.findings.map((finding) => ({
src/typesafe/verdict-check.ts:64: * Output preserves verdict.findings order.
src/typesafe/verdict-check.ts:68:  verdict: VerdictRecord,
src/typesafe/verdict-check.ts:74:  for (const finding of verdict.findings) {
src/typesafe/verdict-check.ts:87:    return verdict.findings.map((finding) => ({ finding_id: finding.finding_id, p_cited: 0 }));
src/typesafe/verdict-check.ts:104:  return verdict.findings.map((finding) => {
src/typesafe/verdict-check.ts:119:  check(verdict: VerdictRecord, diff: DiffDocument): Promise<CitationCheckResult[]>;
src/typesafe/verdict-check.ts:129:      async check(verdict, diff) {
src/typesafe/verdict-check.ts:130:        return naiveCitationCheck(verdict, diff);
src/typesafe/verdict-check.ts:136:    async check(verdict, diff) {
src/typesafe/verdict-check.ts:137:      return jevCitationCheck(client, verdict, diff);
src/queues/vitest-queue.ts:53:export interface FailureClassifier {
src/queues/vitest-queue.ts:197:// Naive classifier (code-only default behind the FailureClassifier seam)
src/queues/vitest-queue.ts:230:): FailureClassifier {
src/typesafe/verdict-check.test.ts:8:} from "./verdict-check.js";
src/typesafe/verdict-check.test.ts:44:function verdictWith(findings: Finding[]): VerdictRecord {
src/typesafe/verdict-check.test.ts:67:    const v = verdictWith([
src/typesafe/verdict-check.test.ts:79:    const v = verdictWith([
src/typesafe/verdict-check.test.ts:96:    const v = verdictWith([
src/typesafe/verdict-check.test.ts:108:    const v = verdictWith([{ finding_id: "F4", severity: "nit", summary: "vague", evidence: null }]);
src/typesafe/verdict-check.test.ts:113:    const v = verdictWith([
src/typesafe/verdict-check.test.ts:127:    const v = verdictWith([
src/typesafe/verdict-check.test.ts:156:    const v = verdictWith([{ finding_id: "F9", severity: "nit", summary: "vague", evidence: null }]);
src/typesafe/verdict-check.test.ts:170:    const v = verdictWith([
src/typesafe/prioritize.ts:12: * Precondition: finding_ids are unique within a batch (verdict schema).
src/typesafe/symbol-types.test.ts:99:          type_selection: { type: "choice", choice: "number", confidence: 0.93, probabilities: { number: 0.93, NONE: 0.07 } },
src/typesafe/symbol-types.test.ts:127:        return { type_selection: { type: "choice", choice: "string", confidence: 0.6, probabilities: { string: 0.6 } } };
src/typesafe/symbol-types.test.ts:151:      type_selection: { type: "choice", choice: "NONE", confidence: 0.55, probabilities: { NONE: 0.55 } },
src/typesafe/symbol-types.test.ts:187:        return { type_selection: { type: "choice", choice: "number", confidence: 0.9, probabilities: { number: 0.9 } } };
src/queues/tsc-queue.ts:83: * of the previous record's message (tsc emits indented detail lines for

exec
/bin/zsh -lc "sed -n '45,80p' src/queues/vitest-queue.ts; sed -n '220,330p' src/queues/vitest-queue.ts; rg -n \"function.*turn|assistant|reasoning|text|messages|PromptResult|record.*role|role: \\\"record\\\"|createRealJevClient|systemOne\\(\" src/harness/opencode.ts src/harness/runtime.ts src/typesafe; sed -n '350,455p' src/harness/runtime.ts; rg --files | rg 'verdict-schema|run-demo|turn-health|vitest-queue.test'" in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
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
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}
src/harness/runtime.ts:66: * (false). Reviewers come out all-false — server-side, not just prompt text.
src/harness/runtime.ts:110:    "- Everything you need is inside this prompt; answer in your reply text.",
src/harness/runtime.ts:117: * on a read-only/text-only agent (e.g. opencode's "plan") in addition to the
src/harness/runtime.ts:130: * events can carry the full provider-reported cache/reasoning split + USD
src/harness/runtime.ts:136:  reasoning: number;
src/harness/runtime.ts:144:    reasoning_tokens: u.reasoning,
src/harness/runtime.ts:205: * diff attribute stores only JSON-safe parts (raw text + doc); the index is
src/harness/runtime.ts:282:  // else a hunk whose text contains the snippet, else a required hit anywhere
src/harness/runtime.ts:319:export function extractJsonObject(text: string): unknown {
src/harness/runtime.ts:320:  const fenced = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/.exec(text);
src/harness/runtime.ts:323:  const start = text.indexOf("{");
src/harness/runtime.ts:328:    for (let i = start; i < text.length; i++) {
src/harness/runtime.ts:329:      const ch = text[i];
src/harness/runtime.ts:344:          candidates.push(text.slice(start, i + 1));
src/harness/runtime.ts:361:export function extractCodeFence(text: string, hint = ""): string {
src/harness/runtime.ts:370:    const m = re.exec(text);
src/harness/runtime.ts:441:// Turn composition (per-agent user messages)
src/harness/opencode.ts:51:  reasoning: number;
src/harness/opencode.ts:58:  return usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;
src/harness/opencode.ts:65:export interface PromptResult {
src/harness/opencode.ts:66:  text: string;
src/harness/opencode.ts:75:   * with every tool disabled SERVER-SIDE, not just in the prompt text.
src/harness/opencode.ts:89:/** How long prompt() polls for a completed assistant reply (0(g) provenance). */
src/harness/opencode.ts:107: * assistant message has completed server-side — the turn hangs, heartbeats
src/harness/opencode.ts:147: * Extracts the upstream error of an assistant message, if any.
src/harness/opencode.ts:174:  prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult>;
src/harness/opencode.ts:217:   * Sends one prompt and waits for the assistant reply. Returns extracted
src/harness/opencode.ts:222:   * model is still working (queued or long-reasoning turns) with a payload
src/harness/opencode.ts:224:   * messages until the assistant reply completes (or aborts) instead of
src/harness/opencode.ts:227:  async prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult> {
src/harness/opencode.ts:237:          parts: [{ type: "text", text }],
src/harness/opencode.ts:256:    let textOut = extractText(data.parts);
src/harness/opencode.ts:268:          console.error(`[opencode] poll ${polls} (session=${sessionId}) messages error: ${(err as Error).message}`);
src/harness/opencode.ts:273:            `[opencode] poll ${polls} (session=${sessionId}) last=${last === undefined ? "none" : "assistant-present"} usage=${JSON.stringify(usage)} deadline-in=${Math.round((deadline - Date.now()) / 1000)}s`,
src/harness/opencode.ts:284:        if (completed.length > 0) textOut = completed;
src/harness/opencode.ts:290:        if (textOut.length === 0) {
src/harness/opencode.ts:296:        return { text: textOut, usage: null, aborted: false };
src/harness/opencode.ts:299:    return { text: textOut, usage, aborted };
src/harness/opencode.ts:302:  /** Newest assistant message of a session, or undefined when none exists. */
src/harness/opencode.ts:304:    const res = await this.#client.session.messages({ path: { id: sessionId } } as never);
src/harness/opencode.ts:308:      : (data as { messages?: unknown[] } | undefined)?.messages;
src/harness/opencode.ts:313:      if (info.role === "assistant") {
src/harness/opencode.ts:393:/** Narrows the assistant message's token fields; null when not exposed. */
src/harness/opencode.ts:401:    reasoning?: unknown;
src/harness/opencode.ts:410:    reasoning: num(t.reasoning) ? t.reasoning : 0,
src/harness/opencode.ts:430:      (part as { type?: unknown }).type === "text" &&
src/harness/opencode.ts:431:      typeof (part as { text?: unknown }).text === "string"
src/harness/opencode.ts:433:      chunks.push((part as { text: string }).text);
src/typesafe/verdict-check.test.ts:57:    expect(normalizeForMatch("+  hello \n-  world \n context ")).toBe("hello\nworld\ncontext");
src/typesafe/verdict-check.test.ts:112:  test("claimed hunk missing from the diff -> p_cited 0 even if text matches", () => {
src/typesafe/symbol-types.ts:37:  /** Raw docblock text (without delimiters is fine); null when absent. */
src/typesafe/symbol-types.ts:120:/** Classify one PHP literal (source text) into a TS type; null when unrecognizable. */
src/typesafe/symbol-types.ts:315:  const selection = await client.systemOne({
src/typesafe/symbol-types.ts:352:  const cascade = await client.systemOne({
src/typesafe/symbol-types.ts:364:        `Is "${selectedType}" a reasonable type for ${symbol.name} (${symbol.kind}) given this code's context?`,
src/typesafe/client.test.ts:5:  createRealJevClient,
src/typesafe/client.test.ts:31:    const result = await client.systemOne({
src/typesafe/client.test.ts:32:      state: "state text",
src/typesafe/client.test.ts:44:    expect(client.requests[0]?.state).toBe("state text");
src/typesafe/client.test.ts:50:      client.systemOne({
src/typesafe/client.test.ts:60:      client.systemOne({ state: null, questions: { a: { type: "noul" } } }),
src/typesafe/client.test.ts:65:describe("createRealJevClient (env-only credentials, lazy SDK import)", () => {
src/typesafe/client.test.ts:71:      await expect(createRealJevClient()).rejects.toBeInstanceOf(JevConfigError);
src/typesafe/verdict-check.ts:10: *   substring match of the finding's evidence quote against the diff text;
src/typesafe/verdict-check.ts:23:export function normalizeForMatch(text: string): string {
src/typesafe/verdict-check.ts:24:  return text
src/typesafe/verdict-check.ts:31:/** Normalized text of the whole diff (all hunks, all lines, in order). */
src/typesafe/verdict-check.ts:47: * A finding passes iff its evidence quote appears in the diff text AND the
src/typesafe/verdict-check.ts:90:  const response = await client.systemOne({
src/typesafe/client.ts:7: * - The REAL client (`createRealJevClient`) dynamically imports
src/typesafe/client.ts:254:export async function createRealJevClient(config?: {
src/typesafe/client.ts:280:      const result = await client.systemOne(request);
src/typesafe/client.ts:303:  return createRealJevClient();
src/typesafe/prioritize.ts:62:  const response = await client.systemOne({
src/typesafe/symbol-types.test.ts:49:  test("classifies literal source text", () => {
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try next candidate
    }
  }
  throw new Error("no parseable JSON object in reply");
}

/** Extracts the complete ported file from a fenced code block. */
export function extractCodeFence(text: string, hint = ""): string {
  const patterns = [
    /```(?:typescript|ts)\s*\n([\s\S]*?)```/,
    hint.length > 0
      ? new RegExp(`\`\`\`(?:typescript|ts)?\\s*\\n([\\s\\S]*?\\.${hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?)\`\`\``)
      : /```[a-z]*\s*\n([\s\S]*?)```/,
    /```\s*\n([\s\S]*?)```/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1] !== undefined && m[1].trim().length > 0) return m[1].replace(/\s+$/, "") + "\n";
  }
  throw new Error("no fenced code block in reply");
}

/**
 * Validates the reviewer's raw verdict and maps it onto the metrics event
 * contract's VerdictRecord. Authoritative identity fields (file, reviewer,
 * round, diff_id) are FORCED from the pipeline values — the model's copies
 * are advisory. Findings whose citation_check entry is missing get one from
 * the naive citation check (the model's honest self-assessment is kept when
 * present).
 */
export function mapVerdictToMetrics(input: {
  raw: unknown;
  file: string;
  reviewer: string;
  round: number;
  diffId: string;
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  bodyLineOffset: number;
  naiveCited: (finding: MetricsFinding) => number;
}): { ok: true; record: MetricsVerdictRecord; agentRecord: AgentVerdictRecord } | { ok: false; errors: string[] } {
  const forced = {
    ...(typeof input.raw === "object" && input.raw !== null ? input.raw : {}),
    file: input.file,
    reviewer: input.reviewer,
    round: input.round,
    diff_id: input.diffId,
  };
  const result = validateVerdictRecord(forced);
  if (!result.ok) return { ok: false, errors: result.errors };

  const agentRecord = result.value;
  const citedById = new Map(agentRecord.citation_check.map((c) => [c.finding_id, c.p_cited]));

  const findings: MetricsFinding[] = [];
  for (const f of agentRecord.findings) {
    const evidence = resolveEvidence(f.evidence_span, input.parsedDiff, input.bodyLineOffset);
    const summary =
      f.disposition.length > 0
        ? f.disposition
        : f.evidence_span.snippet?.slice(0, 120) ?? "";
    findings.push({
      finding_id: f.finding_id,
      severity: f.severity,
      summary,
      evidence,
    });
  }

  const naive = input.naiveCited;
  return {
    ok: true,
    agentRecord,
    record: {
      file: input.file,
      reviewer: input.reviewer,
      round: input.round,
      diff_id: input.diffId,
      findings,
      citation_check: findings.map((f) => {
        const given = citedById.get(f.finding_id);
        return { finding_id: f.finding_id, p_cited: given ?? naive(f) };
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Turn composition (per-agent user messages)
// ---------------------------------------------------------------------------

export function composeImplementerTurn(input: {
  phpFileName: string;
  phpSource: string;
  prepExcerpt: string;
  outputPath: string;
}): string {
  return [
    `Port the PHP file \`${input.phpFileName}\` to TypeScript.`,
    "",
    "## Output path (write target, worktree-relative)",
    input.outputPath,
    "",
src/queues/vitest-queue.test.ts
scripts/run-demo.ts
harness/agents/verdict-schema.ts
harness/agents/verdict-schema.test.ts

codex
VERDICT: REVISE

REASONS:

1. **Steps 1 and 4 contradict the deterministic-core principle.** Step 1 says `dispatch gating reads [the turn-health assessment] before next turn`; Step 4 says a flagged verdict triggers a repair prompt and then discard. Both put Jev judgments on flow-control paths. The plan’s principle says “policy tables and thresholds live in tested code,” but a code policy table does not resolve the explicit constraint that judgment must not control flow. Define these judgments as advisory records and keep retry, fallback, defer, repair, and discard decisions deterministic from non-judgment signals—or revise the principle with an explicit, bounded exception.

2. **Step 1’s “post-turn, non-blocking” behavior conflicts with its gating behavior and AC-B.** The plan requires the assessment to be read before the next turn, while AC-B requires no added turn latency. A synchronous Jev call before dispatch blocks the next turn; an asynchronous call cannot gate that dispatch unless the dispatch waits for it. Specify the ordering and behavior when assessment is pending or fails, then make the latency criterion measurable.

3. **AC-B and Step 1 do not define a concrete, reproducible validation set.** The plan calls for “healthy turns from p4-7/cx-5d,” but BUILD_NOTES §WAVE-4 documents p4-7 and failures only through cx-4; it provides no cx-5d evidence. Nine labeled failure cases are documented, but the plan does not identify their fixture paths or define the health labels and expected policy outcomes. Name the actual fixtures and labels, and replace or substantiate the cx-5d reference.

4. **The criteria do not verify several promised behaviors end to end.** AC-B checks that fixtures fire or pass, but not whether the policy routes each result correctly or what happens when Jev fails. AC-V checks that repair/discard decisions appear in the envelope stream, but does not require tests for valid-but-suspicious verdicts, failed repairs, or preservation of evidence and authoritative identity. Add explicit routing and failure-path criteria and verification steps.

5. **The plan’s dependency and verification steps are underspecified for closure.** Step 5 says “verifier pass over the new items” without defining the verifier, the required commands, or which acceptance criteria it must check. “Push all commits to PR #1” and “final AC1/AC2 status report” likewise lack a specified push scope and report inputs. Define the verifier procedure and closure evidence so the executor can determine completion consistently.

REQUIRED_CHANGES:

1. Resolve the deterministic-core conflict explicitly. Keep Jev outputs out of flow-control decisions under the current stated principles, or amend the principle and bound the permitted control use. Apply the resolution consistently to turn-health routing and verdict repair/discard.

2. Reconcile “non-blocking” assessment with pre-dispatch gating. Specify whether the next dispatch waits, what happens on timeout/provider failure, and a testable latency bound or remove the no-added-latency criterion.

3. Correct the healthy-fixture reference and enumerate the nine degenerate fixtures, healthy fixtures, labels, expected results, and their repository paths.

4. Expand AC-B and AC-V to cover decision outcomes and failure paths, including Jev unavailability, repair failure, evidence retention, and authoritative verdict identity.

5. Specify concrete closure verification commands and artifacts, and define which commits are in scope for the PR update.

IMPROVEMENT_SUGGESTIONS:

1. For AC-T, state how the 20 triage cases are sampled and labeled, how agreement is calculated, and what happens if fewer than 20 labeled cases are available. Keep the classifier’s non-default status as the safe outcome unless the stated threshold is met.
hook: Stop
hook: Stop Completed
tokens used
42,368

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
