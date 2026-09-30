/**
 * C61 (watcher part) — the watcher's blob cache must live under the ignored
 * `.dex-cache/` and must not be redirected by the worker's DEX_BLOB_CACHE_DIR.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBlobCache } from "@superdurable/dex";

import { WATCHER_BLOB_CACHE_DIR, watcherBlobCacheDir } from "../src/watcher/blob-cache-dir.js";

const REPO_ROOT = join(import.meta.dir, "..");

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("C61: watcher blob-cache directory", () => {
  test("the default is nested under .dex-cache/ (not the unignored .dex-cache-watch)", () => {
    expect(WATCHER_BLOB_CACHE_DIR).toBe(".dex-cache/watch");
    expect(watcherBlobCacheDir({})).toBe(".dex-cache/watch");
    expect(watcherBlobCacheDir({})).not.toBe(".dex-cache-watch");
  });

  test("git ignores files the default cache would create (a `git add -A` cannot pick them up)", async () => {
    const proc = Bun.spawn(["git", "check-ignore", "-q", `${WATCHER_BLOB_CACHE_DIR}/blobs/blob1`], {
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    // exit 0 = ignored, 1 = not ignored.
    expect(await proc.exited).toBe(0);
  });

  test("the worker's DEX_BLOB_CACHE_DIR is NOT honoured, so watcher and worker never share a directory", () => {
    expect(watcherBlobCacheDir({ DEX_BLOB_CACHE_DIR: "/var/cache/worker-blobs" })).toBe(".dex-cache/watch");
  });

  test("DEX_WATCH_BLOB_CACHE_DIR overrides; blank falls back to the default", () => {
    expect(watcherBlobCacheDir({ DEX_WATCH_BLOB_CACHE_DIR: " /tmp/w " })).toBe("/tmp/w");
    expect(watcherBlobCacheDir({ DEX_WATCH_BLOB_CACHE_DIR: "  " })).toBe(".dex-cache/watch");
  });

  test("the native blob cache opens the nested default even when .dex-cache/ does not exist yet", async () => {
    dir = await mkdtemp(join(tmpdir(), "watch-blob-"));
    const nested = join(dir, WATCHER_BLOB_CACHE_DIR);
    expect(existsSync(join(dir, ".dex-cache"))).toBe(false);
    const cache = openBlobCache({ directory: nested, maxBytes: 4 * 1024 * 1024 });
    try {
      expect(existsSync(nested)).toBe(true);
    } finally {
      cache.close();
    }
  });
});
