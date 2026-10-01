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
 * Only GET/HEAD are served and the Host header must be allow-listed
 * (DNS-rebinding guard, see src/dashboard/server.ts). There is no
 * authentication: keep the default loopback bind.
 *
 * Snapshot assembly, flow selection, env parsing, the HTTP guard and the
 * stream-feed composition live in src/dashboard/ (snapshot.ts,
 * flow-select.ts, config.ts, server.ts, stream-feed.ts) so they are testable;
 * this script only wires the real dexcli/git/SDK seams to them.
 *
 * Launch:
 *   bun run scripts/serve-status.ts
 * It takes no command-line arguments: configuration is environment-only, and
 * any argument is a usage error (exit 64, shared layer in src/cli/args.ts;
 * `--help` prints the generated usage). A typo such as `--port 5000` used to be
 * ignored silently while the server bound the default port.
 * Env (numeric values are validated; an invalid one falls back to its
 * default with a startup warning):
 *   STATUS_PORT          (default 4646; the generic PORT is a deprecated
 *                         fallback used only when STATUS_PORT is unset)
 *   STATUS_HOST          (default 127.0.0.1; a non-loopback value warns — no
 *                         authentication)
 *   STATUS_ALLOWED_HOSTS (csv of extra hostnames accepted in the Host header;
 *                         loopback names and the bind address always are)
 *   STATUS_REPO_ROOT     (default: the working directory — set it to the
 *                         porting TARGET repo whose commits/worktrees to show)
 *   DEXCLI_BIN           (default "dexcli")
 *   DEX_SERVER_ADDRESS   (default 127.0.0.1:8801)
 *   STATUS_MAX_FLOWS     (default 12 — flows that get state/history queries;
 *                         the newest port.Project parent(s) are always kept)
 *   STATUS_MAX_CHILD_FLOWS (default 8 — SubFlow port.File children within
 *                         that budget)
 *   STATUS_STREAM_SUBSCRIBE (default on; 0 = dexcli polling only, no SDK
 *                         client and no blob cache)
 *   STATUS_BLOB_CACHE_DIR (default .dex-cache/dashboard — the stream
 *                         subscriber's OWN blob cache, under the gitignored
 *                         .dex-cache/; the worker's DEX_BLOB_CACHE_DIR is
 *                         deliberately not read)
 *   KILL_EVENT_FILES     (default metrics/kill-events.jsonl,
 *                         metrics/kill-events.json,kill-events.json — paths
 *                         relative to the working directory; the first is the
 *                         data-contract default, the others are legacy names)
 *   BURN_DOWN_FILES      (default metrics/burn-down.json,metrics/burn-down.jsonl)
 */

import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { defineCli, parseOptions, reportParseFailure } from "../src/cli/args.js";
import { dexCliQueries, gitQueries } from "../src/dashboard/queries.js";
import { CLIENT_POLL_MS, configFromEnv } from "../src/dashboard/config.js";
import { allowedHostsFor, createDashboardServer } from "../src/dashboard/server.js";
import { createSnapshotter } from "../src/dashboard/snapshot.js";
import { startStreamFeed } from "../src/dashboard/stream-feed.js";
import { openDexClient, dexConfigFromEnv } from "../src/dex/client.js";
import { envelopeStream } from "../flows/steps/envelope.js";
import { PortProjectFlow } from "../flows/port-project.js";

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../src/dashboard/static");

/** serve-status has no options: everything is configured through the environment (see above). */
export const SERVE_STATUS_CLI = defineCli({
  name: "serve-status.ts",
  summary: "Read-only live status dashboard for the porting run (HTTP, default http://127.0.0.1:4646/).",
  options: {},
  notes: [
    "It is configured through environment variables only (STATUS_PORT, STATUS_HOST, STATUS_REPO_ROOT, DEXCLI_BIN, DEX_SERVER_ADDRESS, ...); the full list is in the header of scripts/serve-status.ts.",
  ],
});

export function main(): void {
  const cfg = configFromEnv();
  for (const warning of cfg.warnings) console.warn(`[serve-status] config: ${warning}`);
  const dex = dexCliQueries({ bin: cfg.dexcliBin, server: cfg.dexServer, timeoutMs: 15_000 });
  const git = gitQueries("git");

  // US-007 (Stage 2d): ReadStream event source for port/<flowId>/events.
  // The read-side client registers EXACTLY the flow type that owns the
  // envelope stream (port.Project — one-flow stream ownership) and uses its
  // OWN blob-cache directory under .dex-cache/ (STATUS_BLOB_CACHE_DIR; never
  // the worker's DEX_BLOB_CACHE_DIR). Fail-open: when the client cannot open,
  // the dashboard runs on dexcli polling alone (the poll fallback that stays
  // ENGAGED on any subscriber failure anyway). See src/dashboard/stream-feed.ts.
  const feed = startStreamFeed({
    cfg,
    open: async (blobCacheDir) => {
      const runtime = await openDexClient([new PortProjectFlow()], { ...dexConfigFromEnv(), blobCacheDir });
      return {
        read: (flowId, resumeToken, timeoutMs) =>
          runtime.client.readStream(flowId, envelopeStream, resumeToken, timeoutMs),
        close: () => runtime.close(),
      };
    },
  });

  const snapshot = createSnapshotter({ cfg, dex, git, getStream: feed.subscriber });
  const server = createDashboardServer({
    snapshot,
    staticDir: STATIC_DIR,
    allowedHosts: allowedHostsFor(cfg.host, cfg.allowedHosts),
  });

  server.on("error", (e: Error) => {
    console.error(`[serve-status] server error: ${e.message}`);
    process.exit(1);
  });
  server.listen(cfg.port, cfg.host, () => {
    const { port } = server.address() as AddressInfo;
    console.log(
      `[serve-status] http://${cfg.host}:${port}/  (repo=${cfg.repoRoot} dex=${cfg.dexServer} poll=${CLIENT_POLL_MS / 1000}s; Ctrl-C stops)`,
    );
  });
  const shutdown = () => {
    // Stop the subscriber and close the read-side client + its blob cache.
    void feed.close();
    server.close(() => process.exit(0));
    // Hard stop if a connection lingers.
    setTimeout(() => process.exit(0), 1_500).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Only start the server when executed directly: importing this module must not bind a port.
if (import.meta.main) {
  const parsed = parseOptions(SERVE_STATUS_CLI, process.argv.slice(2));
  if (!parsed.ok) process.exit(reportParseFailure("serve-status", parsed));
  main();
}
