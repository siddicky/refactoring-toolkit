/**
 * Regression for audit C22/C78: `bun test` auto-loads the operator's .env,
 * and README tells operators to put OPENCODE_*_MODEL/VARIANT lane overrides
 * there. lanes.test.ts's "defaults (no env required)" tests used to clean env
 * only in afterEach, so they failed whenever those variables were set.
 *
 * Each harness-configuration suite is re-run in a child `bun test` with a
 * polluted environment and must still pass.
 */

import { describe, expect, test } from "bun:test";

import { REPO_ROOT } from "./support/paths.js";

const POLLUTION: Record<string, string> = {
  OPENCODE_PLANNER_MODEL: "acme/planner-x",
  OPENCODE_EXECUTOR_MODEL: "acme/executor-y",
  OPENCODE_REVIEWER_MODEL: "acme/reviewer-z",
  OPENCODE_PLANNER_VARIANT: "none",
  OPENCODE_EXECUTOR_VARIANT: "low",
  OPENCODE_REVIEWER_MODEL_FALLBACK: "acme/fallback-w",
  OPENCODE_REVIEWER_MODEL_FALLBACK_VARIANT: "low",
  OPENCODE_PROMPT_CALL_TIMEOUT_MS: "5",
  OPENCODE_PROMPT_WAIT_MS: "5",
  OPENCODE_AGENT: "build",
  TYPESAFE_OFFLINE: "1",
};

// B31: the dashboard / run-demo suites spawn children and read STATUS_*, DEX_* and friends.
// STATUS_HOST=localhost (or 0.0.0.0, ::1) used to fail tests/run-demo-dashboard.test.ts.
const OPERATOR_ENV_POLLUTION: Record<string, string> = {
  STATUS_HOST: "::1",
  STATUS_PORT: "1",
  STATUS_ALLOWED_HOSTS: "dashboard.example",
  STATUS_REPO_ROOT: "/nonexistent/operator-repo",
  STATUS_MAX_FLOWS: "1",
  STATUS_STREAM_SUBSCRIBE: "1",
  KILL_EVENT_FILES: "/nonexistent/kill-events.jsonl",
  BURN_DOWN_FILES: "/nonexistent/burn-down.json",
  DEX_SERVER_ADDRESS: "10.255.255.1:1",
  DEX_WORKER_BIND: "10.255.255.1:2",
  DEXCLI_BIN: "/nonexistent/dexcli",
  HARNESS: "opencode",
  RECOVER_FILE: "src/operator.php",
  RECOVER_ROUND: "99",
  PORTING_KIT_FAULT: "symbol-table:post:seed",
};

const SUITES = [
  "src/harness/lanes.test.ts",
  "tests/turn-health.test.ts",
  "src/harness/opencode.test.ts",
  "src/harness/select.test.ts",
  "tests/jev-wiring.test.ts",
] as const;

const OPERATOR_SUITES = [
  "tests/run-demo-dashboard.test.ts",
  "tests/run-demo-cli.test.ts",
  "tests/run-demo-recover.test.ts",
  "tests/fault-kinds.test.ts",
  "tests/render-metrics.test.ts",
] as const;

/** Runs one suite in a child `bun test` with `pollution` added to the invoking environment. */
async function runPolluted(suite: string, pollution: Record<string, string>): Promise<{ out: string; code: number }> {
  const child = Bun.spawn([process.execPath, "test", suite], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...pollution },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { out: `${stdout}\n${stderr}`, code };
}

describe("harness test suites ignore the operator's OPENCODE_* / TYPESAFE_* env", () => {
  for (const suite of SUITES) {
    test(`${suite} passes with lane/timeout overrides set in the invoking environment`, async () => {
      const { out, code } = await runPolluted(suite, POLLUTION);
      expect(out).not.toMatch(/\(fail\)/);
      expect(out).toMatch(/\b0 fail\b/);
      expect(code).toBe(0);
    }, 30_000);
  }
});

describe("dashboard and run-demo test suites ignore the operator's STATUS_* / DEX_* / HARNESS / RECOVER_* env (B31)", () => {
  for (const suite of OPERATOR_SUITES) {
    test(`${suite} passes with those variables set in the invoking environment`, async () => {
      const { out, code } = await runPolluted(suite, OPERATOR_ENV_POLLUTION);
      expect(out).not.toMatch(/\(fail\)/);
      expect(out).toMatch(/\b0 fail\b/);
      expect(code).toBe(0);
    }, 120_000);
  }
});
