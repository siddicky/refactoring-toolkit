/**
 * /api/state snapshot assembly: queries the injected dex/git seams (with TTL
 * caches), selects which flows to drill into, and hands everything to the
 * pure aggregator (state.ts). Extracted from scripts/serve-status.ts so the
 * selection and caching behaviour is testable with DexQueries/GitQueries
 * doubles, without starting a server or spawning dexcli.
 *
 * Fan-out discipline (each snapshot can otherwise spawn ~2 dexcli processes
 * per selected flow plus a search and several git calls):
 * - every source is cached by TTL AND by its in-flight promise, so concurrent
 *   /api/state requests share one query instead of each spawning their own;
 * - TTLs are not shorter than the client's poll interval, so a single polling
 *   client actually hits the caches;
 * - per-flow state and history are fetched in ONE parallel round;
 * - cache entries for flows that left the selection are evicted.
 */

import { CLIENT_POLL_MS, type StatusConfig } from "./config.js";
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
// Caches (spawn cost + dex load)
// ---------------------------------------------------------------------------

/**
 * TTL cache that also memoises the IN-FLIGHT load: concurrent callers that
 * arrive while a load is running await the same promise instead of starting
 * their own (a resolved-value-only cache lets every concurrent request miss).
 */
class AsyncTtlCache<T> {
  readonly #ttlMs: number;
  readonly #clock: () => number;
  #value: { value: T; at: number; final: boolean } | null = null;
  #inflight: Promise<T> | null = null;

  constructor(ttlMs: number, clock: () => number = Date.now) {
    this.#ttlMs = ttlMs;
    this.#clock = clock;
  }

  /**
   * `isFinal(value)` marks a loaded value that can never change (a good read of
   * a finished flow): it is served until the entry is evicted, not for one TTL.
   */
  get(load: () => Promise<T>, isFinal: (value: T) => boolean = () => false): Promise<T> {
    if (this.#value !== null && (this.#value.final || this.#clock() - this.#value.at <= this.#ttlMs)) {
      return Promise.resolve(this.#value.value);
    }
    if (this.#inflight !== null) return this.#inflight;
    const started = this.#clock();
    const promise = load().then(
      (value) => {
        this.#value = { value, at: started, final: isFinal(value) };
        this.#inflight = null;
        return value;
      },
      (error: unknown) => {
        this.#inflight = null;
        throw error;
      },
    );
    this.#inflight = promise;
    return promise;
  }
}

/**
 * A flow in one of these statuses will not change again, so a good state or
 * history read of it is kept for as long as the flow stays selected. The whole
 * headline run is selected (flow-select.ts), and without this every finished
 * child would be re-queried every poll.
 */
const FINISHED_STATUS = /COMPLETED|FAILED|TERMINATED|CANCEL/i;

/** Not shorter than the client poll interval (a shorter TTL never hits for one client). */
export const STATE_TTL_MS = CLIENT_POLL_MS + 500;
export const SEARCH_TTL_MS = CLIENT_POLL_MS + 500;
export const HISTORY_TTL_MS = 4_000;
const GIT_TTL_MS = 3_000;
const FILES_TTL_MS = 3_000;

export interface SnapshotOptions {
  cfg: StatusConfig;
  dex: DexQueries;
  git: GitQueries;
  /** Resolved per snapshot: the stream subscriber comes up asynchronously. */
  getStream?: () => EnvelopeStreamSubscriber | null;
  /** Clock seam for tests (generatedAt and every cache TTL). */
  now?: () => Date;
}

export interface Snapshotter {
  (): Promise<DashboardStateView>;
  /** Number of cached per-flow entries (eviction is observable in tests). */
  cacheSizes(): { state: number; history: number };
}

export function createSnapshotter(options: SnapshotOptions): Snapshotter {
  const { cfg, dex, git } = options;
  const getStream = options.getStream ?? (() => null);
  const now = options.now ?? (() => new Date());
  const clock = () => now().getTime();

  const searchCache = new AsyncTtlCache<Awaited<ReturnType<DexQueries["searchFlows"]>>>(SEARCH_TTL_MS, clock);
  const stateCacheByFlow = new Map<string, AsyncTtlCache<Awaited<ReturnType<DexQueries["flowState"]>>>>();
  const historyCacheByFlow = new Map<string, AsyncTtlCache<Awaited<ReturnType<DexQueries["flowHistory"]>>>>();
  const gitCache = new AsyncTtlCache<{
    commits: Awaited<ReturnType<GitQueries["logAll"]>>;
    worktrees: Awaited<ReturnType<GitQueries["worktrees"]>>;
  }>(GIT_TTL_MS, clock);
  const killCache = new AsyncTtlCache<Awaited<ReturnType<typeof readKillEventSources>>>(FILES_TTL_MS, clock);
  const burnCache = new AsyncTtlCache<Awaited<ReturnType<typeof readBurnDownSources>>>(FILES_TTL_MS, clock);

  function cacheFor<V>(map: Map<string, AsyncTtlCache<V>>, flowId: string, ttlMs: number): AsyncTtlCache<V> {
    let cache = map.get(flowId);
    if (cache === undefined) {
      cache = new AsyncTtlCache<V>(ttlMs, clock);
      map.set(flowId, cache);
    }
    return cache;
  }

  /** Drops cache entries for flows that left the selection (no unbounded growth). */
  function evictUnselected(selectedIds: ReadonlySet<string>): void {
    for (const map of [stateCacheByFlow, historyCacheByFlow]) {
      for (const flowId of [...map.keys()]) if (!selectedIds.has(flowId)) map.delete(flowId);
    }
  }

  /** The flows the last SUCCESSFUL search listed (empty until one succeeds). */
  let lastKnownFlows: DexFlowSummaryWire[] = [];

  const snapshot = async function snapshot(): Promise<DashboardStateView> {
    const stream = getStream();
    const search = await searchCache.get(() => dex.searchFlows());
    let flows: DexFlowSummaryWire[] = [];
    let dexError: string | null = null;
    if (search.ok) {
      flows = (search.value.flows ?? []).filter((f) => flowOfInterest(f.flowType ?? ""));
      lastKnownFlows = flows;
    } else {
      dexError = search.error;
      // Stale-while-error: with dex down, keep the last flows it listed. The
      // headline needs its flow to say "killed (dex down)", which is the state
      // this outage is: an empty list read "no port flow found" instead (B20).
      flows = lastKnownFlows;
    }

    // Priority selection (parents first, children under their own cap); each
    // selected flow gets state + history queries.
    const selected = selectFlows(flows, { maxFlows: cfg.maxFlows, maxChildFlows: cfg.maxChildFlows });
    const finished = (f: DexFlowSummaryWire): boolean => FINISHED_STATUS.test(f.flowStatus ?? "");
    evictUnselected(new Set(selected.map((f) => f.flowId)));

    // US-007: follow the selection with the stream subscriber; its buffered
    // events merge into the feed (projection-only; poll remains the fallback
    // while a flow's stream loop is failing — modes() reports poll-fallback).
    stream?.follow(selected.map((f) => f.flowId));
    const streamFeed: StreamEventMessage[] = stream
      ? selected.flatMap((f) => stream.recentEvents(f.flowId))
      : [];

    // State and history for every selected flow in ONE parallel round.
    const [stateEntries, historyEntries] = await Promise.all([
      Promise.all(
        selected.map(
          async (f) =>
            [
              f.flowId,
              await cacheFor(stateCacheByFlow, f.flowId, STATE_TTL_MS).get(
                () => dex.flowState(f.flowId),
                (res) => res.ok && finished(f),
              ),
            ] as const,
        ),
      ),
      Promise.all(
        selected.map(
          async (f) =>
            [
              f.flowId,
              await cacheFor(historyCacheByFlow, f.flowId, HISTORY_TTL_MS).get(
                () => dex.flowHistory(f.flowId),
                (res) => res.ok && finished(f),
              ),
            ] as const,
        ),
      ),
    ]);

    // Records of unwrapped values (null when a query failed).
    const stateMap: Record<string, DexStateWire | null> = {};
    for (const [flowId, res] of stateEntries) {
      stateMap[flowId] = res.ok ? res.value : null;
    }
    const historyMap: Record<string, DexHistoryWire | null> = {};
    for (const [flowId, res] of historyEntries) {
      historyMap[flowId] = res.ok ? res.value : null;
    }

    const [gitPair, killRes, burnRes] = await Promise.all([
      gitCache.get(async () => {
        const commits = await git.logAll(cfg.repoRoot, 200);
        const worktrees = await git.worktrees(cfg.repoRoot);
        return { commits, worktrees };
      }),
      killCache.get(() => readKillEventSources(cfg.killEventFiles)),
      burnCache.get(() => readBurnDownSources(cfg.burnDownFiles)),
    ]);

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

  return Object.assign(snapshot, {
    cacheSizes: () => ({ state: stateCacheByFlow.size, history: historyCacheByFlow.size }),
  });
}
