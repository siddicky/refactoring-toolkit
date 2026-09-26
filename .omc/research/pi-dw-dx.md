# Research: pi-dynamic-workflows (QuintinShaw/pi-dynamic-workflows) vs OUR toolkit

- Lane: worktree isolation, UI/observability, developer experience
- Clone: `/tmp/pi-dw-dx` (depth-1, 2026-09-25). ~24.7k LOC TypeScript across 54 files in `src/`.
- Nature of the beast: a **pi coding-agent extension** (in-process, single-host). Its engine is an
  async TS function (`workflow.ts`) that spawns child agent sessions, journals call results to disk,
  and replays them on resume. It is NOT a durable distributed-flow engine: no server, no workers,
  no dispatch log. Everything below should be read through that lens.
- Our baseline: `.omc/plans/2026-09-25-porting-toolkit-consensus.md` (v6.1) + `BUILD_NOTES.md`
  (Phase 0 a–h + trial gate + verify-fix + Phases 3/4, all live-evidenced).

---

## 1. Isolation: "worktree" + keepWorktree semantics

### What they do

**Creation** — `src/worktree.ts:59-85` (`createWorktree`):
- Branch name: `pi/wf/<slug(name)>-<uuid>` (`worktree.ts:64,74`); path `<repoRoot>/.pi/worktrees/<id>` (`:73`).
- Created at **HEAD** (`worktree add -b <branch> <path> HEAD`, `:76`). No base-SHA record, no lease record, no epoch.
- `:53-57` — "A unique suffix gives each live execution its own ownership; retained results from
  earlier executions are never reused or overwritten." Uniqueness by uuid collision-avoidance, not by ownership leasing.
- **Agents do the git work themselves** — the agent session runs with `cwd` = the worktree
  (`worktree.ts:36-38`); there is no sole-committer. Commits (if any) are whatever the agent does.

**keepWorktree semantics** — `src/workflow.ts:1301-1310` (finally block) + `workflow.ts:2289`:
- `keepWorktree: options.keepWorktree !== false` — **default TRUE** for worktree-isolated agents;
  the worktree (and its branch, with any agent-made commits) is kept after the call.
- `keepWorktree === false` → `removeWorktree()` deletes worktree + branch immediately (`:1303-1305`).
- **There is NO merge step anywhere.** `worktree.ts:3-4`: "Results are NOT auto-merged."
  `src/workflow-capability-contract.ts:336`: "keepWorktree defaults true (worktree kept **for merge**)" —
  i.e. merge is the *host user's* manual job after the run. Grepping `merge` across `workflow.ts`/
  `workflow-manager.ts` finds only delta-store merge and settings merge — zero git merge code.

**Failure semantics** — `worktree.ts:70,78-84`: if `worktree add` fails (or its 30s timeout fires),
isolation **degrades to the base cwd** with `isolated: false` + a human reason (`:31-41`). The agent
then runs **unsandboxed in the main checkout**.

**Hygiene worth noting** (their audit trail is good):
- Every git invocation bounded: 30s timeout + 4MB maxBuffer (`worktree.ts:20-29`, "a hung git … must
  not block agent spawn or teardown forever").
- `cleanupFailedWorktreeAdd` (`worktree.ts:98-130`): ordering rule — a killed `worktree add` can leave
  a registered tree; `branch -D` is refused until registration is gone, so they **deregister before
  deleting the branch** (`:101-105`), rm with `maxRetries` for post-SIGTERM writes (`:110-114`), and
  **deliberately never run `git worktree prune`** because it "mutates unrelated stale registrations"
  (`:117-121`).
- `removeWorktree` (`:133-148`): a failed worktree removal does **not** authorize deleting the branch
  (`:137-139`) — conservative destruction ordering.

**Resume model** (for contrast): durability is a **disk journal of agent-call results** replayed on
resume (`run-persistence.ts`, `workflow.ts:1170-1192` `storeDelta/discardDelta`), plus pause/resume
**checkpoints** (`workflow-manager.ts:320,1752-1756,1865-1878` — resume requires the exact
checkpointId and rejects stale responses). No git-level recovery, no reconcile, no commit dedup.

### Comparison vs ours (WorktreePool: epoch+base-SHA leasing, reconcile(), sole committer, integration branch)

| Concern | pi-dw | Ours | Winner |
|---|---|---|---|
| Branch ownership | uuid suffix, no records | durable lease: holder+epoch+base SHA | ours |
| Merge/integration | none — manual, post-hoc | durable integration step → one `integration` branch, queues verify it | ours (their model can't verify cross-file imports at all) |
| Commit identity | none (agent commits ad hoc) | op-ID (file+round), content-hash as evidence, cross-branch dedup | ours |
| Crash recovery | journal replay + checkpoints | reconcile() table, commit-preserving, poisoned-lease semantics | ours (theirs silently skips if journal lost) |
| Isolation failure | **falls back to base cwd** (unsandboxed) | quarantine/poison; blocked-with-diagnostics | ours — theirs is a real integrity hole |
| Git-call bounding | 30s timeout + maxBuffer on every call | not bounded (our git seam has no per-call timeout) | **theirs** |
| Failed-create cleanup | deregister-before-branch-D; never global prune; retry rm | not handled explicitly in our acquire() | **theirs** |

**Steals (small, real):**
1. **ADAPT: bounded git exec** — wrap every `git` call in our `src/git/worktree.ts` with a timeout +
   maxBuffer (their `GIT_EXEC_OPTIONS`, `worktree.ts:20`). A hung git inside our commit/integrate
   step currently burns a dex attempt heartbeat instead of failing fast. Cost S.
2. **ADAPT: failed-acquire cleanup ordering** — if our `acquire()`'s `worktree add` half-fails, reuse
   their order (remove registration → rm with retries → targeted branch -D; **never** `worktree
   prune`) and their rule that branch deletion is never authorized by a failed removal. Cost S.
3. **REJECT (lesson): degraded isolation** — their run-in-base-cwd fallback is exactly what our
   deny-list/quarantine design exists to prevent. Nothing to adopt; useful as a contrast slide
   ("our isolation fails *closed*").

---

## 2. Observability & control

### What they have (with evidence)

**Lifecycle broadcast** — `src/task-panel.ts:653`:
`export const WORKFLOW_LIFECYCLE_EVENT = "pi-dynamic-workflows:lifecycle"`.
- NOTE: the brief asked to check "WORKFOLW_LIFECYCLE_EVENT" — **there is no such typo in the source**
  (`grep -rn WORKFOLW src/` → 0 hits). The real, correctly spelled name is above.
- Payload (`task-panel.ts:654-661`): `{ status: "started"|"resumed"|"paused"|"completed"|"failed"|"stopped",
  runId, name, sessionId? }`.
- Emitted by mapping manager events → statuses (`task-panel.ts:1301-1319`): `started→started`,
  `resumed→resumed`, `paused→paused`, `complete→completed`, `error→failed`, `stopped→stopped`.
  Broadcast over `pi.events.emit(...)` so any other extension/session can subscribe. It is a coarse,
  run-level, 6-value channel — intentionally tiny.

**Live progress panel** — `src/task-panel.ts` (1,782 lines): a bottom-of-screen panel rendering the
run's snapshot (agents × status × phase) inside the pi TUI, fed by manager events with throttled
streaming token updates (the `audit2 #22` comment at `workflow-ui.ts:653` notes `tokenUsage` events
fire ~4/s per streaming agent). Detail pager keeps full agent results (`display.ts:24-26`).

**Per-agent cost reporting (real vs estimated)** — the best-in-repo idea:
- `src/agent-usage.ts:1-16` — `AgentUsage {input, output, cacheRead, cacheWrite, total, cost,
  estimated?}`; `estimated` = "True when these figures come from a character-count heuristic because
  the provider reported no usage — NOT a measurement. … Rendering uses a `~` prefix" (`:11-15`).
- Propagation: `sumAgentUsage` ORs `estimated` into totals (`:30`) — an estimate **contaminates** the
  sum's flag so no roll-up can pass an estimate off as metered fact.
- The heuristic: `estimateTokens = ceil(JSON.stringify(value).length / 4)` (`workflow.ts:2350-2352`),
  applied only via `commitWithFallback` when the provider returned nothing (`workflow.ts:1177,1220`).
- Rendering: `display.ts:144-159` — `~` prefix on any estimated figure; `fmtCost` (`display.ts:160-166`)
  prints `$1.23`, 4 decimals under $0.01, `<$0.0001` floor ("a real cost never rounds to a
  zero-looking `$0.00`").
- Per-agent snapshot carries `tokens`, `tokenUsage` (breakdown), `model`, `cost`
  (`display.ts:41-52,285-303`); run totals carry `cost` + `estimated` (`display.ts:56-67`).

**`/workflows` TUI navigator** — `src/workflow-ui.ts` (2,346 lines):
- View hierarchy `runs → phases → agents → detail` (+ `savedDetail`) (`workflow-ui.ts:108`);
  header doc `:8-10`: "On runs: **p pause · x stop · r restart · s save · q quit**; On saved: x delete".
- Filter mode (typed `/`), rename, confirm dialogs for pause/stop/deleteSaved
  (`workflow-ui.ts:111,507`); paging via viewport math (`:1419-1499`).
- Per-run rows show done/total, token segment, and **cost column** (`:1482`:
  `[done/total, tok, row.cost > 0 ? fmtCost(row.cost) : ""]`).

**`/workflows` slash command** — `src/workflow-commands.ts:41`:
`/workflows [list] | run <prompt> | status <id> | watch <id> | stop <id> | pause <id> | resume <id> | rm <id> | save <name> [runId]`.
- `watch` (`:77-121`): subscribes to `agentStart/agentEnd/phase/log/tokenUsage` and renders a
  **one-line live status into the status bar** (`oneLineProgress`, `:46-55`:
  `◆ name: 3/7 done, 2 running, 1 err · phase`), then prints the final snapshot into the chat on
  settle. Listener cleanup on all terminal events (`:89-93`).

**`/workflows-progress`** — `src/workflow-editor.ts:240-279`: panel density control —
`compact | detailed | status` + `max <1-1000>` agents per phase; persisted as a setting.

**`workflow_control` tool (model-facing)** — `src/workflow-control-tool.ts:39-47,90-105`:
the **agent itself** can `list | status | pause | resume | stop` any run by runId; its
`promptGuidelines` (`:100-103`) say "do not ask the user to type /workflows when this tool can
perform the action". Run details include structured counts `{total, done, running, queued, error,
skipped}`, `activeLabels`, `tokenTotal`, and an explicit `tokenTotalEstimated` boolean
(`:69-73`) — the model gets honesty-flagged numbers, not vibes.

**Interrupt settlement** — `src/run-agent-settlement.ts:19-32`: on any terminal status, leftover
queued/running agents are rewritten to `skipped` with cause `interrupted` — display-only; the
replay journal stays authoritative.

### Comparison vs ours (web dashboard :4646, metrics report, kill-events sidecar)

Our strengths they lack entirely: provenance cross-check (envelope ↔ dex dispatch typed 1:N),
agreement/citation metrics, kill timeline with intent-before-SIGKILL ordering, burn-down, envelope
event identity `stepId#attempt@file#round` (they have nothing below run granularity in their
broadcast; per-agent rows exist only in-session). Their lifecycle channel has no provenance
ambitions — it's a doorbell, not a ledger.

What they have that we don't:
1. **Per-agent USD cost + fresh/cache token split** in every view (grid, list, detail).
2. **Estimated-vs-metered integrity flag** propagated through sums and rendered as `~`.
3. **Operator control from the run surface** (pause/stop/resume) — our dashboard is strictly
   read-only (`scripts/serve-status.ts:6` "GET /api/state aggregated JSON snapshot"; no POST
   control endpoints).
4. **A one-line headline status** consumable anywhere (status bar / any subscriber).
5. Density controls (compact/detailed/max-N rows).
6. TUI alternative to the web page.

**Recommendations for ours:**
- **ADOPT (S): cost columns + `~` estimated flag.** Our opencode seam already extracts real usage
  incl. `info.cost` (BUILD_NOTES finding #5); the envelope already carries per-step tokens. Render
  per-agent/per-role USD + fresh-vs-cache in the dashboard grid and metrics report; add an
  `estimated` bit on the envelope tokens field, propagate through totals exactly like
  `sumAgentUsage`, render `~`. Directly strengthens AC2 ("missing required token usage = fail")
  with an honesty axis.
- **ADAPT (M): pause/stop operator intent from the dashboard.** Do NOT let the browser mutate dex
  state (that would break envelope-as-render / dex-as-truth). Instead: dashboard button → POST to
  `serve-status.ts` → writes an **operator-intent record** into the same evidence sidecar family
  (kill-events-style, intent-before-action) and invokes the dex-native cancel/resume via the
  toolkit-owned client. The run then treats it exactly like a chaos-kill (resume proof included).
  For the VP demo this is the "we can stop the machines and prove recovery live" moment.
  Prereq: confirm the dex 0.12.1 cancel/resume seam (Phase-0-style probe first).
- **ADAPT (S): run-level lifecycle broadcast.** A 6-value `status` event (started/resumed/paused/
  completed/failed/stopped + runId) derived purely from envelope/dispatch state — a render, not a
  new source of truth. Powers the headline line, lets the dashboard/phone/slack subscribe without
  parsing envelopes. The `resumed` event firing live after the AC1 kill is the money moment.
- **ADAPT (S): headline one-liner** (`◆ port-project: 5/9 files, 1 running, 1 blocked · round 2`) —
  pure render over state.ts; trivial to add to serve-status and printed by run-demo at exit.
- **REJECT: the TUI** as a v1 item — we demo the web page; a terminal navigator duplicates it.
  Revisit only if someone wants SSH-headless monitoring (then it's a 30-line curl | less render,
  not 2.3k LOC).
- **REJECT: `workflow_control` model-facing tool** — our agents must never steer the flow (sole
  committer, tool-surface-off principle). Operator control is human, via the dashboard above.

---

## 3. Developer experience

**Keyword trigger arming** — `src/workflow-editor.ts:305-391`:
- Default trigger word `"workflow"` (`src/config.ts:36`); regex matches `workflow|workflows`
  case/unicode-insensitive anywhere in the message (`workflow-editor.ts:28-40`).
- On trigger at submit: rewrites the user's prompt into an armed directive
  (`buildArmedWorkflowPrompt`), **injects the `workflow` tool into the active tool set** (keeping all
  other tools so the model can explore first, `:329-345`), restores the original tool set on
  `turn_end` (`:379-390`). Suppression path so the armed turn itself isn't re-armed (`:341-343`).
- Also arms on **standing effort mode** for any "substantive" message, with a conversational-escape
  directive so chit-chat doesn't spawn workflows (`:343-346,413-418`).

**Saved workflows + composition** — `src/workflow-saved.ts`, `src/saved-commands.ts`:
- `SavedWorkflow {name, description, script, parameters schema, source: "project"|"legacy"|"user"}`
  (`workflow-saved.ts:14-27`); save defaults to the **project tier** (`:62`); load precedence
  **project > legacy > user**, one highest-precedence row per name (`:62-70`).
- Names are simultaneously slash-command names and filenames; one validator guards all three paths
  (`:84+`). Concurrent-mutation safety via a sha256 `savedWorkflowRevision` fingerprint checked on
  every write (`:46-57`).
- `src/saved-commands.ts:2-3,52+`: **each saved workflow is dynamically registered as a `/<name>`
  slash command** that runs its script with parsed args; save/rename refuse names already owned by
  the host or another extension (`:19-27` — "Pi cannot unregister a slash command", so they
  watermark their own).
- Built-in reference workflows ship as data: deep-research, adversarial-review, code-review,
  multi-perspective, codebase-audit (`src/builtin-workflows.ts:69-134`).

**Settings overlays (3 tiers)** — `src/workflow-settings.ts:116-131`:
precedence (later wins): **global user settings** → **project-local in-repo file**
`<cwd>/.pi/workflows/settings.json` ("lets a repository ship workflow defaults with the project",
`:105-107`) → **per-project user override** `~/.pi/workflows/projects/<key>/` (so a user's personal
override beats the repo default). Save scope is explicit `global | project` (`:90-91`); unset
fields are absent-not-default so "explicitly zero" can cancel a global budget (`:26`).

**Run storage retention** — `src/run-persistence.ts:271-281,553-580`:
`DEFAULT_MAX_TERMINAL_RUNS_ON_DISK = 300`; only **terminal** runs (completed/failed/aborted) age
out, oldest-`updatedAt` first; **running/paused/undelivered runs are never counted or evicted**
(`:557-559` filter); enforcement runs after every terminal save, with a liveness check so a run
held by a live process lock is skipped and retried next pass (`:564-576`). Plus a 300ms list cache
TTL to bound per-poll directory scans (`:349,482-487`).

### What's worth adopting for our run-demo/scripts story

- **ADAPT (S): settings overlay for the demo harness.** We currently pass run shape via a pile of
  `PORTING_KIT_*`/env flags and `run-demo.ts` args. A 3-tier JSON overlay — repo-shipped
  `porting-kit.json` defaults (maxRounds, reviewer agent, queue caps) → user override → CLI flags
  win last — matches their proven precedence shape and makes the VP demo reproducible from a
  checked-in file. Cost S (one loader in `src/config` + doc note).
- **ADAPT (S): evidence retention cap.** We emit kill-events/burn-down/metrics artifacts per run
  into `metrics/` and `/tmp` with no bound. Adopt their exact policy shape: only terminal runs
  count, oldest first, N=300 default, active runs never evicted, never delete while a live
  process lock (our worker pid) holds it. Cost S.
- **ADAPT (S, cheap): collision-safe command naming discipline** — not their feature, but their
  rule "can't unregister, so watermark what you own" maps to our script namespace: keep all
  `scripts/*.ts` entrypoints prefixed (`run-demo`, `chaos-kill`, `serve-status`) so a future
  `/`-style dispatcher can claim names safely. Zero-cost convention.
- **REJECT: keyword arming + saved-workflow slash commands** — we are a script/flow-driven toolkit,
  not an interactive chat harness; there is no user prompt to arm and no slash-command host. Their
  "saved workflow + parameters schema" *idea* maps weakly to "a second demo flow"; out of v1 scope
  per plan non-goals.
- **NOTE: built-in reference workflows** — their value is that the repo ships 5 executable examples.
  Our analogue (per plan non-goals: "reusable docs not required") is the checked-in fixture +
  single flow; fine as-is for v1.

---

## 4. VERDICT table

Checked against our principles: **envelope-as-render** (everything on screen derives from the
envelope/verdict/queue/kill streams), **sole committer** (agents never touch git), **dex-as-truth**
(durable state lives in dex attributes/dispatch, never in tooling-local caches).

| # | Feature (their ref) | Verdict | Cost | Rationale / principle check |
|---|---|---|---|---|
| 1 | Worktree-per-agent at HEAD, keepWorktree default-true, no merge (`worktree.ts:59-85`, `workflow.ts:1301-1310`) | **REJECT** | — | Strictly weaker than leasing+reconcile+integration; no commit identity; merge is manual. Duplicates nothing of ours; serves a different (non-durable) model. |
| 2 | Degraded isolation on failure → base cwd (`worktree.ts:70,83`) | **REJECT** | — | Fails *open*; our quarantine/poison + blocked-with-diagnostics is the correct opposite. Contrast-slide material. |
| 3 | Bounded git exec: 30s timeout + maxBuffer on every call (`worktree.ts:20-29`) | **ADOPT** | S | Hardens our commit/integrate steps against hung-git heartbeat burn. Principle-neutral. |
| 4 | Failed `worktree add` cleanup: deregister-before-branch-D, retry-rm, never `worktree prune`; failed removal never authorizes branch deletion (`worktree.ts:98-148`) | **ADOPT** | S | Exact hygiene our `acquire()`/release path lacks. |
| 5 | Per-agent cost: fresh/cache split + USD + `~`-estimated integrity flag propagated through sums (`agent-usage.ts:1-32`, `display.ts:144-166`, `workflow.ts:2350-2352`) | **ADOPT** | S | Pure render over usage we already collect (opencode `info.cost`). Strengthens AC2 honesty axis. Highest demo value per LOC. |
| 6 | Operator pause/stop/resume from the run surface (`workflow-ui.ts:9`, `workflow-commands.ts:41`) | **ADAPT** | M | Ours must route through a toolkit-owned intent record + dex-native cancel/resume (dex-as-truth preserved; dashboard stays read-only render + intent sidecar). Needs a dex cancel/resume seam probe first. Best live-demo moment after cost columns. |
| 7 | Run-level lifecycle broadcast `pi-dynamic-workflows:lifecycle` with 6-value status enum (`task-panel.ts:653-661,1301-1319`) | **ADAPT** | S | Cheap derived event for external subscribers + dashboard headline; the live `resumed` event narrates AC1. (Exact name verified; no `WORKFOLW` typo exists in source.) |
| 8 | One-line headline status `◆ name: d/t done, N running, E err · phase` (`workflow-commands.ts:46-55`) | **ADAPT** | S | Trivial render over `state.ts`; use in serve-status banner + run-demo exit line. |
| 9 | `/workflows` TUI navigator (2.3k LOC: filter/paging/pause/stop/save) | **REJECT** | L | Duplicates our web dashboard in a second surface; no v1 demand. Revisit as a tiny read-only render only if headless SSH monitoring is ever needed. |
| 10 | `workflow_control` model-facing control tool (`workflow-control-tool.ts`) | **REJECT** | M | Violates sole-committer/agent-minimal-surface principle; operator control stays human (via #6). |
| 11 | Bottom progress panel + `/workflows-progress` density modes (`task-panel.ts`, `workflow-editor.ts:240-279`) | **REJECT** (idea) / **ADAPT** (density) | S | Panel itself is host-TUI-specific; keep compact/detailed/max-N row-density as a dashboard query param. |
| 12 | Keyword trigger arming + standing-effort auto-arm (`workflow-editor.ts:305-391`) | **REJECT** | — | No interactive chat harness in our toolkit; script-driven entrypoints. |
| 13 | Saved workflows as `/<name>` commands, project>user precedence, sha256 revision guard (`workflow-saved.ts`, `saved-commands.ts`) | **REJECT** | — | No slash-command host; our saved-flow story is the checked-in flow + fixtures. The revision-fingerprint pattern is a nice convention to remember for any future artifact store. |
| 14 | 3-tier settings overlays: global → repo-shipped → user-per-project (`workflow-settings.ts:116-131`) | **ADAPT** | S | Replace env-flag soup for run-demo config; repo ships demo defaults, user override stays uncommitted. Principle-neutral. |
| 15 | Terminal-run retention: 300 cap, terminal-only, never evict live/undelivered, lock-aware (`run-persistence.ts:271-281,553-580`) | **ADAPT** | S | Bound our `metrics/` evidence growth with the same policy shape. |
| 16 | Interrupt settlement: leftover running agents → `skipped/interrupted`, display-only (`run-agent-settlement.ts:19-32`) | **REJECT** | — | We already do this more honestly: envelope `interrupted` + kill-sidecar closed envelopes, not a display rewrite. |
| 17 | Per-agent streaming token updates throttled (~4/s, `workflow-ui.ts:653` audit2 #22) | **ADAPT** (note) | S | Our dashboard is poll-based; adopt the same throttle budget when/if we add streaming. |

## 5. Top steals for the VP demo (PHP→TS migration, live dashboard)

1. **Cost columns + `~` estimated flag (#5, S)** — per-agent USD and fresh/cache tokens in the
   agents×worktrees×tasks grid and in report.md. VP-legible money, honest estimation semantics,
   and we already own the data. Ship before the demo.
2. **Lifecycle headline + `resumed` broadcast (#7+#8, S)** — a run-level status line on the
   dashboard that visibly flips `running → (kill) → resumed → completed` during the AC1 chaos
   moment. Turns our durability proof into a narrated visual beat instead of a log.
3. **Operator pause/stop with intent-record (#6, M)** — dashboard buttons that write an
   intent-before-action record and drive the dex-native cancel/resume, reusing the AC1 recovery
   machinery live. Highest wow, gated on a small dex seam probe; if the seam resists, ship #1+#2
   and demo stop via `chaos-kill.ts` as today.

Nothing in the clone threatens or obsoletes any of our baseline design; its durability (journal
replay) is categorically weaker than our dex-anchored op-ID/reconcile proof, which the contrast in
row 1/2 makes explicit.
