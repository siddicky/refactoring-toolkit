/**
 * C73 — scripts/run-demo.ts is importable.
 *
 * Before: the file ended with an unguarded `main().then(code => process.exit(code))`,
 * so importing it (even just for the exported makeFixtureRepo) ran the CLI and
 * exited the process with the usage text; tests fell back to source-text
 * assertions and the pure helpers were untested.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expandFilesArg, makeFixtureRepo, parseRunDemoArgs } from "../scripts/run-demo.js";
import { REPO_ROOT } from "./support/paths.js";

const RUN_DEMO = join(REPO_ROOT, "scripts", "run-demo.ts");
const tmpDirs: string[] = [];

afterEach(async () => {
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("importing run-demo.ts", () => {
  test("does not run main() or exit: this test body is executing", () => {
    // If the import had run main(), process.exit(64) (no subcommand => usage)
    // would have terminated the runner before any test ran.
    expect(typeof makeFixtureRepo).toBe("function");
    expect(typeof parseRunDemoArgs).toBe("function");
  });

  test("parseRunDemoArgs parses a supplied argv (no process.argv, no side effects)", () => {
    const parsed = parseRunDemoArgs(["demo", "--dir", "/x", "--epoch", "3"]);
    expect(parsed.ok && parsed.command).toBe("demo");
    if (parsed.ok && parsed.command === "demo") {
      expect(parsed.options.dir).toBe("/x");
      expect(parsed.options.epoch).toBe(3);
      expect(parsed.options.maxRounds).toBe(1); // the documented default
      expect(parsed.options.flowId).toBeUndefined(); // absent: the runner generates demo-<epoch ms>
    }
  });

  test("expandFilesArg: `creatorex` expands to the 10 fixture files, anything else is a trimmed comma list", () => {
    const creatorex = expandFilesArg("creatorex");
    expect(creatorex.length).toBe(10);
    expect(creatorex.filter((f) => f.startsWith("src/")).length).toBe(5);
    expect(creatorex.filter((f) => f.startsWith("tests/")).length).toBe(5);
    expect(expandFilesArg(" src/A.php , src/B.php,, ")).toEqual(["src/A.php", "src/B.php"]);
    expect(expandFilesArg("")).toEqual([]);
  });
});

describe("running run-demo.ts directly still executes main()", () => {
  test("no subcommand prints the generated usage and exits 64 (usage error; it was 2 before the shared layer)", async () => {
    const proc = Bun.spawn({ cmd: [process.execPath, "run", RUN_DEMO], stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    expect(code).toBe(64);
    expect(stderr).toContain("[run-demo] missing command");
    expect(stderr).toContain("usage: run-demo.ts <worker|hello|long-step|wait-flow|round|recover|recover-port|agent-roundtrip|git-selftest|gate|demo>");
  });

  test("git-selftest passes (0d2 now exercises the marker-present reconcile branch)", async () => {
    const tmpRoot = await mkdtemp(join(tmpdir(), "porting-kit-selftest-host-"));
    tmpDirs.push(tmpRoot);
    const proc = Bun.spawn({
      cmd: [process.execPath, "run", RUN_DEMO, "git-selftest"],
      env: { ...process.env, TMPDIR: tmpRoot },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
    expect(stdout).toContain("PASS 0d2");
    expect(stdout).toContain("git-selftest: ALL PASS");
    expect(code).toBe(0);
    // the selftest keeps its fixture repo for inspection (deliberate)
    expect((await readdir(tmpRoot)).some((n) => n.startsWith("porting-kit-selftest-"))).toBe(true);
  });
});
