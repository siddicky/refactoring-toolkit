/**
 * INT-1 — the merged baseline is green because T5 and T9 landed together.
 *
 * On main, src/metrics/render.test.ts imported
 * src/metrics/fixtures/kill-events-run-a.json, which `.gitignore`
 * (`kill-events*.json`) kept out of git: typecheck failed with TS2307 and
 * `bun test` aborted the file. T5 recreated the fixture (force-added) and T9
 * added the .gitignore negation. Neither half is enough alone, so this test
 * pins both: every JSON fixture a metrics test imports is TRACKED, not
 * ignored, and parses as the shape its consumer expects.
 */

import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseKillEvents } from "../src/metrics/kill-events.js";

import { REPO_ROOT } from "./support/paths.js";

function git(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { status: 0, stdout };
  } catch (err) {
    return { status: (err as { status?: number }).status ?? 1, stdout: "" };
  }
}

/** Relative `./fixtures/*.json` imports of every test file under src/metrics. */
function metricsFixtureImports(): Array<{ test: string; fixture: string }> {
  const dir = join(REPO_ROOT, "src", "metrics");
  const found: Array<{ test: string; fixture: string }> = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".test.ts")) continue;
    const text = readFileSync(join(dir, name), "utf8");
    for (const m of text.matchAll(/from\s+"\.\/(fixtures\/[^"]+\.jsonl?)"/g)) {
      found.push({ test: `src/metrics/${name}`, fixture: `src/metrics/${m[1]}` });
    }
  }
  return found;
}

describe("INT-1: metrics test fixtures are tracked, not swallowed by .gitignore", () => {
  const imports = metricsFixtureImports();

  test("the scan finds the recorded fixtures, including the kill-events one", () => {
    expect(imports.length).toBeGreaterThanOrEqual(5);
    expect(imports.map((i) => i.fixture)).toContain("src/metrics/fixtures/kill-events-run-a.json");
  });

  test("every imported fixture exists, is not git-ignored, and is tracked by git", () => {
    for (const { test: importer, fixture } of imports) {
      expect(existsSync(join(REPO_ROOT, fixture)), `${importer} imports missing ${fixture}`).toBe(true);
      expect(git(["check-ignore", "-q", fixture]).status, `${fixture} is git-ignored`).not.toBe(0);
      expect(git(["ls-files", "--error-unmatch", fixture]).status, `${fixture} is not tracked`).toBe(0);
    }
  });

  test("the recorded kill-events fixture parses through the one sidecar reader with no malformed lines", () => {
    const parsed = parseKillEvents(readFileSync(join(REPO_ROOT, "src/metrics/fixtures/kill-events-run-a.json"), "utf8"));
    expect(parsed.malformed).toEqual([]);
    expect(parsed.events.length).toBeGreaterThan(0);
  });
});
