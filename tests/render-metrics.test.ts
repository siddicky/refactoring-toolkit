/**
 * scripts/render-metrics.ts (AC2 evidence driver) — driver-level tests.
 *
 * The script runs main() on import, so behaviours that need no dex are
 * exercised through a subprocess; pure helpers are covered in src/metrics/*.
 */
import { describe, expect, test } from "bun:test";
import { join } from "node:path";

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
