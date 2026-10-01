# Tests

`bun test` runs everything: every `*.test.ts` under `src/`, `harness/` and `tests/`, all on `bun:test`. No test needs the network, a dex server or an opencode server.

## Where a test goes

Ask what the test's subject is.

| Subject | Home |
|---|---|
| One source directory (`src/git`, `src/watcher`, `harness/agents`, ...) | **Colocated**, next to the code: `src/git/worktree-release.test.ts` |
| A flow in `flows/`, a CLI in `scripts/`, a contract between directories, a spawned process, or the repository itself | **`tests/`**, flat, named for the behaviour: `tsc-accounting-contract.test.ts` |
| A helper used by more than one test | **`tests/support/`** (not a test file, unless it is the helper's own `*.test.ts`) |

More than one test file for one module: `<module>-<topic>.test.ts` (`worktree-refnames.test.ts`). Name files for what they pin, never for a milestone, phase or story (`phase2-flow`, `us010-...`). The audit or story id belongs in the `describe` title.

A colocated test may import its neighbours, lower-level `src/` modules and `tests/support/`. It never imports `flows/` or `scripts/`: that is the cue to move it to `tests/`.

## Shared helpers (`tests/support/`)

- `dex-context.ts`: the stand-in for a dex step `Context`. `stubContext` over in-memory attribute stores (pass `loads: declaredLoads(step)` to enforce dex's declared-load rule), `stagingContext` for write-only steps, `runStep`, `seedAttribute` / `peekAttribute`. Do not write another stub.
- `paths.ts`: `REPO_ROOT`. No test derives the repository root from its own location, so a test can move without breaking.
- `opencode-env.ts`: `clearHarnessEnv()` for tests that read `OPENCODE_*` / `TYPESAFE_*` (bun loads the operator's `.env`).
- `source-files.ts`: `walkFiles`, `productionSources`, `readSource`, for guards that scan the repository; use them rather than writing another directory walker.
- `port-flow-source.ts`: the source of the port flow, which is `flows/port-project.ts` plus `flows/port/*.ts`. Guards that grep flow source read the whole set.
- `queue-verify-run.ts`, `virtual-stream.ts`: a real `QueueVerifyStep` over fake `tsc`/`vitest` binaries; a virtual-clock dex stream.

## Fixtures

Test data lives in a directory named `fixtures/` next to its users: `src/metrics/fixtures`, `src/queues/fixtures`, `src/dashboard/fixtures`, `tests/fixtures`. The repository-root `fixtures/` is different: it holds the PHP projects the demo ports (and their generators), which the toolkit runs on. Recorded sidecars used as fixtures must stay tracked (`tests/metrics-fixtures-tracked.test.ts`).

## Guards that read source

Some tests assert on source text or on a hand-kept mirror (`tests/mirror-drift.test.ts`, `tests/test-layout.test.ts`, `tests/repo-hygiene.test.ts`, `tests/cli-scripts-guard.test.ts`, `tests/doc-claims.test.ts` (the docs against `package.json` and the code: `.env.example` against the environment the code reads, every `bun run <script>`, link and repository path in the README, skill and runner reference, the documented `run-demo` flags and exit codes), the source checks in `tests/lane-demotion-and-abort.test.ts` and `tests/jev-wiring.test.ts`). They exist to fail when two copies of a fact drift apart. `mirror-drift.test.ts` pins the copies the metrics layer and the dashboard keep by hand, because they must not import the flows (the dispatch-anchor step table, the fixer step id, the dashboard accounting types), against the real flows. When one fails, fix the drift. Do not loosen the guard.

## Running

```sh
bun test                         # everything
bun test src/git                 # one directory
bun test src/harness/lanes      # one file (path substring)
bun test -t "refnames"           # by test name
```

`bun run check` runs `tsc --noEmit`, `biome lint` (warnings fail it) and then `bun test`, which is what CI runs. `tsc` also gates unused imports, locals and parameters; Biome rules are turned off only in `biome.jsonc`, each with a one-line justification.
