/**
 * Test helper (not a test file): runs the REAL QueueVerifyStep once over a
 * throwaway checkout whose `tsc` and `vitest` are fake binaries replaying
 * canned output, and returns the durable attribute stores the step wrote.
 *
 * Callers must `await cleanupQueueVerifyRun()` in afterEach: it restores the
 * production tool paths and removes the temp directories.
 */

import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  PortProjectFlow,
  ppConfig,
  ppPrep,
  ppQueue,
  queueVerifyTools,
  type PortQueueState,
  type PortRunInput,
} from "../../flows/port-project.js";
import { stubContext, type AttributeStores } from "./dex-context.js";

const PRODUCTION_TOOLS = { ...queueVerifyTools };
const tempDirs: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `qv-run-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

export async function cleanupQueueVerifyRun(): Promise<void> {
  Object.assign(queueVerifyTools, PRODUCTION_TOOLS);
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
}

async function fakeBin(path: string, stdout: string, stderr: string, exit: number): Promise<string> {
  const data = await tempDir("bin-data");
  await writeFile(join(data, "stdout"), stdout);
  await writeFile(join(data, "stderr"), stderr);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, `#!/bin/sh\ncat "${join(data, "stdout")}"\ncat "${join(data, "stderr")}" >&2\nexit ${exit}\n`);
  await chmod(path, 0o755);
  return path;
}

/**
 * One done file (`test/PriceTest.php` -> `test/price.test.ts`). `tsc` replays
 * the given output/exit (default: clean). `vitest`, when given, replays a
 * failing run (exit 1); without it no vitest binary exists in the checkout, so
 * the vitest queue is skipped.
 */
export async function runQueueVerifyOverFakeTools(
  output: {
    vitestStdout?: string;
    vitestStderr?: string;
    tscStdout?: string;
    tscExit?: number;
  } = {},
): Promise<AttributeStores> {
  const itg = await tempDir("checkout");
  await mkdir(join(itg, "src"), { recursive: true });
  await mkdir(join(itg, "test"), { recursive: true });
  await writeFile(join(itg, "src", "price.ts"), "export const p = 1;\n");
  await writeFile(join(itg, "test", "price.test.ts"), "// ported test\n");
  if (output.vitestStdout !== undefined) {
    await fakeBin(join(itg, "node_modules", ".bin", "vitest"), output.vitestStdout, output.vitestStderr ?? "", 1);
  }
  queueVerifyTools.tscBin = await fakeBin(join(await tempDir("tsc"), "tsc"), output.tscStdout ?? "", "", output.tscExit ?? 0);

  const queue: PortQueueState = {
    pending: [],
    current: null,
    done: [{ file: "test/PriceTest.php", round: 1, commitSha: null, treeHash: null }],
    blocked: [],
  };
  const stores: AttributeStores = new Map();
  stores.set(ppQueue, new Map([["queue", queue]]));
  stores.set(ppConfig, new Map([["config", { maxRounds: 3, prepMaxRounds: 1 }]]));
  stores.set(
    ppPrep,
    new Map([
      ["prep", { raw: "", symbolTable: [], sourceMap: { "test/PriceTest.php": { outPath: "test/price.test.ts", notes: "" } } }],
    ]),
  );
  const input: PortRunInput = {
    repoRoot: itg,
    worktreeRoot: join(itg, ".wt"),
    integrationWorktreePath: itg,
    epoch: 1,
    sourceRoot: itg,
    prepPath: "",
    files: [],
    maxRounds: 3,
    dispatchMode: "parallel",
  };
  await new PortProjectFlow().queueVerify.execute(stubContext(stores, { flowId: "qv-run" }), input);
  return stores;
}

/** Canned vitest 3.x output with exactly one failing test in test/price.test.ts. */
export const ONE_FAILURE_STDOUT = `
 RUN  v3.2.4 /itg

 ❯ test/price.test.ts (1 test | 1 failed) 5ms
   × top-level tax 0ms
     → expected 120 to be 110 // Object.is equality

 Test Files  1 failed (1)
      Tests  1 failed (1)
`;

export const ONE_FAILURE_STDERR = `
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/price.test.ts > top-level tax
AssertionError: expected 120 to be 110 // Object.is equality

 ❯ test/price.test.ts:14:20
     12|
     13| test("top-level tax", () => {
     14|   expect(tax(100)).toBe(110);
       |                    ^

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯
`;
