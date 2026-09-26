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

/** AttributeMap instance keys prohibit `/`, so file paths are sanitized. */
export function fenceLabel(file: string, round: number, epoch: number): string {
  return `porting-kit:${file.replace(/\//g, "__")}#${round}#${epoch}`;
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
}

/** How long prompt() polls for a completed assistant reply (0(g) provenance). */
const PROMPT_WAIT_MS = parseWaitMs(
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
    ?.OPENCODE_PROMPT_WAIT_MS,
);

/** m4: invalid values (NaN, ≤0, absurdly large) fall back to 15 minutes. */
function parseWaitMs(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 24 * 60 * 60_000) {
    return 900_000;
  }
  return parsed;
}

/**
 * Typed failure for one prompt turn. `retryable` failures (upstream aborts,
 * empty native-tool replies) should be retried on a FRESH session by the
 * caller (dex step retry); non-retryable means the reply completed but
 * carried no usage — a provenance failure for model-calling steps.
 */
export class OpencodePromptError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "OpencodePromptError";
    this.retryable = retryable;
  }
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

export const DEFAULT_OPENCODE_BASE_URL = "http://127.0.0.1:4096";

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

  constructor(
    client: OpencodeClient,
    model?: { providerID: string; modelID: string } | undefined,
    defaultAgent?: string | undefined,
  ) {
    this.#client = client;
    this.#model = model;
    this.defaultAgent = defaultAgent;
  }

  static async connect(
    baseUrl: string = DEFAULT_OPENCODE_BASE_URL,
    model?: { providerID: string; modelID: string } | undefined,
  ): Promise<OpencodeHarness> {
    const client = createOpencodeClient({ baseUrl } as never);
    const defaultAgent = readEnvVar("OPENCODE_AGENT");
    return new OpencodeHarness(client, model, defaultAgent);
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
    const res = await this.#client.session.prompt({
      path: { id: sessionId },
      body: {
        ...(this.#model !== undefined ? { model: this.#model } : {}),
        ...(agent !== undefined ? { agent } : {}),
        ...(opts?.tools !== undefined ? { tools: opts.tools } : {}),
        parts: [{ type: "text", text }],
      },
    } as never);
    const data = unwrap(res) as
      | { info?: unknown; parts?: unknown }
      | undefined;
    if (data === undefined) {
      throw new Error(`opencode prompt returned no message (session=${sessionId})`);
    }
    // ODW finding 1: prompt RESOLVES with info.error on upstream failure —
    // bail immediately instead of burning the poll window on a stuck turn.
    const immediateError = upstreamErrorOf(data.info);
    if (immediateError !== null) {
      throw new OpencodePromptError(`upstream failure: ${immediateError}`, true);
    }
    let usage = extractTokenUsage(data.info);
    let aborted = hasAbortedError(data.info);
    let textOut = extractText(data.parts);

    if (usage === null && !aborted) {
      const deadline = Date.now() + PROMPT_WAIT_MS;
      let polls = 0;
      while (usage === null && !aborted && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 5_000));
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
        const turnError = upstreamErrorOf(last.info);
        if (turnError !== null) {
          throw new OpencodePromptError(`upstream failure: ${turnError}`, true);
        }
        usage = extractTokenUsage(last.info);
        aborted = hasAbortedError(last.info);
        const completed = extractText(last.parts);
        if (completed.length > 0) textOut = completed;
      }
      console.error(
        `[opencode] poll loop exit (session=${sessionId}) usage=${usage === null ? "null" : "present"} aborted=${aborted} waitedMs=${Date.now() - (deadline - PROMPT_WAIT_MS)}`,
      );
      if (usage === null && !aborted) {
        if (textOut.length === 0) {
          // ODW finding 2: empty replies from native-tool turns are their own
          // retryable failure class (distinct from completed-but-unusaged).
          throw new OpencodePromptError("empty reply without usage (native-tool turn)", true);
        }
        // Completed reply, no usage exposed: provenance failure (never zero).
        return { text: textOut, usage: null, aborted: false };
      }
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
   * Enumeration fallback (plan §Session fencing): abort every session whose
   * title is not tagged with the current epoch. Returns the aborted IDs.
   */
  async abortSessionsNotTagged(epoch: number): Promise<string[]> {
    const sessions = await this.listSessions();
    const foreign = sessions.filter((s) => !s.title.includes(`#${epoch}`));
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

/** Reads one env var (kept tiny so the module stays test-friendly). */
function readEnvVar(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env?.[name];
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
