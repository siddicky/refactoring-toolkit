# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-09-26T19:26:39.113Z

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

1. Stage 2a puts a Jev judgment on a control-flow path. The plan says `classifyMany` writes a `failureClass` and the fix-round feed routes records to `attributedFile`. That classification determines which failures enter the port loop. This conflicts with Principle 1’s rule that “nothing in control flow reads” Jev outputs and Principle 3’s rule that code owns routing. The research input likewise describes Choice as selecting the causal frame and failure class. This is a design contradiction, not a missing test.

2. Principle 1’s citation-gate exception contradicts its absolute wording and the requested deterministic-core rule. The plan says the existing `p_cited < 1` gate “drops findings” and then declares it “not an exception.” Yet Stage 1 proposes running a Jev citation checker, and the existing verdict-check route branches on the resulting `keptCount` (`flows/port-project.ts:1039-1067, 1079-1087`). Calling the threshold deterministic does not make the judgment-derived input deterministic. The plan must explicitly reconcile this with its stated principle.

3. Stage 3’s verification does not fully establish the stream-bus acceptance criteria. AC-D requires that the dashboard render from the subscriber and the watcher fire once and exit cleanly, but the named verifier only says “dashboard subscriber smoke” and “watcher-subscriber fire-once test.” It does not specify a dashboard assertion that observes a published event, or a watcher assertion that verifies clean exit and no duplicate firing. Those checks could pass without demonstrating the stated end-to-end behavior.

REQUIRED_CHANGES:

1. Resolve the Stage 2a contradiction explicitly: either make vitest classification advisory evidence and keep feed selection/routing deterministic, or revise the principles and explain exactly which judgment-derived routing is allowed. Add an acceptance test for the chosen boundary.

2. Rewrite Principle 1 and its citation-gate scope note so they agree with the actual citation-check behavior and the plan’s policy. If citation judgments are permitted to affect kept findings and subsequent routing, state that exception precisely; otherwise specify the deterministic replacement and tests. Do not call judgment-derived input deterministic merely because the threshold is fixed.

3. Expand AC-D verification to assert that a published event reaches the dashboard subscriber and is rendered, and that the watcher handles that event exactly once and exits cleanly. Include a failure-path assertion for subscriber/query failure if stream delivery is best-effort.

IMPROVEMENT_SUGGESTIONS:

1. Option B′ is meaningfully compared on wall-clock time, coordination risk, and critical-path impact. Option C′ is framed as the compressed-window fallback, rather than as an equivalent full-scope option.

2. The plan gives concrete stage dependencies, rollback by stage, and a named per-AC closure procedure. I found no issue with the Stage 1 core predicate or the stated negative fixture on the evidence examined.


OpenAI Codex v0.157.0
--------
workdir: /Users/siddicky/Projects/zcode/refactoring-toolkit
model: gpt-6-luna
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: medium
reasoning summaries: none
session id: 01a0df2e-6d43-7630-aeb4-ebe2aab08a74
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
I’ll compare the frozen plan against its research inputs and the Wave 4 evidence, then check the referenced components and sequencing against the repository.
exec
/bin/zsh -lc 'rg -n "refactoring-toolkit|post-wave5|typesafe-refactor-opportunities|takeaways-synthesis|WAVE-4" /Users/siddicky/.codex/memories/MEMORY.md' in /Users/siddicky/Projects/zcode/refactoring-toolkit
 exited 1 in 0ms:
exec
/bin/zsh -lc 'cat .omc/plans/2026-09-26-post-wave5-consensus.md && cat .omc/research/typesafe-refactor-opportunities.md && cat .omc/research/takeaways-synthesis.md && rg -n -A25 -B4 "WAVE-4" BUILD_NOTES.md' in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
# Consensus Plan: post-wave-5 hardening + closure wave

- **Status**: DRAFT v4 — consensus iteration 4 (Planner synthesis of round-3 Architect + Critic + user-directed streams addendum; frozen for re-review)
- **Mode**: RALPLAN-DR short | Architect: glm-5.3 via zai | Critic: codex | Date: 2026-09-26
- **Inputs**: research files, BUILD_NOTES §WAVE-4, worker-1d in-flight assignment; three rounds of independent reviews; user directive (dex streams telemetry bus).

## Requirements Summary

After worker-1d concludes: Stage 1 — deterministic degenerate-turn detection (Tier-0) with **f(attempt)-only demotion** and a dispatch health gate reading **dex's own durable step-failure history** (no new substrate); Tier-1 Jev assessments as evidence-only records on a **dex stream telemetry bus** (user-directed). Stage 2 — vitest triage with an end-to-end data path; symbol-type band; verdict repair-or-discard with a fully specified tombstone. Stage 3 — closure (scoped push, per-AC verifier, AC1/AC2 report, demo record).

## RALPLAN-DR Summary

### Principles
1. **Judgment never controls flow.** Retry, fallback, repair, discard, and dispatch decisions are functions of deterministic signals only (reply shape class, dex attempt count, dex history facts, schema validity). Jev outputs are content classifications or recorded evidence; nothing in control flow reads them. *(Scope note: the pre-existing live citation gate — `flows/port-project.ts:1039-1052`, `p_cited < 1` drops findings — is classification-with-deterministic-threshold, the accepted Principle-3 pattern, not an exception.)*
2. **Deterministic core untouched** — agreement rule, reconcile(), sole-committer, provenance anchoring stay pure code.
3. **Assessment ≠ decision** — thresholds and routing live in tested code.
4. **One wave, gated start; Stage 1 ships first** (demo-protective even if the rest slips).
5. **Evidence-first closure.**

### Decision Drivers (top 3)
1. Make the wave-4 failure class deterministic and recoverable (shape detection + attempt demotion breaks the unrecoverable-replay loop — the causal fix, no judgment needed).
2. PR #1 is 6+ commits behind.
3. Chris-demo readiness (real-time subagent following via streams is itself a demo upgrade).

### Viable Options (critical-path to demo-ready)

**Option A — Staged sequential wave (RECOMMENDED).** Stage 1 ≈45 min (Tier-0 + demotion + history-gate + stream publish hook); Stage 2 ≈2–3 h; Stage 3 ≈1 h. Critical path to a protected demo ≈45 min; to full closure ≈4–5 h. Rollback: per-stage commits; Stage 1 independently revertible.
- Pros: zero file-conflict risk; demo protection never hostage to Stage 2; honest deps (S1→2c repair routing, S1→demo gate). Cons: longest total wall-clock.

**Option B′ — Parallel items ‖ gated closure.** Wall-clock ≈3–3.5 h (≈30% faster), but: two PR pushes (churn); demo record still waits on Stage 1 (same critical path); two-writer coordination on `flows/port-project.ts` (items 2a/2c both touch it). Fails driver 3 no faster where it matters.

**Option C′ — Tier-0 + demotion only (≈30–45 min).** Protects the demo; defers the user-approved TypeSafe scope (items 2–4) and streams. **Adopted as Stage 1**; the fallback if the window compresses.

## Implementation Steps

0. **Gate**: await worker-1d; audit commits; Tier-1-polish dupe check; **disarm + verify watchers** (kill `/tmp/watch-kill-kill`… precisely: `/tmp/watch-kill-cx5.sh` pid class 72922 — worker-1d's process, surfaced; fix its non-exiting terminal branch `:36-44`; assert `pgrep -f watch-kill` empty + state files removed); baseline `bun test` + `tsc`.
1. **Stage 1 — Tier-0 + demotion + history gate + stream bus**:
   - **Tier-0 predicate (final)**: degenerate = `usage present AND textOut.length === 0 AND not aborted`. Guard hoisted before BOTH `src/harness/opencode.ts` `prompt()` exits (`:299` immediate + post-poll; `:293`'s class is usage-null-only — dead for all nine fixtures). The "output ≤ 8" arm is DROPPED (misclassifies the text-present/output-0 healthy negative; all seven `retry` fixtures are no-text; cx-4's out=16 no-text still caught).
   - **Demotion — f(attempt) only, zero substrate**: `modelOverride` threaded `runReviewTurn → runAgentTurn` (pattern of `attempt` at `flows/port-project.ts:593`); policy: attempt ≥ 2 → demote from `OPENCODE_REVIEWER_MODEL` default. Rationale pinned: 0(g) proved intra-step writes don't survive uncompleted steps, so catch-and-write tier-0 records cannot persist; attempt count is already durable (`ctx.attempt`, verified `:1010/:1607`); demotion after a non-Tier-0 failure is harmless (one extra turn on the demoted lane) vs the unrecoverable-replay loop that killed nine flows.
   - **Dispatch health gate (lead layer)**: reads **dex's own durable history** — `dexcli flow history`-derived consecutive step-failure/finalAttempt facts on review steps (surface proven queryable in Phase 0(h)); 5 s timeout; fail-open on missing/stale/query failure. No new writes, no new attributes, never inside `PpWaveDispatch`/`DispatchStep`.
   - **Tier 1 — evidence-only, on the stream (user-directed)**: `src/typesafe/turn-health.ts` Jev nouls on shape-ambiguous turns + discarded verdicts → `WriteStream` to a per-run named stream (`port/<flowId>/events`) AND piggybacked `record`-role envelope events (report.md §Turn-diagnosis table; dashboard feed renders role `judgment` entries — the existing surface). **Zero control-flow consumers** (test-asserted). Healthy + shape-trivial turns: zero Jev calls.
   - **Stream telemetry bus (user-directed, Stage 2d scope pulled into Stage 1 as the publish hook)**: envelope factory emits each event via `WriteStream`; consumers migrate in Stage 2d — dashboard `src/dashboard/queries.ts` gains a `ReadStream` subscriber (replacing the 1.5–4 s dexcli subprocess polling), kill watcher subscribes for `pp-queue-verify:start` (replacing state polling + fixing its terminal loop), optional SSE to the page. **Projection-only principle**: streams are best-effort/trimmed (dex's own contract); durable truth stays in attributes/envelopes/SQLite; no correctness decision may read a stream.
2. **Stage 2a — Vitest triage (end-to-end data path)**: `QueueVerifyStep` persists parsed failure records into the durable vitest queue attribute (extends the existing queue-state shape); `classifyMany` runs at queue-build, writing `{failureClass, attributedFile, reason}` per record into the same attribute; the fix-round feed = the existing per-file fix loop reading queue state (the termination rule's substrate — no new retrieval path); unknown attribution → `port-caused` (documented default); Jev usage accounted via the `recordJevUsage` pattern (`flows/port-project.ts:498-502`); `FailureClassification` extended (`src/queues/vitest-queue.ts:43-47`). ACs: consumer test asserting classified records reach the feed and route to `attributedFile`.
3. **Stage 2b — Symbol band**: `uncertain_band` label for cascade nouls in [0.30, 0.70] (strict subset of the 0.8 strong-fail rule — reporting overlay only, both rates reported); `choice_confidence < 0.9` → escalation record; calibrated from `/tmp/jev-spot-check-after.json`; precedence documented vs `:222`; re-run `scripts/jev-spot-check.ts` (n=36).
4. **Stage 2c — Verdict repair-or-discard (fully specified)**:
   - **Suspicion predicate (deterministic, exhaustive)**: a schema-valid verdict is SUSPECT iff any finding's `evidence.span` resolves outside the diff's hunk line-ranges (reuses the span resolver), OR severity distribution is anomalous (all-findings-blocker count > 5), OR the verdict repeats verbatim a prior attempt's verdict on the same diff. No other triggers.
   - **Tombstone schema**: `ppVerdict`/`ppPrepVerdict` records gain variant `{reviewer, discarded: true, reason, attempt, tokens}`; BOTH `VerdictCheckStep` (`flows/port-project.ts:1029-1034`) and `PrepVerdictCheckStep` (`:1629-1632`) tolerate it; a discarded reviewer contributes ZERO kept findings (existing dropped-findings semantics `:1060-1067`; keptCount-0 route `:1086-1087`); the surviving reviewer's findings proceed; the round's agreement outcome surfaces `unreviewed` for the discarded side (agreement.ts's existing missing-record semantics — verified by worker-3's tests); prep-loop counter terminates on zero-findings tombstone rounds (check `:1657-1659`).
   - **Repair**: ONE repair re-prompt (reply routed through Tier-0); still-invalid-or-suspect → tombstone. Discarded reviewer's burned tokens carried on the tombstone + the step's envelope `tokens` return (`:1010-1013` pattern) — AC2 anchoring enforced by the envelope contract, not convention.
   - **Pre-check before this stage**: confirm agreement/metrics accept one-reviewer rounds (the unreviewed path) with a unit test; emit a `degraded` round marker if the renderer needs it.
5. **Stage 3 — Closure**: push scope = `origin/develop..main` (lead line-reviews the list first); PR body rewrite; **verifier procedure (per-AC, named)**: `bun test` (must include NEW `tests/turn-health.test.ts` and `tests/verdict-repair.test.ts`), `bun run typecheck`, then per-AC evidence: AC-B1/B2/B3 → turn-health test + gate script check; AC-T → `tests/fixtures/vitest-triage/manifest.json` + promotion-gate test; AC-S → `scripts/jev-spot-check.ts` JSON output (before/after); AC-V → verdict-repair test (4 paths: triggered-repair, repair-success, repair-fail→discard, single-reviewer-discard); stream bus → dashboard subscriber smoke + watcher-subscriber fire-once test; verdict block PASS/FAIL per AC; final AC1/AC2 report (inputs: `/tmp/metrics-*`, BUILD_NOTES); demo re-record via the health gate; Chris package.

## Acceptance Criteria

- [ ] **AC-B1**: each named degenerate fixture (all no-text) → Tier-0 retryable error; attempt-≥2 demotion observed on ≥1 fixture path; ZERO Jev calls on shape-trivial fixtures. **AC-B2**: routing = pure f(shape, attempt), unit-tested with NO Tier-1 input; text-present/output-0 negative passes. **AC-B3**: gate reads dex history only; fail-open on missing/stale/query-failure; ≤5 s pre-dispatch; Tier-1 provably unread by control flow (grep assertion + test).
- [ ] **AC-D (stream bus)**: envelope events visible on the named stream within one step; dashboard renders from the subscriber (poll fallback retained); watcher fires once on the subscribed event and exits cleanly; no correctness path reads the stream.
- [ ] **AC-T**: manifest with per-case id/evidence-path/adjudicated-label/adjudication-note; ≥20 cases AND ≥5 per class (port-caused/fixture-problem) for promotion at ≥90% majority agreement; per-class rates reported; shortfall → stays non-default; results in BUILD_NOTES.
- [ ] **AC-S**: spot-check ≥90% maintained; `uncertain_band` and `<0.8` rates separate; abstention→escalation count; escalation rate vs ~2/36 baseline ±tolerance stated in BUILD_NOTES.
- [ ] **AC-V**: four test paths green (triggered repair; repair success; repair-fail→tombstone; single-reviewer-discard round proceeds, agreement = unreviewed-side surfacing); tombstoned tokens AC2-anchored; `bun test` + `tsc` green.
- [ ] **AC-C**: PR #1 = exactly `origin/develop..main` (lead-reviewed); verifier per-AC verdict PASS; AC1/AC2 report; demo video shows lifecycle headline + cost columns + stream-fed live feed.

## Fixture Set

`tests/fixtures/turn-health/` — **raw SDK message shapes** (`{info:{tokens}, parts}`) driving `OpencodeHarness.prompt` through the real extractors via an SDK-boundary double. Nine degenerate (labels: `retry` ×7 — all no-text incl. cx-4 out=16; `generic_retry` — 885-token unparseable; `generic_retry` — cache-identical replay; `discard_class` — persona prose) + healthy negatives (~235-token valid verdict; text-present/output-0; aborted-no-text → NOT Tier-0, handled at `flows/port-project.ts:563`). Expected outcome per case in the fixture header.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Judgment in control flow | Principle 1 absolute; routing f(shape, attempt); gate reads dex history; Tier-1 test-asserted unread |
| Provider window mid-demo | History gate + in-wave retry; fallback = record from replayed history; Stage 1 first |
| Watcher misfire | Step 0 kill + fix + `pgrep`-empty verification |
| One-reviewer rounds break metrics | Pre-check unit test before Stage 2c; unreviewed semantics already tested |
| Stream trimming loses evidence | Projection-only: durable truth in attributes/envelopes; streams never read for correctness |
| <20 triage labels or <5/class | Classifier stays non-default; shortfall recorded |
| Tier-2 scope creep | Out of scope |

## ADR

*(finalized after consensus)*

## Changelog

- v1–v3: see history (two-tier battery → evidence-only Tier-1).
- v4 (round-3 synthesis + user directive): **Tier-0 predicate finalized** (usage present AND no text AND not aborted; ≤8 arm dropped — it misclassified the plan's own healthy negative); **demotion = f(attempt) only** with the 0(g) rationale pinned (catch-and-write cannot persist; attempt already durable); **gate reads dex history** (0(h)-proven surface; zero new substrate); **vitest data path end-to-end** (queue attribute as the single substrate; feed = existing fix loop; attributedFile routing; unknown→port-caused); **verdict suspicion predicate exhaustive** (span-outside-diff, all-blockers>5, verbatim-repeat); **tombstone schema + both check steps + one-reviewer agreement semantics** (unreviewed side) + tokens-on-tombstone envelope contract + prep-loop termination check; **per-AC verifier procedure with named tests** (`tests/turn-health.test.ts`, `tests/verdict-repair.test.ts` — new, created by their stages); full file paths everywhere; per-class AC-T minimums; AC-S source named; **user-directed Stage 2d: dex stream telemetry bus** (WriteStream publish in envelope factory; dashboard/Read-Stream subscriber replacing subprocess polling; watcher subscription replacing state polling; projection-only principle); critical-path + rollback in options.
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

exec
/bin/zsh -lc 'rg -n "runReviewTurn|runAgentTurn|modelOverride|attempt|VerdictCheckStep|PrepVerdictCheckStep|QueueVerifyStep|classifyMany|createNaiveClassifier|FailureClassification|ReadStream|WriteStream|Read-Stream|stream" src flows scripts tests | head -250' in /Users/siddicky/Projects/zcode/refactoring-toolkit
 succeeded in 0ms:
src/git/exec.ts:44:  // until dex fails the attempt on the heartbeat timeout.
tests/opid-seam.test.ts:67:    await writeWorktreeFile(lease.worktreePath, "<?php\n// v1\n// redo attempt\n");
scripts/render-metrics.ts:10: *   envelope stream), `pp-verdict/*` + `pp-prep-verdict/*` (ReviewTuple — the
scripts/render-metrics.ts:177:      typeof v.attempt === "number" &&
scripts/render-metrics.ts:238:  // evidence into the parent's stream so the report covers the whole run.
flows/port-parallel.ts:12: *   fails its lease attempt retryably and dex retries with backoff — the cap is
flows/port-parallel.ts:14: * - evidence stream: children are real flows with their OWN attribute stores;
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
src/metrics/render.test.ts:4:import runARaw from "./fixtures/event-stream-run-a.json" with { type: "json" };
src/metrics/render.test.ts:5:import runBRaw from "./fixtures/event-stream-run-b.json" with { type: "json" };
src/metrics/render.test.ts:16:// Recorded fixture streams (JSON import types are widened; the fixtures are
src/metrics/render.test.ts:52:    // 1 envelope : 2 retry dispatch entries, finalAttempt 2 == envelope attempt 2
src/metrics/render.test.ts:57:      envelope_attempt: 2,
src/metrics/render.test.ts:58:      dispatch_final_attempt: 2,
src/metrics/render.test.ts:107:    // pp-implement 2000 + pp-fixer 1050 + 1000 over 3 real attempts (marker excluded)
src/metrics/render.test.ts:138:  test("fixer retry counts per file (stepId pp-fixer, attempt > 1)", () => {
src/metrics/render.test.ts:251:    expect(failures).toContain("attempt-0 start marker but carries token usage");
src/metrics/render.test.ts:253:    expect(failures).toContain("model step pp-implement (src__Http__Request.php#1) has no attempt-0 start marker");
src/metrics/render.test.ts:254:    expect(failures).toContain("model step pp-review-a (src__Http__Request.php#1) has no attempt-0 start marker");
src/metrics/render.test.ts:255:    expect(failures).toContain("model step pp-review-b (src__Http__Request.php#1) has no attempt-0 start marker");
src/metrics/render.test.ts:256:    expect(failures).toContain("reached finalAttempt 3 beyond envelope attempt 1");
src/metrics/render.test.ts:288:  test("empty stream is clean", () => {
src/metrics/render.test.ts:298:      attempt: 1,
src/metrics/render.test.ts:309:  test("negative attempt is a failure", () => {
src/metrics/render.test.ts:315:      attempt: -1,
src/metrics/render.test.ts:333:        attempt: 1,
src/metrics/render.test.ts:348:  test("clean stream + consistent history -> ok with zero failures", () => {
src/metrics/render.test.ts:374:    attempt: 1,
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
flows/port-project.ts:491:/** Accumulated LIVE Jev usage (evidence stream; naive path adds nothing). */
flows/port-project.ts:497:/** Records one live-Jev usage event (evidence stream entry). */
flows/port-project.ts:545:async function runAgentTurn(input: {
flows/port-project.ts:568:  // the envelope contract accepts both; tokenTotalOf normalizes downstream.
flows/port-project.ts:586:async function runReviewTurn(input: {
flows/port-project.ts:593:  /** Dex attempt (1-based). Retries get a cache-busting suffix (live finding:
flows/port-project.ts:595:  attempt?: number;
flows/port-project.ts:620:    (input.attempt ?? 1) > 1
flows/port-project.ts:621:      ? `${turn}\n\n(retry attempt ${input.attempt}: a previous reply on this step was truncated or unparseable — respond with exactly one JSON object and nothing else)`
flows/port-project.ts:625:  const result = await runAgentTurn({
flows/port-project.ts:769:    if (out.done) return goTo(QueueVerifyStep, out);
flows/port-project.ts:914:    const result = await runAgentTurn({
flows/port-project.ts:971:    const { tuple, tokens } = await runReviewTurn({
flows/port-project.ts:978:      attempt: ctx.attempt,
flows/port-project.ts:1003:    const { tuple, tokens } = await runReviewTurn({
flows/port-project.ts:1010:      attempt: ctx.attempt,
flows/port-project.ts:1015:  route: (_ctx, _input, fri) => goTo(VerdictCheckStep, fri),
flows/port-project.ts:1018:const VerdictCheckStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput & { keptCount: number }>({
flows/port-project.ts:1177:    const result = await runAgentTurn({
flows/port-project.ts:1460:    const result = await runAgentTurn({ def: IMPLEMENTER, sessionId: await prepSessionId(input.epoch), turn, file: PREP_SPEC_FILE, round: 0 });
flows/port-project.ts:1556:  // M2/M4 join identity: the attempt-0 start marker carries prep<iteration>;
flows/port-project.ts:1565:    const { tuple, tokens } = await runReviewTurn({
flows/port-project.ts:1572:      attempt: ctx.attempt,
flows/port-project.ts:1600:    const { tuple, tokens } = await runReviewTurn({
flows/port-project.ts:1607:      attempt: ctx.attempt,
flows/port-project.ts:1612:  route: (_ctx, _input, input) => goTo(PrepVerdictCheckStep, input),
flows/port-project.ts:1615:const PrepVerdictCheckStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<PortRunInput, PortRunInput>({
flows/port-project.ts:1727:    const result = await runAgentTurn({
flows/port-project.ts:1781:const QueueVerifyStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<
flows/port-project.ts:2013:    const result = await runAgentTurn({
flows/port-project.ts:2144:    // 14 attempts with "AttributeMap instance was not loaded for this
flows/port-project.ts:2257:    out.mode === "fix" ? goTo(QueueVerifyStep, baseInputOf(out)) : goTo(DispatchStep, baseInputOf(out)),
flows/port-project.ts:2276:    // finding cx-5c: the child's first step failed 3 attempts with
flows/port-project.ts:2283:    // errors: every downstream per-file step is store-local (ctx-bound), so
flows/port-project.ts:2389:    const result = await runAgentTurn({
flows/port-project.ts:2455:  readonly verdictCheck = new VerdictCheckStep();
flows/port-project.ts:2510:  readonly prepVerdictCheck = new PrepVerdictCheckStep();
flows/port-project.ts:2525:  readonly verdictCheck = new VerdictCheckStep();
flows/port-project.ts:2532:  readonly queueVerify = new QueueVerifyStep();
src/queues/vitest-queue.test.ts:8:  createNaiveClassifier,
src/queues/vitest-queue.test.ts:10:  type FailureClassification,
src/queues/vitest-queue.test.ts:98:    const classifier = createNaiveClassifier();
src/queues/vitest-queue.test.ts:109:    const classifier = createNaiveClassifier();
src/queues/vitest-queue.test.ts:137:      createNaiveClassifier().classify(unknownFailure).failureClass,
src/queues/vitest-queue.test.ts:142:      createNaiveClassifier({ unknown: "fixture-problem" }).classify(unknownFailure)
src/queues/vitest-queue.test.ts:150:    const alwaysFixture: FailureClassification = {
src/dashboard/queries.ts:76:  /** Full durable event stream for a flow (dispatch log + attribute upserts). */
src/harness/runtime.ts:154: * runReviewTurn) runs on this provider/model instead of the harness default,
src/metrics/fixtures/event-stream-run-b.json:3:    {"stepId": "pp-implement", "role": "agent", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:00:00.000Z", "ended_at": "2026-09-25T11:01:00.000Z", "outcome": "completed", "tokens": 450, "wall_clock_ms": 60000, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:4:    {"stepId": "pp-review-a", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:01:00.000Z", "ended_at": "2026-09-25T11:02:00.000Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 60000, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:5:    {"stepId": "pp-review-b", "role": "review", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:01:00.000Z", "ended_at": "2026-09-25T11:02:00.000Z", "outcome": "completed", "tokens": 100, "wall_clock_ms": 60000, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:6:    {"stepId": "pp-commit", "role": "commit", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:03:00.000Z", "ended_at": "2026-09-25T11:03:00.100Z", "outcome": "completed", "tokens": {"input_tokens": 10, "output_tokens": 5}, "wall_clock_ms": 100, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:7:    {"stepId": "pp-capture-diff", "role": "diff-capture", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:05:00.000Z", "ended_at": null, "outcome": "interrupted", "tokens": null, "wall_clock_ms": null, "identity": "src__Http__Response.php#1"},
src/metrics/fixtures/event-stream-run-b.json:8:    {"stepId": "pp-fixer", "role": "agent", "file": null, "round": null, "attempt": 0, "started_at": "2026-09-25T11:06:00.000Z", "ended_at": null, "outcome": "interrupted", "tokens": 500, "wall_clock_ms": null, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:9:    {"stepId": "pp-commit", "role": "verdict-check", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:07:00.000Z", "ended_at": "2026-09-25T11:07:00.005Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 5, "identity": "src__Http__Request.php#1"},
src/metrics/fixtures/event-stream-run-b.json:10:    {"stepId": "pp-unknown-step", "role": "record", "file": null, "round": null, "attempt": 1, "started_at": "2026-09-25T11:08:00.000Z", "ended_at": "2026-09-25T11:08:00.001Z", "outcome": "completed", "tokens": null, "wall_clock_ms": 1, "identity": null}
src/metrics/types.ts:2: * Metrics event contract — shared evidence-stream types for the porting toolkit.
src/metrics/types.ts:7: * - Envelope events carry `{stepId, role, file, round, attempt, started_at,
src/metrics/types.ts:76: * - `attempt` is one-based from the dex Context (exit 0(f)) EXCEPT for M4
src/metrics/types.ts:77: *   start markers: attempt 0, outcome "interrupted", `ended_at` null, written
src/metrics/types.ts:81: * - `tokens` is REQUIRED (non-null) for model-calling roles on real attempts;
src/metrics/types.ts:89: *   record: either not yet closed by the recovery pass, or an attempt-0
src/metrics/types.ts:98:  /** 0 = M4 start marker; >= 1 = real attempt (dex Context.attempt). */
src/metrics/types.ts:99:  attempt: number;
src/metrics/types.ts:112:/** True for M4 start markers (attempt 0, record-semantics under the target role). */
src/metrics/types.ts:114:  return env.attempt === 0;
src/metrics/types.ts:168: * downstream consumers keep one import surface.
src/metrics/types.ts:213: * (a record that is simply absent from the stream).
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
src/metrics/dispatch-anchor.ts:544: * @returns combined cross-check: `ok` is true only when the envelope stream
src/metrics/render.ts:3: * from the evidence stream — envelope events, completed verdict records, queue
src/metrics/render.ts:12: * - attempt-0 start markers (M4) are excluded from token totals, per-role
src/metrics/render.ts:18: *   failure (the attempt was killed mid-turn — the M4 marker plus its dispatch
src/metrics/render.ts:82:    /** M4 attempt-0 start markers (excluded from token/role aggregates). */
src/metrics/render.ts:84:    /** Interrupted envelopes over REAL attempts (attempt >= 1) only. */
src/metrics/render.ts:87:    /** Total over model-calling roles, real attempts only; null when none. */
src/metrics/render.ts:126:  /** Retries = fixer (stepId pp-fixer) envelope events with attempt > 1, per file. */
src/metrics/render.ts:149: * strings; empty array = the stream is contract-clean.
src/metrics/render.ts:159:    if (env.attempt < 0) {
src/metrics/render.ts:160:      failures.push(`envelope ${env.stepId} has attempt ${env.attempt} < 0`);
src/metrics/render.ts:163:    if (env.attempt === 0) {
src/metrics/render.ts:165:        failures.push(`envelope ${env.stepId} is an attempt-0 start marker but carries token usage`);
src/metrics/render.ts:200: * Full AC2 cross-check: the envelope stream reconciles against the attribute
src/metrics/render.ts:306:  // ---- tokens + wall clock per file per role (real attempts only) --------
src/metrics/render.ts:317:    if (env.attempt === 0) continue; // M4 start markers are not step work
src/metrics/render.ts:361:    if (env.attempt === 0 || !isModelCallingRole(env.role)) continue;
src/metrics/render.ts:411:  // ---- totals over eligible (model-calling, real-attempt) steps ----------
src/metrics/render.ts:417:    if (env.attempt === 0) {
src/metrics/render.ts:432:    if (env.stepId !== FIXER_STEP_ID || env.attempt === 0) continue;
src/metrics/render.ts:435:    if (env.attempt > 1) {
src/metrics/render.ts:559:    lines.push("_no file+round records in the stream_");
src/metrics/render.ts:586:    lines.push("_no envelope events in the stream_");
src/metrics/render.ts:600:    lines.push("_no model-calling envelopes in the stream_");
src/metrics/render.ts:626:    lines.push("_no fixer steps in the stream_");
src/metrics/render.ts:638:    lines.push("_no queue samples in the stream_");
src/metrics/render.ts:679:/** Render the evidence stream into {markdown, json} for metrics/report.{md,json}. */
src/dashboard/static/index.html:114:      <h2><span class="n">05</span>commit stream (lease + integration)</h2>
src/dashboard/static/index.html:179:      <td>${r.attempt == null ? '<span class="faint">-</span>' : esc(r.attempt)}</td>
src/dashboard/static/index.html:208:      <td>${esc(e.attempt)}</td>
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
src/harness/opencode.ts:109: * deadline and fail RETRYABLE so dex re-dispatches on a fresh attempt.
src/harness/opencode.ts:132: * Typed failure for one prompt turn. `retryable` failures (upstream aborts,
src/harness/opencode.ts:147: * Extracts the upstream error of an assistant message, if any.
src/harness/opencode.ts:149: * info.error set when the upstream provider fails — callers must check.

exec
/bin/zsh -lc "nl -ba src/harness/opencode.ts | sed -n '270,320p'; nl -ba flows/port-project.ts | sed -n '535,650p'; nl -ba flows/port-project.ts | sed -n '1770,1855p'; nl -ba flows/steps/envelope.ts | sed -n '360,430p'; nl -ba src/queues/vitest-queue.ts | sed -n '1,145p'; nl -ba flows/port-project.ts | sed -n '1018,1095p'; nl -ba flows/port-project.ts | sed -n '1610,1670p'" in /Users/siddicky/Projects/zcode/refactoring-toolkit
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
   316	    }
   317	    return undefined;
   318	  }
   319	
   320	  /** Aborts a session. Returns true only when the server accepted without error. */
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
  1770	const TSC_BIN = join(import.meta.dir, "..", "node_modules", ".bin", "tsc");
  1771	
  1772	async function pathExists(p: string): Promise<boolean> {
  1773	  try {
  1774	    await stat(p);
  1775	    return true;
  1776	  } catch {
  1777	    return false;
  1778	  }
  1779	}
  1780	
  1781	const QueueVerifyStep: EnvelopeStepClass<PortRunInput> = envelopeStepClass<
  1782	  PortRunInput,
  1783	  PortRunInput & { exhausted: boolean }
  1784	>({
  1785	  stepType: "PpQueueVerify",
  1786	  stepId: "pp-queue-verify",
  1787	  role: "queue",
  1788	  stepOptions: {
  1789	    executeLoadAttributeMaps: [ppVerify, ppQueue, ppConfig, ppPrep, ppMarker],
  1790	  },
  1791	  inner: async (ctx, input) => {
  1792	    const config = ppConfig.get(ctx, "config");
  1793	    const queue = ppQueue.get(ctx, "queue");
  1794	    const prep = ppPrep.get(ctx, "prep");
  1795	    const prev = ppVerify.get(ctx, "verify");
  1796	    const iteration = (prev?.iteration ?? 0) + 1;
  1797	    const recordedAt = new Date().toISOString();
  1798	    const itg = input.integrationWorktreePath;
  1799	
  1800	    // Toolkit-owned scaffold: the integrated checkout needs a tsconfig for
  1801	    // tsc; queue infrastructure is toolkit code, not agent content.
  1802	    if (!(await pathExists(join(itg, "tsconfig.json")))) {
  1803	      await writeFile(
  1804	        join(itg, "tsconfig.json"),
  1805	        JSON.stringify(
  1806	          {
  1807	            compilerOptions: {
  1808	              strict: true,
  1809	              target: "ES2022",
  1810	              module: "ESNext",
  1811	              moduleResolution: "Bundler",
  1812	              noEmit: true,
  1813	              skipLibCheck: true,
  1814	              types: [],
  1815	            },
  1816	            include: ["src/**/*.ts", "test/**/*.ts", "tests/**/*.ts"],
  1817	          },
  1818	          null,
  1819	          2,
  1820	        ),
  1821	      );
  1822	    }
  1823	
  1824	    // tsc queue: parse + group via the proven queue module.
  1825	    let tscOut = "";
  1826	    try {
  1827	      const { stdout } = await execFileP(TSC_BIN, ["--noEmit", "--pretty", "false"], {
  1828	        cwd: itg,
  1829	        timeout: 180_000,
  1830	        maxBuffer: 64 * 1024 * 1024,
  1831	      });
  1832	      tscOut = stdout;
  1833	    } catch (err) {
  1834	      const e = err as { stdout?: string; stderr?: string };
  1835	      tscOut = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
  1836	    }
  1837	    // Deterministic kill-smoke fault (Phase 4 exit): iteration 1 only — inject
  1838	    // one synthetic, self-labeled tsc error for the first done file so the fix
  1839	    // round ACTUALLY runs and the queue/fix-round kill window exists. Never
  1840	    // active without PORTING_KIT_FAULT; the injected line names itself.
  1841	    if (faultMatches("queue-verify:inject-error", "seed") && iteration === 1) {
  1842	      const firstDone = queue.done[0];
  1843	      const injectPath = firstDone !== undefined ? prep?.sourceMap[firstDone.file]?.outPath : undefined;
  1844	      if (firstDone !== undefined && injectPath !== undefined) {
  1845	        tscOut += `\n${injectPath.replace(/^\.\//, "")}(1,1): error TS9999: injected fault queue-verify:inject-error:seed (synthetic — fix-round durability smoke, not a real port error)\n`;
  1846	      }
  1847	    }
  1848	    const tscState = buildTscQueueState(parseTscOutput(tscOut), iteration);
  1849	
  1850	    // vitest queue: runs only when the integrated checkout carries its own
  1851	    // runner; otherwise the burn-down records an honest unavailable note.
  1852	    let vitestTotal = 0;
  1853	    let vitestNote: string | null = "vitest not installed in the integrated checkout";
  1854	    const vitestBin = join(itg, "node_modules", ".bin", "vitest");
  1855	    if (await pathExists(vitestBin)) {
   360	  });
   361	}
   362	
   363	/**
   364	 * A minimal durable step that only persists a record envelope with the given
   365	 * payload events. Used to make session-ID (fence) and envelope-start writes
   366	 * durable BEFORE the main step runs: the mini-step's decision lands
   367	 * independently, so a SIGKILL inside the later step cannot erase the fence.
   368	 */
   369	export function recordStep(spec: {
   370	  stepType: string;
   371	  stepId: string;
   372	  /** Session fence to persist before a dependent agent step runs. */
   373	  fence?: Omit<SessionFence, "persistedAtUtc"> | undefined;
   374	  /** Optional per-target identity for the event key. */
   375	  identity?: string | undefined;
   376	  /** Optional routing decision; defaults to gracefulComplete. */
   377	  route?: (context: Context) => StepDecision;
   378	}): Step<void> {
   379	  return {
   380	    getStepType(): string {
   381	      return spec.stepType;
   382	    },
   383	    waitFor(): Wait {
   384	      return Wait.skipImmediately();
   385	    },
   386	    execute(context: Context): StepDecision {
   387	      writeFence(context, spec.fence);
   388	      writeRecordEvent(context, spec.stepId, context.attempt, spec.identity);
   389	      if (spec.route !== undefined) return spec.route(context);
   390	      return gracefulComplete(undefined);
   391	    },
   392	  };
   393	}
   394	
   395	/** Class form of {@link recordStep} for chained flows. */
   396	export function recordStepClass(spec: {
   397	  stepType: string;
   398	  stepId: string;
   399	  fence?: Omit<SessionFence, "persistedAtUtc"> | undefined;
   400	  identity?: string | undefined;
   401	  route?: (context: Context) => StepDecision;
   402	}): StepClass<void> {
   403	  return class RecordStepClass implements Step<void> {
   404	    getStepType(): string {
   405	      return spec.stepType;
   406	    }
   407	    waitFor(): Wait {
   408	      return Wait.skipImmediately();
   409	    }
   410	    execute(context: Context): StepDecision {
   411	      writeFence(context, spec.fence);
   412	      writeRecordEvent(context, spec.stepId, context.attempt, spec.identity);
   413	      if (spec.route !== undefined) return spec.route(context);
   414	      return gracefulComplete(undefined);
   415	    }
   416	  };
   417	}
   418	
   419	// ---------------------------------------------------------------------------
   420	// envelopeStartMarker — durable PRE-start record for model-calling steps (M4)
   421	// ---------------------------------------------------------------------------
   422	
   423	/**
   424	 * A record-role mini-step inserted BEFORE a model-calling step that persists
   425	 * a durable "step started" marker (attempt 0, outcome `interrupted`,
   426	 * `ended_at` null). 0(g) finding: the envelope's own start event is staged
   427	 * with the step's decision, so a SIGKILL inside the step leaves NO envelope —
   428	 * an AC1 evidence hole. The marker's decision lands INDEPENDENTLY, so every
   429	 * model-calling execution is provable even when killed mid-turn.
   430	 *
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
  1081	      output: { ...fri, keptCount: kept.length },
  1082	      tokens: null,
  1083	      outcome: kept.length > 0 ? "completed" : "skipped",
  1084	    };
  1085	  },
  1086	  route: (_ctx, _input, fri) =>
  1087	    fri.keptCount > 0 ? goTo(PrioritizeStep, fri) : goTo(CommitStep, fri),
  1088	});
  1089	
  1090	const PrioritizeStep: EnvelopeStepClass<FileRoundInput> = envelopeStepClass<FileRoundInput, FileRoundInput>({
  1091	  stepType: "PpPrioritize",
  1092	  stepId: "pp-prioritize",
  1093	  role: "prioritize",
  1094	  identityOf: (_ctx, fri) => markerKeyOf(fri.file, fri.round),
  1095	  stepOptions: { executeLoadAttributeMaps: [ppKept] },
  1610	    return { output: input, tokens };
  1611	  },
  1612	  route: (_ctx, _input, input) => goTo(PrepVerdictCheckStep, input),
  1613	});
  1614	
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

codex
VERDICT: REVISE

REASONS:

1. Stage 2a puts a Jev judgment on a control-flow path. The plan says `classifyMany` writes a `failureClass` and the fix-round feed routes records to `attributedFile`. That classification determines which failures enter the port loop. This conflicts with Principle 1’s rule that “nothing in control flow reads” Jev outputs and Principle 3’s rule that code owns routing. The research input likewise describes Choice as selecting the causal frame and failure class. This is a design contradiction, not a missing test.

2. Principle 1’s citation-gate exception contradicts its absolute wording and the requested deterministic-core rule. The plan says the existing `p_cited < 1` gate “drops findings” and then declares it “not an exception.” Yet Stage 1 proposes running a Jev citation checker, and the existing verdict-check route branches on the resulting `keptCount` (`flows/port-project.ts:1039-1067, 1079-1087`). Calling the threshold deterministic does not make the judgment-derived input deterministic. The plan must explicitly reconcile this with its stated principle.

3. Stage 3’s verification does not fully establish the stream-bus acceptance criteria. AC-D requires that the dashboard render from the subscriber and the watcher fire once and exit cleanly, but the named verifier only says “dashboard subscriber smoke” and “watcher-subscriber fire-once test.” It does not specify a dashboard assertion that observes a published event, or a watcher assertion that verifies clean exit and no duplicate firing. Those checks could pass without demonstrating the stated end-to-end behavior.

REQUIRED_CHANGES:

1. Resolve the Stage 2a contradiction explicitly: either make vitest classification advisory evidence and keep feed selection/routing deterministic, or revise the principles and explain exactly which judgment-derived routing is allowed. Add an acceptance test for the chosen boundary.

2. Rewrite Principle 1 and its citation-gate scope note so they agree with the actual citation-check behavior and the plan’s policy. If citation judgments are permitted to affect kept findings and subsequent routing, state that exception precisely; otherwise specify the deterministic replacement and tests. Do not call judgment-derived input deterministic merely because the threshold is fixed.

3. Expand AC-D verification to assert that a published event reaches the dashboard subscriber and is rendered, and that the watcher handles that event exactly once and exits cleanly. Include a failure-path assertion for subscriber/query failure if stream delivery is best-effort.

IMPROVEMENT_SUGGESTIONS:

1. Option B′ is meaningfully compared on wall-clock time, coordination risk, and critical-path impact. Option C′ is framed as the compressed-window fallback, rather than as an equivalent full-scope option.

2. The plan gives concrete stage dependencies, rollback by stage, and a named per-AC closure procedure. I found no issue with the Stage 1 core predicate or the stated negative fixture on the evidence examined.
hook: Stop
hook: Stop Completed
tokens used
29,855

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
