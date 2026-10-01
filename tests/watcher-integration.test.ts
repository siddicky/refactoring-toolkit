/**
 * INT-9 — the T7 mid-run review items that only close once T3/T5/T6 are merged.
 *
 * 1. fired:false is honoured by every consumer. Writer to T5/T6 readers is in
 *    contract-b-kill-events.test.ts; here the WATCHER side: a kill action that
 *    killed nothing is reported as a no-op, and a kill action that THROWS is
 *    never reported as fired (a swallowed throw ended runs as a silent success
 *    or a silent "no kill").
 * 2. One exit-code table for chaos-kill and watch-queue-verify, checked on the
 *    real CLIs.
 * 3. serve-status (T6) no longer shares DEX_BLOB_CACHE_DIR with the worker, and
 *    the cache directories it and the watcher default to are ignored by git.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHAOS_KILL_EXIT } from "../scripts/chaos-kill.js";
import { configFromEnv } from "../src/dashboard/config.js";
import { dexConfigFromEnv } from "../src/dex/client.js";
import { watcherBlobCacheDir, WATCHER_BLOB_CACHE_DIR } from "../src/watcher/blob-cache-dir.js";
import { WATCHER_EXIT } from "../src/watcher/cli-args.js";
import {
  runQueueVerifyWatcher,
  type QueueVerifyWatcherOptions,
  type WatcherFlowStatus,
  type WatcherStreamEvent,
} from "../src/watcher/queue-verify-watcher.js";

const ROOT = join(import.meta.dir, "..");

// ---------------------------------------------------------------------------
// 1. The watcher never reports a failed or empty kill as fired
// ---------------------------------------------------------------------------

const START: WatcherStreamEvent = { eventKey: "pp-queue-verify#1", endedAt: null, stepId: "pp-queue-verify" };

type Lane = "backlog" | "follow" | "poll";

/** Options for one trigger lane; `fire` is the action under test. */
function lane(which: Lane, fire: QueueVerifyWatcherOptions["fire"], status: WatcherFlowStatus = "running"): QueueVerifyWatcherOptions {
  let delivered = false;
  return {
    deadlineMs: 60_000,
    pollIntervalMs: 1_000,
    flowStatus: async () => status,
    // follow: one START on the first read, then silence. backlog/poll: nothing on the stream.
    nextStreamEvent: async () => {
      if (which === "follow" && !delivered) {
        delivered = true;
        return START;
      }
      return null;
    },
    drainBacklog: async () => (which === "backlog" ? [START] : []),
    poll: async () => which === "poll",
    fire,
    sleep: async () => {},
  };
}

describe("INT-9: a failing kill is never reported as fired, on every trigger lane", () => {
  for (const which of ["backlog", "follow", "poll"] as const) {
    test(`${which}: a throwing kill action rejects the watch (and runs exactly once)`, async () => {
      let calls = 0;
      const options = lane(which, async () => {
        calls += 1;
        throw new Error("EACCES: cannot signal target");
      });
      await expect(runQueueVerifyWatcher(options)).rejects.toThrow("EACCES");
      expect(calls).toBe(1);
    });

    test(`${which}: a kill that killed nothing is a no-op with zero firings, never fired`, async () => {
      const result = await runQueueVerifyWatcher(
        lane(which, async () => ({ killed: false, detail: "no live target" })),
      );
      expect(result.outcome).toBe("no-op");
      expect(result.firings).toBe(0);
    });

    test(`${which}: a real kill is fired once`, async () => {
      const result = await runQueueVerifyWatcher(lane(which, async () => ({ killed: true })));
      expect(result.outcome).toBe("fired");
      expect(result.firings).toBe(1);
    });
  }

  test("a terminal flow never fires, whichever lane saw the trigger", async () => {
    let calls = 0;
    const result = await runQueueVerifyWatcher(
      lane("follow", async () => {
        calls += 1;
      }, "completed"),
    );
    expect(result.outcome).toBe("terminal");
    expect(calls).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. One exit-code table
// ---------------------------------------------------------------------------

describe("INT-9: chaos-kill and watch-queue-verify share one exit-code table", () => {
  test("every chaos-kill code is the watcher code of the same meaning; the watcher codes are all distinct", () => {
    expect(CHAOS_KILL_EXIT).toEqual({
      ok: WATCHER_EXIT.fired,
      noop: WATCHER_EXIT.noop,
      survivors: WATCHER_EXIT.survivor,
      usage: WATCHER_EXIT.usage,
      fatal: WATCHER_EXIT.fatal,
    });
    const codes = Object.values(WATCHER_EXIT);
    expect(new Set(codes).size).toBe(codes.length);
    // 1 and 2 are the watcher's "terminal" and "bound elapsed": chaos-kill must not reuse them
    const chaosCodes: number[] = Object.values(CHAOS_KILL_EXIT);
    expect(chaosCodes).not.toContain(WATCHER_EXIT.terminal);
    expect(chaosCodes).not.toContain(WATCHER_EXIT.timeout);
  });

  test("both scripts document the same numbers", () => {
    /** The header comment as one line of prose (comment stars and line breaks folded away). */
    const header = (script: string): string =>
      readFileSync(join(ROOT, "scripts", script), "utf8")
        .slice(0, 3_500)
        .replace(/\n\s*\*\s?/g, " ");
    const chaos = header("chaos-kill.ts");
    const watcher = header("watch-queue-verify.ts");
    for (const [doc, name] of [
      [chaos, "chaos-kill"],
      [watcher, "watch-queue-verify"],
    ] as const) {
      expect(doc, `${name} does not document exit 64 (usage)`).toMatch(/64\b.*usage/i);
      expect(doc, `${name} does not document exit 70 (fatal)`).toMatch(/70\b.*fatal/i);
      expect(doc, `${name} does not document exit 3 (no-op)`).toMatch(/\b3\b.*NO-OP/i);
      expect(doc, `${name} does not document exit 4 (survivor)`).toMatch(/\b4\b.*surviv/i);
    }
  });

  let dir: string | undefined;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  async function run(script: string, args: string[]): Promise<number> {
    const proc = Bun.spawn([process.execPath, join(ROOT, "scripts", script), ...args], {
      cwd: ROOT,
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    return await proc.exited;
  }

  test("the real CLIs exit with the table's numbers: usage 64 on both, no-op 3 with a fired:false sidecar", async () => {
    dir = await mkdtemp(join(tmpdir(), "int9-exit-"));
    expect(await run("chaos-kill.ts", ["--definitely-not-a-flag"])).toBe(WATCHER_EXIT.usage);
    expect(await run("watch-queue-verify.ts", ["--definitely-not-a-flag"])).toBe(WATCHER_EXIT.usage);

    const events = join(dir, "kill-events.jsonl");
    const code = await run("chaos-kill.ts", ["--pids", "99999999", "--events", events, "--wait-ms", "100"]);
    expect(code).toBe(WATCHER_EXIT.noop);
    const lines = (await readFile(events, "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines.at(-1)?.fired).toBe(false);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. serve-status and the worker no longer share a blob cache
// ---------------------------------------------------------------------------

describe("INT-9: serve-status does not share DEX_BLOB_CACHE_DIR with the worker", () => {
  test("exporting DEX_BLOB_CACHE_DIR moves the worker's cache and neither the dashboard's nor the watcher's", () => {
    const env = { DEX_BLOB_CACHE_DIR: "/srv/worker-cache" };
    expect(dexConfigFromEnv(env).blobCacheDir).toBe("/srv/worker-cache");
    expect(configFromEnv(env, "/cwd").blobCacheDir).not.toBe("/srv/worker-cache");
    expect(watcherBlobCacheDir(env)).toBe(WATCHER_BLOB_CACHE_DIR);
  });

  test("each process has its own default directory, all under the ignored .dex-cache family", () => {
    const worker = dexConfigFromEnv({}).blobCacheDir;
    const dashboard = configFromEnv({}, "/cwd").blobCacheDir;
    const watcher = watcherBlobCacheDir({});
    expect(new Set([worker, dashboard, watcher]).size).toBe(3);
    for (const dirName of [worker, dashboard, watcher]) {
      expect(dirName.startsWith(".dex-cache")).toBe(true);
      const ignored = (() => {
        try {
          execFileSync("git", ["check-ignore", "-q", `${dirName}/blob`], { cwd: ROOT, stdio: "ignore" });
          return true;
        } catch {
          return false;
        }
      })();
      expect(ignored, `${dirName} is not git-ignored`).toBe(true);
    }
  });

  test("each process has its own override variable, and the dashboard's is honoured", () => {
    expect(configFromEnv({ STATUS_BLOB_CACHE_DIR: "/srv/dash" }, "/cwd").blobCacheDir).toBe("/srv/dash");
    expect(watcherBlobCacheDir({ DEX_WATCH_BLOB_CACHE_DIR: "/srv/watch" })).toBe("/srv/watch");
  });

  test("scripts/serve-status.ts overrides the spread dexConfigFromEnv() cache with its own directory", () => {
    const source = readFileSync(join(ROOT, "scripts", "serve-status.ts"), "utf8");
    expect(source).toMatch(/\{\s*\.\.\.dexConfigFromEnv\(\),\s*blobCacheDir\s*\}/);
    expect(source).not.toMatch(/process\.env\.DEX_BLOB_CACHE_DIR/);
  });
});
