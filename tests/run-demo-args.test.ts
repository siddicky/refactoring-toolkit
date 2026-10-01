/**
 * C69 — run-demo's command line, one table per subcommand.
 *
 * Before: `argValue(flag, fallback)` was `argv.indexOf(flag)` plus
 * `argv[i + 1]`. A value that was another flag was swallowed, a trailing flag
 * yielded undefined (so `parseInt` produced NaN: `wait-flow --id f
 * --wait-minutes abc` waited with a NaN deadline), `--dispatch`, `--harness`
 * and `--flows` coerced silently (`--flows prot` ran the probe flows), the
 * header documented a `--fault` flag that was never parsed, and a usage error
 * exited 1 or 2 depending on the code path. These tests pin the new behaviour
 * per command: valid, missing value, flag as value, trailing flag, bad enum,
 * NaN. (Subprocess tests at the bottom pin the exit codes.)
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { GATE_FLOW_ID_OPTION } from "../scripts/dispatch-gate.js";
import { PROBE_LONG_STEP_OPTIONS, PROBE_ROUND_OPTIONS } from "../scripts/probe-flow.js";
import { RUN_DEMO_CLI, RUN_DEMO_EXIT, parseRunDemoArgs } from "../scripts/run-demo.js";
import { CLI_EXIT, commandUsageText, programUsageText } from "../src/cli/args.js";
import { parseHarnessChoice } from "../src/harness/select.js";
import { REPO_ROOT } from "./support/paths.js";

const RUN_DEMO = join(REPO_ROOT, "scripts", "run-demo.ts");

type Parsed = ReturnType<typeof parseRunDemoArgs>;

type Command = "worker" | "hello" | "long-step" | "wait-flow" | "round" | "recover" | "recover-port" | "gate" | "demo";
type OptionsOf<C extends Command> = Extract<Parsed, { ok: true; command: C }>["options"];

function okOf<C extends Command>(command: C, ...flags: string[]): OptionsOf<C> {
  const parsed = parseRunDemoArgs([command, ...flags]);
  if (!parsed.ok) throw new Error(`${command} ${flags.join(" ")}: ${parsed.error}`);
  if (parsed.command !== command) throw new Error(`parsed as ${parsed.command}`);
  return parsed.options as never;
}

function errorOf(argv: readonly string[]): string {
  const parsed = parseRunDemoArgs(argv);
  if (parsed.ok) throw new Error(`expected a usage error for: ${argv.join(" ")}`);
  return parsed.error;
}

describe("demo", () => {
  test("valid: the documented README command, with the documented defaults for everything else", () => {
    const o = okOf(
      "demo",
      "--dir", "/abs/output", "--source-root", "/abs/src", "--prep", "/abs/output/PORTING.md",
      "--files", "src/Billing/Invoice.php,tests/Billing/InvoiceTest.php",
      "--flow-id", "migration-unique-id", "--max-rounds", "2", "--wait-minutes", "30",
    );
    expect(o).toMatchObject({
      dir: "/abs/output",
      sourceRoot: "/abs/src",
      prep: "/abs/output/PORTING.md",
      files: "src/Billing/Invoice.php,tests/Billing/InvoiceTest.php",
      flowId: "migration-unique-id",
      maxRounds: 2,
      waitMinutes: 30,
      epoch: 1,
      dispatch: "parallel",
      startOnly: false,
      initFixture: false,
      dashboard: false,
    });
    expect(o.gateFlowId).toBeUndefined();
  });

  test("valid: switches, --flag=value, the creatorex form", () => {
    const o = okOf("demo", "--dir=/p", "--files=creatorex", "--dispatch=sequential", "--start-only", "--init-fixture", "--dashboard", "--gate-flow-id", "prev-1");
    expect(o).toMatchObject({ files: "creatorex", dispatch: "sequential", startOnly: true, initFixture: true, dashboard: true, gateFlowId: "prev-1" });
  });

  test("missing value / trailing flag", () => {
    expect(errorOf(["demo"])).toBe("--dir is required");
    expect(errorOf(["demo", "--dir"])).toBe("--dir requires a value");
    expect(errorOf(["demo", "--dir", "/p", "--wait-minutes"])).toBe("--wait-minutes requires a value");
    expect(errorOf(["demo", "--dir", "/p", "--flow-id"])).toBe("--flow-id requires a value");
  });

  test("flag as value: the next flag is never swallowed", () => {
    expect(errorOf(["demo", "--dir", "--init-fixture"])).toContain("--dir requires a value");
    expect(errorOf(["demo", "--dir", "/p", "--files", "--start-only"])).toContain("--files requires a value");
    expect(errorOf(["demo", "--dir", "/p", "--epoch", "--max-rounds", "2"])).toContain("--epoch requires a value");
  });

  test("bad enum: --dispatch outside parallel|sequential is rejected (it used to throw after the parse)", () => {
    expect(errorOf(["demo", "--dir", "/p", "--dispatch", "weird"])).toBe(
      '--dispatch must be one of parallel, sequential, got "weird"',
    );
    expect(errorOf(["demo", "--dir", "/p", "--dispatch", "Parallel"])).toContain("--dispatch must be one of");
  });

  test("NaN and out-of-range numbers for --epoch, --max-rounds, --wait-minutes", () => {
    for (const flag of ["--epoch", "--max-rounds", "--wait-minutes"]) {
      for (const bad of ["abc", "NaN", "0", "-1", "1.5", "1e3", "Infinity"]) {
        expect(errorOf(["demo", "--dir", "/p", `${flag}=${bad}`]), `${flag}=${bad}`).toContain(
          `${flag} must be a whole number >= 1`,
        );
      }
    }
  });

  test("a flag from another command is unknown here (strict): worker flags on demo, and --harness", () => {
    expect(errorOf(["demo", "--dir", "/p", "--harness", "stub"])).toBe("unknown argument: --harness");
    expect(errorOf(["demo", "--dir", "/p", "--flows", "port"])).toBe("unknown argument: --flows");
    expect(errorOf(["demo", "--dir", "/p", "--fault", "x"])).toBe("unknown argument: --fault");
  });

  test("a repeated value flag is rejected (the first occurrence used to win silently)", () => {
    expect(errorOf(["demo", "--dir", "/a", "--dir", "/b"])).toBe("--dir was given more than once");
  });
});

describe("worker", () => {
  test("valid: the documented README command; --harness and --flows default to auto and probe", () => {
    expect(okOf("worker", "--flows", "port", "--harness", "opencode")).toEqual({ harness: "opencode", flows: "port" });
    expect(okOf("worker")).toEqual({ harness: "auto", flows: "probe" });
  });

  test("--fault is a real flag now (the old header documented it but nothing parsed it)", () => {
    expect(okOf("worker", "--fault", "commit:post-commit:src/a.php#1").fault).toBe("commit:post-commit:src/a.php#1");
    expect(okOf("worker").fault).toBeUndefined(); // the worker then falls back to $PORTING_KIT_FAULT
    expect(errorOf(["worker", "--fault"])).toBe("--fault requires a value");
  });

  test("bad enum: --harness and --flows outside their choices are rejected, not coerced to auto/probe", () => {
    expect(errorOf(["worker", "--harness", "opencoed"])).toBe('--harness must be one of stub, opencode, auto, got "opencoed"');
    expect(errorOf(["worker", "--flows", "prot"])).toBe('--flows must be one of probe, port, got "prot"');
    expect(errorOf(["worker", "--harness="])).toBe("--harness requires a non-empty value");
  });

  test("missing value / flag as value / trailing flag", () => {
    expect(errorOf(["worker", "--harness"])).toBe("--harness requires a value");
    expect(errorOf(["worker", "--harness", "--flows", "port"])).toContain("--harness requires a value");
    expect(errorOf(["worker", "--flows", "port", "--harness"])).toBe("--harness requires a value");
  });

  test("every choice of --harness is one select.ts accepts (the table cannot list a value the selector rejects)", () => {
    const choices = RUN_DEMO_CLI.commands.worker.options.harness.choices;
    for (const choice of choices) expect(parseHarnessChoice(choice)).toBe(choice);
    expect([...choices].sort()).toEqual(["auto", "opencode", "stub"]);
  });

  test("no demo-only flags: --dir is unknown to the worker (it used to be ignored)", () => {
    expect(errorOf(["worker", "--dir", "/p"])).toBe("unknown argument: --dir");
  });
});

describe("hello", () => {
  test("valid / missing value / flag as value / unknown", () => {
    expect(okOf("hello").flowId).toBeUndefined(); // generated: hello-<epoch ms>
    expect(okOf("hello", "--flow-id", "h1").flowId).toBe("h1");
    expect(errorOf(["hello", "--flow-id"])).toBe("--flow-id requires a value");
    expect(errorOf(["hello", "--flow-id", "--x"])).toContain("--flow-id requires a value");
    expect(errorOf(["hello", "--id", "x"])).toBe("unknown argument: --id");
  });
});

describe("long-step", () => {
  test("valid: documented defaults (90000 ms, flow id long-1) and explicit values", () => {
    expect(okOf("long-step")).toEqual({ ms: 90_000, flowId: "long-1", startOnly: false });
    expect(okOf("long-step", "--ms", "120000", "--flow-id", "lk", "--start-only")).toEqual({
      ms: 120_000,
      flowId: "lk",
      startOnly: true,
    });
  });

  test("NaN / negative / fractional / beyond the timer limit are rejected (a NaN ms used to start a step that never slept)", () => {
    for (const bad of ["abc", "NaN", "-5", "1.5", "1e3"]) {
      expect(errorOf(["long-step", `--ms=${bad}`]), bad).toContain("--ms must be a whole number between 0 and 2147483647");
    }
    expect(errorOf(["long-step", "--ms=2147483648"])).toBe(
      '--ms must be a whole number between 0 and 2147483647, got "2147483648"',
    );
    expect(okOf("long-step", "--ms", "0").ms).toBe(0);
  });

  test("missing value / flag as value / trailing flag", () => {
    expect(errorOf(["long-step", "--ms"])).toBe("--ms requires a value");
    expect(errorOf(["long-step", "--ms", "--start-only"])).toContain("--ms requires a value");
    expect(errorOf(["long-step", "--flow-id", "x", "--ms"])).toBe("--ms requires a value");
  });

  test("the option comes from probe-flow.ts (one definition of the default and bound)", () => {
    expect(RUN_DEMO_CLI.commands["long-step"].options.ms).toBe(PROBE_LONG_STEP_OPTIONS.ms);
  });
});

describe("wait-flow", () => {
  test("valid: --id is required, --wait-minutes defaults to 30", () => {
    expect(okOf("wait-flow", "--id", "f1")).toEqual({ id: "f1", waitMinutes: 30 });
    expect(okOf("wait-flow", "--id=f1", "--wait-minutes", "5")).toEqual({ id: "f1", waitMinutes: 5 });
  });

  test("missing value / flag as value / trailing flag", () => {
    expect(errorOf(["wait-flow"])).toBe("--id is required");
    expect(errorOf(["wait-flow", "--id"])).toBe("--id requires a value");
    expect(errorOf(["wait-flow", "--id", "--wait-minutes", "5"])).toContain("--id requires a value");
    expect(errorOf(["wait-flow", "--id", "f", "--wait-minutes"])).toBe("--wait-minutes requires a value");
  });

  test("NaN --wait-minutes is rejected (it used to give waitForFlowTerminal a deadline that never expired)", () => {
    for (const bad of ["abc", "NaN", "0", "-3", "2.5"]) {
      expect(errorOf(["wait-flow", "--id", "f", `--wait-minutes=${bad}`]), bad).toContain(
        "--wait-minutes must be a whole number >= 1",
      );
    }
  });
});

describe("round", () => {
  test("valid: documented defaults (src/a.php, round 1, epoch 1) and explicit values", () => {
    expect(okOf("round", "--dir", "/r")).toEqual({
      dir: "/r",
      initFixture: false,
      file: "src/a.php",
      round: 1,
      epoch: 1,
    });
    expect(okOf("round", "--dir", "/r", "--file", "src/b.php", "--round", "3", "--epoch", "2", "--init-fixture")).toEqual({
      dir: "/r",
      initFixture: true,
      file: "src/b.php",
      round: 3,
      epoch: 2,
    });
  });

  test("missing value / flag as value / trailing flag", () => {
    expect(errorOf(["round"])).toBe("--dir is required");
    expect(errorOf(["round", "--dir", "/r", "--file"])).toBe("--file requires a value");
    expect(errorOf(["round", "--dir", "--init-fixture"])).toContain("--dir requires a value");
    expect(errorOf(["round", "--dir", "/r", "--round", "--epoch", "1"])).toContain("--round requires a value");
  });

  test("NaN --round / --epoch are rejected (parseInt of garbage used to build the op-ID '<file>#NaN')", () => {
    for (const flag of ["--round", "--epoch"]) {
      for (const bad of ["abc", "NaN", "0", "-1", "1.5"]) {
        expect(errorOf(["round", "--dir", "/r", `${flag}=${bad}`]), `${flag}=${bad}`).toContain(
          `${flag} must be a whole number >= 1`,
        );
      }
    }
  });

  test("the file/round/epoch options come from probe-flow.ts", () => {
    const options = RUN_DEMO_CLI.commands.round.options;
    expect(options.file).toBe(PROBE_ROUND_OPTIONS.file);
    expect(options.round).toBe(PROBE_ROUND_OPTIONS.round);
    expect(options.epoch).toBe(PROBE_ROUND_OPTIONS.epoch);
  });
});

describe("recover", () => {
  test("valid: --dir required, --epoch defaults to 2", () => {
    expect(okOf("recover", "--dir", "/r")).toEqual({ dir: "/r", epoch: 2 });
    expect(okOf("recover", "--dir", "/r", "--epoch", "5")).toEqual({ dir: "/r", epoch: 5 });
  });

  test("missing value / flag as value / trailing flag / NaN", () => {
    expect(errorOf(["recover"])).toBe("--dir is required");
    expect(errorOf(["recover", "--dir", "--epoch", "3"])).toContain("--dir requires a value");
    expect(errorOf(["recover", "--dir", "/r", "--epoch"])).toBe("--epoch requires a value");
    expect(errorOf(["recover", "--dir", "/r", "--epoch", "two"])).toBe('--epoch must be a whole number >= 1, got "two"');
  });
});

describe("recover-port", () => {
  test("valid: the documented README form", () => {
    const o = okOf("recover-port", "--dir", "/r", "--epoch", "3", "--files", "src/A.php,src/B.php");
    expect(o).toMatchObject({ dir: "/r", epoch: 3, files: "src/A.php,src/B.php", harness: "auto" });
    expect(o.sourceRoot).toBeUndefined();
    expect(o.prep).toBeUndefined();
    expect(o.flowId).toBeUndefined();
    expect(o.maxRounds).toBeUndefined();
  });

  test("the flags echoed into the printed demo command are all accepted, --max-rounds as a typed number", () => {
    const o = okOf(
      "recover-port",
      "--dir", "/r", "--files", "src/A.php", "--source-root", "/src", "--prep", "/p.md", "--flow-id", "new-1", "--max-rounds", "2", "--harness", "opencode",
    );
    expect(o).toMatchObject({ sourceRoot: "/src", prep: "/p.md", flowId: "new-1", maxRounds: 2, harness: "opencode" });
  });

  test("missing value / flag as value / trailing flag", () => {
    expect(errorOf(["recover-port"])).toBe("--dir is required\n--files is required");
    expect(errorOf(["recover-port", "--dir", "/r"])).toBe("--files is required");
    expect(errorOf(["recover-port", "--dir", "/r", "--files"])).toBe("--files requires a value");
    expect(errorOf(["recover-port", "--dir", "/r", "--prep", "--files", "x"])).toContain("--prep requires a value");
  });

  test("bad enum and NaN", () => {
    expect(errorOf(["recover-port", "--dir", "/r", "--files", "x", "--harness", "real"])).toContain("--harness must be one of stub, opencode, auto");
    expect(errorOf(["recover-port", "--dir", "/r", "--files", "x", "--epoch", "abc"])).toContain("--epoch must be a whole number >= 1");
    expect(errorOf(["recover-port", "--dir", "/r", "--files", "x", "--max-rounds", "many"])).toContain("--max-rounds must be a whole number >= 1");
  });
});

describe("gate", () => {
  test("valid: --flow-id is optional (the gate is fail-open: no id reports degraded)", () => {
    expect(okOf("gate", "--flow-id", "f1").flowId).toBe("f1");
    expect(okOf("gate").flowId).toBeUndefined();
  });

  test("missing value / flag as value / trailing flag", () => {
    expect(errorOf(["gate", "--flow-id"])).toBe("--flow-id requires a value");
    expect(errorOf(["gate", "--flow-id", "--x"])).toContain("--flow-id requires a value");
    expect(errorOf(["gate", "--flow-id="])).toBe("--flow-id requires a non-empty value");
  });

  test("the option is the one dispatch-gate.ts declares, shared with demo --gate-flow-id", () => {
    expect(RUN_DEMO_CLI.commands.gate.options.flowId).toBe(GATE_FLOW_ID_OPTION);
    expect(RUN_DEMO_CLI.commands.demo.options.gateFlowId).toBe(GATE_FLOW_ID_OPTION);
  });
});

describe("commands without options", () => {
  test("agent-roundtrip and git-selftest accept no arguments", () => {
    for (const command of ["agent-roundtrip", "git-selftest"]) {
      const ok = parseRunDemoArgs([command]);
      expect(ok.ok && (ok.command as string)).toBe(command);
      expect(errorOf([command, "--dir", "/x"])).toBe("unknown argument: --dir");
      expect(errorOf([command, "extra"])).toBe("unexpected argument: extra");
    }
  });
});

describe("command selection", () => {
  test("no command, an unknown command, options before the command, and prototype names are usage errors", () => {
    expect(errorOf([])).toBe("missing command");
    expect(errorOf(["wait"])).toBe("unknown command: wait");
    expect(errorOf(["--dir", "/p", "demo"])).toBe("expected a command before options, got --dir");
    expect(errorOf(["constructor"])).toBe("unknown command: constructor");
  });

  test("every command the old usage line listed still exists", () => {
    const old = ["worker", "hello", "long-step", "wait-flow", "round", "recover", "recover-port", "agent-roundtrip", "git-selftest", "gate", "demo"];
    expect(Object.keys(RUN_DEMO_CLI.commands)).toEqual(old);
  });

  test("--help works at the top level and for every command, and is not an error", () => {
    const top = parseRunDemoArgs(["--help"]);
    expect(!top.ok && top.help).toBe(true);
    expect(!top.ok && top.usage).toBe(programUsageText(RUN_DEMO_CLI));
    for (const command of Object.keys(RUN_DEMO_CLI.commands)) {
      const parsed = parseRunDemoArgs([command, "--help"]);
      expect(!parsed.ok && parsed.help, command).toBe(true);
      expect(!parsed.ok && parsed.usage, command).toBe(commandUsageText(RUN_DEMO_CLI, command));
    }
  });
});

describe("generated usage covers what the old header documented, plus recover-port and --fault", () => {
  const demo = commandUsageText(RUN_DEMO_CLI, "demo");

  test("demo lists every flag with its default", () => {
    for (const flag of [
      "--dir", "--files", "--prep", "--source-root", "--epoch", "--max-rounds", "--wait-minutes",
      "--flow-id", "--gate-flow-id", "--dispatch", "--start-only", "--init-fixture", "--dashboard",
    ]) {
      expect(demo, flag).toContain(flag);
    }
    expect(demo).toContain("--dispatch parallel|sequential");
    expect(demo).toContain("(whole number >= 1; default: 1)"); // --max-rounds default 1, no longer undocumented
    expect(demo).toContain("default: 30");
  });

  test("worker documents --fault, recover-port is listed, and the top level lists the exit codes", () => {
    expect(commandUsageText(RUN_DEMO_CLI, "worker")).toContain("--fault <spec>");
    const top = programUsageText(RUN_DEMO_CLI);
    expect(top).toMatch(/recover-port +recovery for the port flow/);
    expect(commandUsageText(RUN_DEMO_CLI, "recover-port")).toContain("--files <files>");
    for (const code of Object.values(RUN_DEMO_EXIT)) expect(commandUsageText(RUN_DEMO_CLI, "demo")).toContain(`${code} `);
  });
});

describe("exit codes", () => {
  test("usage is the shared 64; the flow outcome codes keep their documented numbers", () => {
    expect(RUN_DEMO_EXIT).toEqual({ ok: 0, failed: 1, unresolved: 3, stillRunning: 4, usage: CLI_EXIT.usage });
  });
});

describe("the real CLI", () => {
  async function run(args: string[]) {
    const proc = Bun.spawn([process.execPath, "run", RUN_DEMO, ...args], {
      // A dex address nothing listens on: a command that got past the parse and tried dex would show ECONNREFUSED.
      env: { ...process.env, DEX_SERVER_ADDRESS: "127.0.0.1:1" },
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

  test("a usage error exits 64 with the command's generated usage, before dex is contacted", async () => {
    const r = await run(["wait-flow", "--id", "f", "--wait-minutes", "abc"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain('[run-demo] --wait-minutes must be a whole number >= 1, got "abc"');
    expect(r.stderr).toContain("usage: run-demo.ts wait-flow --id <flowId> [--wait-minutes <n>]");
    expect(r.stderr).not.toContain("ECONNREFUSED");
  });

  test("an unknown command and a bad enum exit 64", async () => {
    expect((await run(["fly"])).code).toBe(64);
    const r = await run(["worker", "--flows", "prot"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("--flows must be one of probe, port");
  });

  test("--help (top level and per command) prints the usage on stdout and exits 0", async () => {
    const top = await run(["--help"]);
    expect(top.code).toBe(0);
    expect(top.stdout).toContain("usage: run-demo.ts <worker|hello|long-step");
    const demo = await run(["demo", "--help"]);
    expect(demo.code).toBe(0);
    expect(demo.stdout).toContain("usage: run-demo.ts demo --dir <repoDir>");
    expect(demo.stderr).toBe("");
  });
});
