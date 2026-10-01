/**
 * One reading rule for the environment (audit C79): a blank variable is an unset
 * one, a number is whole digits, a switch is 1/true/yes/on or 0/false/no/off.
 *
 * Before, the same variable meant different things in different places:
 * `OPENCODE_AGENT=` was the agent named "" (every prompt carried `agent: ""`),
 * `GIT_AUTHOR_NAME=` reached git as an empty identity (git refuses it),
 * TYPESAFE_OFFLINE=banana turned offline mode on, and `STATUS_PORT=0x1F6E` was
 * accepted by Number(). Each test below reads a variable the way the code does,
 * blank and unset side by side.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dashboardPort, opencodeEnv } from "../scripts/run-demo.js";
import { EnvError } from "../src/env.js";
import { git } from "../src/git/exec.js";
import { laneRouting, reviewLaneRouting } from "../src/harness/lanes.js";
import {
  DEFAULT_PROMPT_WAIT_MS,
  OpencodeHarness,
  promptCallTimeoutMs,
  promptWaitMs,
} from "../src/harness/opencode.js";
import { reviewerAgentOverride } from "../src/harness/runtime.js";
import { createRealJevClient, isTypesafeOffline, JevConfigError } from "../src/typesafe/client.js";
import { productionSources, readSource } from "./support/source-files.js";
import { clearHarnessEnv } from "./support/env.js";

const BLANKS = ["", "   ", "\t"] as const;

let restoreEnv: () => void = () => {};
const savedGit = new Map<string, string | undefined>();
const GIT_NAMES = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const;

beforeEach(() => {
  restoreEnv = clearHarnessEnv();
  for (const name of GIT_NAMES) savedGit.set(name, process.env[name]);
});

afterEach(() => {
  restoreEnv();
  for (const [name, value] of savedGit) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedGit.clear();
});

describe("blank equals unset", () => {
  test("lane routing: a blank model or variant keeps the in-code default", () => {
    const unset = [laneRouting("planner"), laneRouting("executor"), laneRouting("reviewer"), reviewLaneRouting(2)];
    for (const blank of BLANKS) {
      for (const name of [
        "OPENCODE_PLANNER_MODEL",
        "OPENCODE_PLANNER_VARIANT",
        "OPENCODE_EXECUTOR_MODEL",
        "OPENCODE_EXECUTOR_VARIANT",
        "OPENCODE_REVIEWER_MODEL",
        "OPENCODE_REVIEWER_VARIANT",
        "OPENCODE_REVIEWER_MODEL_FALLBACK",
        "OPENCODE_REVIEWER_MODEL_FALLBACK_VARIANT",
      ]) {
        process.env[name] = blank;
      }
      expect([laneRouting("planner"), laneRouting("executor"), laneRouting("reviewer"), reviewLaneRouting(2)]).toEqual(
        unset,
      );
    }
  });

  test("OPENCODE_AGENT and OPENCODE_REVIEWER_AGENT: blank is no agent, not the agent named empty", async () => {
    for (const blank of BLANKS) {
      process.env.OPENCODE_AGENT = blank;
      process.env.OPENCODE_REVIEWER_AGENT = blank;
      expect((await OpencodeHarness.connect("http://127.0.0.1:1")).defaultAgent).toBeUndefined();
      expect(reviewerAgentOverride()).toBeUndefined();
    }
    process.env.OPENCODE_AGENT = "  build ";
    process.env.OPENCODE_REVIEWER_AGENT = " plan ";
    expect((await OpencodeHarness.connect("http://127.0.0.1:1")).defaultAgent).toBe("build");
    expect(reviewerAgentOverride()).toBe("plan");
  });

  test("OPENCODE_BASE_URL and the model pair: blank is unset, and a half-set pair is no model", () => {
    for (const blank of BLANKS) {
      process.env.OPENCODE_BASE_URL = blank;
      process.env.OPENCODE_MODEL_PROVIDER = blank;
      process.env.OPENCODE_MODEL_ID = blank;
      expect(opencodeEnv()).toEqual({ baseUrl: undefined, model: undefined });
    }
    process.env.OPENCODE_MODEL_PROVIDER = "acme";
    process.env.OPENCODE_MODEL_ID = "   ";
    expect(opencodeEnv().model).toBeUndefined();
    process.env.OPENCODE_MODEL_ID = " big ";
    process.env.OPENCODE_BASE_URL = " http://127.0.0.1:4096 ";
    expect(opencodeEnv()).toEqual({ baseUrl: "http://127.0.0.1:4096", model: { providerID: "acme", modelID: "big" } });
  });

  test("the prompt time bounds: blank and a unit suffix both keep the default", () => {
    const defaults = [promptWaitMs(), promptCallTimeoutMs()];
    for (const blank of BLANKS) {
      process.env.OPENCODE_PROMPT_WAIT_MS = blank;
      process.env.OPENCODE_PROMPT_CALL_TIMEOUT_MS = blank;
      expect([promptWaitMs(), promptCallTimeoutMs()]).toEqual(defaults);
    }
    process.env.OPENCODE_PROMPT_WAIT_MS = "20m";
    expect(promptWaitMs()).toBe(DEFAULT_PROMPT_WAIT_MS);
    process.env.OPENCODE_PROMPT_WAIT_MS = " 90000 ";
    expect(promptWaitMs()).toBe(90_000);
  });

  test("TYPESAFE_API_KEY: a blank key is no key (the real client refuses it before any SDK import)", async () => {
    for (const blank of BLANKS) {
      process.env.TYPESAFE_API_KEY = blank;
      await expect(createRealJevClient()).rejects.toBeInstanceOf(JevConfigError);
    }
  });

  test("the git identity: a blank GIT_* variable falls back to the toolkit's, so a commit still works", async () => {
    const dir = await mkdtemp(join(tmpdir(), "env-blank-git-"));
    try {
      // A runner reads the identity when it is built, so build one after each change to the environment.
      await git(dir).run(["init", "-q"]);
      for (const blank of ["", "   "]) {
        for (const name of GIT_NAMES) process.env[name] = blank;
        await git(dir).run(["commit", "--allow-empty", "-q", "-m", `blank ${JSON.stringify(blank)}`]);
      }
      expect((await git(dir).run(["log", "--format=%an <%ae> / %cn <%ce>"])).trim().split("\n")).toEqual([
        "porting-toolkit <toolkit@localhost> / porting-toolkit <toolkit@localhost>",
        "porting-toolkit <toolkit@localhost> / porting-toolkit <toolkit@localhost>",
      ]);
      process.env.GIT_AUTHOR_NAME = " Ada ";
      await git(dir).run(["commit", "--allow-empty", "-q", "-m", "named"]);
      expect((await git(dir).run(["log", "-1", "--format=%an"])).trim()).toBe("Ada");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("TYPESAFE_OFFLINE is a switch", () => {
  test("on for 1/true/yes/on, off for 0/false/no/off, blank and unset, in any case", () => {
    for (const on of ["1", "true", "TRUE", "yes", "On", " 1 "]) {
      process.env.TYPESAFE_OFFLINE = on;
      expect(isTypesafeOffline()).toBe(true);
    }
    for (const off of ["0", "false", "False", "no", "OFF", "", "  "]) {
      process.env.TYPESAFE_OFFLINE = off;
      expect(isTypesafeOffline()).toBe(false);
    }
    delete process.env.TYPESAFE_OFFLINE;
    expect(isTypesafeOffline()).toBe(false);
  });

  test("anything else is an error that names the variable, not a quiet yes", () => {
    for (const bad of ["banana", "2", "y", "tru"]) {
      process.env.TYPESAFE_OFFLINE = bad;
      expect(() => isTypesafeOffline()).toThrow(EnvError);
      expect(() => isTypesafeOffline()).toThrow("TYPESAFE_OFFLINE");
    }
  });
});

describe("STATUS_PORT is whole digits", () => {
  test("hex, exponent, sign and unit forms that Number() accepted are errors", () => {
    expect(dashboardPort({ STATUS_PORT: " 5055 " })).toBe(5055);
    expect(dashboardPort({ STATUS_PORT: "   " })).toBe(4646);
    for (const bad of ["0x1F6E", "5e3", "+5055", "5055.0", "5055ms"]) {
      expect(() => dashboardPort({ STATUS_PORT: bad })).toThrow(EnvError);
    }
  });
});

describe("architecture: the environment is read through src/env.ts only", () => {
  // A named read (`process.env.X`, `process.env["X"]`) in production code skips the one rule. Passing the whole
  // environment on (`...process.env`, a `= process.env` default parameter) is not a read and stays allowed.
  test("no production module reads a named variable straight off process.env", () => {
    const offenders = productionSources("src", "scripts", "flows", "harness")
      .filter((rel) => rel !== "src/env.ts")
      .flatMap((rel) =>
        readSource(rel)
          .split("\n")
          .map((line, i) => ({ rel, line: i + 1, text: line }))
          .filter(({ text }) => /process\.env(?:\.[A-Za-z_]|\[)/.test(text) && !/^\s*(?:\/\/|\*)/.test(text)),
      )
      .map(({ rel, line, text }) => `${rel}:${line}: ${text.trim()}`);
    expect(offenders).toEqual([]);
  });
});
