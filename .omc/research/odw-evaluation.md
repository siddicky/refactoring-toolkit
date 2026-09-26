# ODW Fork Evaluation — Component Reuse vs. Porting Toolkit v1

- **Evaluated**: `siddicky/dynamic-workflows-dex` (fork of `Suraj1235/open-dynamic-workflows`, MIT), clone at `/tmp/odw-eval`, HEAD `972bb98`
- **Fork status**: fork HEAD is **identical to upstream HEAD** (both `972bb98494ea23f907df88850024bd7022b099d4`, verified via `git ls-remote`). Zero unique commits — any "adoption" is adoption of upstream as-is, and fixes would have to be upstreamed, not pulled from the fork.
- **Date**: 2026-09-25 · Evaluator: worker-6 (evaluation only; no toolkit code modified)
- **Stack note**: ODW is plain-JS ESM (node ≥ 20, `better-sqlite3`, `quickjs-emscripten`, `p-queue`), verified against opencode CLI **1.2.27**; our toolkit is Bun + TS-strict on opencode **1.18.32** and dex 0.12.1/0.13.5. All borrowed patterns must be re-verified against our pinned versions.

## Executive summary

1. **ADOPT nothing wholesale.** ODW solves a different problem (interactive, side-effect-free compute swarms over raw provider HTTP) with a weaker durability model than our proven dex design. Every candidate component is ADAPT (pattern) or REJECT.
2. **Biggest single finding**: ODW's "crash-resume" is **cooperative-stop + replay-cache, not SIGKILL survival**. Their own test (`packages/daemon/test/integration.test.js:277-350`) stops via the `ctl` action, and `runtime.js:163-170` explicitly **refuses to serve cached output for tool-using agents** — side-effecting work re-runs from scratch. Our op-ID sole-committer + reconcile design (Phase 0, proven live) is strictly stronger; their substrate is REJECT with high confidence.
3. **opencode plugin (question a)**: REJECT the plugin (chat-trigger orchestration layer, wrong shape for our flow-driven harness, version-skewed). ADAPT three hard-won live findings into `src/harness/opencode.ts`: early-bail when `info.error` is set (vs. our current 15-min poll), treat empty-text native-tool-turn replies as retryable host-protocol failures, and consider defaulting model-calling sessions to a text-only agent. Their `session.prompt`-resolves-on-failure finding directly explains the quirk our polling loop already works around.
4. **Critic panel (question b)**: their prompts are one-liners, materially *weaker* than our domain-specific, citation-contracted reviewer prompt; their quorum is whole-target approve/reject on model-self-reported confidence (fails our provenance bar). ADAPT only the *composition idea* of a dedicated completeness-checker (third panelist / prep-review role) as a v1.1 follow-up; our agreement rule (evidence-span overlap + severity match, deterministic max-matching) is more granular than their verdict-count quorum.
5. **Script-as-orchestrator on dex (question c)**: **incoherent as an interpreter, coherent only as a compiler — and neither is worth building for v1.** ODW's durability comes from re-running the script and replaying a node cache, which would make its replay-cache a second source of truth next to dex attributes — a direct violation of plan principle 1 ("dex attributes are the source of truth; nothing orchestrates outside flows"). If ever built, the only sound shape is *script compiles to dex steps*; that buys syntax, not capability, over our existing TS flows. REJECT for v1.
6. Small genuine gems worth stealing as patterns: **structure-preserving compaction** (drop whole JSON elements, never mid-JSON, with a dropped-paths manifest — `context-compact.js`), **per-item fan-out resilience with preserved failures**, **hard token/dollar budget gate (warn 80% / stop 100%)**, and **synthesis-step graceful degradation**. All re-implementable in ~50–150 lines of TS behind our envelope; none require the dependency.

## Verdict table

| # | ODW component | Where | Verdict | Effort if adapted |
|---|---|---|---|---|
| 1 | opencode plugin (chat trigger, embedded keyless engine, tools) | `packages/opencode-plugin/src/index.js` | **REJECT** | — |
| 2 | opencode host-model backend lessons (protocol findings) | `packages/opencode-plugin/src/host-provider.js` | **ADAPT** → our `src/harness/opencode.ts` | S |
| 3 | Critic panel (`verify()` quorum + critic roles) | `packages/daemon/src/guest-prelude.js:141-245`, `packages/core/src/roles.js:37-66` | **ADAPT** (composition idea only) / REJECT as mechanism | S–M (v1.1) |
| 4 | Script-as-orchestrator core (planner → generated `execute()`) | `packages/core/src/{planner,script-generator,topology}.js` | **REJECT** (v1); note compiler-vs-interpreter boundary | — |
| 5 | QuickJS WASM sandbox | `packages/daemon/src/sandbox.js` | **REJECT** | — |
| 6 | SQLite WAL store + node-identity replay-cache resume | `packages/daemon/src/{db,runtime,resumability}.js` | **REJECT** (dex proven stronger) | — |
| 7 | Structure-preserving compaction (`compactValue`/`compactText`) | `packages/core/src/context-compact.js` | **ADAPT** (reimplement in TS when needed) | S |
| 8 | Two-layer context-window guard + overflow self-heal | `packages/core/src/context-window.js`, `packages/daemon/src/agent-queue.js` | **REJECT** (we don't call providers directly) | — |
| 9 | Schema-suffix + tolerant extractJson + correction-feedback retries | `packages/daemon/src/agent-queue.js:178-231` | **ADAPT** (pattern; our Jev/naive parsing covers most of it) | S if needed |
| 10 | Per-item fan-out resilience (preserve failures, log drops) | `packages/core/src/script-generator.js:121-142` | **ADAPT** (envelope/flow pattern) | S |
| 11 | Hard token/cost budget gate (warn 80%, stop 100%) | `packages/daemon/src/budget.js` via `runtime.js:103-121` | **ADAPT** (envelope-level follow-up) | M |
| 12 | Synthesis graceful degradation (partial result, never hard-fail) | `packages/core/src/script-generator.js:191-207` | **ADAPT** (report/render semantics) | S |
| 13 | Tool approval gating + git subcommand allowlist | `packages/daemon/src/tools.js:4-30,470-477` | **ADAPT** (pattern only; our sole-committer is stronger) | — |
| 14 | Embedded keyless orchestrator (host-model `invoke`) | `packages/daemon/src/embedded.js` | **REJECT** (conflicts with vendor-thin seam + provenance) | — |
| 15 | Mid-run `replan()` with checkpoint-persisted sub-scripts | `packages/daemon/src/runtime.js:283-353` | **REJECT** (v1); clever, note for v2 | — |
| 16 | Trigger regexes / ultracode toggle / MCP bridge / adapters | `packages/opencode-plugin/src/index.js:27-60`, `packages/mcp-server/**` | **REJECT** (out of scope) | — |

## Detail per component

### 1–2. The opencode plugin vs. our harness seam (mission question a)

**What it does.** The plugin is an interactive orchestration front-end: a `chat.message` hook detects workflow intent via regexes (`index.js:27-60`), then tries three paths in order — (1) run the whole engine **embedded in-process** on the host's own model via `client.session.prompt` ("keyless", `index.js:338-360`), (2) delegate to a local daemon over localhost HTTP with bearer auth (`index.js:80-138`), (3) inject a "orchestrate yourself with native subagents" directive (`index.js:276-287`). It also registers `odw_plan/run/status/workflows/ultracode` custom tools (`index.js:398-486`).

**How ours does it today.** Our `src/harness/opencode.ts` is not a plugin at all — it is a durable-step seam called from dex flows: epoch-tagged session creation (`createSession`, lines 133-142), usage-extracting prompt with a poll loop (lines 155-189), abort+confirm with retries (lines 220-227), and the enumeration-fallback fencer `abortSessionsNotTagged` (lines 243-251). We have no chat hook, no intent detection, no embedded engine — by design (vendor-thin seam, plan principle 5).

**What their live-verified protocol findings are worth to us** — `host-provider.js` documents behaviors they verified against opencode 1.2.27, several of which map directly onto our seam:

- **`session.prompt` resolves (does not reject) on upstream failure**, with empty `parts` and the error in `payload.info.error` (`host-provider.js:21-22`, enforced at `:103-107`). Our seam's `hasAbortedError` only recognizes `error.name === "MessageAbortedError"` (`opencode.ts:304-308`); an upstream connection failure would leave `usage === null` and we would poll for up to 15 minutes (`PROMPT_WAIT_MS` default 900000, `opencode.ts:83-87`) before returning null → provenance failure. **Adaptation:** bail early when `info.error` is present, classifying it as aborted/failed rather than "still working". Effort S, contained in `src/harness/opencode.ts` + tests.
- **Empty text + native tool-turn markers is a distinct failure class** (`hasNativeToolTurn`, `host-provider.js:98-102,124-127`): a session on an agent with native tools (e.g. opencode's `build`) returns tool-call turns with no text-protocol payload, which they rethrow as retryable `service_unavailable` rather than letting it be eaten as an empty schema reply. Our reviewers already get every tool denied server-side via the `tools` map (`opencode.ts:71-77`), which is stronger isolation than theirs — but our *implementer/fixer* sessions do run agents with tools, and the same shape risk exists. **Adaptation:** in `prompt()`, detect tool-part-only replies and surface them as a distinct retryable outcome. Effort S.
- **`body.agent` defaults to `"title"` (text-only)** because native-tool agents steal structured responses (`host-provider.js:18-20,39,71-72`). Worth a note in our reviewer agent config: belt-and-suspenders alongside the deny list — pick a tool-less agent for reviewer turns. Verify against 1.18.32 first. Effort S.
- **Session deletion races opencode's async work** (immediate delete → NotFoundError unhandled rejection, `host-provider.js:30-36`); they defer deletion to `dispose()`. We never delete sessions (they are fencing/audit state), so no action — but this validates that choice.
- **Fresh single-use session per agent call** to prevent cross-conversation contamination (`host-provider.js:24-29`). We already do per-step sessions with fencing labels; same pattern, independently derived.
- **Keyless embedded mode** (omit `body.model` to inherit host model, `host-provider.js:74-79`) plus the **recursion guard** — module-level child-session set + synchronous `embeddedActive` flag so the plugin's own child prompts don't re-trigger orchestration ("session storm", `index.js:206-219`). Genuinely hard-won, but it exists because the plugin sits inside the chat loop; our harness is invoked from durable steps and cannot self-trigger. **REJECT for us**; keep in mind if we ever build an interactive dashboard-driven mode (the v6.1 dashboard is read-only render, so not applicable).

**Cost of adopting the plugin itself:** wrong runtime contract (plugin JS on CLI 1.2.27 vs. our SDK 1.18.32 — different API surfaces; their file targets the host-injected `client`, ours constructs `createOpencodeClient`), interactive-trigger shape vs. our flow-driven shape, and a second orchestration brain. REJECT; ADAPT the three findings above.

### 3. The adversarial verify/critic panel (mission question b)

**What it does.** `verify({target, mode, critics, consensusThreshold, minConfidence})` (`guest-prelude.js:141-245`) compacts the target, fans out critic agents, and computes: confident verdicts (`confidence >= minConfidence`, generated scripts use `0.8`, `script-generator.js:161,174`); adversarial mode passes **unless a quorum of confident critics rejects** (`rejections < threshold`, `guest-prelude.js:211-219`); an errored/unconfident critic cannot sink an adversarial pass but weakens a consensus pass. An optional test-gate runs a shell command in parallel and requires exit 0, failing closed on refusal (`:190-206,227-240`). Three critic roles ship as one-liners with ~4-line system prompts (`roles.js:37-66`): *false-positive-hunter* ("Assume a meaningful fraction are wrong"), *severity-validator* ("Downgrade anything not provably impactful"), *completeness-checker* ("You look for what is MISSING").

**How ours does it today.** Our reviewers are first-order: diff-by-value only, zero tools (deny-all, `harness/agents/reviewer.ts:64-67`), a contract verdict with severity enum, evidence spans that must literally appear in the diff, per-finding self-reported citation probability, and explicit "empty findings is a completed clean review" semantics (`reviewer.ts:20-63`). Downstream, a deterministic citation check (`src/typesafe/verdict-check.ts:50-55` naive substring/hunk check; Jev variant `:66+`) discards uncited findings before the fixer spends a cycle, and a deterministic agreement rule (`src/metrics/agreement.ts:27-36,74+`: same hunk + intersecting lines + equal severity class, max-matching, with agree-clean/disagree/unreviewed) produces AC2 metrics.

**Material comparison.**
- *Prompts:* theirs are generic one-liners reviewing a findings array; ours are domain-specific (PHP→TS semantic drift, strict-mode hazards, conventions) with a machine-checkable verdict contract. For our porting loop, **ours are materially better** — theirs would not even be applicable to a diff (their critics review *findings about work*, not the work product itself). No adoption.
- *Mechanism:* their quorum is per-target approve/reject driven by **model-self-reported confidence** — a value that cannot be reconciled against anything, i.e. it would fail our AC2 provenance rule ("every value reconciled against the raw attribute log"). Their critics may also carry `read_file`/`search` tools (`script-generator.js:150-152`), so they can roam the workspace — the opposite of our diff-isolation principle (plan principle 3). REJECT as mechanism.
- *Worth adapting:* the **composition idea** — a dedicated third panelist whose only job is "what is MISSING" (completeness), and explicit severity-challenge as a separate pass. Concretely useful at our prep-review seam (Phase 3 artifact-diff review): a completeness check on the spec map / per-symbol table ("which source symbols have no target entry?") is cheap and mechanical. Note the plan pins exactly 2 reviewers and the agreement rule is defined over exactly two records (`agreement.ts:74+`) — adding a third reviewer is a **plan amendment (v1.1 follow-up)**, not a Phase 2-6 change. Alternatively, run completeness as a *deterministic* check (set-difference over symbols) instead of a model panelist — likely better and free. Their **fail-closed test gate** idea (`guest-prelude.js:190-206`) we already supersede: our tsc/vitest queues are toolkit-owned durable steps against the integrated checkout.
- Their confidence-weighted "errored critic cannot sink a pass" asymmetry is a decent robustness idea, but our completed-verdict-record rule (empty ≠ missing, missing = unreviewed and surfaced) already handles it with better provenance.

### 4–5. Script-as-orchestrator core + QuickJS sandbox (mission question c)

**What it does.** `createPlan` runs a 5-phase pipeline: LLM-or-heuristic decompose → topology selection (simplest-of mapreduce/pipeline/adversarial/consensus/treesearch/hybrid, `topology.js:11-37`) → role assignment → strategy merge → **generateScript**, which compiles the task graph into a JS `async function execute(context)` using only the sandbox primitives (`script-generator.js:1-48`). The script runs inside a WASM QuickJS sandbox (no fs/network/require; memory limit, per-slice interrupt handler, `sandbox.js:1-33`) over JSON-string host bridges; the guest prelude implements `agent/parallel/pipeline/loop/compact/summarize/verify/phase/log/checkpoint/replan` guest-side (`guest-prelude.js:48-302`). Nice touches: per-item fan-out resilience where failures are preserved as `{__odw_failed, error}` sentinels and counted loudly (`script-generator.js:121-142`), an agent-cap slot allocator emitted into the script (`:50-67`), and terminal synthesis degradation to a partial result instead of hard-failing (`:191-207`).

**Could it sit ON TOP of dex as the authoring surface?** Only in a broken way, and this is the architectural core of the answer. ODW's script is *the* orchestrator: its durability comes from **re-running `execute()` from the top after a crash and serving completed `agent()` results from a SQLite cache keyed by `sha1(workflowId|phase|role|prompt|tools)`** (`runtime.js:92-100,157-170`, `db.js:48-66`). If we ran that interpreter inside a dex step, the in-sandbox promise graph dies with any SIGKILL, and recovery semantics would live in ODW's replay-cache — a second source of truth that is not dex attributes, violating plan principle 1 and the envelope-as-render principle (AC2 requires the event stream to be the single ground truth; ODW's cache rows are opaque side state). Their own code concedes the boundary: **tool-using agents are explicitly excluded from the cache** because replaying "I wrote the file" from cache would silently skip side effects (`runtime.js:163-170`). Our toolkit's work is *all* side-effecting (worktree writes, sole-committer commits, integration merges) — precisely the part ODW's model declines to make resumable. Meanwhile dex flows are already authored in TS with the envelope factory; a "script" layer that compiles to dex steps would buy syntax over our existing flows while adding a planner, a topology selector, and a sanitizer to maintain against a pinned pre-release SDK. **REJECT for v1.** If a future toolkit wants richer authoring, the only coherent shape is *compiler* (script → dex flow steps, one step per primitive call, durability entirely dex's), never *interpreter-over-cache*. Record that boundary; don't build it now.

The QuickJS sandbox itself is well-engineered (async bridges via VM deferred promises, WASM abort capture, `sandbox.js:36-120`) but solves a problem we don't have — we execute our own trusted code, not model-generated scripts. REJECT (also: `quickjs-emscripten` + `better-sqlite3` are exactly the dependency weight our "zero new deps" dashboard decision avoided).

### 6. SQLite WAL resume / node identity vs. dex SIGKILL resume

**What it does.** `better-sqlite3` in WAL mode with `synchronous = NORMAL` (`db.js:17-24`); workflow/agent-node/checkpoint/journal tables; `requeueOrphans` resets `running|failed|retrying` nodes with `retry_count < max_retries` (`db.js:62-64`); resume = mark running, re-run the compiled script, rebuild the completed-node cache (`runtime.js:431-453`). Node identity includes tool names (`runtime.js:160`) so the same prompt with different tools is a different node.

**How ours does it today.** Dex attributes as source of truth, envelope steps with heartbeats, epoch fencing with enumeration fallback, op-ID (file+round) idempotent sole-committer commits with content-hash-as-evidence, the 8-row reconcile table, and a live-proven SIGKILL-of-server-and-workers resume with zero new implementer invocations (BUILD_NOTES 0(b)–0(h)).

**Comparison.** Two decisive asymmetries: (1) **evidence** — their resume test is a cooperative `ctl stop` + `resume` over a mock LLM (`integration.test.js:277-350`, "Genuine interruption: … STOP the workflow mid-flight (simulating a crash)"); the README's "kill the daemon mid-run" claim is not backed by a SIGKILL test. Ours is a real SIGKILL of server AND worker with intent-before-kill sidecar ordering. (2) **side effects** — their guarantee is at-most-once *LLM calls* for pure compute; anything with side effects re-runs from scratch (cache exclusion above), and there is no commit-idempotency concept (their `git` tool has a destructive-flag allowlist, `tools.js:20-30,470-477`, but commits are not deduped). Their prompt-identity cache also has a benign-but-real hazard for our use: two agents in the same phase with identical prompt text would share a cache entry. **REJECT entirely** — adopting it would mean replacing a proven-stronger mechanism with a proven-weaker one. Worth keeping the contrast in our docs as the "why dex" explanation.

### 7–12. Assorted patterns worth stealing (ADAPT)

- **Structure-preserving compaction** (`context-compact.js:20-80`): `compactText` truncates at whitespace boundaries with an inline marker chosen so JSON.stringify length stays honest (`:44-58`); `compactValue` drops *whole* trailing array items / object properties until the serialized form fits, returning `{value, manifest: {droppedCount, droppedPaths, …}}` so loss is never silent. Directly applicable to our prep artifacts and any future large diff rendering into prompts. Reimplement in ~60 lines of TS behind our own tests **when we first hit a size problem** — our diff-by-value contract already bounds reviewer input today. Effort S.
- **Hard budget gate** (`budget.js` via `runtime.js:103-121`): seed from persisted totals, warn at 80%, pause + abort at 100%, persisted `budget_alerted` flag. Our envelope has retry/round caps but no token-ceiling terminal state; since agent steps already carry required token counts, an envelope-level budget check is a natural v1.1 addition (a plan-compatible scale knob under principle 4). Effort M.
- **Per-item fan-out resilience** (`script-generator.js:121-142`): catch per item, preserve failure sentinels, log "N/M items failed and were preserved". Our flow's per-file loop tolerates a file failing, but the pattern of *preserving* failure evidence into the results structure (rather than dropping) matches our provenance instincts; adopt as envelope idiom for any future batch steps. Effort S.
- **Synthesis graceful degradation** (`script-generator.js:191-207`): the terminal step catch rethrows only `aborted|paused` and otherwise returns a structured partial result. Maps to our render layer: a missing/failed final render should render "partial" evidence, not crash the run. Effort S.
- **Schema-suffix + tolerant extractJson + correction feedback** (`agent-queue.js:178-191,216-231`): embed the schema in the prompt, parse tolerantly, and on failure feed the model its own bad output + validation errors on retry ("self-correcting retry … matters for weaker/free models", `:83-86`); the `noRetry` flag prevents re-running side-effectful tool loops on final-turn schema failure (`:100-103,409-412`). Our reviewers emit JSON contracts already and Jev replaces parsing at integration points, so mostly covered — but the *correction-feedback* trick is worth remembering for any prompt-level JSON we do parse, and `noRetry` is the same instinct as our envelope attempt caps. Pattern only.
- **Tool gating** (`tools.js:4-7,337-345,470-477`): mutating tools fail closed in headless mode; git scoped to a subcommand allowlist with destructive-flag rejection. We supersede this with no-git-at-all for agents + sole-committer steps; noting it because their *fail-closed-with-clear-message* error text is a good UX pattern for our deny-list probes.

### 14–16. Rejected without adaptation

- **Embedded keyless orchestrator** (`embedded.js`): swaps the provider leaf for a host `invoke()`; elegant, but it exists to avoid a second API key — we have no API-key problem (opencode server is the model boundary) and our provenance rule requires usage extraction that their host path degrades to optional (`{text, usage?}`). Conflicts with vendor-thin seams.
- **Mid-run `replan()`** (`runtime.js:283-353`): sub-plans planned by an LLM at runtime, persisted under `sha1(workflowId|replan|depth|count|prompt)` for replay determinism. Clever solution to "non-determinism vs. resume", but double-modeling plans in a flow that has no replanning requirement is scope with no v1 payoff.
- **Trigger detection / ultracode toggle / MCP bridge / host adapters**: interactive-shell concerns, out of scope for a headless toolkit.

## Plan-principle conflict flags

- **Sole-committer**: ODW's git tool gives *agents* scoped git access including `commit` (`tools.js:20-30`) — the exact anti-pattern our plan forbids. Any borrowing must never touch commit ownership.
- **Envelope-as-render / single source of truth**: ODW's SQLite node cache and journal are side-state next to the orchestrator; importing that layer would break the AC2 typed 1:N envelope↔dispatch anchoring. This is the deepest reason the script-as-orchestrator question (c) resolves to REJECT.
- **Vendor-thin seams**: ODW's providers call vendor HTTP APIs directly (anthropic/openai/ollama files in `packages/daemon/src/providers/`); our reviewers/agents go through opencode only. Adopting their provider stack would violate "reviewers do not use raw vendor APIs" (plan non-goal).
- **All-TypeScript**: ODW is untyped JS; anything lifted must be re-typed and re-tested under `tsc --strict` + `noUncheckedIndexedAccess`, never imported as a package.
- **Minimal v1**: every ADAPT above is deferred-unless-needed or v1.1; nothing here justifies widening Phase 2–6 scope now.

## Effort estimates

| Item | Size | Estimate |
|---|---|---|
| Harness: early-bail on `info.error` + tool-turn-reply classification in `prompt()` | S | ~2–4 h incl. tests, 1 file (`src/harness/opencode.ts`) |
| Reviewer agent default to text-only opencode agent (verify on 1.18.32 first) | S | ~1–2 h |
| Deterministic completeness check on prep artifacts (symbol set-difference) | S | ~2–3 h in Phase 3 lane |
| Third critic panelist (model-based) — needs plan amendment + agreement-rule extension | M | ~1 day; recommend deterministic alternative instead |
| Structure-preserving compaction utility in TS | S | ~2–3 h when needed |
| Envelope token/cost budget gate | M | ~0.5–1 day incl. durable alert flag + tests |
| Anything else (sandbox, SQLite, embedded, script layer) | — | Rejected; no effort budgeted |

## Recommended follow-ups (in decision order)

1. **Approve harness robustness patch (S)**: `info.error` early-bail + tool-turn classification + optional text-only reviewer agent, each verified against our pinned opencode 1.18.32 before merge (ODW's evidence is from 1.2.27). Owner: harness lane; zero plan impact.
2. **Approve deterministic prep completeness check (S)** in the Phase 3 lane (set-difference over symbols, no model call). Captures the one genuinely valuable critic idea without touching the two-reviewer design.
3. **Note-and-defer (no approval needed)**: compaction utility, fan-out resilience idiom, synthesis partial-result semantics, budget gate — record in BUILD_NOTES as pattern library entries with triggers for when to build each.
4. **Do not adopt** the ODW engine, sandbox, SQLite substrate, or script layer. If script-style authoring is ever revisited (v2), mandate the compiler-to-dex-steps boundary and write the ADR then.
5. **Upstream hygiene**: since the fork has zero unique commits, treat upstream (`Suraj1235/open-dynamic-workflows`) as the reference; if we ever file fixes (e.g., the README's "kill the daemon" durability claim vs. the cooperative-stop test), do it upstream, not on the fork.

## Evidence index (ODW clone at /tmp/odw-eval)

- Plugin trigger/guard/embedded: `packages/opencode-plugin/src/index.js:27-60,206-219,229-274,317-396,398-486`
- opencode protocol findings: `packages/opencode-plugin/src/host-provider.js:1-37,39,50-59,71-79,93-107,111-119,124-127`
- Critic quorum: `packages/daemon/src/guest-prelude.js:141-245` (threshold 151, quorum 211-219, test gate 190-206, fail-closed 227-240)
- Critic role prompts: `packages/core/src/roles.js:37-66`; generated critic wiring: `packages/core/src/script-generator.js:144-176`
- Node identity + cache + tool exclusion: `packages/daemon/src/runtime.js:92-100,157-170,431-453`; replan `:283-353`
- SQLite/WAL + requeue: `packages/daemon/src/db.js:17-24,48-66` (requeue 62-64)
- Resume test (cooperative stop, not SIGKILL): `packages/daemon/test/integration.test.js:277-350`
- Script generation / resilience / degradation: `packages/core/src/script-generator.js:50-67,121-142,191-207`
- Topology selection: `packages/core/src/topology.js:11-37`; planner pipeline: `packages/core/src/planner.js:19-58`
- Context guard + schema retries: `packages/daemon/src/agent-queue.js:25-43,83-141,178-231,369-413`
- Compaction: `packages/core/src/context-compact.js:20-80`; window registry: `packages/core/src/context-window.js:15-45`
- Tool gating: `packages/daemon/src/tools.js:4-30,337-345,470-477`
- Embedded orchestrator: `packages/daemon/src/embedded.js:1-60`
- License: `/tmp/odw-eval/LICENSE` (MIT, "open-dynamic-workflows contributors", 2026)
