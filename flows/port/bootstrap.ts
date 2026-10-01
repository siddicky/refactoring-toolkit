/**
 * US-010 — integration bootstrap (deterministic, toolkit-owned): the integrated
 * checkout gets a REAL test runner so vitest evidence can never be vacuously
 * green. Agents never run installs: provisioning is its own durable step
 * (BootstrapStep), the slow command (bun install) happens OUTSIDE every agent
 * turn, the runner artifacts are committed by the sole-committer path under the
 * dedicated op-ID `bootstrap:integration`, and every part is idempotent
 * (skip-if-present), so kill-replay and re-runs converge.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { execTool } from "../../src/exec.js";
import { commitLeaseChanges, findCommitByOpId, isWorktreeClean } from "../../src/git/worktree.js";
import { pathExists, VITEST_TEST_DIRS, VITEST_TEST_SUFFIX } from "./queue-tools.js";
import { stripDotSlash } from "../../src/file-keys.js";

/** Sole-committer op-ID for the bootstrap commit (dedup across kill/replay). */
export const BOOTSTRAP_OP_ID = "bootstrap:integration";

/** vitest devDependency version written into the bootstrapped package.json. */
export const BOOTSTRAP_VITEST_PIN = "^3.2.4";

/** What the runner inspected in the integration checkout (no decisions). */
export interface BootstrapInspection {
  /** package.json file text, or null when absent. */
  packageJsonRaw: string | null;
  tsconfigJson: boolean;
  vitestConfig: boolean;
  /** .gitignore file text, or null when absent. */
  gitignoreRaw: string | null;
  /** node_modules/.bin/vitest present (deps installed). */
  vitestBin: boolean;
}

/** Pure decision over an inspection: what the bootstrap must do. */
export interface BootstrapPlan {
  /** False when the checkout already satisfies every artifact (pure skip). */
  needed: boolean;
  packageJson: "write" | "patch" | "satisfied";
  tsconfig: boolean;
  vitestConfig: boolean;
  gitignore: boolean;
  /** bun install needed (bin missing, or package.json changes to sync). */
  install: boolean;
}

/** Where the scaffold's vitest config looks for tests; the scaffold tsconfig includes the same directories. */
export const BOOTSTRAP_TEST_GLOBS: readonly string[] = VITEST_TEST_DIRS.map((dir) => `${dir}/**/*${VITEST_TEST_SUFFIX}`);

/** tsconfig `include` globs every scaffold covers, whatever the source map says. */
const DEFAULT_TSCONFIG_INCLUDE: readonly string[] = [
  "src/**/*.ts",
  ...BOOTSTRAP_TEST_GLOBS.map((glob) => glob.replace(/\.test\.ts$/, ".ts")),
];

/**
 * C06: tsconfig `include` for the integrated checkout — the defaults PLUS the
 * top-level directory of every prep source-map output, so a map that puts
 * output outside src/test/tests does not make tsc fail with TS18003 (no
 * inputs). Outputs that are absolute, parent-relative or globbed are ignored
 * (the include must stay inside the checkout).
 */
export function tsconfigIncludeFromSourceMap(
  sourceMap: Record<string, { outPath: string }>,
): string[] {
  const include = new Set<string>(DEFAULT_TSCONFIG_INCLUDE);
  for (const row of Object.values(sourceMap)) {
    const rel = stripDotSlash(row.outPath);
    if (rel === "" || rel.startsWith("/") || rel.includes("*") || rel.split("/").includes("..")) continue;
    const ext = rel.endsWith(".tsx") ? "tsx" : "ts";
    const slash = rel.indexOf("/");
    include.add(slash > 0 ? `${rel.slice(0, slash)}/**/*.${ext}` : rel);
  }
  return [...include].sort();
}

/** A generated JSON file: two-space indent, trailing newline. */
function jsonFileText(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** The toolkit-owned scaffold tsconfig (single builder: bootstrap + verify fallback). */
export function scaffoldTsconfigText(include: readonly string[] = DEFAULT_TSCONFIG_INCLUDE): string {
  return jsonFileText({
    compilerOptions: {
      strict: true,
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      noEmit: true,
      skipLibCheck: true,
      types: [],
    },
    include,
  });
}

/** What the bootstrap writes when no source map adds directories to the include (pinned by tests/mirror-drift.test.ts). */
export const BOOTSTRAP_TSCONFIG = scaffoldTsconfigText();

/** The vitest.config.ts the bootstrap writes: it runs the tests under BOOTSTRAP_TEST_GLOBS. */
export function bootstrapVitestConfig(): string {
  const include = BOOTSTRAP_TEST_GLOBS.map((glob) => JSON.stringify(glob)).join(", ");
  return [
    'import { defineConfig } from "vitest/config";',
    "",
    "export default defineConfig({",
    "  test: {",
    `    include: [${include}],`,
    "  },",
    "});",
    "",
  ].join("\n");
}

const BOOTSTRAP_VITEST_CONFIG = bootstrapVitestConfig();

const BOOTSTRAP_PACKAGE_JSON = jsonFileText({
  name: "ported-project",
  private: true,
  type: "module",
  scripts: { test: "vitest run" },
  devDependencies: { vitest: BOOTSTRAP_VITEST_PIN },
});

/** US-010 pure core: decide the bootstrap work from an inspection. */
export function bootstrapPlan(insp: BootstrapInspection): BootstrapPlan {
  let packageJson: BootstrapPlan["packageJson"] = "satisfied";
  if (insp.packageJsonRaw === null) {
    packageJson = "write";
  } else {
    try {
      const parsed = JSON.parse(insp.packageJsonRaw) as {
        type?: string;
        scripts?: { test?: string };
        devDependencies?: { vitest?: string };
      };
      const ok =
        parsed.type === "module" &&
        parsed.scripts?.test === "vitest run" &&
        typeof parsed.devDependencies?.vitest === "string";
      if (!ok) packageJson = "patch";
    } catch {
      packageJson = "patch";
    }
  }
  const tsconfig = !insp.tsconfigJson;
  const vitestConfig = !insp.vitestConfig;
  const gitignore =
    insp.gitignoreRaw === null || !/^node_modules\/?$/m.test(insp.gitignoreRaw);
  const install = !insp.vitestBin || packageJson !== "satisfied";
  const needed =
    packageJson !== "satisfied" || tsconfig || vitestConfig || gitignore || install;
  return { needed, packageJson, tsconfig, vitestConfig, gitignore, install };
}

export interface BootstrapOutcome {
  /** Any file write/patch or install happened on THIS invocation. */
  changed: boolean;
  wrote: string[];
  installRan: boolean;
  /** The sole-committer bootstrap commit landed on THIS invocation. */
  committed: boolean;
  sha: string | null;
  /**
   * Every artifact was already on disk: nothing was written and no install
   * ran. It does NOT mean the scaffold is committed; `committed` says whether
   * this invocation committed a leftover one.
   */
  alreadyBootstrapped: boolean;
}

/** Injectable deps (tests pass a no-op install; the step defaults to bun). */
export interface BootstrapDeps {
  install?: (cwd: string) => Promise<void>;
}

/**
 * Provision the integrated checkout: package.json (type: module, test script
 * vitest run, vitest devDep), strict tsconfig.json, vitest.config.ts, a
 * node_modules gitignore, and the dependency install. Idempotent end to end:
 * a satisfied, clean checkout is a no-op, and the commit dedups on
 * BOOTSTRAP_OP_ID, so kill-replay never duplicates the bootstrap commit. The
 * commit decision does not depend on what this invocation wrote: a replay
 * after a kill (or a failed commit) between the install and the commit finds
 * every file already on disk and an uncommitted tree, and still commits it.
 */
export async function runIntegrationBootstrap(
  input: { repoRoot: string; integrationWorktreePath: string; tsconfigInclude?: readonly string[] },
  deps: BootstrapDeps = {},
): Promise<BootstrapOutcome> {
  const itg = input.integrationWorktreePath;
  const readIfExists = async (p: string): Promise<string | null> => {
    try {
      return await readFile(p, "utf8");
    } catch {
      return null;
    }
  };
  const pkgRaw = await readIfExists(join(itg, "package.json"));
  const insp: BootstrapInspection = {
    packageJsonRaw: pkgRaw,
    tsconfigJson: await pathExists(join(itg, "tsconfig.json")),
    vitestConfig: await pathExists(join(itg, "vitest.config.ts")),
    gitignoreRaw: await readIfExists(join(itg, ".gitignore")),
    vitestBin: await pathExists(join(itg, "node_modules", ".bin", "vitest")),
  };
  const plan = bootstrapPlan(insp);
  const outcome: BootstrapOutcome = {
    changed: false,
    wrote: [],
    installRan: false,
    committed: false,
    sha: null,
    alreadyBootstrapped: !plan.needed,
  };
  // A satisfied CLEAN checkout has nothing to write and nothing uncommitted: a
  // pure skip that costs one `git status`. A satisfied DIRTY one is a replay
  // whose earlier attempt died (or failed to commit) after writing and
  // installing: every artifact is on disk, so the plan alone cannot tell, and
  // the commit below is exactly the work that attempt never finished.
  if (!plan.needed && (await isWorktreeClean(itg))) return outcome;

  const write = async (name: string, content: string): Promise<void> => {
    await writeFile(join(itg, name), content, "utf8");
    outcome.wrote.push(name);
    outcome.changed = true;
  };
  if (plan.packageJson === "write") {
    await write("package.json", BOOTSTRAP_PACKAGE_JSON);
  } else if (plan.packageJson === "patch") {
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(pkgRaw ?? "{}") as Record<string, unknown>;
    } catch {
      parsed = {};
    }
    const obj = parsed as {
      type?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    obj.type = "module";
    obj.scripts = { ...(obj.scripts ?? {}), test: "vitest run" };
    obj.devDependencies = {
      ...(obj.devDependencies ?? {}),
      vitest: obj.devDependencies?.vitest ?? BOOTSTRAP_VITEST_PIN,
    };
    await write("package.json", `${JSON.stringify(obj, null, 2)}\n`);
  }
  if (plan.tsconfig) {
    await write(
      "tsconfig.json",
      input.tsconfigInclude === undefined ? BOOTSTRAP_TSCONFIG : scaffoldTsconfigText(input.tsconfigInclude),
    );
  }
  if (plan.vitestConfig) await write("vitest.config.ts", BOOTSTRAP_VITEST_CONFIG);
  if (plan.gitignore) {
    const base = (insp.gitignoreRaw ?? "").replace(/\n*$/, "\n");
    await write(".gitignore", `${base}node_modules/\n`);
  }

  if (plan.install) {
    const install =
      deps.install ??
      (async (cwd: string) => {
        await execTool("bun", ["install"], { cwd, timeoutMs: 300_000 });
      });
    await install(itg);
    outcome.installRan = true;
    outcome.changed = true;
  }

  // Sole-committer dedup: a kill after commit replays to no second commit.
  const keyed = await findCommitByOpId(input.repoRoot, BOOTSTRAP_OP_ID);
  if (keyed === undefined) {
    const res = await commitLeaseChanges(
      itg,
      BOOTSTRAP_OP_ID,
      "porting-toolkit: integration bootstrap (vitest runner scaffold)",
    );
    outcome.committed = res.disposition !== "no-op-empty-diff";
    outcome.sha = res.sha;
  } else {
    outcome.sha = keyed.sha;
  }
  return outcome;
}
