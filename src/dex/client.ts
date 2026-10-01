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
import type { BlobCache } from "@superdurable/dex";

import { BLOB_CACHE_DIRS, DEFAULT_DEX_SERVER_ADDRESS } from "./defaults.js";

/**
 * Any flow, whatever its start input. `Flow<I>` is invariant in `I`, so a list
 * of different flows has no common `Flow<I>`; this is dex's own element type
 * for a Registry's flows (`Registry["flows"]`).
 */
export type AnyFlow = Registry["flows"][number];

export interface DexConfig {
  serverAddress: string;
  /** Writable directory for the native blob cache. */
  blobCacheDir: string;
  maxBlobCacheBytes: number;
  /**
   * Worker listener bind address. dexConfigFromEnv fills it from
   * DEX_WORKER_BIND, else DEX_WORKER_TARGET, else
   * {@link DEFAULT_WORKER_TARGET_ADDRESS}; startDexWorker falls back to that
   * same default when a hand-built config omits it.
   */
  workerBindAddress?: string;
  /**
   * Worker endpoint advertised by startFlow (dex requires it: startFlow fails
   * with "worker_target is required" without one). Defaults to the worker's
   * default bind address; override with DEX_WORKER_TARGET for remote workers.
   */
  workerTargetAddress?: string;
}

/**
 * Default worker address, used both as the advertised dispatch target and as
 * the listener bind (the two must agree, so there is one constant).
 */
export const DEFAULT_WORKER_TARGET_ADDRESS = "127.0.0.1:8803";

/**
 * Which process the config is for. The role picks the blob cache: the worker
 * and the client commands (`demo`, `round`, ...) run at the same time in the
 * README flow, and a blob cache is never shared across processes, so each has
 * its own directory and its own variable (src/dex/defaults.ts).
 */
export type DexRole = "worker" | "client";

/**
 * Env -> config. The worker binds DEX_WORKER_BIND when set, else the same
 * address it advertises (DEX_WORKER_TARGET), else the default, so changing
 * DEX_WORKER_TARGET to dodge a busy port moves the listener with it instead of
 * advertising an address nothing listens on. Set DEX_WORKER_BIND separately
 * only when the bind differs from the advertised target (a wildcard bind such
 * as 0.0.0.0:8803 behind a remote target).
 */
export function dexConfigFromEnv(env: NodeJS.ProcessEnv, role: DexRole): DexConfig {
  const target = env.DEX_WORKER_TARGET?.trim() || undefined;
  const cacheOverride = role === "worker" ? env.DEX_BLOB_CACHE_DIR : env.DEX_CLIENT_BLOB_CACHE_DIR;
  return {
    serverAddress: env.DEX_SERVER_ADDRESS?.trim() || DEFAULT_DEX_SERVER_ADDRESS,
    blobCacheDir: cacheOverride?.trim() || BLOB_CACHE_DIRS[role],
    maxBlobCacheBytes: 64 * 1024 * 1024,
    workerTargetAddress: target ?? DEFAULT_WORKER_TARGET_ADDRESS,
    workerBindAddress: env.DEX_WORKER_BIND?.trim() || target || DEFAULT_WORKER_TARGET_ADDRESS,
  };
}

export interface DexRuntime {
  readonly registry: Registry;
  readonly cache: BlobCache;
  readonly client: Client;
  close(): Promise<void>;
}

/** Registry + native blob cache + Client, built the same way for runner and worker. */
function buildClientParts(
  flows: readonly AnyFlow[],
  config: DexConfig,
): { registry: Registry; cache: BlobCache; client: Client } {
  const registry = new Registry([...flows]);
  const cache = openBlobCache({
    directory: config.blobCacheDir,
    maxBytes: config.maxBlobCacheBytes,
  });
  try {
    const client = new Client(registry, cache, {
      serverAddress: config.serverAddress,
      workerTarget: { address: config.workerTargetAddress ?? DEFAULT_WORKER_TARGET_ADDRESS },
    });
    return { registry, cache, client };
  } catch (err) {
    cache.close();
    throw err;
  }
}

/** Opens a Client over a Registry of flows with a native blob cache. */
export async function openDexClient(
  flows: readonly AnyFlow[],
  config: DexConfig,
): Promise<DexRuntime> {
  const { registry, cache, client } = buildClientParts(flows, config);
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
  /**
   * US-002: runner-side Client over the SAME registry + blob cache as the
   * worker — used for telemetry publishes (Client.writeStream, see
   * flows/steps/envelope.ts configureEnvelopeStreamPublisher). Closed with
   * the handle.
   */
  readonly client: Client;
  close(): Promise<void>;
}

/**
 * Runs `start`; when it throws, runs every cleanup (each one's own failure is
 * ignored: the start failure is the error worth reporting) and rethrows. Used
 * so a worker that cannot start (bind failure, bad address, unreachable server)
 * does not leak its blob cache and client.
 */
export async function releaseOnFailure<T>(
  start: () => Promise<T>,
  cleanups: ReadonlyArray<() => void | Promise<void>>,
): Promise<T> {
  try {
    return await start();
  } catch (err) {
    for (const cleanup of cleanups) {
      try {
        await cleanup();
      } catch {
        // best effort: keep the original start failure
      }
    }
    throw err;
  }
}

/** Starts a Worker serving the given flows against the dex server. */
export async function startDexWorker(
  flows: readonly AnyFlow[],
  config: DexConfig,
): Promise<DexWorkerHandle> {
  const { registry, cache, client } = buildClientParts(flows, config);
  let worker: Worker | undefined;
  return releaseOnFailure(
    async () => {
      worker = new Worker(registry, cache, {
        serverAddress: config.serverAddress,
        bindAddress: config.workerBindAddress ?? DEFAULT_WORKER_TARGET_ADDRESS,
      });
      await worker.start();
      const started = worker;
      return {
        worker: started,
        workerTargetAddress: started.workerTarget.address,
        client,
        async close() {
          await started.close();
          client.close();
          cache.close();
        },
      };
    },
    [() => worker?.close(), () => client.close(), () => cache.close()],
  );
}
