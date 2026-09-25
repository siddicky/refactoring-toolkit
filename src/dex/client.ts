/**
 * Seam over @superdurable/dex (sdk-typescript) — Phase 0 spike, retained.
 *
 * dex is pre-release: this module is the single place that touches the SDK, so
 * upgrade churn is absorbed here. Exact version pinned in package.json.
 *
 * Local server (no official docker image yet):
 *   brew install superdurable/tap/dexcli
 *   dexcli dev -open=false      # dex gRPC on 127.0.0.1:8801
 */

import {
  Client,
  Registry,
  Worker,
  openBlobCache,
} from "@superdurable/dex";
import type { BlobCache, Flow } from "@superdurable/dex";

export const DEFAULT_DEX_SERVER_ADDRESS = "127.0.0.1:8801";

export interface DexConfig {
  serverAddress: string;
  /** Writable directory for the native blob cache. */
  blobCacheDir: string;
  maxBlobCacheBytes: number;
  /** Worker listener bind address; defaults to :8803. */
  workerBindAddress?: string;
  /**
   * Worker endpoint advertised by startFlow (dex requires it: startFlow fails
   * with "worker_target is required" without one). Defaults to the worker's
   * default bind address; override with DEX_WORKER_TARGET for remote workers.
   */
  workerTargetAddress?: string;
}

/** Default worker dispatch target; matches startDexWorker's default bind. */
export const DEFAULT_WORKER_TARGET_ADDRESS = "127.0.0.1:8803";

export function dexConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DexConfig {
  return {
    serverAddress: env.DEX_SERVER_ADDRESS?.trim() || DEFAULT_DEX_SERVER_ADDRESS,
    blobCacheDir: env.DEX_BLOB_CACHE_DIR?.trim() || ".dex-cache",
    maxBlobCacheBytes: 64 * 1024 * 1024,
    workerTargetAddress: env.DEX_WORKER_TARGET?.trim() || DEFAULT_WORKER_TARGET_ADDRESS,
  };
}

export interface DexRuntime {
  readonly registry: Registry;
  readonly cache: BlobCache;
  readonly client: Client;
  close(): Promise<void>;
}

/** Opens a Client over a Registry of flows with a native blob cache. */
export async function openDexClient(
  flows: readonly Flow<any>[],
  config: DexConfig,
): Promise<DexRuntime> {
  const registry = new Registry([...flows]);
  const cache = openBlobCache({
    directory: config.blobCacheDir,
    maxBytes: config.maxBlobCacheBytes,
  });
  const client = new Client(registry, cache, {
    serverAddress: config.serverAddress,
    workerTarget: { address: config.workerTargetAddress ?? DEFAULT_WORKER_TARGET_ADDRESS },
  });
  return {
    registry,
    cache,
    client,
    async close() {
      client.close();
      cache.close();
    },
  };
}

export interface DexWorkerHandle {
  readonly worker: Worker;
  readonly workerTargetAddress: string;
  close(): Promise<void>;
}

/** Starts a Worker serving the given flows against the dex server. */
export async function startDexWorker(
  flows: readonly Flow<any>[],
  config: DexConfig,
): Promise<DexWorkerHandle> {
  const registry = new Registry([...flows]);
  const cache = openBlobCache({
    directory: config.blobCacheDir,
    maxBytes: config.maxBlobCacheBytes,
  });
  const worker = new Worker(registry, cache, {
    serverAddress: config.serverAddress,
    bindAddress: config.workerBindAddress ?? "127.0.0.1:8803",
  });
  await worker.start();
  return {
    worker,
    workerTargetAddress: worker.workerTarget.address,
    async close() {
      await worker.close();
      cache.close();
    },
  };
}
