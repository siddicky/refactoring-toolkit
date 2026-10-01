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

import { CLI_EXIT } from "../src/cli/args.js";
import { DEFAULT_KILL_EVENTS_PATH } from "../src/metrics/kill-events.js";
import { WATCHER_EXIT, WATCHER_USAGE, parseWatcherArgs } from "../src/watcher/cli-args.js";

const WATCH_SCRIPT = join(import.meta.dir, "..", "scripts", "watch-queue-verify.ts");
const parse = (...argv: string[]) => parseWatcherArgs(argv);

describe("C34(5): parseWatcherArgs validates instead of coercing", () => {
  test("a minimal invocation gets the documented defaults (30 min, 60 s poll, 1 s catch-up)", () => {
    const parsed = parse("--flow-id", "cx-5e");
    expect(parsed).toEqual({
      ok: true,
      options: {
        flowId: "cx-5e",
        runId: "watch-queue-verify",
        eventsPath: DEFAULT_KILL_EVENTS_PATH,
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

  test("the numeric flags follow the same rule: a flag where the value belongs, or no value at all", () => {
    for (const flag of ["--deadline-minutes", "--poll-seconds", "--catch-up-seconds"]) {
      const swallowed = parse("--flow-id", "f", flag, "--run-id", "x");
      expect(swallowed.ok).toBe(false);
      if (!swallowed.ok) expect(swallowed.error).toContain(`${flag} requires a value`);
      const trailing = parse("--flow-id", "f", flag);
      expect(trailing.ok).toBe(false);
      if (!trailing.ok) expect(trailing.error).toBe(`${flag} requires a value`);
    }
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
    expect(WATCHER_EXIT.usage).toBe(CLI_EXIT.usage);
    expect(WATCHER_EXIT.fatal).toBe(CLI_EXIT.fatal);
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

  test("the usage string is generated from the option table: every flag, its default, and the exit codes", () => {
    for (const flag of ["--flow-id", "--run-id", "--events", "--flow-run-id", "--deadline-minutes", "--poll-seconds", "--catch-up-seconds"]) {
      expect(WATCHER_USAGE).toContain(flag);
    }
    expect(WATCHER_USAGE).toContain("usage: watch-queue-verify --flow-id <id>");
    expect(WATCHER_USAGE).toContain("default: 30");
    expect(WATCHER_USAGE).toContain("default: 60");
    expect(WATCHER_USAGE).toContain(`default: ${DEFAULT_KILL_EVENTS_PATH}`);
    for (const [name, code] of Object.entries(WATCHER_EXIT)) {
      expect(WATCHER_USAGE, `exit ${name}`).toContain(`${code} `);
    }
  });
});

describe("C34(4,5): the script itself exits 64 on a usage error, before arming anything", () => {
  async function runScript(...args: string[]) {
    const proc = Bun.spawn([process.execPath, "run", WATCH_SCRIPT, ...args], {
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

  test("a trailing flag and a flag-as-value both exit 64 with the flag named", async () => {
    const trailing = await runScript("--flow-id", "f", "--poll-seconds");
    expect(trailing.code).toBe(64);
    expect(trailing.stderr).toContain("--poll-seconds requires a value");
    const swallowed = await runScript("--flow-id", "--poll-seconds", "5");
    expect(swallowed.code).toBe(64);
    expect(swallowed.stderr).toContain("--flow-id requires a value");
  });

  test("--help prints the generated usage on stdout and exits 0 without arming anything", async () => {
    const r = await runScript("--help");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(WATCHER_USAGE);
    expect(r.stdout).not.toContain("watcher start");
    expect(r.stderr).toBe("");
  });
});

describe("--flag=value escape hatch, empty and repeated values (shared layer rules, watcher table)", () => {
  test("a value that starts with -- is accepted in --flag=value form (and only there)", () => {
    const eq = parse("--flow-id", "f", "--run-id=--smoke");
    expect(eq.ok && eq.options.runId).toBe("--smoke");
    expect(parse("--flow-id", "f", "--run-id", "--smoke").ok).toBe(false);
  });

  test("an empty value (--events=, --events '') is a usage error, not a path that fails inside the kill window", () => {
    expect(parse("--flow-id", "f", "--events=").ok).toBe(false);
    expect(parse("--flow-id", "f", "--events", "").ok).toBe(false);
    expect(parse("--flow-id", "f", "--run-id", "  ").ok).toBe(false);
    const flowRun = parse("--flow-id", "f", "--flow-run-id=");
    expect(flowRun.ok).toBe(false);
    if (!flowRun.ok) expect(flowRun.error).toContain("non-empty");
  });

  test("a repeated flag is rejected instead of silently overwriting the earlier value", () => {
    const repeated = parse("--flow-id", "a", "--flow-id", "b");
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.error).toContain("--flow-id was given more than once");
    expect(parse("--flow-id=a", "--flow-id", "b").ok).toBe(false); // mixed spellings too
  });
});
