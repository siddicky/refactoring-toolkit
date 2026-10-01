/**
 * Layout guard for the test tree (see tests/README.md).
 *
 * Colocated unit tests (src/**, harness/**) and cross-cutting tests (tests/)
 * follow one convention, so a test's home says what it covers. This pins the
 * parts of that convention a machine can check.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

import { REPO_ROOT } from "./support/paths.js";

const SKIPPED_DIRS = new Set(["node_modules", ".git", ".claude", ".omc", ".worktrees", "dist"]);

/** Repo-relative paths of files under `dir` matching `keep`, sorted. */
function walk(dir: string, keep: (rel: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name) || entry.name.startsWith(".dex")) continue;
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, keep, out);
    else if (keep(rel)) out.push(rel);
  }
  return out.sort();
}

const isTestFile = (rel: string): boolean => rel.endsWith(".test.ts");
const testFiles = walk("", isTestFile);
const colocated = testFiles.filter((f) => f.startsWith("src/") || f.startsWith("harness/"));
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

describe("test tree layout", () => {
  test("the scan sees both colocated and tests/ files", () => {
    expect(colocated.length).toBeGreaterThan(30);
    expect(testFiles.filter((f) => f.startsWith("tests/")).length).toBeGreaterThan(30);
  });

  test("test files live only under src/, harness/ or tests/", () => {
    const stray = testFiles.filter((f) => !/^(src|harness|tests)\//.test(f));
    expect(stray).toEqual([]);
  });

  test("tests/ is flat apart from support/ and fixtures/", () => {
    const nested = testFiles.filter((f) => f.startsWith("tests/") && f.split("/").length > 2 && !f.startsWith("tests/support/"));
    expect(nested).toEqual([]);
  });

  test("no test file is named for a milestone, phase or story", () => {
    const milestone = testFiles.filter((f) => /^(phase\d|us\d|wave\d|int\d|contract-[a-z]-|t\d+-)/i.test(basename(f)));
    expect(milestone).toEqual([]);
  });

  test("every test file runs on bun:test, so bun test counts its cases", () => {
    const offenders = testFiles.filter((f) => !/from\s+["']bun:test["']/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  test("a colocated test never imports flows/ or scripts/ (move it to tests/)", () => {
    const offenders: string[] = [];
    for (const file of colocated) {
      for (const m of read(file).matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']*)["']/g)) {
        const target = relative(REPO_ROOT, join(REPO_ROOT, file, "..", m[1] as string));
        if (/^(flows|scripts)\//.test(target)) offenders.push(`${file} imports ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("fixture and helper directories use the shared names", () => {
    const dirs = new Set<string>();
    for (const f of walk("", () => true)) {
      const parts = f.split("/");
      for (let i = 0; i < parts.length - 1; i++) dirs.add(parts.slice(0, i + 1).join("/"));
    }
    const misnamed = [...dirs].filter((d) => /(^|\/)(testdata|test-data|helpers)$/.test(d));
    expect(misnamed).toEqual([]);
  });

  test("no test derives the repository root from its own location; it imports REPO_ROOT", () => {
    const offenders = testFiles.filter((f) => {
      const text = read(f);
      return /import\.meta\.dir,\s*"\.\."/.test(text) || /import\.meta\.url\)\),\s*"\.\."/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
