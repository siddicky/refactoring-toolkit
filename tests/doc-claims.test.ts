/**
 * Doc-claims guard (audit C79 and the docs stage): the facts the operator-facing
 * docs state are checked against the code and package.json, so they cannot
 * drift apart silently. This reads text and imports constants; the one thing it
 * runs is the documented `.worktrees/` exclusion command, against a scratch
 * repository (a command that only looks right was once documented in three places).
 *
 * - `.env.example` lists exactly the environment variables the code reads, with
 *   the defaults the code uses, and no internal build jargon.
 * - Every `bun run <script>` a doc names exists in package.json, and every
 *   script or file path it names exists.
 * - Every relative link (and heading anchor) in the docs resolves, and so does
 *   every backticked repository path.
 * - The `run-demo.ts` flags the docs show, the `demo` option table in the
 *   runner reference and the exit-code tables match the option tables and exit
 *   constants of the scripts.
 * - The runner reference names the same verification-stack constants the
 *   bootstrap code uses.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";

import { RENDER_METRICS_EXIT } from "../scripts/render-metrics.js";
import { CHAOS_KILL_EXIT } from "../scripts/chaos-kill.js";
import { JEV_SPOT_CHECK_EXIT } from "../scripts/jev-spot-check.js";
import { RUN_DEMO_CLI, RUN_DEMO_EXIT } from "../scripts/run-demo.js";
import { flagName } from "../src/cli/args.js";
import { makeFixtureRepo } from "../src/git/fixture.js";
import { InMemoryLeaseStore, sanitizePathSegment, WorktreePool } from "../src/git/worktree.js";
import { configFromEnv, DEFAULT_KILL_EVENT_FILES, DEFAULT_BURN_DOWN_FILES } from "../src/dashboard/config.js";
import { DEFAULT_MAX_CHILD_FLOWS, DEFAULT_MAX_FLOWS } from "../src/dashboard/flow-select.js";
import { DEFAULT_WORKER_TARGET_ADDRESS, dexConfigFromEnv } from "../src/dex/client.js";
import { DEFAULT_PROMPT_CALL_TIMEOUT_MS, DEFAULT_PROMPT_WAIT_MS } from "../src/harness/opencode.js";
import { WATCHER_BLOB_CACHE_DIR } from "../src/watcher/blob-cache-dir.js";
import { WATCHER_EXIT } from "../src/watcher/cli-args.js";
import { BOOTSTRAP_TEST_GLOBS, BOOTSTRAP_VITEST_PIN } from "../flows/port/bootstrap.js";

import { REPO_ROOT } from "./support/paths.js";
import { productionSources, readSource } from "./support/source-files.js";

const SKILL_DIR = ".agents/skills/porting-toolkit-migration";
const README = "README.md";
const RUNNER = `${SKILL_DIR}/references/runner.md`;
const SKILL = `${SKILL_DIR}/SKILL.md`;
/** Every operator-facing Markdown doc the guard reads (BUILD_NOTES.md is a history log and is not). */
const DOCS = [README, "AGENTS.md", SKILL, RUNNER, "fixtures/FIXTURES.md", "tests/README.md", "presentation/assets/cx9-evidence.md"];

const runner = readSource(RUNNER);
const skill = readSource(SKILL);
const packageJson = JSON.parse(readSource("package.json")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

const ascending = (codes: readonly number[]): number[] => [...codes].sort((a, b) => a - b);
/** The needles a doc fails to contain (a list keeps a failure readable; the docs are long). */
const missingFrom = (text: string, needles: readonly string[]): string[] => needles.filter((n) => !text.includes(n));

/** Markdown with fenced code blocks blanked out, keeping line structure. */
function withoutFences(text: string): string {
  return text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, (block) => block.replace(/[^\n]/g, ""));
}

/** The fenced code blocks of a doc, as written. */
function fencedBlocks(text: string): string[] {
  return [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```/gm)].map((m) => m[1] as string);
}

// ---------------------------------------------------------------------------
// .env.example <-> code
// ---------------------------------------------------------------------------

interface EnvEntry {
  value: string;
  /** true when the line is commented out (the code's default applies). */
  commented: boolean;
}

/** `KEY=value` lines of .env.example, active or commented out. */
function parseEnvExample(text: string): Map<string, EnvEntry> {
  const entries = new Map<string, EnvEntry>();
  for (const line of text.split("\n")) {
    const m = /^(#\s*)?([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m === null) continue;
    const key = m[2] as string;
    if (entries.has(key)) throw new Error(`.env.example documents ${key} twice`);
    entries.set(key, { value: (m[3] as string).trim(), commented: m[1] !== undefined });
  }
  return entries;
}

const LANES = ["PLANNER", "EXECUTOR", "REVIEWER"] as const;

/** Environment variables the production code reads (a text scan of its env accesses). */
function envVarsRead(): Set<string> {
  const names = new Set<string>();
  for (const file of productionSources("src", "scripts", "flows", "harness")) {
    const source = readSource(file);
    // process.env.X, env.X, proc?.env?.X
    for (const m of source.matchAll(/\benv\??\.([A-Z][A-Z0-9_]+)\b/g)) names.add(m[1] as string);
    // env["X"], readEnvVar("X"), env("X"), and the shared readers in src/env.ts: envString("X"), envInt("X", ...)
    for (const m of source.matchAll(/\benv\[\s*["']([A-Z][A-Z0-9_]+)["']\s*\]/g)) names.add(m[1] as string);
    for (const m of source.matchAll(/\b(?:readEnvVar|env|envString|envInt)\(\s*["']([A-Z][A-Z0-9_]+)["']\s*[,)]/g)) names.add(m[1] as string);
    // OPENCODE_${lane.toUpperCase()}_MODEL / _VARIANT: one variable per lane.
    for (const m of source.matchAll(/`(OPENCODE_)\$\{[^}]+\}(_[A-Z_]+)`/g)) {
      for (const lane of LANES) names.add(`${m[1]}${lane}${m[2]}`);
    }
    // The names TYPESAFE_ENV_VARS keeps in one place.
    if (file === "src/typesafe/client.ts") {
      const block = /TYPESAFE_ENV_VARS = \{([\s\S]*?)\}/.exec(source)?.[1] ?? "";
      for (const m of block.matchAll(/"([A-Z][A-Z0-9_]+)"/g)) names.add(m[1] as string);
    }
  }
  return names;
}

describe("doc claims: .env.example", () => {
  const text = readSource(".env.example");
  const documented = parseEnvExample(text);
  const read = envVarsRead();

  test("the scan finds the variables it should (a sanity check on the scan itself)", () => {
    for (const name of [
      "DEX_SERVER_ADDRESS",
      "OPENCODE_BASE_URL",
      "OPENCODE_PLANNER_MODEL",
      "OPENCODE_REVIEWER_VARIANT",
      "OPENCODE_REVIEWER_MODEL_FALLBACK_VARIANT",
      "TYPESAFE_API_KEY",
      "TYPESAFE_OFFLINE",
      "STATUS_PORT",
      "GIT_AUTHOR_NAME",
    ]) {
      expect(read.has(name)).toBe(true);
    }
  });

  test("every variable listed is read by the code", () => {
    const unread = [...documented.keys()].filter((name) => !read.has(name));
    expect(unread).toEqual([]);
  });

  test("every variable the code reads is listed (TMPDIR is the OS's own, so a comment names it)", () => {
    const ambient = ["TMPDIR"];
    const missing = [...read].filter((name) => !documented.has(name) && !ambient.includes(name));
    expect(missing).toEqual([]);
    for (const name of ambient) expect(text.includes(name)).toBe(true);
  });

  test("the defaults it states are the defaults the code uses", () => {
    const value = (key: string): string => {
      const entry = documented.get(key);
      if (entry === undefined) throw new Error(`${key} is not in .env.example`);
      return entry.value;
    };
    const dex = dexConfigFromEnv({}, "worker");
    expect(value("DEX_SERVER_ADDRESS")).toBe(dex.serverAddress);
    expect(value("DEX_WORKER_TARGET")).toBe(DEFAULT_WORKER_TARGET_ADDRESS);
    expect(value("DEX_BLOB_CACHE_DIR")).toBe(dex.blobCacheDir);
    expect(value("DEX_CLIENT_BLOB_CACHE_DIR")).toBe(dexConfigFromEnv({}, "client").blobCacheDir);
    expect(value("DEXCLI_BIN")).toBe(configFromEnv({}, "/x").dexcliBin);
    expect(value("OPENCODE_BASE_URL")).toBe("http://127.0.0.1:4096");
    expect(value("OPENCODE_PROMPT_WAIT_MS")).toBe(String(DEFAULT_PROMPT_WAIT_MS));
    expect(value("OPENCODE_PROMPT_CALL_TIMEOUT_MS")).toBe(String(DEFAULT_PROMPT_CALL_TIMEOUT_MS));
    expect(value("DEX_WATCH_BLOB_CACHE_DIR")).toBe(WATCHER_BLOB_CACHE_DIR);

    const status = configFromEnv({}, "/x");
    expect(value("STATUS_PORT")).toBe(String(status.port));
    expect(value("STATUS_HOST")).toBe(status.host);
    expect(value("STATUS_MAX_FLOWS")).toBe(String(DEFAULT_MAX_FLOWS));
    expect(value("STATUS_MAX_CHILD_FLOWS")).toBe(String(DEFAULT_MAX_CHILD_FLOWS));
    expect(value("STATUS_STREAM_SUBSCRIBE")).toBe(status.streamSubscribe ? "1" : "0");
    expect(value("STATUS_BLOB_CACHE_DIR")).toBe(status.blobCacheDir);
    // The list defaults are stated in prose, so look for the exact text.
    expect(text).toContain(`Default: ${DEFAULT_KILL_EVENT_FILES.join(",")}`);
    expect(text).toContain(`Default: ${DEFAULT_BURN_DOWN_FILES.join(",")}`);
  });

  test("optional variables are commented out, so copying the file changes no default", () => {
    // These read a blank value differently from an unset one.
    const mustStayCommented = [
      "OPENCODE_AGENT",
      "GIT_AUTHOR_NAME",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_NAME",
      "GIT_COMMITTER_EMAIL",
      "RECOVER_FILE",
      "RECOVER_ROUND",
      "PORTING_KIT_FAULT",
    ];
    for (const key of mustStayCommented) expect(documented.get(key)?.commented).toBe(true);
  });

  test("it names no internal build jargon", () => {
    const jargon = text.split("\n").filter((line) => /\bworker-\d|\bPhase \d|\bUS-\d|\bcx-?\d|\bwave-?\d|audit C\d/i.test(line));
    expect(jargon).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// bun run <script>, file paths, links
// ---------------------------------------------------------------------------

describe("doc claims: scripts, paths and links resolve", () => {
  const packageScripts = Object.keys(packageJson.scripts);

  test("every `bun run <name>` names a package.json script, and every `bun run <path>` an existing file", () => {
    const bad: string[] = [];
    for (const doc of DOCS) {
      for (const m of readSource(doc).matchAll(/\bbun run ([A-Za-z0-9:._/-]+)/g)) {
        const target = m[1] as string;
        const isPath = target.includes("/") || target.endsWith(".ts");
        const ok = isPath ? existsSync(join(REPO_ROOT, target)) : packageScripts.includes(target);
        if (!ok) bad.push(`${doc}: bun run ${target}`);
      }
    }
    expect(bad).toEqual([]);
  });

  test("every package.json script is mentioned in the README", () => {
    const readme = readSource(README);
    const unmentioned = packageScripts.filter((name) => !readme.includes(`bun run ${name}`));
    expect(unmentioned).toEqual([]);
  });

  const slug = (heading: string): string =>
    heading
      .trim()
      .toLowerCase()
      .replace(/`/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .replace(/\s/g, "-");

  const anchorsOf = (doc: string): Set<string> =>
    new Set([...withoutFences(readSource(doc)).matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) => slug(m[1] as string)));

  test("every relative Markdown link resolves, anchors included", () => {
    const broken: string[] = [];
    for (const doc of DOCS) {
      for (const m of withoutFences(readSource(doc)).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
        const href = m[1] as string;
        if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) continue; // https:, mailto:, ...
        const [pathPart = "", anchor] = href.split("#");
        const file = pathPart === "" ? doc : relative(REPO_ROOT, join(REPO_ROOT, dirname(doc), pathPart));
        if (!existsSync(join(REPO_ROOT, file))) {
          broken.push(`${doc}: ${href} (no such file)`);
        } else if (anchor !== undefined && file.endsWith(".md") && !anchorsOf(file).has(anchor)) {
          broken.push(`${doc}: ${href} (no such heading)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  // Paths in the docs that are examples for a migrated project, not files of this repository.
  const EXAMPLE_PATHS = new Set(["src/billing/invoice.ts"]);

  test("every repository path in backticks exists", () => {
    const missing: string[] = [];
    const pathPattern = /`((?:src|scripts|flows|harness|tests|fixtures|presentation|\.agents|\.claude|\.github)\/[A-Za-z0-9_./@-]+)`/g;
    for (const doc of DOCS) {
      for (const m of withoutFences(readSource(doc)).matchAll(pathPattern)) {
        const path = (m[1] as string).replace(/\/$/, "");
        if (EXAMPLE_PATHS.has(path) || path.includes("*") || /\.php$/.test(path)) continue;
        // Bare names (a directory such as src/git) are checked too; only example files are skipped.
        if (!existsSync(join(REPO_ROOT, path))) missing.push(`${doc}: ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  test("the skill link the README names is present (Claude Code reads it through .claude/skills)", () => {
    expect(existsSync(join(REPO_ROOT, ".claude/skills/porting-toolkit-migration/SKILL.md"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// run-demo flags and exit codes
// ---------------------------------------------------------------------------

const commands = RUN_DEMO_CLI.commands as Record<string, { options: Record<string, { default?: unknown }> }>;

/** Rows of the first Markdown table under `heading` that start with a backticked `--flag`, flag -> last cell. */
function optionRows(doc: string, heading: string): Map<string, string> {
  const text = readSource(doc);
  const start = text.indexOf(heading);
  if (start < 0) throw new Error(`${doc} has no "${heading}"`);
  const rows = new Map<string, string>();
  for (const line of text.slice(start).split("\n").slice(1)) {
    if (/^#{1,6}\s/.test(line)) break;
    const cells = line.split("|").map((c) => c.trim());
    const m = /^`(--[a-z-]+)`$/.exec(cells[1] ?? "");
    if (m !== null) rows.set(m[1] as string, cells[cells.length - 2] ?? "");
  }
  return rows;
}

describe("doc claims: run-demo flags and exit codes", () => {
  test("every run-demo flag a doc shows is an option of that command", () => {
    const wrong: string[] = [];
    for (const doc of DOCS) {
      const text = readSource(doc);
      // A command line in a code block (continuations joined) or a short inline code span.
      const snippets = [
        ...fencedBlocks(text).flatMap((block) => block.replace(/\\\n\s*/g, " ").split("\n")),
        ...[...text.matchAll(/`([^`\n]+)`/g)].map((m) => m[1] as string),
      ];
      for (const snippet of snippets) {
        const m = /run-demo\.ts\s+([a-z][a-z-]*)\b(.*)$/.exec(snippet);
        if (m === null) continue;
        const command = m[1] as string;
        if (command === "--help") continue;
        const spec = commands[command];
        if (spec === undefined) {
          wrong.push(`${doc}: unknown command ${command}`);
          continue;
        }
        const known = new Set(Object.keys(spec.options).map(flagName));
        for (const flag of (m[2] as string).matchAll(/(?<![\w-])(--[a-z][a-z-]*)/g)) {
          if (flag[1] !== "--help" && !known.has(flag[1] as string)) wrong.push(`${doc}: ${command} ${flag[1]}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("the runner reference documents exactly the options of `demo`, with their defaults", () => {
    const rows = optionRows(RUNNER, "## Inputs and boundaries");
    const options = commands.demo?.options ?? {};
    expect([...rows.keys()].sort()).toEqual(Object.keys(options).map(flagName).sort());
    for (const [key, spec] of Object.entries(options)) {
      if (spec.default === undefined) continue;
      const cell = rows.get(flagName(key)) ?? "";
      expect(cell.replace(/`/g, "")).toBe(String(spec.default));
    }
  });

  const exitCodes = (text: string): number[] =>
    ascending([...text.matchAll(/^\|\s*(\d+)\s*\|/gm)].map((m) => Number(m[1])));
  const expectedRunDemoCodes = ascending(Object.values(RUN_DEMO_EXIT));

  test("the README and the runner reference list exactly run-demo's exit codes", () => {
    expect(exitCodes(readSource(README))).toEqual(expectedRunDemoCodes);
    expect(exitCodes(runner)).toEqual(expectedRunDemoCodes);
  });

  test("the runner reference's script table lists each script's exit codes", () => {
    const table = runner.slice(runner.indexOf("## Other scripts and their exit codes"));
    const expected: Record<string, readonly number[]> = {
      "scripts/render-metrics.ts": Object.values(RENDER_METRICS_EXIT),
      "scripts/jev-spot-check.ts": Object.values(JEV_SPOT_CHECK_EXIT),
      "scripts/chaos-kill.ts": Object.values(CHAOS_KILL_EXIT),
      "scripts/watch-queue-verify.ts": Object.values(WATCHER_EXIT),
    };
    for (const [script, codes] of Object.entries(expected)) {
      const row = table.split("\n").find((line) => line.startsWith(`| \`${script}\``));
      if (row === undefined) throw new Error(`no row for ${script}`);
      const cell = row.split("|").map((c) => c.trim())[3] ?? "";
      const documented = ascending([...cell.matchAll(/(?:^|, )(\d+) (?=[a-z])/g)].map((m) => Number(m[1])));
      expect({ script, documented }).toEqual({ script, documented: ascending(codes) });
    }
  });
});

// ---------------------------------------------------------------------------
// verification stack
// ---------------------------------------------------------------------------

describe("doc claims: the fixed verification stack", () => {
  test("the runner reference states the vitest pin and the test directories the bootstrap uses", () => {
    expect(BOOTSTRAP_TEST_GLOBS.map((g) => g.split("/")[0])).toEqual(["test", "tests"]);
    expect(missingFrom(runner, [BOOTSTRAP_VITEST_PIN, ...BOOTSTRAP_TEST_GLOBS])).toEqual([]);
    // B32: discovery and the vitest include are the same pair, and the doc says what that excludes.
    expect(missingFrom(runner, ["only `*.test.ts`", "a `*.test.tsx` is neither found nor run"])).toEqual([]);
  });

  test("the toolkit's TypeScript version is the one the runner reference names", () => {
    expect(missingFrom(runner, [`TypeScript ${packageJson.devDependencies.typescript}`])).toEqual([]);
  });

  test("the skill and the runner reference tell the operator to reject or adapt before dispatch", () => {
    expect(missingFrom(skill, ["reject this runner or adapt it before dispatch"])).toEqual([]);
    expect(missingFrom(runner, ["rejected or the runner adapted before dispatch"])).toEqual([]);
  });

  test("the skill and the runner reference say where the result lands and that merging needs authorization", () => {
    for (const text of [skill, runner]) {
      expect(missingFrom(text, ["`integration`", ".worktrees/", "info/exclude", "explicit authorization"])).toEqual([]);
    }
  });
});

describe("doc claims: lease branch and worktree names (B29)", () => {
  test("the runner reference's example is what the code produces, hash suffix included", async () => {
    const segment = sanitizePathSegment("src/Billing/Invoice.php");
    expect(segment).toMatch(/^src__Billing__Invoice\.php-[0-9a-f]{8}$/);
    expect(runner).toContain(`\`src/Billing/Invoice.php\` is \`${segment}\``);
    // a path that needs no rewriting is used as it is
    expect(sanitizePathSegment("Invoice.php")).toBe("Invoice.php");
    expect(runner).toContain("`Invoice.php`) is used as it is");
    expect(runner).toContain("`lease/<segment>/<epoch>`");
    expect(runner).toContain("`<dir>/.worktrees/<segment>-<epoch>`");

    // and the pool really names the branch and the directory that way
    const root = await mkdtemp(join(tmpdir(), "doc-lease-"));
    try {
      await makeFixtureRepo(join(root, "repo"));
      const pool = new WorktreePool(join(root, "repo"), join(root, "repo", ".worktrees"), new InMemoryLeaseStore(), 2);
      const res = await pool.acquire("src/Billing/Invoice.php", 3, "doc-claims");
      if (!res.acquired) throw new Error(res.reason);
      expect(res.lease.branch).toBe(`lease/${segment}/3`);
      expect(res.lease.worktreePath).toBe(join(root, "repo", ".worktrees", `${segment}-3`));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("doc claims: the documented `.worktrees/` exclusion command (B25)", () => {
  // The one place this guard runs a command: a command that only LOOKS right was
  // documented in three places (`echo ... >> "$(git -C <dir> rev-parse --git-path
  // info/exclude)"`): git prints a path relative to <dir>, so the redirect landed in
  // the caller's directory and the output repository was never excluded.
  const COMMAND = /`(\(cd [^ `]+ && echo '\.worktrees\/' >> "\$\(git rev-parse --git-path info\/exclude\)"\))`/;
  const sh = (command: string, cwd: string) => spawnSync("sh", ["-c", command], { cwd, encoding: "utf8" });

  test.each([README, SKILL, RUNNER])("%s: run from another directory, it excludes the OUTPUT repository and nothing else", async (doc) => {
    const command = COMMAND.exec(readSource(doc))?.[1];
    if (command === undefined) throw new Error(`${doc} does not document the exclusion command in the checked form`);
    const root = await mkdtemp(join(tmpdir(), "doc-exclude-"));
    try {
      const output = join(root, "output repo");
      const caller = join(root, "caller");
      await makeFixtureRepo(output);
      await makeFixtureRepo(caller);

      const result = sh(command.replace(/cd [^ ]+/, `cd '${output}'`), caller);
      expect(result.status).toBe(0);
      expect(readFileSync(join(output, ".git", "info", "exclude"), "utf8")).toContain(".worktrees/");
      expect(readFileSync(join(caller, ".git", "info", "exclude"), "utf8")).not.toContain(".worktrees/");
      // and the exclusion does what the docs say: `.worktrees/` no longer shows as untracked
      await mkdir(join(output, ".worktrees", "integration"), { recursive: true });
      await writeFile(join(output, ".worktrees", "integration", "x.txt"), "x");
      expect(sh("git status --porcelain", output).stdout).not.toContain(".worktrees");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("the reason it is written this way: `git -C <dir> rev-parse --git-path` prints a path relative to <dir>", async () => {
    const root = await mkdtemp(join(tmpdir(), "doc-exclude-rel-"));
    try {
      await makeFixtureRepo(join(root, "out"));
      const printed = sh(`git -C '${join(root, "out")}' rev-parse --git-path info/exclude`, root).stdout.trim();
      expect(printed.startsWith("/")).toBe(false);
      expect(runner).toContain("prints a path relative to `<dir>`");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
