/**
 * serve-status — live status dashboard server (plan v6.1 user-approved scope).
 *
 * READ-ONLY mission control over the porting run:
 *   GET /           static page (src/dashboard/static/index.html, inline CSS/JS)
 *   GET /api/state  aggregated JSON snapshot (dex + git + kill events)
 *
 * dex is queried through the dexcli CLI (`flow search/state/history`, JSON
 * output) — never startFlow, never a flow-mutating call. US-007 adds one
 * read-side stream exception: an SDK Client over a port.Project-only registry
 * feeds the envelope telemetry subscriber (STATUS_STREAM_SUBSCRIBE=0 opts
 * out); the stream stays projection-only and dexcli polling remains the
 * fallback. Git queries are plain `git log --all` / `git worktree list`
 * against STATUS_REPO_ROOT. Every source failure degrades that section to an
 * "unavailable" state; the server itself never crashes on missing data.
 *
 * Snapshot assembly, flow selection and env parsing live in src/dashboard/
 * (snapshot.ts, flow-select.ts, config.ts) so they are testable; this script
 * is the HTTP shell plus the stream-subscriber composition.
 *
 * Launch:
 *   bun run scripts/serve-status.ts
 * Env:
 *   PORT                 (default 4646)
 *   STATUS_HOST          (default 127.0.0.1)
 *   STATUS_REPO_ROOT     (default /tmp/pk-trial — the live trial repo)
 *   DEXCLI_BIN           (default "dexcli")
 *   DEX_SERVER_ADDRESS   (default 127.0.0.1:8801)
 *   STATUS_MAX_FLOWS     (default 12 — flows that get state/history queries;
 *                         the newest port.Project parent(s) are always kept)
 *   STATUS_MAX_CHILD_FLOWS (default 8 — SubFlow port.File children within
 *                         that budget)
 *   KILL_EVENT_FILES     (default metrics/kill-events.json,metrics/kill-events.jsonl,/tmp/kill-events-phase0.jsonl)
 *   BURN_DOWN_FILES      (default metrics/burn-down.json,metrics/burn-down.jsonl)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  dexCliQueries,
  gitQueries,
  startEnvelopeStreamSubscriber,
  type EnvelopeStreamSubscriber,
} from "../src/dashboard/queries.js";
import { configFromEnv } from "../src/dashboard/config.js";
import { createSnapshotter, type Snapshotter } from "../src/dashboard/snapshot.js";
import { openDexClient, dexConfigFromEnv } from "../src/dex/client.js";
import { envelopeStream } from "../flows/steps/envelope.js";
import { PortProjectFlow } from "../flows/port-project.js";

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/dashboard/static");
let lastGoodHtml: Buffer | null = null;

async function handleIndex(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(join(STATIC_DIR, "index.html"));
    lastGoodHtml = html;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  } catch {
    if (lastGoodHtml !== null) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(lastGoodHtml);
      return;
    }
    res.writeHead(500, { "content-type": "text/plain" });
    res.end("dashboard page missing: src/dashboard/static/index.html");
  }
}

async function handleState(res: ServerResponse, snapshot: Snapshotter): Promise<void> {
  try {
    const state = await snapshot();
    res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(state));
  } catch (e) {
    // Aggregation itself must never take the server down.
    const message = e instanceof Error ? e.message : String(e);
    res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: `snapshot failed: ${message}` }));
  }
}

export function main(): void {
  const cfg = configFromEnv();
  const dex = dexCliQueries({ bin: cfg.dexcliBin, server: cfg.dexServer, timeoutMs: 15_000 });
  const git = gitQueries("git");

  // US-007 (Stage 2d): ReadStream event source for port/<flowId>/events.
  // The read-side client registers EXACTLY the flow type that owns the
  // envelope stream (port.Project — one-flow stream ownership) and uses its
  // OWN blob-cache directory (per-process sharing is the guidance). Fail-open:
  // when the client cannot open, the dashboard runs on dexcli polling alone
  // (the poll fallback that stays ENGAGED on any subscriber failure anyway).
  let stream: EnvelopeStreamSubscriber | null = null;
  if (process.env.STATUS_STREAM_SUBSCRIBE !== "0") {
    void (async () => {
      try {
        const config = {
          ...dexConfigFromEnv(),
          blobCacheDir: process.env.DEX_BLOB_CACHE_DIR?.trim() || ".dex-cache-dashboard",
        };
        const runtime = await openDexClient([new PortProjectFlow()], config);
        stream = startEnvelopeStreamSubscriber({
          read: (flowId, resumeToken, timeoutMs) =>
            runtime.client.readStream(flowId, envelopeStream, resumeToken, timeoutMs),
          onFallback: (flowId, error) => {
            console.warn(`[serve-status] stream fallback ENGAGED for ${flowId}: ${error} (dexcli polling continues; retrying with backoff)`);
          },
          onRecover: (flowId) => {
            console.log(`[serve-status] stream recovered for ${flowId} (live feed resumed)`);
          },
        });
        console.log("[serve-status] stream subscriber: up (port/<flowId>/events live feed)");
      } catch (err) {
        console.warn(
          `[serve-status] stream subscriber unavailable (${(err as Error).message}) — dexcli polling only`,
        );
      }
    })();
  }

  const snapshot = createSnapshotter({ cfg, dex, git, getStream: () => stream });

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? "/").split("?")[0] ?? "/";
    if (url === "/" || url === "/index.html") {
      void handleIndex(res);
      return;
    }
    if (url === "/api/state") {
      void handleState(res, snapshot);
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found (routes: GET /, GET /api/state)");
  });

  server.on("error", (e: Error) => {
    console.error(`[serve-status] server error: ${e.message}`);
    process.exit(1);
  });
  server.listen(cfg.port, cfg.host, () => {
    console.log(
      `[serve-status] http://${cfg.host}:${cfg.port}/  (repo=${cfg.repoRoot} dex=${cfg.dexServer} poll=2s; Ctrl-C stops)`,
    );
  });
  const shutdown = () => {
    stream?.stop();
    server.close(() => process.exit(0));
    // Hard stop if a connection lingers.
    setTimeout(() => process.exit(0), 1_500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main();
