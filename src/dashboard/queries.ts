/**
 * Read-only query sources for the dashboard.
 *
 * Everything here is READ-ONLY: `dexcli flow search/state/history` via
 * child_process (no flow classes imported, no blob cache opened, no gRPC
 * client of our own), plain git queries, and kill-event/burn-down file reads.
 *
 * The dex seam is the CLI rather than the SDK Client deliberately: the Client
 * requires a Registry of Flow classes (importing flows/ couples this module to
 * concurrently-edited flow code) and a writable blob cache. The CLI JSON
 * surface is the same one proven for the 0(h) dispatch-log exit (BUILD_NOTES).
 * US-007 adds the ONE read-side stream exception: the envelope telemetry
 * subscriber takes an INJECTED structural readStream (the SDK composition
 * lives in scripts/serve-status.ts) — this module itself stays SDK-free and
 * the stream stays projection-only (never a correctness source).
 *
 * Each query returns a Result so the server can mark a source unavailable and
 * keep rendering the rest — never crash.
 */

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

import { burnDownFromUnknown } from "./state.js";
import type {
  BurnDownSample,
  DexHistoryWire,
  DexSearchWire,
  DexStateWire,
  GitCommitRow,
  GitWorktreeRow,
  NormalizedKillEvent,
  StreamEventMessage,
  StreamMode,
} from "./types.js";

const execFileP = promisify(execFile);

export type QueryResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export function ok<T>(value: T): QueryResult<T> {
  return { ok: true, value };
}

export function err<T = never>(error: string): QueryResult<T> {
  return { ok: false, error };
}

/**
 * Normalizes any throw into a short, actionable message (spawn ENOENT,
 * non-zero exit, timeout...). For a failed child process it reports the cause
 * (first non-empty stderr line, exit code / signal / timeout) and never echoes
 * the full argv: execFile's own message is `Command failed: <argv>\n<stderr>`,
 * and the argv can carry control characters (git log separators).
 */
export function describeError(e: unknown): string {
  if (e instanceof Error) {
    const x = e as Error & { cmd?: unknown; code?: unknown; killed?: unknown; signal?: unknown; stderr?: unknown };
    const exitFailure = typeof x.code === "number" || x.killed === true || typeof x.signal === "string";
    if (typeof x.cmd === "string" && exitFailure) {
      const stderrLine =
        typeof x.stderr === "string"
          ? x.stderr.split("\n").map((l) => l.trim()).find((l) => l.length > 0)
          : undefined;
      const cause =
        x.killed === true
          ? `command timed out or was killed${typeof x.signal === "string" ? ` (${x.signal})` : ""}`
          : typeof x.code === "number"
            ? `command exited ${x.code}`
            : `command killed by ${String(x.signal)}`;
      const msg = stderrLine === undefined ? cause : `${cause}: ${stderrLine}`;
      return msg.length > 300 ? `${msg.slice(0, 300)}...` : msg;
    }
    const msg = e.message.split("\n")[0] ?? e.message;
    return msg.length > 300 ? `${msg.slice(0, 300)}...` : msg;
  }
  return String(e);
}

async function runBin(
  bin: string,
  args: readonly string[],
  timeoutMs: number,
): Promise<string> {
  const { stdout } = await execFileP(bin, [...args], {
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
    encoding: "utf8",
  });
  return stdout;
}

// ---------------------------------------------------------------------------
// dex (read-only via dexcli)
// ---------------------------------------------------------------------------

export interface DexQueries {
  /** All flows (first page; dexcli default page size 50 is ample for v1). */
  searchFlows(): Promise<QueryResult<DexSearchWire>>;
  /** Latest durable attribute snapshot + active step executions for a flow. */
  flowState(flowId: string): Promise<QueryResult<DexStateWire>>;
  /** Full durable event stream for a flow (dispatch log + attribute upserts). */
  flowHistory(flowId: string): Promise<QueryResult<DexHistoryWire>>;
}

export interface DexCliOptions {
  /** Path to the dexcli binary. */
  bin: string;
  /** Dex FlowService host:port (passed as -server). */
  server: string;
  /** Per-invocation timeout. */
  timeoutMs: number;
}

export function dexCliQueries(options: DexCliOptions): DexQueries {
  const { bin, server, timeoutMs } = options;
  const baseArgs = ["-server", server, "-output", "json"] as const;
  return {
    async searchFlows() {
      try {
        const out = await runBin(bin, ["flow", "search", ...baseArgs], timeoutMs);
        return ok(JSON.parse(out) as DexSearchWire);
      } catch (e) {
        return err(describeError(e));
      }
    },
    async flowState(flowId) {
      try {
        const out = await runBin(bin, ["flow", "state", flowId, ...baseArgs], timeoutMs);
        return ok(JSON.parse(out) as DexStateWire);
      } catch (e) {
        return err(describeError(e));
      }
    },
    async flowHistory(flowId) {
      try {
        const out = await runBin(bin, ["flow", "history", flowId, "-all", ...baseArgs], timeoutMs);
        return ok(JSON.parse(out) as DexHistoryWire);
      } catch (e) {
        return err(describeError(e));
      }
    },
  };
}

// ---------------------------------------------------------------------------
// git (read-only)
// ---------------------------------------------------------------------------

export interface GitQueries {
  /** Recent commits across ALL branches (lease branches + integration). */
  logAll(repoRoot: string, limit: number): Promise<QueryResult<GitCommitRow[]>>;
  /** Registered worktrees with cleanliness status per path. */
  worktrees(repoRoot: string): Promise<QueryResult<GitWorktreeRow[]>>;
}

const LOG_SEP = "\x1f";
const LOG_REC = "\x1e";

export function gitQueries(gitBin = "git"): GitQueries {
  return {
    async logAll(repoRoot, limit) {
      try {
        const out = await runBin(
          gitBin,
          [
            "-C",
            repoRoot,
            "log",
            "--all",
            `--max-count=${limit}`,
            "--date=iso-strict",
            "--pretty=%H" + LOG_SEP + "%h" + LOG_SEP + "%an" + LOG_SEP + "%aI" + LOG_SEP + "%s" + LOG_SEP + "%D" + LOG_SEP + "%b" + LOG_REC,
          ],
          10_000,
        );
        return ok(parseGitLog(out));
      } catch (e) {
        return err(describeError(e));
      }
    },

    async worktrees(repoRoot) {
      try {
        const out = await runBin(
          gitBin,
          ["-C", repoRoot, "worktree", "list", "--porcelain"],
          10_000,
        );
        const rows: GitWorktreeRow[] = parseWorktreePorcelain(out).map((w) => ({ ...w, clean: null }));
        // Cleanliness: one status call per worktree (a handful of paths at most).
        await Promise.all(
          rows.map(async (row) => {
            try {
              const st = await runBin(gitBin, ["-C", row.path, "status", "--porcelain"], 10_000);
              row.clean = st.trim().length === 0;
            } catch {
              row.clean = null; // unreadable path — render unknown, never crash
            }
          }),
        );
        return ok(rows);
      } catch (e) {
        return err(describeError(e));
      }
    },
  };
}

/** Parses the `log --pretty=<LOG_SEP/LOG_REC format>` output into commit rows. */
export function parseGitLog(out: string): GitCommitRow[] {
  const commits: GitCommitRow[] = [];
  for (const record of out.split(LOG_REC)) {
    const trimmed = record.replace(/^\n+/, "").trimEnd();
    if (trimmed.length === 0) continue;
    const fields = trimmed.split(LOG_SEP);
    const sha = fields[0] ?? "";
    if (!/^[0-9a-f]{7,40}$/i.test(sha)) continue;
    const body = fields[6] ?? "";
    commits.push({
      sha,
      shortSha: fields[1] ?? sha.slice(0, 7),
      author: fields[2] ?? "",
      date: fields[3] ?? "",
      subject: fields[4] ?? "",
      refs: fields[5] ?? "",
      opId: findTrailer(body, "Operation-ID:"),
      contentHash: findTrailer(body, "Content-Hash:"),
    });
  }
  return commits;
}

/**
 * Parses `worktree list --porcelain`: blank-line separated records of
 * `worktree <path>`, `HEAD <sha>`, then `branch <ref>` | `detached` | `bare`
 * plus optional `locked` / `prunable <reason>` lines (ignored: a prunable
 * worktree keeps its row, and its cleanliness later resolves to unknown).
 * A detached HEAD reports branch "(detached)" (the GitWorktreeRow contract).
 */
export function parseWorktreePorcelain(out: string): Array<{ path: string; head: string; branch: string }> {
  const rows: Array<{ path: string; head: string; branch: string }> = [];
  let current: { path: string; head: string; branch: string } | null = null;
  const flush = () => {
    if (current !== null) rows.push(current);
    current = null;
  };
  for (const line of out.split("\n")) {
    if (line.startsWith("worktree ")) {
      flush();
      current = { path: line.slice("worktree ".length).trim(), head: "", branch: "" };
    } else if (current !== null && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length).trim();
    } else if (current !== null && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length).trim();
    } else if (current !== null && line.trim() === "detached") {
      current.branch = "(detached)";
    } else if (current !== null && line.trim() === "bare") {
      current.branch = "(bare)";
    } else if (line.trim() === "") {
      flush();
    }
  }
  flush();
  return rows;
}

/** Extracts a `Key: value` trailer line from a commit body. */
function findTrailer(body: string, key: string): string | null {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith(key)) {
      return trimmed.slice(key.length).trim();
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// kill-event + burn-down files
// ---------------------------------------------------------------------------

/**
 * Accepted file formats:
 * - JSON object `{run_id, events: [...]}` (metrics fixture style)
 * - JSON lines, one event object per line (chaos-kill sidecar style)
 * - Either kind spelling ("intent"/"completed" or "kill-intent"/"kill-completed")
 */
export async function readKillEventsFile(path: string): Promise<QueryResult<NormalizedKillEvent[]>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    return err(describeError(e));
  }
  const events: NormalizedKillEvent[] = [];
  const push = (obj: unknown) => {
    const normalized = normalizeKillEvent(obj, path);
    if (normalized !== null) events.push(normalized);
  };
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (
        parsed !== null &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { events?: unknown }).events)
      ) {
        for (const e of (parsed as { events: unknown[] }).events) push(e);
      } else {
        push(parsed);
      }
      return ok(events);
    } catch {
      // fall through to JSON-lines parsing
    }
  }
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (l.length === 0) continue;
    try {
      push(JSON.parse(l) as unknown);
    } catch {
      // skip malformed lines; a partially-written tail line must not crash us
    }
  }
  return ok(events);
}

function normalizeKillEvent(obj: unknown, source: string): NormalizedKillEvent | null {
  if (obj === null || typeof obj !== "object") return null;
  const rec = obj as Record<string, unknown>;
  const rawKind = typeof rec.kind === "string" ? rec.kind : "";
  const kind =
    rawKind === "intent" || rawKind === "kill-intent"
      ? "intent"
      : rawKind === "completed" || rawKind === "kill-completed"
        ? "completed"
        : null;
  if (kind === null) return null;
  const runId =
    typeof rec.run_id === "string" && rec.run_id.length > 0
      ? rec.run_id
      : typeof rec.runId === "string"
        ? rec.runId
        : "unknown";
  const utc = typeof rec.utc === "string" ? rec.utc : "";
  const pids = Array.isArray(rec.target_pids)
    ? rec.target_pids
    : Array.isArray(rec.killed_pids)
      ? rec.killed_pids
      : [];
  // Data contract B: `fired` = killed_pids.length > 0 on a completion. Older
  // writers omit it: derive it from an explicit killed_pids list, else unknown.
  const fired =
    kind !== "completed"
      ? null
      : typeof rec.fired === "boolean"
        ? rec.fired
        : Array.isArray(rec.killed_pids)
          ? rec.killed_pids.length > 0
          : null;
  const flowRunRaw = rec.flow_run_id ?? rec.flowRunId;
  return {
    source,
    kind,
    runId,
    utc,
    monotonicMs: typeof rec.monotonic_ms === "number" ? rec.monotonic_ms : null,
    pids: pids.filter((p): p is number => typeof p === "number"),
    signal: typeof rec.signal === "string" ? rec.signal : null,
    reason: typeof rec.reason === "string" ? rec.reason : null,
    note: typeof rec.note === "string" ? rec.note : typeof rec.notes === "string" ? rec.notes : null,
    resumed: typeof rec.resumed === "boolean" ? rec.resumed : null,
    fired,
    flowRunId: typeof flowRunRaw === "string" && flowRunRaw.length > 0 ? flowRunRaw : null,
  };
}

/**
 * Reads every existing kill-event file. Missing files are silently skipped
 * (they are optional evidence); malformed ones are reported via the result.
 */
export async function readKillEventSources(paths: readonly string[]): Promise<{
  events: NormalizedKillEvent[];
  errors: Array<{ path: string; error: string }>;
  scanned: string[];
}> {
  const events: NormalizedKillEvent[] = [];
  const errors: Array<{ path: string; error: string }> = [];
  const scanned: string[] = [];
  await Promise.all(
    paths.map(async (path) => {
      try {
        await stat(path);
      } catch {
        return; // absent — optional
      }
      scanned.push(path);
      const res = await readKillEventsFile(path);
      if (res.ok) events.push(...res.value);
      else errors.push({ path, error: res.error });
    }),
  );
  return { events, errors, scanned };
}

/**
 * Burn-down samples from an optional file (JSON array or JSON lines of
 * QueueBurnDownEvent-shaped objects). Queues in the live flow publish these
 * later (Phase 4); until then this renders "no samples".
 */
export async function readBurnDownFile(path: string): Promise<QueryResult<BurnDownSample[]>> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    return err(describeError(e));
  }
  const samples: BurnDownSample[] = [];
  const push = (obj: unknown) => {
    const sample = normalizeBurnDown(obj, path);
    if (sample !== null) samples.push(sample);
  };
  const trimmed = raw.trim();
  if (trimmed.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(trimmed);
      if (Array.isArray(arr)) for (const s of arr) push(s);
      return ok(samples);
    } catch {
      // fall through to line parsing
    }
  }
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (l.length === 0) continue;
    try {
      push(JSON.parse(l) as unknown);
    } catch {
      // skip malformed tail lines
    }
  }
  return ok(samples);
}

/**
 * Shape check (not a cast): queue must be a known kind, counts numeric. The
 * parser is shared with the history-attribute path (state.ts) so the ran/
 * not-run accounting fields cannot be dropped by one adapter and kept by the
 * other.
 */
export function normalizeBurnDown(obj: unknown, _source: string): BurnDownSample | null {
  return burnDownFromUnknown(obj);
}

/** Reads every existing burn-down file; absent files are optional. */
export async function readBurnDownSources(paths: readonly string[]): Promise<BurnDownSample[]> {
  const samples: BurnDownSample[] = [];
  await Promise.all(
    paths.map(async (path) => {
      try {
        await stat(path);
      } catch {
        return;
      }
      const res = await readBurnDownFile(path);
      if (res.ok) samples.push(...res.value);
    }),
  );
  return samples;
}

// ---------------------------------------------------------------------------
// envelope telemetry stream subscriber (US-007)
// ---------------------------------------------------------------------------

/**
 * READ-SIDE of the envelope telemetry stream (US-007, Stage 2d). The durable
 * envelope-event attribute stays the ONLY source of truth; this subscriber is
 * a live projection that replaces dexcli subprocess polling when it works.
 * Projection-only: no correctness path ever reads a stream (asserted by the
 * import/usage boundary test in src/dashboard/stream.test.ts).
 *
 * The dex seam stays injected and structural (same rationale as the dexcli
 * seam above): the caller composes the real reader over an SDK Client's
 * `readStream` (see scripts/serve-status.ts); tests inject doubles. The SDK's
 * wake-up vs failure distinction is made on the stable `ErrorSubStatus`
 * classification ("longPollTimeout"), never on human-readable text.
 */

/** One decoded stream read: the message plus the resumable token. */
export interface StreamRead {
  value: StreamEventMessage;
  resumeToken: string;
}

/**
 * Structural readStream: resolves the NEXT retained message after
 * `resumeToken`, long-polling up to `timeoutMs`. Throws when the read fails.
 */
export type EnvelopeStreamReader = (
  flowId: string,
  resumeToken: string,
  timeoutMs: number,
) => Promise<StreamRead>;

export interface EnvelopeStreamSubscriber {
  /** Follow the given flow ids (starts loops; stops loops for removed ids). */
  follow(flowIds: readonly string[]): void;
  /** Buffered stream events for one flow, in arrival order (bounded). */
  recentEvents(flowId: string): StreamEventMessage[];
  /** Current mode of one flow's source ("poll-fallback" once it has failed). */
  mode(flowId: string): StreamMode;
  /** Mode of every FOLLOWED flow (surfaced per flow in /api/state). */
  modes(): Record<string, StreamMode>;
  /** Count of buffered events per flow (render/test convenience). */
  size(flowId: string): number;
  /** Stops every loop; the buffered events remain readable. */
  stop(): void;
}

export interface EnvelopeStreamSubscriberOptions {
  /** Injected structural readStream (SDK Client method or test double). */
  read: EnvelopeStreamReader;
  /** Server-side long-poll duration per read. Default 25 s. */
  longPollMs?: number;
  /** Per-flow ring-buffer cap (oldest dropped). Default 200. */
  bufferLimit?: number;
  /** Called ONCE per failure streak (not per retry) when poll fallback engages. */
  onFallback?: (flowId: string, error: string) => void;
  /** Called when a flow's stream source recovers after a failure streak. */
  onRecover?: (flowId: string) => void;
  /** Called after each message lands in the buffer (observability/tests). */
  onEvent?: (message: StreamEventMessage) => void;
  /** First retry delay after a failed read; doubles per failure. Default 1 s. */
  retryBaseMs?: number;
  /** Upper bound of the retry delay. Default 30 s. */
  retryMaxMs?: number;
  /** Injected delay (tests); default is an unref'd setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * True when a read failure is the EXPECTED long-poll wake-up (nothing
 * arrived within the poll window): the loop continues. Stable subStatus
 * classification only — the SDK never needs to be imported here.
 */
function isLongPollWakeUp(err: unknown): boolean {
  return (err as { subStatus?: unknown } | null)?.subStatus === "longPollTimeout";
}

function describeStreamError(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message.split("\n")[0] ?? err.message;
    return msg.length > 200 ? `${msg.slice(0, 200)}...` : msg;
  }
  return String(err);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/**
 * Starts a ReadStream-based event source for `port/<flowId>/events` — one
 * long-poll loop per followed flow with resumable tokens. ANY non-wake-up
 * read failure (server down or restarting, unregistered stream, decode
 * defect) flips that flow to `poll-fallback` and notifies `onFallback` once
 * per failure streak; the retained dexcli polling path keeps serving the feed
 * meanwhile (ENGAGED fallback — asserted by tests). The loop then retries
 * with bounded exponential backoff from the same resume token, and the first
 * successful read (or long-poll wake-up) flips the flow back to `stream`, so
 * a dex restart does not silently end the live feed for the life of the
 * process.
 */
export function startEnvelopeStreamSubscriber(
  options: EnvelopeStreamSubscriberOptions,
): EnvelopeStreamSubscriber {
  const read = options.read;
  const longPollMs = options.longPollMs ?? 25_000;
  const bufferLimit = Math.max(1, options.bufferLimit ?? 200);
  const retryBaseMs = Math.max(1, options.retryBaseMs ?? 1_000);
  const retryMaxMs = Math.max(retryBaseMs, options.retryMaxMs ?? 30_000);
  const sleep = options.sleep ?? defaultSleep;

  interface LoopState {
    token: string;
    buffer: StreamEventMessage[];
    mode: StreamMode;
    /** Cleared by follow() dropping the flow and by stop(): ends the loop. */
    active: boolean;
  }
  const loops = new Map<string, LoopState>();

  function loop(flowId: string, state: LoopState): void {
    void (async () => {
      let failures = 0;
      const markHealthy = () => {
        if (state.mode === "stream") return;
        state.mode = "stream";
        failures = 0;
        options.onRecover?.(flowId);
      };
      while (state.active) {
        try {
          const res = await read(flowId, state.token, longPollMs);
          if (!state.active) return;
          markHealthy();
          state.token = res.resumeToken;
          state.buffer.push(res.value);
          if (state.buffer.length > bufferLimit) state.buffer.shift();
          options.onEvent?.(res.value);
        } catch (err) {
          if (!state.active) return;
          if (isLongPollWakeUp(err)) {
            markHealthy(); // nothing new within the window, but the source is reachable
            continue;
          }
          failures += 1;
          if (failures === 1) {
            state.mode = "poll-fallback";
            options.onFallback?.(flowId, describeStreamError(err));
          }
          await sleep(Math.min(retryMaxMs, retryBaseMs * 2 ** (failures - 1)));
        }
      }
    })();
  }

  return {
    follow(flowIds) {
      const wanted = new Set(flowIds);
      for (const [flowId, state] of loops) {
        if (!wanted.has(flowId)) {
          state.active = false;
          loops.delete(flowId);
        }
      }
      for (const flowId of flowIds) {
        if (loops.has(flowId)) continue;
        const state: LoopState = { token: "", buffer: [], mode: "stream", active: true };
        loops.set(flowId, state);
        loop(flowId, state);
      }
    },
    recentEvents(flowId) {
      return [...(loops.get(flowId)?.buffer ?? [])];
    },
    mode(flowId) {
      return loops.get(flowId)?.mode ?? "poll-fallback";
    },
    modes() {
      const out: Record<string, StreamMode> = {};
      for (const [flowId, state] of loops) out[flowId] = state.mode;
      return out;
    },
    size(flowId) {
      return loops.get(flowId)?.buffer.length ?? 0;
    },
    stop() {
      for (const state of loops.values()) state.active = false;
    },
  };
}
