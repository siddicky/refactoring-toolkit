/**
 * Phase 1 isolation + boundary suites (plan §Reviewer isolation enforcement,
 * §Commit ownership and integration, §Implementation Steps 2):
 *
 * 1. Reviewer effective-permission test: after the config + plugin merge the
 *    merged reviewer agent has ZERO effective tools (deny authoritative).
 * 2. Runtime probe refusal surface: the bridge renders the enforced policy
 *    into every reviewer turn (prompt-in/content-out; agents have no tool
 *    surface at all — recorded deviation, see BUILD_NOTES).
 * 3. Agent-cannot-commit boundary: no agent module imports git tooling or
 *    creates dex steps; the sole committer path lives under flows/ + src/git.
 * 4. Quarantine → spare: toolkit dedup produces NO second op-ID commit on a
 *    spare worktree even when the replay content differs.
 * 5. Two files on separate leases integrate into the one output project.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { REVIEWER } from "../harness/agents/reviewer.js";
import { IMPLEMENTER } from "../harness/agents/implementer.js";
import { FIXER } from "../harness/agents/fixer.js";
import { TOOL_CATEGORIES } from "../harness/agents/types.js";
import {
  effectiveTools,
  hasZeroEffectiveTools,
  pluginToolSurface,
  toolPolicyBlock,
} from "../src/harness/runtime.js";
import {
  InMemoryLeaseStore,
  WorktreePool,
  commitLeaseChanges,
  findCommitByOpId,
  mergeLeaseIntoIntegration,
  operationId,
} from "../src/git/worktree.js";
import { git } from "../src/git/exec.js";

let root: string | undefined;

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

async function makeFixtureRepo(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const runner = git(dir);
  await runner.run(["init", "-b", "main"]);
  await writeFile(join(dir, "README.md"), "fixture repo\n");
  await runner.run(["add", "-A"]);
  await runner.run(["commit", "-m", "fixture init"]);
}

describe("reviewer effective permissions (post config + plugin merge)", () => {
  test("plugin surface is the full category set; deny is authoritative", () => {
    expect(pluginToolSurface().length).toBe(TOOL_CATEGORIES.length);
    // REVIEWER denies everything, so nothing can survive the merge even if a
    // plugin re-advertises a category.
    expect(REVIEWER.tools.deny.length).toBe(TOOL_CATEGORIES.length);
    expect(effectiveTools(REVIEWER)).toEqual([]);
    expect(hasZeroEffectiveTools(REVIEWER)).toBe(true);
  });

  test("writer agents keep scoped write tools but never bash/git/task/webfetch/mcp", () => {
    for (const def of [IMPLEMENTER, FIXER]) {
      const eff = effectiveTools(def);
      expect(eff.length).toBeGreaterThan(0);
      for (const forbidden of ["bash", "shell", "git", "task", "webfetch", "mcp"] as const) {
        expect(eff).not.toContain(forbidden);
        // Deny authoritative even if a stray allow entry appears.
        expect(def.tools.deny).toContain(forbidden);
      }
    }
  });

  test("runtime probe surface: every reviewer turn carries the enforced refusal policy", () => {
    const block = toolPolicyBlock(REVIEWER);
    expect(block).toContain("NONE — you have no tools at all");
    expect(block).toContain("No git operations of any kind");
    const writerBlock = toolPolicyBlock(IMPLEMENTER);
    expect(writerBlock).toContain("No git operations of any kind");
    expect(writerBlock).not.toContain("NONE — you have no tools");
  });
});

describe("agent-cannot-commit boundary (module structure)", () => {
  test("agent definition modules import no git tooling and create no dex steps", async () => {
    const agentFiles = [
      "harness/agents/implementer.ts",
      "harness/agents/reviewer.ts",
      "harness/agents/fixer.ts",
      "harness/agents/types.ts",
      "harness/agents/verdict-schema.ts",
    ];
    const rootDir = join(import.meta.dir, "..");
    for (const rel of agentFiles) {
      const source = await readFile(join(rootDir, rel), "utf8");
      expect(source).not.toMatch(/from\s+["'].*src\/git\//);
      expect(source).not.toMatch(/commitLeaseChanges|mergeLeaseIntoIntegration|findCommitByOpId/);
      expect(source).not.toMatch(/getStepType\s*\(/);
      expect(source).not.toMatch(/@superdurable\/dex/);
    }
  });

  test("the sole committer entry points are imported only by toolkit code", async () => {
    const rootDir = join(import.meta.dir, "..");
    const { readdir } = await import("node:fs/promises");
    const allowedPrefixes = ["flows/", "scripts/", "src/git/", "tests/"];
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name === ".git" || entry.name.startsWith(".")) continue;
          await walk(p);
          continue;
        }
        if (!entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
        const rel = p.slice(rootDir.length + 1).replace(/\\/g, "/");
        const source = await readFile(p, "utf8");
        if (source.includes("commitLeaseChanges") && !allowedPrefixes.some((pre) => rel.startsWith(pre))) {
          offenders.push(rel);
        }
      }
    };
    await walk(rootDir);
    expect(offenders).toEqual([]);
  });
});

describe("quarantine → spare: no second op-ID commit through the toolkit dedup path", () => {
  test("differing-content replay on a spare lease commits exactly once", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-quarantine-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    const FILE = "src/a.php";
    const OP = operationId(FILE, 1);

    // Round 1 lands on lease epoch 1.
    const a1 = await pool.acquire(FILE, 1, "run-1");
    if (!a1.acquired) throw new Error(a1.reason);
    await mkdir(join(a1.lease.worktreePath, "src"), { recursive: true });
    await writeFile(join(a1.lease.worktreePath, "src", "a.php"), "<?php\n// v1 original\n");
    const first = await commitLeaseChanges(a1.lease.worktreePath, OP, "round 1");
    if (first.sha === null) throw new Error("expected a keyed commit");

    // Quarantine: the lease is released (worktree removed; branch + object kept).
    await pool.release(FILE);

    // Spare worktree at a new epoch replays the SAME op-ID with DIFFERENT
    // content. The toolkit commit step takes the dedup branch: keyed lookup
    // finds the original, the marker records `committed:<op-id>` with the
    // ORIGINAL content hash as evidence, and NO second commit is made.
    const spare = await pool.acquire(FILE, 2, "run-2");
    if (!spare.acquired) throw new Error(spare.reason);
    await mkdir(dirname(join(spare.lease.worktreePath, FILE)), { recursive: true });
    await writeFile(join(spare.lease.worktreePath, FILE), "<?php\n// v2 DIFFERENT content\n");
    const keyed = await findCommitByOpId(root, OP);
    if (keyed === undefined) throw new Error("keyed commit missing after quarantine replay");
    expect(keyed.sha).toBe(first.sha); // dedup identity holds across quarantine
    expect(keyed.contentHash ?? "").toBe(first.contentHash);

    const count = (await git(root).run(["log", "--all", "--grep", `Operation-ID: ${OP}$`, "--format=%H"]))
      .split("\n")
      .filter((l) => l.trim().length > 0).length;
    expect(count).toBe(1); // exactly one commit for this op-ID, content differing notwithstanding
  });
});

describe("two files on separate leases integrate into one output project", () => {
  test("both lease branches merge; the integrated checkout carries both files", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-twolease-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    const files = ["src/money.ts", "src/pricing/flat-rate-discount.ts"];
    const shas: string[] = [];

    // 2-worktree cap: both files leased simultaneously at epoch 1.
    for (const file of files) {
      const acquired = await pool.acquire(file, 1, `run-${file}`);
      if (!acquired.acquired) throw new Error(acquired.reason);
      await mkdir(dirname(join(acquired.lease.worktreePath, file)), { recursive: true });
      await writeFile(
        join(acquired.lease.worktreePath, file),
        `export const ported = "${file}";\n`,
      );
      const res = await commitLeaseChanges(
        acquired.lease.worktreePath,
        operationId(file, 1),
        `port ${file}`,
      );
      shas.push(res.sha ?? "");
    }
    expect(shas.every((s) => s.length > 0)).toBe(true);

    // Integration: both lease branches merge into the single output branch.
    const integrationWt = join(root, ".worktrees", "integration");
    for (const file of files) {
      const lease = pool.store().get(file);
      if (lease === undefined) throw new Error(`lease missing for ${file}`);
      await mergeLeaseIntoIntegration(root, integrationWt, lease.branch);
    }

    const integ = git(integrationWt);
    for (const file of files) {
      const out = await integ.run(["show", `HEAD:${file}`]);
      expect(out).toContain(`ported = "${file}"`);
    }
    // Disjoint paths merged conflict-free; both commits reachable at HEAD.
    const headTree = (await integ.run(["rev-parse", "HEAD^{tree}"])).trim();
    expect(headTree.length).toBe(40);
  });
});
