/**
 * Repository hygiene guards (audit team T9): clusters C00, C36, C80, C81, C82,
 * C83, C86. These assert repo-level configuration rather than runtime code:
 *
 * - .gitignore rules (recorded fixtures trackable, run output and tool state
 *   ignored, every dex cache dir ignored) via `git check-ignore --no-index`,
 *   which evaluates patterns only and is independent of what is tracked.
 * - Tracked-file policy (no .omc/.playwright-mcp state, no orphan media).
 * - package.json metadata, scripts, and that every bare import is declared.
 * - The CI workflow and the Biome wiring.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { extname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");

function git(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (r.error) throw r.error;
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Pattern-only ignore check (works for paths that do not exist and for tracked paths). */
function isIgnored(path: string): boolean {
  const r = git(["check-ignore", "-q", "--no-index", "--", path]);
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`git check-ignore failed (${r.status}) for ${path}: ${r.stderr}`);
}

function trackedFiles(...pathspecs: string[]): string[] {
  const r = git(["ls-files", "-z", "--", ...pathspecs]);
  expect(r.status).toBe(0);
  return r.stdout.split("\0").filter((p) => p.length > 0);
}

interface PackageJson {
  packageManager?: string;
  license?: string;
  engines?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

function readPackageJson(): PackageJson {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as PackageJson;
}

describe("C00: recorded metrics fixtures are trackable", () => {
  test("the kill-events render fixture is not ignored", () => {
    expect(isIgnored("src/metrics/fixtures/kill-events-run-a.json")).toBe(false);
    expect(isIgnored("src/metrics/fixtures/kill-events-run-b.jsonl")).toBe(false);
  });

  test("run-time kill-event sidecars stay ignored", () => {
    expect(isIgnored("kill-events.json")).toBe(true);
    expect(isIgnored("kill-events-run.jsonl")).toBe(true);
    expect(isIgnored("metrics/kill-events.jsonl")).toBe(true);
    expect(isIgnored("src/metrics/kill-events-live.jsonl")).toBe(true);
  });
});

describe("C36: every dex blob-cache dir is ignored", () => {
  test.each([".dex-cache", ".dex-cache-watch", ".dex-cache-dashboard"])("%s/ is ignored", (dir) => {
    expect(isIgnored(`${dir}/blob`)).toBe(true);
  });

  test("source dirs named like a cache are not swallowed", () => {
    expect(isIgnored("src/dex/client.ts")).toBe(false);
  });
});

describe("C81: .omc and .playwright-mcp are local tool state, not repo content", () => {
  test("nothing under .omc/ or .playwright-mcp/ is tracked (except .omc/skills/)", () => {
    const offenders = trackedFiles(".omc", ".playwright-mcp").filter((p) => !p.startsWith(".omc/skills/"));
    expect(offenders).toEqual([]);
  });

  test.each([
    ".omc/project-memory.json",
    ".omc/prd.json",
    ".omc/state/team-state.json",
    ".omc/state/sessions/abc/prd.json",
    ".omc/artifacts/ask/x.md",
    ".playwright-mcp/page-1.yml",
    ".claude/worktrees/wf_1/package.json",
  ])("%s is ignored", (path) => {
    expect(isIgnored(path)).toBe(true);
  });

  test("project-scoped OMC skills stay committable", () => {
    expect(isIgnored(".omc/skills/local/SKILL.md")).toBe(false);
  });

  test("the dead .omo/ entry is gone", () => {
    const gi = readFileSync(join(ROOT, ".gitignore"), "utf8");
    expect(gi).not.toMatch(/^\.omo\/?$/m);
  });
});

describe("C83: no orphan media is committed", () => {
  const MEDIA = new Set([".webm", ".mp4", ".mov"]);

  test("nothing is tracked under demo/", () => {
    expect(trackedFiles("demo")).toEqual([]);
  });

  test("every tracked video is referenced by name from another tracked text file", () => {
    const tracked = trackedFiles();
    const videos = tracked.filter((p) => MEDIA.has(extname(p).toLowerCase()));
    const textFiles = tracked.filter((p) => /\.(md|html|ts|json|txt|ya?ml)$/i.test(p));
    const corpus = textFiles.map((p) => readFileSync(join(ROOT, p), "utf8")).join("\n");
    const orphans = videos.filter((v) => !corpus.includes(v.split("/").pop() as string));
    expect(orphans).toEqual([]);
  });
});
