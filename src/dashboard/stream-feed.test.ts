/**
 * Stream-feed composition: blob-cache location/isolation and lifecycle (C61).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { configFromEnv } from "./config.js";
import type { StreamRead } from "./queries.js";
import { startStreamFeed, type StreamRuntime } from "./stream-feed.js";

const silent = { log: () => {}, warn: () => {} };

describe("dashboard blob-cache configuration (C61)", () => {
  test("defaults to the gitignored sibling .dex-cache-dashboard (never inside the worker cache)", () => {
    const cfg = configFromEnv({}, "/w");
    expect(cfg.blobCacheDir).toBe(".dex-cache-dashboard");
    expect(cfg.blobCacheDir.startsWith(".dex-cache/")).toBe(false); // a sibling of the worker cache, not inside it
  });

  test("ignores the worker's DEX_BLOB_CACHE_DIR (no shared directory); STATUS_BLOB_CACHE_DIR overrides", () => {
    expect(configFromEnv({ DEX_BLOB_CACHE_DIR: "/shared/worker-cache" }, "/w").blobCacheDir).toBe(".dex-cache-dashboard");
    expect(configFromEnv({ STATUS_BLOB_CACHE_DIR: " /var/tmp/dash " }, "/w").blobCacheDir).toBe("/var/tmp/dash");
  });

  test("STATUS_STREAM_SUBSCRIBE=0 opts out; anything else leaves the subscriber on", () => {
    expect(configFromEnv({ STATUS_STREAM_SUBSCRIBE: "0" }, "/w").streamSubscribe).toBe(false);
    expect(configFromEnv({}, "/w").streamSubscribe).toBe(true);
    expect(configFromEnv({ STATUS_STREAM_SUBSCRIBE: "1" }, "/w").streamSubscribe).toBe(true);
  });
});

describe("startStreamFeed lifecycle (C61)", () => {
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "dash-stream-feed-"));
  });
  afterAll(async () => {
    if (dir.length > 0) await rm(dir, { recursive: true, force: true });
  });

  function fakeRuntime() {
    const state = { closed: 0, reads: 0 };
    const runtime: StreamRuntime = {
      read: () => {
        state.reads += 1;
        return new Promise<StreamRead>(() => {}); // long-poll that never returns
      },
      close: async () => {
        state.closed += 1;
      },
    };
    return { runtime, state };
  }

  test("opens the client over the configured cache directory (created on demand)", async () => {
    const { runtime } = fakeRuntime();
    const opened: string[] = [];
    const cacheDir = join(dir, ".dex-cache", "dashboard");
    const feed = startStreamFeed({
      cfg: { blobCacheDir: cacheDir, streamSubscribe: true },
      open: async (d) => {
        opened.push(d);
        return runtime;
      },
      log: silent,
    });
    await feed.ready;
    expect(opened).toEqual([cacheDir]);
    expect((await stat(cacheDir)).isDirectory()).toBe(true);
    expect(feed.subscriber()).not.toBeNull();
    await feed.close();
  });

  test("close() stops the subscriber and closes the runtime (shutdown no longer leaks the client)", async () => {
    const { runtime, state } = fakeRuntime();
    const feed = startStreamFeed({
      cfg: { blobCacheDir: join(dir, "c1"), streamSubscribe: true },
      open: async () => runtime,
      log: silent,
    });
    await feed.ready;
    feed.subscriber()?.follow(["cx-7"]);
    await Bun.sleep(2);
    expect(state.reads).toBe(1);
    await feed.close();
    expect(state.closed).toBe(1);
  });

  test("a disabled feed never opens a client", async () => {
    let opens = 0;
    const feed = startStreamFeed({
      cfg: { blobCacheDir: join(dir, "c2"), streamSubscribe: false },
      open: async () => {
        opens += 1;
        return fakeRuntime().runtime;
      },
      log: silent,
    });
    await feed.ready;
    expect(opens).toBe(0);
    expect(feed.subscriber()).toBeNull();
    await feed.close(); // harmless
  });

  test("an open failure fails open: no subscriber, a warning, no throw", async () => {
    const warnings: string[] = [];
    const feed = startStreamFeed({
      cfg: { blobCacheDir: join(dir, "c3"), streamSubscribe: true },
      open: async () => {
        throw new Error("dex unreachable");
      },
      log: { log: () => {}, warn: (m) => warnings.push(m) },
    });
    await feed.ready;
    expect(feed.subscriber()).toBeNull();
    expect(warnings.join("\n")).toContain("dex unreachable");
    await feed.close();
  });
});
