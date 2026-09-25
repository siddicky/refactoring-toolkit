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
  prompt(sessionId: string, text: string): Promise<PromptResult>;
  /** Enumeration fallback orchestration used by ordered recovery. */
  abortSessionsNotTagged(epoch: number): Promise<string[]>;
}

export class OpencodeHarness {
  readonly #client: OpencodeClient;
  readonly #model: { providerID: string; modelID: string } | undefined;

  constructor(
    client: OpencodeClient,
    model?: { providerID: string; modelID: string } | undefined,
  ) {
    this.#client = client;
    this.#model = model;
  }

  static async connect(
    baseUrl: string = DEFAULT_OPENCODE_BASE_URL,
    model?: { providerID: string; modelID: string } | undefined,
  ): Promise<OpencodeHarness> {
    const client = createOpencodeClient({ baseUrl } as never);
    return new OpencodeHarness(client, model);
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
   * token usage; `usage === null` means the server did not expose usage and is
   * a PROVENANCE FAILURE for model-calling steps (never zero).
   */
  async prompt(sessionId: string, text: string): Promise<PromptResult> {
    const res = await this.#client.session.prompt({
      path: { id: sessionId },
      body: {
        ...(this.#model !== undefined ? { model: this.#model } : {}),
        parts: [{ type: "text", text }],
      },
    });
    const data = unwrap(res) as
      | { info?: { tokens?: unknown; cost?: unknown; error?: unknown }; parts?: unknown }
      | undefined;
    if (data === undefined) {
      throw new Error(`opencode prompt returned no message (session=${sessionId})`);
    }
    const usage = extractTokenUsage(data.info);
    const aborted = hasAbortedError(data.info);
    const textOut = extractText(data.parts);
    return { text: textOut, usage, aborted };
  }

  /** Aborts a session. Returns true when the server accepted the abort. */
  async abort(sessionId: string): Promise<boolean> {
    const res = await this.#client.session.abort({ path: { id: sessionId } });
    return unwrap(res) !== undefined || res.error === undefined;
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
