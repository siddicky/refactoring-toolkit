/**
 * /api/state snapshot assembly: queries the injected dex/git seams (with TTL
 * caches), selects which flows to drill into, and hands everything to the
 * pure aggregator (state.ts). Extracted from scripts/serve-status.ts so the
 * selection and caching behaviour is testable with DexQueries/GitQueries
 * doubles, without starting a server or spawning dexcli.
 */

import type { StatusConfig } from "./config.js";
import { flowOfInterest, selectFlows } from "./flow-select.js";
import {
  readBurnDownSources,
  readKillEventSources,
  type DexQueries,
  type EnvelopeStreamSubscriber,
  type GitQueries,
} from "./queries.js";
import { buildDashboardState } from "./state.js";
import type {
  DashboardStateView,
  DexFlowSummaryWire,
  DexHistoryWire,
  DexStateWire,
  StreamEventMessage,
} from "./types.js";

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

export interface SnapshotOptions {
  cfg: StatusConfig;
  dex: DexQueries;
  git: GitQueries;
  /** Resolved per snapshot: the stream subscriber comes up asynchronously. */
  getStream?: () => EnvelopeStreamSubscriber | null;
  /** Clock seam for tests. */
  now?: () => Date;
}

export type Snapshotter = () => Promise<DashboardStateView>;

export function createSnapshotter(options: SnapshotOptions): Snapshotter {
  const { cfg, dex, git } = options;
  const getStream = options.getStream ?? (() => null);
  const now = options.now ?? (() => new Date());

  const stateCacheByFlow = new Map<string, TtlCache<Awaited<ReturnType<DexQueries["flowState"]>>>>();
  const historyCacheByFlow = new Map<string, TtlCache<Awaited<ReturnType<DexQueries["flowHistory"]>>>>();
  const gitCache = new TtlCache<{
    commits: Awaited<ReturnType<GitQueries["logAll"]>>;
    worktrees: Awaited<ReturnType<GitQueries["worktrees"]>>;
  }>(GIT_TTL_MS);
  const killCache = new TtlCache<Awaited<ReturnType<typeof readKillEventSources>>>(FILES_TTL_MS);
  const burnCache = new TtlCache<Awaited<ReturnType<typeof readBurnDownSources>>>(FILES_TTL_MS);

  function flowStateCached(flowId: string) {
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

  function flowHistoryCached(flowId: string) {
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

  return async function snapshot(): Promise<DashboardStateView> {
    const stream = getStream();
    const search = await dex.searchFlows();
    let flows: DexFlowSummaryWire[] = [];
    let dexError: string | null = null;
    if (search.ok) {
      flows = (search.value.flows ?? []).filter((f) => flowOfInterest(f.flowType ?? ""));
    } else {
      dexError = search.error;
    }

    // Priority selection (parents first, children under their own cap); each
    // selected flow gets state + history queries.
    const selected = selectFlows(flows, { maxFlows: cfg.maxFlows, maxChildFlows: cfg.maxChildFlows });

    // US-007: follow the selection with the stream subscriber; its buffered
    // events merge into the feed (projection-only; poll remains the fallback
    // while a flow's stream loop is failing — modes() reports poll-fallback).
    stream?.follow(selected.map((f) => f.flowId));
    const streamFeed: StreamEventMessage[] = stream
      ? selected.flatMap((f) => stream.recentEvents(f.flowId))
      : [];

    const stateEntries = await Promise.all(
      selected.map(async (f) => [f.flowId, await flowStateCached(f.flowId)] as const),
    );
    const historyEntries = await Promise.all(
      selected.map(async (f) => [f.flowId, await flowHistoryCached(f.flowId)] as const),
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
      : gitPair.commits.error;
    const killAvailable = killRes.scanned.length > 0 && killRes.errors.length === 0;
    const killError = killRes.errors.length > 0
      ? killRes.errors.map((e) => `${e.path}: ${e.error}`).join("; ")
      : killRes.scanned.length === 0
        ? "no sidecar files present yet"
        : null;

    return buildDashboardState({
      now: now().toISOString(),
      dex: {
        available: search.ok,
        error: dexError,
        detail: `${cfg.dexcliBin}@${cfg.dexServer}`,
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
      ...(stream !== null ? { streamModes: stream.modes() } : {}),
      feedLimit: cfg.feedLimit,
      commitLimit: cfg.commitLimit,
    });
  };
}
