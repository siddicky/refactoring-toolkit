/**
 * C88 — the one shared process runner: bounded (timeout, maxBuffer) and
 * failures that keep what the tool printed.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import {
  EXEC_MAX_BUFFER,
  EXEC_TIMEOUT_MS,
  ExecError,
  describeExecFailure,
  execTool,
  execToolResult,
} from "./exec.js";

const sh = (script: string): readonly string[] => ["-c", script];

describe("execTool", () => {
  test("returns stdout and stderr of a successful run", async () => {
    const out = await execTool("sh", sh("echo to-out; echo to-err >&2"));
    expect(out).toEqual({ stdout: "to-out\n", stderr: "to-err\n" });
  });

  test("passes cwd and env through", async () => {
    const dir = await realpath(await mkdtemp(`${tmpdir()}/exec-cwd-`));
    try {
      const out = await execTool("sh", sh('pwd; echo "$EXEC_TEST_VAR"'), { cwd: dir, env: { ...process.env, EXEC_TEST_VAR: "v1" } });
      expect(out.stdout).toBe(`${dir}\nv1\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a stdout-only failure keeps stdout and names the exit code", async () => {
    const err = await execTool("sh", sh("echo CONFLICT in a.txt; exit 3")).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ExecError);
    const e = err as ExecError;
    expect(e.stdout).toBe("CONFLICT in a.txt\n");
    expect(e.stderr).toBe("");
    expect(e.exitCode).toBe(3);
    expect(e.timedOut).toBe(false);
    expect(e.message).toContain("CONFLICT in a.txt");
    expect(e.message).toContain("exit 3");
  });

  test("stderr wins over stdout in the message; both stay on the error", async () => {
    const err = (await execTool("sh", sh("echo partial; echo broken >&2; exit 2")).catch((e: unknown) => e)) as ExecError;
    expect(err.stdout).toBe("partial\n");
    expect(err.stderr).toBe("broken\n");
    expect(describeExecFailure(err.failure)).toBe("broken (exit 2)");
    expect(err.message).toBe("sh -c echo partial; echo broken >&2; exit 2 failed: broken (exit 2)");
  });

  test("the timeout kills a hung tool and the error says so", async () => {
    const started = Date.now();
    const err = (await execTool("sleep", ["5"], { timeoutMs: 100 }).catch((e: unknown) => e)) as ExecError;
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(err).toBeInstanceOf(ExecError);
    expect(err.timedOut).toBe(true);
    expect(err.failure.killed).toBe(true);
    expect(err.failure.timeoutMs).toBe(100);
    expect(err.message).toContain("timed out after 100ms");
  });

  test("a missing binary is a spawn failure, not a timeout", async () => {
    const err = (await execTool("definitely-not-a-binary-xyz", []).catch((e: unknown) => e)) as ExecError;
    expect(err).toBeInstanceOf(ExecError);
    expect(err.timedOut).toBe(false);
    expect(err.exitCode).toBeNull();
    expect(err.failure.spawnError).not.toBeNull();
    expect(err.message).toContain("definitely-not-a-binary-xyz");
  });
});

describe("execToolResult", () => {
  test("never throws: a failure comes back as data with the raw error as cause", async () => {
    const r = await execToolResult("sh", sh("echo no >&2; exit 1"));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure.exitCode).toBe(1);
    expect(r.stderr).toBe("no\n");
    expect(r.cause).toBeInstanceOf(Error);
  });

  test("a success is ok with both streams", async () => {
    const r = await execToolResult("sh", sh("echo fine"));
    expect(r).toEqual({ ok: true, stdout: "fine\n", stderr: "" });
  });

  test("output over Node's 1 MiB default is fine under the shared default maxBuffer", async () => {
    expect(EXEC_MAX_BUFFER).toBeGreaterThan(8 * 1024 * 1024);
    const r = await execToolResult("sh", sh("head -c 3000000 /dev/zero | tr '\\0' a"));
    expect(r.ok).toBe(true);
    expect(r.stdout.length).toBe(3_000_000);
  });

  test("an explicit maxBuffer is enforced and reported as a spawn-level error, not a timeout", async () => {
    const r = await execToolResult("sh", sh("head -c 5000 /dev/zero | tr '\\0' a"), { maxBuffer: 100 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure.spawnError).toBe("ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
    expect(r.failure.timedOut).toBe(false);
  });

  test("the default timeout is bounded", () => {
    expect(EXEC_TIMEOUT_MS).toBe(30_000);
  });
});
