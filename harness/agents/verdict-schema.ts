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
 * `snippet` is optional quoted evidence; the citation check (TypeSafe noul)
 * verifies the cited evidence actually appears in the reviewed diff.
 */
export interface EvidenceSpan {
  start_line: number;
  end_line: number;
  snippet?: string;
}

export interface Finding {
  finding_id: string;
  severity: Severity;
  evidence_span: EvidenceSpan;
  /** What the fixer should do, e.g. "fix" | "wontfix". Free-form string. */
  disposition: string;
}

export interface CitationCheck {
  finding_id: string;
  /** Probability (0..1) that the cited evidence appears in the diff. */
  p_cited: number;
}

/**
 * One reviewer's completed verdict for one file-round. A record with
 * `findings: []` and `citation_check: []` is a COMPLETED clean review.
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
  if (!Array.isArray(value.citation_check)) {
    errors.push("citation_check: expected array");
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

  // Citation checks must reference known findings, no duplicates.
  const citationChecks: CitationCheck[] = [];
  const citedIds = new Set<string>();
  const citationArr = value.citation_check as unknown[];
  for (let i = 0; i < citationArr.length; i++) {
    const entry = citationArr[i];
    const prefix = `citation_check[${i}]`;
    if (!isRecord(entry)) {
      errors.push(`${prefix}: expected an object`);
      continue;
    }
    if (!isNonEmptyString(entry.finding_id)) {
      errors.push(`${prefix}.finding_id: expected non-empty string`);
      continue;
    }
    if (!isProbability(entry.p_cited)) {
      errors.push(`${prefix}.p_cited: expected number in [0, 1]`);
      continue;
    }
    if (!findingIds.has(entry.finding_id)) {
      errors.push(`${prefix}.finding_id: "${entry.finding_id}" does not match any finding`);
      continue;
    }
    if (citedIds.has(entry.finding_id)) {
      errors.push(`${prefix}: duplicate citation for "${entry.finding_id}"`);
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
  if (!isNonEmptyString(value.disposition)) {
    errors.push(`${path}.disposition: expected non-empty string`);
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
    if (
      span.snippet !== undefined &&
      typeof span.snippet !== "string"
    ) {
      errors.push(`${path}.evidence_span.snippet: expected string when present`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: {
      finding_id: value.finding_id as string,
      severity: value.severity as Severity,
      evidence_span: span as EvidenceSpan,
      disposition: value.disposition as string,
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
