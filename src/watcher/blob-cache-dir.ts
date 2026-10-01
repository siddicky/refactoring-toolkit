/**
 * Blob-cache directory for the watcher's read-side stream client (audit C61).
 *
 * The watcher opens its OWN cache (per-process sharing is the guidance — a
 * blob cache is never shared across processes). Two defects fixed here:
 *
 * - The old default `.dex-cache-watch` escaped .gitignore (only `.dex-cache/`
 *   is ignored), leaving untracked cache files one `git add -A` from a commit.
 *   The default now lives UNDER the ignored `.dex-cache/`.
 * - The old code honoured `DEX_BLOB_CACHE_DIR`, the variable the worker's
 *   config reads (src/dex/client.ts), so exporting it for the worker silently
 *   made watcher and worker share one directory. The watcher now ignores it;
 *   `DEX_WATCH_BLOB_CACHE_DIR` is its own override.
 */

/** Default watcher cache, inside the gitignored `.dex-cache/` (cwd-relative). */
export const WATCHER_BLOB_CACHE_DIR = ".dex-cache/watch";

export function watcherBlobCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEX_WATCH_BLOB_CACHE_DIR?.trim() || WATCHER_BLOB_CACHE_DIR;
}
