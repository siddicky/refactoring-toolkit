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
