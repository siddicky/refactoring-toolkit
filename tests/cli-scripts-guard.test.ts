/**
 * C69 — guard: every script's arguments go through the shared layer.
 *
 * The audit found five hand-rolled scanners (`argValue` in run-demo,
 * `argValueFrom` in render-metrics, `parseFlagValues` in the watcher,
 * chaos-kill's copy of it, an inline `indexOf` in jev-spot-check). This test
 * keeps a sixth from appearing: a script either parses argv with
 * src/cli/args.ts, or has no argv at all.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SCRIPTS_DIR = join(ROOT, "scripts");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Scripts that parse argv (directly, or through their option table in src/watcher/cli-args.ts). */
const CLI_SCRIPTS = [
  "chaos-kill.ts",
  "jev-spot-check.ts",
  "render-metrics.ts",
  "run-demo.ts",
  "serve-status.ts",
  "watch-queue-verify.ts",
] as const;

/** Modules in scripts/ that have no argv: run-demo drives them and spreads their option specs into its tables. */
const LIBRARY_SCRIPTS = ["dispatch-gate.ts", "probe-flow.ts"] as const;

describe("scripts/ is fully accounted for", () => {
  test("every file in scripts/ is either a CLI on the shared layer or an argv-free module (a new script must pick one)", () => {
    const files = readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".ts")).sort();
    expect(files).toEqual([...CLI_SCRIPTS, ...LIBRARY_SCRIPTS].sort());
  });
});

describe("no hand-rolled argument scanning", () => {
  const files = [...readdirSync(SCRIPTS_DIR).filter((f) => f.endsWith(".ts")).map((f) => `scripts/${f}`), "src/watcher/cli-args.ts"];

  for (const rel of files) {
    test(`${rel}: no argValue / argValueFrom / parseFlagValues, no argv.indexOf / argv.includes flag lookups`, () => {
      const source = read(rel);
      // Definitions and calls only: a comment may still say where the old helper went.
      expect(source).not.toMatch(/\b(function|const)\s+(argValue|argValueFrom|parseFlagValues)\b/);
      expect(source).not.toMatch(/\b(argValue|argValueFrom|parseFlagValues)\(/);
      expect(source).not.toMatch(/\bargv\.(indexOf|includes|find)\(/);
      expect(source).not.toMatch(/\bparseInt\(\s*(argValue|process\.argv)/);
    });

    test(`${rel}: process.argv is only handed whole to the layer (slice(2)) or used for direct-run detection ([1])`, () => {
      const source = read(rel);
      const other = [...source.matchAll(/process\.argv(?!\.slice\(2\)|\[1\])\S*/g)].map((m) => m[0]);
      expect(other).toEqual([]);
    });
  }
});

describe("every CLI script declares its options on the shared layer", () => {
  const viaWatcherTable = new Set(["watch-queue-verify.ts"]);

  for (const script of CLI_SCRIPTS) {
    test(`${script} builds its parse from an option table`, () => {
      const source = read(`scripts/${script}`);
      if (viaWatcherTable.has(script)) {
        // The script itself runs on the watcher's table, which lives next to its exit codes.
        expect(source).toContain('from "../src/watcher/cli-args.js"');
        expect(source).toContain("reportParseFailure");
        expect(read("src/watcher/cli-args.ts")).toMatch(/defineCli\(\{/);
        return;
      }
      expect(source).toContain('from "../src/cli/args.js"');
      expect(source).toMatch(/define(Cli|Program)\(/);
      expect(source).toContain("reportParseFailure");
    });
  }

  test("the library modules read no argv", () => {
    for (const script of LIBRARY_SCRIPTS) {
      expect(read(`scripts/${script}`), script).not.toMatch(/process\.argv/);
    }
  });
});

describe("importing a script never runs it", () => {
  test("every CLI script runs behind import.meta.main (or chaos-kill's direct-run check)", () => {
    for (const script of CLI_SCRIPTS) {
      const source = read(`scripts/${script}`);
      expect(source, script).toMatch(/import\.meta\.main|isDirectRun/);
    }
  });
});
