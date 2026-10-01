/**
 * Test helper (not a test file): enumerate and read repository files, for the
 * guards that assert on source text. Paths are repo-relative with "/" so
 * messages and expectations read the same on every platform.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./paths.js";

const SKIPPED_DIRS = new Set(["node_modules", ".git", ".claude", ".omc", ".worktrees", "dist"]);

/** Files under repo-relative `dir` ("" = the whole repo) that satisfy `keep`, sorted. */
export function walkFiles(dir: string, keep: (rel: string) => boolean = () => true, out: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith(".dex")) continue;
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) walkFiles(rel, keep, out);
    else if (keep(rel)) out.push(rel);
  }
  return out.sort();
}

/** Non-test TypeScript sources under the given repo-relative directories. */
export function productionSources(...dirs: string[]): string[] {
  return dirs.flatMap((dir) => walkFiles(dir, (rel) => rel.endsWith(".ts") && !rel.endsWith(".test.ts")));
}

/** The text of a repo-relative file. */
export function readSource(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf8");
}
