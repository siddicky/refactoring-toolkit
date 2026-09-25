# Deep Interview Spec: Durable Adversarial Porting Toolkit (dex + opencode)

Recreating the dynamic-workflow setup from the Bun-in-Rust article (https://bun.com/blog/bun-in-rust) as a reusable toolkit in this repo, built on durable execution (dex) and a custom opencode agent harness.

## Metadata
- Interview ID: D10C9A87-D5BE-4A91-B3EB-83738BAF3F50
- Rounds: 10
- Final Ambiguity Score: 7%
- Type: greenfield
- Generated: 2026-09-25T17:46:40Z
- Threshold: 0.1
- Threshold Source: ~/.claude/settings.json
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.40 | 0.36 |
| Constraint Clarity | 0.95 | 0.30 | 0.285 |
| Success Criteria | 0.95 | 0.30 | 0.285 |
| Context Clarity | N/A (greenfield) | — | — |
| **Total Clarity** | | | **0.93** |
| **Ambiguity** | | | **0.07** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| Core adversarial loop | active | Implementer → 2+ read-only adversarial reviewers (diff-in, structured verdict-out) → fixer, all as opencode agents driven by dex steps | Covered by AC1, AC2; execution mode settled in Round 9 |
| Prep-analysis workflows | active | PORTING.md-style PHP→TS spec map + per-symbol analysis table, each adversarially reviewed before use | Covered by Goal; feeds the port loop |
| Verification queue workflows | active | Typecheck-error queue (tsc) and failing-test queue (vitest) feeding the adversarial loop; burn-down tracked for metrics | Covered by AC2 (burn-down series required) |
| Concurrency harness | active | 2 git worktrees, git-safety rules (commit-only git for agents; slow commands forbidden during porting), low concurrency caps | Covered by Constraints; minimal v1 scale locked Round 6 |
| Durable execution layer (dex) | active | dex TypeScript SDK flows/steps/attributes as the orchestration substrate; local server; kill+resume behavior | Covered by AC1 |

No deferrals.

## Goal
Build a reusable toolkit in this repo (`refactoring-toolkit`) that recreates the article's dynamic workflow setup: durable multi-agent orchestration in which a custom opencode harness (oh-my-openagent-style TypeScript plugin: agents and skills as TS modules) supplies the agents — one implementer, two read-only adversarial reviewers that receive only the diff, and one fixer — orchestrated by dex flows so every agent invocation, verdict, and file commit is a durable step. The toolkit runs a full pipeline: prep-analysis (PHP→TS spec map + per-symbol table, adversarially reviewed), per-file porting loop, and verification queues (tsc errors, failing vitest tests). It is validated end-to-end on a generated in-repo demo fixture porting a small PHP module (~6–10 files, ~400–700 LOC, plus test files) to TypeScript at minimal v1 scale.

## Constraints
- **Language**: TypeScript for everything — dex `sdk-typescript`, the opencode plugin/harness, scripts, config.
- **Agent runtime**: custom harness in opencode, architecturally similar to oh-my-openagent (skills as TypeScript modules, agents defined in `src/`), driven programmatically via opencode's server/SDK (headless `opencode serve`, official TS client).
- **All roles are opencode sessions** with scoped tools: implementer and fixer get worktree write access; each adversarial reviewer is read-only (no write/edit tools) and emits a structured verdict from the diff alone.
- **Durable orchestration**: dex flows own sequencing and state (attributes); agent calls, reviews, verdicts, and commits are durable steps; local dex server via docker compose or binary; blob store per dex defaults.
- **Minimal v1 scale**: one local dex server, 2 git worktrees, ~4–6 concurrent agents, a single port workflow.
- **Git-safety rules** (from the article): agents may run committing git commands only; stash/reset/checkout-style commands forbidden to agents; slow commands (package installs, test runs) forbidden inside the port loop.
- **Secrets**: provider keys via env vars / local `.env` only — never in source or committed files. TypeSafe access uses `TYPESAFE_API_KEY` from env; every Jev call is itself a durable dex step (covered by AC1 kill+resume).
- **Verification surface**: TypeScript side only (tsc + vitest); the PHP fixture is read-only input — no PHP toolchain required on the machine.
- **Demo fixture**: generated in-repo (scaffolded PHP module), no external PHP codebase needed.

## Non-Goals
- Demo "completing green" (0 typecheck errors, all tests passing) is **not** a v1 acceptance gate — expected direction, but not required.
- Reusable docs / README quickstart / config reference — not required for v1.
- No seeded-bug demo requirement (explicitly rejected as success evidence).
- No article-scale concurrency (4 worktrees × 16 agents), no multi-platform CI matrix, no post-merge fuzzing/PR automation.
- No provider-agnostic abstraction layer beyond opencode's own provider/model configuration.
- No PHP execution, PHPUnit running, or non-TypeScript SDK support.
- No reviewer execution via raw vendor API calls (Round 9 decision: all roles in opencode).

## Acceptance Criteria
- [ ] **AC1 — Durability: kill + resume.** During a demo run, after at least one PHP file has been ported and committed, the dex server and all workers are killed (SIGKILL). After restart, the flow resumes from its last completed durable step, does not re-port or duplicate commits for already-completed files, and reaches its terminal state. An evidence artifact records kill time, resume time, affected step IDs, and which work was skipped vs. redone.
- [ ] **AC2 — Metrics report.** A run produces `metrics/report.md` plus `metrics/report.json` containing: reviewer findings per review round (per file, per reviewer), reviewer agreement/disagreement per file-round, fixer retry counts per file, token usage and wall-clock per file per role, and the typecheck-queue error-count burn-down across iterations.

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "Recreate the setup" means faithful full-scale reproduction | Contrarian/Simplifier: your demo is ~700 LOC, not 535k; success proofs don't need 64 agents | Minimal v1: 1 dex server, 2 worktrees, ~4–6 agents (Round 6) |
| Adversarial reviewers would prove themselves via green tests or seeded bugs | Contrarian Round 4: what if reviewers rubber-stamp? | Success = metrics report + durability proof only; green demo and seeded bugs rejected as gates |
| Demo ports Python→TypeScript | User correction in Round 6 | Port **PHP→TypeScript**; PHP is read-only input, verification on TS side |
| Reviewers as raw in-process API calls (Round 3 hybrid) | Round 8 put the whole stack on opencode — direct conflict | All roles execute as opencode sessions; reviewers read-only with structured verdict output (Round 9) |
| Toolchain needs vendor CLI agents (claude/codex) | Round 8 answer | Custom harness in opencode, oh-my-openagent-style; no vendor CLI dependency |
| Prep docs are port-specific PORTING.md/LIFETIMES.tsv | Repo named "refactoring-toolkit" suggested general refactoring | Demo operation is a port (PHP→TS); engine's core loop stays operation-agnostic, prep component produces port-spec artifacts |

## Technical Context
- Greenfield: repo contains only `.zcodeignore`; no existing code to integrate.
- **dex** (github.com/superdurable/dex): durable execution framework (Temporal/Cadence lineage) — flows are ordinary code with durable Steps, Attributes, RPCs, Channels, Timers; workers host flows; a server dispatches step tasks; attribute data in a blob store. SDKs for Go/Java/Python/Rust/TS; **sdk-typescript chosen**. Pre-launch software: expect breaking changes; pin versions.
- **opencode** (sst): headless server via `opencode serve` (HTTP on 127.0.0.1:4096, OpenAPI), official TypeScript SDK/client, custom agents and tools configured via `opencode.json`/plugin structure; programmatic session creation and provider/model selection.
- **oh-my-openagent**: opencode plugin from the oh-my-claudecode/oh-my-codex creators — skills as TypeScript modules, agents in `src/` — the architectural template for our harness.
- **TypeSafe (docs.typesafe.ai)**: System One judgment model (Jev) via the official JavaScript SDK (`choice`/`noul`/`score`) — used where intelligent judgment replaces complex parsing. Designated integration points:
  1. **Per-symbol type analysis** (LIFETIMES.tsv equivalent): code recall (regex/tokenizer) finds candidate TS types per PHP symbol from docblocks, literals, and signatures; a `Choice` whose options are the candidates selects the intended type (`NONE` escape); verification nouls (SDE-cascade shape) escalate flagged symbols to the implementer agent. (Pre-parsed value extraction + SDE cascade cookbooks.)
  2. **Reviewer-verdict verification**: a noul per finding confirms the cited evidence actually appears in the reviewed diff (citation-check pattern) before the fixer acts; probabilities feed the metrics report.
  3. **Fixer queue prioritization**: a noul per finding separates behavior-changing defects from style preferences (rerank pattern).
  Secondary: batch per-file symbol judgments into single requests (parallel questions); per-file port-quality `Score`s for the metrics report (composite scoring). Deliberate non-integrations: tsc/vitest execution, git/worktree mechanics, and queue state stay pure code; the PORTING.md-style spec map stays generative (full agents).
- Machine: macOS (darwin, arm64); Bun/Node available; uv present (not needed — TS project).
- Proposed defaults (assumptions, not gates): Bun as runtime with Node fallback; repo layout `flows/` (dex flows), `harness/` (opencode plugin: agents + skills as TS modules), `fixtures/php-sample/` (generated PHP demo + ported TS output), `scripts/`, `metrics/`; vitest for ported tests; `tsc --strict` as the compiler-error queue source; docker compose for the dex server if no single-binary dev mode exists.

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| Toolkit | core domain | workflows, entrypoints, config | Toolkit runs Workflows on Source Project |
| Workflow | core domain | name, stages, roles | Workflow spawns Agent Roles; consumes Prep Artifacts and Queues |
| Agent Role | core domain | implementer / adversarial reviewer (read-only) / fixer | Reviewer reviews Diff → Review Verdict; Fixer applies verdict feedback |
| OpenCode Harness | core domain | server, sessions, custom agents, skills-as-TS-modules | Harness executes all Agent Roles; driven by Dex Flow |
| Dex Flow | core domain | steps, attributes, channels, timers | Dex Flow hosts Workflow durably; steps invoke Harness sessions |
| Source Project | external system | ~6–10 PHP files, ~400–700 LOC, read-only | Ported to Output Project |
| Output Project | external system | TS files, typecheck (tsc), tests (vitest) | Target of Queues and Metrics |
| Demo Fixture | supporting | in-repo scaffolded PHP module + tests | Instantiates Source Project |
| Prep Artifact | supporting | PHP→TS spec map (PORTING.md-style), per-symbol table (LIFETIMES.tsv-style) | Guides Agent Roles; adversarially reviewed before use |
| Diff | supporting | file, hunks, base | Input to Reviewer; output of Implementer/Fixer |
| Review Verdict | supporting | findings, severity, disposition | Produced by Reviewer; consumed by Fixer; feeds Metrics Report |
| Metrics Report | supporting | findings/round, agreement, retries, tokens, wall-clock, burn-down | Aggregated from Verdicts and steps |
| Durability Proof | supporting | kill point, resume point, completion evidence | Demonstrates Dex Flow resume semantics |
| Worktree | supporting | branch, isolation | Isolates parallel Workflow runs; enforces git-safety rules |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 7 | 7 | — | — | N/A |
| 2 | 7 | 0 | 0 | 7 | 100% |
| 3 | 9 | 2 (Diff, Review Verdict) | 0 | 7 | 78% |
| 4 | 11 | 2 (Metrics Report, Durability Proof) | 0 | 9 | 82% |
| 5 | 12 | 1 (Output Project) | 1 (Target Codebase → Source Project) | 10 | 92% |
| 6 | 12 | 0 | 0 | 12 | 100% |
| 7 | 13 | 1 (Demo Fixture) | 0 | 12 | 92% |
| 8 | 14 | 1 (OpenCode Harness) | 0 | 13 | 93% |
| 9 | 14 | 0 | 0 | 14 | 100% |
| 10 | 14 | 0 | 0 | 14 | 100% |

## Interview Transcript
<details>
<summary>Full Q&A (10 rounds)</summary>

### Round 0 — Topology
**Q:** Confirm 4 top-level components (core adversarial loop, prep-analysis workflows, verification queue workflows, concurrency harness)?
**A:** All of the above plus durable execution via github.com/superdurable/dex for dynamic subagents and programmatic tool calling. (5th component added.)

### Round 1
**Q:** When built and running, what is it actually doing — reusable toolkit, real codebase, faithful POC, or design doc?
**A:** Reusable toolkit + demo (validated end-to-end on a small sample codebase).
**Ambiguity:** 70% (Goal: 0.50, Constraints: 0.15, Criteria: 0.20)

### Round 2
**Q:** Which dex SDK language?
**A:** TypeScript.
**Ambiguity:** 62% (Goal: 0.50, Constraints: 0.40, Criteria: 0.20)

### Round 3
**Q:** How do subagents invoke the LLM inside dex steps?
**A:** Hybrid — in-process API for reviewers/analysis, CLI agents for implementer/fixer.
**Ambiguity:** 58% (Goal: 0.50, Constraints: 0.55, Criteria: 0.20)

### Round 4 — Contrarian mode
**Q:** What if reviewers catch nothing — what evidence proves the setup works?
**A:** Metrics report + durability proof (seeded-bug demo and green-tests-only both rejected).
**Ambiguity:** 46% (Goal: 0.50, Constraints: 0.55, Criteria: 0.60)

### Round 5
**Q:** What operation does the demo perform?
**A:** Port to TypeScript (initially Python→TS; corrected in Round 6 to **PHP→TS**).
**Ambiguity:** 36% (Goal: 0.75, Constraints: 0.55, Criteria: 0.60)

### Round 6 — Simplifier mode
**Q:** Simplest harness + dex infrastructure that still delivers both success proofs?
**A:** (Also corrected Round 5 to PHP→TS.) Minimal v1: one local dex server, 2 worktrees, ~4–6 agents, single port workflow.
**Ambiguity:** 30% (Goal: 0.75, Constraints: 0.75, Criteria: 0.60)

### Round 7
**Q:** How big is the sample PHP project?
**A:** Small — ~6–10 files, ~400–700 LOC, plus test files; generated in-repo as fixture.
**Ambiguity:** 22% (Goal: 0.80, Constraints: 0.75, Criteria: 0.80)

### Round 8
**Q:** Which agent stack powers the roles?
**A:** Custom harness in opencode, similar to oh-my-openagent.
**Ambiguity:** 19% (Goal: 0.80, Constraints: 0.85, Criteria: 0.80)

### Round 9
**Q:** How do the adversarial reviewers execute — raw API or opencode?
**A:** All roles in opencode; reviewers are read-only sessions, diff-in/verdict-out.
**Ambiguity:** 14% (Goal: 0.85, Constraints: 0.95, Criteria: 0.80)

### Round 10
**Q:** Which acceptance items are hard requirements for v1?
**A:** Durability kill+resume and metrics report only — demo-completes-green and reusable docs not required.
**Ambiguity:** 7% (Goal: 0.90, Constraints: 0.95, Criteria: 0.95) — **threshold met**

</details>
