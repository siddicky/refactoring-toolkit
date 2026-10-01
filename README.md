# Refactoring Toolkit

An agent-operated migration toolkit. You describe the source project, desired target, and what must keep working; the agent interviews you, writes a `PORTING.md` contract, sets up the local services and target repository, runs bounded porting rounds, and verifies the result. You make product and compatibility decisions in conversation. The agent runs the commands.

The implemented runner currently ports **PHP to TypeScript**. Other language pairs require adapting the runner and its verification steps before dispatch. This repository's fixtures and `demo` command name are historical; a fixture run is not a migration of your project.

## How the layers work

This project is designed for a **coding agent to operate a coding harness**. You interact with the outer agent; it sets up and runs the inner migration system. The agent you choose for that conversation and the harness that ports code have different jobs:

| Layer | Role |
|---|---|
| You | Describe the migration, answer decisions about behavior and scope, and review the result. |
| Operator agent (Codex, Claude Code, or another supported agent) | Loads the migration skill, inspects the source, interviews you, writes `PORTING.md`, sets up dependencies and services, starts runs, handles recovery, and verifies output. |
| Toolkit and Dex | Coordinate durable flows, worktrees, file rounds, integration, and run evidence. TypeSafe can supply judgments when configured. |
| OpenCode coding harness | Runs the implementer and reviewer agent sessions invoked by the toolkit. This is the current inner harness regardless of which operator agent you use. |
| Output Git repository | Receives the TypeScript port, tests, commits, and `PORTING.md`; it is separate from the read-only PHP source. |

The portable skill changes **who can operate the toolkit**. It does not replace OpenCode inside the current runner. You can ask the operator agent to install and configure that harness; you do not need to drive its CLI yourself.

## Start a migration

Open this repository in Codex or Claude Code and ask:

> Migrate `/path/to/source` from PHP to TypeScript. Use the `porting-toolkit-migration` skill. Interview me about scope and compatibility, create `PORTING.md` in a separate output repository, set up what you need, run a small representative slice, then continue through the agreed scope and verify it. Keep the source read-only.

The [migration skill](.agents/skills/porting-toolkit-migration/SKILL.md) gives the agent the project-specific interview and execution procedure. Invoke it explicitly as `$porting-toolkit-migration` in Codex or `/porting-toolkit-migration` in Claude Code; both can also select it from the request. Claude Code reads the linked skill at `.claude/skills/porting-toolkit-migration`. Shared project instructions live in [AGENTS.md](AGENTS.md), which Claude Code also reads through `CLAUDE.md`. You do not need to prewrite `PORTING.md` or operate Dex yourself; provide source access and answer decisions the agent cannot infer from the code. The agent should report the source revision, flow ID, output changes, verification results, and any degraded execution mode.

### Other coding agents

The skill uses the shared `SKILL.md` format and lives in `.agents/skills/porting-toolkit-migration`. To see whether the [Vercel `skills` CLI](https://github.com/vercel-labs/skills) discovers it, run `npx skills add . --list` from this repository. For a supported provider that uses another project skill directory, install this local skill there:

```sh
npx skills add . --skill porting-toolkit-migration --agent <agent-id> --yes
```

Replace `<agent-id>` with an ID from the CLI's [supported agents table](https://github.com/vercel-labs/skills#supported-agents), such as `openhands`. Agents including Codex, Cursor, and OpenCode already read `.agents/skills` directly; Claude Code uses the committed `.claude/skills` link. This installs the **coding-agent instructions**. The toolkit's OpenCode server below remains a separate runtime dependency even when Claude Code or Codex is the agent talking to you.

The expected sequence is:

1. The agent inspects the source and interviews you until scope, behavior, target, and acceptance checks are clear.
2. It creates an output Git repository and a `PORTING.md` with source-to-target mappings, behavior requirements and verification gates. Of that file, the runner treats only the source-map rows as authoritative for output paths. A planner lane rewrites the rest into a generated, reviewed spec, and your original text is also handed verbatim to the implement and fix turns as the user contract. Per-file port reviewers do not see it.
3. It installs dependencies, starts Dex and OpenCode, and runs a limited first slice. It inspects the output before expanding the run.
4. It runs target checks, compares behavior with the source, recovers interrupted work when needed, and reports what passed and what remains unverified.
5. The port lands on the `integration` branch of the output repository (worktree `.worktrees/integration`). Merging it into your branch is a separate step the agent takes only with your explicit go-ahead.

The runner also fixes its verification stack: vitest as the test runner, `bun install` for dependencies, the toolkit's own `tsc` for type checks, and tests under `test/` or `tests/`. It rewrites the target's `package.json` `test` script to `vitest run`. A target that needs Jest, pnpm, colocated tests or another layout is not a fit until the runner is adapted; the agent should say so during the interview. The [runner reference](.agents/skills/porting-toolkit-migration/references/runner.md) has the details.

## Local setup (normally done by the agent)

Requirements: Git, [Bun](https://bun.com/docs/installation), [Dex CLI](https://docs.superdurable.io/quick-start/), and [OpenCode](https://opencode.ai/docs/). This project was developed with Bun 1.3.14, Dex CLI 0.13.5, and OpenCode 1.18.32; consult their current installation instructions if your platform differs. `package.json` requires Node.js 22 or newer for Node-based tooling. On macOS with Homebrew and Node/npm available, the agent can install the tools with:

```sh
brew install oven-sh/bun/bun
brew install superdurable/tap/dexcli
npm install -g opencode-ai@1.18.32
```

From the toolkit root, install its locked dependencies, prepare local configuration and check the toolkit:

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run check
```

`bun run check` runs the type check, Biome lint and the tests, the same three steps CI runs. The scripts in `package.json`:

| Script | What it runs |
|---|---|
| `bun run check` | `typecheck`, then `lint`, then `test` |
| `bun run typecheck`, `bun run lint`, `bun run test` | One step of `check` each (`tsc --noEmit`, `biome lint --error-on-warnings .`, `bun test`) |
| `bun run format:check` | `biome format .`; not part of `check` or CI |
| `bun run worker` | `scripts/run-demo.ts worker`: the Dex worker |
| `bun run demo` | `scripts/run-demo.ts`: any of its commands (`demo`, `wait-flow`, `recover-port`, ...) |
| `bun run dashboard` | `scripts/serve-status.ts`: the read-only status page |
| `bun run metrics` | `scripts/render-metrics.ts`: the evidence report |
| `bun run chaos` | `scripts/chaos-kill.ts`: the kill used to rehearse recovery |

Each script forwards its arguments and prints its options with `--help`.

The agent should fill `.env` for its environment; [`.env.example`](.env.example) lists every variable the code reads, with its default. `DEX_SERVER_ADDRESS` defaults to `127.0.0.1:8801`, `DEX_WORKER_TARGET` to `127.0.0.1:8803` (the worker listens on that address too, unless `DEX_WORKER_BIND` names another), and `OPENCODE_BASE_URL` to `http://127.0.0.1:4096`. `OPENCODE_MODEL_PROVIDER` and `OPENCODE_MODEL_ID` select the default for generic agent round trips; **migration turns use separate lanes**. Their current defaults are planner `zai-coding-plan/glm-5.3` at `high`, executor `zai-coding-plan/glm-5.3-flash` at `max`, and reviewer `nano-gpt/openai/gpt-6-luna` at `high`. Configure and verify credentials for all three effective models, or set `OPENCODE_PLANNER_MODEL`, `OPENCODE_EXECUTOR_MODEL`, and `OPENCODE_REVIEWER_MODEL` in `.env` using `providerID/modelID` values available in OpenCode. The matching `*_VARIANT` settings override reasoning variants (`none` sends no variant); review retries use the executor lane unless `OPENCODE_REVIEWER_MODEL_FALLBACK` is set. See [`src/harness/lanes.ts`](src/harness/lanes.ts) for current routing. `TYPESAFE_API_KEY` enables billed live TypeSafe judgments. Without it, or with `TYPESAFE_OFFLINE` set, the worker uses a scripted offline double: no model judges anything, each symbol-table row takes the first recalled candidate and is tagged `judge=scripted`, which the planner sees as UNVERIFIED, and verdict-check, prioritize and vitest triage stay on their deterministic defaults. Keep `.env` out of Git.

For a live migration, run these as separate long-lived processes:

```sh
dexcli dev -open=false -sqlite-db-filename /absolute/path/to/dex.sqlite.db
opencode serve --port 4096
bun run scripts/run-demo.ts worker --flows port --harness opencode
```

Use the same Dex database when restarting after an interruption. `--harness` accepts `stub`, `opencode` or `auto` (the default), and other values are rejected. The worker probes the OpenCode server (`session.list`, 5 s deadline). `auto` uses it when it answers; otherwise it prints a loud `[run-demo] WARNING ... FALLING BACK to StubHarness`, a labelled test double with fixture token counts and no real model calls, and continues. `--harness opencode` fails immediately if the server is unreachable, and `--harness stub` is the explicit test double. The `[worker] up:` line prints the resolved harness (`harness=OpencodeHarness@<url>` or `StubHarness (test double)`) and `(requested=<flag>)`; check it, and an actual agent round trip (`bun run scripts/run-demo.ts agent-roundtrip`), before treating a run as live. `recover` and `recover-port` always need the real server (`auto` behaves like `opencode` there) unless `--harness stub` is given. `docker-compose.yml` is a placeholder, not a working Dex setup.

The agent then dispatches against **existing** source and output paths:

```sh
bun run scripts/run-demo.ts demo \
  --dir /absolute/path/to/output-git-repo \
  --source-root /absolute/path/to/php-source \
  --prep /absolute/path/to/output-git-repo/PORTING.md \
  --files src/Billing/Invoice.php,tests/Billing/InvoiceTest.php \
  --flow-id migration-unique-id \
  --max-rounds 2 --wait-minutes 30
```

These paths and file names are examples, not defaults to reuse. `--dir` must be the root of an existing Git repository with at least one commit; a nonexistent `--dir` is an error. (`--init-fixture` creates a throwaway README-only fixture repository when the path does not exist, for demos and probes; it never touches an existing directory.) The agent must create the output repository and commit its initial manifest, configuration, and `PORTING.md` before dispatch, because worktrees need a committed baseline, and should exclude the runner's worktrees from it with `echo '.worktrees/' >> .git/info/exclude`. `--files` takes exact PHP paths relative to `--source-root`. Each needs an exact Markdown mapping row in `PORTING.md`, such as:

```md
| PHP file | Proposed port target | Notes |
|---|---|---|
| `src/Billing/Invoice.php` | `src/billing/invoice.ts` | Preserve rounding and errors |
```

Before it creates a repository, contacts Dex or starts a flow, `demo` preflights its inputs: the prep file is readable, every `--files` entry has an exact row in it, the source root is a directory, and every file exists under it. It prints all problems in one error. A flag with a missing, repeated or invalid value is a usage error. Defaults: `--max-rounds 1` (which schedules no fix rounds; the example above allows one), `--wait-minutes 30`, `--epoch 1`, `--dispatch parallel`. `bun run scripts/run-demo.ts demo --help` lists every option.

The commands that wait on a flow (`demo`, `wait-flow`, `hello`, `long-step`, `round`) exit with:

| Code | Meaning |
|---|---|
| 0 | Completed, with no blocked files and no `tsc` or vitest failures |
| 1 | Failed, cancelled or terminated, or a fatal error |
| 3 | Completed, but blocked files or `tsc` or vitest failures remain; the decoded result is printed |
| 4 | `--wait-minutes` elapsed with the flow still running; run `wait-flow --id <id>` and do not dispatch again |
| 64 | Usage error |

An exit of 0 is not proof that every check ran: a vitest or `tsc` step that never executed prints `NOT RUN: <reason>` in the result line. The agent should verify the output separately.

**Where the result lands.** The port is committed to the `integration` branch of the output repository, checked out at `.worktrees/integration` inside it. The main checkout and its default branch are not updated, and nothing merges `integration`. The agent verifies and reports there. Merging or opening a pull request is a final step it takes only when you have explicitly authorized it.

The agent should verify the target project's compiler and tests, inspect Git changes, and use Dex state/history for run evidence. `bun run scripts/render-metrics.ts --flow-id migration-unique-id --out-dir /absolute/path/to/report` produces a report from durable evidence. It reads Dex through `dexcli` (honouring `DEXCLI_BIN` and `DEX_SERVER_ADDRESS`), accepts `--kill-events <jsonl>` or `--events <jsonl>` (default `metrics/kill-events.jsonl`, used only if it exists), `--all-runs` and `--legacy-flow-keyed-envelopes`, and exits 1 on a provenance failure or when the flow has no evidence (`NO EVIDENCE`), 2 when an explicit sidecar path does not exist, and 64 on a usage error. The report has a separate "Judgment (Jev) tokens and cost" section, reports step time and elapsed wall clock separately, and says `typecheck (tsc): NOT RUN (<reason>)` when type checking did not run. Compilation, passing tests, and behavioral parity are separate claims.

To watch a run, `demo --dashboard` (or `STATUS_REPO_ROOT=/absolute/path/to/output-git-repo bun run dashboard`) serves a read-only status page at http://127.0.0.1:4646/. The `STATUS_*` variables are in `.env.example` and explained in the [runner reference](.agents/skills/porting-toolkit-migration/references/runner.md#evidence-and-monitoring); kill-event sidecars default to `metrics/kill-events.jsonl`.

## More detail

- [Migration skill](.agents/skills/porting-toolkit-migration/SKILL.md): interview, `PORTING.md`, execution, and verification instructions for agents.
- [Runner reference](.agents/skills/porting-toolkit-migration/references/runner.md): current PHP → TypeScript input, fixed verification stack, recovery, evidence and exit-code details.
- [Environment example](.env.example): every environment variable the code reads, with its default.
- [Fixtures](fixtures/FIXTURES.md): the generated PHP demo inputs.
- [Tests](tests/README.md): where tests go and how to run them.
- [Build notes](BUILD_NOTES.md): historical implementation and live-infrastructure evidence, not a substitute for verifying a new migration. Where it disagrees with the code, the code wins.
