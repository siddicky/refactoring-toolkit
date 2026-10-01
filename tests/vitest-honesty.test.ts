/**
 * US-010 (Stage 3a): honest vitest accounting.
 *
 * - Integration bootstrap: the integrated checkout gets a REAL runner
 *   (package.json type:module + vitest script/devDep, strict tsconfig,
 *   vitest.config.ts, node_modules gitignore, bun install outside agent
 *   turns). Idempotent: a satisfied checkout is a pure skip and the commit
 *   dedups on the `bootstrap:integration` op-ID, so kill-replay never
 *   duplicates the bootstrap commit.
 * - Queue-verify ran/not-run semantics: the runner either RAN (counts from
 *   the vitest summary + parsed failure records) or NOT-RUN with an explicit
 *   reason — a crashed or missing runner is never a bare error_count 0.
 * - Ported TEST files route: failures limited to a ported test file are
 *   port-caused and reach THAT file's fix feed (attributedFile), while a src
 *   frame anywhere still outranks the test frame.
 * - The report distinguishes typecheck-verified from test-verified evidence.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bootstrapPlan,
  classifyVitestRecords,
  errorCountsByOutput,
  findVitestTestFiles,
  parsePrepSourceMap,
  portedRootsFromSourceMap,
  queueFixFeedForFile,
  runIntegrationBootstrap,
  selectFixableFiles,
  vitestOutcomeFromRun,
  vitestRoutedTo,
  BOOTSTRAP_OP_ID,
  type BootstrapInspection,
} from "../flows/port-project.js";
import {
  createNaiveClassifier,
  parseVitestOutput,
  parseVitestSummary,
  type VitestFailureRecord,
} from "../src/queues/vitest-queue.js";
import { findCommitByOpId } from "../src/git/worktree.js";
import { git } from "../src/git/exec.js";
import { renderReport } from "../src/metrics/render.js";
import type { QueueBurnDownEvent } from "../src/metrics/types.js";
import {
  composeImplementerTurn,
  composeReviewerTurn,
  testPortScopeNote,
} from "../src/harness/runtime.js";
import { REPO_ROOT } from "./support/paths.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RAN_WITH_FAILURES = `
 RUN  v3.2.4 /itg

 FAIL  test/support/legacy-helpers.test.ts > toInt > coerces "12px" to 12
AssertionError: expected NaN to be 12
 ❯ test/support/legacy-helpers.test.ts:12:26
 ❯ src/support/legacy-helpers.ts:8:15

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 22 passed (23)
    Duration  1.2s
`;

const RAN_ALL_PASS = `
 RUN  v3.2.4 /itg

 Test Files  3 passed (3)
      Tests  23 passed (23)
    Duration  0.9s
`;

function failureRecord(frames: string[]): VitestFailureRecord {
  return {
    testFile: frames[0]?.split(":")[0] ?? "test/unknown.test.ts",
    testName: "Suite > case",
    errorMessage: "AssertionError: expected NaN to be 12",
    frames: frames.map((f, i) => {
      const m = /(.+):(\d+):(\d+)/.exec(f)!;
      return { file: m[1]!, line: Number(m[2]), column: Number(m[3] ?? i) };
    }),
    raw: "FAIL",
  };
}

/** Temp git repo + integration worktree (mirrors run-demo's fixture geometry). */
async function makeIntegrationFixture(): Promise<{
  repoRoot: string;
  integrationWorktreePath: string;
}> {
  const repoRoot = join(tmpdir(), `us010-bootstrap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(repoRoot, { recursive: true });
  const runner = git(repoRoot);
  await runner.run(["init", "-b", "main"]);
  await writeFile(join(repoRoot, "README.md"), "fixture\n");
  await runner.run(["add", "-A"]);
  await runner.run(["commit", "-m", "init"]);
  const integrationWorktreePath = join(repoRoot, ".worktrees", "integration");
  await runner.run(["worktree", "add", "-b", "integration", integrationWorktreePath]);
  return { repoRoot, integrationWorktreePath };
}

// ---------------------------------------------------------------------------
// 1. Bootstrap plan (pure) + real-checkout idempotency
// ---------------------------------------------------------------------------

describe("US-010 bootstrap plan", () => {
  test("all-missing checkout plans writes + install", () => {
    const plan = bootstrapPlan({
      packageJsonRaw: null,
      tsconfigJson: false,
      vitestConfig: false,
      gitignoreRaw: null,
      vitestBin: false,
    });
    expect(plan.needed).toBe(true);
    expect(plan.packageJson).toBe("write");
    expect(plan.tsconfig).toBe(true);
    expect(plan.vitestConfig).toBe(true);
    expect(plan.gitignore).toBe(true);
    expect(plan.install).toBe(true);
  });

  test("satisfied checkout is a pure skip (idempotency)", () => {
    const satisfied: BootstrapInspection = {
      packageJsonRaw: JSON.stringify({
        name: "ported-project",
        type: "module",
        scripts: { test: "vitest run" },
        devDependencies: { vitest: "^3.2.4" },
      }),
      tsconfigJson: true,
      vitestConfig: true,
      gitignoreRaw: "node_modules/\n",
      vitestBin: true,
    };
    const plan = bootstrapPlan(satisfied);
    expect(plan.needed).toBe(false);
    expect(plan.install).toBe(false);
  });

  test("package.json without the vitest contract is PATCHED, not rewritten", () => {
    const plan = bootstrapPlan({
      packageJsonRaw: JSON.stringify({ name: "x", scripts: { build: "tsc" } }),
      tsconfigJson: true,
      vitestConfig: true,
      gitignoreRaw: "node_modules/\n",
      vitestBin: true,
    });
    expect(plan.needed).toBe(true);
    expect(plan.packageJson).toBe("patch");
    expect(plan.tsconfig).toBe(false);
    expect(plan.install).toBe(true); // package.json changed -> sync lockfile
  });
});

describe("US-010 runIntegrationBootstrap (real temp git checkout)", () => {
  test("first run provisions + commits; rerun skips; replay never duplicates the commit", async () => {
    const { repoRoot, integrationWorktreePath } = await makeIntegrationFixture();
    try {
      // node_modules exists but is NOT bootstrapped content: the .gitignore
      // the bootstrap writes must keep it out of the sole-committer commit.
      await mkdir(join(integrationWorktreePath, "node_modules", ".bin"), { recursive: true });
      await writeFile(join(integrationWorktreePath, "node_modules", "junk.txt"), "dep\n");
      let installs = 0;
      const deps = { install: async () => void installs++ };

      const first = await runIntegrationBootstrap(
        { repoRoot, integrationWorktreePath },
        deps,
      );
      expect(first.changed).toBe(true);
      expect(first.committed).toBe(true);
      expect(first.sha).not.toBeNull();
      expect(installs).toBe(1);
      for (const f of ["package.json", "tsconfig.json", "vitest.config.ts", ".gitignore"]) {
        await stat(join(integrationWorktreePath, f)); // throws when absent
      }
      const pkg = JSON.parse(await readFile(join(integrationWorktreePath, "package.json"), "utf8"));
      expect(pkg.type).toBe("module");
      expect(pkg.scripts.test).toBe("vitest run");
      expect(pkg.devDependencies.vitest).toBeString();

      // node_modules never enters the bootstrap commit.
      const show = (await git(repoRoot).run(["show", "--name-only", "--format=", first.sha ?? ""])).trim();
      expect(show.split("\n").some((l) => l.startsWith("node_modules/"))).toBe(false);

      const keyed = await findCommitByOpId(repoRoot, BOOTSTRAP_OP_ID);
      expect(keyed?.sha).toBe(first.sha!);

      // Simulate what the real install produced (the injected install was a
      // no-op): the runner bin now exists, so the checkout is SATISFIED.
      await writeFile(join(integrationWorktreePath, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");

      // Second run: everything present -> pure skip, no new commit.
      const second = await runIntegrationBootstrap({ repoRoot, integrationWorktreePath }, deps);
      expect(second.changed).toBe(false);
      expect(second.alreadyBootstrapped).toBe(true);
      expect(second.committed).toBe(false);
      expect(installs).toBe(1);

      // Kill-replay dedup: damage a file AFTER the commit; the re-run rewrites
      // it but the keyed commit already exists — NO duplicate bootstrap commit.
      await rm(join(integrationWorktreePath, "package.json"));
      const replay = await runIntegrationBootstrap({ repoRoot, integrationWorktreePath }, deps);
      expect(replay.wrote).toContain("package.json");
      expect(replay.committed).toBe(false);
      expect((await countOpIdCommits(repoRoot))).toBe(1);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

describe("B1: bootstrap replay commits a scaffold that a kill or a failed commit left uncommitted", () => {
  const SCAFFOLD = ["package.json", "tsconfig.json", "vitest.config.ts", ".gitignore"];
  /** The runner bin the real `bun install` creates; the injected installs below are no-ops. */
  async function fakeInstalledBin(integrationWorktreePath: string): Promise<void> {
    await mkdir(join(integrationWorktreePath, "node_modules", ".bin"), { recursive: true });
    await writeFile(join(integrationWorktreePath, "node_modules", ".bin", "vitest"), "#!/bin/sh\n");
  }
  const integrationTree = async (repoRoot: string): Promise<string[]> =>
    (await git(repoRoot).run(["ls-tree", "-r", "--name-only", "integration"])).split("\n").filter((l) => l !== "");

  test("killed between install and commit: the replay commits the scaffold under the keyed op-ID", async () => {
    const { repoRoot, integrationWorktreePath } = await makeIntegrationFixture();
    try {
      // Attempt 1 wrote the files, the install finished, and the worker died before the commit.
      await expect(
        runIntegrationBootstrap({ repoRoot, integrationWorktreePath }, {
          install: async (cwd) => {
            await fakeInstalledBin(cwd);
            throw new Error("worker killed");
          },
        }),
      ).rejects.toThrow("worker killed");
      expect(await findCommitByOpId(repoRoot, BOOTSTRAP_OP_ID)).toBeUndefined();
      expect(await integrationTree(repoRoot)).toEqual(["README.md"]);

      // Attempt 2: every file is present and the runner bin exists, so nothing is left to WRITE...
      const replay = await runIntegrationBootstrap({ repoRoot, integrationWorktreePath }, { install: async () => {} });
      expect(replay.wrote).toEqual([]);
      expect(replay.installRan).toBe(false);
      // ...but the scaffold must still reach the integration branch.
      expect(replay.committed).toBe(true);
      expect(replay.sha).not.toBeNull();
      expect((await findCommitByOpId(repoRoot, BOOTSTRAP_OP_ID))?.sha).toBe(replay.sha!);
      expect(await integrationTree(repoRoot)).toEqual([".gitignore", "README.md", "package.json", "tsconfig.json", "vitest.config.ts"]);
      expect(await countOpIdCommits(repoRoot)).toBe(1);

      // Re-entry after every wave join: a clean, committed checkout is a no-op that makes no second commit.
      const again = await runIntegrationBootstrap({ repoRoot, integrationWorktreePath }, { install: async () => {} });
      expect(again.committed).toBe(false);
      expect(again.changed).toBe(false);
      expect(await countOpIdCommits(repoRoot)).toBe(1);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("a commit that fails once (index.lock) is retried by the next attempt instead of reading as bootstrapped", async () => {
    const { repoRoot, integrationWorktreePath } = await makeIntegrationFixture();
    try {
      const gitDir = (await git(integrationWorktreePath).run(["rev-parse", "--absolute-git-dir"])).trim();
      const lock = join(gitDir, "index.lock");
      const install = async (cwd: string): Promise<void> => {
        await fakeInstalledBin(cwd);
        await writeFile(lock, ""); // another git process holds the index when the commit runs
      };
      await expect(runIntegrationBootstrap({ repoRoot, integrationWorktreePath }, { install })).rejects.toThrow();
      await rm(lock, { force: true });
      expect(await findCommitByOpId(repoRoot, BOOTSTRAP_OP_ID)).toBeUndefined();

      const retry = await runIntegrationBootstrap({ repoRoot, integrationWorktreePath }, { install: async () => {} });
      expect(retry.committed).toBe(true);
      expect(await integrationTree(repoRoot)).toEqual(expect.arrayContaining(SCAFFOLD));
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("a checkout that already carries the scaffold in git stays a no-op (no commit, no keyed op-ID)", async () => {
    const { repoRoot, integrationWorktreePath } = await makeIntegrationFixture();
    try {
      for (const f of SCAFFOLD) await writeFile(join(integrationWorktreePath, f), "");
      await writeFile(
        join(integrationWorktreePath, "package.json"),
        `${JSON.stringify({ type: "module", scripts: { test: "vitest run" }, devDependencies: { vitest: "^3.2.4" } })}\n`,
      );
      await writeFile(join(integrationWorktreePath, ".gitignore"), "node_modules/\n");
      await git(integrationWorktreePath).run(["add", "-A"]);
      await git(integrationWorktreePath).run(["commit", "-m", "scaffold by hand"]);
      await fakeInstalledBin(integrationWorktreePath);

      const out = await runIntegrationBootstrap({ repoRoot, integrationWorktreePath }, { install: async () => {} });
      expect(out.alreadyBootstrapped).toBe(true);
      expect(out.committed).toBe(false);
      expect(out.sha).toBeNull();
      expect(await countOpIdCommits(repoRoot)).toBe(0);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});

async function countOpIdCommits(repoRoot: string): Promise<number> {
  const out = await git(repoRoot).run(["log", "--all", "--grep", `Operation-ID: ${BOOTSTRAP_OP_ID}$`, "--format=%H"]);
  return out.split("\n").filter((l) => l.trim() !== "").length;
}

// ---------------------------------------------------------------------------
// 2. Honest ran / not-run recording
// ---------------------------------------------------------------------------

describe("US-010 vitest ran/not-run semantics", () => {
  test("parseVitestSummary reads failing and all-pass summaries", () => {
    expect(parseVitestSummary(RAN_WITH_FAILURES)?.tests).toEqual({ passed: 22, failed: 1, total: 23 });
    expect(parseVitestSummary(RAN_ALL_PASS)?.tests).toEqual({ passed: 23, failed: 0, total: 23 });
    expect(parseVitestSummary("some crash trace\nno summary here")).toBeNull();
  });

  test("cx6c regression: 'Tests no tests' (collection failure) is NOT a clean 0/0/0 ran", () => {
    // The live cx6c run: every ported test file failed to load (import of an
    // unwritten module) and vitest printed `Tests  no tests`. The old parser
    // read that as ran {passed:0, failed:0, total:0} — a fake clean run. The
    // honest reading takes the Test Files line: 5 failing files.
    const out = `
 RUN  v3.2.4 /itg

 FAIL  test/support/legacy-helpers.test.ts (transform failed)
Error: Failed to load url ./php-semantics

 Test Files  5 failed (5)
      Tests  no tests
    Duration  207ms
`;
    const summary = parseVitestSummary(out);
    expect(summary).not.toBeNull();
    expect(summary!.tests).toEqual({ passed: 0, failed: 5, total: 5 });
    const outcome = vitestOutcomeFromRun(true, ["test/a.test.ts"], { stdout: out });
    expect(outcome.vitestRun).toEqual({ kind: "ran", passed: 0, failed: 5, total: 5 });
  });

  test("no runner -> not-run with reason (never a bare 0)", () => {
    const out = vitestOutcomeFromRun(false, ["test/a.test.ts"], null);
    expect(out.vitestRun).toEqual({
      kind: "not-run",
      reason: "runner unavailable: vitest not installed in the integrated checkout",
    });
    expect(out.records).toEqual([]);
  });

  test("runner without test files -> not-run 'no test files'", () => {
    const out = vitestOutcomeFromRun(true, [], null);
    expect(out.vitestRun.kind).toBe("not-run");
    if (out.vitestRun.kind === "not-run") {
      expect(out.vitestRun.reason).toBe("no test files in the integrated checkout");
    }
  });

  test("ran: counts from the summary + parsed failure records", () => {
    const out = vitestOutcomeFromRun(true, ["test/support/legacy-helpers.test.ts"], {
      stdout: RAN_WITH_FAILURES,
    });
    expect(out.vitestRun).toEqual({ kind: "ran", passed: 22, failed: 1, total: 23 });
    expect(out.records.length).toBe(1);
    expect(out.records[0]!.testFile).toBe("test/support/legacy-helpers.test.ts");
  });

  test("crashed runner (no parseable summary) -> not-run, not a zero-failure ran", () => {
    const out = vitestOutcomeFromRun(true, ["test/a.test.ts"], { stdout: "Segmentation fault\n" });
    expect(out.vitestRun.kind).toBe("not-run");
    if (out.vitestRun.kind === "not-run") {
      expect(out.vitestRun.reason).toContain("no parseable summary");
    }
  });

  test("findVitestTestFiles discovers ported tests under test/ and tests/", async () => {
    const root = join(tmpdir(), `us010-testfiles-${Date.now()}`);
    try {
      await mkdir(join(root, "test", "support"), { recursive: true });
      await mkdir(join(root, "tests"), { recursive: true });
      await writeFile(join(root, "test", "support", "a.test.ts"), "test\n");
      await writeFile(join(root, "tests", "b.test.ts"), "test\n");
      await writeFile(join(root, "tests", "helper.ts"), "not a test\n");
      const files = await findVitestTestFiles(root);
      expect(files).toEqual(["test/support/a.test.ts", "tests/b.test.ts"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("classifyVitestRecords threads ported-test roots (Jev fail-open path)", async () => {
    const records = [failureRecord(["test/support/legacy-helpers.test.ts:12:26"])];
    const state = await classifyVitestRecords(records, 1, undefined, {}, {
      portedRoots: ["src"],
      portedTestRoots: ["test"],
    });
    expect(state.classified[0]!.classification.failureClass).toBe("port-caused");
    expect(state.classified[0]!.classification.attributedFile).toBe(
      "test/support/legacy-helpers.test.ts",
    );
  });
});

// ---------------------------------------------------------------------------
// 3. Ported test files flow through the fix loop (routed failure consumed)
// ---------------------------------------------------------------------------

describe("US-010 ported-test-file fix routing", () => {
  const sourceMap = {
    "src/Support/legacy_helpers.php": { outPath: "./src/support/legacy-helpers.ts" },
    "tests/Support/LegacyHelpersTest.php": { outPath: "./test/support/legacy-helpers.test.ts" },
  };

  test("portedRootsFromSourceMap splits source vs test roots", () => {
    const roots = portedRootsFromSourceMap(sourceMap);
    expect(roots.portedRoots).toEqual(["src"]);
    expect(roots.portedTestRoots).toEqual(["test"]);
  });

  test("classifier: test-only stack -> port-caused routed to the PORTED test file", () => {
    const classify = createNaiveClassifier({ portedRoots: ["src"], portedTestRoots: ["test"] });
    const c = classify.classify(failureRecord(["test/support/legacy-helpers.test.ts:12:26"]));
    expect(c.failureClass).toBe("port-caused");
    expect(c.attributedFile).toBe("test/support/legacy-helpers.test.ts");
  });

  test("classifier: a src frame ANYWHERE outranks the test frame", () => {
    const classify = createNaiveClassifier({ portedRoots: ["src"], portedTestRoots: ["test"] });
    const c = classify.classify(
      failureRecord([
        "test/support/legacy-helpers.test.ts:12:26",
        "src/support/legacy-helpers.ts:8:15",
      ]),
    );
    expect(c.failureClass).toBe("port-caused");
    expect(c.attributedFile).toBe("src/support/legacy-helpers.ts");
  });

  test("non-ported fixture stacks stay fixture-problem (default roots unchanged)", () => {
    const classify = createNaiveClassifier({ portedRoots: ["src"], portedTestRoots: ["test"] });
    const c = classify.classify(failureRecord(["tests/fixtures/harness/selfcheck.ts:3:1"]));
    expect(c.failureClass).toBe("fixture-problem");
  });

  test("fix loop consumes the routed failure for the ported test file and iterates", () => {
    const records = [
      failureRecord(["test/support/legacy-helpers.test.ts:12:26"]),
      failureRecord(["tests/fixtures/harness/selfcheck.ts:3:1"]), // fixture-problem
    ];
    // Route via the same predicate the fix steps + wave dispatch use.
    const routed = vitestRoutedTo(
      records.map((r) => ({
        record: r,
        classification: createNaiveClassifier({ portedRoots: ["src"], portedTestRoots: ["test"] }).classify(r),
      })),
      "test/support/legacy-helpers.test.ts",
    );
    expect(routed.length).toBe(1);
    expect(routed[0]!.record.testFile).toBe("test/support/legacy-helpers.test.ts");

    // The durable pp-verify state the fix steps read: classified records ride
    // vitestState (that IS the routing substrate), vitestRun carries the count.
    const verify = {
      iteration: 1,
      fixQueue: [],
      tscTotal: 0,
      vitestTotal: 1,
      vitestNote: null,
      lastRunAt: "2026-09-27T00:00:00Z",
      errors: [],
      vitestState: {
        kind: "vitest-queue" as const,
        iteration: 1,
        total: 1,
        failures: [routed[0]!.record],
        classified: routed,
      },
      vitestRun: { kind: "ran", passed: 22, failed: 1, total: 23 } as const,
    };
    const feed = queueFixFeedForFile(verify, "test/support/legacy-helpers.test.ts");
    expect(feed.testFailures.length).toBe(1);
    expect(feed.testFailures[0]!.name).toContain("legacy-helpers.test.ts");
    expect(feed.errors).toEqual([]);

    // The ported test file is fixable EXACTLY like a src file (round cap ok),
    // so the failure drives a fix ROUND and re-verification iterates.
    const { fixable, capped } = selectFixableFiles(
      [{ file: "tests/Support/LegacyHelpersTest.php", round: 1 }],
      sourceMap,
      new Map([["test/support/legacy-helpers.test.ts", 1]]),
      2,
    );
    expect(fixable).toEqual([{ file: "tests/Support/LegacyHelpersTest.php", fromRound: 1 }]);
    expect(capped).toEqual([]);
  });

  test("cx6b regression: vitest-attributed failures count toward fix-round selection", () => {
    // The live cx6b run completed with 2 failing ported tests and NO fix
    // round: selectFixableFiles was fed tsc-only counts. The composed count
    // must include vitest failures routed to the output.
    const tscErrors: Array<{ file: string }> = [];
    const vitestClassified = [
      {
        record: failureRecord(["test/support/legacy-helpers.test.ts:12:26"]),
        classification: {
          failureClass: "port-caused" as const,
          attributedFile: "test/support/legacy-helpers.test.ts",
          reason: "stack limited to a PORTED test file",
        },
      },
      {
        record: failureRecord(["test/moderation/chat-sentinel.test.ts:8:3"]),
        classification: {
          failureClass: "port-caused" as const,
          attributedFile: "test/moderation/chat-sentinel.test.ts",
          reason: "stack limited to a PORTED test file",
        },
      },
      {
        record: failureRecord(["tests/fixtures/harness/selfcheck.ts:3:1"]),
        classification: {
          failureClass: "fixture-problem" as const,
          attributedFile: "tests/fixtures/harness/selfcheck.ts",
          reason: "fixture stack",
        },
      },
      {
        record: failureRecord(["test/orphan.test.ts:1:1"]),
        classification: { failureClass: "port-caused" as const, attributedFile: null, reason: "unknown" },
      },
    ];
    const counts = errorCountsByOutput(tscErrors, vitestClassified);
    expect(counts.get("test/support/legacy-helpers.test.ts")).toBe(1);
    expect(counts.get("test/moderation/chat-sentinel.test.ts")).toBe(1);
    expect(counts.has("tests/fixtures/harness/selfcheck.ts")).toBe(false);
    expect(counts.has("test/orphan.test.ts")).toBe(false);
    // And the selection loop now produces fix rounds for the attributed files.
    const { fixable } = selectFixableFiles(
      [
        { file: "tests/Support/LegacyHelpersTest.php", round: 1 },
        { file: "tests/Moderation/ChatSentinelTest.php", round: 1 },
      ],
      {
        ...sourceMap,
        "tests/Moderation/ChatSentinelTest.php": { outPath: "./test/moderation/chat-sentinel.test.ts" },
      },
      counts,
      3,
    );
    expect(fixable.map((f) => f.file).sort()).toEqual([
      "tests/Moderation/ChatSentinelTest.php",
      "tests/Support/LegacyHelpersTest.php",
    ]);
  });

  test("cx6c regression: the round cap reads the LATEST round (loop terminates)", () => {
    // The live cx6c run looped fix waves forever: a file's stale round-1 done
    // entry kept re-qualifying it at round 2 (1+1 <= maxRounds) even after
    // round-2 and round-3 entries existed. The cap must read the file's
    // latest round: at round 3 with maxRounds 3 the file is CAPPED, not
    // re-selected.
    const sourceMap = {
      "src/Support/legacy_helpers.php": { outPath: "./src/support/legacy-helpers.ts" },
    };
    const counts = new Map([["src/support/legacy-helpers.ts", 1]]);
    const { fixable, capped } = selectFixableFiles(
      [
        { file: "src/Support/legacy_helpers.php", round: 1 },
        { file: "src/Support/legacy_helpers.php", round: 2 },
        { file: "src/Support/legacy_helpers.php", round: 3 },
      ],
      sourceMap,
      counts,
      3,
    );
    expect(fixable).toEqual([]);
    expect(capped).toEqual([{ file: "src/Support/legacy_helpers.php", round: 3, count: 1 }]);
    // A file at round 2 (latest) still has one fix round available.
    const mid = selectFixableFiles(
      [
        { file: "src/Support/legacy_helpers.php", round: 1 },
        { file: "src/Support/legacy_helpers.php", round: 2 },
      ],
      sourceMap,
      counts,
      3,
    );
    expect(mid.fixable).toEqual([{ file: "src/Support/legacy_helpers.php", fromRound: 2 }]);
  });
});

// ---------------------------------------------------------------------------
// 4. Test-port scope awareness in agent turns + prep source map
// ---------------------------------------------------------------------------

describe("US-010 test-port scope", () => {
  test("testPortScopeNote fires on PHPUnit test paths only", () => {
    expect(testPortScopeNote("tests/Support/LegacyHelpersTest.php")).not.toBeNull();
    expect(testPortScopeNote("tests/Access/EntitlementCheckerTest.php")).not.toBeNull();
    expect(testPortScopeNote("src/Support/legacy_helpers.php")).toBeNull();
  });

  test("implementer and reviewer turns carry the scope note for test ports", () => {
    const note = testPortScopeNote("tests/Support/LegacyHelpersTest.php")!;
    const impl = composeImplementerTurn({
      phpFileName: "tests/Support/LegacyHelpersTest.php",
      phpSource: "<?php ...",
      prepExcerpt: "prep",
      outputPath: "test/support/legacy-helpers.test.ts",
      scopeNote: note,
    });
    expect(impl).toContain("TEST PORT");
    expect(impl).toContain("vitest");
    const rev = composeReviewerTurn({
      reviewerId: "reviewer-A",
      reviewerLabel: "Reviewer",
      diffBlock: "DIFF",
      scopeNote: note,
    });
    expect(rev).toContain("TEST PORT");
    // Source ports carry no note.
    const srcImpl = composeImplementerTurn({
      phpFileName: "src/Support/legacy_helpers.php",
      phpSource: "<?php ...",
      prepExcerpt: "prep",
      outputPath: "src/support/legacy-helpers.ts",
    });
    expect(srcImpl).not.toContain("TEST PORT");
  });
});

// ---------------------------------------------------------------------------
// 5. Report distinction: typecheck-verified vs test-verified
// ---------------------------------------------------------------------------

describe("US-010 report verification distinction", () => {
  const base = {
    envelopes: [],
    verdicts: [],
    history: null,
  };

  test("ran iteration shows counts; summary carries the distinction", () => {
    const burnDown: QueueBurnDownEvent[] = [
      { queue: "tsc", file: "(total)", iteration: 1, error_count: 0, recorded_at: "2026-09-27T00:00:00Z" },
      {
        queue: "vitest",
        file: "(total)",
        iteration: 1,
        error_count: 1,
        recorded_at: "2026-09-27T00:00:00Z",
        vitest: { state: "ran", reason: null, passed: 22, failed: 1, total: 23 },
      },
    ];
    const report = renderReport({ ...base, burnDown });
    expect(report.json.summary.verification).toEqual({
      tsc_final_error_count: 0,
      tsc_verified: true,
      vitest: { state: "ran", reason: null, passed: 22, failed: 1, total: 23 },
    });
    expect(report.markdown).toContain("RAN — 22 passed / 1 failed of 23 total");
    expect(report.markdown).toContain("typecheck (tsc): PASS");
  });

  test("a not-run iteration NEVER renders as a bare 0", () => {
    const burnDown: QueueBurnDownEvent[] = [
      {
        queue: "vitest",
        file: "(total)",
        iteration: 1,
        error_count: 0,
        recorded_at: "2026-09-27T00:00:00Z",
        vitest: { state: "not-run", reason: "runner unavailable: vitest not installed", passed: null, failed: null, total: null },
      },
    ];
    const report = renderReport({ ...base, burnDown });
    const vitestSection = report.markdown.split("### vitest")[1] ?? "";
    expect(vitestSection).toContain("NOT RUN — runner unavailable");
    expect(vitestSection).not.toMatch(/\| 0 \|/);
    expect(report.json.summary.verification.vitest?.state).toBe("not-run");
    expect(report.markdown).toContain("typecheck-only");
  });
});

// ---------------------------------------------------------------------------
// 6. Fixture-level contract: the stub source map accepts all 10 port units
// ---------------------------------------------------------------------------

describe("US-010 CreatorPay fixture test rows", () => {
  test("prep stub source map includes the 5 test-file rows", async () => {
    const raw = await readFile(
      join(REPO_ROOT, "fixtures", "creatorex-middleware", "prep-stub.md"),
      "utf8",
    );
    const map = parsePrepSourceMap(raw);
    const testRows = Object.keys(map).filter((k) => k.startsWith("tests/"));
    expect(testRows.length).toBe(5);
    for (const php of testRows) {
      expect(map[php]!.outPath).toMatch(/^test\/.*\.test\.ts$/);
    }
    // The full US-009 port-unit list must resolve end to end.
    const all = [
      "src/Access/EntitlementChecker.php",
      "src/Billing/SubscriptionService.php",
      "src/Moderation/ChatSentinel.php",
      "src/Payouts/EarningsLedger.php",
      "src/Support/legacy_helpers.php",
      "tests/Access/EntitlementCheckerTest.php",
      "tests/Billing/SubscriptionServiceTest.php",
      "tests/Moderation/ChatSentinelTest.php",
      "tests/Payouts/EarningsLedgerTest.php",
      "tests/Support/LegacyHelpersTest.php",
    ];
    for (const f of all) {
      expect(map[f], `prep stub lacks a row for ${f}`).toBeDefined();
    }
  });

  test("parseVitestOutput + ported roots: an all-pass run yields zero records", () => {
    expect(parseVitestOutput(RAN_ALL_PASS)).toEqual([]);
  });
});
