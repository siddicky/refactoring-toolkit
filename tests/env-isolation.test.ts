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

const SUITES = [
  "src/harness/lanes.test.ts",
  "tests/turn-health.test.ts",
  "src/harness/opencode.test.ts",
  "src/harness/select.test.ts",
] as const;

describe("harness test suites ignore the operator's OPENCODE_* / TYPESAFE_* env", () => {
  for (const suite of SUITES) {
    test(`${suite} passes with lane/timeout overrides set in the invoking environment`, async () => {
      const child = Bun.spawn([process.execPath, "test", suite], {
        cwd: REPO_ROOT,
        env: { ...process.env, ...POLLUTION },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      const out = `${stdout}\n${stderr}`;
      expect(out).not.toMatch(/\(fail\)/);
      expect(out).toMatch(/\b0 fail\b/);
      expect(code).toBe(0);
    }, 30_000);
  }
});
