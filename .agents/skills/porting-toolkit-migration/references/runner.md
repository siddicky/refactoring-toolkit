# Current PHP → TypeScript runner

Read the current source before relying on these examples: `scripts/run-demo.ts` (`bun run scripts/run-demo.ts <command> --help` prints each command's options, defaults and exit codes, generated from the parser), the port flow in `flows/port-project.ts` and `flows/port/`, `package.json`, and [`.env.example`](../../../../.env.example). `BUILD_NOTES.md` is a historical log of how the runner was built and which live runs proved it; where it disagrees with the code, the code wins.

## What the runner fixes

The runner is not generic. These properties come from the code, so they decide whether a migration can use it as is:

- **Source and target**: PHP files in, TypeScript files out. Every dispatched file is a `.php` path with an exact row in the source map.
- **Verification stack** (see [Fixed verification stack](#fixed-verification-stack)): vitest for tests, `bun install` for dependencies, the toolkit's own `tsc` for type checks, tests under `test/` or `tests/`.
- **Output location** (see [Where the result lands](#where-the-result-lands)): a branch named `integration` in the output repository, never merged by the runner.

## Inputs and boundaries

`demo` accepts these options. Everything else, including a misspelled flag, a flag without a value or a repeated flag, is a usage error (exit 64).

| Option | Meaning | Default |
|---|---|---|
| `--dir` | Output (target) Git repository root. Required. It must already exist and have at least one commit. A nonexistent `--dir` is an error. | none |
| `--init-fixture` | Create a throwaway README-only fixture repository when `--dir` does not exist. An existing directory is never touched. For demos and probes only; `round --dir` takes the same flag, because the Phase-0 probe expects exactly such a repository. | off |
| `--source-root` | Directory holding the PHP files. | `fixtures/php-sample` (`fixtures/creatorex-middleware` for `--files creatorex`) |
| `--prep` | Markdown file with the source-map rows, normally the target's `PORTING.md`. | `fixtures/stub-prep.md` (the creatorex `prep-stub.md` for `--files creatorex`) |
| `--files` | Comma-separated PHP paths relative to `--source-root`, or `creatorex` (the 10-file fixture set). | `src/Money.php,src/Pricing/FlatRateDiscount.php` |
| `--flow-id` | Dex flow ID. Use a new one for every dispatch, including a re-dispatch after recovery. | `demo-<epoch ms>` |
| `--epoch` | Session-fence epoch, a whole number >= 1. Recovery bumps it. | 1 |
| `--max-rounds` | Rounds per file, a whole number >= 1. | 1 |
| `--wait-minutes` | How long `demo` waits for the flow, a whole number >= 1. | 30 |
| `--dispatch` | `parallel` (waves of two files as SubFlows) or `sequential` (one file at a time). | `parallel` |
| `--gate-flow-id` | Flow whose Dex history the optional pre-dispatch health gate reads. The gate only reports; it never blocks. | off |
| `--start-only` | Start the flow and return without waiting. | off |
| `--dashboard` | Also start the status dashboard (see [Evidence and monitoring](#evidence-and-monitoring)). | off |

The defaults and `--files creatorex` are fixtures; their paths are located from the script, not from the current directory, and every path is made absolute. `--files creatorex` implies the creatorex prep file and source root unless `--prep` or `--source-root` is given.

`--max-rounds` caps rounds per file. A file whose output still has `tsc` or vitest errors once it has used all its rounds is reported as blocked (exit 3). The default of 1 therefore schedules no fix rounds; the example below passes 2, which allows one fix round per file.

**Preflight.** Before any repository creation, Dex connection or `startFlow`, `demo` checks that the prep file is readable, that every `--files` entry has an exact row in it, that the source root is a directory and that every listed file exists under it. It prints all problems in one error. It then checks that `--dir` is the root of a Git repository with a commit.

### Source map and `PORTING.md`

The prep file needs rows such as:

| PHP file | Proposed port target | Notes |
|---|---|---|
| `src/Billing/Invoice.php` | `src/billing/invoice.ts` | Preserve rounding and errors |
| `tests/Billing/InvoiceTest.php` | `test/billing/invoice.test.ts` | Port assertions |

The parser takes a row whose first cell is a backticked path ending in `.php` and whose second cell is a backticked target. It ignores header and separator rows, non-`.php` rows and glob rows (`tests/*.php`). `PpPrep` rejects a dispatched file that has no row. Verify that every listed source file exists under `--source-root`; a map is a plan, not correctness evidence. Give every file a unique target.

**Only the source-map rows are authoritative for output paths**: they are parsed deterministically from your file. A planner lane rewrites the rest of `PORTING.md` into a generated spec map, which a prep review loop checks; that generated spec, not your text, is what the implementer sees as "the prep artifact". It can drop or reword requirements. Your original `PORTING.md` is also passed by value to implement, fix and queue-fix turns, labelled the authoritative user contract: its behavior requirements and known traps bind those turns. Per-file port reviewers never see `PORTING.md`; prep-loop reviewers see a diff of the generated spec against it. Put anything that must bind in the source-map rows or in plain behavior requirements, read the generated spec after the prep step, and treat review agreement as weaker evidence than your own checks.

## Fixed verification stack

The integration checkout is provisioned and verified by toolkit code, not by an agent. A target that does not fit has to be rejected or the runner adapted before dispatch.

- **Bootstrap** (at the first integration, and skipped once the checkout satisfies it; `flows/port/bootstrap.ts`): writes or patches `package.json`, makes sure `node_modules/` is in `.gitignore`, runs `bun install` in `<dir>/.worktrees/integration` when vitest is not installed there or `package.json` changed (so `bun` must be on the worker's `PATH`; it has a 300 s limit, and a failure fails the step), and commits what it changed on `integration`.
  - `package.json`: written if absent. If present, it is patched: `"type": "module"` is forced and **`scripts.test` is overwritten with `vitest run`**. `vitest` is added to `devDependencies` at `^3.2.4` only when no vitest entry exists. Other fields stay.
  - `tsconfig.json`: written only if absent (strict, `ES2022`, `Bundler` resolution, `noEmit`, `types: []`; `include` covers `src/`, `test/`, `tests/` and the top-level directory of each source-map target). An existing `tsconfig.json` is used as is.
  - `vitest.config.ts`: written only if absent (`include`: `test/**/*.test.ts` and `tests/**/*.test.ts`). An existing one is used as is.
- **Type check**: the toolkit's own `node_modules/.bin/tsc --noEmit` (TypeScript 5.9.3) runs inside the integration checkout against that checkout's `tsconfig.json`. A target's own TypeScript version never runs.
- **Tests**: `node_modules/.bin/vitest run` in the integration checkout. Test files are discovered only under `test/` and `tests/`, and only `*.test.ts` (the scaffolded `vitest.config.ts` includes the same globs; a `*.test.tsx` is neither found nor run). With none found, the result is `NOT RUN: no test files in the integrated checkout`, never a pass.

So the runner cannot serve a target that needs Jest or another runner, pnpm or yarn instead of bun, colocated tests (`src/**/*.test.ts`), another test directory, a `test` script that must stay as it is, or a different compiler version. During the interview, either agree on the constraint (put ported tests under `test/` or `tests/`, accept the script rewrite), or adapt `BOOTSTRAP_*` in `flows/port/bootstrap.ts`, the `tsc` and `vitest` calls in `flows/port/project-steps.ts` and `flows/port/queue-tools.ts`, and their tests, before dispatch. Otherwise tell the user this runner does not fit. Whatever the runner reports, also run the target's own typecheck and tests with its own tooling on the `integration` branch.

## Where the result lands

Each run commits its output to a branch named `integration` of the output repository, checked out as a worktree at `<dir>/.worktrees/integration`. Per-file work happens in lease worktrees `<dir>/.worktrees/<segment>-<epoch>` on branches `lease/<segment>/<epoch>`. `<segment>` is the source path with every character outside `A-Za-z0-9._-` (so each `/`) written as `__`, followed by `-<8 hex digits>` whenever that rewriting changed the path: `src/Billing/Invoice.php` is `src__Billing__Invoice.php-49b0329b`, while a path that needed no rewriting (`Invoice.php`) is used as it is. To find a file's lease, list instead of building the name: `git -C <dir> worktree list` and `git -C <dir> branch --list 'lease/*'`. The checkout at `<dir>` and its default branch are not updated, and nothing merges `integration` into it.

1. **Before dispatch**, exclude the worktrees from the output repository without touching its history: `(cd <dir> && echo '.worktrees/' >> "$(git rev-parse --git-path info/exclude)")`. Run it exactly like that: `git -C <dir> rev-parse --git-path info/exclude` prints a path relative to `<dir>`, so the `>>` of a bare `git -C` form lands in the caller's current directory instead. Otherwise `.worktrees/` shows up as untracked in `<dir>` and a `git add -A` there stages other worktrees.
2. **Verify and inspect** in `<dir>/.worktrees/integration`, or on the `integration` branch, never in the main checkout of `<dir>`.
3. **Merging is a separate, explicit step.** Report the branch, its tip, the diff and the verification results, then merge or open a pull request from `integration` into the target branch only with the user's explicit authorization. Leave the worktrees and branches until they decide. The bootstrap commit (`package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`) is on `integration` and goes with the merge.

## Preflight

1. Record source revision and working-tree state. Keep it read-only. Record the target's Git revision and working-tree state; use a distinct output path unless the user chose otherwise.
2. Write `PORTING.md` in the target; check every dispatched file and source-map row, uniqueness of targets, and the proposed verification commands. Commit the target's initial manifest, configuration and `PORTING.md` before the runner creates worktrees. Do not substitute `fixtures/stub-prep.md`.
3. Check the target against [Fixed verification stack](#fixed-verification-stack). Put the target's own runtime dependencies in its committed `package.json`, since `bun install` runs in the integration checkout.
4. Exclude `.worktrees/` (see [Where the result lands](#where-the-result-lands)).
5. Install toolkit dependencies from its lockfile (`bun install --frozen-lockfile`); the runner's `tsc` comes from there.
6. Check Dex and OpenCode reachability and the worker's reported harness (below). Verify every effective lane's model and credentials, including the retry fallback, or set the `OPENCODE_*_MODEL` and `OPENCODE_*_VARIANT` overrides in `.env`. `OPENCODE_MODEL_PROVIDER` and `OPENCODE_MODEL_ID` only set the generic default; port turns use the planner, executor and reviewer lanes from `src/harness/lanes.ts`. Check `TYPESAFE_API_KEY` and `TYPESAFE_OFFLINE` without printing secrets. Without a key the worker uses scripted fixture answers: per-symbol type selection is effectively the first recalled candidate, tagged `judge=scripted` and shown to the planner as UNVERIFIED; nothing is flagged for candidates that exist. Agree on provider spending before using a billed key.

## Operate and recover

Use terminal sessions for Dex, OpenCode and the worker; [`.env.example`](../../../../.env.example) lists every variable they read. Keep all processes on the same Dex address. Use an explicit persistent `-sqlite-db-filename <path>` when recovery across server restarts may be needed; a default new database loses that continuity.

```sh
dexcli dev -open=false -sqlite-db-filename /absolute/path/to/dex.sqlite.db
opencode serve --port 4096
bun run scripts/run-demo.ts worker --flows port --harness opencode
```

**Harness.** `--harness` accepts `stub`, `opencode` or `auto` (default `auto`); other values are rejected. `pickHarness` probes OpenCode with `session.list` and a 5 s deadline. `auto` uses it when it answers and otherwise prints a loud `[run-demo] WARNING ... FALLING BACK to StubHarness` and carries on with the stub, a labelled test double with fixture token counts and no model calls. `opencode` fails immediately when the server is unreachable. `stub` is explicit. The `[worker] up:` line prints the resolved harness (`harness=OpencodeHarness@<url>` or `StubHarness (test double)`) and `(requested=<flag>)`: read it before trusting a run, and use `--harness opencode` for live migrations. `bun run scripts/run-demo.ts agent-roundtrip` makes one real session and prints its token usage.

Example bounded dispatch, after preparing the target:

```sh
bun run scripts/run-demo.ts demo \
  --dir /absolute/output-repo \
  --source-root /absolute/source-repo \
  --prep /absolute/output-repo/PORTING.md \
  --files src/Billing/Invoice.php,tests/Billing/InvoiceTest.php \
  --flow-id migration-unique-id \
  --max-rounds 2 --wait-minutes 30
```

Choose limits from the interview, not this example. A `--wait-minutes` that elapses with the flow still running exits 4: that is healthy, so wait with `bun run scripts/run-demo.ts wait-flow --id <flowId>` instead of dispatching again.

**Exit codes** of `demo`, `wait-flow`, `hello`, `long-step` and `round`:

| Code | Meaning |
|---|---|
| 0 | Completed with no blocked files and no `tsc` or vitest failures. |
| 1 | Failed, cancelled or terminated, or a fatal error. |
| 3 | Completed, but blocked files or `tsc` or vitest failures remain; the decoded result is printed. |
| 4 | `--wait-minutes` elapsed and the flow is still running. |
| 64 | Usage error (unknown flag, bad value, missing required flag). |

Exit 0 is not proof that checks ran: a vitest pass that never executed prints `(NOT RUN: <reason>)` and a `tsc` run that could not complete prints its own `NOT RUN`, and neither changes the exit code. Read the printed result line and verify the output separately.

**Recovery.** On failure, inspect Dex state and history, service logs, the output Git state and reports. `recover-port --dir <repo> --epoch <higher-number> --files <same-files>` aborts stale OpenCode sessions, reconciles each file's lease worktree and **prints** the next dispatch command without running it. Each file is matched to its own lease worktree at the highest epoch below `--epoch`, so any higher number works. `--files creatorex` is expanded as in `demo`. `--source-root`, `--prep`, `--flow-id` and `--max-rounds` are accepted only to appear in the printed command. Inspect uncertain commits first, then invoke `demo` separately with a **new** `--flow-id`, the higher `--epoch` and the original `--source-root`, `--prep`, `--max-rounds` and file list, against the same Dex database.

Recovery aborts only OpenCode sessions whose title starts with `porting-kit:` and whose trailing `#<epoch>` is not the new epoch, plus toolkit-titled sessions with no epoch (for example `porting-kit:agent-roundtrip`). Sessions without that prefix are the operator's own and are never aborted: a dedicated OpenCode server is no longer required, but a stuck non-toolkit session must be aborted by hand. `recover` and `recover-port` need the real server; under `auto` they fail when it is unreachable instead of falling back to the stub, unless `--harness stub` (or `HARNESS=stub` for `recover`) is given explicitly.

## Evidence and monitoring

`bun run scripts/render-metrics.ts --flow-id <id> --out-dir <dir>` writes `report.md` and `report.json` (default `--out-dir metrics`, which is gitignored). It reads Dex through `dexcli`, honouring `DEXCLI_BIN` and `DEX_SERVER_ADDRESS` (passed as `-server`).

- `--kill-events <jsonl>` (alias `--events`) merges a chaos-kill sidecar. Without either, `metrics/kill-events.jsonl` is used only if it exists; an explicit path that does not exist exits 2.
- `--all-runs` stops filtering the sidecar to this flow's runs. `--legacy-flow-keyed-envelopes` is for old cx-5e evidence only.
- It exits 1 when the provenance check fails and prints `NO EVIDENCE` when the flow has no envelope events (wrong flow ID, nothing run yet); 64 for usage errors.
- `report.json` fields include `no_evidence`, `jev_usage`, `kill_event_diagnostics`, `costed_calls` and `uncosted_calls`, `summary.step_time_ms_total` (the sum of step durations, which can exceed elapsed time) and `summary.wall_clock_span_ms` (elapsed; these replace `wall_clock_ms_total`), and `summary.verification.tsc`. `report.md` has a separate "Judgment (Jev) tokens and cost" section and states `typecheck (tsc): NOT RUN (<reason>)` when type checking did not run. Reports written before these changes (for example the ones under `presentation/assets/`) do not have them.

Record the flow ID, source revision, output commits, compiler and test output, review status and execution mode. Treat translation, compilation, tests and parity as different claims.

**Status dashboard.** `demo --dashboard` (never started implicitly) runs `scripts/serve-status.ts` on `STATUS_PORT` (default 4646; the generic `PORT` is not used) with `STATUS_REPO_ROOT` set to `--dir`. If that port is already in use it says so and does not start another; the server already there keeps serving its own `STATUS_REPO_ROOT`. The child is detached and outlives the demo; its output goes to `$TMPDIR/run-demo-dashboard-<port>.log` and `demo` prints its pid so you can `kill <pid>` when done. To run it by hand, use `STATUS_REPO_ROOT=<dir> bun run dashboard` and open http://127.0.0.1:4646/. It is read-only: only GET and HEAD are served, the `Host` header must be allowed, and there is no authentication, so keep `STATUS_HOST` on loopback. `.env.example` lists `STATUS_HOST`, `STATUS_ALLOWED_HOSTS`, `STATUS_MAX_FLOWS`, `STATUS_MAX_CHILD_FLOWS`, `STATUS_STREAM_SUBSCRIBE`, `STATUS_BLOB_CACHE_DIR`, `KILL_EVENT_FILES` and `BURN_DOWN_FILES` with their defaults; an invalid numeric value falls back to its default with a startup warning.

## Other scripts and their exit codes

| Script | Purpose | Exit codes |
|---|---|---|
| `scripts/render-metrics.ts` (`bun run metrics`) | Evidence report | 0 ok, 1 provenance failed or fatal, 2 kill-events file not found, 64 usage |
| `scripts/jev-spot-check.ts` | Grades live Jev type selection; billed, needs `TYPESAFE_API_KEY` | 0 passed, 1 failed or fatal, 2 blocked (offline, no key, fewer than 30 graded), 64 usage |
| `scripts/chaos-kill.ts` (`bun run chaos`) | SIGKILLs target PIDs and records it in `metrics/kill-events.jsonl` | 0 killed, 3 no-op (no target alive), 4 a target survived, 64 usage, 70 fatal |
| `scripts/watch-queue-verify.ts` | Fires the chaos kill once when `pp-queue-verify` starts | 0 fired, 1 flow terminal first, 2 bound elapsed, 3 trigger seen but nothing killed, 4 a target survived, 64 usage, 70 fatal |
| `scripts/serve-status.ts` (`bun run dashboard`) | Status dashboard; no arguments | runs until stopped (0 on a clean stop); 1 on a server error such as a taken port; 64 on any argument |

The kill scripts rehearse recovery; they are not part of a migration. Every script prints its options with `--help`.
