# BUILD_NOTES — Phase 0 (infra spike, side-effect-real, retained as seams)

Continuation build completed 2026-09-25 by worker-1b (taking over worker-1's partially
landed Phase 0). All Phase 0 exit criteria 0(a)–0(h) were executed against live
infrastructure. No results are faked; every claim below names the command and evidence.

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
