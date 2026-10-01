# Agent guidance

This is an agent-operated migration toolkit. For a request to start or resume a migration, read [the migration skill](.agents/skills/porting-toolkit-migration/SKILL.md) and operate the workflow for the user. The user supplies goals and decisions in conversation; the agent inspects code, writes `PORTING.md`, sets up dependencies and services, runs the migration, and verifies the output.

The implemented runner currently handles PHP → TypeScript. Fixture defaults are demonstration data. Keep the source repository read-only unless the user explicitly requests source changes, and adapt the runner before attempting another language pair.

Two properties of the runner decide whether a migration fits it, so check them before dispatch (details in the [runner reference](.agents/skills/porting-toolkit-migration/references/runner.md)):

- It fixes the verification stack: vitest, `bun install`, the toolkit's own `tsc`, and tests under `test/` or `tests/`. It rewrites the target's `package.json` `test` script.
- Its result lands on the output repository's `integration` branch (worktree `<dir>/.worktrees/integration`), which nothing merges. Merging or opening a pull request from it needs the user's explicit authorization.

When you change the toolkit itself, run `bun run check` (typecheck, lint, tests). `.env.example` lists every environment variable the code reads, and `tests/doc-claims.test.ts` fails when it, the README or the runner reference drifts from `package.json` or the code. See [tests/README.md](tests/README.md) for where tests go.
