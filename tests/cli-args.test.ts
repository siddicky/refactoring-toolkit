/**
 * C69 — the shared CLI layer (src/cli/args.ts).
 *
 * Old behaviour, per script copy of the scanner: a value that was another flag
 * was swallowed, a trailing flag produced undefined and then NaN, enum-like
 * flags coerced silently, and a usage error exited 1 in one script and 2 in
 * another. These tests pin the shared rules once; each script's own parse
 * tests (watcher-cli-args, chaos-kill, render-metrics, run-demo-cli,
 * jev-spot-check-args, serve-status-args) pin its table.
 */

import { describe, expect, test } from "bun:test";

import {
  CLI_EXIT,
  commandUsageText,
  defineCli,
  defineProgram,
  exitCodesNote,
  flagName,
  parseCommand,
  parseOptions,
  programUsageText,
  reportParseFailure,
  usageText,
} from "../src/cli/args.js";

const tool = defineCli({
  name: "tool.ts",
  summary: "Does the thing.",
  options: {
    flowId: { kind: "string", metavar: "id", required: true, description: "flow to act on" },
    label: { kind: "string", default: "none", description: "free text" },
    waitMs: { kind: "int", default: 5000, description: "wait" },
    port: { kind: "int", min: 1, max: 65535, description: "port" },
    minutes: { kind: "number", greaterThan: 0, default: 30, description: "bound" },
    mode: { kind: "enum", choices: ["fast", "slow"], default: "fast", description: "speed" },
    pids: { kind: "int-list", min: 2, metavar: "pid[,pid...]", description: "targets" },
    dry: { kind: "flag", description: "dry run" },
  },
  notes: ["Exit codes: 0 ok, 64 usage."],
});

const parse = (...argv: string[]) => parseOptions(tool, argv);

function ok(...argv: string[]) {
  const parsed = parse(...argv);
  if (!parsed.ok) throw new Error(`expected ok, got: ${parsed.error}`);
  return parsed.options;
}

function failure(...argv: string[]) {
  const parsed = parse(...argv);
  if (parsed.ok) throw new Error("expected a failure");
  return parsed;
}

describe("valid input", () => {
  test("defaults fill every optional option that has one; options without a default are absent", () => {
    expect(ok("--flow-id", "f")).toEqual({
      flowId: "f",
      label: "none",
      waitMs: 5000,
      minutes: 30,
      mode: "fast",
      dry: false,
    });
  });

  test("--flag value and --flag=value are equivalent, and = keeps later = signs in the value", () => {
    expect(ok("--flow-id", "a=b").flowId).toBe("a=b");
    expect(ok("--flow-id=a=b").flowId).toBe("a=b");
    const o = ok("--flow-id=f", "--port", "8080", "--minutes=0.5", "--mode", "slow", "--pids=3,4", "--dry");
    expect(o).toMatchObject({ flowId: "f", port: 8080, minutes: 0.5, mode: "slow", pids: [3, 4], dry: true });
  });

  test("a value that starts with -- is accepted in --flag=value form only", () => {
    expect(ok("--flow-id=--smoke").flowId).toBe("--smoke");
    expect(failure("--flow-id", "--smoke").error).toContain("--flow-id requires a value");
  });

  test("a flag repeated is fine (idempotent); the flag name is the kebab-case of the key", () => {
    expect(ok("--flow-id", "f", "--dry", "--dry").dry).toBe(true);
    expect(flagName("catchUpSeconds")).toBe("--catch-up-seconds");
    expect(flagName("pids")).toBe("--pids");
  });
});

describe("missing value and trailing flag", () => {
  test("a value flag with nothing after it is a usage error naming the flag", () => {
    expect(failure("--flow-id").error).toBe("--flow-id requires a value");
    expect(failure("--flow-id", "f", "--label").error).toBe("--label requires a value");
    expect(failure("--flow-id", "f", "--port").error).toBe("--port requires a value");
  });

  test("a required option that is absent is reported by name", () => {
    expect(failure().error).toBe("--flow-id is required");
    expect(failure("--label", "x").error).toBe("--flow-id is required");
  });

  test("an empty or blank value is rejected for every kind, in both spellings", () => {
    for (const argv of [
      ["--flow-id="],
      ["--flow-id", ""],
      ["--flow-id", "  "],
      ["--flow-id", "f", "--label="],
      ["--flow-id", "f", "--port="],
      ["--flow-id", "f", "--mode", ""],
      ["--flow-id", "f", "--pids="],
    ]) {
      expect(failure(...argv).error, JSON.stringify(argv)).toContain("requires a non-empty value");
    }
  });
});

describe("flag as value", () => {
  test("a flag where a value belongs is not swallowed as the value", () => {
    const f = failure("--flow-id", "--label", "x");
    expect(f.error).toContain("--flow-id requires a value");
    expect(f.error).toContain("write --flow-id=<value>"); // how to pass a value that starts with "-"
    expect(f.help).toBe(false);
  });

  test("a single-dash token is not a value either, so a negative number needs the = form and is then range-checked", () => {
    expect(failure("--flow-id", "f", "--port", "-5").error).toContain("--port requires a value");
    expect(failure("--flow-id", "f", "--port=-5").error).toBe("--port must be a whole number between 1 and 65535, got \"-5\"");
  });

  test("a boolean flag takes no value", () => {
    expect(failure("--flow-id", "f", "--dry=1").error).toBe("--dry does not take a value");
  });
});

describe("bad enum", () => {
  test("a value outside the choices is rejected with the choices listed", () => {
    expect(failure("--flow-id", "f", "--mode", "medium").error).toBe(
      '--mode must be one of fast, slow, got "medium"',
    );
  });

  test("enum matching is exact (no case folding, no prefix match)", () => {
    expect(failure("--flow-id", "f", "--mode", "FAST").ok).toBe(false);
    expect(failure("--flow-id", "f", "--mode", "fas").ok).toBe(false);
  });
});

describe("NaN and malformed numbers", () => {
  for (const bad of ["abc", "NaN", "Infinity", "-1", "+1", "1.5", "1e3", "0x10", "5s", " "]) {
    test(`int ${JSON.stringify(bad)} is rejected`, () => {
      const f = failure("--flow-id", "f", `--wait-ms=${bad}`);
      expect(f.ok).toBe(false);
      expect(f.error).toContain("--wait-ms");
    });
  }

  for (const bad of ["abc", "NaN", "Infinity", "-5", "0", "0.0", "1e3", ".5", "5."]) {
    test(`number ${JSON.stringify(bad)} is rejected (finite decimal > 0 only)`, () => {
      const f = failure("--flow-id", "f", `--minutes=${bad}`);
      expect(f.error).toContain("--minutes");
    });
  }

  test("int bounds are inclusive on both ends; 0 is a valid --wait-ms but not a valid --port", () => {
    expect(ok("--flow-id", "f", "--wait-ms", "0").waitMs).toBe(0);
    expect(failure("--flow-id", "f", "--port", "0").ok).toBe(false);
    expect(ok("--flow-id", "f", "--port", "65535").port).toBe(65535);
    expect(failure("--flow-id", "f", "--port", "65536").ok).toBe(false);
  });

  test("an unsafe integer is rejected instead of rounding", () => {
    expect(failure("--flow-id", "f", "--wait-ms", "99999999999999999999").ok).toBe(false);
  });

  test("int-list: every entry is checked and the bad ones are named (nothing is dropped silently)", () => {
    for (const bad of ["123,abc", "123,1", "123,,456", "12.5", "0x1f", "123 456", "-5"]) {
      const f = failure("--flow-id", "f", `--pids=${bad}`);
      expect(f.error, bad).toContain("invalid --pids");
    }
    expect(failure("--flow-id", "f", "--pids=2,x,,y").error).toBe(
      "invalid --pids entries (need whole numbers >= 2): x, <empty>, y",
    );
    expect(ok("--flow-id", "f", "--pids", " 3 , 4 ").pids).toEqual([3, 4]);
  });

  test("every bad value is reported in one message", () => {
    const f = failure("--flow-id", "f", "--wait-ms", "x", "--minutes", "0", "--mode", "z");
    expect(f.error.split("\n")).toHaveLength(3);
  });
});

describe("unknown flags, stray positionals, repeats", () => {
  test("an unknown flag (a typo) is an error, never ignored", () => {
    expect(failure("--flow-id", "f", "--wait-m", "1").error).toBe("unknown argument: --wait-m");
    expect(failure("--flow-id", "f", "-x").error).toBe("unknown argument: -x");
  });

  test("a stray positional is an error", () => {
    expect(failure("--flow-id", "f", "stray").error).toBe("unexpected argument: stray");
  });

  test("a repeated value flag is rejected, in either spelling", () => {
    expect(failure("--flow-id", "a", "--flow-id", "b").error).toBe("--flow-id was given more than once");
    expect(failure("--flow-id=a", "--flow-id", "b").error).toBe("--flow-id was given more than once");
    expect(failure("--flow-id", "f", "--pids", "3", "--pids", "4").ok).toBe(false);
  });
});

describe("help", () => {
  test("--help and -h return the generated usage, not an error", () => {
    for (const flag of ["--help", "-h"]) {
      const f = failure(flag);
      expect(f.help).toBe(true);
      expect(f.usage).toBe(usageText(tool));
    }
  });

  test("help wins over a typo or a missing required option", () => {
    expect(failure("--bogus", "--help").help).toBe(true);
    expect(failure("--help").error).toBe("");
  });

  test("a --help after the -- terminator is a positional, not a help request", () => {
    const f = failure("--flow-id", "f", "--", "--help");
    expect(f.help).toBe(false);
    expect(f.error).toBe("unexpected argument: --help");
  });

  test("reportParseFailure: help prints usage to stdout and exits 0; an error prints to stderr and exits 64", () => {
    const out: string[] = [];
    const err: string[] = [];
    const io = { out: (l: string) => void out.push(l), err: (l: string) => void err.push(l) };
    expect(reportParseFailure("tool.ts", failure("--help"), io)).toBe(0);
    expect(out).toEqual([usageText(tool)]);
    expect(err).toEqual([]);

    expect(reportParseFailure("tool.ts", failure("--flow-id"), io)).toBe(CLI_EXIT.usage);
    expect(CLI_EXIT.usage).toBe(64);
    expect(err).toHaveLength(1);
    expect(err[0]).toStartWith("[tool] --flow-id requires a value\nusage: tool.ts ");
  });
});

describe("usage text is generated from the table", () => {
  const text = usageText(tool);

  test("the synopsis marks required options bare and optional ones bracketed", () => {
    expect(text).toContain("usage: tool.ts --flow-id <id> [--label <value>]");
    expect(text).toContain("[--mode fast|slow]");
    expect(text).toContain("[--pids <pid[,pid...]>]");
    expect(text).toContain("[--dry]");
  });

  test("every option appears with its constraint and default, plus -h/--help", () => {
    expect(text).toMatch(/--flow-id <id> +flow to act on \(required\)/);
    expect(text).toMatch(/--wait-ms <n> +wait \(whole number >= 0; default: 5000\)/);
    expect(text).toMatch(/--port <n> +port \(whole number between 1 and 65535\)/);
    expect(text).toMatch(/--minutes <n> +bound \(number > 0; default: 30\)/);
    expect(text).toMatch(/--mode fast\|slow +speed \(default: fast\)/);
    expect(text).toMatch(/--pids <pid\[,pid\.\.\.\]> +targets \(comma-separated whole numbers >= 2\)/);
    expect(text).toMatch(/-h, --help +show this help and exit/);
  });

  test("summary and notes are included; a long synopsis wraps instead of running off the line", () => {
    expect(text).toContain("Does the thing.");
    expect(text.trimEnd().endsWith("Exit codes: 0 ok, 64 usage.")).toBe(true);
    const synopsis = text.split("\n\n")[0] as string;
    for (const line of synopsis.split("\n")) expect(line.length).toBeLessThanOrEqual(100);
    expect(synopsis.split("\n").length).toBeGreaterThan(1);
  });

  test("changing the table changes the usage (nothing is hand-written)", () => {
    const other = defineCli({
      name: "x",
      summary: "s",
      options: { retries: { kind: "int", min: 1, default: 3, description: "retry count" } },
    });
    expect(usageText(other)).toContain("--retries <n>");
    expect(usageText(other)).not.toContain("--flow-id");
  });
});

describe("exitCodesNote", () => {
  test("lists the script's own exit-code table in numeric order, one meaning per code", () => {
    const table = { later: 70, ok: 0, usage: 64, mid: 3 } as const;
    expect(exitCodesNote(table, { later: "fatal", ok: "fine", usage: "bad usage", mid: "no-op" })).toBe(
      "exit codes: 0 fine; 3 no-op; 64 bad usage; 70 fatal",
    );
  });

  test("a long table wraps instead of running off the line", () => {
    const table = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`c${i}`, i])) as Record<string, number>;
    const meanings = Object.fromEntries(Object.keys(table).map((k) => [k, `meaning of ${k} in words`]));
    const note = exitCodesNote(table, meanings);
    for (const line of note.split("\n")) expect(line.length).toBeLessThanOrEqual(100);
    expect(note.split("\n").length).toBeGreaterThan(1);
  });
});

describe("table validation (a malformed table throws when the script loads)", () => {
  const bad = (options: Record<string, unknown>) => () =>
    defineCli({ name: "t", summary: "s", options: options as never });

  test("rejects a bad key, a --help collision, a duplicate flag, a blank description", () => {
    expect(bad({ "Flow-Id": { kind: "flag", description: "d" } })).toThrow("camelCase");
    expect(bad({ help: { kind: "flag", description: "d" } })).toThrow("--help");
    expect(bad({ a: { kind: "flag", description: " " } })).toThrow("description");
  });

  test("rejects required+default, an enum default outside its choices, and out-of-range defaults", () => {
    expect(bad({ a: { kind: "string", required: true, default: "x", description: "d" } })).toThrow("required");
    expect(bad({ a: { kind: "enum", choices: ["x"], default: "y", description: "d" } })).toThrow("choices");
    expect(bad({ a: { kind: "enum", choices: [], description: "d" } })).toThrow("no choices");
    expect(bad({ a: { kind: "int", min: 5, default: 1, description: "d" } })).toThrow("outside its range");
    expect(bad({ a: { kind: "int", min: 5, max: 1, description: "d" } })).toThrow("max < min");
    expect(bad({ a: { kind: "int", min: -1, description: "d" } })).toThrow("negative min");
    expect(bad({ a: { kind: "int-list", min: -1, description: "d" } })).toThrow("negative min");
    expect(bad({ a: { kind: "number", greaterThan: 0, default: 0, description: "d" } })).toThrow("not > 0");
  });
});

describe("type inference (compile-time, enforced by `bun run typecheck`)", () => {
  test("required/default/flag options are present, the rest optional, enums are literal unions", () => {
    const o = ok("--flow-id", "f");
    const id: string = o.flowId;
    const wait: number = o.waitMs;
    const mode: "fast" | "slow" = o.mode;
    const dry: boolean = o.dry;
    const port: number | undefined = o.port;
    const pids: number[] | undefined = o.pids;
    // @ts-expect-error a required-or-defaulted option is never undefined
    const maybe: undefined = o.flowId;
    expect([id, wait, mode, dry, port, pids, maybe]).toBeDefined();
  });
});

describe("subcommands", () => {
  const program = defineProgram({
    name: "multi.ts",
    summary: "Runs things.",
    commands: {
      go: {
        summary: "Go somewhere.",
        options: {
          where: { kind: "string", required: true, description: "destination" },
          times: { kind: "int", min: 1, default: 1, description: "repeat count" },
        },
      },
      stop: { summary: "Stop everything.", options: {} },
    },
    notes: ["Exit codes: 0 ok, 64 usage."],
  });

  test("the first argument selects the command and the rest is parsed against ITS table", () => {
    const parsed = parseCommand(program, ["go", "--where", "home", "--times", "3"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.command === "go") {
      const where: string = parsed.options.where;
      const times: number = parsed.options.times;
      expect([where, times]).toEqual(["home", 3]);
    }
    const stop = parseCommand(program, ["stop"]);
    expect(stop.ok && stop.command).toBe("stop");
  });

  test("a flag that belongs to another command is unknown here", () => {
    const parsed = parseCommand(program, ["stop", "--where", "home"]);
    expect(!parsed.ok && parsed.error).toBe("unknown argument: --where");
    expect(!parsed.ok && parsed.usage).toContain("usage: multi.ts stop");
  });

  test("missing, unknown and misplaced commands are usage errors that print the command list", () => {
    for (const [argv, error] of [
      [[], "missing command"],
      [["fly"], "unknown command: fly"],
      [["--where", "home", "go"], "expected a command before options, got --where"],
      [["toString"], "unknown command: toString"],
    ] as const) {
      const parsed = parseCommand(program, argv);
      expect(parsed.ok, JSON.stringify(argv)).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.error).toBe(error);
      expect(parsed.usage).toBe(programUsageText(program));
    }
  });

  test("missing-value, flag-as-value, bad int and trailing flag behave as in a single-command script", () => {
    expect(parseCommand(program, ["go"]).ok).toBe(false);
    const swallowed = parseCommand(program, ["go", "--where", "--times", "2"]);
    expect(!swallowed.ok && swallowed.error).toContain("--where requires a value");
    const nan = parseCommand(program, ["go", "--where", "h", "--times", "abc"]);
    expect(!nan.ok && nan.error).toContain("--times must be a whole number >= 1");
    const trailing = parseCommand(program, ["go", "--where", "h", "--times"]);
    expect(!trailing.ok && trailing.error).toBe("--times requires a value");
  });

  test("--help works at the top level and per command", () => {
    const top = parseCommand(program, ["--help"]);
    expect(!top.ok && top.help).toBe(true);
    const per = parseCommand(program, ["go", "--help"]);
    expect(!per.ok && per.help).toBe(true);
    expect(!per.ok && per.usage).toBe(commandUsageText(program, "go"));
  });

  test("command usage lists that command's options; the top level lists the commands", () => {
    const go = commandUsageText(program, "go");
    expect(go).toContain("usage: multi.ts go --where <value> [--times <n>]");
    expect(go).toContain("repeat count (whole number >= 1; default: 1)");
    expect(go).toContain("Go somewhere.");
    expect(go).not.toContain("Stop everything.");
    const top = programUsageText(program);
    expect(top).toContain("usage: multi.ts <go|stop> [options]");
    expect(top).toMatch(/go +Go somewhere\./);
    expect(top).toMatch(/stop +Stop everything\./);
    expect(top).toContain("multi.ts <command> --help");
  });
});
