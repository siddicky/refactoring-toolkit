/**
 * Metrics event contract — shared evidence-stream types for the porting toolkit.
 *
 * Faithful to the consensus plan's "Metrics event contract (AC2 mechanism)"
 * (.omc/plans/2026-09-25-porting-toolkit-consensus.md):
 *
 * - Envelope events carry `{stepId, role, file, round, attempt, started_at,
 *   ended_at, outcome, tokens, wall_clock_ms}`. `tokens` is REQUIRED (non-null)
 *   for model-calling steps (agent and Jev roles) and NULL-as-not-applicable for
 *   non-model steps (commit, queue, diff-capture, `record`). A missing required
 *   token value is a provenance failure, never zero.
 * - Each reviewer's review yields a COMPLETED verdict record
 *   `{file, reviewer, round, diff_id, findings, citation_check}`; an empty
 *   findings array is a completed clean review, distinct from a missing record.
 * - Severity classes are a single enum (this file is the Phase 1 verdict schema
 *   carrier for the toolkit's own code), shared by prompts and fixtures.
 * - Kill events mirror the chaos sidecar: an intent record (run id, UTC +
 *   monotonic, target PIDs) written BEFORE SIGKILL and a completion record
 *   appended AFTER. Cross-process ordering assertions use UTC only.
 */

/** Terminal/interim outcome of one envelope-wrapped step execution. */
export type EnvelopeOutcome = "skipped" | "redone" | "interrupted" | "completed";

/**
 * Role of the step inside the envelope. Mirror of the LIVE envelope factory
 * (flows/steps/envelope.ts): `agent`, `review`, and `judgment` are
 * model-calling; `verdict-check`/`prioritize` sit at TypeSafe integration
 * points but are code-only (naive) in Phase 2 and move to `judgment` at the
 * Phase 3 Jev swap-in; the rest are non-model.
 */
export type EnvelopeRole =
  | "agent"
  | "review"
  | "judgment"
  | "verdict-check"
  | "prioritize"
  | "commit"
  | "integration"
  | "queue"
  | "diff-capture"
  | "record";

/** Roles that call a model and therefore MUST carry non-null `tokens`. */
export type ModelCallingRole = "agent" | "review" | "judgment";

export const MODEL_CALLING_ROLES: readonly ModelCallingRole[] = ["agent", "review", "judgment"];

export function isModelCallingRole(role: EnvelopeRole): role is ModelCallingRole {
  return (MODEL_CALLING_ROLES as readonly string[]).includes(role);
}

/**
 * Token usage for one model call. Field names match the TypeSafe SDK; the
 * optional split fields (wave-5 cost honesty, takeaways-synthesis #2) carry
 * the provider-reported cache/reasoning split and USD cost when available
 * (the opencode seam collects them from the assistant message `info`).
 * `cost_usd` absent/0 on a lane that reports tokens means the provider did
 * not report per-token cost (e.g. plan-authed models) — renderers flag such
 * totals as estimated (`~`), never silently as exact.
 */
export interface TokenUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly reasoning_tokens?: number;
  readonly cache_read_tokens?: number;
  readonly cache_write_tokens?: number;
  readonly cost_usd?: number;
}

/**
 * One envelope-wrapped step execution — the ATTRIBUTE-VIEW mirror of the live
 * factory's durable event (flows/steps/envelope.ts), so the flow's envelope
 * values are directly assignable.
 *
 * - `attempt` is one-based from the dex Context (exit 0(f)) EXCEPT for M4
 *   start markers: attempt 0, outcome "interrupted", `ended_at` null, written
 *   by a preceding record mini-step before every model-calling step. Markers
 *   are excluded from token totals and token-required checks by the AC2
 *   provenance pass.
 * - `tokens` is REQUIRED (non-null) for model-calling roles on real attempts;
 *   the live flow stores the token TOTAL as a number, while the
 *   TypeSafe-SDK-shaped `{input_tokens, output_tokens}` object is accepted
 *   and normalized (see {@link tokenTotalOf}). null = not applicable.
 * - `identity` is the sanitized `file#round` target key (M2); per-file steps
 *   key their events by it. `file`/`round` are null in the live factory —
 *   recover the file with {@link fileFromIdentity}.
 * - An envelope with outcome "interrupted" and `ended_at` null is an open
 *   record: either not yet closed by the recovery pass, or an attempt-0
 *   marker (open by design).
 */
export interface EnvelopeEvent {
  stepId: string;
  role: EnvelopeRole;
  /** Lease file key; null for flow-level steps (and in the live factory). */
  file: string | null;
  round: number | null;
  /** 0 = M4 start marker; >= 1 = real attempt (dex Context.attempt). */
  attempt: number;
  /** UTC ISO-8601 timestamp. */
  started_at: string;
  /** UTC ISO-8601 timestamp; null while the envelope is open. */
  ended_at: string | null;
  outcome: EnvelopeOutcome;
  /** Total tokens (number) or SDK-shaped usage; null = not applicable. */
  tokens: number | TokenUsage | null;
  wall_clock_ms: number | null;
  /** Sanitized `file#round` target identity (M2); null for flow-level steps. */
  identity: string | null;
}

/** True for M4 start markers (attempt 0, record-semantics under the target role). */
export function isStartMarker(env: EnvelopeEvent): boolean {
  return env.attempt === 0;
}

/**
 * Normalize the envelope `tokens` field to the token TOTAL: a number passes
 * through; the SDK-shaped object sums; anything else is null. Mirrors the
 * dashboard's normalizeTokens so both surfaces agree on the contract.
 */
export function tokenTotalOf(tokens: number | TokenUsage | null): number | null {
  if (typeof tokens === "number") return tokens;
  if (tokens !== null && typeof tokens === "object") {
    const input = tokens.input_tokens;
    const output = tokens.output_tokens;
    if (typeof input !== "number" || typeof output !== "number") return null;
    // Wave-5: the usage object may carry the full provider split; the total
    // matches the opencode seam's tokenTotal (input+output+reasoning+cache).
    return (
      input +
      output +
      (tokens.reasoning_tokens ?? 0) +
      (tokens.cache_read_tokens ?? 0) +
      (tokens.cache_write_tokens ?? 0)
    );
  }
  return null;
}

/**
 * Sanitized identity key for a file-round (mirror of the flow's
 * markerKeyOf: AttributeMap keys prohibit `/`, so it is replaced with "__").
 */
export function identityKeyOf(file: string, round: number): string {
  return `${file.replace(/\//g, "__")}#${round}`;
}

/**
 * Best-effort inverse of {@link identityKeyOf}: recover the file path and
 * round from a sanitized identity. "__" -> "/" is lossy if a filename itself
 * contains "__"; acceptable for v1 grouping and documented as such.
 */
export function fileFromIdentity(identity: string): { file: string; round: number } | null {
  const hash = identity.lastIndexOf("#");
  if (hash <= 0) return null;
  const roundPart = identity.slice(hash + 1);
  const round = Number(roundPart);
  if (!Number.isInteger(round) || roundPart === "") return null;
  return { file: identity.slice(0, hash).replace(/__/g, "/"), round };
}

/**
 * The single severity enum for the toolkit. CANONICAL DEFINITION: the verdict
 * schema (harness/agents/verdict-schema.ts, plan: "Severity classes are a
 * single enum defined in the Phase 1 verdict schema, shared by prompts and
 * fixtures"). This module re-exports it under the metrics-facing name so
 * downstream consumers keep one import surface.
 */
import { SEVERITIES, type Severity } from "../../harness/agents/verdict-schema.js";

export type SeverityClass = Severity;

export const SEVERITY_CLASSES: readonly SeverityClass[] = SEVERITIES;

/** Lower rank = more severe. Used by the naive severity-class rerank. */
export const SEVERITY_RANK: Readonly<Record<SeverityClass, number>> = {
  blocker: 0,
  major: 1,
  minor: 2,
  nit: 3,
};

/**
 * Evidence the reviewer cites for a finding, anchored inside one diff hunk.
 * `quote` is the exact text the reviewer cites from the reviewed diff; the
 * naive citation check matches it against the diff text.
 */
export interface EvidenceSpan {
  hunk_id: string;
  start_line: number;
  end_line: number;
  quote: string;
}

/** One reviewer finding. `evidence` may be null (uncited finding). */
export interface Finding {
  finding_id: string;
  severity: SeverityClass;
  summary: string;
  evidence: EvidenceSpan | null;
}

/** Citation-check probability for one finding: does the evidence appear in the diff? */
export interface CitationCheckResult {
  finding_id: string;
  p_cited: number;
}

/**
 * A COMPLETED verdict record from one reviewer for one file+round.
 * `findings: []` is a completed clean review — distinct from a missing record
 * (a record that is simply absent from the stream).
 */
export interface VerdictRecord {
  file: string;
  reviewer: string;
  round: number;
  diff_id: string;
  findings: Finding[];
  citation_check: CitationCheckResult[];
}

/** One hunk of a reviewed diff (delivered to reviewers by value). */
export interface DiffHunk {
  hunk_id: string;
  header: string;
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  /** Raw diff lines including the +/-/space prefixes. */
  lines: string[];
}

/** The reviewed diff as a value (diff-capture step output). */
export interface DiffDocument {
  diff_id: string;
  file: string;
  base_ref: string | null;
  hunks: DiffHunk[];
}

export type QueueKind = "tsc" | "vitest";

/**
 * One queue burn-down sample (toolkit-owned queue steps against the integrated
 * checkout). `error_count` is the number of type errors (tsc) or failing tests
 * (vitest) at that iteration.
 */
export interface QueueBurnDownEvent {
  queue: QueueKind;
  file: string;
  iteration: number;
  error_count: number;
  /** UTC ISO-8601 timestamp of the sample. */
  recorded_at: string;
}

/**
 * Chaos-sidecar event: kill intent written BEFORE SIGKILL (so the evidence
 * chain cannot be orphaned by a killer-side crash) and the completion record
 * appended AFTER. `monotonic_ms` is compared only within a single process.
 */
export type KillEvent =
  | {
      kind: "kill-intent";
      run_id: string;
      utc: string;
      monotonic_ms: number;
      target_pids: number[];
    }
  | {
      kind: "kill-completed";
      run_id: string;
      utc: string;
      monotonic_ms: number;
      resumed: boolean;
      note: string | null;
    };

/** Parsed shape of the run's kill-events.json sidecar file. */
export interface KillEventsFile {
  run_id: string;
  events: KillEvent[];
}
