/**
 * Ambient module declaration for "@typesafe-ai/sdk" (v0.6.0).
 *
 * This mirrors EXACTLY the subset of the real SDK's public surface that
 * src/typesafe/client.ts consumes (verified against the published
 * dist/index.d.mts of @typesafe-ai/sdk 0.6.0). It exists only because this
 * worker's scope excludes the repo-root package.json/tsconfig bootstrap; once
 * the root tsconfig + @typesafe-ai/sdk dependency land, this file can be
 * deleted and the real package types will take over (the subset is faithful).
 *
 * NOTE for maintainers: TypeScript prefers this ambient declaration over
 * node_modules resolution for this specifier. Runtime always uses the real
 * package (dynamic import). Pin: @typesafe-ai/sdk@0.6.0.
 */
declare module "@typesafe-ai/sdk" {
  type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
  type EntryType = string | { [key: string]: JsonValue } | JsonValue[] | null;

  interface NoulQuestion {
    type: "noul";
    instructions?: EntryType;
    criteria?: { true?: EntryType; false?: EntryType } | null;
  }
  type ChoiceCriteria = { [label: string]: EntryType };
  interface ChoiceQuestion<T extends ChoiceCriteria = ChoiceCriteria> {
    type: "choice";
    instructions?: EntryType;
    criteria: T;
  }
  type ScoreCriteria = readonly [EntryType, EntryType, ...EntryType[]];
  interface ScoreQuestion<T extends ScoreCriteria = ScoreCriteria> {
    type: "score";
    instructions?: EntryType;
    criteria: T;
  }
  type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion;
  interface Questions {
    [name: string]: Question;
  }

  interface NoulResponse {
    readonly type: "noul";
    readonly noul: number;
  }
  interface ChoiceResponse<T extends ChoiceCriteria = ChoiceCriteria> {
    readonly type: "choice";
    readonly choice: keyof T & string;
    readonly confidence: number;
    readonly probabilities: { readonly [K in keyof T]: number };
  }
  interface ScoreResponse {
    readonly type: "score";
    readonly score: number;
    readonly confidence: number;
    readonly probabilities: { readonly [score: string]: number };
  }
  type ResultFor<Q extends Question> =
    Q extends NoulQuestion
      ? NoulResponse
      : Q extends ScoreQuestion
        ? ScoreResponse
        : Q extends ChoiceQuestion<infer C>
          ? ChoiceResponse<C>
          : never;

  interface Usage {
    readonly input_tokens: number;
    readonly output_tokens: number;
  }
  interface SystemOneRequest<Q extends Questions = Questions> {
    state: EntryType;
    questions: Q;
    model?: string;
  }
  interface SystemOneResult<Q extends Questions = Questions> {
    readonly model: string;
    readonly answers: { readonly [K in keyof Q]: ResultFor<Q[K]> };
    readonly usage: Usage;
  }

  class TypeSafeClient {
    constructor(config?: { apiKey?: string; baseURL?: string; defaultModel?: string });
    systemOne<const Q extends Questions>(
      request: SystemOneRequest<Q>,
    ): Promise<SystemOneResult<Q>>;
  }

  export {
    type ChoiceCriteria,
    ChoiceQuestion,
    type EntryType,
    type JsonValue,
    type NoulQuestion,
    type NoulResponse,
    type Question,
    Questions,
    type ResultFor,
    type ScoreCriteria,
    ScoreQuestion,
    type ScoreResponse,
    type SystemOneRequest,
    type SystemOneResult,
    TypeSafeClient,
    type Usage,
  };
}
