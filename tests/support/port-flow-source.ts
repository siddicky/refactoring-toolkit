/**
 * Test helper (not a test file): the source files that make up the port flows.
 *
 * flows/port-project.ts is only the public re-export entry; the code lives in
 * flows/port/*.ts. Source-shape guards (call-site counts, "no inline copy of X"
 * checks, step-type lists) must read the whole set, or they pass vacuously /
 * fail on the barrel.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT } from "./paths.js";

/** Repo-relative path of the public entry module. */
export const PORT_FLOW_ENTRY = "flows/port-project.ts";

/** Repo-relative paths of the entry module plus every flows/port/*.ts module (sorted). */
export function portFlowFiles(): string[] {
  const modules = readdirSync(join(REPO_ROOT, "flows", "port"))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => `flows/port/${name}`);
  return [PORT_FLOW_ENTRY, ...modules];
}

/** The text of each port-flow module, keyed by repo-relative path. */
function portFlowSources(): Record<string, string> {
  return Object.fromEntries(portFlowFiles().map((rel) => [rel, readFileSync(join(REPO_ROOT, rel), "utf8")]));
}

/** All port-flow modules concatenated (for guards that grep the flow as one text). */
export function portFlowSource(): string {
  return Object.values(portFlowSources()).join("\n");
}
