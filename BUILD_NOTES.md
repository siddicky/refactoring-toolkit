# BUILD_NOTES — Phase 0 (infra spike, side-effect-real, retained as seams)

Continuation build completed 2026-09-25 by worker-1b (taking over worker-1's partially
landed Phase 0). All Phase 0 exit criteria 0(a)–0(h) were executed against live
infrastructure. No results are faked; every claim below names the command and evidence.

> **Reading note (2026-09-30).** This file is a historical log, written before the
> 2026-09-30 audit. Where the code has since changed a statement below, an italic
> `Superseded 2026-09-30` note follows it and the original wording is left as
> written. Current behaviour is in `README.md`, `AGENTS.md`,
> `.agents/skills/porting-toolkit-migration/references/runner.md`, `.env.example`
> and `fixtures/FIXTURES.md`; where this file disagrees with the code, the code
> wins. Test files named below (`tests/phase0-seams`, `phase1-isolation`,
> `phase2-flow`, `verify-fix`, `dashboard-stream`, `reconcile`, `opid-seam`) were
> moved and renamed; `tests/README.md` describes the current layout.

## Environment (exact versions)

| Tool | Version | Status |
|---|---|---|
| bun | 1.3.14 | runtime + test runner |
| typescript | 5.9.3 (`tsc --noEmit`, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`) | clean |
| @superdurable/dex | 0.12.1 (pinned in package.json) | works against dexcli below |
| dexcli (dex server) | v0.13.5 (commit 61910c8dea9b37a34fcbff129041cd74083d351f, built 2026-09-25) | local binary |
| @opencode-ai/sdk | 1.18.32 (pinned) | matches CLI below exactly |
| opencode CLI | 1.18.32 | `opencode serve` on 127.0.0.1:4096 |
| @typesafe-ai/sdk | 0.6.0 (pinned) | Phase 3 dependency; offline double used in tests |
| @types/bun | 1.3.14 | provides real `bun:test` types |
| docker | 29.4.0, daemon UP | **no official dex image exists** — compose file is a documented seam |

dex server: `dexcli dev -open=false` (gRPC 127.0.0.1:8801, web :8802, embedded
SQLite + blob store under `~/.dex/dev/<n>/`). Health: `dexcli health` → `{"condition":"OK"}`.

## What was completed in this continuation

1. **Inventory of worker-1's landed work**: core seams (src/git/worktree.ts, src/harness/opencode.ts,
   src/dex/client.ts, flows/steps/envelope.ts, scripts/{chaos-kill,run-demo,probe-flow}.ts,
   tests/{phase0-seams,reconcile,opid-seam}.test.ts) were complete and 87/87 tests passed;
   typecheck had 60+ errors in worker-3 slices and 2 test files.
2. **Integration fixes (my scope)**:
   - Deleted stale `src/typesafe/bun-test.d.ts` ambient shim (+ its 6 `/// <reference>` lines);
     `@types/bun` in tsconfig `types` provides the real `bun:test` module. Fixes `.not`/`.any` errors.
   - `exactOptionalPropertyTypes` fixes: conditional-spread optional fields
     (`instructions`, `model`) in src/typesafe/{client,prioritize,verdict-check,symbol-types}.ts.
   - `noUncheckedIndexedAccess` fixes: guarded array/record indexing in src/metrics/agreement.ts,
     src/typesafe/* (answers lookups now throw a descriptive error instead of silently using
     `undefined`), and test files (optional chaining after length assertions).
   - NodeNext JSON import attributes (`with { type: "json" }`) in src/metrics/render.test.ts.
   - Severity enum single-sourced: canonical definition stays in
     `harness/agents/verdict-schema.ts` (`SEVERITIES`); `src/metrics/types.ts` re-exports it as
     `SeverityClass`/`SEVERITY_CLASSES` (plan: "single enum defined in the Phase 1 verdict schema").
   - flags NOT weakened anywhere; all fixes are local to the error sites.
3. **Live-infra fixes surfaced by running the exits** (all inside my scoped files):
   - `src/dex/client.ts`: dex `startFlow` requires `worker_target`; the Client now passes
     `workerTarget: { address }` (default `127.0.0.1:8803`, env `DEX_WORKER_TARGET`).
   - `flows/steps/envelope.ts`: **heartbeats**. dex kills a Step attempt when no heartbeat
     arrives within `heartbeatTimeoutMs` (server default 60s) — observed live as endless
     `backendError: "Heartbeat"` retries of a 90s sleep step. The envelope now records
     heartbeats every 15s during inner work (0(c) mechanism), and both factories expose
     `getStepOptions()` so steps can pass dex StepOptions.
   - `scripts/probe-flow.ts`: dex requires AttributeMap READS to be declared per step —
     added `stepOptions: { executeLoadAttributeMaps: [...] }` to the steps that read the
     session fence and completion markers (error was
     `AttributeMap instance was not loaded for this invocation`).
   - `scripts/run-demo.ts`: fixed the 0(d3) selftest assertion (the script performs a naive
     second commit deliberately; correct assertions are "op-ID lookup still returns the
     ORIGINAL commit" + "the naive duplicate is detectable (2 commits), divergence recorded").

## Verification (fresh, final)

- `bun run typecheck` → clean (0 errors).
- `bun test` → 87 pass, 0 fail, 237 expect() calls, 14 files.

## Exit criteria scorecard 0(a)–0(h)

| # | Criterion | Verdict | Evidence |
|---|---|---|---|
| a | dex server runs locally | **PASS** | `dexcli dev -open=false`; `dexcli health` → OK; `dexcli api list` returns the full FlowService surface. No official docker image exists (compose file documents this honestly). |
| b | hello flow survives SIGKILL of server AND workers | **PASS** | Started `long-kill-test` + `hello-prekill` (completed). chaos-kill SIGKILLed dex server + worker (intent-before-kill sidecar: /tmp/kill-events-phase0.jsonl, both PIDs exited). Server restarted **on the same SQLite DB** (`-sqlite-db-filename`), worker restarted; flow resumed with the SAME runId `01a0da10…` and completed; `hello-postkill` completed on recovered infra. |
| c | multi-minute step survives the same kill | **PASS** | The 90s `ProbeLongSleep` step survived the server+worker SIGKILL and completed after restart (`FLOW_STATUS_COMPLETED`, close 19:45:59Z, run started 19:35:34Z pre-kill). Required the heartbeat fix above (without it dex retries forever). |
| d | commit crash window — no duplicate | **PASS** | Live via dex: `PORTING_KIT_FAULT=commit:post-commit:src/a.php#1` worker SIGKILLed itself AFTER the keyed commit landed, BEFORE the marker decision. After clean-worker restart the flow completed: exactly **1** commit with `Operation-ID: src/a.php#1` across all branches; envelope `probe-commit#7` outcome `skipped` (dedup branch); completion marker `disposition: committed:src/a.php#1` carrying the original commit's content hash. git-selftest also ALL PASS. |
| d2 | commit-exists + stale-writer-dirty → commit reachable at HEAD | **PASS** | git-selftest: stale writer dirties the worktree after the keyed commit; reconcile → skipped; `applyReconcile` resets TO the keyed commit; worktree HEAD == keyed commit SHA, worktree clean. Unit-tested in tests/opid-seam.test.ts. |
| d3 | differing-content replay across quarantine — op-ID dedup holds | **PASS** | Quarantined lease (worktree removed, branch+objects retained); spare worktree at new epoch replays the same op-ID with different content: `findCommitByOpId` still returns the ORIGINAL commit (identity = op-ID, content-hash is evidence); a naive second commit would be detectable (exactly 2 op-ID commits, distinct tree hashes = recordable divergence). Proven at git-seam level (git-selftest + unit test); the live dex path exercises the dedup branch (0d evidence). |
| e | opencode round-trip with token usage + kill during agent write with ordered recovery | **PASS** | Round-trip: `run-demo.ts agent-roundtrip` → session `ses_f25dfe46…`, reply "OK", usage `{input:56229, output:3}` (opencode 1.18.32 live). Kill-during-write: worker with REAL harness SIGKILLed itself mid-write (`agent-write:mid` fault) AFTER the fence persisted; partial file confirmed on disk; NO round-2 commit existed. Ordered recovery: epoch bump → enumeration-fallback abort confirmed aborting the real foreign session (`aborted 1 foreign session(s): ses_f25dfe46…`) → lease reclaim at epoch 2 → reconcile → re-dispatch; flow resumed through a REAL model call (envelope `probe-agent-write#11`, role `agent`, `tokens: 100007`, 229s wall clock), committed round 2 exactly once, integrated into `integration` (content = round 2). |
| f | attempt-count exposure | **PASS** | SDK exposes `Context.attempt` (typecheck-enforced; used by the envelope event key). Live match: envelope event `attempt: 7` / `attempt: 11` == dispatch entry `finalAttempt: 7` / `11` in `dexcli flow history`. |
| g | intra-step attribute-write durability decision | **DECIDED: mini-step fallback REQUIRED** | Empirical: attempts 2–7 of the killed long-step each staged `envelopeEvents.set(...)` at start; durable history contains ONLY the completing attempt's event (`envelope-event/probe-long-sleep#8`). Staged attribute writes inside an uncompleted step do NOT survive. Therefore session fences / envelope-start writes that must survive use the pre-decided fallback: a preceding durable mini-step (`recordStep`, role `record`) — already implemented and proven live (the fence attribute persisted across the mid-write SIGKILL). |
| h | dex dispatch-log exposure | **PASS** | `dexcli flow history` (FlowService.GetHistoryEvents) exposes the full durable event stream per flow: `stepType`, `stepExecutionId`, `finalAttempt`, `startedTime`, `duration`, retry failure info, step decisions, AND the envelope attribute upserts. This is exactly the typed 1:N mapping surface Phase 5 needs (every envelope step ID anchors to ≥1 dispatch entry of matching type; retries visible as multiple attempts). |

*Superseded 2026-09-30 (row e): recovery no longer aborts every foreign
session. `abortSessionsNotTagged` aborts only OpenCode sessions whose title
starts with `porting-kit:` and whose trailing `#<epoch>` is not the new epoch,
plus toolkit-titled sessions with no epoch. The evidence session
`porting-kit:agent-roundtrip` is still aborted that way; a session without the
`porting-kit:` prefix is never aborted.*

## Notable pre-release findings (retained as regression knowledge)

1. dex `startFlow` fails `worker_target is required` unless ClientOptions carries `workerTarget`.
2. dex Step handlers must heartbeat at least every `heartbeatTimeoutMs` (default 60s) or the
   attempt is failed and retried — long steps MUST use the envelope's heartbeat loop.
3. dex requires AttributeMap reads to be declared via `executeLoadAttributeMaps` step options;
   writes are staged automatically but only persist WITH the step's decision.
4. `dexcli dev` creates a NEW SQLite DB per invocation; restart-into-recovery requires
   `-sqlite-db-filename <original db> [-blob-store-dir <original blobs>]`.
5. opencode 1.18.32 CLI and SDK versions align; token usage IS exposed on the assistant
   message (`info.tokens.input/output`, `info.cost`) and extracted by the harness seam.

## Live evidence artifacts

- Kill sidecar (intent-before-SIGKILL ordering, UTC + monotonic): `/tmp/kill-events-phase0.jsonl`
  *Superseded 2026-09-30 (every kill-sidecar mention in this file): the writer
  default is now `metrics/kill-events.jsonl` (JSON Lines, relative to the cwd,
  parent directory created on first write) for both `chaos-kill` and
  `watch-queue-verify`. Completed rows carry `fired` (`killed_pids.length > 0`),
  with an explicit `NO-OP:` note when nothing was killed. `flow_run_id` is the
  real Dex run id (from `dexcli flow summary`), never the flow id. The
  `/tmp/kill-events-*.jsonl` paths below stay as recorded history.*
- Round repo with op-ID commits + integration branch: `/tmp/pk-round-repo`
- dex flow evidence: `dexcli flow history long-kill-test`, `…round-src__a.php-1-1-1790365770974`,
  `…round-src__a.php-2-1-1790365979028`
- Server/worker logs: `/tmp/dex-server*.log`, `/tmp/worker-*.log`

---

# TRIAL GATE — Phase 1+2 (plan §Implementation Steps 2–4)

Completed 2026-09-25 by worker-1b. Seed: **2 files** per FIXTURES.md guidance —
`src/Money.php` + `src/Pricing/FlatRateDiscount.php` (cost guard respected;
~6 real model turns per full file cycle). Commit: see git log.

## What landed

**Phase 1 — harness wiring + isolation**
- `src/harness/runtime.ts` (NEW): the bridge between the data-only agent
  definitions (harness/agents/*) and the opencode seam — effective-permission
  merge (deny authoritative), per-turn server-side `tools` overrides,
  diff parse/render with shared line numbering, JSON + code-fence extraction,
  verdict intake (validate via verdict-schema, map onto metrics Finding with
  hunk-resolved evidence spans, citation fallback to naive check).
- Reviewer effective-permission test: merged reviewer agent has ZERO effective
  tools (config level) + every turn carries the enforced refusal policy AND a
  server-side all-false tools map (runtime level).
- Agent-cannot-commit boundary tests: agent modules import no git tooling /
  dex step creation; sole-committer entry points imported only by flows/,
  scripts/, src/git/, tests/ (structural lint over the tree).
- Quarantine→spare test: differing-content replay on a spare lease commits
  exactly ONE op-ID commit (dedup identity holds; content-hash recorded as
  evidence — `commitLeaseChanges` now writes the Content-Hash trailer via
  `git write-tree`, a real seam gap found and fixed).
- Two-files-on-separate-leases integration test: both lease branches merge
  into the one `integration` output branch, conflict-free, idempotent.
- ODW hardenings folded in (all three): early upstream-error bail
  (`OpencodePromptError`, retryable vs provenance classes), empty-reply
  classified as its own retryable failure, reviewer sessions launch on a
  read-only agent via `OPENCODE_REVIEWER_AGENT` (default unset).

**Phase 2 — core loop (`flows/port-project.ts`, NEW)**
- Prep consumes `fixtures/stub-prep.md` (source-map table parsed; glob rows
  ignored), per-file: lease (durable pp-lease store bound to WorktreePool —
  cap + stale reclaim reused wholesale) → fence mini-step (0(g)) → implement →
  diff-capture (staged diff stored BY VALUE as dex attribute) → review-A →
  review-B (independent sessions, verdict attributes) → naive verdict-check
  (citation check; drops uncited/wontfix) → naive prioritize → fixer → op-ID
  commit step → integration step → release → dispatch loop → final.
- Envelope factory everywhere; retry caps (model steps: maximumAttempts 3);
  round caps durable (pp-config); queue state durable (pp-queue), derived
  each iteration.
  *Superseded 2026-09-30: model, review and marker steps now retry with
  `RESTART_WINDOW_RETRY` (`maximumAttempts` 8, flows/port/step-options.ts). The
  in-step `REVIEW_STEP_MAX_ATTEMPTS = 3` is a separate tombstone bound,
  independent of the dex retry budget. The accounts of the old budget at the
  `PpPrepReviewA-3` exhaustion and the cx7 restart window are history and
  stand.*
- New envelope roles `verdict-check` / `prioritize` (code-only, non-model);
  `EnvelopeStepClass` alias for cycle-safe step typing.

## Trial-gate run (live evidence)

- Flow: `trial-5`, runId `01a0daa4-3170-7213-8886-5480f23a409f`, project repo
  `/tmp/pk-trial`, epoch 1, maxRounds 1, worker `--flows port --harness auto`.
- **Observed reviewer-pair + fixer cycle**: BOTH files ran the full pipeline
  — Money: implement (281s, 68278 tok) → reviewA → reviewB → verdict-check →
  prioritize → fixer → commit; FlatRate: same, mid-fixer at kill time.
- **ONE mid-run kill**: `scripts/chaos-kill.ts` SIGKILLed dex server (pid
  24198) + worker (pid 39936) at 2026-09-25T22:37:28Z with intent-before-kill
  sidecar `/tmp/kill-events-trial.jsonl` (intent utc 22:37:28.816 → completed
  22:37:28.871, all targets exited).
- **Resume**: dex restarted on the SAME SQLite DB
  (`-sqlite-db-filename ~/.dex/dev/7233/dex.sqlite.db`), worker restarted;
  the in-flight FlatRate fixer retried post-restart and completed; commit →
  integrate → release → dispatch. Flow reached `FLOW_STATUS_COMPLETED` at
  23:02:24Z.
- **Assertions (all PASS)**:
  - exactly 2 op-ID commits across all branches (one per file):
    `1514482` (Money), `34c71ce` (FlatRate) — no duplicates despite kill+retries;
  - `integration` branch carries both ported TS files (real ported content);
  - no dirty-worktree deadlock: both leases released, worktrees clean;
  - envelope stream + dispatch history intact (`dexcli flow history trial-5`).

## Findings & deviations (honest record)

1. **Reviewer turns are sequential durable steps**, not `goToMany` parallel
   movements — convergence semantics for scheduled branches are undocumented
   in dex 0.12. Independence preserved via separate sessions/attributes.
2. **Bridge-mode tool mediation (live leak found and closed)**: writer agents
   on opencode's `build` agent (server cwd = the toolkit repo, write tools
   enabled) wrote their "output path" files directly INTO the toolkit repo
   instead of only replying. Fix: v1 runs EVERY agent turn with the entire
   server-side tool surface disabled (`toolOverridesAllOff`); the toolkit
   mediates all writes into the lease worktree and is the sole git operator.
   Writer "scoped write tools" are therefore toolkit-mediated in v1.
3. **Reviewer latency**: the user's default opencode agent (max-reasoning
   variant) took ~25-30 min per review turn and its `session.prompt` resolves
   before completion — the seam now polls the session to completion
   (`OPENCODE_PROMPT_WAIT_MS`, default 15 min; trials used 90 min) and
   reviewers default to `OPENCODE_REVIEWER_AGENT` (trials used `plan`, ~45 s
   per turn). Three trial attempts (trial-2/3/4) failed on token provenance
   before these were in place; trial-5 is the clean gate run.
   *Superseded 2026-09-30: `OPENCODE_PROMPT_WAIT_MS` is read at call time (the
   default is still 15 minutes). `OPENCODE_PROMPT_CALL_TIMEOUT_MS` (default 20
   minutes, a hard ceiling on one `session.prompt` call) is used exactly as
   written, with no scaling; an invalid value (not a whole number, <= 0 or above
   24 hours) falls back to the default. `OPENCODE_REVIEWER_AGENT` is an optional
   override, not a default. All of these are listed in `.env.example`.*
4. **Envelope event keys collide across step EXECUTIONS** (`${stepId}#
   ${context.attempt}` — attempt resets per re-entry, so a re-entered
   dispatch overwrites its earlier event). Harmless for the gate; Phase 5's
   typed 1:N mapping should key on (stepId, executionId) once exposed.
5. Worker-side diagnostics (`[opencode] poll …` console.error lines) remain
   in the seam intentionally — they are the fastest way to see provider-queue
   stalls during Phase 3+ kill smokes.

## Evidence paths (trial gate)

- Kill sidecar: `/tmp/kill-events-trial.jsonl`
- Project repo (commits, integration branch, worktrees): `/tmp/pk-trial`
- Flow evidence: `dexcli flow summary/state/history trial-5`
- Worker/server logs: `/tmp/worker-trial*.log`, `/tmp/dex-server*.log`
- Suites: `tests/phase1-isolation.test.ts`, `tests/phase2-flow.test.ts`

## Final verification (fresh)

- `bun run typecheck` → clean (0 errors).
- `bun test` → 142 pass / 0 fail (17 files; includes worker-5 dashboard suites).

---

# VERIFY-FIX — team-verify wave 1 (fix_loop 1/3)

Committed 2026-09-25. Verifier APPROVED the gate; code-reviewer's 1 CRITICAL +
6 MAJOR + folds addressed. Commit: `verify-fix` (git log).

## MUST fixes

- **[C1 · CRITICAL] Cross-branch dedup loses the committed round — FIXED.**
  New `makeCommitReachable(worktreePath, keyed)` (src/git/worktree.ts): on a
  dedup hit whose keyed commit lives on a DIFFERENT branch (quarantine /
  epoch-bump), the lease branch is fast-forwarded (or explicitly merged) to
  the keyed commit so the round's integration step actually ships it;
  divergent replay content is discarded first (keyed commit authoritative).
  Divergence + keyed branch recorded as marker evidence
  (`CompletionMarker.keyed_branch` / `.replay_divergent` / `.sha`).
  New `keyedCommitIntegrated()` + IntegrateStep guard: when a keyed commit
  exists, `merge-base --is-ancestor keyed.sha integration` MUST hold or the
  step throws (no more silent `alreadyIntegrated` drops).
  Regression tests (tests/verify-fix.test.ts) REPRODUCE the defect geometry:
  merging the spare branch without the fix leaves integration WITHOUT the
  file; with the fix the content lands and the ancestor check passes.
  Marker payload extended with optional evidence fields (plan payload fields
  unchanged).
- **[M1] no-op assertion now checks the round's OUTPUT path** — resolved from
  ppOut with prep source-map fallback (`outPath`), never the PHP source path.
- **[M2] envelope events carry per-target identity** — new
  `identityOf(context, input)` on EnvelopeSpec +
  `envelopeEventKey(stepId, attempt, identity)`; all per-file steps use
  sanitized `file#round`; dispatch reports the in-flight file (its claim
  happens in-inner, so fresh claims key flow-level — documented). Event shape
  gained `identity` (also live-verified in flow history:
  `pp-implement#1@src__Money.php#1`).
- **[M4] envelope-START durability (0(g))** — new `envelopeStartMarker`
  record mini-steps precede ALL model-calling steps (implement, review-A,
  review-B, fixer): attempt 0, outcome `interrupted`, `ended_at` null — a
  kill inside a model turn now leaves a durable start record. Markers use
  role-record/attempt-0 semantics so Phase 5's AC2 token totals can exclude
  them while joining to real envelopes by (stepId, identity). Live-verified
  (smoke-3 history shows `pp-implement#0@…#start` markers).
- **[M5] reviewer numbering header** — renderDiffForReview now derives the
  true body-start line from DIFF_HEADER_LINES
  ("the diff body starts at line 6"), matching resolveEvidence; regression
  test proves an early finding resolves (pre-fix it silently dropped).
  *Superseded 2026-09-30: hunk body ranges are 1-based, computed by one helper;
  see "Post-audit contract changes" at the end of this file.*
- **[F1] step-factory completeness lint** — tree-walk: `getStepType()` /
  `implements Step` allowed ONLY in flows/steps/envelope.ts.
- **[F2]** `toolOverridesAllOff()` asserted: entire plugin surface disabled.

## BEFORE-PHASE-6 fixes (done now)

- **[M3] ordered recovery wired for the port flow**: `run-demo.ts
  recover-port --dir --epoch N --files …` — epoch bump → abort stale writers
  (enumeration fallback over the surviving opencode server) → durable
  lease/reconcile at git level (`git worktree list`, keyed-commit-first
  reconcile + applyReconcile; poisoned = hard failure) → prints the exact
  re-dispatch command at the bumped epoch. The flow's own LeaseStep reclaims
  stale-epoch records in the DURABLE pp-lease store on next claim.
- **[M6] lease branches base on the integration tip** when it exists
  (`acquire(..., baseRef?)`, default resolution integration→HEAD), so
  same-path re-rounds are pure fast-forwards; divergent leases fall back to
  --no-ff (documented as the only sanctioned merge-commit shape). Regression
  test asserts round-2 lease HEAD == integration tip and `fastForward: true`.
- Fence-in-same-step note (per reviewer): the probe-flow fence writes inside
  the same durable step as its decision — accepted there because the
  enumeration fallback covers the gap; the port flow keeps the dedicated
  pre-prompt FenceStep. Reviewer-turn kill added to the Phase 3 smoke plan.

## Folds

m1 `commitSha` (commit) vs `treeHash` (content) split in queue done-entries +
marker `.sha`; reconcile backfill uses `keyed.round` (parsed, no more −1).
m2 `abort()` returns true only on error-free acceptance. m3
`sanitizePathSegment` appends a hash suffix whenever sanitizing changed the
input (no collisions). m4 `PROMPT_WAIT_MS` validated (NaN/≤0/>24h → 15 min).
m5 gitSelftest integration check asserts `integrated === true` (was a
tautology). m6 `.gitignore` covers `kill-events*.jsonl`. chaosKill accepts
`--flow-run-id` (sidecar self-anchors to the dex run). m7 recordStep
envelope-write deduplicated into `writeRecordEvent`. pidAlive treats EPERM as
alive. DEFERRED per handoff: round-increment wiring (Phase 4), prep role
cosmetic.

## Live smoke (required: C1 touches the commit/integration path)

Single-file smoke `smoke-3` (Money.php, runId `01a0daeb-…`, project
`/tmp/pk-smoke`): full pipeline COMPLETED in one pass — implement → reviewA →
reviewB → fixer → commit → integrate → release → dispatch(exhausted) → final;
exactly 1 op-ID commit (`c5b91ea`); integration carries the port; envelope
history shows identity-keyed events + attempt-0 start markers; the C1 guard
did not false-fire. Note: the first smoke attempt sat queued while no worker
was running (my process-management miss, not a code defect) — starting the
worker let it proceed; retry/backoff behaved as designed.

## Final verification

- `bun run typecheck` → clean.
- `bun test` → 150 pass / 0 fail (18 files; includes 8 new verify-fix tests).

---

# PHASES 3+4 — prep-analysis, Jev swap-in, queues (evidence record)

Completed 2026-09-26 by worker-1c, resuming after worker-1b was force-cancelled
mid-Phase-4 and the ZCode app restart killed ALL infra (dex server, worker,
opencode serve, dashboard). All code through Phase 5 was already committed
(HEAD `4cf8fa1`); this section records the live evidence for Phases 3–4 from
worker-1b's runs (recovered from the durable dex DB + sidecars + worker logs)
plus worker-1c's own runs. Infra was brought back EXACTLY as documented:
dex on the EXISTING trial-gate DB (`dexcli dev -open=false -sqlite-db-filename
~/.dex/dev/7233/dex.sqlite.db -blob-store-dir ~/.dex/dev/7233/dex.blobs` —
flow history survived), worker (`run-demo.ts worker --flows port --harness
auto`, `OPENCODE_REVIEWER_AGENT=plan`), `opencode serve --port 4096`,
dashboard (`scripts/serve-status.ts`, :4646). Worker log confirms `Jev: REAL
client` post-restart.

## Phase 3 — what the durable record shows (flows p3-1…p3-4, `dexcli flow search`)

- **p3-4 COMPLETED** (runId `01a0db87…` continued-as-new → `7910ea71…`,
  closed 04:07:15Z) — the Phase 3 gate run, full pipeline on the 2-file seed
  (`src/Money.php`, `src/Pricing/FlatRateDiscount.php`, project `/tmp/pk-p3`,
  maxRounds 1):
  - Real prep: symbol table via LIVE-harness recall + selection
    (`pp-symtab/symtab`, 15 rows for the seed), implementer-generated spec map
    (`pp-prep-generate#1`, agent), artifact-diff prep review (`pp-prep-diff`:
    stub vs generated, rendered as a diff per the reviewer rule) with TWO
    independent reviewers per iteration (`pp-prep-verdict/*#reviewer-A|B`,
    citation_check probabilities recorded), findings looped back capped at
    `prepMaxRounds 2` (`pp-prep-state: prepIteration 2`, rev 4 spec:
    "REVIEWED SPEC — binding for this leg").
  - Per-file loop for BOTH files: implement → capture-diff (by value) →
    review-A → review-B (separate verdict attributes, citation probabilities
    in `pp-verdict/…`) → verdict-check (drops: wontfix, p_cited=0 finding) →
    prioritize → fixer → keyed commit → integrate → release. Completion
    markers: `committed:src/Money.php#1` (sha `e5d463b`) and
    `committed:src/Pricing/FlatRateDiscount.php#1` (sha `f4debae`).
    *Superseded 2026-09-30 (verdict-check): it drops `wontfix` findings and
    findings whose `p_cited` is below the checker's threshold, which is 1 for
    the naive checker and 0.8 for live Jev (`CITATION_MIN_P_JEV`). A Jev failure
    fails open to the naive check and is recorded on `pp-kept`, which also
    persists every gate `p_cited` (`citationGate`, `prioritize`,
    `dropped[].p_cited`). The judgment registry (`src/judgment-registry.ts`,
    checked by `tests/judgment-registry.test.ts`) lists `citation-check` behind
    `src/typesafe/verdict-check.ts`, plus `prioritize`, `symbol-table-selection`
    (not fail-open), `prep-citation-check` and `vitest-triage`.*
  - Session fences for every agent/reviewer turn (`session-fence/*`, epoch
    1); attempt-0 start markers present (M4).
- **Jev swap-in**: worker logs for p3+ runs say `Jev: REAL client (billed
  System One calls)`. The symbol-table step emits `role: "judgment"`
  envelopes (`pp-symbol-table#n`).
- **Spot-check (worker-1b, live Jev)**: n=36 graded symbols from
  `fixtures/php-sample`; strict v1 rubric 61.1% (22/36); corrected v2 rubric
  (accessor-method join + literal equivalents; recorded in
  `scripts/jev-spot-check.ts` GROUND_TRUTH) 86.1% (31/36). Residual 5 misses
  = Jev ABSTENTIONS (NONE) on methods with Money-typed params — exactly the
  5 ground-truth rows accepting only `["Money"]` (`Money#add`,
  `Money#subtract`, `DiscountPolicy#apply`, `FlatRateDiscount#apply`,
  `PercentageDiscount#apply`). Live corroboration in flow history: p4-2's
  symbol-table payload shows `selected: "NONE", flagged: true` for
  `FlatRateDiscount::__construct(Money $amountPerUnit)` and
  `apply(Money $subtotal, $units = 1)`. Fix and re-measure: see Phase 3/4
  continuation below (worker-1c).
- **Kill smokes FIRED (Phase 3 exit = kill during a Jev call + reviewer-turn
  kill)**:
  1. *Jev-point kill (in-memory era)* — `PORTING_KIT_FAULT=symbol-table:post:seed`
     crashed the worker inside the symbol-table step on p3-1 (worker-p3c.log,
     pid 61467). p3-1/2/3 were then CANCELED deliberately: dex freezes step
     options at startFlow, and each was superseded by a code fix (missing
     attribute-load declarations; prep-loopback cap runaway) — stop+relaunch
     beat hot-patching a frozen snapshot.
  2. *Reviewer-turn chaos kill (external SIGKILL of dex server + worker)* —
     3 records in `/tmp/kill-events-p3.jsonl` (01:07:20Z, 01:37:58Z, 02:30:22Z,
     "during prep reviewer turn"), intent-before-kill ordering intact. The
     02:30:22Z kill hit p3-4 mid-run; p3-4 RECOVERED and completed at
     04:07:15Z (reviewer step retried on the restarted worker; retry trail:
     `pp-prep-review-a#2/#3`, `pp-prep-review-b#2` completed at later
     attempts after the kill).
  3. *Live-Jev kill (REAL network client)* — p4-1 (runId `01a0dbec…`,
     started 04:14:32Z): worker-p4a with `fault=symbol-table:post:seed` + REAL
     Jev computed 15 rows, then SIGKILLed itself (worker-p4a.log, pid 52796).
     `PpSymbolTable-1` completed at **finalAttempt 6** (fault kill → dial
     failures against the dead worker → clean worker) — kill during a live
     Jev call, resumed, no duplicate.

## Phase 4 — what the durable record shows

- **p3-4 already exercised the wired queues end-to-end**: after the port
  queue exhausted, `QueueVerifyStep` ran tsc + vitest against the INTEGRATED
  checkout, published burn-down (`queue-burndown/tsc-1: 2 errors`,
  `vitest-1: 0`; per-file `tsc-1-src__pricing__flat-rate-discount.ts: 2`),
  stored grouped errors (`pp-verify`: TS2307 ×2,
  `src/pricing/flat-rate-discount.ts`), and applied the TERMINATION RULE:
  with `maxRounds 1` the fixable file hit the round cap → moved to
  `pp-queue.blocked` ("round cap reached with 2 queue error(s) remaining") →
  Final. Flow COMPLETED with an honest blocked-file record (the demo-green
  gate is explicitly NOT an acceptance criterion; the block is the designed
  cap behavior).
- **p4-1** (maxRounds 2, project `/tmp/pk-p4`): survived the live-Jev kill
  (above), then ran the FULL prep review loop — generate (agent, 283s,
  63,926 tok) → review A/B → verdict-check → loop decision → revise → review
  A/B → verdict-check → revise (prepIteration 2) → diff-capture-3 → review
  A-3 IN FLIGHT when the ZCode app restart killed the worker (~04:42Z).
  Dial-failures (`FLOW_ERROR_TYPE_WORKER_API_FAIL`, connection refused
  127.0.0.1:8803) exhausted `PpPrepReviewA-3`'s maximumAttempts 3 →
  FLOW_STATUS_FAILED 04:44:25Z. **Infra death, not a code defect** — the
  same failure mode Phase 0(b/c) proved recoverable when the worker is
  actually restarted.
- **p4-2** (worker-1b's re-dispatch, 04:45:53Z): PpPrep → PpSymbolTable
  (LIVE Jev, symbol rows in history incl. the Money-param abstentions) →
  died at `PpPrepGenerate` attempt 3 the same way (worker still dead) →
  FAILED 04:47:18Z. No durable state was lost (nothing had committed).

## Checkpoint A (this commit)

- BUILD_NOTES §PHASES 3+4 (this section) — evidence hand-off recorded.
- Worker-2's CreatorPay fixture (`fixtures/creatorex-middleware/**` +
  `fixtures/generate-creatorex.ts` + FIXTURES.md section): committed AS
  DELIVERED; determinism re-verified by worker-1c (generator re-run digest
  `b692f358…` == FIXTURES.md recorded digest; tree unchanged).
  *Superseded 2026-09-30: that digest is out of date. The generators changed
  afterwards and the current digests are in `fixtures/FIXTURES.md` (checked by
  `tests/fixtures-generators.test.ts`).*

## Infra finding (beyond this project): glm-5.3 "default"-variant degenerate turns

Recorded 2026-09-26 (worker-1c) — provider-side failure mode hit during Phase 4
re-dispatches; valuable for anyone building on opencode + zai-coding-plan:

- **Shape**: reviewer-shaped turns (large prompt: agent-definition + tool-deny
  policy + unified diff + "emit exactly one JSON object") on model
  `glm-5.3` variant `default` (via the `plan` agent) return a COMPLETED
  assistant message with 0–4 output tokens, NO text part, and ~32k reasoning
  tokens. The turn is "completed" with usage, so the seam's poll loop is
  skipped (fast path) and the verdict JSON parse fails downstream.
- **Cache amplification**: consecutive retry attempts on the identical prompt
  replayed IDENTICAL degenerate turns (reasoning token count 31,996 twice,
  then 3 identical failures on the same step) — the provider response-caches
  the prefix. Fix `3cab591` appends a per-attempt retry note (cache-bust):
  necessary but NOT sufficient — p4-6 prep0/prep1/prep2 review-A retries
  succeeded with the note (74–80k-token real verdicts, visible in flow
  history as non-degenerate attempt-2 envelopes), yet p4-6 prep2 review-B
  still failed 3/3 with distinct prompts.
- **Window**: 05:00–08:05 UTC 2026-09-26, ~50% of plan-agent review turns
  degenerate (vs 100% healthy 02:30–04:41 on the same agent/model — p3-4 and
  p4-1 completed 14 review turns). Not deterministic per prompt; the default
  variant was effectively unusable for heavy-reasoning turns during the window.
- **What did NOT work**: Momus (`gpt-5.6-terra xhigh`) returns 31-token
  persona prose, not the verdict contract (3/3 in-flow failures, p4-5);
  `plan` on `glm-5.3-flash` and `Sisyphus-Junior` die as native-tool turns
  (tool-denied → empty reply) when probed WITHOUT the flow's exact turn shape
  (agent definition + toolPolicyBlock + tools-off) — probe validity note:
  agent probes MUST replicate `composeAgentTurn(def, turn)` + tools-off or
  they measure a different failure mode.
- **What worked**: the IMPLEMENTER's own agent (`Sisyphus - ultraworker`,
  `glm-5.3-flash` variant `max`) serving the reviewer turn with the exact
  flow shape — parses the verdict contract first-try (2 findings, 235 output
  tokens, tools-off). p4-7 runs with `OPENCODE_REVIEWER_AGENT="Sisyphus -
  ultraworker"` (env-only). Reviewer independence is preserved by the harness
  (per-turn server-side tools all-off + reviewer definition prefix), not by
  the vendor agent persona.

## v1.1 — parallel per-file dispatch (worker-1c, confirmed by lead mid-flight)

Commit `4973fcc`. dex-native shape, DEFAULT for Phase 6–7 (`demo --dispatch
parallel`; `sequential` keeps the Phase 2 loop for A/B):

*Superseded 2026-09-30: `--dispatch sequential` now stays sequential through
release, bootstrap and dispatch. Before the fix `ReleaseStep` dropped
`dispatchMode`, so the run silently went parallel after the first file. A
sequential Release also releases the `WorktreePool` lease now.*

- **Parent** (`port.Project`): prep + prep-review loop unchanged →
  `PpWaveDispatch` plans the next ≤2-file wave from the durable queue (fresh
  or fix rounds) → `PpWaveJoin` declares
  `waitFor: Wait.allOf(...SubFlow.run(PortFileFlow, childInput))` — both lease
  slots fill CONCURRENTLY — and its `execute` runs only when every child is
  terminal. The join then integrates each child's keyed commit SERIALLY (the
  shared integration worktree never races; a no-op child round uses its
  terminal receipt + the plan's no-op content check), appends git-derived
  done entries, publishes `pp-wave-children/children` (metrics/dashboard
  fan-out), and loops to dispatch / QueueVerify.
- **Child** (`port.File`, one per file-round): `PpChildLease` seeds its OWN
  attribute stores with the parent's reviewed prep artifact + queue errors
  (SubFlow input — every downstream per-file step is store-local, so the
  child pipeline is the UNCHANGED exported step chain: fence → implement/fix
  → diff → review A/B → verdict-check → prioritize → fixer → keyed commit)
  → `PpChildRelease` releases the lease and returns the receipt. Children
  never touch git integration.
- **Caps and durability**: one lease per child; wave width = the WorktreePool
  cap (2) — concurrency bounded at the wave planner. Kill safety: dex's
  SubFlow reuse policy RESTART_IF_PREVIOUS_EXITS_ABNORMALLY restarts a dead
  child on resume and attaches to running ones; the wave record
  (`pp-wave/wave`) and the join are durable, so a mid-wave kill resumes
  exactly like the sequential loop (this is the same AC1 surface, now with
  two worktrees migrating visibly in parallel on the dashboard grid).
- **AC2**: the dispatch anchor gained `PpWaveDispatch`, `PpWaveJoin`,
  `PpChildLease`, `PpChildRelease` (support steps); children reuse the SAME
  step types as the sequential pipeline, so per-flow typed 1:N anchoring is
  unchanged. `render-metrics.ts` merges parent + `pp-wave-children` flows
  (state, history, envelopes) into one report.
- Dispatch failures surfaced during wiring review and fixed: DispatchStep no
  longer drains `pending` before WaveDispatch reads it (parallel branch skips
  deriveNext); clean fix rounds (no keyed commit) resolve via the child's
  terminal receipt instead of throwing. `tests/port-parallel.test.ts` covers
  wave planning, anchor registration, and both flow registrations (196 pass,
  tsc clean). NOT YET live-proven — the first parallel run is Phase 6.
  *Superseded 2026-09-30: `tests/port-parallel.test.ts` now covers anchor
  registration, both flow registrations, parent and child `FenceStep` and
  `CommitStep` routing, and `ChildReleaseStep`. `flows/port-parallel.ts` (the
  wave-planning helpers) was deleted as dead code; wave planning is the
  `CHILD_SLOT_CAP` slice in `flows/port/project-steps.ts`.*

## Phase 4 — final status (worker-1c)

- **GREEN (clean path)**: p4-7 (runId `01a0dd01…`, epoch 6) COMPLETED
  10:42:51Z end-to-end with the Sisyphus reviewer: prep loop (2 reviews per
  iteration, all first-try) → Money loop (implement 56k tok → reviews → fixer
  → commit `84b3fad`) → FlatRate loop (commit `334ed4c`) → QueueVerify on the
  integrated checkout: **tsc 0 errors, vitest 0** → termination rule (queues
  empty) → Final. Burn-down `tsc-1: 0`, `vitest-1: 0` published. Integrated
  checkout carries `src/money.ts` + `src/pricing/flat-rate-discount.ts`.
  **AC2 provenance on this real run: `provenance_ok=true`, 0 failures, 73/73
  envelopes dispatch-anchored, 10 verdict records, 1,107,958 model tokens
  reconciled** (`/tmp/metrics-p47/report.json` — first fully-green AC2 render
  on live data; validates the identity fix, the `:start` self-envelope
  anchor, and multi-run history merge).
- **Fix-round kill smoke: BLOCKED-BY-PROVIDER after the bound.** The queue/
  fix-round kill needs a run that survives to the fix round. Three window-
  gated dispatches failed PRE-window to the degenerate-turn provider window
  (see the infra finding above): p4-8 (10:46, 3/3 degenerate review-B),
  p4-9 (11:33, died at prep review-A after 2 absorbed degenerates), p4-10
  (13:16, dispatched by the 3-probe window gate; died 14:11 at prep review-B
  — attempts produced 3, 885 (unparseable), 1 output tokens). **The chaos
  kill never fired; per the max-2-attempts smoke bound this is documented,
  not retried.** The fix-round machinery itself remains covered by: the
  termination-rule live proof (p3-4's cap-block with 2 real tsc errors), the
  deterministic fault `queue-verify:inject-error:seed` (de4bf4d, ready for a
  future window), and unit suites. p4-7's kill-shaped evidence additionally
  includes the earlier in-run kills on the same topology (p3-4 external
  SIGKILL mid-reviewer + resume to COMPLETED; p4-1 live-Jev fault + resume).

## Phases 3/4 continuation (worker-1c)

### Jev prompt fix (spot-check re-measured, one prompt-iteration budget)

- Defect: Jev abstained (NONE) on methods whose type evidence is a Money-typed
  parameter + Money return (5 spot-check rows). Root: the selection question
  didn't say what "type of a method" means (return type) and the NONE option
  didn't say abstention is wrong when a candidate is signature/docblock-
  evidenced.
- Fix (`src/typesafe/symbol-types.ts`, selection Choice only): question now
  maps method→return type and accessor→property's type and says "when the
  signature or docblock directly evidences one of the candidates, select it —
  do NOT pick NONE"; the NONE criterion now reads "EVERY recalled candidate is
  unsuitable… do not abstain when a candidate is directly evidenced (e.g.
  `Money $other`)".
- Measured (live Jev, same n=36 graded symbols, v2 rubric):
  - BEFORE: 31/36 = 86.1% (worker-1b; raw selections preserved in
    /tmp/jev-spot-check-before-v2.json) — misses: the 5 Money rows (+3
    grading-rubric rows for truncated compound labels, accepted by v2).
  - AFTER: 33/36 = 91.7% (≥90% target PASS; /tmp/jev-spot-check-after.json,
    generatedAt 2026-09-26T05:01:57Z). Money-param abstentions 5 → 2
    (`PercentageDiscount#apply`, `FlatRateDiscount#apply` still abstain — both
    remain `flagged` and escalate to the implementer agent, the designed
    path). Residual third miss: `Customer#toArray` truncated-candidate label
    (`array<string,`) — the known recall-side `@return` comma-truncation,
    recorded as a worker-3 follow-up, not a prompt issue.
  - FIX-WAVE RE-RUN (2026-09-27, live, reconciles the 33/36-vs-PRD-34/36
    discrepancy): `scripts/jev-spot-check.ts` re-run live (n=36) after the
    script gained band reporting (reviewer finding 5: per-row cascade noul
    probabilities preserved in `checks`; `band_rate` ([0.30, 0.70]) and
    `strong_fail_rate` (<0.8) reported separately in the summary). CURRENT
    number: **33/36 = 91.7%** (≥90% target PASS; generatedAt
    2026-09-27T12:36:41Z) — and an earlier same-day run measured **34/36 =
    94.4%** (12:24Z): run-to-run model variance, both ≥90%, so the PRD's
    34/36 and BUILD_NOTES' 33/36 were both real observations; the current
    standing number is 33/36 = 91.7%. Band/strong-fail split on the current
    artifact: `band_rate` 8/36 = 22.2%, `strong_fail_rate` 13/36 = 36.1%,
    `escalation_rate` 97.2% (dominated by 18 recall-empty abstentions, the
    designed path for no-evidence symbols). Artifact:
    `/tmp/jev-spot-check-fixwave.json`.
- Suites after the fix: `bun run typecheck` clean; `bun test` 188 pass / 0
  fail (20 files).

---

# WAVE-4 — final report (worker-1c; STOPPED per lead hard rule 2026-09-26 ~16:40 UTC)

Lead rule in force at stop: cx-4 failing ⇒ stop entirely, no cx-5, no further
retries; next strategy (provider swap / probe widening / proceed-with-
documented-failure) is decided with this evidence.

## What landed (all committed; 196 tests pass, tsc clean at stop)

| Commit | Content |
|---|---|
| `911b300` | checkpoint A: Phase 3/4 evidence record + CreatorPay fixture |
| `3a5e2a7` | Jev selection prompt fix — spot-check 86.1% → **91.7%** (v2, n=36, live; target ≥90% PASS) |
| `7c7e9ec` | Phase 5 reconciliation: anchor learns live `:start` self-envelopes; prep model steps carry the marker join identity; `render-metrics.ts` driver |
| `de4bf4d` | deterministic fault `queue-verify:inject-error:seed` (fix-round kill window; unused — see smoke status) |
| `4973fcc` | **v1.1 parallel dispatch** (per-file `port.File` SubFlow children + `Wait.allOf` wave join; serial parent integration; child store seeding; anchor+driver topology; tests) |
| `f731250` | harness hard ceiling on one SDK `session.prompt` call (20 min, retryable) — hang-proofing |
| `0ecde78`/`30b7b1d`/`7f7519e` | creatorex prep-stub + BUILD_NOTES (infra finding, Phase 4 status, v1.1 design) |

## Infra

ALL infra was down at wave start (app restart). Recovered exactly per
BUILD_NOTES: dex on the EXISTING 7233 DB (history survived), worker
(`run-demo.ts worker --flows port --harness auto`), `opencode serve :4096`,
dashboard `:4646` (later STATUS_REPO_ROOT=/tmp/pk-p4). Worker log confirmed
`Jev: REAL client` on every restart.

## Phase 4 — GREEN on the clean path (the wave's solid result)

p4-7 (runId `01a0dd01-…`, epoch 6, project `/tmp/pk-p4`, reviewer
`Sisyphus - ultraworker`): COMPLETED 10:42:51Z — full pipeline (prep loop →
both seed files → keyed commits `84b3fad` + `334ed4c` → integrated output)
with QueueVerify tsc 0 / vitest 0 → termination rule → Final. **AC2 on this
real run: provenance_ok=true, 0 failures, 73/73 envelopes dispatch-anchored,
10 verdict records, 1,107,958 model tokens reconciled**
(`/tmp/metrics-p47/report.{md,json}` — first fully-green AC2 render on live
data; validates the marker-identity fix, the `:start` self-envelope anchor,
and multi-run history merge). Evidence: `dexcli flow history p4-7`,
`/tmp/pk-p4`, `/tmp/metrics-p47/`.

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
*Superseded 2026-09-30: see the note under "v1.1" for what
`tests/port-parallel.test.ts` covers today and where wave planning lives.*

## State hand-off (for the next decision)

- Repo: HEAD with all commits above; 196/196 tests, tsc clean. Untracked
  `.omc/research/*` + `demo/` + `.playwright-mcp/` are not wave-4 artifacts.
  *Superseded 2026-09-30: `.omc/*` (except `.omc/skills/`) and
  `.playwright-mcp/` are now untracked and gitignored, and `demo/` was
  removed. These paths survive only in history: the base commit is `98b2e26`.*
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

---

# WAVE-5 — final report (worker-1d, 2026-09-26)

Mission: finish the blocked evidence runs with the reviewer lane swapped to
**gpt-6-luna** (user's choice), plus Tier-1 polish. The wave-4 blocker
(glm-5.3-default degenerate reviewer turns) is BROKEN: every reviewer turn in
every run below parsed first-try on luna — **zero degenerate turns across
22+ live review turns** (prep 3 iterations × 2 + 10 child rounds × 2).

## STEP 1 — reviewer lane swap (PASS, opencode route)

- Route: opencode server (:4096) CAN reach `openai/gpt-6-luna` via the
  ChatGPT-plan auth (`auth.json` `openai` refresh). Codex fallback not needed.
- Seam: per-turn model override — `PromptOptions.model` in the opencode seam +
  `reviewerModelOverride()` (env `OPENCODE_REVIEWER_MODEL=provider/model`),
  applied ONLY in `runReviewTurn`; implementer/fixer stay on the default glm
  lane (commit `e55b321`).
  *Superseded 2026-09-30: `reviewerModelOverride()` was deleted. The
  `OPENCODE_REVIEWER_MODEL` variable (`providerID/modelID`) is now read by
  `laneRouting("reviewer")` in `src/harness/lanes.ts`, next to the planner and
  executor lane variables; see `.env.example`.*
- Binding for all runs: `OPENCODE_REVIEWER_AGENT=plan` +
  `OPENCODE_REVIEWER_MODEL=openai/gpt-6-luna`.
- Probe validity honored (wave-4 lesson): probes replicate the flow's EXACT
  turn shape — `composeAgentTurn(REVIEWER, turn)` header + toolPolicyBlock +
  diff-by-value via `renderDiffForReview` + `toolOverridesAllOff()` + verdict
  contract validation. Result: **3/3 healthy parses** (findings=1 minor / 1
  major / clean; 10-13s per turn; ~40k input) → GO. Script: /tmp/probe-luna-reviewer.ts.

## STEP 2 — CreatorPay runs cx-5 → cx-5e (PASS after 4 deterministic fixes)

The v1.1 parallel dispatch was NEVER live-proven (wave-4: "first live exercise
will surface dex SubFlow runtime semantics"). It did — four deterministic
wiring gaps, each fixed + committed, none provider-related:

| Dispatch | Failure (all at/near the wave join, before child model spend) | Fix (commit) |
|---|---|---|
| cx-5 | `waitFor` reads pp-prep undeclared — dex loads WAIT-FOR-phase maps SEPARATELY (`waitForLoadAttributeMaps`) | `be61be3` |
| cx-5b | `SubFlow.run(PortFileFlowInstance)` → "Flow instance is not registered": dex resolves the registry by INSTANCE IDENTITY; the worker registered `new PortFileFlow()` | `467ee06` |
| cx-5c | Child `PpChildLease` read `pp-lease/pool` via bindLeaseStore undeclared; full reads-only audit of every step (writes stage automatically, only READS declare) | `7d65601` |
| cx-5d | Fix-round pipeline: `FixerStep` threw "output path missing file#2" — fix rounds enter via queue-fix which never sets ppOut; prep source-map fallback added (same as queue-fix/integrate) | `531b753` |
| cx-5e | — (COMPLETED; see STEP 3) | — |

cx-5d additionally proved the kill/resume machinery fires (see below) before
dying on the fixer bug. Prep burned ~450k input tokens per dispatch (mostly
cache-read) — the cost of five gate arrivals at the never-proven join.

## STEP 3 — fix-round/queue kill + AC1 battery: **ALL PASS (cx-5e)**

- Run: cx-5e, runId `01a0df1a-58ef-732c-ba4d-b695df85f8c6`, 5 CreatorPay
  files, parallel dispatch, maxRounds 2, worker fault
  `queue-verify:inject-error:seed` (deterministic fix-round window).
- Kill: watcher caught `PpQueueVerify` ACTIVE (iteration 1) → chaos-kill
  SIGKILLed dex (pid 68294) + worker (pid 72852) at **19:50:38.665Z**;
  sidecar intent (mono 44ms) BEFORE completed (mono 98ms), both anchored
  `flow_run_id=01a0df1a…` (`/tmp/kill-events-cx5.jsonl`).
- Resume: SAME SQLite DB (`~/.dex/dev/7233/dex.sqlite.db`), fast restart
  (<10s — cx-5d showed model steps burn their 3 quick attempts if the worker
  is down longer). Flow resumed through queue-verify → fix waves 4-6 →
  **FLOW_STATUS_COMPLETED 20:26:38Z**.
- Phase 6 assertion battery — `/tmp/metrics-cx5/ac1-battery.txt`, ALL PASS:
  flow completed; sidecar intent-before-kill + run-id anchored; post-kill
  envelopes exist and close time > kill; **zero new implementer invocations
  post-kill for all 5 completed files**; **no duplicate op-ID commits** (10
  keyed commits = 5 files × 2 rounds, one each); **all round-1 keyed commits
  are ancestors of `integration` HEAD**; ported content present in the
  integrated output; fix-round (redone) work present post-kill (20 completed
  + 5 skipped fix/commit/integrate outcomes).
- cx-5d's earlier kill (18:58:18Z, mid fix-wave) also FIRED + resumed children
  before dying on the then-unfixed ppOut bug — same sidecar, superseded.

## STEP 4 — Tier-1 polish (all four landed)

- (a) removed-behavior reviewer lens — prompt-only attack angle on the `-`
  lines (commit `c29cc88`), documented in harness/agents/reviewer.ts.
- (b) cost honesty — envelopes carry the FULL provider usage split
  (input/cache-read/cache-write/reasoning/USD); report gains
  `usage_by_role` + `cost_total_usd` + `~estimated` flag; dashboard gains
  section 07 (agent usage & cost) and split tooltips (commit `e7fec97`).
  Live values on cx-5e: agent 772k in/350k cache-read/196k reasoning;
  review (luna) 329k in/**576k cache-read**/8k out — all plan-authed →
  honest `~$0 (estimated)` flag, never silently exact.
- (c) lifecycle headline — one-line run status with the live
  running→killed→resumed→completed flip; final state rendered:
  `◆ cx-5e: 10/10 files · completed (survived kill)` with the kill timeline.
- (d) git-exec 30s timeout + maxBuffer (hung git no longer burns heartbeats);
  cleanup ordering VERIFIED correct already (worktree remove --force
  deregisters missing worktrees; never prune) — documented in release().

## STEP 5 — AC2 render on the luna run: **provenance_ok=true**

`bun scripts/render-metrics.ts --flow-id cx-5e --kill-events
/tmp/kill-events-cx5.jsonl --out-dir /tmp/metrics-cx5`:

- **213 envelopes, 22 verdict records, 14 burn-down samples, kill events
  merged, provenance OK, 213/213 dispatch-anchored** (child-flow topology
  aware). Tokens model roles: 2,292,331. Zero fixer retries. Agreement
  matrix live: agree-clean (spec round 0), disagree cases surfaced honestly.
- Two render-side gaps found + fixed by this render: `pp-wave-children` is
  OVERWRITTEN per wave (children must come from history upserts, `bdc6989` +
  prefix fix — the map is `pp-wave-children`, not `pp-wave/children`), and
  ChildLease/queue-fix envelopes were flow-keyed (steps lacked identityOf;
  anchor now proves flow-keyed completions via support-type match or the
  identity-bearing start marker, commit `b14a03c`; future runs write
  identity-keyed envelopes directly).
- Dashboard verified rendering the run (headline + usage + kill timeline).

## Evidence paths (wave-5)

- AC1 battery (ALL PASS): `/tmp/metrics-cx5/ac1-battery.txt`
- Kill sidecar: `/tmp/kill-events-cx5.jsonl` (copy: /tmp/metrics-cx5/)
- AC2 report: `/tmp/metrics-cx5/report.{md,json}`
- Project repo (10 keyed commits, integration branch): `/tmp/pk-cx5`
- dex flows: cx-5e (+ children), cx-5d (first kill), cx-5..cx-5c (wiring-gap
  narrative above); probe script /tmp/probe-luna-reviewer.ts
- Worker/server logs: /tmp/worker-1d*.log, /tmp/dex-server-1d.log
- Dashboard: :4646 (STATUS_REPO_ROOT=/tmp/pk-cx5)

## Commits (wave-5, in order)

e55b321 reviewer-model seam · e7fec97 tier-1 b/c/d · be61be3 waitFor maps ·
467ee06 SubFlow instance singleton · 7d65601 child lease maps + audit ·
531b753 fixer ppOut fallback · bdc6989 render children-from-history (+prefix) ·
b14a03c anchor flow-keyed join + identityOf · c29cc88 removed-behavior lens ·
e38b8a6 headline top-level flow. 204/204 tests, tsc clean at every commit.

## Remaining Phase 7 scope (go/no-go with costs)

Full php-sample run incl. the AC1 kill at seed scale. Cost shape from cx-5e:
~2.3M model tokens per 5-file CreatorPay run (implementer glm ~810k +
reviewer luna ~920k incl. heavy cache-read + fix rounds), ~90 min wall clock.
php-sample is the 2-file seed (~40% of that). The reviewer lane is stable;
the parallel topology is now live-proven end-to-end. Awaiting user go/no-go.

# Stage 2d — US-007 (2026-09-27): stream consumers + Jev live wiring + typed errors

## 1. Jev live wiring fix (dex-sdk review DRIFT S — silent naive fallback)

- `configurePortJevLive`/`PORT_JEV_LIVE`/`portJevLiveClient` (flows/port-project.ts) were
  NEVER called by the worker: a `TYPESAFE_API_KEY` worker ran verdict-check, prioritize,
  AND vitest triage on the naive default while the startup log claimed "Jev: REAL client".
- Fix: the second seam is DELETED. `liveJevClient()` (exported, flows/port-project.ts)
  resolves all three consumption sites from the ONE runtime-hooks seam the worker
  configures via `configurePortJudgment(await resolveJudgment())`
  (scripts/run-demo.ts worker case). `portJevLive() ? requirePortJudgment() : undefined`
  — false when unset, so the naive path can never throw on unconfigured workers.
- One loud startup line added: `[worker] JUDGMENT LANE: LIVE JEV|NAIVE —
  verdict-check/prioritize/vitest-triage consume ...`. The log can no longer diverge
  from the actual lane: both derive from the same client.
- Tests (tests/jev-wiring.test.ts): real-kind client -> SAME instance reachable at the
  consumption sites; in-memory client -> naive, no crash; unconfigured -> naive, no
  crash; source-level assertion of exactly 3 consumption sites + dead-seam absence.
  End-to-end proof fell out of the suite run: the wiring test's real-kind client LEAKED
  through the seam into verdict-repair.test.ts steps in the shared process (verdict-check
  took the Jev route) until an afterEach reset was added — the drift is gone; the seam
  is live.

## 2. Stream consumers (Stage 2d)

- Dashboard subscriber (src/dashboard/queries.ts): `startEnvelopeStreamSubscriber` —
  one long-poll `readStream` loop per followed flow over `port/<flowId>/events` with
  resumable tokens; structural injected reader (the module stays SDK-free); the
  long-poll wake-up is classified by the stable `subStatus === "longPollTimeout"`, never
  by text. ANY other failure flips that flow to `poll-fallback`, fires `onFallback`
  once, and ENDS the loop — the dexcli poll path stays ENGAGED (log line in serve-status).
  Per-flow ring buffer (default 200). serve-status.ts composes the real reader over a
  Client whose registry registers EXACTLY the stream-owning flow type (port.Project) in
  its OWN blob-cache dir (`.dex-cache-dashboard`); `STATUS_STREAM_SUBSCRIBE=0` opts out;
  client-open failure degrades to poll-only.
  *Superseded 2026-09-30: the subscriber no longer ends permanently on a failed
  read. It retries with bounded exponential backoff from the same resume token,
  flips back to `stream` on the first good read, and `/api/state` reports each
  flow's `streamMode`. Its blob cache is `.dex-cache/dashboard` (it was
  `.dex-cache-dashboard`, which `.gitignore` did not cover). The watcher's is
  `.dex-cache/watch`; neither reads the worker's `DEX_BLOB_CACHE_DIR`.*
- Feed merge (src/dashboard/state.ts): `feedFromStreamMessages` + `DashboardInput.streamFeed`
  — stream-delivered events land in the /api/state feed with the SAME dedup key as the
  state fallback (a stream event and its polled twin render once). StreamEventMessage is
  a structural mirror in src/dashboard/types.ts (the dashboard still imports no flow module).
- Kill watcher: `src/watcher/queue-verify-watcher.ts` (pure, all-I/O injected) +
  `scripts/watch-queue-verify.ts` (CLI). PRIMARY source = stream subscription for the
  pp-queue-verify START envelope (stepId `pp-queue-verify`, `ended_at === null` — the
  factory publishes it the moment the step begins, before any durable attribute could
  exist); 60 s dexcli poll fallback (ACTIVE `PpQueueVerify` step execution, the old shell
  predicate); bounded 30 min; fires EXACTLY ONCE (guard + immediate clean exit via
  chaos-kill sidecar); terminal COMPLETED/FAILED before trigger exits cleanly — the r1
  review's non-exiting terminal branch is fixed by construction. Exit codes: 0 fired,
  1 terminal, 2 timeout. The /tmp shell watchers (watch-ac1-parallel.sh,
  watch-queuefix-kill.sh) are superseded; kill only — resume stays the operator procedure.
  *Superseded 2026-09-30 (kill watcher): a terminal flow status (COMPLETED,
  FAILED, TERMINATED, CANCELED, or a server-side timeout) before the trigger
  exits cleanly. Exit codes: 0 fired, 1 terminal, 2 bound elapsed, 3 trigger
  seen but the kill was a no-op (no live target PIDs), 4 kill fired but a target
  survived SIGKILL, 64 usage error, 70 fatal; chaos-kill uses the same table
  (0/3/4/64/70). The 60 s dexcli poll fallback runs about once per
  `--poll-seconds`, and its failures are logged (the first, then every 10th).
  Reads after the first event of a cycle use their own `--catch-up-seconds`
  (default 1 s; the SDK takes whole seconds and 0 means the 60 s server default,
  not "no wait"), so the queue-verify DONE cannot land in the same batch as its
  START and cancel the kill. Windows shorter than about 1 s stay unkillable
  through the stream lane.*
- Projection-only boundary (tests/dashboard-stream.test.ts): flows/, src/git/, src/queues/
  contain NO `readStream|listStreamMessages`; readStream appears only in the projection
  layer (src/dashboard/queries.ts structural, scripts/serve-status.ts, scripts/watch-queue-verify.ts);
  the watcher core takes an injected source and never touches the SDK.

## 3. Typed errors + bounded telemetry swallow (dex-sdk review DRIFT S)

- `waitForFlowTerminal` moved to src/dex/wait-for-terminal.ts; transient classification
  is TYPED: `instanceof LongPollTimeoutError` (documented throw of waitForFlow, verified
  against installed 0.12.1 declarations) or `DexServiceError` with gRPC
  `status.UNAVAILABLE`. All human-readable text matching removed ("waiting exceeded the
  timeout", "14 UNAVAILABLE"). Non-transient errors rethrow immediately; deadline passes
  -> last error thrown. `retryDelayMs` injectable (tests), default 2 s.
- Telemetry swallow BOUNDED (flows/steps/envelope.ts `swallowPublishFailure` +
  scripts/run-demo.ts worker publisher): `DexServiceError` = expected best-effort outage,
  swallowed silently per the US-002 contract; anything else = defect, logged sanitized
  (flowId/eventKey + first line of detail, 200-char bound) at warn. Still swallowed
  either way — a telemetry mirror never fails a durable step (US-002 tests re-verified).

## Verification (fresh)

- `bun run typecheck` clean; `bun test` 304/0 (268 baseline + 36 new:
  9 wiring/swallow, 11 dashboard-stream/AC-D/boundary, 9 watcher, 7 typed-wait).
- AC-D unit-level end-to-end: stream message -> subscriber buffer -> `feedFromStreamMessages`
  -> `buildDashboardState` payload `.feed` (rendered JSON-identical) — asserted; forced
  stream failure -> mode `poll-fallback` + `onFallback` once + loop ended — asserted.
- Watcher: exactly-once (stream, duplicate stream, poll echo), poll fallback after stream
  failure, bounded timeout, terminal clean exit (the r1 fix), non-start events ignored.
- LIVE observation (dashboard rendering from the subscriber during a real run with >=1
  subscription-delivered event; poll fallback demonstrated on forced failure in a live
  server) remains for the US-009 final-code presentation run, consistent with the
  US-002/US-003 amendment pattern (single live-validation gate).

# Stage 3a — US-010 (2026-09-27): honest vitest accounting

## 1. Integration bootstrap (durable, toolkit-owned; vacuous-green eliminated structurally)

- `BootstrapStep` (stepId `pp-bootstrap`, role `integration`, PortProjectFlow): after the
  FIRST integration the checkout is provisioned with a real vitest runner — parallel mode
  wired port-wave-join -> bootstrap -> dispatch; sequential mode release -> bootstrap ->
  dispatch. Idempotent (`runIntegrationBootstrap` skip-if-present), so re-entry after
  every wave join is a cheap no-op and kill-replay converges.
- Artifacts (deterministic content): `package.json` (`type: "module"`,
  `scripts.test = "vitest run"`, devDep vitest `^3.2.4`; existing file is PATCHED, not
  overwritten), strict `tsconfig.json`, `vitest.config.ts` (test/** + tests/** globs),
  `.gitignore` with `node_modules/` (install output never enters a commit).
- Slow-command rule honored: `bun install` runs INSIDE the durable step, OUTSIDE every
  agent turn, injectable for tests (`deps.install`). Sole-committer commit under the
  dedicated op-ID `bootstrap:integration` (findCommitByOpId dedup — a kill after commit
  replays to no duplicate). New durable attribute `pp-bootstrap` (BootstrapRecord).
- QueueVerify keeps its tsconfig fallback for degenerate paths (e.g. zero-file runs);
  ownership lives with the bootstrap.

## 2. Test-file porting (the runner has REAL content)

- `fixtures/creatorex-middleware/prep-stub.md`: the `tests/*.php` glob row is materialized
  as 5 EXACT rows (one per PHPUnit test file -> `test/**/*.test.ts`); `parsePrepSourceMap`
  accepts them, so test files flow through the SAME per-file SubFlow pipeline
  (implement -> reviews -> verdict-check -> commit -> integrate).
  *Superseded 2026-09-30: `fixtures/generate-creatorex.ts` now emits
  `prep-stub.md` itself, so regenerating the fixture reproduces it instead of
  deleting it.*
- `run-demo.ts demo --files creatorex` expands to the full 10 port units (5 src + 5 tests).
  *Superseded 2026-09-30: it also implies `fixtures/creatorex-middleware/prep-stub.md`
  and that directory as the source root unless `--prep` or `--source-root` is
  given.*
- Scope awareness: `testPortScopeNote` (src/harness/runtime.ts) fires on PHPUnit test
  paths; implementer AND reviewer turns carry it (PHPUnit->vitest translation, review as
  test code). Source ports carry no note.
- Classification (US-010 routing): `portedRootsFromSourceMap` derives ported source/test
  roots from the prep map; both classifiers accept `portedTestRoots` — priority src >
  ported test > fixture, so a failure limited to a PORTED test file is port-caused routed
  to THAT file's fix feed, a src frame anywhere still outranks the test frame, and
  non-ported fixture stacks stay fixture-problem (defaults unchanged: DEFAULT_PORTED_TEST_ROOTS
  empty). Jev route threads `roots` into the deterministic attribution step only.

## 3. QueueVerify ran | not-run semantics (never a bare 0 when not-run)

- `VitestRunState` = `{kind:"ran", passed, failed, total}` | `{kind:"not-run", reason}`;
  `parseVitestSummary` reads the vitest default-reporter tail (null summary => the runner
  CRASHED => not-run, never a zero-failure ran). `vitestOutcomeFromRun` is the single
  decision point: runner unavailable / no test files / no output / no parseable summary /
  ran.
- Durable state: `pp-verify.vitestRun` (+ vitestNote keeps the not-run reason);
  burn-down vitest samples carry `vitest: {state, reason, passed, failed, total}`;
  tsc rows unchanged ("tsc remains its own queue"). Child-flow by-value feeds record
  `vitestRun: null` (a feed is not a run record).
- Renderer (AC2): vitest burn-down iterations print `RAN — X passed / Y failed of Z total`
  or `NOT RUN — <reason>`; new `summary.verification` + a "## Verification" section state
  typecheck-verified vs test-verified explicitly (no vitest samples => "evidence is
  typecheck-only at best"). `render-metrics.ts` passes the accounting through from the
  attribute store.

## Verification (fresh)

- `bun run typecheck` clean; `bun test` 326/0 (304 baseline + 22 new:
  bootstrap plan matrix, REAL temp-git bootstrap idempotency/dedup/node_modules-excluded,
  ran/not-run matrix incl. crashed runner, ported-test fix routing (routed -> feed ->
  fixable round), scope notes, report distinction, fixture stub rows for all 10 units).
- Bootstrap commit evidence (temp fixture, injected no-op install): first run commits
  once under `bootstrap:integration` without node_modules; satisfied rerun is a pure
  skip; post-commit damage + replay rewrites but never duplicates the keyed commit.

# Stage 3b — US-009 (2026-09-27): live validation runs cx6…cx6e (per-flow narrative)

Config common to all: CreatorPay fixture, 10 port units (5 src + 5 PHPUnit test ports),
parallel waves of 2, maxRounds 3, live Jev lane (startup line), reviewer luna/plan agent.
Prep source map: fixtures/creatorex-middleware/prep-stub.md (5 explicit test rows, US-010).

## Per-flow narrative (what each run contributed)

- **cx6** (02:04-02:31, TERMINATED): first bootstrap run. Live finding #1
  (`0fc9211`): recordJevUsage READS pp-jev-usage; VerdictCheck/Prioritize/
  QueueVerify did not declare it — undeclared-AttributeMap-read threw and dex
  retried (46+ attempts, each re-billing the live citation batch). Writes need
  no declaration, which is why cx-5c/5e never surfaced it. Flow terminated;
  fix + regression tests landed.
  *Superseded 2026-09-30 (a related defect): VerdictCheck and Prioritize no
  longer throw on a live-Jev outage. They fail open to the naive checker and
  record it, so a Jev outage can no longer trigger dex retries that re-bill the
  citation batch. `pp-kept` gained `citationGate`, `prioritize` and
  `dropped[].p_cited`.*
- **cx6b** (03:25-04:33, COMPLETED, no kill): two silent failures. (a) vitest
  RAN for real (41/2/43) but the 2 failing tests produced NO fix round —
  selectFixableFiles was fed tsc-only counts (`0b429ad`, errorCountsByOutput).
  (b) The US-007 watcher's stream lane degraded on the FIRST long-poll idle
  window (`subStatus longPollTimeout` thrown as a failure) and the 45 s poll
  missed the ~15 s queue-verify window — the run completed with NO kill
  (`0b429ad` classifies the wake-up as an empty read; poll tightened to 10 s).
- **cx6c** (04:4x-05:2x, TERMINATED after kill+resume): the kill/resume arc was
  WITNESSED here — watcher fired at pp-queue-verify (05:20:16) with
  intent-before-SIGKILL ordering (monotonic 2521766→2521819), sidecar anchored
  (run_id cx6c-kill1, flow_run_id cx6c), all targets (server+worker) exited;
  same-DB restart resumed the flow; queue-verify re-ran honestly; fix rounds
  for 7 tsc-error files ran with zero new implementer invocations on done
  files. THEN fix-loop NON-TERMINATION surfaced: selectFixableFiles iterated
  every done entry, so a file's stale round-1 entry re-qualified it at round 2
  forever (waves 6-15 re-fixing 3 tsc + 1 vitest errors) — terminated to stop
  the bleed; cap now reads the LATEST round (`413ba53`). Also first sighting
  of the vitest collection-failure misread (`Tests  no tests` → fake clean
  ran 0/0/0; every ported test file failed to load on an invented import) —
  parser now falls back to the Test Files line (`a7da1bb`).
- **cx6d** (FAILED 06:09, no run): SELF-INFLICTED OPERATIONAL KILL — I
  restarted the worker for the parser fix WHILE cx6d was in flight; the
  PpPrepGenerateStart marker exhausted its 3 connection attempts
  (`dial tcp 127.0.0.1:8803: connection refused`) and dex closed the flow.
  **Operational rule for the record: worker-up-before-startFlow — never
  restart the worker while a flow is in flight; mid-flight restarts also
  cannot adopt code changes into already-running step executions (cx6
  showed retries replay recorded step options), so any fix = stop + fresh
  flow.**
- **cx6e** (06:33-07:52, COMPLETED — the presentation run): all fixes in.
  10/10 port units completed; bootstrap provisioned + committed
  (op-ID bootstrap:integration, node_modules excluded); tsc 0 at final
  iteration; **vitest RAN with real pass/fail from the PORTED tests:
  39 passed / 4 failed of 43** (burn-down + report carry the state; the
  typecheck-verified vs test-verified distinction is explicit in
  report.md §Verification); 182 envelopes, 24 verdict records, 0 tombstones,
  0 degraded rounds, provenance_ok=true (PpBootstrap registered in the
  anchor table). The kill did NOT fire in this run: the watcher's stream lane
  stayed healthy the whole run (fix confirmed) but the queue-verify window
  (~5-10 s: cached tsc + fast vitest) closed before the trigger check — exit 1
  "flow terminal before trigger". The 4 failing tests were additionally
  unattributable (vitest assertion stacks contained no frame under src/ or
  test/ — attributedFile null, documented deterministic visibility without
  routing), so no fix wave was due and the flow went Final. The witnessed
  kill+resume arc therefore remains cx6c's (sidecar + envelope timeline in
  /tmp/metrics-final/ac1-killarc-cx6c.txt).

## Evidence paths (US-009)

- AC2 report (cx6e, provenance_ok=true): /tmp/metrics-final/report.{md,json}
- AC1 battery (cx6e; kill rows honestly FAIL there): /tmp/metrics-final/ac1-battery-cx6e.txt
- Kill+resume arc (cx6c): /tmp/metrics-final/ac1-killarc-cx6c.txt +
  /tmp/metrics-final/kill-events-cx6c.jsonl (copy of /tmp/kill-events-cx6c.jsonl)
- Project repos: /tmp/pk-cx6e (10 keyed commits + bootstrap:integration,
  integration branch), /tmp/pk-cx6c (mid-loop state preserved)
- Logs: /tmp/worker-cx6c.log, /tmp/worker-cx6c-resume.log, /tmp/dex-server-cx6c.log,
  /tmp/watch-cx6c.log, /tmp/watch-cx6e.log, /tmp/demo-cx6e.log
- Flows: cx6e (+ 10 SubFlow children), cx6c (+ children), cx6/cx6b/cx6d
  (failure narrative above); dashboard :4646 tracked each run live
- Token totals: cx6e alone 1,953,430 model-role tokens (report.json); whole
  wave (cx6+cx6b+cx6c+cx6d+cx6e incl. fix waves and re-billed citation
  batches) estimated ~4.5-5M — the cx6 undeclared-read retries re-billed
  Jev citations 46+ times per child and cx6c's non-terminating loop burned
  ~10 fix waves; both are the honest cost of the live findings.

## Verification (fresh, at a7da1bb + anchor table commit)

- `bun run typecheck` clean; `bun test` 329/0.
- Deviations for the lead: (1) the single-run kill+resume+COMPLETED triple was
  not witnessed on one flow — kill+resume is cx6c's, COMPLETED is cx6e's;
  witnessing all three together needs one more run with the now-fixed code
  (and a faster trigger or an armed fault to widen the queue-verify window).
  (2) vitest attribution gap: assertion-only stacks (no matching frame) stay
  visible-but-unrouted; a test-file-frame fallback (attribute to the reported
  testFile) is the obvious next fix and was NOT improvised under the bound.

# Stage 3c — US-009-final (2026-09-27): cx7, the correctly-armed kill run

## What cx7 proves (and the one thing it still doesn't)

- **The kill fired by the intended lane**: watcher armed BEFORE startFlow
  (08:09:50 vs flow start 08:10:0x), stream lane healthy the whole run, and
  the pp-queue-verify START envelope triggered exactly one kill — via the
  STREAM subscription, exit 0 after 2470 s. Sidecar: intent BEFORE SIGKILL
  (monotonic 2470031→2470084), anchored (run_id cx7-kill1, flow_run_id cx7,
  targets = dex server + port worker), "all targets exited". The cx6e miss
  was indeed arming order + delivery lag; with correct arming the watcher
  works as designed.
- **The kill landed mid-FIX-WAVE** (deeper than the AC1 ask): queue-verify
  had recorded durably at 08:50:42 (tsc 6, vitest ran 0/5/5 — this cohort's
  test files failed to collect; honest state carried in burn-down + verify),
  the fix-wave children had leased and fenced (08:50:43), and SIGKILL hit at
  08:51:00 with PpQueueFixStart in flight.
- **Same-DB restart**: durable queue-verify record survived verbatim; run
  rollover 01a0e1ea → 9f4c5bd4 on the same sqlite DB.
- **The one thing still missing: resume-to-COMPLETED.** The resumed
  PpQueueFixStart re-executed into the restart gap and burned its 3
  connection attempts (dial 127.0.0.1:8803 refused → WORKER_API_ERROR,
  finalAttempt 3, flow FAILED 08:59:18). Failure class = cx6d's, now
  witnessed in the resume path: **the marker/model retry budget
  (maximumAttempts 3, ~7 s of backoff) is shorter than any realistic
  restart window (~60 s)**. Candidate fix (NOT improvised under the bound):
  raise the connection-failure retry budget on marker/model steps, or make
  the recovery pass tolerate ERROR_SUB_STATUS_WORKER_API_ERROR
  connection-refused with a long-tail retry. Anchor fingerprint of the
  resume: the retried PpWaveJoin (finalAttempt 3) shows as the report's ONE
  provenance failure — the resume is visible in the evidence.

## Final US-009 evidence position (split across runs, per lead's framework)

- kill fired + anchored sidecar + same-DB restart: **cx7** (stream lane) and
  **cx6c** (poll lane) — both witnessed.
- resume + fix rounds + zero re-ports + COMPLETED: **cx6e** (un-killed) and
  cx7's durable-state survival; a single flow carrying ALL THREE remains
  blocked on the restart-window retry budget above.
- Battery: /tmp/metrics-cx7/ac1-battery-cx7.txt (18 PASS / 2 honest FAIL:
  flow completed = FAILED; parent-side post-kill envelopes — resume activity
  lives in the child + run rollover, see ac1-killarc-cx7.txt).
- AC2: /tmp/metrics-cx7/report.{md,json} — 70 envelopes, 10 verdict records,
  kill events carried (resumed: false — honest), verification shows
  tsc 6 / vitest ran 0/5/5; provenance has exactly the one resume
  fingerprint failure above.
  *Superseded 2026-09-30: `resumed` is now derived per kill from the flow
  summary plus post-kill envelopes, and `render-metrics` reads the sidecar with
  the Contract B reader (runs are filtered on `flow_run_id` and `run_id`).
  The sidecar/`flow_run_id` discussion in these notes predates both.*

## Token totals (cx7)

989,701 model-role tokens through the failure (~53 min to the kill; fix wave
+ resume re-executions included).

## Operational rule (repeated for the record)

worker-up-before-startFlow, AND after a kill: bring the WORKER up before (or
simultaneously with) the SERVER'S task dispatch — or raise the retry budget.
The 3-attempt/7-connection-second budget is the single remaining blocker to
witnessing kill+resume+COMPLETED in ONE flow.

# Stage 3c continued — cx8 (2026-09-27): the retry-budget fix, live and durable; the kill arc lost to a watcher-throughput finding

## The fix (applied, verified live in durable dispatch records)

`RESTART_WINDOW_RETRY` (flows/port-project.ts): `maximumAttempts 8,
initialIntervalMs 5000, backoffCoefficient 2, maximumIntervalMs 30000` — waits
5+10+20+30×4 ≈ **155 s of retry span across 8 attempts**, comfortably over the
120 s target and a 60-90 s restart window. Applied to every marker/model/review
surface: all 10 `envelopeStartMarker` specs (incl. both `PpQueueFixStart`s —
cx7's killer), all 10 `MODEL_STEP_OPTIONS` sites (implement/reviews/fixer/
queue-fix/prep loop), plus the two other dispatch surfaces cx7's resume
fingerprinted (`PpWaveJoin`, child-entry `PpChildLease`). dex 0.12.1
`RetryPolicy` has NO error-class filter (verified against dist/src/step.d.ts),
so the longer SCHEDULE applies to all failures of these steps; exhaustion
semantics are unchanged, and out-of-scope policies are untouched (PpPrep=1,
PpBootstrap=2, in-step REVIEW_STEP_MAX_ATTEMPTS=3). **Verified live**: the
durable dispatch history of cx8's fix-wave child records the raised policy on
PpQueueFixStart/PpQueueFix/PpReviewA/B(+starts)/PpChildLease, and the parent's
continued-run join carries it (/tmp/metrics-cx8/retry-policy-proof-{parent,
child}.txt) — the exact step class that burned 3 attempts/~7 s in cx7 now
carries ~155 s.

## What cx8 ran

Full CreatorPay, 10 units (5 src + 5 test ports), watcher armed BEFORE
startFlow (09:49:25 UTC vs flow start 09:49:42), maxRounds 3, epoch 1,
repo /tmp/pk-cx8. **FLOW_STATUS_COMPLETED at 10:31:53 (42 min)** — with a dex
`CONTINUED_AS_NEW` run rollover mid-run at 10:22:12 (01a0e245 → 08c927e6,
event 599): the new run re-executed bootstrap (SKIP — idempotent no-op),
dispatch, wave-join (children already terminal), verify — **zero re-ports,
durable state carried verbatim**. First witnessed rollover survival inside a
run (weaker than kill+resume, same mechanism). Final: tsc 0, vitest RAN
40/3/43 (3 ported-test failures honest at completion), done = 10 units +
3 fix rounds, keyed commits reachable at integration HEAD, no duplicate
op-IDs, skipped-vs-completed dedup visible (14 skipped / 173 completed).

## What cx8 does NOT prove: the kill never fired

NEW OPERATIONAL FINDING (cx6b delivery-lag family, now quantified): **the
watcher's stream lane consumes the retained stream at ~1 message per
pollInterval** (one `readStream` per cycle + sleep), so under the prep+wave
backlog its cursor fell ~28 min behind reality (at 10:29:45 it read an
envelope published 10:01:41). Both pp-queue-verify active windows in this run
lasted only ~1.1-1.6 s (10:27:09.9→10:27:11.4, 10:31:52.3→10:31:53.5) — far
below the 60 s poll cadence. Result: the round-1 trigger message was never
reached in time; the flow completed before any firing. Both watchers exited
on the TERMINAL branch (r1 fix) — exactly-once held (0 firings), no sidecar,
no kill. The one allowed config retry (re-arm at `--poll-seconds 1`,
10:35:25) landed after close. The resume half of the arc is therefore
config-verified but NOT behaviorally exercised; kill+resume+COMPLETED in ONE
flow remains unwitnessed. Candidate fixes, NOT improvised under the bound:
drain-to-head stream reads per cycle (loop `readStream` until null), or a
typed dispatch-history trigger, or a widened verify window.
*Superseded 2026-09-30: audit C27 fixed the cause. After a START the catch-up
read used the full poll interval, so the DONE landed in the same batch and the
stale-start guard cancelled the kill. `--poll-seconds 1` is no longer a
workaround, and the follow long-poll wakes on publish whatever `--poll-seconds`
is.*

## Battery + AC2 (honest)

- Battery: /tmp/metrics-cx8/ac1-battery-cx8.txt — **20 PASS / 6 FAIL**, all
  six fails are the absent kill arc (sidecar presence/ordering/anchoring,
  post-kill activity, close-after-kill); every substance check PASSES
  (completion, zero re-ports, no dup op-IDs, 10 units / 5 test ports,
  reachability, content, bootstrap, honest vitest, burn-down, dedup).
  Battery adaptation: the done-set check now asserts DISTINCT round-1 units —
  fix rounds APPEND entries (13 = 10 units + 3 fix rounds), which cx7's
  strict `length === 10` check did not anticipate.
- AC2: /tmp/metrics-cx8/report.{md,json} — **provenance_ok=true**, 116
  envelopes (25 start markers, 0 interrupted, 0 degraded), 16 verdict
  records, 0 tombstones, dispatch anchoring OK (240 entries, 0 unexplained),
  kill events: none recorded (honest). Tokens: 1,320,554 model-role.
- Evidence: /tmp/metrics-cx8/{watch-cx8-first-arm,watch-cx8b-rearm,
  worker-cx8,demo-cx8}.log, retry-policy-proof-{parent,child}.txt; repo
  /tmp/pk-cx8; battery script /tmp/ac1-battery-cx8.ts.

## Operational disclosures

- The pre-existing dex server/worker pair (cx7-arc leftovers, started BEFORE
  the fix) was stopped and restarted on the same default sqlite DB
  (~/.dex/dev/7233) before startFlow — a config-level turnover so the raised
  budgets were live; both are story-owned processes.
- Bounds used: ONE cx8 dispatch; ONE config retry (watcher re-arm); no cx9.
  329/0 tests, typecheck clean at the commit.

# Stage 3c finale — cx9 (2026-09-27): the final validation run; US-002/003/007 live observations captured, the kill arc suppressed by design

## The two pre-run fixes (commit 2ee82f3, 343/0, tsc clean)

- **F2-follow guard**: the queue-verify watcher's post-arm catch-up fired on
  ANY pp-queue-verify START the moment it was read — before its matching DONE
  (later in the same batch) or the terminal status was seen. The follow batch
  is now drained to exhaustion FIRST and gets the SAME activeAttemptStarts
  event-key correlation + terminal-status gate as the arm-time drain.
  Regression test ([OTHER, START, DONE] follow batch + terminal flow → clean
  exit, 0 firings) verified FAILING on pre-fix code.
- **Memo PENDING isolation test**: the cross-flow memo-keying test passed
  even without flow/run key components (X settled — hygiene delete — before
  Y ran). New case: X's execution THROWS mid-attempt (repair turn degenerate
  after memoize), leaving its reply PENDING; Y on the same step+diff
  replaying the identical text must repair for its OWN arm-(b) evidence only
  — the repair turn must not gain a cross-flow verbatim-repeat reason.
  Verified FAILING under step+diff-only keying.

## What cx9 ran

Full CreatorPay, 10 units (5 src + 5 test ports), watcher armed BEFORE
startFlow (stream lane + 5 s follow cadence), dispatch gate surfaced
pre-dispatch, restart-on-kill sentinel armed, dashboard subscriber live on
:4646, LIVE Jev lane. Infra restarted per the operational rule (server on
the 7233 DB up first, worker up BEFORE startFlow).

Two dispatches, one of them the sanctioned config-miss retry: the first
`cx9` startFlow used the DEFAULT prep stub and failed in 41 ms ("prep source
map lacks rows for: <all 10 files>" — PpPrep maximumAttempts 1, fatal by
design); the corrected dispatch (`--prep fixtures/creatorex-middleware/
prep-stub.md --source-root fixtures/creatorex-middleware`) hit the
duplicate-flow-id rejection and landed as **cx9b**
(runId 01a0e304-b36d-7edc-b52a-397d5d3c5132 → CONTINUED_AS_NEW rollover →
453b9435-91aa-4b10-91f2-294bc31ddd9f). **FLOW_STATUS_COMPLETED at
17:48:52Z (4 h 30 min)** — 13 done rows = 10 units + 3 fix rounds, tsc 0,
vitest RAN 39/4/43 honest at completion, keyed commits reachable, 13/13
outputs at integration HEAD, no duplicate op-IDs, 15 skipped envelopes
(dedup visible), a mid-run CONTINUED_AS_NEW rollover survived, ~1.32 M
model-role tokens (the prep-generate degenerate-retry grind: attempts 1–4
aborted at ~13 min each before attempt 5 succeeded — the fixture's known
degenerate-provider window, ridden out entirely by the declared retry
policies).

## The deferred live observations (all captured, /tmp/metrics-cx9 + repo copies)

- **US-002 gate**: `gate: degraded (…fail-open); proceeding WITHOUT
  lane-health protection` — surfaced pre-dispatch AND in the runner output
  (presentation/assets/dispatch-gate-cx9.txt). The fail-open-as-visible-
  operator-decision requirement, witnessed.
- **US-003 turn_diagnosis**: ONE durable record —
  `pp-prep-review-b#2@prep0`, attempt 2, lane `demoted`,
  prior_failed_attempts 1, disposition `recorded-evidence` (14:51:28Z): the
  deterministic successor re-record fired live. Honest limit: the
  prep-generate degenerate retries (Tier-0 throwing attempts) left no
  durable trace (0(g)) and the succeeding agent-step envelope carries
  `turn_diagnosis: null` — the re-record is implemented on review steps.
- **US-007 subscriber**: `[serve-status] stream subscriber: up
  (port/<flowId>/events live feed)`; **zero** fallback lines across the
  whole run; the feed delivered every envelope from 13:14 to completion
  (80-event window). Poll fallback never ENGAGED.
- **Demo**: presentation/assets/demo.webm RE-RECORDED during the run
  (88 s page capture at ~14:22 UTC — cx9b mid-flight, retry chain visible).
- **AC2**: presentation/assets/report-final.md — **provenance_ok=true**
  (77 envelopes final run, 16 start markers, 0 interrupted, 8 verdict
  records, 0 tombstones, 0 degraded rounds, kill events honestly "none").
- Battery: presentation/assets/ac1-battery.txt — **20 PASS / 6 FAIL**, the
  six fails all the absent kill arc; every substance check PASSES.

## What cx9 does NOT prove: the kill never fired — and WHY (new quantified finding)

Three pp-queue-verify windows ran (17:24, 17:33, 17:48 UTC); all three were
suppressed by the F2-follow guard with the log line `skipped 1 stale
queue-verify start(s) in the follow batch (matched by completion — no active
attempt)`. Each START arrived in the same batch drain as its DONE: the
follow long-poll returns retained messages immediately, so a ~1.5–2 s window
that closes within one read cycle is ALWAYS a matched pair before any firing
decision. **Under the fix-wave semantics a ~2 s verify window is
structurally unkillable via the stream lane** — that is the guard doing its
job (zero false kills; exactly-once held; clean terminal exit), with a
quantified cost. Remaining live-fire paths: the poll fallback phasing into a
window (5 s cadence vs ~2 s ≈ 30 %/window — missed 3/3), or a cadence at the
LOW end of the sanctioned 1–5 s range (a 1 s long-poll ends the batch BEFORE
the DONE arrives → unmatched live start → fireable mid-attempt). Candidate
paths forward, NOT improvised under the bound: a verify-window heartbeat
(durably widen the window), a dispatch-history trigger, or a 1 s-cadence
arm. Per bounds: documented, no cx10. kill+resume+COMPLETED in ONE flow
remains unwitnessed; everything else the single-flow triple needed is now
proven (COMPLETED with fix rounds, rollover survival, honest verify,
dedup, raised budgets live through the 65-min prep grind).

## Operational disclosures

- Infra turnover before the run: the old serve-status and the leftover
  temporal servers (7233–7236, story-owned children of past dexcli dev
  runs) were stopped; dexcli dev restarted on the SAME 7233 DB, worker
  started before startFlow, dashboard restarted with captured stdout.
- Process note: an external (coordinator-side) watcher with the real runId
  and a 90-min bound replaced the executor's 150-min instance at 16:54:38Z
  (same sidecar path, single-watcher invariant held). Its bound covered the
  final windows; the suppression was the guard, not the bound.
- Bounds used: one corrected dispatch + the sanctioned config-miss retry;
  watcher bound extension (no window was missed by it); no cx10.
  343/0 tests, tsc clean at the commit.

---

# Post-audit contract changes (2026-09-30)

Recorded after the 2026-09-30 audit; they supersede the sections above where
they overlap. Current behaviour of the runner is in the README and the runner
reference; these are the agent-contract and spot-check changes.

- **Verdict schema** (`harness/agents/verdict-schema.ts`): every finding needs a
  `description` and a verbatim `snippet`; `disposition` is the closed set
  `fix | wontfix` (normalized, so "Fix" and "won't fix" are accepted).
  `citation_check` is advisory: the citation gate recomputes citations, and the
  mapped record shows the deterministic check, not the reviewer's own.
- **Hunk body ranges** are 1-based, computed by one helper in
  `src/harness/runtime.ts`. This supersedes the **[M5]** numbering note.
- **Reviewer prompt**: it no longer claims PHP source or header conventions
  that the reviewer never receives. The porting conventions are reproduced in the
  prompt, and the diff header carries only the diff id, file, round and
  line-numbering information.
- **Tool policy block**: it follows the `tools` map actually sent. In bridge
  mode that is NONE for every agent.
- **Jev spot check** (`scripts/jev-spot-check.ts`): the gate is a 90% target AND
  the deterministic first-candidate baseline plus 2 points. The offline
  first-candidate double scores 37/39 = 94.9% on the shipped fixtures, so a live
  run has to reach about 96.9% to pass. The symbol cap is `SYMBOL_HARVEST_CAP = 20`
  (`src/harness/runtime.ts`), with a truncation note.
- **Offline judgment**: `createJevClient` was removed;
  `createOfflineJevClient` is the only offline factory. Rows picked by it are
  tagged `judge=scripted` and shown to the planner as UNVERIFIED.
- **User contract**: `PrepArtifact.userContract` stores the user's `PORTING.md`
  by value. Implement, fix and queue-fix turns receive it as the authoritative
  user contract; per-file port reviewers do not. Only the source-map rows are
  deterministic; the rest of `PORTING.md` is seed text that the planner lane
  rewrites into the generated spec.
