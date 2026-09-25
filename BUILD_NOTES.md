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
