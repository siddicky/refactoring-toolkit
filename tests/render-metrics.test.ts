/**
 * scripts/render-metrics.ts (AC2 evidence driver) — driver-level tests.
 *
 * The script runs main() on import, so behaviours that need no dex are
 * exercised through a subprocess; pure helpers are covered in src/metrics/*.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { argValueFrom, dexcliInvocation } from "../scripts/render-metrics.js";

describe("dexcli invocation honours DEXCLI_BIN and DEX_SERVER_ADDRESS (C36)", () => {
  test("defaults: dexcli on PATH against the default dex server, JSON output", () => {
    expect(dexcliInvocation(["flow", "summary", "f1"], {})).toEqual({
      bin: "dexcli",
      args: ["flow", "summary", "f1", "-server", "127.0.0.1:8801", "-output", "json"],
    });
  });

  test("DEXCLI_BIN and DEX_SERVER_ADDRESS win (trimmed), like every other dexcli caller", () => {
    const call = dexcliInvocation(["flow", "history", "f1", "-all"], {
      DEXCLI_BIN: " /opt/dex/bin/dexcli ",
      DEX_SERVER_ADDRESS: " dex.internal:9901 ",
    });
    expect(call.bin).toBe("/opt/dex/bin/dexcli");
    expect(call.args).toEqual(["flow", "history", "f1", "-all", "-server", "dex.internal:9901", "-output", "json"]);
  });

  test("blank env values fall back to the defaults", () => {
    const call = dexcliInvocation(["flow", "state", "f1"], { DEXCLI_BIN: "  ", DEX_SERVER_ADDRESS: "" });
    expect(call.bin).toBe("dexcli");
    expect(call.args).toContain("127.0.0.1:8801");
  });
});

describe("render-metrics flag parsing (C36)", () => {
  test("returns the value, or undefined when the flag is absent", () => {
    expect(argValueFrom(["--flow-id", "f1", "--out-dir", "o"], "--flow-id")).toBe("f1");
    expect(argValueFrom(["--flow-id", "f1"], "--out-dir")).toBeUndefined();
  });

  test("a flag given where a value belongs is rejected instead of being swallowed as the value", () => {
    expect(() => argValueFrom(["--flow-id", "--out-dir", "x"], "--flow-id")).toThrow(/requires a value/);
    expect(() => argValueFrom(["--flow-id"], "--flow-id")).toThrow(/requires a value/);
  });
});

const SCRIPT = join(import.meta.dir, "..", "scripts", "render-metrics.ts");

async function runDriver(args: string[]): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["bun", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DEXCLI_BIN: "/nonexistent/dexcli" },
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

describe("render-metrics usage errors (C36)", () => {
  test("`--flow-id --out-dir x` is a usage error (exit 2), not flow id '--out-dir'", async () => {
    const r = await runDriver(["--flow-id", "--out-dir", "x"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--flow-id requires a value");
  });
});

describe("render-metrics kill-events flag handling (C42)", () => {
  test("an explicit --kill-events path that does not exist exits 2 before touching dex", async () => {
    const r = await runDriver(["--flow-id", "flow-x", "--kill-events", "/nonexistent/kill-events.jsonl"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("kill-events sidecar not found: /nonexistent/kill-events.jsonl");
  });

  test("--events (the chaos-kill / watcher flag name) is honoured the same way", async () => {
    const r = await runDriver(["--flow-id", "flow-x", "--events", "/nonexistent/events.jsonl"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("kill-events sidecar not found: /nonexistent/events.jsonl");
  });
});
