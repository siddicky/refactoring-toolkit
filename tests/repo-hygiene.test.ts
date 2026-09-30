/**
 * Repository hygiene guards. These assert repo-level configuration rather than
 * runtime code, and need the `git` CLI:
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
import { basename, extname, join } from "node:path";

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

describe("kill-events fixtures and sidecars", () => {
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

describe("dex blob-cache dirs", () => {
  test.each([".dex-cache", ".dex-cache-watch", ".dex-cache-dashboard"])("%s/ is ignored", (dir) => {
    expect(isIgnored(`${dir}/blob`)).toBe(true);
  });

  test("tracked source paths are not swallowed by the ignore rules", () => {
    expect(isIgnored("src/dex/client.ts")).toBe(false);
    expect(isIgnored(".claude/skills/porting-toolkit-migration")).toBe(false);
  });
});

describe(".omc and .playwright-mcp are local tool state, not repo content", () => {
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
});

describe("committed media", () => {
  const MEDIA = new Set([".webm", ".mp4", ".mov"]);

  test("nothing is tracked under demo/", () => {
    expect(trackedFiles("demo")).toEqual([]);
  });

  test("every tracked video is referenced by name from another tracked text file", () => {
    const tracked = trackedFiles();
    const videos = tracked.filter((p) => MEDIA.has(extname(p).toLowerCase()));
    const textFiles = tracked.filter((p) => /\.(md|html|ts|json|txt|ya?ml)$/i.test(p));
    const corpus = textFiles.map((p) => readFileSync(join(ROOT, p), "utf8")).join("\n");
    const orphans = videos.filter((v) => !corpus.includes(basename(v)));
    expect(orphans).toEqual([]);
  });
});

describe("package.json metadata and scripts", () => {
  const pkg = readPackageJson();

  test("declares the Bun runtime and the MIT license", () => {
    expect(pkg.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
    expect(pkg.engines?.bun).toBeDefined();
    expect(pkg.license).toBe("MIT");
    expect(readFileSync(join(ROOT, "LICENSE"), "utf8")).toMatch(/^MIT License/);
  });

  test("the pinned Bun version matches @types/bun", () => {
    const pinned = pkg.packageManager?.replace("bun@", "");
    expect(pkg.devDependencies?.["@types/bun"]).toBe(pinned);
  });

  test("has aliases for every documented entry point plus a combined check", () => {
    const s = pkg.scripts ?? {};
    expect(s.check).toBe("bun run typecheck && bun test");
    expect(s.worker).toBe("bun run scripts/run-demo.ts worker");
    expect(s.dashboard).toBe("bun run scripts/serve-status.ts");
    expect(s.metrics).toBe("bun run scripts/render-metrics.ts");
    // existing names are kept
    expect(s.typecheck).toBe("tsc --noEmit");
    expect(s.test).toBe("bun test");
    expect(s.demo).toBe("bun run scripts/run-demo.ts");
    expect(s.chaos).toBe("bun run scripts/chaos-kill.ts");
  });

  test("every script alias points at a file that exists", () => {
    for (const cmd of Object.values(pkg.scripts ?? {})) {
      for (const m of cmd.matchAll(/bun run (scripts\/[\w.-]+\.ts)/g)) {
        expect(existsSync(join(ROOT, m[1] as string))).toBe(true);
      }
    }
  });
});

describe("declared dependencies", () => {
  const SCAN_DIRS = ["src", "flows", "harness", "scripts", "tests", "fixtures"];
  // Sample projects that the toolkit ports; not toolkit code.
  const SKIP_PREFIXES = ["fixtures/php-sample/", "fixtures/creatorex-middleware/"];
  const BUILTINS = new Set([...builtinModules, "bun"]);

  function walk(dir: string, out: string[]): void {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const rel = `${dir}/${entry.name}`;
      if (SKIP_PREFIXES.some((p) => `${rel}/`.startsWith(p))) continue;
      if (entry.isDirectory()) walk(rel, out);
      else if (/\.(ts|tsx|mts)$/.test(entry.name)) out.push(rel);
    }
  }

  function packageOf(specifier: string): string | null {
    if (specifier.startsWith(".") || specifier.startsWith("/")) return null;
    if (specifier.startsWith("node:") || specifier.startsWith("bun:")) return null;
    const parts = specifier.split("/");
    const name = specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] as string);
    return BUILTINS.has(name) ? null : name;
  }

  const STATIC_IMPORT = /^[ \t]*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm;
  const SIDE_EFFECT_IMPORT = /^[ \t]*import\s*["']([^"']+)["']/gm;
  const DYNAMIC_IMPORT = /\b(?:import|require)\(\s*["']([^"']+)["']\s*\)/g;

  test("imports of third-party packages appear in package.json", () => {
    const pkg = readPackageJson();
    const declared = new Set([
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]);
    const files: string[] = [];
    for (const d of SCAN_DIRS) if (existsSync(join(ROOT, d))) walk(d, files);
    expect(files.length).toBeGreaterThan(20);

    const undeclared = new Map<string, string[]>();
    for (const file of files) {
      const text = readFileSync(join(ROOT, file), "utf8");
      for (const re of [STATIC_IMPORT, SIDE_EFFECT_IMPORT, DYNAMIC_IMPORT]) {
        for (const m of text.matchAll(re)) {
          const pkgName = packageOf(m[1] as string);
          if (pkgName === null || declared.has(pkgName)) continue;
          undeclared.set(pkgName, [...(undeclared.get(pkgName) ?? []), file]);
        }
      }
    }
    expect(Object.fromEntries(undeclared)).toEqual({});
  });

  test("@grpc/grpc-js is pinned to the version bun.lock resolves", () => {
    const pkg = readPackageJson();
    const lock = readFileSync(join(ROOT, "bun.lock"), "utf8");
    const resolved = lock.match(/"@grpc\/grpc-js": \["@grpc\/grpc-js@([^"]+)"/)?.[1];
    expect(resolved).toBeDefined();
    expect(pkg.dependencies?.["@grpc/grpc-js"]).toBe(resolved);
  });
});

describe("CI workflow", () => {
  interface Step {
    uses?: string;
    run?: string;
    with?: Record<string, string>;
  }
  interface Workflow {
    on?: Record<string, unknown>;
    permissions?: Record<string, string>;
    jobs?: Record<string, { "runs-on"?: string; steps?: Step[] }>;
  }

  const path = join(ROOT, ".github/workflows/ci.yml");

  test("exists and parses", () => {
    expect(existsSync(path)).toBe(true);
    expect(Bun.YAML.parse(readFileSync(path, "utf8"))).toBeObject();
  });

  test("runs install, typecheck and tests with the pinned Bun, read-only", () => {
    const wf = Bun.YAML.parse(readFileSync(path, "utf8")) as Workflow;
    expect(wf.permissions).toEqual({ contents: "read" });
    expect(Object.keys(wf.on ?? {})).toEqual(expect.arrayContaining(["push", "pull_request"]));

    const steps = Object.values(wf.jobs ?? {}).flatMap((j) => j.steps ?? []);
    expect(steps.some((s) => s.uses?.startsWith("actions/checkout@"))).toBe(true);

    const setup = steps.find((s) => s.uses?.startsWith("oven-sh/setup-bun@"));
    const pinned = readPackageJson().packageManager?.replace("bun@", "");
    expect(setup?.with?.["bun-version"]).toBe(pinned ?? "missing");

    const runs = steps.map((s) => s.run?.trim()).filter((r): r is string => r !== undefined);
    const idx = (cmd: string) => runs.indexOf(cmd);
    expect(idx("bun install --frozen-lockfile")).toBeGreaterThanOrEqual(0);
    expect(idx("bun run typecheck")).toBeGreaterThan(idx("bun install --frozen-lockfile"));
    expect(idx("bun test")).toBeGreaterThan(idx("bun install --frozen-lockfile"));
  });
});

describe("Biome", () => {
  interface BiomeConfig {
    $schema?: string;
    vcs?: Record<string, unknown>;
    files?: { includes?: string[] };
    formatter?: { includes?: string[]; indentStyle?: string; indentWidth?: number };
    assist?: { actions?: { source?: { organizeImports?: string } } };
  }

  const biomeBin = join(ROOT, "node_modules/.bin/biome");
  const config = () => JSON.parse(readFileSync(join(ROOT, "biome.json"), "utf8")) as BiomeConfig;

  function biome(...args: string[]): { status: number | null; output: string } {
    const r = spawnSync(biomeBin, args, { cwd: ROOT, encoding: "utf8" });
    if (r.error) throw r.error;
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }

  test("is an exact-pinned devDependency matching the biome.json schema version", () => {
    const version = readPackageJson().devDependencies?.["@biomejs/biome"];
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(config().$schema).toBe(`https://biomejs.dev/schemas/${version}/schema.json`);
  });

  test("has lint and format:check scripts", () => {
    const s = readPackageJson().scripts ?? {};
    expect(s.lint).toBe("biome lint .");
    expect(s["format:check"]).toBe("biome format .");
  });

  test("formatter matches the repo style and respects .gitignore", () => {
    const c = config();
    expect(c.formatter?.indentStyle).toBe("space");
    expect(c.formatter?.indentWidth).toBe(2);
    expect(c.vcs).toMatchObject({ enabled: true, clientKind: "git", useIgnoreFile: true });
    // organizeImports stays off to avoid import-order churn
    expect(c.assist?.actions?.source?.organizeImports).toBe("off");
  });

  test("third-party trees are excluded, and presentation is lint-only", () => {
    const c = config();
    for (const dir of ["node_modules", "fixtures/php-sample", "fixtures/creatorex-middleware"]) {
      expect(c.files?.includes).toContain(`!**/${dir}`);
    }
    // presentation/index.html keeps its documented a11y lint override; only formatting skips it
    expect(c.files?.includes).not.toContain("!**/presentation");
    expect(c.formatter?.includes).toContain("!**/presentation");
  });

  test("the installed biome loads the config and accepts the repo's own config files", () => {
    expect(existsSync(biomeBin)).toBe(true);
    const fmt = biome("format", "package.json", "biome.json");
    expect(fmt.output).not.toContain("Formatter would have printed");
    expect(fmt.status).toBe(0);
    expect(biome("lint", "package.json", "biome.json").status).toBe(0);
  });
});
