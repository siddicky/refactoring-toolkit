/**
 * Verdict record schema — the single source of truth for the review verdict
 * contract (plan §Metrics event contract + §Reviewer isolation enforcement).
 *
 * Consumers:
 *  - harness/agents/reviewer.ts: the reviewer prompt renders its verdict
 *    instructions from THIS schema + the SEVERITIES enum (single-sourced,
 *    plan: "Severity classes are a single enum defined in the Phase 1 verdict
 *    schema, shared by prompts and fixtures").
 *  - src/typesafe/verdict-check.ts (worker-owned): citation-check consumes
 *    finding evidence spans and produces the `citation_check` entries.
 *  - src/metrics/* (worker-owned): agreement rule requires two COMPLETED
 *    verdict records; an empty findings array is a completed clean review and
 *    is deliberately distinct from a missing record (plan v5).
 *
 * Validation is hand-rolled (plain TS guards, NO zod) — zero runtime deps so
 * nothing fights worker-1's package.json.
 *
 * Contract notes (audit C12/C14): every finding carries a REQUIRED
 * `description` (what is wrong — the fixer and the Jev prioritizer read it),
 * a REQUIRED verbatim `snippet` (the citation gate needs it), and a
 * `disposition` from the closed {@link DISPOSITIONS} enum (normalized, so
 * "Fix" and "won't fix" are accepted). `citation_check` is ADVISORY: the gate
 * recomputes citations itself, so malformed self-reports are dropped instead
 * of discarding the whole verdict.
 *
 * NOTE: this module defines the CONTRACT only. Runtime probe tests for
 * reviewer tool isolation are owned by worker-1/lead (plan: effective
 * permissions tested after config + plugin merge).
 */

// ---------------------------------------------------------------------------
// Severity enum — THE single source shared by prompts and tests
// ---------------------------------------------------------------------------

export const SEVERITIES = ["blocker", "major", "minor", "nit"] as const;

export type Severity = (typeof SEVERITIES)[number];

export function isSeverity(value: unknown): value is Severity {
  return (
    typeof value === "string" && (SEVERITIES as readonly string[]).includes(value)
  );
}

/** Canonical rendering for prompts ("blocker | major | minor | nit"). */
export function severityList(): string {
  return SEVERITIES.join(" | ");
}

// ---------------------------------------------------------------------------
// Record shapes (all plain JSON — dex-attribute serializable)
// ---------------------------------------------------------------------------

/**
 * Where in the reviewed diff the finding's evidence lives. Lines are 1-based
 * positions within the diff as delivered to the reviewer (by value).
 * `snippet` is REQUIRED quoted evidence: the citation check verifies the quote
 * actually appears in the reviewed diff, and a span without a quote can never
 * be cited (it would be dropped at the gate).
 */
export interface EvidenceSpan {
  start_line: number;
  end_line: number;
  snippet: string;
}

// ---------------------------------------------------------------------------
// Disposition enum — closed, normalized on intake
// ---------------------------------------------------------------------------

export const DISPOSITIONS = ["fix", "wontfix"] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/** Canonical rendering for prompts ("fix | wontfix"). */
export function dispositionList(): string {
  return DISPOSITIONS.join(" | ");
}

/**
 * Normalizes a model-written disposition: case-insensitive and punctuation
 * tolerant ("Fix", " FIX ", "won't fix", "wont_fix" -> "wontfix"). Returns
 * null for anything outside the closed enum.
 */
export function normalizeDisposition(value: unknown): Disposition | null {
  if (typeof value !== "string") return null;
  const folded = value.toLowerCase().replace(/[^a-z]/g, "");
  return (DISPOSITIONS as readonly string[]).includes(folded) ? (folded as Disposition) : null;
}

export interface Finding {
  finding_id: string;
  severity: Severity;
  /** What is wrong and why it matters (non-empty); becomes Finding.summary. */
  description: string;
  evidence_span: EvidenceSpan;
  /** What the fixer should do: "fix" applies the finding, "wontfix" skips it. */
  disposition: Disposition;
}

export interface CitationCheck {
  finding_id: string;
  /**
   * The model's self-reported probability (0..1) that the cited evidence
   * appears in the diff. ADVISORY ONLY: the gate recomputes citations.
   */
  p_cited: number;
}

/**
 * One reviewer's completed verdict for one file-round. A record with
 * `findings: []` is a COMPLETED clean review (`citation_check` is advisory
 * and defaults to `[]` when absent).
 */
export interface VerdictRecord {
  file: string;
  /** Reviewer identity, e.g. "reviewer-1". */
  reviewer: string;
  round: number;
  diff_id: string;
  findings: Finding[];
  citation_check: CitationCheck[];
}

// ---------------------------------------------------------------------------
// Validation (Zod-free guards)
// ---------------------------------------------------------------------------

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

/** Validate an unknown value as a full VerdictRecord, collecting ALL errors. */
export function validateVerdictRecord(value: unknown): ValidationResult<VerdictRecord> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: ["value: expected an object"] };
  }

  for (const field of ["file", "reviewer", "diff_id"] as const) {
    if (!isNonEmptyString(value[field])) {
      errors.push(`${field}: expected non-empty string`);
    }
  }
  if (!isInteger(value.round)) {
    errors.push("round: expected integer");
  }
  if (!Array.isArray(value.findings)) {
    errors.push("findings: expected array");
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // Findings (value.findings is an array here — asserted above).
  const findings: Finding[] = [];
  const findingIds = new Set<string>();
  const findingsArr = value.findings as unknown[];
  for (let i = 0; i < findingsArr.length; i++) {
    const result = validateFinding(findingsArr[i], `findings[${i}]`);
    if (!result.ok) {
      errors.push(...result.errors);
      continue;
    }
    if (findingIds.has(result.value.finding_id)) {
      errors.push(`findings[${i}]: duplicate finding_id "${result.value.finding_id}"`);
      continue;
    }
    findingIds.add(result.value.finding_id);
    findings.push(result.value);
  }

  // citation_check is ADVISORY (the gate recomputes citations and never reads
  // these values): keep only well-formed, non-duplicate entries that reference
  // a known finding and silently drop the rest — a bad self-report must not
  // discard an otherwise valid verdict.
  const citationChecks: CitationCheck[] = [];
  const citedIds = new Set<string>();
  const citationArr = Array.isArray(value.citation_check) ? (value.citation_check as unknown[]) : [];
  for (const entry of citationArr) {
    if (
      !isRecord(entry) ||
      !isNonEmptyString(entry.finding_id) ||
      !isProbability(entry.p_cited) ||
      !findingIds.has(entry.finding_id) ||
      citedIds.has(entry.finding_id)
    ) {
      continue;
    }
    citedIds.add(entry.finding_id);
    citationChecks.push({ finding_id: entry.finding_id, p_cited: entry.p_cited });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      file: value.file as string,
      reviewer: value.reviewer as string,
      round: value.round as number,
      diff_id: value.diff_id as string,
      findings,
      citation_check: citationChecks,
    },
  };
}

/** Validate a single finding. `path` labels the value in error messages. */
export function validateFinding(
  value: unknown,
  path = "finding",
): ValidationResult<Finding> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { ok: false, errors: [`${path}: expected an object`] };
  }
  if (!isNonEmptyString(value.finding_id)) {
    errors.push(`${path}.finding_id: expected non-empty string`);
  }
  if (!isSeverity(value.severity)) {
    errors.push(`${path}.severity: expected one of ${severityList()}`);
  }
  if (!isNonEmptyString(value.description) || value.description.trim().length === 0) {
    errors.push(`${path}.description: expected non-empty string`);
  }
  const disposition = normalizeDisposition(value.disposition);
  if (disposition === null) {
    errors.push(`${path}.disposition: expected one of ${dispositionList()}`);
  }
  const span = value.evidence_span;
  if (!isRecord(span)) {
    errors.push(`${path}.evidence_span: expected an object`);
  } else {
    if (!isInteger(span.start_line) || span.start_line < 1) {
      errors.push(`${path}.evidence_span.start_line: expected integer >= 1`);
    }
    if (!isInteger(span.end_line) || span.end_line < 1) {
      errors.push(`${path}.evidence_span.end_line: expected integer >= 1`);
    }
    if (
      isInteger(span.start_line) &&
      isInteger(span.end_line) &&
      span.end_line < span.start_line
    ) {
      errors.push(`${path}.evidence_span: end_line must be >= start_line`);
    }
    if (!isNonEmptyString(span.snippet) || span.snippet.trim().length === 0) {
      errors.push(`${path}.evidence_span.snippet: expected non-empty string (verbatim quote from the diff)`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  const validSpan = span as Record<string, unknown>;
  return {
    ok: true,
    value: {
      finding_id: value.finding_id as string,
      severity: value.severity as Severity,
      description: (value.description as string).trim(),
      evidence_span: {
        start_line: validSpan.start_line as number,
        end_line: validSpan.end_line as number,
        snippet: validSpan.snippet as string,
      },
      disposition: disposition as Disposition,
    },
  };
}

/**
 * Guard form of validation: a verdict is "completed" iff it validates. This
 * is how the flow distinguishes a completed clean review (valid, empty
 * findings) from a missing record (no valid verdict at all).
 */
export function isCompletedVerdictRecord(value: unknown): value is VerdictRecord {
  return validateVerdictRecord(value).ok;
}

// ---------------------------------------------------------------------------
// local guards
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}
