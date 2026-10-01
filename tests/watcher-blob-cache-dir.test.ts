/**
 * C61 (watcher part) — the watcher's blob cache must live under the ignored
 * `.dex-cache/` and must not be redirected by the worker's DEX_BLOB_CACHE_DIR.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
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

describe("C61: nesting under .dex-cache/ is safe for the worker's cache lifecycle", () => {
  test("a worker reopening, churning and deleteAll()-ing its cache leaves the watcher's nested cache intact", async () => {
    dir = await mkdtemp(join(tmpdir(), "watch-blob-"));
    const workerDir = join(dir, ".dex-cache");
    const watchDir = join(dir, WATCHER_BLOB_CACHE_DIR);
    const opts = { maxBytes: 4 * 1024 * 1024 };

    let worker = openBlobCache({ directory: workerDir, ...opts });
    worker.put("w1", new Uint8Array([1, 2, 3]));
    worker.close();

    const watch = openBlobCache({ directory: watchDir, ...opts });
    watch.put("x1", new Uint8Array([9, 9]));
    writeFileSync(join(watchDir, "marker.txt"), "keep");
    watch.close();

    worker = openBlobCache({ directory: workerDir, ...opts });
    try {
      expect(worker.get("w1")).toBeDefined(); // the worker's own data survives the nested sibling
      for (let i = 0; i < 100; i++) worker.put(`churn-${i}`, new Uint8Array(40_000));
      worker.deleteAll();
    } finally {
      worker.close();
    }

    expect(existsSync(join(watchDir, "marker.txt"))).toBe(true);
    const reopened = openBlobCache({ directory: watchDir, ...opts });
    try {
      expect(reopened.get("x1")).toBeDefined();
    } finally {
      reopened.close();
    }
  });
});
