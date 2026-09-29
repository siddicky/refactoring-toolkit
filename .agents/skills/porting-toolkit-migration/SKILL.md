---
name: porting-toolkit-migration
description: Interview a user about a new code migration, create its PORTING.md guide, then set up and run the migration through this refactoring toolkit. Use when starting or resuming a migration with this repository.
---

# Run a migration through this toolkit

The user supplies goals and decisions in conversation. You inspect the source, write the guide, resolve dependencies, operate the toolkit, and report the result. Do not hand setup commands to the user. Ask for information or access only when you cannot obtain it yourself.

This toolkit currently implements a **PHP → TypeScript** porting loop. `scripts/run-demo.ts demo` takes a separate source tree, an exact list of relative `.php` files, a prep Markdown file, and an output Git repository. Its defaults are fixtures. For another language pair or verification stack, adapt the actual runner before dispatch; never treat a fixture run as the user's migration. Read [the runner reference](references/runner.md) when preparing or running a PHP → TypeScript migration, and recheck the source because the CLI may change.

## Interview until the migration is clear

Inspect the source repository first: revision, manifests, modules, imports, entry points, tests, and externally visible behavior. Separate observed facts from inferences. Restate the migration and identify independently migratable, verifiable slices; confirm their topology before drilling into one. Ask **one consequential question at a time**, aimed at the weakest unresolved part. Do not ask the user for facts visible in the repository. Challenge vague goals such as “same behavior” with concrete examples and tests.

Maintain a compact decision record of facts, choices, non-goals, evidence, and open questions. For each active slice, estimate clarity from 0 to 1 for goal, constraints, acceptance criteria, and source context. Use the [pinned deep-interview method](https://github.com/Yeachan-Heo/oh-my-claudecode/blob/9fd35ece5d6de65b511bf43b55e42c499e4fc194/skills/deep-interview/SKILL.md#L2), adapted here: `ambiguity = 1 - (0.35×goal + 0.25×constraints + 0.25×criteria + 0.15×context)`. Use the **highest** slice ambiguity so an unclear slice is not hidden by clear ones. These scores are prompts for judgment, not measured probabilities. Continue interviewing until every active slice is at or below 0.20 and these decisions are resolved or explicitly bounded:

- Source location and revision; exact scope; source write policy.
- Output location; target runtime and language; dependency and external service boundaries.
- Behavior contract, permitted deviations, compatibility and failure behavior.
- Verification commands and acceptance evidence for each slice.
- Initial run size, resource or spend limit, and whether deployment is in scope.

Infer routine reversible details when evidence supports them. If the user chooses to stop the interview early, show the unresolved assumptions and respect that decision. Do not add a generic approval handoff after the clarity threshold; continue the migration already authorized by the request. Ask at a concrete fork only when behavior, cost, access, or an irreversible action depends on the user's choice.

## Produce `PORTING.md`

Write the guide in the output project before dispatch. Treat it as the migration's run contract, with source revision and evidence links, scope and exclusions, behavior and compatibility requirements, ordered slices, environment and dependencies, exact source-to-target map, API/type/ownership decisions, known traps, verification commands, acceptance gates, and recovery notes. Distinguish observed behavior, decisions, and unverified assumptions. Mark gates pending until checked on the output. A generated draft, successful typecheck, and behavioral parity are separate milestones. The [Bun porting guide discussion](https://news.ycombinator.com/item?id=48016880) motivates a precise map and explicit limits of unverified work; adapt its ideas to this project's source and target rather than copying its language-specific rules.

For the current runner, `PORTING.md` can also be the `--prep` input if it contains one exact Markdown source-map row per dispatched file, as shown in the [runner reference](references/runner.md). Source paths are relative to `--source-root`; target paths belong to the output repository. Confirm that every `--files` entry exists, has one map row, and maps to a unique target. Globs and non-PHP rows do not satisfy the current parser. Keep any generated runtime prep artifact distinct from the user's reviewed contract.

## Set up, run, and verify

Create or select the output Git repository **before** calling `demo`: if the `--dir` path does not exist, the current command creates a fixture repository there. Keep source and output paths distinct. Resolve dependencies using checked-in manifests and the target design; install and configure required local services. Check Dex, OpenCode, worker, and TypeSafe availability and record the actual execution lane. The worker can fall back to a stub harness, and TypeSafe can run offline; neither is evidence of a live agent/provider run unless that mode was intended.

Run a bounded representative slice, inspect generated code and tests, then expand through the agreed scope. Monitor Dex history, logs, and Git commits. For an interrupted run, recover against the same persistent Dex database with the runner's ordered recovery procedure; do not blindly redispatch during an uncertain commit window. Stop and surface a concrete fork on repeated provider failure, missing provenance, unexpected source writes, or the agreed resource limit.

Verify acceptance on the actual output project. Report the source revision, flow ID, output commits or diff, command results, behavior comparisons, failures, unreviewed areas, and any stub/offline/degraded mode. Continue authorized work to completion; request user input only for a decision that cannot be inferred. External publication follows the scope the user authorized.
