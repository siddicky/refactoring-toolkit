/**
 * Pure metrics renderer (plan AC2): renders metrics/report.md + report.json
 * from the evidence stream — envelope events, completed verdict records, queue
 * burn-down samples — merged with the chaos kill-events sidecar and, when the
 * dex history is supplied, the Phase 5 typed dispatch anchoring.
 *
 * Pure function over its input: no clock, no randomness, no I/O. The same
 * input always produces byte-identical markdown and JSON. `generatedAt` is an
 * input, not `Date.now()`.
 *
 * Envelope contract notes (src/metrics/types.ts):
 * - attempt-0 start markers (M4) are excluded from token totals, per-role
 *   aggregation, and interrupted counts — they are surfaced via
 *   `start_marker_count` and the dispatch anchor instead;
 * - per-file envelopes carry their target in `identity` (sanitized
 *   `file#round`, M2); the file is recovered for grouping;
 * - an interrupted model-calling envelope with null tokens is NOT a provenance
 *   failure (the attempt was killed mid-turn — the M4 marker plus its dispatch
 *   entries are the evidence); a completed/redone/skipped model envelope
 *   without tokens IS a failure, never zero.
 */
import { agreementForGroup, type AgreementRecord } from "./agreement.js";
import {
  anchorForRun,
  type DispatchAnchorResult,
  type DispatchHistory,
  type ProvenanceCrossCheck,
} from "./dispatch-anchor.js";
import {
  fileFromIdentity,
  isModelCallingRole,
  type CitationCheckResult,
  type EnvelopeEvent,
  type EnvelopeRole,
  type Finding,
  type KillEvent,
  type KillEventsFile,
  type QueueBurnDownEvent,
  type QueueKind,
  type TokenUsage,
  type VerdictRecord,
  tokenTotalOf,
} from "./types.js";

/** The fixer step id (mirror of flows/port-project.ts) for AC2 retry counts. */
const FIXER_STEP_ID = "pp-fixer";

export interface MetricsRenderInput {
  envelopes: readonly EnvelopeEvent[];
  verdicts: readonly VerdictRecord[];
  burnDown: readonly QueueBurnDownEvent[];
  /** Merged kill-events.json sidecar; null/undefined when the run had no kill. */
  killEvents?: KillEventsFile | null;
  /**
   * dexcli history JSON (`flow history -output json`). When present the Phase 5
   * typed dispatch anchoring runs as part of the AC2 cross-check and its
   * failures join the provenance failures.
   */
  history?: DispatchHistory | null;
  /** Optional UTC ISO-8601 stamp for the report header (supplied by the caller). */
  generatedAt?: string;
}

export interface DispatchAnchorSummary {
  ok: boolean;
  failures: string[];
  envelopes_anchored: number;
  dispatch_entries_total: number;
  non_agent_dispatch_entries: number;
  unexplained_dispatch_entries: number;
  model_steps_missing_start_marker: number;
  groups: DispatchAnchorResult["groups"];
}

export interface ReportJson {
  generated_at: string | null;
  provenance_ok: boolean;
  provenance_failures: string[];
  summary: {
    files: string[];
    envelope_count: number;
    /** M4 attempt-0 start markers (excluded from token/role aggregates). */
    start_marker_count: number;
    /** Interrupted envelopes over REAL attempts (attempt >= 1) only. */
    interrupted_envelope_count: number;
    verdict_record_count: number;
    /** Total over model-calling roles, real attempts only; null when none. */
    tokens_model_roles: number | null;
    wall_clock_ms_total: number;
  };
  file_rounds: Array<{
    file: string;
    round: number;
    records: Array<{ reviewer: string; diff_id: string; findings: Finding[] }>;
    agreement: AgreementRecord;
    citation_checks: CitationCheckResult[];
  }>;
  tokens_by_file_role: Array<{
    file: string;
    role: EnvelopeRole;
    steps: number;
    /** null = not applicable (non-model role) or a provenance failure (model role). */
    tokens: number | null;
    wall_clock_ms: number | null;
  }>;
  /** Retries = fixer (stepId pp-fixer) envelope events with attempt > 1, per file. */
  fixer_retries: Array<{ file: string; retries: number }>;
  queue_burn_down: Array<{
    queue: QueueKind;
    iterations: Array<{
      iteration: number;
      error_count: number;
      per_file: Array<{ file: string; error_count: number }>;
    }>;
  }>;
  kill_events: KillEventsFile | null;
  /** Present only when `history` was supplied to the renderer. */
  dispatch_anchor: DispatchAnchorSummary | null;
}

export interface RenderedReport {
  markdown: string;
  json: ReportJson;
}

/**
 * Provenance validation over envelope events (plan: "a missing required token
 * value = provenance failure, never zero"). Returns human-readable failure
 * strings; empty array = the stream is contract-clean.
 *
 * Attempt-0 start markers (M4) are exempt from token/role requirements (they
 * are record-semantics under the target role and carry null tokens by design)
 * but must NOT carry tokens themselves.
 */
export function validateProvenance(envelopes: readonly EnvelopeEvent[]): string[] {
  const failures: string[] = [];
  for (const env of envelopes) {
    const tokens = tokenTotalOf(env.tokens);
    if (env.attempt < 0) {
      failures.push(`envelope ${env.stepId} has attempt ${env.attempt} < 0`);
      continue;
    }
    if (env.attempt === 0) {
      if (tokens !== null) {
        failures.push(`envelope ${env.stepId} is an attempt-0 start marker but carries token usage`);
      }
      continue;
    }
    if (isModelCallingRole(env.role)) {
      if (tokens === null && env.outcome !== "interrupted") {
        failures.push(
          `envelope ${env.stepId} (${env.role}) is model-calling but carries no token usage`,
        );
      }
    } else if (tokens !== null) {
      failures.push(`envelope ${env.stepId} (${env.role}) is non-model but carries token usage`);
    }
    if (env.outcome === "interrupted" && env.ended_at === null) {
      failures.push(`envelope ${env.stepId} is interrupted but has no ended_at (recovery did not close it)`);
    }
    const start = Date.parse(env.started_at);
    if (Number.isNaN(start)) {
      failures.push(`envelope ${env.stepId} has unparsable started_at "${env.started_at}"`);
    } else if (env.ended_at !== null) {
      const end = Date.parse(env.ended_at);
      if (Number.isNaN(end)) {
        failures.push(`envelope ${env.stepId} has unparsable ended_at "${env.ended_at}"`);
      } else if (end < start) {
        failures.push(`envelope ${env.stepId} ends before it starts`);
      }
    }
    if (env.wall_clock_ms !== null && env.wall_clock_ms < 0) {
      failures.push(`envelope ${env.stepId} has negative wall_clock_ms`);
    }
  }
  return failures;
}

/**
 * Full AC2 cross-check: the envelope stream reconciles against the attribute
 * log (validateProvenance) AND the envelope<->dispatch typed 1:N mapping holds
 * (anchorForRun). Missing required token usage still fails.
 */
export function runProvenanceCrossCheck(input: {
  envelopes: readonly EnvelopeEvent[];
  history: DispatchHistory;
  requireStartMarkers?: boolean;
}): ProvenanceCrossCheck {
  const envelopeFailures = validateProvenance(input.envelopes);
  const cross = anchorForRun(input.history, input.envelopes, {
    ...(input.requireStartMarkers === undefined
      ? {}
      : { requireStartMarkers: input.requireStartMarkers }),
  });
  const failures = [...envelopeFailures, ...cross.failures].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return { ok: failures.length === 0, failures, anchor: cross.anchor };
}

/**
 * Recover the grouping target for an envelope: explicit file/round first,
 * else parse the M2 identity (`file#round`); null for flow-level steps.
 * The live factory leaves file/round null on per-file steps — identity is
 * the authoritative target key.
 */
function envelopeTarget(env: EnvelopeEvent): { file: string; round: number | null } | null {
  if (env.file !== null) return { file: env.file, round: env.round };
  if (env.identity !== null) {
    const parsed = fileFromIdentity(env.identity);
    if (parsed !== null) return { file: parsed.file, round: env.round ?? parsed.round };
  }
  return null;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function summarizeAnchor(anchor: DispatchAnchorResult): DispatchAnchorSummary {
  return {
    ok: anchor.ok,
    failures: anchor.failures,
    envelopes_anchored: anchor.envelopes_anchored,
    dispatch_entries_total: anchor.dispatch_entries_total,
    non_agent_dispatch_entries: anchor.non_agent_dispatch_entries,
    unexplained_dispatch_entries: anchor.unexplained_dispatch_entries,
    model_steps_missing_start_marker: anchor.model_steps_missing_start_marker,
    groups: anchor.groups,
  };
}

function buildReportJson(input: MetricsRenderInput, cross: ProvenanceCrossCheck | null): ReportJson {
  const { envelopes, verdicts, burnDown } = input;
  const provenanceFailures = cross === null ? validateProvenance(envelopes) : cross.failures;

  // ---- universe of file+round pairs (envelopes + verdicts) ---------------
  const fileRoundKeys = new Set<string>();
  const files = new Set<string>();
  for (const env of envelopes) {
    const target = envelopeTarget(env);
    if (target === null || target.round === null) continue; // flow-level step
    fileRoundKeys.add(`${target.file}\u0000${target.round}`);
    files.add(target.file);
  }
  for (const v of verdicts) {
    fileRoundKeys.add(`${v.file}\u0000${v.round}`);
    files.add(v.file);
  }

  // ---- verdicts grouped by file+round ------------------------------------
  const verdictsByGroup = new Map<string, VerdictRecord[]>();
  for (const v of verdicts) {
    const key = `${v.file}\u0000${v.round}`;
    const list = verdictsByGroup.get(key);
    if (list) list.push(v);
    else verdictsByGroup.set(key, [v]);
  }

  const fileRounds: ReportJson["file_rounds"] = [];
  for (const key of fileRoundKeys) {
    const parts = key.split("\u0000");
    const file = parts[0] ?? "<unknown>";
    const round = Number(parts[1] ?? "0");
    const records = [...(verdictsByGroup.get(key) ?? [])].sort((p, q) =>
      compareStrings(p.reviewer, q.reviewer),
    );
    const agreement = agreementForGroup(records, file, round);
    const citationChecks: CitationCheckResult[] = records.flatMap((r) =>
      r.citation_check.map((c) => ({ finding_id: c.finding_id, p_cited: c.p_cited })),
    );
    fileRounds.push({
      file,
      round,
      records: records.map((r) => ({
        reviewer: r.reviewer,
        diff_id: r.diff_id,
        findings: r.findings,
      })),
      agreement,
      citation_checks: citationChecks,
    });
  }
  fileRounds.sort((p, q) => (p.file !== q.file ? compareStrings(p.file, q.file) : p.round - q.round));

  // ---- tokens + wall clock per file per role (real attempts only) --------
  interface FileRoleAgg {
    file: string;
    role: EnvelopeRole;
    steps: number;
    tokenSum: number | null;
    allHaveTokens: boolean;
    wallSum: number | null;
  }
  const fileRoleAggs = new Map<string, FileRoleAgg>();
  for (const env of envelopes) {
    if (env.attempt === 0) continue; // M4 start markers are not step work
    const file = envelopeTarget(env)?.file ?? "(flow)";
    const key = `${file}\u0000${env.role}`;
    let agg = fileRoleAggs.get(key);
    if (!agg) {
      agg = { file, role: env.role, steps: 0, tokenSum: null, allHaveTokens: true, wallSum: null };
      fileRoleAggs.set(key, agg);
    }
    agg.steps += 1;
    const tokens = tokenTotalOf(env.tokens);
    if (tokens === null) {
      agg.allHaveTokens = false;
    } else {
      agg.tokenSum = agg.tokenSum === null ? tokens : agg.tokenSum + tokens;
    }
    if (env.wall_clock_ms !== null) {
      agg.wallSum = (agg.wallSum ?? 0) + env.wall_clock_ms;
    }
  }
  const tokensByFileRole = [...fileRoleAggs.values()]
    .map((agg) => ({
      file: agg.file,
      role: agg.role,
      steps: agg.steps,
      tokens: agg.allHaveTokens && agg.tokenSum !== null ? agg.tokenSum : null,
      wall_clock_ms: agg.wallSum,
    }))
    .sort((p, q) => (p.file !== q.file ? compareStrings(p.file, q.file) : compareStrings(p.role, q.role)));

  // ---- totals over eligible (model-calling, real-attempt) steps ----------
  let modelTokens: number | null = null;
  let wallClockTotal = 0;
  let startMarkerCount = 0;
  let interruptedRealCount = 0;
  for (const env of envelopes) {
    if (env.attempt === 0) {
      startMarkerCount++;
      continue;
    }
    if (env.outcome === "interrupted") interruptedRealCount++;
    if (isModelCallingRole(env.role)) {
      const tokens = tokenTotalOf(env.tokens);
      if (tokens !== null) modelTokens = (modelTokens ?? 0) + tokens;
    }
    if (env.wall_clock_ms !== null) wallClockTotal += env.wall_clock_ms;
  }

  // ---- fixer retries -------------------------------------------------------
  const retriesByFile = new Map<string, number>();
  for (const env of envelopes) {
    if (env.stepId !== FIXER_STEP_ID || env.attempt === 0) continue;
    const file = envelopeTarget(env)?.file;
    if (file === undefined) continue;
    if (env.attempt > 1) {
      retriesByFile.set(file, (retriesByFile.get(file) ?? 0) + 1);
    } else if (!retriesByFile.has(file)) {
      retriesByFile.set(file, 0);
    }
  }
  const fixerRetries = [...retriesByFile.entries()]
    .map(([file, retries]) => ({ file, retries }))
    .sort((p, q) => compareStrings(p.file, q.file));

  // ---- queue burn-down ------------------------------------------------------
  interface QueueAgg {
    queue: QueueKind;
    iterations: Map<number, Array<{ file: string; error_count: number }>>;
  }
  const queueAggs = new Map<QueueKind, QueueAgg>();
  for (const sample of burnDown) {
    let agg = queueAggs.get(sample.queue);
    if (!agg) {
      agg = { queue: sample.queue, iterations: new Map() };
      queueAggs.set(sample.queue, agg);
    }
    const list = agg.iterations.get(sample.iteration);
    const entry = { file: sample.file, error_count: sample.error_count };
    if (list) list.push(entry);
    else agg.iterations.set(sample.iteration, [entry]);
  }
  const burnDownJson: ReportJson["queue_burn_down"] = [...queueAggs.values()]
    .sort((p, q) => compareStrings(p.queue, q.queue))
    .map((agg) => ({
      queue: agg.queue,
      iterations: [...agg.iterations.entries()]
        .sort((p, q) => p[0] - q[0])
        .map(([iteration, perFile]) => ({
          iteration,
          error_count: perFile.reduce((sum, e) => sum + e.error_count, 0),
          per_file: [...perFile].sort((p, q) => compareStrings(p.file, q.file)),
        })),
    }));

  return {
    generated_at: input.generatedAt ?? null,
    provenance_ok: provenanceFailures.length === 0,
    provenance_failures: provenanceFailures,
    summary: {
      files: [...files].sort(compareStrings),
      envelope_count: envelopes.length,
      start_marker_count: startMarkerCount,
      interrupted_envelope_count: interruptedRealCount,
      verdict_record_count: verdicts.length,
      tokens_model_roles: modelTokens,
      wall_clock_ms_total: wallClockTotal,
    },
    file_rounds: fileRounds,
    tokens_by_file_role: tokensByFileRole,
    fixer_retries: fixerRetries,
    queue_burn_down: burnDownJson,
    kill_events: input.killEvents ?? null,
    dispatch_anchor: cross === null ? null : summarizeAnchor(cross.anchor),
  };
}

// ---- markdown ----------------------------------------------------------------

function mdCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function pFmt(p: number): string {
  return p.toFixed(2);
}

function killEventLine(e: KillEvent): string {
  if (e.kind === "kill-intent") {
    return `- kill-intent run=${e.run_id} utc=${e.utc} monotonic_ms=${e.monotonic_ms} target_pids=${e.target_pids.join(",")}`;
  }
  const note = e.note === null ? "" : ` note=${mdCell(e.note)}`;
  return `- kill-completed run=${e.run_id} utc=${e.utc} monotonic_ms=${e.monotonic_ms} resumed=${e.resumed}${note}`;
}

function renderMarkdown(report: ReportJson): string {
  const lines: string[] = [];
  lines.push("# Porting Run Metrics Report");
  lines.push("");
  if (report.generated_at !== null) {
    lines.push(`_generated_at: ${report.generated_at}_`);
    lines.push("");
  }

  lines.push("## Provenance");
  lines.push(
    report.provenance_ok
      ? "- status: OK"
      : `- status: FAILED (${report.provenance_failures.length} failure(s))`,
  );
  for (const failure of report.provenance_failures) lines.push(`- ${mdCell(failure)}`);
  lines.push("");

  lines.push("## Summary");
  lines.push(`- files: ${report.summary.files.length}${report.summary.files.length > 0 ? ` (${report.summary.files.join(", ")})` : ""}`);
  lines.push(
    `- envelopes: ${report.summary.envelope_count} (start markers: ${report.summary.start_marker_count}, interrupted: ${report.summary.interrupted_envelope_count})`,
  );
  lines.push(`- completed verdict records: ${report.summary.verdict_record_count}`);
  const tokens = report.summary.tokens_model_roles;
  lines.push(
    tokens === null
      ? "- tokens (model-calling roles): n/a"
      : `- tokens (model-calling roles): ${tokens}`,
  );
  lines.push(`- total wall clock: ${report.summary.wall_clock_ms_total} ms`);
  lines.push("");

  lines.push("## Findings and agreement");
  if (report.file_rounds.length === 0) {
    lines.push("_no file+round records in the stream_");
  }
  for (const fr of report.file_rounds) {
    lines.push("");
    lines.push(`### ${fr.file} — round ${fr.round} (agreement: ${fr.agreement.outcome})`);
    if (fr.records.length === 0) {
      lines.push("_no completed verdict records (unreviewed)_");
    } else {
      lines.push("| reviewer | findings | severities |");
      lines.push("| --- | --- | --- |");
      for (const rec of fr.records) {
        const severities = rec.findings.map((f) => f.severity).join(", ");
        lines.push(`| ${mdCell(rec.reviewer)} | ${rec.findings.length} | ${mdCell(severities)} |`);
      }
    }
    lines.push(`- agreement: ${fr.agreement.outcome} — ${mdCell(fr.agreement.reason)}`);
    if (fr.citation_checks.length > 0) {
      const checks = fr.citation_checks
        .map((c) => `${c.finding_id}=${pFmt(c.p_cited)}`)
        .join(", ");
      lines.push(`- citation checks: ${checks}`);
    }
  }
  lines.push("");

  lines.push("## Tokens and wall clock per file and role");
  if (report.tokens_by_file_role.length === 0) {
    lines.push("_no envelope events in the stream_");
  } else {
    lines.push("| file | role | steps | tokens | wall clock ms |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const agg of report.tokens_by_file_role) {
      const tokensCell = agg.tokens === null ? "n/a" : String(agg.tokens);
      const wallCell = agg.wall_clock_ms === null ? "n/a" : String(agg.wall_clock_ms);
      lines.push(`| ${mdCell(agg.file)} | ${mdCell(agg.role)} | ${agg.steps} | ${tokensCell} | ${wallCell} |`);
    }
  }
  lines.push("");

  lines.push("## Fixer retries");
  if (report.fixer_retries.length === 0) {
    lines.push("_no fixer steps in the stream_");
  } else {
    lines.push("| file | retries |");
    lines.push("| --- | --- |");
    for (const fr of report.fixer_retries) {
      lines.push(`| ${mdCell(fr.file)} | ${fr.retries} |`);
    }
  }
  lines.push("");

  lines.push("## Queue burn-down");
  if (report.queue_burn_down.length === 0) {
    lines.push("_no queue samples in the stream_");
  }
  for (const q of report.queue_burn_down) {
    lines.push("");
    lines.push(`### ${q.queue}`);
    lines.push("| iteration | total | per file |");
    lines.push("| --- | --- | --- |");
    for (const it of q.iterations) {
      const perFile = it.per_file.map((e) => `${e.file}:${e.error_count}`).join(", ");
      lines.push(`| ${it.iteration} | ${it.error_count} | ${mdCell(perFile)} |`);
    }
  }
  lines.push("");

  lines.push("## Kill events");
  if (report.kill_events === null || report.kill_events.events.length === 0) {
    lines.push("_none recorded_");
  } else {
    for (const event of report.kill_events.events) lines.push(killEventLine(event));
  }
  lines.push("");
  lines.push(`- interrupted envelopes: ${report.summary.interrupted_envelope_count}`);
  lines.push("");

  lines.push("## Dispatch anchoring (dex typed 1:N)");
  const anchor = report.dispatch_anchor;
  if (anchor === null) {
    lines.push("_dex history not supplied — anchoring not evaluated_");
  } else {
    lines.push(anchor.ok ? "- status: OK" : "- status: FAILED");
    lines.push(`- envelopes anchored: ${anchor.envelopes_anchored}`);
    lines.push(
      `- dispatch entries: ${anchor.dispatch_entries_total} (non-agent kinds: ${anchor.non_agent_dispatch_entries}, unexplained: ${anchor.unexplained_dispatch_entries})`,
    );
    lines.push(`- model steps missing start marker: ${anchor.model_steps_missing_start_marker}`);
    for (const failure of anchor.failures) lines.push(`- ${mdCell(failure)}`);
  }
  lines.push("");
  return lines.join("\n");
}

/** Render the evidence stream into {markdown, json} for metrics/report.{md,json}. */
export function renderReport(input: MetricsRenderInput): RenderedReport {
  const cross =
    input.history === undefined || input.history === null
      ? null
      : runProvenanceCrossCheck({ envelopes: input.envelopes, history: input.history });
  const json = buildReportJson(input, cross);
  return { markdown: renderMarkdown(json), json };
}
