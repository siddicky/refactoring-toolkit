/**
 * chaos-kill writer honesty + strict CLI (audit C71, C42 writer side).
 *
 * The sidecar is the evidence chain for the kill-and-resume demo, so a no-op
 * kill must never read as a successful one, and a mistyped PID must never
 * silently shrink the kill set.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chaosKill, parseChaosKillArgs } from "../scripts/chaos-kill.js";

/** A pid that cannot exist on any supported platform (kernel pid_max < 2^22). */
const DEAD_PID = 99_999_999;

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

async function readSidecar(path: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(path, "utf8");
  return raw
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("C71: chaosKill records an explicit NO-OP when nothing was killed", () => {
  test("a real kill writes fired:true and the success note", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const eventsPath = join(dir, "events.jsonl");
    const target = Bun.spawn(["sleep", "30"]);
    await new Promise((r) => setTimeout(r, 100));

    const result = await chaosKill({
      pids: [target.pid],
      reason: "real-kill",
      runId: "r1",
      eventsPath,
      waitMs: 5_000,
    });
    expect(result.fired).toBe(true);
    expect(result.killed).toEqual([target.pid]);

    const [, completed] = await readSidecar(eventsPath);
    expect(completed?.kind).toBe("completed");
    expect(completed?.fired).toBe(true);
    expect(completed?.killed_pids).toEqual([target.pid]);
    expect(String(completed?.notes)).toContain("all targets exited after SIGKILL");
  });

  test("an empty target list is a NO-OP: fired:false, killed_pids [], and NEVER the success note", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const eventsPath = join(dir, "events.jsonl");

    const result = await chaosKill({ pids: [], reason: "x", runId: "r2", eventsPath, waitMs: 100 });
    expect(result.fired).toBe(false);
    expect(result.killed).toEqual([]);

    const rows = await readSidecar(eventsPath);
    expect(rows.map((r) => r.kind)).toEqual(["intent", "completed"]); // evidence chain intact
    const completed = rows[1]!;
    expect(completed.fired).toBe(false);
    expect(completed.killed_pids).toEqual([]);
    expect(String(completed.notes)).toStartWith("NO-OP");
    expect(String(completed.notes)).not.toContain("all targets exited after SIGKILL");
    expect(String(completed.notes)).toContain("none"); // names the (empty) target set
  });

  test("a dead PID is a NO-OP too: the intent lists it, the completion says nothing died", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const eventsPath = join(dir, "events.jsonl");

    const result = await chaosKill({
      pids: [DEAD_PID],
      reason: "dead-target",
      runId: "r3",
      eventsPath,
      waitMs: 100,
    });
    expect(result.fired).toBe(false);

    const [intent, completed] = await readSidecar(eventsPath);
    expect(intent?.target_pids).toEqual([DEAD_PID]);
    expect(completed?.fired).toBe(false);
    expect(String(completed?.notes)).toContain(String(DEAD_PID));
    expect(String(completed?.notes)).not.toContain("all targets exited after SIGKILL");
  });
});

describe("C71: the CLI rejects unparsable input instead of filtering it", () => {
  test("parseChaosKillArgs accepts a clean invocation and applies defaults", () => {
    const parsed = parseChaosKillArgs(["--pids", "123,456", "--reason", "r", "--wait-ms", "250"]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.options.pids).toEqual([123, 456]);
    expect(parsed.options.waitMs).toBe(250);
    expect(parsed.options.reason).toBe("r");
    expect(parsed.options.runId.startsWith("kill-")).toBe(true);

    const withRun = parseChaosKillArgs(["--pids", "123", "--flow-run-id", "run-9"]);
    expect(withRun.ok && withRun.options.flowRunId).toBe("run-9");
  });

  for (const bad of ["123,abc", "123,0", "123,1", "123,-5", "123,,456", "12.5", "0x1f", "123 456"]) {
    test(`--pids ${JSON.stringify(bad)} is a usage error (no silent filtering)`, () => {
      const parsed = parseChaosKillArgs(["--pids", bad]);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("invalid --pids");
    });
  }

  for (const bad of ["abc", "-1", "5s", "1.5", ""]) {
    test(`--wait-ms ${JSON.stringify(bad)} is a usage error (no NaN that skips the exit wait)`, () => {
      const parsed = parseChaosKillArgs(["--pids", "123", "--wait-ms", bad]);
      expect(parsed.ok).toBe(false);
    });
  }

  test("missing --pids, flag without a value, flag-like value and unknown flags are usage errors", () => {
    expect(parseChaosKillArgs([]).ok).toBe(false);
    expect(parseChaosKillArgs(["--pids"]).ok).toBe(false);
    expect(parseChaosKillArgs(["--pids", "--reason"]).ok).toBe(false); // value would be a flag
    expect(parseChaosKillArgs(["--pids", "123", "--event", "x"]).ok).toBe(false); // typo of --events
    expect(parseChaosKillArgs(["--pids", "123", "stray"]).ok).toBe(false);
  });

  test("CLI exits 2 on a bad PID WITHOUT writing any sidecar record", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const eventsPath = join(dir, "events.jsonl");
    const proc = Bun.spawn(
      ["bun", "run", "scripts/chaos-kill.ts", "--pids", "123,abc", "--events", eventsPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(code).toBe(2);
    expect(stderr).toContain("invalid --pids");
    expect(stderr).toContain("--flow-run-id"); // usage string lists it
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("CLI exits 3 (NO-OP) when no target is alive, and the sidecar says fired:false", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const eventsPath = join(dir, "events.jsonl");
    const proc = Bun.spawn(
      [
        "bun", "run", "scripts/chaos-kill.ts",
        "--pids", String(DEAD_PID),
        "--events", eventsPath,
        "--wait-ms", "100",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    expect(code).toBe(3);
    const [, completed] = await readSidecar(eventsPath);
    expect(completed?.fired).toBe(false);
  });
});
