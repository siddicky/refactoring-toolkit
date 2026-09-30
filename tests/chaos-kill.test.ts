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

import { WATCHER_EXIT } from "../src/watcher/cli-args.js";

import {
  CHAOS_KILL_EXIT,
  DEFAULT_KILL_EVENTS_PATH,
  appendKillEvent,
  chaosKill,
  monotonicMs,
  parseChaosKillArgs,
} from "../scripts/chaos-kill.js";

const CHAOS_KILL_SCRIPT = join(import.meta.dir, "..", "scripts", "chaos-kill.ts");

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

  test("CLI exits 64 (usage) on a bad PID WITHOUT writing any sidecar record", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const eventsPath = join(dir, "events.jsonl");
    const proc = Bun.spawn(
      ["bun", "run", CHAOS_KILL_SCRIPT, "--pids", "123,abc", "--events", eventsPath],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    expect(code).toBe(CHAOS_KILL_EXIT.usage);
    expect(stderr).toContain("invalid --pids");
    expect(stderr).toContain("--flow-run-id"); // usage string lists it
    expect(existsSync(eventsPath)).toBe(false);
  });

  test("CLI exits 3 (NO-OP) when no target is alive, and the sidecar says fired:false", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const eventsPath = join(dir, "events.jsonl");
    const proc = Bun.spawn(
      [
        "bun", "run", CHAOS_KILL_SCRIPT,
        "--pids", String(DEAD_PID),
        "--events", eventsPath,
        "--wait-ms", "100",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
    const code = await proc.exited;
    expect(code).toBe(CHAOS_KILL_EXIT.noop);
    const [, completed] = await readSidecar(eventsPath);
    expect(completed?.fired).toBe(false);
  });
});

describe("C42 (writer side, Contract B): default path, parent dir, run identity", () => {
  test("the shared default is metrics/kill-events.jsonl (JSON Lines, inside the gitignored /metrics/)", () => {
    expect(DEFAULT_KILL_EVENTS_PATH).toBe("metrics/kill-events.jsonl");
    const parsed = parseChaosKillArgs(["--pids", "123"]);
    expect(parsed.ok && parsed.options.eventsPath).toBe(DEFAULT_KILL_EVENTS_PATH);
  });

  test("an explicit --events still wins over the default", () => {
    const parsed = parseChaosKillArgs(["--pids", "123", "--events", "/tmp/custom.jsonl"]);
    expect(parsed.ok && parsed.options.eventsPath).toBe("/tmp/custom.jsonl");
  });

  test("appendKillEvent creates the parent directory (metrics/ does not exist on a fresh checkout)", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const eventsPath = join(dir, "metrics", "nested", "kill-events.jsonl");
    appendKillEvent(eventsPath, {
      kind: "intent",
      run_id: "r",
      utc: new Date().toISOString(),
      monotonic_ms: monotonicMs(),
      target_pids: [1234],
      signal: "SIGKILL",
      reason: "mkdir",
    });
    expect(existsSync(eventsPath)).toBe(true);
    expect((await readSidecar(eventsPath))[0]?.kind).toBe("intent");
  });

  test("the CLI with no --events writes metrics/kill-events.jsonl under the cwd", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const proc = Bun.spawn(["bun", "run", CHAOS_KILL_SCRIPT, "--pids", String(DEAD_PID), "--wait-ms", "50"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    const rows = await readSidecar(join(dir, "metrics", "kill-events.jsonl"));
    expect(rows.map((r) => r.kind)).toEqual(["intent", "completed"]);
  });

  test("flow_run_id is written verbatim into BOTH records when given, and omitted (not faked) when unknown", async () => {
    dir = await mkdtemp(join(tmpdir(), "chaos-kill-"));
    const withRun = join(dir, "with.jsonl");
    await chaosKill({
      pids: [],
      reason: "x",
      runId: "label",
      eventsPath: withRun,
      waitMs: 50,
      flowRunId: "01a0df1a-real-dex-run",
    });
    for (const row of await readSidecar(withRun)) {
      expect(row.flow_run_id).toBe("01a0df1a-real-dex-run");
      expect(row.run_id).toBe("label");
    }

    const without = join(dir, "without.jsonl");
    await chaosKill({ pids: [], reason: "x", runId: "label", eventsPath: without, waitMs: 50 });
    for (const row of await readSidecar(without)) {
      expect("flow_run_id" in row).toBe(false);
    }
  });
});

describe("chaos-kill exit codes and --flag=value", () => {
  test("one exit-code table covers both tools: same numbers and meanings as watch-queue-verify", () => {
    expect(CHAOS_KILL_EXIT).toEqual({ ok: 0, noop: 3, survivors: 4, usage: 64, fatal: 70 });
    expect(CHAOS_KILL_EXIT.ok).toBe(WATCHER_EXIT.fired);
    expect(CHAOS_KILL_EXIT.noop).toBe(WATCHER_EXIT.noop);
    expect(CHAOS_KILL_EXIT.survivors).toBe(WATCHER_EXIT.survivor);
    // chaos-kill never reuses a code the watcher gives another meaning (1 = terminal, 2 = timeout).
    const codes = Object.values(CHAOS_KILL_EXIT) as number[];
    expect(codes).not.toContain(WATCHER_EXIT.terminal);
    expect(codes).not.toContain(WATCHER_EXIT.timeout);
  });

  test("empty, repeated and valueless flags are usage errors (a repeated --pids must not silently drop the first list)", () => {
    expect(parseChaosKillArgs(["--pids", "123", "--events="]).ok).toBe(false);
    expect(parseChaosKillArgs(["--pids", "123", "--events", ""]).ok).toBe(false);
    const repeated = parseChaosKillArgs(["--pids", "1234,5678", "--pids", "9999"]);
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.error).toContain("--pids was given more than once");
  });

  test("--flag=value lets a value start with -- (a space-separated one is still rejected)", () => {
    const eq = parseChaosKillArgs(["--pids=123", "--reason=--manual kill"]);
    expect(eq.ok && eq.options.reason).toBe("--manual kill");
    expect(eq.ok && eq.options.pids).toEqual([123]);
    expect(parseChaosKillArgs(["--pids", "123", "--reason", "--manual kill"]).ok).toBe(false);
  });
});
