/**
 * B4: the prep source map names where the toolkit writes model-generated files.
 * An output that is absolute, climbs out of the lease worktree (`..`) or is
 * shared by two sources is rejected before any model spend, in the flow's
 * PrepStep AND in the demo preflight, and the writer itself refuses to leave
 * the worktree.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PortProjectFlow, parsePrepSourceMapRows, sourceMapProblems, type PortRunInput } from "../flows/port-project.js";
import { writeOutFile } from "../flows/port/agent-turns.js";
import { preflightDemoInputs } from "../scripts/run-demo.js";
import { runStep, type AttributeStores } from "./support/dex-context.js";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});
async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

const row = (php: string, out: string): string => `| \`${php}\` | \`${out}\` | note |`;
const problemsOf = (rows: string[], files: string[]): string[] => sourceMapProblems(parsePrepSourceMapRows(rows.join("\n")), files);

describe("sourceMapProblems (B4)", () => {
  test("a sound map has no problems", () => {
    expect(problemsOf([row("src/A.php", "src/a.ts"), row("src/B.php", "./src/b.ts")], ["src/A.php", "src/B.php"])).toEqual([]);
  });

  test("an output that climbs out of the worktree, however it is spelled, is rejected", () => {
    for (const out of ["../../escaped.ts", "src/../../x.ts", "..\\x.ts", "a/../../../x.ts"]) {
      expect(problemsOf([row("src/A.php", out)], ["src/A.php"])).toEqual([`src/A.php -> \`${out}\` leaves the checkout (\`..\`)`]);
    }
  });

  test("an absolute output is rejected", () => {
    for (const out of ["/etc/cron.d/x.ts", "C:\\x.ts", "\\x.ts"]) {
      expect(problemsOf([row("src/A.php", out)], ["src/A.php"])).toEqual([`src/A.php -> \`${out}\` is absolute`]);
    }
  });

  test("two sources mapped to one output are named together (however the path is spelled)", () => {
    expect(problemsOf([row("src/A.php", "src/x.ts"), row("src/B.php", "./src/./x.ts")], ["src/A.php", "src/B.php"])).toEqual([
      "src/A.php and src/B.php both map to `src/x.ts`",
    ]);
  });

  test("a source with two rows that disagree is reported, not silently last-wins", () => {
    expect(problemsOf([row("src/A.php", "src/a.ts"), row("src/A.php", "src/a2.ts")], ["src/A.php"])).toEqual([
      "src/A.php is mapped to `src/a.ts` and `src/a2.ts`",
    ]);
  });

  test("an identical repeated row is harmless", () => {
    expect(problemsOf([row("src/A.php", "src/a.ts"), row("src/A.php", "src/a.ts")], ["src/A.php"])).toEqual([]);
  });

  test("only the files this run ports are judged: a bad row for another file, or a shared output with it, is not this run's problem", () => {
    const rows = [row("src/A.php", "src/a.ts"), row("src/Other.php", "../x.ts"), row("src/Dup.php", "src/a.ts")];
    expect(problemsOf(rows, ["src/A.php"])).toEqual([]);
  });
});

describe("PrepStep rejects an unusable source map before any model call (B4)", () => {
  const flow = new PortProjectFlow();
  const inputFor = (dir: string, files: string[]): PortRunInput => ({
    repoRoot: dir,
    worktreeRoot: join(dir, ".worktrees"),
    integrationWorktreePath: join(dir, ".worktrees", "integration"),
    epoch: 1,
    sourceRoot: dir,
    prepPath: join(dir, "prep.md"),
    files,
    maxRounds: 2,
  });

  test("a `..` output fails PrepStep with the offending row named", async () => {
    const dir = await tmp("prep-bad-map-");
    await writeFile(join(dir, "prep.md"), `${row("src/A.php", "../../escaped.ts")}\n`);
    const stores: AttributeStores = new Map();
    await expect(runStep(stores, flow.prep, inputFor(dir, ["src/A.php"]), { flowId: "b4", runId: "r1" })).rejects.toThrow(
      /prep source map is unusable: src\/A\.php -> `\.\.\/\.\.\/escaped\.ts` leaves the checkout/,
    );
  });

  test("two sources sharing an output fail PrepStep", async () => {
    const dir = await tmp("prep-dup-map-");
    await writeFile(join(dir, "prep.md"), `${row("src/A.php", "src/x.ts")}\n${row("src/B.php", "src/x.ts")}\n`);
    const stores: AttributeStores = new Map();
    await expect(runStep(stores, flow.prep, inputFor(dir, ["src/A.php", "src/B.php"]), { flowId: "b4", runId: "r1" })).rejects.toThrow(
      /both map to `src\/x\.ts`/,
    );
  });

  test("a sound map still passes (control)", async () => {
    const dir = await tmp("prep-ok-map-");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "A.php"), "<?php\nclass A {}\n");
    await writeFile(join(dir, "prep.md"), `${row("src/A.php", "src/a.ts")}\n`);
    const stores: AttributeStores = new Map();
    await runStep(stores, flow.prep, inputFor(dir, ["src/A.php"]), { flowId: "b4", runId: "r1" });
  });
});

describe("the demo preflight reports unusable rows with the other problems (B4)", () => {
  test("a `..` output and a shared output are listed, each on its own line", async () => {
    const dir = await tmp("preflight-map-");
    await mkdir(join(dir, "src"), { recursive: true });
    for (const f of ["A", "B", "C"]) await writeFile(join(dir, "src", `${f}.php`), "<?php\n");
    await writeFile(
      join(dir, "prep.md"),
      [row("src/A.php", "../a.ts"), row("src/B.php", "src/shared.ts"), row("src/C.php", "src/shared.ts")].join("\n"),
    );
    const err = await preflightDemoInputs({
      files: ["src/A.php", "src/B.php", "src/C.php"],
      prepPath: join(dir, "prep.md"),
      sourceRoot: dir,
    }).catch((e: Error) => e);
    const msg = (err as Error).message;
    expect(msg).toContain("src/A.php -> `../a.ts` leaves the checkout");
    expect(msg).toContain("src/B.php and src/C.php both map to `src/shared.ts`");
    expect(msg.split("\n").filter((l) => l.startsWith("  - ")).length).toBe(2);
  });
});

describe("writeOutFile stays inside the lease worktree (B4)", () => {
  test("a nested relative output is written under the worktree", async () => {
    const wt = await tmp("wt-ok-");
    await writeOutFile(wt, "src/deep/a.ts", "export {};\n");
    expect(await readFile(join(wt, "src", "deep", "a.ts"), "utf8")).toBe("export {};\n");
  });

  test("`..` and absolute outputs are refused and nothing is written beside the worktree", async () => {
    const parent = await tmp("wt-parent-");
    const wt = join(parent, ".worktrees", "A-1");
    await mkdir(wt, { recursive: true });
    for (const out of ["../../escaped.ts", "../sibling.ts", join(parent, "abs.ts"), "src/../../../up.ts"]) {
      await expect(writeOutFile(wt, out, "x")).rejects.toThrow(/outside the lease worktree/);
    }
    for (const name of ["escaped.ts", "sibling.ts", "abs.ts", "up.ts"]) {
      expect(await stat(join(parent, name)).then(() => true, () => false)).toBe(false);
      expect(await stat(join(parent, ".worktrees", name)).then(() => true, () => false)).toBe(false);
    }
  });

  test("a file whose name merely starts with two dots is inside the worktree, not an escape", async () => {
    const wt = await tmp("wt-dots-");
    await writeOutFile(wt, "src/..cache.ts", "export {};\n");
    await writeOutFile(wt, "..hidden.ts", "export {};\n");
    expect(await readFile(join(wt, "src", "..cache.ts"), "utf8")).toBe("export {};\n");
    expect(await readFile(join(wt, "..hidden.ts"), "utf8")).toBe("export {};\n");
  });

  test("the worktree root itself is not a file target", async () => {
    const wt = await tmp("wt-root-");
    await expect(writeOutFile(wt, ".", "x")).rejects.toThrow(/outside the lease worktree/);
  });
});
