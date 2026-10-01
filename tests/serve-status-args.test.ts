/**
 * C69 — serve-status takes no command-line arguments.
 *
 * Before: argv was never read, so `serve-status.ts --port 5000` bound the
 * default port (4646) and said nothing. Every argument is now a usage error,
 * `--help` prints the generated usage, and importing the module no longer
 * starts a server (main() runs only under import.meta.main).
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { parseOptions, usageText } from "../src/cli/args.js";
import { SERVE_STATUS_CLI } from "../scripts/serve-status.js";
import { REPO_ROOT } from "./support/paths.js";

const SCRIPT = join(REPO_ROOT, "scripts", "serve-status.ts");
const parse = (...argv: string[]) => parseOptions(SERVE_STATUS_CLI, argv);

function failure(...argv: string[]) {
  const parsed = parse(...argv);
  if (parsed.ok) throw new Error("expected a failure");
  return parsed;
}

describe("serve-status argument table (empty)", () => {
  test("no arguments is the only valid invocation", () => {
    expect(parse()).toEqual({ ok: true, options: {} });
  });

  test("every argument is a usage error: flags (with or without a value), positionals, typos of env names", () => {
    expect(failure("--port", "5000").error).toBe("unknown argument: --port");
    expect(failure("--port=5000").error).toBe("unknown argument: --port");
    expect(failure("--port").error).toBe("unknown argument: --port");
    expect(failure("5000").error).toBe("unexpected argument: 5000");
    expect(failure("STATUS_PORT=5000").error).toBe("unexpected argument: STATUS_PORT=5000");
  });

  test("--help (and -h) is not an error and names the environment variables", () => {
    for (const flag of ["--help", "-h"]) {
      const help = failure(flag);
      expect(help.help).toBe(true);
      expect(help.usage).toBe(usageText(SERVE_STATUS_CLI));
    }
    expect(usageText(SERVE_STATUS_CLI)).toContain("usage: serve-status.ts");
    expect(usageText(SERVE_STATUS_CLI)).toContain("STATUS_PORT");
  });
});

describe("running serve-status.ts directly with arguments never starts a server", () => {
  async function run(args: string[]) {
    const proc = Bun.spawn([process.execPath, "run", SCRIPT, ...args], {
      // A port nothing should bind: a run that got past argument parsing would listen on it.
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", STATUS_PORT: "1" },
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

  test("an argument exits 64 with the usage", async () => {
    const r = await run(["--port", "5000"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("unknown argument: --port");
    expect(r.stderr).toContain("usage: serve-status.ts");
    expect(r.stdout).not.toContain("http://");
  });

  test("--help exits 0", async () => {
    const r = await run(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("usage: serve-status.ts");
  });
});
