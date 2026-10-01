/**
 * INT-5 — scripts/run-demo.ts after three teams edited it (T3: recover-port
 * rewrite + importable main; T4a: pickHarness(name, { requireReal }); T6:
 * serve-status reads STATUS_PORT).
 *
 * - Both recovery call sites (`recover`, T3's rewritten `recover-port`) must
 *   pass requireReal. The merge initially kept T3's body with T4a's call
 *   removed, so `--harness auto` silently ran on the stub and the session-abort
 *   fence was skipped ("aborted 0 foreign session(s)").
 * - The dashboard URL run-demo logs is the port serve-status really binds.
 * - scripts/probe-flow.ts documents the harness semantics T4a implemented.
 * - run-demo stays importable (this file imports it).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dashboardChildEnv, dashboardPort } from "../scripts/run-demo.js";
import { configFromEnv } from "../src/dashboard/config.js";

const ROOT = join(import.meta.dir, "..");
const RUN_DEMO = join(ROOT, "scripts", "run-demo.ts");

let scratch: string | undefined;
afterEach(async () => {
  if (scratch !== undefined) await rm(scratch, { recursive: true, force: true });
  scratch = undefined;
});

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

async function runDemo(args: string[], env: Record<string, string>) {
  scratch = await mkdtemp(join(tmpdir(), "run-demo-int5-"));
  const proc = Bun.spawn(["bun", RUN_DEMO, ...args.map((a) => (a === "<dir>" ? scratch! : a))], {
    cwd: ROOT,
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("INT-5: pickHarness requireReal at every recovery call site", () => {
  test("recover-port --harness auto with an unreachable server FAILS instead of fencing nothing on the stub", async () => {
    const url = `http://127.0.0.1:${await freePort()}`;
    const r = await runDemo(["recover-port", "--dir", "<dir>", "--harness", "auto", "--files", "src/A.php"], {
      OPENCODE_BASE_URL: url,
    });
    expect(r.code).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("is not reachable");
    expect(r.stdout).not.toContain("aborted 0 foreign session(s)");
  }, 60_000);

  test("recover with HARNESS=auto and an unreachable server fails the same way", async () => {
    const url = `http://127.0.0.1:${await freePort()}`;
    const r = await runDemo(["recover", "--dir", "<dir>"], { OPENCODE_BASE_URL: url, HARNESS: "auto" });
    expect(r.code).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain("is not reachable");
    expect(r.stdout).not.toContain("aborted 0 foreign session(s)");
  }, 60_000);

  test("every pickHarness call site is accounted for: two recovery sites require the real harness, the worker may fall back", () => {
    const source = readFileSync(RUN_DEMO, "utf8");
    const sites = [...source.matchAll(/await pickHarness\(([^)]*\)?[^)]*)\)/g)].map((m) => m[1] ?? "");
    const real = sites.filter((s) => s.includes("requireReal: true"));
    const plain = sites.filter((s) => !s.includes("requireReal"));
    expect(real).toHaveLength(2); // recover (HARNESS env) + recover-port (--harness)
    expect(plain).toHaveLength(1); // worker start: auto may fall back, loudly
    expect(plain[0]).toContain('argValue("--harness")');
  });
});

describe("INT-5: the logged dashboard URL is the port serve-status binds", () => {
  const cases: Array<[string, NodeJS.ProcessEnv, number]> = [
    ["nothing set", {}, 4646],
    ["STATUS_PORT only", { STATUS_PORT: "5055" }, 5055],
    ["generic PORT only (deprecated; run-demo ignores it)", { PORT: "9999" }, 4646],
    ["both, STATUS_PORT wins", { STATUS_PORT: "5055", PORT: "9999" }, 5055],
  ];

  for (const [name, env, expected] of cases) {
    test(`${name}: serve-status resolves ${expected}, with no PORT-deprecation warning`, () => {
      const port = dashboardPort(env);
      expect(port).toBe(expected);
      const child = configFromEnv(dashboardChildEnv(env, "/some/repo", port), "/elsewhere");
      expect(child.port).toBe(port);
      expect(child.repoRoot).toBe("/some/repo");
      expect(child.warnings.filter((w) => w.includes("PORT is deprecated"))).toEqual([]);
    });
  }
});

describe("INT-5: probe-flow.ts documents the harness semantics T4a implemented", () => {
  const header = readFileSync(join(ROOT, "scripts", "probe-flow.ts"), "utf8").slice(0, 2_000);

  test("reachability decides, --harness auto falls back loudly, --harness stub is explicit", () => {
    expect(header).toContain("reachable opencode server");
    expect(header).toContain("--harness auto");
    expect(header).toContain("labelled StubHarness");
    expect(header).toContain("--harness stub");
  });

  test("the stale claim (OPENCODE_BASE_URL alone selects the real harness) is gone", () => {
    expect(header).not.toContain("With\n * OPENCODE_BASE_URL the real opencode harness is used");
    expect(header).not.toContain("otherwise run-demo.ts\n * injects an explicit StubHarness");
  });
});
