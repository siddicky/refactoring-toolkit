/**
 * Defaults every process that talks to dex shares (audit C1, C36, C79). One
 * definition of each: the server address and the dexcli binary used to be typed
 * again in the dashboard config, the scripts and the dex seam.
 *
 * Leaf module (imports only src/env.ts): the dex seam, the dashboard config, the
 * watcher and the scripts all read it without pulling in the dex SDK.
 */

import { type Env, envString } from "../env.js";

/** gRPC address of the dex server `dexcli dev` starts; override with DEX_SERVER_ADDRESS. */
export const DEFAULT_DEX_SERVER_ADDRESS = "127.0.0.1:8801";

/** The dexcli binary, resolved on PATH; override with DEXCLI_BIN. */
export const DEFAULT_DEXCLI_BIN = "dexcli";

/**
 * How every dexcli caller (the dashboard, run-demo's gate, the watcher,
 * render-metrics) finds its binary and server: DEXCLI_BIN and
 * DEX_SERVER_ADDRESS, blank meaning unset, else the defaults above.
 */
export function dexcliFromEnv(env: Env = process.env): { bin: string; server: string } {
  return {
    bin: envString("DEXCLI_BIN", env) ?? DEFAULT_DEXCLI_BIN,
    server: envString("DEX_SERVER_ADDRESS", env) ?? DEFAULT_DEX_SERVER_ADDRESS,
  };
}

/**
 * Default blob-cache directory of every process that opens one. A dex blob
 * cache is never shared across processes, and its directory is the cache's own
 * to scan and evict from. So each process role gets its OWN default, and the
 * defaults are SIBLINGS: none is inside another's directory (a cache nested in
 * the worker's `.dex-cache/` could be enumerated or evicted by the worker's
 * cache), and all of them match the `.dex-cache*\/` ignore rule, so a
 * `git add -A` cannot pick their files up.
 */
export const BLOB_CACHE_DIRS = {
  /** `run-demo worker`; override with DEX_BLOB_CACHE_DIR. */
  worker: ".dex-cache",
  /** Every other run-demo command (demo, round, recover, hello, ...); override with DEX_CLIENT_BLOB_CACHE_DIR. */
  client: ".dex-cache-client",
  /** The status server's stream client; override with STATUS_BLOB_CACHE_DIR. */
  dashboard: ".dex-cache-dashboard",
  /** The queue-verify watcher's stream client; override with DEX_WATCH_BLOB_CACHE_DIR. */
  watcher: ".dex-cache-watch",
} as const;
