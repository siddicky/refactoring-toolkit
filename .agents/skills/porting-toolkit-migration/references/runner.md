# Current PHP → TypeScript runner

Read the current source before relying on these examples: `scripts/run-demo.ts`, `flows/port-project.ts` (`parsePrepSourceMap` and `PpPrep`), `package.json`, and relevant `BUILD_NOTES.md` sections.

## Inputs and boundaries

`demo` accepts `--dir`, `--source-root`, `--prep`, `--files`, `--flow-id`, `--epoch`, `--max-rounds`, `--wait-minutes`, and `--dispatch`. Defaults and `creatorex` are fixtures. A nonexistent `--dir` triggers `makeFixtureRepo`, so prepare a real target Git repository first.

The prep source map needs exact rows such as:

| PHP file | Proposed port target | Notes |
|---|---|---|
| `src/Billing/Invoice.php` | `src/billing/invoice.ts` | Preserve rounding and errors |
| `tests/Billing/InvoiceTest.php` | `test/billing/invoice.test.ts` | Port assertions |

The parser ignores globs and non-`.php` rows. `PpPrep` rejects dispatched files without map rows. Verify that listed source files exist under `--source-root`; a map is a plan, not correctness evidence.

## Preflight

1. Record source revision and working-tree state. Keep it read-only. Record target Git revision and working-tree state; use a distinct output path unless the user chose otherwise.
2. Write `PORTING.md` in the target; check every dispatched file and source-map row, uniqueness of targets, and the proposed verification commands. Commit the target's initial manifest, configuration, and `PORTING.md` before the runner creates worktrees. Do not substitute `fixtures/stub-prep.md`.
3. Install toolkit dependencies from its lockfile as needed. Prepare the target project's TypeScript manifest, compiler, tests, and dependencies based on the agreed target behavior.
4. Check Dex and OpenCode reachability and the worker's reported harness. `pickHarness` can fall back to `StubHarness` after an OpenCode failure. `OPENCODE_MODEL_PROVIDER`/`OPENCODE_MODEL_ID` only set the generic harness default; port turns use planner, executor, and reviewer routes from `src/harness/lanes.ts`. Verify every effective lane's model and credentials, including retry fallback, or set the per-lane `OPENCODE_*_MODEL` and `OPENCODE_*_VARIANT` overrides in `.env`. Check `TYPESAFE_API_KEY`/`TYPESAFE_OFFLINE` without printing secrets; missing key uses an offline decision path. Agree on provider spending before using a billed key.

## Operate and recover

Use terminal sessions for Dex, OpenCode, and the worker. `BUILD_NOTES.md` documents `dexcli dev -open=false`, `opencode serve --port 4096`, and `bun run scripts/run-demo.ts worker --flows port --harness opencode`. Keep all processes on the same Dex address. Use an explicit persistent `-sqlite-db-filename <path>` when recovery across server restarts may be needed; a default new database loses that continuity.

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

Choose limits from the interview, not this example. The integration worktree is under `<dir>/.worktrees/integration`. On failure, inspect Dex state/history, service logs, output Git state, and reports. `recover-port --dir <repo> --epoch <higher-number> --files <same-files>` aborts old sessions and reconciles leases; it **prints** the next dispatch command but does not run it. Inspect uncertain commits first, then invoke `demo` separately with the higher epoch and the original `--source-root`, `--prep`, and file list against the same Dex database.

## Evidence

`scripts/render-metrics.ts --flow-id <id> --out-dir <dir>` writes `report.md` and `report.json`. Record the flow ID, source revision, output commits, compiler/test output, review status, and execution mode. The status dashboard is read-only monitoring, and `BUILD_NOTES.md` contains historical fixture evidence. Treat translation, compilation, tests, and parity as different claims.
