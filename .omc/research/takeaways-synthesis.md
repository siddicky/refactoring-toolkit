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
