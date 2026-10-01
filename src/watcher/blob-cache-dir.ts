/**
 * Blob-cache directory for the watcher's read-side stream client (audit C61, C1).
 *
 * The watcher opens its OWN cache (a blob cache is never shared across
 * processes), and ignores `DEX_BLOB_CACHE_DIR`, the variable the worker's
 * config reads (src/dex/client.ts): exporting it for the worker must not make
 * watcher and worker share one directory. `DEX_WATCH_BLOB_CACHE_DIR` is its own
 * override.
 *
 * The default is a SIBLING of the worker's `.dex-cache/`, not a directory
 * inside it: a cache nested in another's directory can be enumerated and
 * evicted by it. `.dex-cache-watch/` is covered by the `.dex-cache*\/` ignore
 * rule (src/dex/defaults.ts holds every process's default).
 */

import { BLOB_CACHE_DIRS } from "../dex/defaults.js";

/** Default watcher cache (cwd-relative). */
export const WATCHER_BLOB_CACHE_DIR = BLOB_CACHE_DIRS.watcher;

export function watcherBlobCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEX_WATCH_BLOB_CACHE_DIR?.trim() || WATCHER_BLOB_CACHE_DIR;
}
