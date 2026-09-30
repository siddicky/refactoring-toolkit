/**
 * C34 — watch-queue-verify argument validation and disjoint exit codes.
 *
 * Old behaviour: `--deadline-minutes abc` parsed to NaN and the watcher exited
 * "timeout" right after arming; `argValue` took the next flag as a value; the
 * usage error returned 2 (same as "bound elapsed") and a fatal throw exited 1
 * (same as "flow terminal before trigger").
 */

import { describe, expect, test } from "bun:test";

import { join } from "node:path";

import {
  WATCHER_EXIT,
  WATCHER_USAGE,
  parseFlagValues,
  parseWatcherArgs,
} from "../src/watcher/cli-args.js";

const WATCH_SCRIPT = join(import.meta.dir, "..", "scripts", "watch-queue-verify.ts");
const DEFAULTS = { eventsPath: "metrics/kill-events.jsonl" };
const parse = (...argv: string[]) => parseWatcherArgs(argv, DEFAULTS);

describe("C34(5): parseWatcherArgs validates instead of coercing", () => {
  test("a minimal invocation gets the documented defaults (30 min, 60 s poll, 1 s catch-up)", () => {
    const parsed = parse("--flow-id", "cx-5e");
    expect(parsed).toEqual({
      ok: true,
      options: {
        flowId: "cx-5e",
        runId: "watch-queue-verify",
        eventsPath: "metrics/kill-events.jsonl",
        flowRunId: undefined,
        deadlineMinutes: 30,
        pollSeconds: 60,
        catchUpSeconds: 1,
      },
    });
  });

  test("explicit values are honoured (fractional minutes allowed)", () => {
    const parsed = parse(
      "--flow-id", "f",
      "--run-id", "label",
      "--events", "/tmp/e.jsonl",
      "--flow-run-id", "run-1",
      "--deadline-minutes", "0.5",
      "--poll-seconds", "5",
      "--catch-up-seconds", "2",
    );
    expect(parsed.ok && parsed.options).toEqual({
      flowId: "f",
      runId: "label",
      eventsPath: "/tmp/e.jsonl",
      flowRunId: "run-1",
      deadlineMinutes: 0.5,
      pollSeconds: 5,
      catchUpSeconds: 2,
    });
  });

  for (const bad of ["abc", "0", "-5", "NaN", "Infinity", "1e3", "", "0.0"]) {
    test(`--deadline-minutes ${JSON.stringify(bad)} is rejected (NaN used to exit 'timeout' immediately)`, () => {
      const parsed = parse("--flow-id", "f", "--deadline-minutes", bad);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error).toContain("--deadline-minutes");
    });
  }

  for (const flag of ["--poll-seconds", "--catch-up-seconds"]) {
    for (const bad of ["abc", "0", "-1", "1.5", "NaN", "", "5s"]) {
      test(`${flag} ${JSON.stringify(bad)} is rejected (whole seconds >= 1; 0 is the 60 s server default)`, () => {
        const parsed = parse("--flow-id", "f", flag, bad);
        expect(parsed.ok).toBe(false);
        if (!parsed.ok) expect(parsed.error).toContain(flag);
      });
    }
  }

  test("a flag may not swallow the next flag as its value, and a trailing flag needs a value", () => {
    const swallowed = parse("--flow-id", "--run-id", "x");
    expect(swallowed.ok).toBe(false);
    if (!swallowed.ok) expect(swallowed.error).toContain("--flow-id requires a value");

    const trailing = parse("--flow-id", "f", "--events");
    expect(trailing.ok).toBe(false);
    if (!trailing.ok) expect(trailing.error).toContain("--events requires a value");
  });

  test("missing --flow-id, blank --flow-id, unknown flags and stray positionals are rejected", () => {
    expect(parse().ok).toBe(false);
    expect(parse("--flow-id", "  ").ok).toBe(false);
    const typo = parse("--flow-id", "f", "--poll-second", "5");
    expect(typo.ok).toBe(false);
    if (!typo.ok) expect(typo.error).toContain("unknown argument: --poll-second");
    expect(parse("--flow-id", "f", "stray").ok).toBe(false);
  });
});

describe("C34(4): every outcome has its own exit code", () => {
  test("usage (64) and fatal (70) no longer collide with bound-elapsed (2) or terminal (1)", () => {
    const codes = Object.values(WATCHER_EXIT);
    expect(new Set(codes).size).toBe(codes.length); // all distinct
    expect(WATCHER_EXIT).toEqual({
      fired: 0,
      terminal: 1,
      timeout: 2,
      noop: 3,
      survivor: 4,
      usage: 64,
      fatal: 70,
    });
  });

  test("the usage string names the new flags", () => {
    for (const flag of ["--flow-id", "--events", "--flow-run-id", "--deadline-minutes", "--poll-seconds", "--catch-up-seconds"]) {
      expect(WATCHER_USAGE).toContain(flag);
    }
  });
});

describe("C34(4,5): the script itself exits 64 on a usage error, before arming anything", () => {
  async function runScript(...args: string[]) {
    const proc = Bun.spawn(["bun", "run", WATCH_SCRIPT, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await proc.exited;
    return {
      code,
      stdout: await new Response(proc.stdout).text(),
      stderr: await new Response(proc.stderr).text(),
    };
  }

  test("--deadline-minutes abc -> exit 64 (not 2 = bound elapsed), usage on stderr, watcher never started", async () => {
    const r = await runScript("--flow-id", "f", "--deadline-minutes", "abc");
    expect(r.code).toBe(WATCHER_EXIT.usage);
    expect(r.stderr).toContain("--deadline-minutes must be a number > 0");
    expect(r.stderr).toContain("usage: watch-queue-verify");
    expect(r.stdout).not.toContain("watcher start");
  });

  test("missing --flow-id -> exit 64", async () => {
    const r = await runScript("--poll-seconds", "5");
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("--flow-id is required");
  });
});

describe("shared flag scanner: --flag=value escape hatch", () => {
  test("a value that starts with -- is accepted in --flag=value form (and only there)", () => {
    const eq = parse("--flow-id", "f", "--run-id=--smoke");
    expect(eq.ok && eq.options.runId).toBe("--smoke");
    expect(parse("--flow-id", "f", "--run-id", "--smoke").ok).toBe(false);
  });

  test("parseFlagValues handles both spellings, empty =values, and rejects unknown flags", () => {
    const known = ["--a", "--b"];
    const ok = parseFlagValues(["--a=1", "--b", "2"], known);
    expect(ok.ok && Object.fromEntries(ok.values)).toEqual({ "--a": "1", "--b": "2" });
    const empty = parseFlagValues(["--a="], known);
    expect(empty.ok && empty.values.get("--a")).toBe("");
    const eqInValue = parseFlagValues(["--a=x=y"], known);
    expect(eqInValue.ok && eqInValue.values.get("--a")).toBe("x=y");
    expect(parseFlagValues(["--c=1"], known).ok).toBe(false);
  });
});
