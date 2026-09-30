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

// ---------------------------------------------------------------------------
// Turn diagnosis (US-003, Stage 1b) — evidence-only Tier-1 records
// ---------------------------------------------------------------------------

/**
 * Deterministic shape class of one agent turn. Classification consumes ONLY
 * the observed reply shape (usage / text / abort / verdict outcome) — never a
 * judgment result (AC-B2: routing decisions read deterministic signals only).
 */
export type TurnShapeClass =
  /** Usage-present, no text, not aborted — the US-002 Tier-0 signature. */
  | "tier0-degenerate"
  /** Upstream abort — the recovery path (flows/port-project.ts runAgentTurn). */
  | "aborted"
  /** Completed reply with no provider usage — provenance class, never zero. */
  | "no-usage"
  /** Text present and verdict extraction succeeded. */
  | "parsed"
  /** Parseable-length text that FAILS verdict extraction (885-token case). */
  | "unparseable-text"
  /** Verdict extracted but discarded (US-006 repair-or-discard lands later). */
  | "discarded-verdict";

/** The observed shape of one turn — data only, no behavior. */
export interface TurnObservation {
  shape: TurnShapeClass;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  text_chars: number;
  error: string | null;
}

/** What triggered a diagnosis record. */
export type TurnDiagnosisTrigger =
  /** Tier-1 noul battery fired on a shape-ambiguous turn. */
  | "ambiguous-shape"
  /** Tier-1 noul battery fired on a discarded verdict (US-006 trigger). */
  | "discarded-verdict"
  /**
   * Deterministic successor re-record after a Tier-0/failed attempt: the
   * throwing attempt cannot persist (0(g)), so the succeeding attempt records
   * what is deterministically knowable — the attempt count. No Jev call.
   */
  | "retry-context";

/** One answered question of the Tier-1 battery (noul probability of "yes"). */
export interface TurnDiagnosisQuestion {
  name: string;
  /** null for deterministic records that ran no Jev battery. */
  p: number | null;
}

/**
 * A turn-health diagnosis RECORD — evidence only. No control-flow consumer may
 * branch on any field (AC-B2); the record surfaces on the telemetry stream and
 * the report's §Turn-diagnosis table, disposition always `recorded-evidence`.
 */
export interface TurnDiagnosis {
  /** Lease file key (prep reviews use the spec file). */
  file: string;
  /** Turn identity `<stepId>@<sanitized file#round>` (report "file/turn"). */
  turn: string;
  reviewer: string | null;
  /** Attempt that RECORDED this diagnosis — a successful turn (0(g)). */
  attempt: number;
  /** Failed attempts this recording attempt succeeded after. */
  prior_failed_attempts: number;
  /** Reviewer lane of the recording attempt (f(attempt) demotion policy). */
  lane: "default" | "demoted";
  trigger: TurnDiagnosisTrigger;
  /** The recording turn's own observed shape. */
  shape: TurnObservation;
  /** Battery answers; empty for deterministic retry-context records. */
  questions: TurnDiagnosisQuestion[];
  /** Jev model when the battery ran; null = deterministic record. */
  model: string | null;
  /** Jev's own token usage for the battery; null when it did not run. */
  jev_usage: { input_tokens: number; output_tokens: number } | null;
  disposition: "recorded-evidence";
  recorded_at_utc: string;
}

/** Assessment input handed to the Tier-1 assessor (data only). */
export interface TurnHealthAssessmentInput {
  file: string;
  stepId: string;
  turn: string;
  reviewer: string | null;
  attempt: number;
  prior_failed_attempts: number;
  lane: "default" | "demoted";
  shape: TurnObservation;
  recordedAtUtc: string;
}

/**
 * Tier-1 assessor seam. IMPLEMENTED in src/typesafe/turn-health.ts (a judgment
 * module); control-flow modules may hold this interface and the data above but
 * MUST NEVER import the implementation (import-boundary test, US-003 AC).
 * Every failure mode is fail-open: `assess` returns null (no-diagnosis) and
 * must never throw into the caller's failure path.
 */
export interface TurnHealthAssessor {
  assess(input: TurnHealthAssessmentInput): Promise<TurnDiagnosis | null>;
}

/** Shape classes the Tier-1 noul battery may fire on (shape-ambiguous). */
export const AMBIGUOUS_SHAPE_CLASSES: readonly TurnShapeClass[] = [
  "unparseable-text",
  "discarded-verdict",
];

export function isShapeAmbiguous(shape: TurnShapeClass): boolean {
  return AMBIGUOUS_SHAPE_CLASSES.includes(shape);
}

/**
 * Deterministic successor re-record (US-003): when a retry succeeds on
 * attempt n, the prior attempt(s) left no durable trace (0(g) — a throwing
 * attempt's staged writes never persist), so the succeeding turn's envelope
 * records what IS deterministically knowable: the attempt count and the
 * resulting lane. NO Jev call — the battery fires only on shape-ambiguous
 * turns, and a turn whose verdict parsed is shape-trivial.
 *
 * `lane` mirrors the demotion policy f(attempt) (demoteReviewerLane: attempt
 * >= 2 → demoted) — deliberate data-only mirror, same rule as
 * src/metrics/dispatch-anchor.ts's step table.
 */
export function buildRetryContextDiagnosis(input: {
  file: string;
  stepId: string;
  identity: string | null;
  reviewer: string | null;
  attempt: number;
  shape: TurnObservation;
  recordedAtUtc: string;
}): TurnDiagnosis {
  return {
    file: input.file,
    turn: `${input.stepId}@${input.identity ?? "flow"}`,
    reviewer: input.reviewer,
    attempt: input.attempt,
    prior_failed_attempts: Math.max(0, input.attempt - 1),
    lane: (input.attempt ?? 1) >= 2 ? "demoted" : "default",
    trigger: "retry-context",
    shape: input.shape,
    questions: [],
    model: null,
    jev_usage: null,
    disposition: "recorded-evidence",
    recorded_at_utc: input.recordedAtUtc,
  };
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
  /**
   * Turn-health diagnosis piggybacked on THIS envelope write (US-003, Stage
   * 1b) — never a separate mini-step. Present only on envelopes whose step
   * recorded a diagnosis (e.g. the successor attempt of a Tier-0 retry);
   * evidence-only: no control-flow consumer may read it (AC-B2).
   */
  turn_diagnosis?: TurnDiagnosis | null;
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

/**
 * US-006 tombstone variant stored under the SAME verdict attribute keys a
 * completed record would use (pp-verdict / pp-prep-verdict). A tombstoned
 * reviewer contributes ZERO kept findings; the round proceeds and agreement
 * surfaces `unreviewed` for the discarded side (a tombstone is NOT a
 * VerdictRecord — it never enters the agreement/metrics record stream).
 *
 * `reason` carries the deterministic discard trigger (suspicion repair
 * failure or attempt exhaustion); `tokens` carries the burned tokens of the
 * discarded attempt(s) so AC2 token accounting can anchor them — an
 * attempt-exhausted tombstone anchors ONLY the final attempt's tokens
 * (attempts 1..n-1 leave no durable trace per 0(g)); the AC2 report states
 * that under-count explicitly instead of reconciling silently.
 */
export interface VerdictTombstone {
  reviewer: string;
  discarded: true;
  reason: string;
  /** Dex attempt of the step execution that wrote the tombstone. */
  attempt: number;
  tokens: number | TokenUsage | null;
}

/** Narrow an unknown/union verdict-attribute value to a tombstone. */
export function isVerdictTombstone(value: unknown): value is VerdictTombstone {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { discarded?: unknown }).discarded === true
  );
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
 * US-010 honest vitest accounting carried on vitest burn-down samples. A
 * queue that did not RUN is never presented as a bare error_count 0: the
 * state plus the explicit reason travel with the sample, and renderers show
 * them. tsc has its own accounting ({@link TscRunAccounting}) on its TOTAL row.
 */
export interface VitestRunAccounting {
  state: "ran" | "not-run";
  /** Explicit not-run reason (e.g. "runner unavailable"); null when ran. */
  reason: string | null;
  passed: number | null;
  failed: number | null;
  total: number | null;
}

/**
 * Contract A: honest tsc accounting carried on the tsc TOTAL burn-down row
 * (file null), mirroring {@link VitestRunAccounting}. `state` is "not-run"
 * whenever tsc could not produce a trustworthy count: spawn error / ENOENT,
 * timeout or kill, or a non-zero exit with zero located diagnostics. A not-run
 * row is never rendered as PASS or as "0 errors".
 */
export interface TscRunAccounting {
  state: "ran" | "not-run";
  /**
   * Explicit reason when not-run, e.g. "tsc exited 2 with no located
   * diagnostics: error TS18003: No inputs were found...", "tsc timed out after
   * 180s", "tsc binary not found (ENOENT)". null when ran.
   */
  reason: string | null;
  /** Process exit code; null when killed / not spawned. */
  exit_code: number | null;
  /** Count of global (file-less) `error TSnnnn:` diagnostics seen. */
  unlocated: number;
}

/**
 * One queue burn-down sample (toolkit-owned queue steps against the integrated
 * checkout). `error_count` is the number of type errors (tsc) or failing tests
 * (vitest) at that iteration. Vitest samples carry `vitest` accounting: when
 * state is "not-run" the count is vacuous and consumers must render the state.
 *
 * `file: null` is the flow's AGGREGATE row for the iteration: its
 * `error_count` is the authoritative iteration total. Per-file rows (tsc only,
 * capped by the flow) are a breakdown and never added to an existing total.
 */
export interface QueueBurnDownEvent {
  queue: QueueKind;
  /** null = aggregate (iteration total) row; a path = per-file breakdown row. */
  file: string | null;
  iteration: number;
  error_count: number;
  /** UTC ISO-8601 timestamp of the sample. */
  recorded_at: string;
  /** US-010; absent on tsc rows and on legacy vitest rows (pre-US-010 runs). */
  vitest?: VitestRunAccounting;
  /** Contract A; only on the tsc TOTAL row (file null); absent on legacy rows. */
  tsc?: TscRunAccounting;
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
