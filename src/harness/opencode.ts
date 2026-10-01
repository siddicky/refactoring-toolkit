/**
 * Seam over the opencode server (@opencode-ai/sdk) — sessions, token usage,
 * abort, and the session-fencing primitives.
 *
 * opencode is pre-release: this module is the single place that touches its
 * SDK; exact version pinned in package.json and matched to the installed CLI.
 *
 * Fencing rule (plan §State ownership): every agent step persists its
 * opencode session ID (epoch-tagged label) to a DURABLE ATTRIBUTE BEFORE
 * prompting. Ordered recovery: epoch bump → abort+confirm persisted session
 * (or enumeration fallback) → lease reclaim → reconcile → re-dispatch.
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";
import { AttributeMap, jsonCodec } from "@superdurable/dex";
import { envString } from "../env.js";
import { sanitizeFileKey } from "../file-keys.js";

// ---------------------------------------------------------------------------
// Durable session-fence attribute (source of truth for fencing)
// ---------------------------------------------------------------------------

export interface SessionFence {
  /** opencode session ID persisted BEFORE the first prompt is sent. */
  sessionId: string;
  /** Owning step ID (agent step that created the session). */
  stepId: string;
  /** Fencing epoch at creation time. */
  epoch: number;
  /** Human-auditable epoch-tagged label: `porting-kit:<file>#<round>#<epoch>`. */
  label: string;
  persistedAtUtc: string;
}

/** AttributeMap instance; flows must include it via persistenceAttributes(). */
export const sessionFenceMap = new AttributeMap<SessionFence>(
  "session-fence",
  jsonCodec<SessionFence>(),
);

/** Every session the toolkit creates carries this title prefix (fence label). */
export const PORTING_KIT_LABEL_PREFIX = "porting-kit:";

/** AttributeMap instance keys prohibit `/`, so file paths are sanitized. */
export function fenceLabel(file: string, round: number, epoch: number): string {
  return `${PORTING_KIT_LABEL_PREFIX}${sanitizeFileKey(file)}#${round}#${epoch}`;
}

/**
 * Inverse of {@link fenceLabel}: `porting-kit:<file>#<round>#<epoch>` ->
 * its parts, or null when the title is not a well-formed fence label. The
 * `<file>` part is greedy so a `#` inside a file name cannot steal the
 * trailing round/epoch segments.
 */
export function parseFenceLabel(
  title: string,
): { file: string; round: number; epoch: number } | null {
  if (!title.startsWith(PORTING_KIT_LABEL_PREFIX)) return null;
  const m = /^(.*)#(\d+)#(\d+)$/.exec(title.slice(PORTING_KIT_LABEL_PREFIX.length));
  if (m === null) return null;
  return { file: m[1] as string, round: Number(m[2]), epoch: Number(m[3]) };
}

/**
 * Recovery fence predicate: true for a session the toolkit created
 * (`porting-kit:` prefix) that does not belong to `epoch`. The epoch is the
 * parsed label segment compared exactly — never a substring test, which also
 * matched the round segment and longer epochs.
 */
function isStaleToolkitSession(title: string, epoch: number): boolean {
  if (!title.startsWith(PORTING_KIT_LABEL_PREFIX)) return false;
  const parsed = parseFenceLabel(title);
  return parsed === null || parsed.epoch !== epoch;
}

// ---------------------------------------------------------------------------
// Token usage (required for model-calling steps; provenance failure if absent)
// ---------------------------------------------------------------------------

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export function tokenTotal(usage: TokenUsage): number {
  return usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

export interface PromptResult {
  text: string;
  usage: TokenUsage | null;
  /**
   * The turn ended in MessageAbortedError (the session was aborted, e.g. by
   * ordered recovery's fence). The reply is returned, not thrown, so the flow
   * (runAgentTurn) decides; text/usage are whatever the turn produced.
   */
  aborted: boolean;
}

export interface PromptOptions {
  /**
   * Per-tool overrides merged into the prompt body (opencode `tools` map).
   * The harness bridge passes DENY-authoritative maps so reviewer turns run
   * with every tool disabled SERVER-SIDE, not just in the prompt text.
   */
  tools?: Record<string, boolean>;
  /** opencode agent name; defaults to OPENCODE_AGENT env or server default. */
  agent?: string;
  /**
   * Per-turn model override (lane swap, wave-5): when set, THIS turn runs on
   * the given provider/model instead of the harness default — e.g. reviewer
   * turns on `nano-gpt/openai/gpt-6-luna` while implementer/fixer run on the
   * executor lane (zai-coding-plan/glm-5.3-flash). Lane policy lives in
   * lanes.ts. Takes precedence over the constructor model.
   */
  model?: { providerID: string; modelID: string };
  /**
   * Per-turn reasoning variant (opencode per-model effort ladder — server
   * 1.18.32 accepts `variant` on the prompt body; the SDK type lags, hence
   * the cast at the call site). e.g. glm models: "low" | "high" | "max".
   * Lane policy lives in lanes.ts.
   */
  variant?: string;
}

/** Default window prompt() polls for a completed assistant reply (0(g) provenance): 15 min. */
export const DEFAULT_PROMPT_WAIT_MS = 900_000;
/** Default hard ceiling on ONE SDK prompt call: 20 min. */
export const DEFAULT_PROMPT_CALL_TIMEOUT_MS = 1_200_000;
/** Gap between polls of a usage-less prompt. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;

/**
 * m4: invalid values fall back to `fallbackMs`: anything that is not whole
 * digits (a unit suffix such as `20m`, a fraction, an exponent, a sign, hex),
 * zero, or above 24h. A valid value is used exactly as given, never scaled.
 * parseInt would read `20m` as 20 and `1e6` as 1 and arm a ceiling of a few
 * milliseconds on every prompt call, the opposite of "uses the default" (B24).
 */
export function parseWaitMs(raw: string | undefined, fallbackMs: number): number {
  const text = (raw ?? "").trim();
  if (!/^\d+$/.test(text)) return fallbackMs;
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 24 * 60 * 60_000) {
    return fallbackMs;
  }
  return parsed;
}

/** OPENCODE_PROMPT_WAIT_MS, read at call time; default 15 minutes. */
export function promptWaitMs(): number {
  return parseWaitMs(envString("OPENCODE_PROMPT_WAIT_MS"), DEFAULT_PROMPT_WAIT_MS);
}

/**
 * Hard ceiling on ONE SDK prompt call (a live finding, 2026-09-26):
 * opencode can hold the session.prompt HTTP call open indefinitely after the
 * assistant message has completed server-side — the turn hangs, heartbeats
 * keep the step alive, and the flow stalls. Race the call against this
 * deadline and fail RETRYABLE so dex re-dispatches on a fresh attempt.
 * OPENCODE_PROMPT_CALL_TIMEOUT_MS, read at call time; default 20 minutes.
 */
export function promptCallTimeoutMs(): number {
  return parseWaitMs(envString("OPENCODE_PROMPT_CALL_TIMEOUT_MS"), DEFAULT_PROMPT_CALL_TIMEOUT_MS);
}

/**
 * Races `work` against a deadline that rejects with `onDeadline()`. The timer
 * is unref'd and cleared as soon as either side settles.
 */
function withDeadline<T>(work: Promise<T>, timeoutMs: number, onDeadline: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onDeadline()), timeoutMs);
    void (timer as unknown as { unref?: () => void }).unref?.();
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** Races one promise against the prompt-call deadline (retryable timeout). */
function withCallTimeout<T>(promise: Promise<T>, what: string, timeoutMs: number): Promise<T> {
  return withDeadline(
    promise,
    timeoutMs,
    () => new OpencodePromptError(`SDK call timed out after ${timeoutMs}ms (${what})`, true),
  );
}

/**
 * Optional per-harness knobs. Unset fields resolve at call time from the
 * environment (wait / call timeout) or the defaults above, so tests and
 * operators can shrink them without touching module state.
 */
export interface OpencodeHarnessOptions {
  /** Server base URL this harness talks to (informational; set by connect()). */
  baseUrl?: string | undefined;
  /** Poll window for a usage-less prompt (default OPENCODE_PROMPT_WAIT_MS / 15 min). */
  waitMs?: number | undefined;
  /** Hard ceiling on one session.prompt call (default OPENCODE_PROMPT_CALL_TIMEOUT_MS / 20 min). */
  callTimeoutMs?: number | undefined;
  /** Gap between polls (default 5 s). */
  pollIntervalMs?: number | undefined;
}

/**
 * Typed failure for one prompt turn. `retryable` failures (upstream aborts,
 * empty native-tool replies) should be retried on a FRESH session by the
 * caller (dex step retry); non-retryable means the reply completed but
 * carried no usage — a provenance failure for model-calling steps.
 *
 * `usage` carries the provider usage of the failed turn when the failure
 * shape exposed it (the Tier-0 degenerate signature reports usage with no
 * text) — US-006 exhaustion tombstones anchor these tokens; null when the
 * turn produced nothing measurable.
 */
export class OpencodePromptError extends Error {
  readonly retryable: boolean;
  readonly usage: TokenUsage | null;
  constructor(message: string, retryable: boolean, usage: TokenUsage | null = null) {
    super(message);
    this.name = "OpencodePromptError";
    this.retryable = retryable;
    this.usage = usage;
  }
}

/**
 * Tier-0 degenerate-turn predicate (US-002, plan v5.1 §Stage 1).
 *
 * Degenerate shape (BUILD_NOTES §WAVE-4, live-signature): the assistant
 * message "completes" WITH token usage but carries NO text part (0-16 output
 * tokens, heavy reasoning) — the provider answered nothing while reporting a
 * finished turn. Usage-present means the seam's poll loop is skipped (fast
 * path), so the reply would otherwise flow through to verdict parsing and
 * fail there, burning all dex retries on a poisoned cache prefix.
 *
 * Pure and deliberately NARROW: the ≤8-output-token arm explored in planning
 * is DROPPED — it misclassifies a healthy text-present/output-0 reply.
 * Aborted no-text turns are excluded (they are the recovery path, handled at
 * flows/port-project.ts runAgentTurn).
 */
export function degenerateReply(
  usage: TokenUsage | null,
  textOut: string,
  aborted: boolean,
): boolean {
  return usage !== null && textOut.length === 0 && aborted !== true;
}

/** Error message for a detected degenerate turn (notes the observed shape). */
function degenerateTurnMessage(usage: TokenUsage | null): string {
  return usage === null
    ? "degenerate turn: completed reply carries no text part and no usage (Tier-0 shape)"
    : `degenerate turn: reply completed with usage (output=${usage.output}, reasoning=${usage.reasoning}) but NO text part — Tier-0 degenerate-turn signature; retry on a fresh attempt`;
}

/**
 * Extracts the upstream error of an assistant message, if any.
 * ODW finding (live-verified): session.prompt RESOLVES (does not throw) with
 * info.error set when the upstream provider fails — callers must check.
 */
function upstreamErrorOf(info: unknown): string | null {
  if (typeof info !== "object" || info === null) return null;
  const err = (info as { error?: unknown }).error;
  if (err === undefined || err === null) return null;
  const e = err as { name?: unknown; message?: unknown };
  const name = typeof e.name === "string" ? e.name : "UnknownError";
  const message = typeof e.message === "string" ? e.message : "";
  return message.length > 0 ? `${name}: ${message}` : name;
}

export interface SessionRef {
  id: string;
  title: string;
}

const DEFAULT_OPENCODE_BASE_URL = "http://127.0.0.1:4096";

/** How long probe() waits for the server to answer `session.list`. */
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

/** Outcome of {@link OpencodeHarness.probe}: reachable, or why not. */
export type ProbeResult = { ok: true } | { ok: false; reason: string };

/**
 * Structural interface used by durable agent steps, so flows can run against
 * the real harness or an explicit test double (never silently).
 */
export interface AgentSessionClient {
  createSession(label: string): Promise<SessionRef>;
  prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult>;
  /** Enumeration fallback orchestration used by ordered recovery. */
  abortSessionsNotTagged(epoch: number): Promise<string[]>;
}

export class OpencodeHarness {
  readonly #client: OpencodeClient;
  readonly #model: { providerID: string; modelID: string } | undefined;
  /** Default opencode agent for turns (OPENCODE_AGENT env), if configured. */
  readonly defaultAgent: string | undefined;
  /** Server base URL when built through connect(); undefined for a bare client. */
  readonly baseUrl: string | undefined;
  readonly #options: OpencodeHarnessOptions;

  constructor(
    client: OpencodeClient,
    model?: { providerID: string; modelID: string } | undefined,
    defaultAgent?: string | undefined,
    options: OpencodeHarnessOptions = {},
  ) {
    this.#client = client;
    this.#model = model;
    this.defaultAgent = defaultAgent;
    this.baseUrl = options.baseUrl;
    this.#options = options;
  }

  /**
   * Builds the SDK client for `baseUrl`. Performs NO I/O and cannot fail for
   * an unreachable or malformed server — use {@link probe} (or
   * selectHarness in select.ts) to learn whether the server answers.
   */
  static async connect(
    baseUrl: string = DEFAULT_OPENCODE_BASE_URL,
    model?: { providerID: string; modelID: string } | undefined,
  ): Promise<OpencodeHarness> {
    const client = createOpencodeClient({ baseUrl } as never);
    // Blank is unset, like every other variable (src/env.ts): a blank value used to become the
    // agent named "" and every prompt carried `agent: ""`.
    const defaultAgent = envString("OPENCODE_AGENT");
    return new OpencodeHarness(client, model, defaultAgent, { baseUrl });
  }

  /**
   * Reachability check: one `session.list` against the server, bounded by
   * `timeoutMs`. connect() builds a client without touching the network, so
   * this is the only way to learn that the server answers. Never throws: a
   * connection error, a non-2xx answer, an unexpected payload and a hang are
   * all reported as `{ ok: false, reason }`.
   */
  async probe(timeoutMs: number = DEFAULT_PROBE_TIMEOUT_MS): Promise<ProbeResult> {
    try {
      const res = (await withDeadline(
        this.#client.session.list(),
        timeoutMs,
        () => new Error(`no response to session.list within ${timeoutMs}ms`),
      )) as { error?: unknown; response?: { status?: number } } | undefined;
      if (res?.error !== undefined) {
        const status = res.response?.status;
        return { ok: false, reason: `server answered ${status === undefined ? "with an error" : `HTTP ${status}`}` };
      }
      if (!Array.isArray(unwrap(res))) {
        return { ok: false, reason: "session.list did not return a session array (not an opencode server?)" };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Creates a session with an epoch-tagged label as its title (fencing tag). */
  async createSession(label: string): Promise<SessionRef> {
    const res = await this.#client.session.create({
      body: { title: label },
    });
    const session = unwrap<{ id?: string; title?: string } | undefined>(res);
    if (session === undefined || typeof session.id !== "string") {
      throw new Error(`opencode session.create returned no session (label=${label})`);
    }
    return { id: session.id, title: session.title ?? label };
  }

  /**
   * Sends one prompt and waits for the assistant reply. Returns extracted
   * token usage; `usage === null` means the server never exposed usage and is
   * a PROVENANCE FAILURE for model-calling steps (never zero).
   *
   * Pre-release reality (observed live): session.prompt may resolve while the
   * model is still working (queued or long-reasoning turns) with a payload
   * that carries no tokens. To keep provenance honest, poll the session's
   * messages until the assistant reply completes (or aborts) instead of
   * returning an immediate null.
   */
  async prompt(sessionId: string, text: string, opts?: PromptOptions): Promise<PromptResult> {
    const agent = opts?.agent ?? this.defaultAgent;
    const model = opts?.model ?? this.#model;
    const waitMs = this.#options.waitMs ?? promptWaitMs();
    const callTimeoutMs = this.#options.callTimeoutMs ?? promptCallTimeoutMs();
    const pollIntervalMs = this.#options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const res = await withCallTimeout(
      this.#client.session.prompt({
        path: { id: sessionId },
        body: {
          ...(model !== undefined ? { model } : {}),
          ...(agent !== undefined ? { agent } : {}),
          ...(opts?.tools !== undefined ? { tools: opts.tools } : {}),
          ...(opts?.variant !== undefined ? { variant: opts.variant } : {}),
          parts: [{ type: "text", text }],
        },
      } as never),
      `session.prompt (session=${sessionId})`,
      callTimeoutMs,
    );
    const data = unwrap(res) as
      | { info?: unknown; parts?: unknown }
      | undefined;
    if (data === undefined) {
      throw new Error(`opencode prompt returned no message (session=${sessionId})`);
    }
    // ODW finding 1: prompt RESOLVES with info.error on upstream failure —
    // bail immediately instead of burning the poll window on a stuck turn.
    // An abort ALSO arrives as info.error (MessageAbortedError) but is not an
    // upstream failure: classify it first, or `aborted` could never be true
    // (upstreamErrorOf would throw on it before hasAbortedError ran).
    let aborted = hasAbortedError(data.info);
    const immediateError = aborted ? null : upstreamErrorOf(data.info);
    if (immediateError !== null) {
      throw new OpencodePromptError(`upstream failure: ${immediateError}`, true);
    }
    let usage = extractTokenUsage(data.info);
    let textOut = extractText(data.parts);

    if (usage === null && !aborted) {
      const deadline = Date.now() + waitMs;
      let polls = 0;
      while (usage === null && !aborted && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
        polls++;
        let last: { info: unknown; parts: unknown } | undefined;
        try {
          last = await this.latestAssistantMessage(sessionId);
        } catch (err) {
          console.error(`[opencode] poll ${polls} (session=${sessionId}) messages error: ${(err as Error).message}`);
          continue;
        }
        if (polls % 12 === 1) {
          console.error(
            `[opencode] poll ${polls} (session=${sessionId}) last=${last === undefined ? "none" : "assistant-present"} usage=${JSON.stringify(usage)} deadline-in=${Math.round((deadline - Date.now()) / 1000)}s`,
          );
        }
        if (last === undefined) continue;
        const turnAborted = hasAbortedError(last.info);
        const turnError = turnAborted ? null : upstreamErrorOf(last.info);
        if (turnError !== null) {
          throw new OpencodePromptError(`upstream failure: ${turnError}`, true);
        }
        usage = extractTokenUsage(last.info);
        aborted = turnAborted;
        const completed = extractText(last.parts);
        if (completed.length > 0) textOut = completed;
      }
      console.error(
        `[opencode] poll loop exit (session=${sessionId}) usage=${usage === null ? "null" : "present"} aborted=${aborted} waitedMs=${Date.now() - (deadline - waitMs)}`,
      );
      if (usage === null && !aborted) {
        if (textOut.length === 0) {
          // ODW finding 2: empty replies from native-tool turns are their own
          // retryable failure class (distinct from completed-but-unusaged).
          throw new OpencodePromptError("empty reply without usage (native-tool turn)", true);
        }
        // Completed reply, no usage exposed: provenance failure (never zero).
        // Tier-0 guard (defensive here: usage is statically null, so the
        // predicate cannot fire — kept so BOTH prompt() exits carry the
        // no-degenerate-return invariant).
        if (degenerateReply(usage, textOut, aborted)) {
          throw new OpencodePromptError(degenerateTurnMessage(usage), true, usage);
        }
        return { text: textOut, usage: null, aborted: false };
      }
      // Tier-0 guard: a usage-present, text-empty, non-aborted reply is the
      // WAVE-4 degenerate provider signature — fail RETRYABLE here so dex
      // re-dispatches (with the attempt-based reviewer-lane demotion) instead
      // of burning every retry on verdict-parse failures downstream.
      if (degenerateReply(usage, textOut, aborted)) {
        throw new OpencodePromptError(degenerateTurnMessage(usage), true, usage);
      }
      return { text: textOut, usage, aborted };
    }
    // Tier-0 guard (fast path): a usage-present reply skips the poll loop
    // entirely, so the WAVE-4 degenerate signature (completed + usage, NO
    // text part) surfaces HERE. Fail RETRYABLE so dex re-dispatches on a
    // fresh attempt (with the attempt-based reviewer-lane demotion) instead
    // of burning every retry on downstream verdict-parse failures.
    if (degenerateReply(usage, textOut, aborted)) {
      throw new OpencodePromptError(degenerateTurnMessage(usage), true, usage);
    }
    return { text: textOut, usage, aborted };
  }

  /** Newest assistant message of a session, or undefined when none exists. */
  async latestAssistantMessage(sessionId: string): Promise<{ info: unknown; parts: unknown } | undefined> {
    const res = await this.#client.session.messages({ path: { id: sessionId } } as never);
    const data = unwrap(res) as unknown;
    const arr = Array.isArray(data)
      ? data
      : (data as { messages?: unknown[] } | undefined)?.messages;
    if (!Array.isArray(arr)) return undefined;
    for (let i = arr.length - 1; i >= 0; i--) {
      const m = arr[i] as { info?: { role?: unknown }; role?: unknown; parts?: unknown };
      const info = (m.info ?? m) as { role?: unknown };
      if (info.role === "assistant") {
        return { info: m.info ?? m, parts: m.parts };
      }
    }
    return undefined;
  }

  /** Aborts a session. Returns true only when the server accepted without error. */
  async abort(sessionId: string): Promise<boolean> {
    const res = await this.#client.session.abort({ path: { id: sessionId } });
    // m2: the SDK resolves with {data?, error?}; acceptance = no error field.
    const r = res as { error?: unknown } | undefined;
    return r !== undefined && r !== null && r.error === undefined;
  }

  /**
   * Abort with confirmation, retried up to `tries` times (plan: abort retried
   * ≤3). Returns true only when abort was accepted AND the session is no
   * longer busy (or is gone).
   */
  async abortAndConfirm(sessionId: string, tries = 3): Promise<boolean> {
    for (let attempt = 1; attempt <= tries; attempt++) {
      await this.abort(sessionId);
      const busy = await this.isBusy(sessionId);
      if (!busy) return true;
    }
    return false;
  }

  /** Enumeration fallback: all live sessions on the surviving server. */
  async listSessions(): Promise<SessionRef[]> {
    const res = await this.#client.session.list();
    const data = unwrap<{ id?: unknown; title?: unknown }[] | undefined>(res);
    if (!Array.isArray(data)) return [];
    return data
      .filter((s): s is { id: string; title?: string | undefined } => typeof s?.id === "string")
      .map((s) => ({ id: s.id, title: s.title ?? "" }));
  }

  /**
   * Enumeration fallback (plan §Session fencing): abort every TOOLKIT session
   * (title prefix `porting-kit:`) that is not tagged with the current epoch.
   * The epoch is the parsed trailing segment of the fence label, compared
   * exactly; a toolkit-prefixed title with no parseable epoch (for example the
   * `porting-kit:agent-roundtrip` evidence session) cannot be current, so it
   * is foreign too. Sessions without the prefix are not the toolkit's and are
   * left alone. Returns the aborted IDs.
   */
  async abortSessionsNotTagged(epoch: number): Promise<string[]> {
    const sessions = await this.listSessions();
    const foreign = sessions.filter((s) => isStaleToolkitSession(s.title, epoch));
    const aborted: string[] = [];
    for (const s of foreign) {
      if (await this.abortAndConfirm(s.id)) aborted.push(s.id);
    }
    return aborted;
  }

  async isBusy(sessionId: string): Promise<boolean> {
    const res = await this.#client.session.status();
    const data = unwrap(res) as Record<string, { type?: string }> | undefined;
    const status = data?.[sessionId];
    return status?.type === "busy" || status?.type === "retry";
  }
}

// ---------------------------------------------------------------------------
// Response unwrapping + defensive extraction (pre-release API churn guard)
// ---------------------------------------------------------------------------

type RequestResultLike<T> = { data?: T; error?: unknown };

function unwrap<T>(result: unknown): T | undefined {
  const r = result as RequestResultLike<T> | undefined;
  if (r === undefined || r === null) return undefined;
  if ("data" in r) return r.data;
  return result as T;
}

/** Narrows the assistant message's token fields; null when not exposed. */
export function extractTokenUsage(info: unknown): TokenUsage | null {
  if (typeof info !== "object" || info === null) return null;
  const tokens = (info as { tokens?: unknown }).tokens;
  if (typeof tokens !== "object" || tokens === null) return null;
  const t = tokens as {
    input?: unknown;
    output?: unknown;
    reasoning?: unknown;
    cache?: { read?: unknown; write?: unknown };
  };
  const cost = (info as { cost?: unknown }).cost;
  const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
  if (!num(t.input) || !num(t.output)) return null;
  return {
    input: t.input,
    output: t.output,
    reasoning: num(t.reasoning) ? t.reasoning : 0,
    cacheRead: num(t.cache?.read) ? (t.cache?.read as number) : 0,
    cacheWrite: num(t.cache?.write) ? (t.cache?.write as number) : 0,
    cost: num(cost) ? cost : 0,
  };
}

function hasAbortedError(info: unknown): boolean {
  if (typeof info !== "object" || info === null) return false;
  const err = (info as { error?: { name?: unknown } }).error;
  return typeof err === "object" && err !== null && err.name === "MessageAbortedError";
}

function extractText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (
      typeof part === "object" &&
      part !== null &&
      (part as { type?: unknown }).type === "text" &&
      typeof (part as { text?: unknown }).text === "string"
    ) {
      chunks.push((part as { text: string }).text);
    }
  }
  return chunks.join("\n");
}
