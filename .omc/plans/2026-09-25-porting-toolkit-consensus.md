# Consensus Plan: refactoring-toolkit v1 — Durable Adversarial Porting Toolkit (dex + opencode + TypeSafe)

- **Status**: **PENDING APPROVAL** — final (v6). Consensus note: Architect approved SOUND-WITH-CHANGES from round 2 onward (rounds 2–5), with the final round's changes being executor-sized clarifications, all folded in below. The codex Critic returned REVISE in all 5 rounds with progressively narrower scope (round 1: 1 CRITICAL + 5 MAJOR incl. a phase-ordering blocker; round 5: 5 specification gaps, no CRITICAL); its round-5 required changes are also folded in below. Full consensus was not reached within the 5-iteration cap; the residual risk is documented in the ADR consequences.
- **Source spec**: [`.omc/specs/deep-interview-dex-opencode-porting-toolkit.md`](../specs/deep-interview-dex-opencode-porting-toolkit.md)
- **Mode**: RALPLAN-DR short | Architect: glm-5.3 via zai (read-only) | Critic: codex (provider override `--critic codex`) | 5 iterations, 2026-09-25

## Requirements Summary

Build a reusable, all-TypeScript toolkit in this empty repo that recreates the Bun-in-Rust article's dynamic-workflow setup at minimal v1 scale: durable multi-agent orchestration where **dex** (`sdk-typescript`) flows sequence the work, a custom **opencode** harness (oh-my-openagent-style plugin: agents and skills as TS modules) supplies the agents — 1 implementer, 2 read-only adversarial reviewers (diff-in, structured-verdict-out), 1 fixer — and **TypeSafe (Jev)** judgments replace complex parsing at designated integration points. The demo ports a generated in-repo PHP fixture (~6–10 files, ~400–700 LOC + tests) to TypeScript, verified by tsc/vitest queues. Hard acceptance gates (user-confirmed): (AC1) durability kill+resume proof; (AC2) metrics report with verifiable provenance. Explicit non-goals: demo-completes-green is not a gate; reusable docs not required; no article-scale concurrency; no vendor CLI agents; reviewers do not use raw vendor APIs.

## RALPLAN-DR Summary

### Principles
1. **Durable by construction** — every agent invocation, Jev judgment, verdict, and file commit is a dex step; nothing orchestrates outside flows. **Agents hold no git access: the toolkit-owned idempotent commit step is the sole committer.** Recovery preserves committed work unconditionally. Durability is designed into step boundaries and reconciliation rules from Phase 0 and re-proven by seed-scale kill smokes at every phase that adds durable-state shape.
2. **Judgment over parsing** — code owns recall/execution/rendering; Jev selects and verifies; full agents generate.
3. **Adversarial independence** — reviewers receive only the diff (delivered by value), hold an explicit tool-deny configuration effective after config+plugin merge, and each review yields a **completed verdict record** (possibly with an empty findings array) that is citation-checked before the fixer spends a cycle.
4. **Minimal v1, config-shaped growth** — 2 worktrees, ~4–6 agents, one flow; scale knobs exist but default low. Recovery is honest within the cap: it proceeds on a healthy worktree or records a blocked state with diagnostics — **a blocked run is a failed AC1 attempt, not a passing outcome**.
5. **Vendor-thin seams + flow-body determinism** — dex, opencode, and TypeSafe sit behind pinned, thin interfaces with naive code-only implementations from day one; the Phase 0 spike (which **owns the minimal lease, commit, and fencing implementations**) is retained as those seams plus regression kill-tests; all nondeterminism lives inside steps — loop and queue state is derived from attributes each iteration.

### Decision Drivers (top 3)
1. The two hard acceptance gates (kill+resume, metrics) — architecture must make them structural outputs of the loop, not bolt-ons.
2. All-TypeScript constraint across dex SDK, opencode plugin, and TypeSafe JS SDK — including scripts and config.
3. Two pre-release dependencies (dex, opencode plugin API) — integration risk dominates implementation risk, retired first with side-effect-real spikes that remain as upgrade regression tests.

### Viable Options

**Option A′ — Layered build with a durability-loaded Phase 0 and a killing trial gate (RECOMMENDED; final after rounds 1–5)**
Repo bootstrap → side-effect-real kill-tested infra spike (retained as seams + regression tests; **implements minimal leasing, sole-committer commit, and fencing itself**) → harness extension → instrumented core loop flow with durable integration step → trial run on 1–2 seed fixture files including a one-shot mid-run kill → widen to prep-analysis, verification queues, Jev swap-in (each exit re-proven by a seed-scale kill smoke) → metrics render + full-fixture chaos last.
- Pros: exactly-once/reconciliation and fencing retired at Phase 0 with real commits, deterministic fault injection, and kill-during-agent-write; spike code retained as production seams + upgrade regression suites; step-boundary mistakes surface at the trial gate; both ACs are pure renders of one event stream anchored to ground truth (git log, dex dispatch log, UTC kill sidecar).
- Cons: ~0.5–1 day spike overhead (amortized: retained; and acknowledged as optimistic for the 0(b)–0(h) exit list); per-step instrumentation/fencing/deny-list tax; fully integrated ceremonial proof still arrives at Phase 6/7.

**Option B′ — Durability-first with real side effects**
Build the complete kill substrate against real commits and live opencode sessions as the first deliverable, then design harness and loop on the proven substrate.
- Pros: strongest early standalone AC1 evidence.
- Cons: substrate proof is isolation-proof — the spec's AC1 requires the kill "during a demo run" of the porting flow itself, so B′ still owes the trial gate A′ already contains; harness/loop design feedback deferred; the kill harness exists twice unless built generally, at which point it *is* A′'s Phase 0 + trial gate.
- *Why A′ wins*: A′ contains B′'s entire substance while adding loop-shaped validation the spec requires anyway.

**Option C — Full vertical slice on the same reusable interfaces**
One PHP file travels the entire pipeline built on the same planned interfaces, then the toolkit widens — C is breadth-first, A′ depth-first.
- Pros: earliest end-to-end integration evidence; every interface exercised from day one.
- Cons: queues, leasing contention, cross-file aggregation, and the metrics renderer land **without a multi-file workload to validate them against** — their debugging is deferred to the widening step, exactly where A′ places its kill smokes; the trial-gate kill would need re-running after widening since the step population changes. The rework claim is "validation deferred twice", not "machinery built twice" (interfaces are shared).
- *Why A′ wins*: both converge to the same components and differ in validation ordering; A′'s depth-first ordering gets kill coverage earlier per durable-state change.

## Architecture (planned layout)

```
.gitignore (.env, metrics/, .worktrees/)          # before any commit
package.json / tsconfig.json / .env.example        # bun or node runtime, pinned deps
docker-compose.yml                                # dex server (+blob store) local dev
src/dex/client.ts                                 # seam over sdk-typescript (spike-retained)
src/harness/opencode.ts                            # seam: sessions, token usage, session-abort
                                                  #   fencing (spike-retained)
src/git/worktree.ts                                # leasing (epoch+base SHA), reconcile(),
                                                  #   sole-committer + integration steps
harness/agents/implementer.ts                     # scoped write tools; NO git access
harness/agents/reviewer.ts                        # explicit tool DENY list; diff by value only
harness/agents/fixer.ts                           # scoped write tools; NO git access
harness/skills/*.ts                               # skills as TS modules (oh-my-openagent style)
flows/port-project.ts                             # the single v1 flow (see Flow contract)
flows/steps/envelope.ts                           # the ONLY step factory (envelope-wrapped);
                                                  #   module-boundary check forbids raw steps
src/queues/tsc-queue.ts / vitest-queue.ts         # grouping; durable queue state in attributes
src/typesafe/symbol-types.ts                      # Choice-over-candidates + cascade (1)
src/typesafe/verdict-check.ts                     # citation-check noul (2) — naive impl first
src/typesafe/prioritize.ts                        # findings rerank noul (3) — naive impl first
src/metrics/agreement.ts                          # deterministic agreement rule behind interface
src/metrics/render.ts                             # report.md + report.json (AC2) from event stream
scripts/run-demo.ts / chaos-kill.ts               # TS entrypoints; kills + evidence sidecar
fixtures/generate.ts                              # deterministic checked-in fixture generator
fixtures/php-sample/**                            # generated PHP fixture (read-only)
fixtures/stub-prep.md                             # checked-in stub prep artifact for trial gate
```

### Commit ownership and integration (sole committer; one output project)

Agents (implementer, fixer) have **no git access**. All git operations are issued by toolkit-owned durable steps in `src/git/worktree.ts`:

- **Commit step (sole committer):** idempotent on a **stable operation ID `file + round`** — the operation ID is the dedup identity; the **content-hash is recorded as evidence** (in the marker and envelope), not as part of the key, so a replay that produces different content still finds the earlier commit. Replay with differing content: operation-ID commit exists → reconcile treats the round as completed and records the content divergence in the evidence stream (visible in the report); only a marker/commit disposition mismatch poisons the lease. Keyed-commit lookup scans **all lease branches** (shared object store), so a redo on a spare or reclaimed worktree still finds a commit landed elsewhere.
- **Integration step:** after a file-round completes, a durable integration step merges its lease branch into the single **`integration` branch — the one output project**. One active file per lease keeps merges conflict-free by construction (disjoint paths); a same-path collision (re-round of a file) integrates as a fast-forward or re-merge with the earlier round's marker reconciled first. **Both verification queues (tsc, vitest) run against the integrated checkout**, so cross-file imports are actually verified. Integration is tested with two files committed on separate leases (Phase 1 unit suite).
- Boundary tests: no agent session can invoke git; every `git log` entry across lease + integration branches matches a keyed commit-step envelope event.

### Flow contract (`flows/port-project.ts`)

1. **Prep** — generate spec map + per-symbol table (Phase 3; stub in Phase 2) → **adversarial review of prep artifacts**: 2 reviewer sessions receive an **artifact-diff** (the generated artifact rendered against the source evidence it claims — a diff view, preserving the diff-only reviewer rule), findings looped back to the generator before the port loop may consume them (spec requirement). **The prep-review loopback runs under the same envelope retry/round caps as the port loop** — its termination is bounded identically.
2. **Per file** (leased worktree): implement (agent writes files, no git) → toolkit diff-capture **step stores the diff as a dex attribute (pass-by-value)** → 2 reviewer sessions in parallel steps → verdict-check → prioritize → fixer (writes, no git) → **commit step** (operation-ID idempotent) → **integration step** (merge to `integration`).
3. **Verify** — tsc and vitest execute as **toolkit-owned queue steps against the integrated checkout, never as agent-session tools**; grouped errors/failings feed the per-file fix loop. **Iteration termination:** a round ends when both queues are empty for all files OR per-file retry caps are hit (durable attributes, enforced in the envelope wrapper).

### State ownership, fencing, and recovery (AC1 mechanism)

- **Dex attributes are the source of truth** (completion markers, queue contents, burn-down, envelope events, verdict records). Git is the side-effect ledger, owned solely by toolkit steps.
- **Completion marker payload (explicit):** `{round, disposition: committed:<op-id> | no-op-empty-diff, content_hash}` — the disposition disambiguates reconcile rows by data, not by reachability argument.
- **Session fencing:** every agent step persists its **opencode session ID (epoch-tagged label) to a durable attribute before prompting**. **Ordered recovery:** epoch bump → abort+confirm persisted session (or enumeration fallback) → lease reclaim → worktree reconcile → re-dispatch. Abort is confirmed **before** any reconcile/reset. **Enumeration fallback:** if the persisted ID is unavailable, enumerate live sessions on the surviving opencode server for affected worktrees and abort all not tagged with the current epoch. `opencode serve` stays outside the chaos blast radius (if it dies anyway, affected leases degrade to the quarantine path — risk table).
- **Intra-step attribute durability** is Phase 0(g)'s recorded decision: if attribute writes inside an *uncompleted* step do not survive SIGKILL, session-ID and envelope-start writes move to a preceding durable mini-step; mini-steps emit envelopes with role `record`; the Phase 5 dispatch reconciliation maps dispatch entries by step type — pre-decided so 0(g)'s outcome cannot force a Phase 5 redesign.
- **Reconciliation decision table** — `reconcile(file, round)` in `src/git/worktree.ts`, a pure function over (marker, keyed commit by op-ID, worktree state). **Reset semantics preserve committed work:** when a keyed commit exists, reconcile resets the worktree **to that commit**; the per-lease base SHA (recorded at acquisition) is used only when no keyed commit exists. One active file per lease:

  | marker | keyed commit (op-ID) | worktree | action |
  |---|---|---|---|
  | present (committed) | present | clean | `skipped` — terminal |
  | present (committed) | present | dirty | restore worktree content from the keyed commit object; `skipped` — terminal; object unreadable → poisoned lease |
  | present (committed) | absent | any | **provenance failure → poisoned lease** (marker says committed but the commit is unfindable across all branches — never silently skip) |
  | present (no-op) | absent | any | `skipped` — legitimate empty-diff round; **assert completed-file content exists in the committed integrated output** (a no-op round presupposes prior committed content) |
  | absent | present | clean | backfill marker from commit key; `skipped` |
  | absent | present | dirty | reset to keyed commit; backfill marker; `skipped` |
  | absent | absent | dirty | reset to lease-base; redo (`redone`) |
  | absent | absent | clean | redo (`redone`) |

  `redone` applies **only** where durable records agree no completed round exists. **Abort/cleanup failure:** abort retried ≤3; if the stale writer cannot be stopped, the lease is **poisoned**; within the 2-worktree cap, if no healthy slot remains, the run is recorded **blocked with diagnostics and the operator unblock procedure** (clear stale sessions, bump epoch, restart) — an honest mid-run state, and **a failed AC1 attempt if it ends the Phase 7 run** (see AC1).
- **Worktree leasing:** durable acquire records holder identity (execution ID) + **epoch** + **base SHA**; stale leases reclaimable; 2-worktree cap enforced at this single point.
- **Kill-time provenance, clock domains, and sidecar ordering:** `scripts/chaos-kill.ts` **writes a kill-intent record (run ID, UTC + monotonic, target PIDs) BEFORE sending SIGKILL, and appends the completion record after**; the recovery pass accepts the intent record as the kill time, so the evidence chain cannot be orphaned by a killer-side crash. **Cross-process ordering assertions use UTC only; monotonic values are compared solely within a single process.** Envelopes carry UTC `started_at`/`ended_at`; the recovery pass closes any envelope with `started_at` and no `ended_at` as `outcome: interrupted, ended_at = kill time from sidecar`.
- **Attempt counts:** Phase 0(f) confirms SDK exposure; else the envelope keeps a durable counter.

### Metrics event contract (AC2 mechanism)

All steps are created via the **single envelope-wrapped step factory**; a module-boundary lint check forbids raw step creation elsewhere. Each execution emits: `{stepId, role, file, round, attempt, started_at, ended_at, outcome: skipped|redone|interrupted|completed, tokens, wall_clock_ms}` — **`tokens` is REQUIRED (non-null) for model-calling steps (agent and Jev roles) and NULL-as-not-applicable for non-model steps (commit, queue, diff-capture, `record`)**; a missing required token value = provenance failure, never zero. **Each reviewer's review yields a completed verdict record**: `{file, reviewer, round, diff_id, findings: [] | [...], citation_check: [{finding_id, p_cited}]}` — an empty findings array is a completed clean review, distinct from a missing record; citation-check probabilities are carried into the report per the spec. Severity classes are a single enum defined in the Phase 1 verdict schema, shared by prompts and fixtures. `src/metrics/render.ts` is a pure function over envelope + verdict + queue burn-down attributes merged with `kill-events.json`. **Agreement rule** (`src/metrics/agreement.ts`), per file+round, derived **only from two completed verdict records**: findings from different reviewers agree iff evidence spans overlap ≥1 diff hunk AND severity classes match; both completed and empty → **agree-clean**; exactly one has findings → **disagree**; any record missing → **unreviewed** (excluded from agreement, surfaced). **Provenance cross-check** reconciles every AC2 field against the raw attribute log and anchors the envelope to dex's dispatch log as a **typed 1:N mapping** (retries): every envelope step ID must appear as ≥1 dispatch entry of matching type; dispatch entries without envelopes must all be non-agent kinds (timer/condition/channel/record). **Dispatch-log exposure is proven in Phase 0(h)**, not first exercised in Phase 5.

### Reviewer isolation enforcement

Reviewer agents carry an **explicit deny list**: bash/shell, git, file read/write/edit, glob/grep, subagents/task, web fetch, all MCP tools — **effective permissions tested after config + plugin merge**. Config test: merged reviewer agent has zero effective tools. Runtime probes: denied-tool invocations refused; sessions never touch worktree paths. The diff arrives as prompt state (by value); prep-artifact reviews receive the artifact-diff view described in the Flow contract. **Citation-check scope:** detects findings whose cited evidence does not appear in the reviewed diff; validity signal comes from agreement tracking plus fixer outcome.

## Implementation Steps

0. **Phase −1 — Repo bootstrap**: `git init`, baseline commit, `.gitignore` (.env, metrics/, .worktrees/).
1. **Phase 0 — Infra spike (side-effect-real, retained as seams; owns the minimal implementations it tests)**: implements **minimal worktree leasing (epoch + base SHA), the sole-committer operation-ID commit step, the integration step, and session fencing**. Exit criteria: (a) dex server runs locally; (b) hello flow survives SIGKILL of server AND workers; (c) multi-minute step survives the same kill; (d) commit crash window (deterministic fault injection) resumes with no duplicate; (d2) **commit-exists + stale-writer-dirties-worktree crash test: keyed commit remains reachable at HEAD afterward**; (d3) **differing-content replay across a quarantined lease: op-ID dedup holds, divergence recorded**; (e) opencode round-trip with token usage plus kill during an in-flight agent write demonstrating ordered recovery; (f) attempt-count exposure; (g) intra-step attribute-write durability decision (mini-step fallback pre-decided, role `record`); (h) **dex dispatch-log exposure confirmed** (interface for Phase 5 anchoring exists).
2. **Phase 1 — Harness extension and validation**: extends/validates Phase 0 implementations into the full harness — agent roles (no git), verdict schema **with the severity enum**, skills as TS modules, complete deny lists + effective-permission tests, agent-cannot-commit boundary test, **integration test with two files on separate leases**, quarantine→spare test asserting no second op-ID commit (incl. differing content).
3. **Phase 2 — Core loop flow (instrumented)**: flow per contract consuming `fixtures/stub-prep.md`; envelope factory everywhere; diff pass-by-value; naive `verdict-check`/`prioritize`; reconcile(); seed fixture via `fixtures/generate.ts` (deterministic, checked-in — never agent-generated).
4. **Trial-run gate**: Phase 2 loop end-to-end on seed fixture; one observed reviewer-pair + fixer cycle; one-shot mid-run kill with successful resume, no duplicate commits, no dirty-worktree deadlock.
5. **Phase 3 — Prep-analysis**: spec map via implementer; per-symbol table via symbol-types.ts; prep-review wiring (artifact-diff, capped loopback); Jev swap-in. **Exit: seed-scale kill smoke incl. a kill during a Jev call.**
6. **Phase 4 — Verification queues (wired)**: queues run against the integrated checkout and feed the per-file fix loop with the termination rule; durable queue/burn-down state. **Exit: seed-scale kill smoke.**
7. **Phase 5 — Metrics**: render + agreement rule + typed provenance cross-check.
8. **Phase 6 — Durability proof**: `scripts/chaos-kill.ts` on the integrated flow; asserts resume completes, completed files skipped with zero new implementer invocations, no duplicate commits, evidence log from merged sidecar + envelope stream.
9. **Phase 7 — Fixture at scale**: full PHP fixture via `fixtures/generate.ts`; full demo run **includes the AC1 kill**; collect AC1/AC2 evidence.

### Dependency diagram (when inputs become available)

```
Phase −1: git repo + ignores
Phase 0: dex server; seams incl. MINIMAL leasing/commit/integration/fencing (owned, retained)
Phase 1: full harness EXTENDING Phase 0 implementations (roles, schema+enum, deny lists,
         boundary + integration + quarantine tests)
Phase 2: core flow + envelope factory + stub prep + scripted seed fixture + naive impls
   └─ Trial gate (needs: Phase 2 only) ← inputs exist by construction
Phase 3: real prep + prep-review (artifact-diff, capped) + Jev swap-in + kill smoke
Phase 4: queues on integrated checkout + kill smoke
Phase 5: metrics render (needs: event stream; dispatch-log interface proven in 0h)
Phase 6: chaos on integrated flow (needs: Phases 2–5)
Phase 7: full fixture + final demo run incl. AC1 kill (needs: all)
```

## Acceptance Criteria

**Hard gates (user-confirmed):**
- [ ] **AC1 — Durability**: during a demo run (Phase 7), after ≥1 file is ported+committed, dex server and workers are SIGKILLed; after restart the flow **resumes and completes its intended terminal path** — completed files are skipped with **zero new implementer invocations** (envelope-verified); **every pre-kill commit remains reachable** (branch HEAD or integration branch, verified explicitly); **completed-file content exists in the committed integrated output**; no duplicate commits (op-ID dedup); the ordering-asserted evidence artifact (UTC kill sidecar with intent-before-kill ordering + envelope stream) records kill/resume times, step IDs, and skipped-vs-redone-vs-interrupted work. **A run that ends blocked is a FAILED AC1 attempt** (diagnostics + unblock procedure recorded), not a pass.
- [ ] **AC2 — Metrics**: a run produces `metrics/report.md` + `metrics/report.json` containing reviewer findings per round (per file, per reviewer), reviewer agreement/disagreement (deterministic rule incl. agree-clean and unreviewed), **citation-check probabilities**, fixer retry counts per file, tokens + wall-clock per file per role (**for model-calling roles; non-model steps N/A**), and typecheck-queue burn-down across iterations — every value reconciled against the same run's raw attribute log, envelope anchored to dex's dispatch log via typed 1:N mapping; missing required token usage = fail.

**Engineering hygiene gates (toolkit's own code, distinct from the rejected demo-green gate):**
- [ ] Toolkit code passes `tsc --strict` and its own unit tests (queue grouping, renderers, agreement rule incl. agree-clean/unreviewed/one-sided, verdict schema + severity enum, worktree rules, full reconcile() table incl. commit-preservation and provenance-failure rows, integration of two files on separate leases, reviewer effective-permission isolation, agent-cannot-commit boundary, step-factory completeness lint).

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| dex TS SDK breaking changes (pre-release) | High | Pin exact versions; seams isolated; Phase 0 kill tests retained as upgrade regression suites |
| Crash-window double commit | High | Sole-committer op-ID idempotent step + deterministic fault injection (0d); re-asserted at gate, smokes, Phase 6 |
| Recovery strands/removes a completed commit | High | Reconcile preserves keyed commits (reset-to-commit, never past); 0(d2) reachability test; AC1 HEAD/content assertions |
| Differing-content replay breaks dedup | Medium | Op-ID (file+round) is identity; content-hash is evidence; 0(d3) quarantine replay test; divergence surfaced in report |
| Stale/dirty writer after kill | High | Ordered recovery + fencing + enumeration fallback; kill-during-write tested (0e) |
| Abort failure within the 2-worktree cap | Medium | Poison lease; if no healthy slot remains, record blocked state with diagnostics + unblock procedure (failed AC1 if terminal) |
| opencode server inside kill blast radius | Low-Med | Chaos kills scoped to dex PIDs; degradation path = quarantine/blocked (documented) |
| Intra-step attribute writes not durable | Medium | Phase 0(g) decision with pre-decided mini-step fallback (role `record`) |
| dex dispatch log not exposed as assumed | Medium | **Phase 0(h) proves exposure** before Phase 5 depends on it |
| Worktree collisions | Medium | Epoch+base-SHA leasing, stale reclaim, single enforcement point |
| opencode plugin API churn | Medium | Pin; declarative defs; seam; mandatory token-usage interface field |
| Jev misjudges a PHP symbol's type | Medium | NONE escape; cascade escalation; measured spot-check: n≥30 vs human ground truth, ≥90%, owner = Phase 3 dev lane |
| Metrics fabricated/empty values pass | Medium | Per-field provenance incl. findings/agreement/citation probabilities; typed dispatch anchoring; missing required tokens = fail |
| Reviewer tool leakage (default-enabled tools) | Medium | Deny list on effective post-merge permissions + runtime probes |
| Agent commits outside the step | Medium | No-git deny for all agents + boundary test + sole-committer design |
| Cost/runaway loops | Medium | Retry/round caps in envelope (incl. prep loopback); queue termination rule; concurrency caps |
| Local infra friction | Low-Med | compose defaults; binary fallback documented |

## Verification Steps

1. Phase 0 exit tests: (b) SIGKILL resume; (c) long-step survive; (d) fault-injected commit window — no duplicate; (d2) commit + stale-writer — commit reachable; (d3) differing-content replay across quarantine — op-ID dedup holds; (e) kill-during-write — ordered recovery; (f) attempt counts; (g) attribute-durability decision; (h) dispatch-log exposure.
2. Unit tests: queue grouping, renderers, agreement rule (agree-clean / one-sided / unreviewed), verdict schema + severity enum, worktree denylist, full reconcile() table (incl. provenance-failure and no-op rows), **two-file separate-lease integration**, reviewer isolation config, agent-cannot-commit boundary, quarantine→spare no-second-commit (incl. differing content), step-factory completeness lint.
3. Trial-run gate: full loop + kill + resume on seed fixture.
4. Phase 3/4 kill smokes (Phase 3 includes kill during a Jev call): resume-completes / no-duplicates / no-deadlock.
5. Full demo run (Phase 7) incl. AC1 kill: **run resumes and completes its intended terminal path** (blocked = failed attempt); zero new implementer invocations for completed files; post-recovery HEAD/keyed-commit reachability and completed-content presence in the integrated output verified; no duplicate op-ID commits; ordering-asserted evidence log.
6. AC2 provenance cross-check: every field reconciled to the same run's attribute log; envelope↔dispatch typed 1:N mapping holds; missing required token usage fails.
7. Reviewer isolation runtime: effective permissions zero; probes refused; no worktree access. Chaos TS entrypoint SIGKILL + intent-before-kill evidence-writing behavior verified.

## ADR

- **Decision**: Option A′ — layered build with durability-loaded, seam-retained Phase 0 that owns the minimal lease/commit/integration/fencing implementations; sole-committer commit step with operation-ID identity (content-hash as evidence); durable integration step producing one output project verified by the queues; commit-preserving reconcile() with explicit marker dispositions; single envelope step-factory typed-anchored (1:N) to dex's dispatch log; completed-verdict records (empty-findings ≠ missing); killing trial gate; seed-scale kill smokes; honest blocked semantics (blocked ≠ AC1 pass); dex + opencode + TypeSafe composition with naive-impl interfaces; all-TypeScript including scripts.
- **Drivers**: (1) both hard ACs as structural outputs anchored to ground truth; (2) all-TypeScript constraint; (3) pre-release dependency risk retired first and kept retired via retained regression suites.
- **Alternatives considered**: B′ durability-first with real side effects — equals A′'s Phase 0 in substance but still owes the loop-shaped kill validation the spec's AC1 requires. C full vertical slice on shared interfaces — same components, different validation ordering; defers multi-file validation to the end.
- **Why chosen**: A′ uniquely combines early exactly-once/fencing proof with commit-preserving recovery and a real integrated output, per-durable-state-change kill re-validation, evidence-as-render anchored to git log + dispatch log + UTC sidecar, and honest terminal-state semantics — at minimal v1 scale.
- **Consequences**: ~0.5–1 day spike overhead (acknowledged optimistic) amortized into retained seams; per-step instrumentation tax; recovery complexity centralized; evidence quality depends on envelope completeness, structurally enforced; **consensus caveat: the codex Critic did not return APPROVE within 5 iterations — residual risk concentrates in first-contact implementation details of dex/opencode (Phase 0 exists precisely to surface them), not in the plan's structure per the Architect's rounds 2–5 verdicts.**
- **Follow-ups**: scale-up knobs; article-scale error clustering deferred; **spec's secondary TypeSafe integrations (batched per-file symbol questions, per-file port-quality Scores) deliberately deferred to keep v1 minimal — recorded, not forgotten**; reusable docs out of scope per spec non-goals; **ODW fork (siddicky/dynamic-workflows-dex, ≡ upstream) evaluated 2026-09-25 — adopt nothing wholesale (see `.omc/research/odw-evaluation.md`): ADAPT early-error-bail + empty-text-retry-class + text-only reviewer default in the opencode seam, deterministic completeness-check for Phase 3 prep artifacts; REJECT ODW engine/opencode-plugin/SQLite-substrate/script-as-orchestrator (its resume is cooperative-stop + replay-cache, not SIGKILL survival — strictly weaker than our proven op-ID + reconcile design; the script layer is coherent only as a future compiler to dex steps, recorded as the v2 boundary, never as an interpreter-over-cache)**.

## Changelog

- v1: initial snapshot.
- v2: sequencing fix; side-effect-real Phase 0; state ownership; envelope; diff-by-value; prep-review wiring; queue wiring; provenance; isolation; B/C correction; dependency diagram.
- v3: repo bootstrap; session fencing; fault injection; reconcile table; envelope timestamps; verdict records + agreement; zero-new-implementer AC1; kill sidecar; effective-permission deny list; Phase 3/4 smokes; determinism rule; lease epochs; measurable Jev spot-check; ADR.
- v4: sole-committer; 8-row reconcile; TS chaos entrypoint; UTC+monotonic sidecar; B′ fair comparison; agree-clean; Jev-call kill smoke; 0(g); enumeration fallback; step factory + dispatch anchoring; toolkit-run queues; scripted fixtures; spike-as-seams.
- v5: commit-preserving reconcile (reset-to-commit); 0(d2); completed verdict records (empty ≠ missing); Phase 0 owns minimal implementations; honest blocked semantics; fair Option C; citation probabilities in contract; branch-scan lookup + quarantine test; UTC-only ordering; mini-step policy + typed mapping; severity enum; blast-radius risk row.
- v6.1 (user-approved scope addition, 2026-09-25, mid-execution): **live status web dashboard** — agents × worktrees × tasks grid, queue burn-down chart, commit stream, kill/resume timeline — as a pure render over the existing envelope/verdict/burn-down/kill-events streams plus read-only git/dex queries (`src/dashboard/**`, `scripts/serve-status.ts`, zero new deps, poll-based). Not an acceptance gate; dex's own web UI remains the deep-dive surface. Added by explicit user request; runs parallel to Phase 1+2 work.
- v6 (final; post round-5 synthesis, max-iterations exit): **durable integration step — lease branches merge into one `integration` output project; queues verify the integrated checkout; two-file separate-lease integration test**; **commit identity = stable operation ID (file+round); content-hash demoted to evidence; differing-content replay tested across quarantine (0d3)**; **marker payload explicit (disposition); marker-committed-but-commit-absent = provenance failure → poisoned lease; no-op rows assert completed content exists in output**; **AC1 passes only on resumed-and-completed; blocked = failed attempt with diagnostics + unblock procedure**; **token usage required for model-calling roles only, N/A for non-model steps; provenance totals over eligible calls**; dispatch-log exposure proven in Phase 0(h); sidecar intent-before-kill write ordering; prep-review artifact-diff (preserves diff-only rule) under capped loopback; dispatch mapping typed 1:N; secondary Jev integrations recorded as deliberate deferrals; spike-estimate honesty note.
