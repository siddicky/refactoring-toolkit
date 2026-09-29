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
2. It creates an output Git repository and a `PORTING.md` with exact source-to-target mappings and verification gates.
3. It installs dependencies, starts Dex and OpenCode, and runs a limited first slice. It inspects the output before expanding the run.
4. It runs target checks, compares behavior with the source, recovers interrupted work when needed, and reports what passed and what remains unverified.

## Local setup (normally done by the agent)

Requirements: Git, [Bun](https://bun.com/docs/installation), [Dex CLI](https://docs.superdurable.io/quick-start/), and [OpenCode](https://opencode.ai/docs/). This project was developed with Bun 1.3.14, Dex CLI 0.13.5, and OpenCode 1.18.32; consult their current installation instructions if your platform differs. `package.json` requires Node.js 22 or newer for Node-based tooling. On macOS with Homebrew and Node/npm available, the agent can install the tools with:

```sh
brew install oven-sh/bun/bun
brew install superdurable/tap/dexcli
npm install -g opencode-ai@1.18.32
```

From the toolkit root, install its locked dependencies and prepare local configuration:

```sh
bun install --frozen-lockfile
cp .env.example .env
bun run typecheck
bun test
```

In the current checkout, `typecheck` and `test` both encounter a missing recorded fixture, `src/metrics/fixtures/kill-events-run-a.json`. This is a repository test-data issue; the agent should report it separately from migration results.

The agent should fill `.env` for its environment. `DEX_SERVER_ADDRESS` defaults to `127.0.0.1:8801`, `DEX_WORKER_TARGET` to `127.0.0.1:8803`, and `OPENCODE_BASE_URL` to `http://127.0.0.1:4096`. `OPENCODE_MODEL_PROVIDER` and `OPENCODE_MODEL_ID` select the default for generic agent round trips; **migration turns use separate lanes**. Their current defaults are planner `zai-coding-plan/glm-5.3` at `high`, executor `zai-coding-plan/glm-5.3-flash` at `max`, and reviewer `nano-gpt/openai/gpt-6-luna` at `high`. Configure and verify credentials for all three effective models, or set `OPENCODE_PLANNER_MODEL`, `OPENCODE_EXECUTOR_MODEL`, and `OPENCODE_REVIEWER_MODEL` in `.env` using `providerID/modelID` values available in OpenCode. The matching `*_VARIANT` settings override reasoning variants; review retries use the executor lane unless `OPENCODE_REVIEWER_MODEL_FALLBACK` is set. See [`src/harness/lanes.ts`](src/harness/lanes.ts) for current routing. `TYPESAFE_API_KEY` enables billed live TypeSafe judgments; without it, the worker uses an offline decision path. Keep `.env` out of Git.

For a live migration, run these as separate long-lived processes:

```sh
dexcli dev -open=false -sqlite-db-filename /absolute/path/to/dex.sqlite.db
opencode serve --port 4096
bun run scripts/run-demo.ts worker --flows port --harness opencode
```

Use the same Dex database when restarting after an interruption. The worker may fall back to a labeled stub harness if OpenCode is unavailable, so check its startup log and an actual agent round trip before treating a run as live. `docker-compose.yml` is a placeholder, not a working Dex setup.

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

These paths and file names are examples, not defaults to reuse. The agent must create the output Git repository and commit its initial manifest, configuration, and `PORTING.md` before dispatch: if `--dir` points to a nonexistent path, `demo` creates a fixture repository there, and worktrees need a committed baseline. `--files` takes exact PHP paths relative to `--source-root`. Each needs an exact Markdown mapping row in `PORTING.md`, such as:

```md
| PHP file | Proposed port target | Notes |
|---|---|---|
| `src/Billing/Invoice.php` | `src/billing/invoice.ts` | Preserve rounding and errors |
```

The agent should verify the target project's compiler and tests, inspect Git changes, and use Dex state/history for run evidence. `bun run scripts/render-metrics.ts --flow-id migration-unique-id --out-dir /absolute/path/to/report` produces a report from durable evidence. Compilation, passing tests, and behavioral parity are separate claims.

## More detail

- [Migration skill](.agents/skills/porting-toolkit-migration/SKILL.md): interview, `PORTING.md`, execution, and verification instructions for agents.
- [Runner reference](.agents/skills/porting-toolkit-migration/references/runner.md): current PHP → TypeScript input and recovery details.
- [Environment example](.env.example): local service addresses and optional credentials.
- [Build notes](BUILD_NOTES.md): historical implementation and live-infrastructure evidence, not a substitute for verifying a new migration.
