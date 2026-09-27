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
 * Launch:
 *   bun run scripts/serve-status.ts
 * Env:
 *   PORT                 (default 4646)
 *   STATUS_HOST          (default 127.0.0.1)
 *   STATUS_REPO_ROOT     (default /tmp/pk-trial — the live trial repo)
 *   DEXCLI_BIN           (default "dexcli")
 *   DEX_SERVER_ADDRESS   (default 127.0.0.1:8801)
 *   STATUS_MAX_FLOWS     (default 12 — flows that get state/history queries)
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
  readBurnDownSources,
  readKillEventSources,
  startEnvelopeStreamSubscriber,
  type DexQueries,
  type EnvelopeStreamSubscriber,
  type GitQueries,
} from "../src/dashboard/queries.js";
import type { StreamEventMessage } from "../src/dashboard/types.js";
import { openDexClient, dexConfigFromEnv } from "../src/dex/client.js";
import { envelopeStream } from "../flows/steps/envelope.js";
import { PortProjectFlow } from "../flows/port-project.js";
import { buildDashboardState } from "../src/dashboard/state.js";
import type {
  DashboardStateView,
  DexFlowSummaryWire,
  DexHistoryWire,
  DexStateWire,
} from "../src/dashboard/types.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

interface StatusConfig {
  port: number;
  host: string;
  repoRoot: string;
  dexcliBin: string;
  dexServer: string;
  maxFlows: number;
  killEventFiles: string[];
  burnDownFiles: string[];
  feedLimit: number;
  commitLimit: number;
}

function csv(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim() === "") return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function configFromEnv(env: NodeJS.ProcessEnv = process.env): StatusConfig {
  return {
    port: Number.parseInt(env.PORT ?? "4646", 10),
    host: env.STATUS_HOST?.trim() || "127.0.0.1",
    repoRoot: env.STATUS_REPO_ROOT?.trim() || "/tmp/pk-trial",
    dexcliBin: env.DEXCLI_BIN?.trim() || "dexcli",
    dexServer: env.DEX_SERVER_ADDRESS?.trim() || "127.0.0.1:8801",
    maxFlows: Number.parseInt(env.STATUS_MAX_FLOWS ?? "12", 10),
    killEventFiles: csv(env.KILL_EVENT_FILES, [
      "metrics/kill-events.json",
      "metrics/kill-events.jsonl",
      "/tmp/kill-events-phase0.jsonl",
    ]),
    burnDownFiles: csv(env.BURN_DOWN_FILES, ["metrics/burn-down.json", "metrics/burn-down.jsonl"]),
    feedLimit: 80,
    commitLimit: 40,
  };
}

// ---------------------------------------------------------------------------
// TTL caches (spawn cost + dex load; poll cadence is client-side 2s)
// ---------------------------------------------------------------------------

class TtlCache<T> {
  readonly #ttlMs: number;
  #value: T | null = null;
  #at = 0;
  constructor(ttlMs: number) {
    this.#ttlMs = ttlMs;
  }
  get(): T | null {
    return this.#value !== null && Date.now() - this.#at <= this.#ttlMs ? this.#value : null;
  }
  set(value: T): void {
    this.#value = value;
    this.#at = Date.now();
  }
}

const STATE_TTL_MS = 1_500;
const HISTORY_TTL_MS = 4_000;
const GIT_TTL_MS = 3_000;
const FILES_TTL_MS = 3_000;

const stateCacheByFlow = new Map<string, TtlCache<Awaited<ReturnType<DexQueries["flowState"]>>>>();
const historyCacheByFlow = new Map<string, TtlCache<Awaited<ReturnType<DexQueries["flowHistory"]>>>>();
const gitCache = new TtlCache<{ commits: Awaited<ReturnType<GitQueries["logAll"]>>; worktrees: Awaited<ReturnType<GitQueries["worktrees"]>> }>(GIT_TTL_MS);
const killCache = new TtlCache<Awaited<ReturnType<typeof readKillEventSources>>>(FILES_TTL_MS);
const burnCache = new TtlCache<Awaited<ReturnType<typeof readBurnDownSources>>>(FILES_TTL_MS);

function flowStateCached(dex: DexQueries, flowId: string) {
  let cache = stateCacheByFlow.get(flowId);
  if (cache === undefined) {
    cache = new TtlCache(STATE_TTL_MS);
    stateCacheByFlow.set(flowId, cache);
  }
  const fresh = cache.get();
  if (fresh !== null) return fresh;
  const promise = dex.flowState(flowId);
  void promise.then((res) => cache?.set(res)).catch(() => {});
  return promise;
}

function flowHistoryCached(dex: DexQueries, flowId: string) {
  let cache = historyCacheByFlow.get(flowId);
  if (cache === undefined) {
    cache = new TtlCache(HISTORY_TTL_MS);
    historyCacheByFlow.set(flowId, cache);
  }
  const fresh = cache.get();
  if (fresh !== null) return fresh;
  const promise = dex.flowHistory(flowId);
  void promise.then((res) => cache?.set(res)).catch(() => {});
  return promise;
}

// ---------------------------------------------------------------------------
// Snapshot aggregation
// ---------------------------------------------------------------------------

/** Flows worth querying: the porting pipeline and the Phase 0 probe flows. */
function flowOfInterest(flowType: string): boolean {
  return flowType.startsWith("port.") || flowType.startsWith("probe.");
}

async function snapshot(
  cfg: StatusConfig,
  dex: DexQueries,
  git: GitQueries,
  stream: EnvelopeStreamSubscriber | null,
): Promise<DashboardStateView> {
  const search = await dex.searchFlows();
  let flows: DexFlowSummaryWire[] = [];
  let dexError: string | null = null;
  if (search.ok) {
    flows = (search.value.flows ?? []).filter((f) => flowOfInterest(f.flowType ?? ""));
  } else {
    dexError = search.error;
  }

  // Newest-first selection; each selected flow gets state + history queries.
  const selected = [...flows]
    .sort((a, b) => Date.parse(b.startTime ?? "") - Date.parse(a.startTime ?? "") || a.flowId.localeCompare(b.flowId))
    .slice(0, Math.max(1, cfg.maxFlows));

  // US-007: follow the selection with the stream subscriber; its buffered
  // events merge into the feed (projection-only; poll remains the fallback
  // once a flow's stream loop has failed — mode() flips to poll-fallback).
  stream?.follow(selected.map((f) => f.flowId));
  const streamFeed: StreamEventMessage[] = stream
    ? selected.flatMap((f) => stream.recentEvents(f.flowId))
    : [];

  const stateEntries = await Promise.all(
    selected.map(async (f) => [f.flowId, await flowStateCached(dex, f.flowId)] as const),
  );
  const historyEntries = await Promise.all(
    selected.map(async (f) => [f.flowId, await flowHistoryCached(dex, f.flowId)] as const),
  );

  // Records of unwrapped values (null when a query failed).
  const stateMap: Record<string, DexStateWire | null> = {};
  for (const [flowId, res] of stateEntries) {
    stateMap[flowId] = res.ok ? res.value : null;
  }
  const historyMap: Record<string, DexHistoryWire | null> = {};
  for (const [flowId, res] of historyEntries) {
    historyMap[flowId] = res.ok ? res.value : null;
  }

  let gitPair = gitCache.get();
  if (gitPair === null) {
    const commits = await git.logAll(cfg.repoRoot, 200);
    const worktrees = await git.worktrees(cfg.repoRoot);
    gitPair = { commits, worktrees };
    gitCache.set(gitPair);
  }

  let killRes = killCache.get();
  if (killRes === null) {
    killRes = await readKillEventSources(cfg.killEventFiles);
    killCache.set(killRes);
  }
  let burnRes = burnCache.get();
  if (burnRes === null) {
    burnRes = await readBurnDownSources(cfg.burnDownFiles);
    burnCache.set(burnRes);
  }

  const gitAvailable = gitPair.commits.ok || gitPair.worktrees.ok;
  const gitError = gitPair.commits.ok
    ? (gitPair.worktrees.ok ? null : gitPair.worktrees.error)
    : gitPair.commits.error;  const killAvailable = killRes.scanned.length > 0 && killRes.errors.length === 0;
  const killError = killRes.errors.length > 0
    ? killRes.errors.map((e) => `${e.path}: ${e.error}`).join("; ")
    : killRes.scanned.length === 0
      ? "no sidecar files present yet"
      : null;

  return buildDashboardState({
    now: new Date().toISOString(),
    dex: {
      available: search.ok,
      error: dexError,
      detail: `dexcli ${cfg.dexcliBin}@${cfg.dexServer}`,
      flows: selected,
      states: stateMap,
      histories: historyMap,
    },
    git: {
      available: gitAvailable,
      error: gitError,
      repoRoot: cfg.repoRoot,
      commits: gitPair.commits.ok ? gitPair.commits.value : [],
      worktrees: gitPair.worktrees.ok ? gitPair.worktrees.value : [],
    },
    killEvents: {
      available: killAvailable,
      error: killError,
      filesScanned: killRes.scanned,
      events: killRes.events,
    },
    burnDownFiles: burnRes,
    streamFeed,
    feedLimit: cfg.feedLimit,
    commitLimit: cfg.commitLimit,
  });
}

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

async function handleState(
  res: ServerResponse,
  cfg: StatusConfig,
  dex: DexQueries,
  git: GitQueries,
  stream: EnvelopeStreamSubscriber | null,
): Promise<void> {
  try {
    const state = await snapshot(cfg, dex, git, stream);
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
            console.warn(`[serve-status] stream fallback ENGAGED for ${flowId}: ${error} (dexcli polling continues)`);
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

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = (req.url ?? "/").split("?")[0] ?? "/";
    if (url === "/" || url === "/index.html") {
      void handleIndex(res);
      return;
    }
    if (url === "/api/state") {
      void handleState(res, cfg, dex, git, stream);
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
