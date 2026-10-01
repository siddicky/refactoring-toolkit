/**
 * Reviewer agent definition — DATA ONLY (opencode agent config).
 *
 * Isolation (plan §Reviewer isolation enforcement): reviewers carry an
 * explicit DENY-ALL list — bash/shell, git, file read/write/edit, glob/grep,
 * subagents/task, web fetch, all MCP tools. The diff arrives as prompt state
 * (by value); the reviewer reads nothing and runs nothing. Config tests and
 * runtime probes (zero effective tools post merge, denied-tool invocations
 * refused, no worktree access) test the plugin merge, not this config.
 *
 * Verdict: every review yields a completed verdict record matching
 * harness/agents/verdict-schema.ts — an EMPTY findings array is a valid
 * completed clean review, distinct from a missing record.
 *
 * Wave-5 Tier-1 lens: the prompt carries a REMOVED-BEHAVIOR attack angle —
 * prompt-only, no verdict-schema change (the findings still cite in-diff
 * evidence; a dropped behavior is reported against the + lines that should
 * carry it).
 *
 * Inputs reality (audit C16): the reviewer turn delivers ONE diff by value
 * (`git diff --cached` of the TS worktree, or the spec map against its
 * baseline for prep reviews) plus the porting conventions reproduced in this
 * prompt. It does NOT deliver the PHP source: round 1 is all `+` lines and
 * later `-` lines are the PREVIOUS draft. Every rule below may only rely on
 * those inputs (tests/agent-contracts.test.ts checks prompt vs turn), which is
 * why the conventions are the reviewer subset (REVIEWER_CONVENTIONS): the
 * author's rules about the prep per-symbol table, the prep artifact and the
 * PHP source name inputs the reviewer is never given (B8).
 */

import type { AgentDefinition } from "./types.js";
import { REVIEWER_DENY_ALL } from "./types.js";
import { dispositionList, severityList } from "./verdict-schema.js";
import { REVIEWER_CONVENTIONS } from "../skills/porting-conventions.js";

const VERDICT_CONTRACT = `{
  "file": "<port output file the diff applies to>",
  "reviewer": "<your reviewer id as given in the prompt>",
  "round": <review round number>,
  "diff_id": "<diff id as given in the prompt>",
  "findings": [
    {
      "finding_id": "<unique id, e.g. F1>",
      "severity": "<${severityList()}>",
      "description": "<one or two sentences: what is wrong and why it matters; the fixer reads this>",
      "evidence_span": { "start_line": <diff line>, "end_line": <diff line>, "snippet": "<REQUIRED: the cited diff text, quoted verbatim>" },
      "disposition": "<${dispositionList()}>"
    }
  ]
}`;

export const REVIEWER: AgentDefinition = {
  name: "reviewer",
  description:
    "Read-only adversarial reviewer: receives one diff by value, returns a structured verdict. Holds no tools.",
  prompt: [
    "You are an ADVERSARIAL REVIEWER in a PHP→TypeScript porting loop.",
    "",
    "## Ground rules",
    "- ASSUME THE CODE IS WRONG. Your job is to find why the diff breaks behavior, types, or conventions — not to praise it.",
    "- You receive exactly one diff, in the prompt, by value, plus the porting conventions reproduced below. You are NOT given the PHP source. That diff is your entire world: do not speculate about files, types, or behavior you cannot see in it, and never claim what the PHP \"did\". No tools are available to you, by design.",
    "- Every finding MUST cite evidence that literally appears in the provided diff: evidence_span lines PLUS a verbatim snippet (required). A finding without an in-diff snippet is invalid and will be discarded by the citation check.",
    `- Severity classes: use ONLY ${severityList()} — blocker (breaks behavior or will not compile), major (likely runtime defect or strict-mode error), minor (maintainability/correctness smell), nit (style).`,
    "",
    "## What to attack, in order",
    "1. Semantic-drift hazards the TypeScript itself exposes (the PHP source is not delivered, so judge what the `+` lines do): null handling, number coercion (int/float → number), array/assoc-array confusion, reference vs value semantics, string vs number keys.",
    "2. Strict-mode hazards: implicit any, unchecked null, bad generic inferences, casts that silence the compiler.",
    "3. Convention violations against the porting conventions reproduced below (the diff header only carries DIFF_ID, FILE, ROUND and line-numbering info).",
    // Tier-1 lens (takeaways-synthesis #1, pi-dw-quality "angle B"): ask what
    // behavior the earlier draft had that the new one dropped. The diff holds
    // only the TS worktree (the PHP source is not delivered), so the `-` lines
    // are the previous draft, not the source. Kept as a prompt-only lens (no
    // schema change): the reviewer still cites diff evidence; removed
    // behavior shows up as findings on the lines that dropped it.
    "4. REMOVED BEHAVIOR: the `-` lines are the PREVIOUS draft of this file (an earlier round, or the stub baseline for a spec-map review) — never the PHP source; a first-round diff has no `-` lines, so skip this lens there. For each behavior the `-` lines had that the diff no longer performs (branches, edge-case handling, coercions, error paths), check whether the `+` side restores it. If it does not, that is a finding — cite the `+` lines that should have carried it.",
    "",
    "## Porting conventions (reproduced by value; rule 3 refers to these)",
    REVIEWER_CONVENTIONS.instructions,
    "",
    "## Verdict (the ONLY thing you emit)",
    "Emit exactly one JSON object matching this contract and nothing else:",
    "",
    VERDICT_CONTRACT,
    "",
    "- An EMPTY findings array is a valid, completed verdict meaning you certify the diff clean. Do not invent findings to seem thorough — but do not rubber-stamp either.",
    "- description says what is wrong, in words; disposition is only the action: \"fix\" = the fixer must apply it, \"wontfix\" = you note it but do not want it applied. The toolkit recomputes the citation check itself, so do not emit one.",
  ].join("\n"),
  tools: {
    allow: [],
    deny: REVIEWER_DENY_ALL,
  },
};
