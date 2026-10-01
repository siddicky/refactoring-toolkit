/**
 * C69 — jev-spot-check's command line.
 *
 * Before: `--out` was found with `argv.indexOf` and its value with `argv[i + 1]`,
 * so `--out --verbose` wrote a file called "--verbose" and a trailing `--out`
 * fell back to /tmp silently. Importing the module also started a live, billed
 * run; main() is now guarded by import.meta.main so the table is importable.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { CLI_EXIT, usageText } from "../src/cli/args.js";
import { JEV_SPOT_CHECK_CLI, JEV_SPOT_CHECK_EXIT, parseJevSpotCheckArgs } from "../scripts/jev-spot-check.js";

const SCRIPT = join(import.meta.dir, "..", "scripts", "jev-spot-check.ts");
const parse = (...argv: string[]) => parseJevSpotCheckArgs(argv);

function failure(...argv: string[]) {
  const parsed = parse(...argv);
  if (parsed.ok) throw new Error("expected a failure");
  return parsed;
}

describe("parseJevSpotCheckArgs", () => {
  test("valid: --out is optional and defaults to /tmp/jev-spot-check.json; both spellings work", () => {
    expect(parse().ok && parse()).toEqual({ ok: true, options: { outPath: "/tmp/jev-spot-check.json" } });
    const spaced = parse("--out", "/tmp/x.json");
    expect(spaced.ok && spaced.options.outPath).toBe("/tmp/x.json");
    const eq = parse("--out=/tmp/y.json");
    expect(eq.ok && eq.options.outPath).toBe("/tmp/y.json");
  });

  test("missing value / trailing flag: --out with nothing after it is an error, not a silent default", () => {
    expect(failure("--out").error).toBe("--out requires a value");
  });

  test("flag as value: --out --verbose is an error, not a file named '--verbose'", () => {
    expect(failure("--out", "--verbose").error).toContain("--out requires a value");
    expect(parse("--out=--verbose").ok).toBe(true);
  });

  test("an empty path, unknown flags, stray positionals and a repeated --out are rejected", () => {
    expect(failure("--out=").error).toBe("--out requires a non-empty value");
    expect(failure("--output", "x").error).toBe("unknown argument: --output");
    expect(failure("x.json").error).toBe("unexpected argument: x.json");
    expect(failure("--out", "a", "--out", "b").error).toContain("more than once");
  });

  test("--help is not an error", () => {
    const help = failure("--help");
    expect(help.help).toBe(true);
    expect(help.usage).toBe(usageText(JEV_SPOT_CHECK_CLI));
    expect(help.usage).toContain("usage: jev-spot-check.ts [--out <path>]");
  });

  test("exit codes: usage is the shared 64 and no longer collides with BLOCKED (2)", () => {
    expect(JEV_SPOT_CHECK_EXIT).toEqual({ pass: 0, fail: 1, blocked: 2, usage: CLI_EXIT.usage });
  });
});

describe("running jev-spot-check.ts directly", () => {
  async function run(args: string[]) {
    const proc = Bun.spawn([process.execPath, "run", SCRIPT, ...args], {
      // No key and offline: a run that got past argument parsing would exit 2 (BLOCKED), never call the API.
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TYPESAFE_OFFLINE: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    return { code, stdout, stderr };
  }

  test("a usage error exits 64 before the BLOCKED checks", async () => {
    const r = await run(["--out"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("--out requires a value");
    expect(r.stderr).toContain("usage: jev-spot-check.ts");
  });

  test("--help exits 0 even though the run would be BLOCKED", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("usage: jev-spot-check.ts");
  });

  test("with valid arguments the offline guard still answers BLOCKED (2), not a usage error", async () => {
    const r = await run(["--out", "/tmp/should-not-be-written.json"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("TYPESAFE_OFFLINE is set");
  });
});
