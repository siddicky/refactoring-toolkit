/**
 * Vendor-thin seam over the TypeSafe JavaScript SDK (@typesafe-ai/sdk, Jev /
 * System One). Everything downstream (symbol-types, verdict-check, prioritize,
 * tests) depends ONLY on this module's types and the `JudgmentClient`
 * interface — never on the SDK directly.
 *
 * - The REAL client (`createRealJevClient`) dynamically imports
 *   `@typesafe-ai/sdk`, reads the API key from the TYPESAFE_API_KEY env var
 *   only (never hardcoded), and adapts the SDK's `systemOne` to the seam.
 * - The IN-MEMORY double (`createInMemoryJevClient`) answers from a scripted
 *   responder: deterministic, offline, and used by all unit tests. With no
 *   responder it throws — it never fabricates judgments silently.
 * - There is ONE offline factory for production flows: the worker's
 *   `createOfflineJevClient()` (src/harness/runtime.ts), an in-memory double
 *   over the scripted first-candidate responder. Its answers are tagged
 *   `judge: "scripted"` downstream and are never counted as live Jev usage.
 *   `isTypesafeOffline()` (TYPESAFE_OFFLINE) is the switch that selects it.
 */

// ---- seam types (structural mirrors of @typesafe-ai/sdk 0.6.0) ---------------

/** A JSON-compatible value. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Text, a JSON object or array, or null — for state, instructions, criteria. */
export type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null;

/** A yes/no question; the answer is the probability of "yes". */
export interface NoulQuestion {
  type: "noul";
  instructions?: EntryType;
  criteria?: { true?: EntryType; false?: EntryType } | null;
}

/** Labels mapped to descriptions. */
export type ChoiceCriteria = { [label: string]: EntryType };

/** A question that selects between named alternatives. */
export interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
  type: "choice";
  instructions?: EntryType;
  criteria: T;
}

/** A question that assigns a score on an ordered rubric (>= 2 levels). */
export type ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]];

export interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
  type: "score";
  instructions?: EntryType;
  criteria: T;
}

export type Question = NoulQuestion | ScoreQuestion | ChoiceQuestion;

export interface Questions {
  [name: string]: Question;
}

export interface NoulResponse {
  readonly type: "noul";
  /** Probability of a yes answer, 0..1. */
  readonly noul: number;
}

export interface ChoiceResponse<T extends ChoiceCriteria = ChoiceCriteria> {
  readonly type: "choice";
  readonly choice: keyof T & string;
  readonly confidence: number;
  readonly probabilities: { readonly [K in keyof T]: number };
}

export interface ScoreResponse {
  readonly type: "score";
  readonly score: number;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export type ResultFor<Q extends Question> = Q extends NoulQuestion
  ? NoulResponse
  : Q extends ScoreQuestion
    ? ScoreResponse
    : Q extends ChoiceQuestion<infer C>
      ? ChoiceResponse<C>
      : never;

export interface Usage {
  readonly input_tokens: number;
  readonly output_tokens: number;
}

export interface SystemOneRequest<Q extends Questions = Questions> {
  state: EntryType;
  questions: Q;
  model?: string;
}

export interface SystemOneResult<Q extends Questions = Questions> {
  readonly model: string;
  readonly answers: { readonly [K in keyof Q]: ResultFor<Q[K]> };
  readonly usage: Usage;
}

// ---- question builders (same shape as the SDK's choice/noul/score) -----------

export function noul(
  instructions?: EntryType,
  criteria?: { true?: EntryType; false?: EntryType } | null,
): NoulQuestion {
  // exactOptionalPropertyTypes: omit the key instead of passing undefined.
  return {
    type: "noul",
    ...(instructions === undefined ? {} : { instructions }),
    criteria: criteria ?? null,
  };
}

export function choice<const T extends ChoiceCriteria>(
  instructions: EntryType,
  criteria: T,
): ChoiceQuestion<T> {
  return { type: "choice", instructions, criteria };
}

export function score<const T extends ScoreCriteria>(
  instructions: EntryType,
  criteria: T,
): ScoreQuestion<T> {
  return { type: "score", instructions, criteria };
}

// ---- the seam ------------------------------------------------------------------

/**
 * Vendor-neutral judgment client. The ONLY TypeSafe surface other modules see.
 * `inputTokens`/`outputTokens` are OPTIONAL cumulative diagnostics over this
 * client's own calls (delegating wrappers omit them — the wrapped client
 * carries the totals). The canonical implementations — the in-memory double
 * and the real SDK adapter — always provide them so judgment-role envelopes
 * keep token provenance offline.
 */
export interface JudgmentClient {
  readonly kind: "real" | "in-memory";
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  systemOne<const Q extends Questions>(request: SystemOneRequest<Q>): Promise<SystemOneResult<Q>>;
}

// ---- env handling ---------------------------------------------------------------

/**
 * Env var names THIS module reads. The API key comes from TYPESAFE_API_KEY only
 * — never from code.
 *
 * TYPESAFE_BASE_URL, TYPESAFE_DEFAULT_MODEL and TYPESAFE_LOG_LEVEL are read by
 * the @typesafe-ai/sdk client itself (explicit option, then env, then SDK
 * default) when createRealJevClient does not pass them. They used to be listed
 * here as well but nothing in this repo read them, which made them look wired
 * when only the SDK honoured them; they are deliberately not repeated.
 * src/typesafe/client-sdk-env.test.ts proves the SDK picks them up.
 */
export const TYPESAFE_ENV_VARS = {
  apiKey: "TYPESAFE_API_KEY",
  offline: "TYPESAFE_OFFLINE",
} as const;

/**
 * True when TYPESAFE_OFFLINE is set to anything truthy (1, true, yes...).
 * "0", "false", "" and unset count as online. Offline mode forces the
 * in-memory double so tests never touch the network. Read at call time, so a
 * test can change it between calls.
 */
export function isTypesafeOffline(): boolean {
  const v = process.env[TYPESAFE_ENV_VARS.offline];
  if (v === undefined || v === "" || v === "0") return false;
  return v.toLowerCase() !== "false";
}

/** Raised when the real client is requested without an API key. */
export class JevConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JevConfigError";
  }
}

// ---- in-memory test double --------------------------------------------------------

/**
 * Scripted responder: given a request, return raw answer payloads keyed by
 * question name (same shapes as the SDK's NoulResponse/ChoiceResponse).
 */
export type InMemoryResponder = (
  request: SystemOneRequest<Questions>,
) => Record<string, unknown> | Promise<Record<string, unknown>>;

/**
 * Deterministic, offline JudgmentClient. Records every request for
 * assertions and counts token usage with a fixed per-question rule.
 * Without a responder, calling it throws — judgments are never faked silently.
 */
export class InMemoryJudgmentClient implements JudgmentClient {
  readonly kind = "in-memory" as const;
  readonly requests: SystemOneRequest<Questions>[] = [];
  inputTokens = 0;
  outputTokens = 0;

  constructor(private readonly respond?: InMemoryResponder) {}

  get callCount(): number {
    return this.requests.length;
  }

  async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>): Promise<SystemOneResult<Q>> {
    this.requests.push(request);
    if (!this.respond) {
      throw new Error(
        "InMemoryJudgmentClient has no scripted responder; pass one to createInMemoryJevClient()",
      );
    }
    const scripted = await this.respond(request);
    const answers: Record<string, unknown> = {};
    for (const name of Object.keys(request.questions)) {
      if (!(name in scripted)) {
        throw new Error(`in-memory responder returned no answer for question "${name}"`);
      }
      answers[name] = scripted[name];
    }
    const usage: Usage = {
      input_tokens: 10 * Object.keys(request.questions).length,
      output_tokens: Object.keys(answers).length,
    };
    this.inputTokens += usage.input_tokens;
    this.outputTokens += usage.output_tokens;
    return {
      model: "in-memory-double",
      answers: answers as unknown as SystemOneResult<Q>["answers"],
      usage,
    };
  }
}

export function createInMemoryJevClient(responder?: InMemoryResponder): InMemoryJudgmentClient {
  return new InMemoryJudgmentClient(responder);
}

// ---- real SDK-backed client ---------------------------------------------------------

/**
 * Build the REAL client over @typesafe-ai/sdk (dynamic import so the package
 * is only resolved when actually needed — offline tests never load it).
 * The API key comes from the explicit config or the TYPESAFE_API_KEY env var;
 * it is never hardcoded and never logged.
 */
export async function createRealJevClient(config?: {
  apiKey?: string;
  baseURL?: string;
}): Promise<JudgmentClient> {
  const apiKey = config?.apiKey ?? process.env[TYPESAFE_ENV_VARS.apiKey];
  if (apiKey === undefined || apiKey === "") {
    throw new JevConfigError(
      `real TypeSafe client requires an API key via ${TYPESAFE_ENV_VARS.apiKey} (env) — refusing to proceed without credentials`,
    );
  }
  const sdk = await import("@typesafe-ai/sdk");
  const client = new sdk.TypeSafeClient({
    apiKey,
    ...(config?.baseURL === undefined ? {} : { baseURL: config.baseURL }),
  });
  let inputTokens = 0;
  let outputTokens = 0;
  const adapter: JudgmentClient = {
    kind: "real",
    get inputTokens() {
      return inputTokens;
    },
    get outputTokens() {
      return outputTokens;
    },
    async systemOne<const Q extends Questions>(request: SystemOneRequest<Q>) {
      const result = await client.systemOne(request);
      inputTokens += result.usage.input_tokens;
      outputTokens += result.usage.output_tokens;
      return {
        model: result.model,
        answers: result.answers,
        usage: {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
        },
      };
    },
  };
  return adapter;
}
