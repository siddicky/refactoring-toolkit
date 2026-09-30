/**
 * Composition of the read-side envelope-stream feed for the status server.
 *
 * The status dashboard is dexcli-only (read-only CLI queries) EXCEPT for this
 * one optional projection: an SDK Client over a port.Project-only registry
 * drives the envelope telemetry subscriber (queries.ts). The Client needs a
 * native blob cache, so the feed opens its OWN cache directory: under the
 * already-gitignored `.dex-cache/` by default (`.dex-cache/dashboard`),
 * selected by the dashboard-specific STATUS_BLOB_CACHE_DIR. It deliberately
 * ignores DEX_BLOB_CACHE_DIR, which the worker shares: exporting that for the
 * worker must not collapse dashboard, watcher and worker into one directory.
 *
 * The SDK is injected (`open`), so this stays SDK-free and testable.
 */

import { mkdir } from "node:fs/promises";

import type { StatusConfig } from "./config.js";
import {
  startEnvelopeStreamSubscriber,
  type EnvelopeStreamReader,
  type EnvelopeStreamSubscriber,
} from "./queries.js";

/** What the feed needs from an opened read-side dex client. */
export interface StreamRuntime {
  /** readStream bound to the envelope stream (port/<flowId>/events). */
  read: EnvelopeStreamReader;
  /** Closes the client and its blob cache. */
  close(): Promise<void>;
}

export interface StreamFeedOptions {
  cfg: Pick<StatusConfig, "blobCacheDir" | "streamSubscribe">;
  /** Opens the read-side client over the given blob-cache directory. */
  open: (blobCacheDir: string) => Promise<StreamRuntime>;
  log?: { log: (msg: string) => void; warn: (msg: string) => void };
}

export interface StreamFeed {
  /** The live subscriber once it is up; null while starting, disabled or failed. */
  subscriber(): EnvelopeStreamSubscriber | null;
  /** Settles when startup finished (up, disabled or failed). Never rejects. */
  ready: Promise<void>;
  /** Stops the subscriber and closes the client + blob cache. Never rejects. */
  close(): Promise<void>;
}

export function startStreamFeed(options: StreamFeedOptions): StreamFeed {
  const { cfg } = options;
  const log = options.log ?? console;
  let subscriber: EnvelopeStreamSubscriber | null = null;
  let runtime: StreamRuntime | null = null;

  const ready = (async () => {
    if (!cfg.streamSubscribe) return;
    try {
      await mkdir(cfg.blobCacheDir, { recursive: true });
      runtime = await options.open(cfg.blobCacheDir);
      subscriber = startEnvelopeStreamSubscriber({
        read: runtime.read,
        onFallback: (flowId, error) => {
          log.warn(
            `[serve-status] stream fallback ENGAGED for ${flowId}: ${error} (dexcli polling continues; retrying with backoff)`,
          );
        },
        onRecover: (flowId) => {
          log.log(`[serve-status] stream recovered for ${flowId} (live feed resumed)`);
        },
      });
      log.log(`[serve-status] stream subscriber: up (port/<flowId>/events live feed; blob cache ${cfg.blobCacheDir})`);
    } catch (err) {
      log.warn(`[serve-status] stream subscriber unavailable (${(err as Error).message}) — dexcli polling only`);
    }
  })();

  return {
    subscriber: () => subscriber,
    ready,
    async close() {
      await ready;
      subscriber?.stop();
      try {
        await runtime?.close();
      } catch {
        // shutting down: nothing useful to do with a close failure
      }
    },
  };
}
