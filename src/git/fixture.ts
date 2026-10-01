/**
 * Throwaway fixture repository used by `run-demo` (round / git-selftest /
 * `--init-fixture`) and the git-level tests.
 *
 * DESTRUCTIVE by design: {@link makeFixtureRepo} removes `dir` before
 * creating it. Callers that point it at a user-supplied path must check that
 * the path does not exist first (see run-demo's ensureProjectRepo).
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { git } from "./exec.js";

export async function makeFixtureRepo(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const runner = git(dir);
  await runner.run(["init", "-b", "main"]);
  await writeFile(join(dir, "README.md"), "fixture repo\n");
  await runner.run(["add", "-A"]);
  await runner.run(["commit", "-m", "fixture init"]);
}
