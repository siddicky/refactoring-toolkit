/**
 * Harness runtime bridge (Phase 1 wiring): connects the DATA-ONLY agent
 * definitions (harness/agents/*) to the opencode runtime seam
 * (src/harness/opencode.ts), and owns the diff/verdict plumbing of the
 * review loop.
 *
 * Responsibilities (plan §Reviewer isolation enforcement + §Flow contract):
 * - effective-permission merge: agent tool config merged with the opencode
 *   plugin tool surface, DENY AUTHORITATIVE. The merged reviewer agent must
 *   have zero effective tools (tested in tests/phase1-isolation.test.ts).
 * - diff pass-by-value: the reviewed diff is rendered into the prompt with a
 *   stable 1-based line numbering shared with the hunk resolver, so reviewer
 *   evidence spans can be mapped back onto diff hunks.
 * - verdict intake: extract the reviewer's JSON object, validate it against
 *   the verdict schema (harness/agents/verdict-schema.ts), and map it onto
 *   the metrics event contract's VerdictRecord/Finding/EvidenceSpan shapes
 *   (src/metrics/types.ts) consumed by naiveCitationCheck/naivePrioritize.
 *
 * v1 tooling reality (recorded deviation): agent turns are prompt-in /
 * content-out through this bridge — the toolkit writes files into the lease
 * worktree and runs every git operation. Agents therefore have NO tool
 * surface at all (stronger than deny-lists); "scoped write tools" are
 * enforced by toolkit mediation. Revisit when opencode per-agent tool config
 * is wired for real server-side execution.
 */

import type { AgentDefinition, ToolCategory } from "../../harness/agents/types.js";
import { TOOL_CATEGORIES } from "../../harness/agents/types.js";
import {
  validateVerdictRecord,
  type VerdictRecord as AgentVerdictRecord,
} from "../../harness/agents/verdict-schema.js";
import type { DiffDocument, EvidenceSpan as MetricsEvidenceSpan, Finding as MetricsFinding, VerdictRecord as MetricsVerdictRecord } from "../metrics/types.js";

// ---------------------------------------------------------------------------
// Effective permissions (config + plugin merge, deny authoritative)
// ---------------------------------------------------------------------------

/**
 * The tool surface the opencode plugin merge exposes by default: every known
 * category is present unless the agent config denies it. Merged effective
 * tools = (plugin surface ∩ allow) − deny.
 */
export function pluginToolSurface(): readonly ToolCategory[] {
  return TOOL_CATEGORIES;
}

/** Effective tools for one agent after config + plugin merge. */
export function effectiveTools(def: AgentDefinition): readonly ToolCategory[] {
  return TOOL_CATEGORIES.filter(
    (c) => def.tools.allow.includes(c) && !def.tools.deny.includes(c),
  );
}

/**
 * Deny-authoritative per-turn `tools` map for the opencode prompt body:
 * every plugin-surface category is explicitly allowed (true) or denied
 * (false). Reviewers come out all-false — server-side, not just prompt text.
 */
export function toolOverridesFor(def: AgentDefinition): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  for (const category of TOOL_CATEGORIES) {
    overrides[category] = def.tools.allow.includes(category) && !def.tools.deny.includes(category);
  }
  return overrides;
}

/**
 * BRIDGE-MODE enforcement (v1): EVERY agent turn runs with the entire tool
 * surface disabled server-side. The toolkit mediates all writes into the
 * lease worktree and is the sole git operator, so writer agents need no
 * server-side tools either. LIVE-VERIFIED LEAK (trial gate, recorded in
 * BUILD_NOTES): writer agents on opencode's `build` agent (cwd = the
 * toolkit repo, write tools enabled) wrote their "output path" files
 * directly into the repo instead of only replying — the leak this helper
 * closes. `toolOverridesFor` above remains the declarative config view.
 */
export function toolOverridesAllOff(): Record<string, boolean> {
  const overrides: Record<string, boolean> = {};
  for (const category of TOOL_CATEGORIES) overrides[category] = false;
  return overrides;
}

/** True when the merged agent holds zero effective tools (reviewer rule). */
export function hasZeroEffectiveTools(def: AgentDefinition): boolean {
  return effectiveTools(def).length === 0;
}

/**
 * The hard tool policy block appended to every agent turn. This is the
 * runtime enforcement of the deny list in the prompt-in/content-out bridge:
 * the model is told its limits verbatim on every turn.
 */
export function toolPolicyBlock(def: AgentDefinition): string {
  const denied = def.tools.deny.length > 0 ? def.tools.deny.join(", ") : "none";
  const allowed = effectiveTools(def);
  return [
    "## Tool policy (enforced)",
    `- Effective tools after the config + plugin merge: ${allowed.length === 0 ? "NONE — you have no tools at all" : allowed.join(", ")}`,
    `- Denied (cannot be re-enabled): ${denied}`,
    "- No git operations of any kind: the toolkit is the sole committer.",
    "- Everything you need is inside this prompt; answer in your reply text.",
  ].join("\n");
}

/**
 * Optional opencode agent override for REVIEWER sessions
 * (OPENCODE_REVIEWER_AGENT env). ODW defense-in-depth: launching reviewers
 * on a read-only/text-only agent (e.g. opencode's "plan") in addition to the
 * tool deny list keeps diff isolation enforced even if the tools map is
 * ignored by a future plugin merge.
 */
export function reviewerAgentOverride(): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const v = proc?.env?.OPENCODE_REVIEWER_AGENT?.trim();
  return v !== undefined && v !== "" ? v : undefined;
}

// ---------------------------------------------------------------------------
// Diff pass-by-value plumbing
// ---------------------------------------------------------------------------

/**
 * Number of wrapper header lines renderDiffForReview puts BEFORE the diff
 * body; reviewer line numbers minus this offset are body lines.
 */
export const DIFF_HEADER_LINES = 5;

/**
 * Renders the diff block delivered to reviewers: a deterministic header plus
 * the raw unified diff. Evidence `start_line`/`end_line` values are 1-based
 * lines WITHIN THIS BLOCK (line 1 = the first header line; the first line of
 * the diff body is line DIFF_HEADER_LINES + 1).
 */
export function renderDiffForReview(input: {
  diffText: string;
  file: string;
  round: number;
  diffId: string;
}): { block: string; lineCount: number } {
  const header = [
    `DIFF_ID: ${input.diffId}`,
    `FILE: ${input.file}`,
    `ROUND: ${input.round}`,
    `Evidence line numbers are 1-based positions IN THIS BLOCK: lines 1-${DIFF_HEADER_LINES} are this header and the diff body starts at line ${DIFF_HEADER_LINES + 1}.`,
    "--- BEGIN DIFF ---",
  ];
  const body = input.diffText.replace(/\n$/, "").split("\n");
  const block = [...header, ...body].join("\n");
  return { block, lineCount: block.split("\n").length };
}

/**
 * The shape of the parsed diff used for evidence resolution: the metrics
 * DiffDocument plus the body-line index and raw body lines. The durable
 * diff attribute stores only JSON-safe parts (raw text + doc); the index is
 * rebuilt deterministically via {@link parseUnifiedDiff} at use time.
 */
export interface ParsedDiff extends DiffDocument {
  /** The diff body split into lines (trailing newline removed). */
  lines: string[];
  /** Hunk id for a 1-based body line, undefined outside every hunk. */
  hunkIdForBodyLine(line: number): string | undefined;
}

export function parseUnifiedDiff(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const hunks: DiffDocument["hunks"] = [];
  const ranges: Array<{ from: number; to: number; id: string }> = [];
  let current: { from: number; id: string } | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (m !== null) {
      if (current !== undefined) {
        ranges.push({ from: current.from, to: i, id: current.id });
      }
      const hunk: DiffDocument["hunks"][number] = {
        hunk_id: `h${hunks.length + 1}`,
        header: line,
        old_start: Number(m[1] ?? 0),
        old_lines: m[2] === undefined ? 1 : Number(m[2]),
        new_start: Number(m[3] ?? 0),
        new_lines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
      };
      hunks.push(hunk);
      current = { from: i + 1, id: hunk.hunk_id }; // body starts AFTER the @@ header
      continue;
    }
    if (current !== undefined) {
      hunks[hunks.length - 1]?.lines.push(line);
    }
  }
  if (current !== undefined) {
    ranges.push({ from: current.from, to: lines.length, id: current.id });
  }

  const hunkIdForBodyLine = (line: number): string | undefined => {
    for (const r of ranges) {
      if (line >= r.from && line < r.to) return r.id;
    }
    return undefined;
  };

  return { diff_id: "", file: "", base_ref: null, hunks, lines, hunkIdForBodyLine };
}

/**
 * Resolves a reviewer evidence span onto the diff: returns the metrics
 * EvidenceSpan (hunk-resolved) or null when the span cannot be trusted.
 * `bodyLineOffset` = number of wrapper header lines BEFORE the diff body in
 * the delivered block (see {@link renderDiffForReview}); reviewer line
 * numbers are relative to the delivered BLOCK.
 */
export function resolveEvidence(
  span: { start_line: number; end_line: number; snippet?: string },
  parsed: ParsedDiff,
  bodyLineOffset: number,
): MetricsEvidenceSpan | null {
  const start = span.start_line - bodyLineOffset;
  const end = span.end_line - bodyLineOffset;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
    return null;
  }
  const quote = (span.snippet ?? "").trim();
  if (quote.length === 0) return null;

  // Hunk membership: the start line's hunk, else any hunk the span touches,
  // else a hunk whose text contains the snippet, else a required hit anywhere
  // in the body (attributed to the first hunk) — never an invented span.
  let hunkId = parsed.hunkIdForBodyLine(start);
  if (hunkId === undefined) {
    for (let l = start; l <= end && hunkId === undefined; l++) {
      hunkId = parsed.hunkIdForBodyLine(l);
    }
  }
  if (hunkId === undefined) {
    const bodyText = parsed.lines.join("\n");
    const hit = parsed.hunks.find((h) => h.lines.some((l) => l.includes(quote)));
    if (hit !== undefined) {
      hunkId = hit.hunk_id;
    } else if (bodyText.includes(quote)) {
      hunkId = parsed.hunks[0]?.hunk_id ?? "";
    } else {
      return null; // evidence does not appear in the diff at all
    }
  }
  return {
    hunk_id: hunkId,
    start_line: start,
    end_line: end,
    quote,
  };
}

// ---------------------------------------------------------------------------
// Verdict intake: extract -> validate -> map to metrics shapes
// ---------------------------------------------------------------------------

/**
 * Extracts the first JSON object from a model reply: fenced ```json blocks
 * first, then the first balanced `{ ... }` region. Throws when nothing
 * parses — the caller retries the turn via dex rather than inventing a
 * verdict.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/.exec(text);
  const candidates: string[] = [];
  if (fenced?.[1] !== undefined) candidates.push(fenced[1]);
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = !inString;
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try next candidate
    }
  }
  throw new Error("no parseable JSON object in reply");
}

/** Extracts the complete ported file from a fenced code block. */
export function extractCodeFence(text: string, hint = ""): string {
  const patterns = [
    /```(?:typescript|ts)\s*\n([\s\S]*?)```/,
    hint.length > 0
      ? new RegExp(`\`\`\`(?:typescript|ts)?\\s*\\n([\\s\\S]*?\\.${hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?)\`\`\``)
      : /```[a-z]*\s*\n([\s\S]*?)```/,
    /```\s*\n([\s\S]*?)```/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m?.[1] !== undefined && m[1].trim().length > 0) return m[1].replace(/\s+$/, "") + "\n";
  }
  throw new Error("no fenced code block in reply");
}

/**
 * Validates the reviewer's raw verdict and maps it onto the metrics event
 * contract's VerdictRecord. Authoritative identity fields (file, reviewer,
 * round, diff_id) are FORCED from the pipeline values — the model's copies
 * are advisory. Findings whose citation_check entry is missing get one from
 * the naive citation check (the model's honest self-assessment is kept when
 * present).
 */
export function mapVerdictToMetrics(input: {
  raw: unknown;
  file: string;
  reviewer: string;
  round: number;
  diffId: string;
  parsedDiff: ReturnType<typeof parseUnifiedDiff>;
  bodyLineOffset: number;
  naiveCited: (finding: MetricsFinding) => number;
}): { ok: true; record: MetricsVerdictRecord; agentRecord: AgentVerdictRecord } | { ok: false; errors: string[] } {
  const forced = {
    ...(typeof input.raw === "object" && input.raw !== null ? input.raw : {}),
    file: input.file,
    reviewer: input.reviewer,
    round: input.round,
    diff_id: input.diffId,
  };
  const result = validateVerdictRecord(forced);
  if (!result.ok) return { ok: false, errors: result.errors };

  const agentRecord = result.value;
  const citedById = new Map(agentRecord.citation_check.map((c) => [c.finding_id, c.p_cited]));

  const findings: MetricsFinding[] = [];
  for (const f of agentRecord.findings) {
    const evidence = resolveEvidence(f.evidence_span, input.parsedDiff, input.bodyLineOffset);
    const summary =
      f.disposition.length > 0
        ? f.disposition
        : f.evidence_span.snippet?.slice(0, 120) ?? "";
    findings.push({
      finding_id: f.finding_id,
      severity: f.severity,
      summary,
      evidence,
    });
  }

  const naive = input.naiveCited;
  return {
    ok: true,
    agentRecord,
    record: {
      file: input.file,
      reviewer: input.reviewer,
      round: input.round,
      diff_id: input.diffId,
      findings,
      citation_check: findings.map((f) => {
        const given = citedById.get(f.finding_id);
        return { finding_id: f.finding_id, p_cited: given ?? naive(f) };
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Turn composition (per-agent user messages)
// ---------------------------------------------------------------------------

export function composeImplementerTurn(input: {
  phpFileName: string;
  phpSource: string;
  prepExcerpt: string;
  outputPath: string;
}): string {
  return [
    `Port the PHP file \`${input.phpFileName}\` to TypeScript.`,
    "",
    "## Output path (write target, worktree-relative)",
    input.outputPath,
    "",
    "## PHP source (read-only, by value)",
    "```php",
    input.phpSource,
    "```",
    "",
    "## Prep artifact (stub, by value)",
    input.prepExcerpt,
    "",
    "## Reply format (the ONLY thing you emit)",
    "One fenced ```typescript block containing the COMPLETE ported file, then one short line:",
    "SUMMARY: <what you ported and any deviations from the prep artifact>.",
    "Do not emit anything else.",
  ].join("\n");
}

export function composeReviewerTurn(input: {
  reviewerId: string;
  reviewerLabel: string;
  diffBlock: string;
}): string {
  return [
    `Reviewer id: ${input.reviewerId} (use exactly this value as "reviewer" in your verdict).`,
    "Review the diff below and emit your verdict JSON per your standing instructions.",
    "",
    input.diffBlock,
    "",
    "Emit exactly one JSON object and nothing else.",
    `${input.reviewerLabel}: remember — evidence must literally appear in the diff above.`,
  ].join("\n");
}

export function composeFixerTurn(input: {
  currentContent: string;
  findings: readonly MetricsFinding[];
  outputPath: string;
}): string {
  const findingsText =
    input.findings.length === 0
      ? "(no findings)"
      : input.findings
          .map(
            (f, i) =>
              `${i + 1}. [${f.severity}] ${f.finding_id} (${f.summary}) — evidence: ${
                f.evidence?.quote ?? "(uncited)"
              }`,
          )
          .join("\n");
  return [
    "Fix the ported file below according to the validated findings.",
    "",
    `## Output path`,
    input.outputPath,
    "",
    "## Current file content (by value)",
    "```typescript",
    input.currentContent,
    "```",
    "",
    "## Validated findings (apply in this order; skip wontfix)",
    findingsText,
    "",
    "## Reply format (the ONLY thing you emit)",
    "One fenced ```typescript block containing the COMPLETE fixed file, then one short line:",
    "SUMMARY: <what you changed per finding>.",
  ].join("\n");
}
