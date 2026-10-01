/**
 * team-verify wave-1 regression suites:
 * - C1: cross-branch dedup — the committed round must REACH integration even
 *   when the keyed commit lives on a different lease branch (live-reproduced
 *   defect; this test pins the fix at the git-seam level).
 * - M6: re-round leases base on the integration tip → same-path re-rounds
 *   fast-forward into integration.
 * - F1: step-factory completeness lint (no raw dex step creation outside
 *   flows/steps/envelope.ts).
 * - F2: bridge-mode tool enforcement disables the ENTIRE surface.
 * - M2: envelope event keys carry per-target identity.
 * - M5: reviewer numbering header matches the resolver offset.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  InMemoryLeaseStore,
  WorktreePool,
  commitLeaseChanges,
  findCommitByOpId,
  keyedCommitIntegrated,
  makeCommitReachable,
  mergeLeaseIntoIntegration,
  operationId,
} from "../src/git/worktree.js";
import { git } from "../src/git/exec.js";
import { makeFixtureRepo } from "../src/git/fixture.js";
import {
  DIFF_HEADER_LINES,
  renderDiffForReview,
  toolOverridesAllOff,
  toolOverridesFor,
  pluginToolSurface,
} from "../src/harness/runtime.js";
import { envelopeEventKey } from "../flows/steps/envelope.js";
import { REVIEWER } from "../harness/agents/reviewer.js";
import { TOOL_CATEGORIES } from "../harness/agents/types.js";
import { REPO_ROOT } from "./support/paths.js";

let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe("C1: cross-branch dedup must ship the committed round to integration", () => {
  test("keyed commit on quarantined branch reaches integration via makeCommitReachable", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-c1-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    const FILE = "src/money.ts";
    const OP = operationId(FILE, 1);
    const integrationWt = join(root, ".worktrees", "integration");

    // Round 1: ported content commits on lease branch A (epoch 1).
    const a1 = await pool.acquire(FILE, 1, "run-1");
    if (!a1.acquired) throw new Error(a1.reason);
    await mkdir(dirname(join(a1.lease.worktreePath, FILE)), { recursive: true });
    await writeFile(join(a1.lease.worktreePath, FILE), "export const v = 1;\n");
    const first = await commitLeaseChanges(a1.lease.worktreePath, OP, "round 1");
    if (first.sha === null) throw new Error("expected a commit");

    // Quarantine: lease released; branch A + the keyed commit survive.
    await pool.release(FILE);

    // Epoch-2 spare lease: branch B (no integration branch yet → base = HEAD).
    const spare = await pool.acquire(FILE, 2, "run-2");
    if (!spare.acquired) throw new Error(spare.reason);
    const keyed = await findCommitByOpId(root, OP);
    if (keyed === undefined) throw new Error("keyed commit missing");
    expect(keyed.round).toBe(1); // m1: round parsed from the opId
    expect(keyed.branch).not.toBe(spare.lease.branch); // CROSS-BRANCH hit

    // Reproduce the defect geometry: merging the spare lease branch (without
    // the C1 fix) integrates NOTHING — the file is absent from integration.
    await mergeLeaseIntoIntegration(root, integrationWt, spare.lease.branch);
    const hazard = (
      await git(integrationWt).tryRun(["cat-file", "-e", `HEAD:${FILE}`])
    ).ok;
    expect(hazard).toBe(false); // the committed round was silently dropped

    // The fix: CommitStep's dedup path makes the keyed commit reachable from
    // THIS round's branch, then integration ships it.
    const reach = await makeCommitReachable(spare.lease.worktreePath, keyed);
    expect(["fast-forward", "merge", "already"]).toContain(reach);
    const itg = await mergeLeaseIntoIntegration(root, integrationWt, spare.lease.branch);
    void itg;
    const present = (await git(integrationWt).tryRun(["cat-file", "-e", `HEAD:${FILE}`])).ok;
    expect(present).toBe(true); // the committed round NOW lands
    expect(await keyedCommitIntegrated(integrationWt, keyed)).toBe(true);

    // Content integrity: integration carries exactly the committed round.
    const content = await git(integrationWt).run(["show", `HEAD:${FILE}`]);
    expect(content).toBe("export const v = 1;\n");
  });

  test("divergent replay content is discarded on reachability repair (keyed authoritative)", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-c1b-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    const FILE = "src/a.ts";
    const OP = operationId(FILE, 1);
    const integrationWt = join(root, ".worktrees", "integration");

    const a1 = await pool.acquire(FILE, 1, "run-1");
    if (!a1.acquired) throw new Error(a1.reason);
    await mkdir(dirname(join(a1.lease.worktreePath, FILE)), { recursive: true });
    await writeFile(join(a1.lease.worktreePath, FILE), "original\n");
    await commitLeaseChanges(a1.lease.worktreePath, OP, "round 1");
    await pool.release(FILE);

    const spare = await pool.acquire(FILE, 2, "run-2");
    if (!spare.acquired) throw new Error(spare.reason);
    await mkdir(dirname(join(spare.lease.worktreePath, FILE)), { recursive: true });
    await writeFile(join(spare.lease.worktreePath, FILE), "DIVERGENT replay content\n");
    const keyed = (await findCommitByOpId(root, OP)) ?? (() => { throw new Error("keyed missing"); })();

    await makeCommitReachable(spare.lease.worktreePath, keyed);
    await mergeLeaseIntoIntegration(root, integrationWt, spare.lease.branch);
    const content = await git(integrationWt).run(["show", `HEAD:${FILE}`]);
    expect(content).toBe("original\n"); // keyed commit is authoritative, not the replay
    expect(await keyedCommitIntegrated(integrationWt, keyed)).toBe(true);
  });
});

describe("M6: re-round leases base on integration (fast-forward re-rounds)", () => {
  test("same-path round 2 on an integration-based lease merges as a fast-forward", async () => {
    root = await mkdtemp(join(tmpdir(), "porting-kit-m6-"));
    await makeFixtureRepo(root);
    const pool = new WorktreePool(root, join(root, ".worktrees"), new InMemoryLeaseStore(), 2);
    const FILE = "src/a.ts";
    const integrationWt = join(root, ".worktrees", "integration");

    // Round 1 commits and integrates.
    const r1 = await pool.acquire(FILE, 1, "run-1");
    if (!r1.acquired) throw new Error(r1.reason);
    await mkdir(dirname(join(r1.lease.worktreePath, FILE)), { recursive: true });
    await writeFile(join(r1.lease.worktreePath, FILE), "round 1\n");
    await commitLeaseChanges(r1.lease.worktreePath, operationId(FILE, 1), "round 1");
    await mergeLeaseIntoIntegration(root, integrationWt, r1.lease.branch);
    await pool.release(FILE);

    // Round 2 (re-round): fresh lease bases on the integration tip.
    const r2 = await pool.acquire(FILE, 2, "run-2");
    if (!r2.acquired) throw new Error(r2.reason);
    const baseTip = (await git(r2.lease.worktreePath).run(["rev-parse", "HEAD"])).trim();
    const integrationTip = (await git(integrationWt).run(["rev-parse", "HEAD"])).trim();
    expect(baseTip).toBe(integrationTip); // M6 geometry: lease based on integration

    await writeFile(join(r2.lease.worktreePath, FILE), "round 2\n");
    await commitLeaseChanges(r2.lease.worktreePath, operationId(FILE, 2), "round 2");
    const merged = await mergeLeaseIntoIntegration(root, integrationWt, r2.lease.branch);
    expect(merged.fastForward).toBe(true); // explicit re-round strategy: pure FF
    const content = await git(integrationWt).run(["show", `HEAD:${FILE}`]);
    expect(content).toBe("round 2\n");
  });
});

describe("F1: step-factory completeness lint", () => {
  test("raw dex step creation exists only in flows/steps/envelope.ts", async () => {
    const offenders: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          await walk(p);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        const rel = p.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
        const source = await readFile(p, "utf8");
        const rawCreation =
          /getStepType\s*\(\)/.test(source) || /implements\s+Step\b/.test(source);
        const sanctioned = rel === "flows/steps/envelope.ts";
        if (rawCreation && !sanctioned) offenders.push(rel);
      }
    };
    await walk(REPO_ROOT);
    expect(offenders).toEqual([]);
  });
});

describe("F2: bridge-mode tool enforcement", () => {
  test("toolOverridesAllOff disables the ENTIRE plugin surface (all agents)", () => {
    const all = toolOverridesAllOff();
    for (const category of pluginToolSurface()) {
      expect(all[category]).toBe(false);
    }
    expect(Object.keys(all).length).toBe(TOOL_CATEGORIES.length);
  });

  test("toolOverridesFor keeps deny authoritative (reviewer all-false)", () => {
    const reviewer = toolOverridesFor(REVIEWER);
    for (const category of TOOL_CATEGORIES) expect(reviewer[category]).toBe(false);
  });
});

describe("M2: envelope event keys carry per-target identity", () => {
  test("identity separates multi-file executions; absence keeps legacy key", () => {
    expect(envelopeEventKey("pp-implement", 1)).toBe("pp-implement#1");
    expect(envelopeEventKey("pp-implement", 1, "src__Money.php#1")).toBe(
      "pp-implement#1@src__Money.php#1",
    );
    expect(envelopeEventKey("pp-implement", 1, "src__Money.php#1")).not.toBe(
      envelopeEventKey("pp-implement", 1, "src__Pricing__FlatRateDiscount.php#1"),
    );
    expect(envelopeEventKey("pp-review-a", 2, "src__Money.php#1")).not.toBe(
      envelopeEventKey("pp-review-b", 2, "src__Money.php#1"),
    );
  });
});

describe("M5: reviewer numbering header matches the resolver offset", () => {
  test("header states the body-start line and early findings resolve", () => {
    const diff = `diff --git a/src/a.ts b/src/a.ts
new file mode 100644
--- /dev/null
+++ b/src/a.ts
@@ -0,0 +1,2 @@
+export const first = 1;
+export const second = 2;`;
    const rendered = renderDiffForReview({ diffText: diff, file: "src/a.ts", round: 1, diffId: "d1" });
    // The header must tell the reviewer the TRUE body-start line.
    expect(rendered.block).toContain(
      `the diff body starts at line ${DIFF_HEADER_LINES + 1}`,
    );
    // The diff body starts at block line 6; a finding citing the SECOND body
    // line sits at block line 11 — the resolver subtracts the 5-line header.
    const firstBodyLine = rendered.block.split("\n").indexOf("diff --git a/src/a.ts b/src/a.ts") + 1;
    expect(firstBodyLine).toBe(DIFF_HEADER_LINES + 1);
    const citedLine = rendered.block.split("\n").indexOf("+export const first = 1;") + 1;
    expect(citedLine).toBe(DIFF_HEADER_LINES + 6);
    const evidence = resolveEvidenceFor(rendered.block, diff, citedLine);
    expect(evidence).not.toBeNull();
    expect(evidence?.quote).toBe("export const first = 1;");
    expect(evidence?.hunk_id).toBe("h1");
  });
});

// Local wrapper mirroring the flow's call path (parsedDiff + offset).
import { parseUnifiedDiff, resolveEvidence } from "../src/harness/runtime.js";
function resolveEvidenceFor(block: string, diff: string, blockLine: number) {
  void block;
  const parsed = parseUnifiedDiff(diff);
  return resolveEvidence(
    { start_line: blockLine, end_line: blockLine, snippet: "export const first = 1;" },
    parsed,
    DIFF_HEADER_LINES,
  );
}
