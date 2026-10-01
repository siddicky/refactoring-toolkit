/**
 * Harness runtime bridge (Phase 1 wiring): connects the DATA-ONLY agent
 * definitions (harness/agents/*) to the opencode runtime seam
 * (src/harness/opencode.ts), and owns the diff/verdict plumbing of the
 * review loop.
 *
 * Responsibilities (plan §Reviewer isolation enforcement + §Flow contract):
 * - effective-permission merge: agent tool config merged with the opencode
 *   plugin tool surface, DENY AUTHORITATIVE. The merged reviewer agent must
 *   have zero effective tools (tested in tests/agent-isolation-and-lease-integration.test.ts).
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
import type {
  DiffDocument,
  EvidenceSpan as MetricsEvidenceSpan,
  Finding as MetricsFinding,
  VerdictRecord as MetricsVerdictRecord,
} from "../metrics/types.js";
import type { PhpSymbol } from "../typesafe/symbol-types.js";
import { createInMemoryJevClient, type InMemoryResponder, type JudgmentClient } from "../typesafe/client.js";
import type { TokenUsage } from "../metrics/types.js";
import { isDemotedAttempt } from "./lanes.js";

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
 * The hard tool policy block appended to every agent turn: the model is told
 * its limits verbatim. It is rendered from the `tools` map that is ACTUALLY
 * SENT with the turn (default: {@link toolOverridesAllOff}, which is what the
 * port flow's runAgentTurn sends for every agent in bridge mode), intersected
 * with the agent's declarative config — so the text can never advertise a
 * tool the server has disabled. In bridge mode every agent (writers included)
 * therefore reads NONE.
 */
export function toolPolicyBlock(
  def: AgentDefinition,
  sentTools: Readonly<Record<string, boolean>> = toolOverridesAllOff(),
): string {
  const effective = TOOL_CATEGORIES.filter(
    (c) => sentTools[c] === true && def.tools.allow.includes(c) && !def.tools.deny.includes(c),
  );
  const denied = TOOL_CATEGORIES.filter((c) => !effective.includes(c));
  return [
    "## Tool policy (enforced)",
    `- Effective tools this turn: ${
      effective.length === 0
        ? "NONE — you have no tools at all (the toolkit writes files and runs git; you only reply in text)"
        : effective.join(", ")
    }`,
    `- Denied (cannot be re-enabled): ${denied.length > 0 ? denied.join(", ") : "none"}`,
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

/**
 * Wave-5 cost honesty (takeaways-synthesis #2): maps the opencode seam's
 * TokenUsage onto the metrics event contract's TokenUsage split so envelope
 * events can carry the full provider-reported cache/reasoning split + USD
 * cost instead of a bare total. Pure field rename; no inference.
 */
export function toEnvelopeUsage(u: {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}): TokenUsage {
  return {
    input_tokens: u.input,
    output_tokens: u.output,
    reasoning_tokens: u.reasoning,
    cache_read_tokens: u.cacheRead,
    cache_write_tokens: u.cacheWrite,
    cost_usd: u.cost,
  };
}

/**
 * Demotion policy = f(attempt) ONLY (US-002, plan v5.1 §Stage 1). Attempt
 * >= 2 on a REVIEW turn leaves the reviewer lane for the demotion lane
 * (OPENCODE_REVIEWER_MODEL_FALLBACK, else the executor lane — see
 * reviewLaneRouting in lanes.ts). PURE: no env reads, no durable state, no
 * clock — the dex attempt count is the durable signal (intra-step writes do
 * not survive a kill; 0(g)). A failed attempt re-enters the step with
 * attempt+1, so every Tier-0 retry lands here.
 *
 * The threshold lives in ONE place, `isDemotedAttempt` (lanes.ts), which this
 * helper and the lane router both call. Generic over the lane type so callers
 * can label a turn (e.g. "default" | "demoted" in the US-003 successor
 * diagnosis record) without restating the attempt rule. NO Tier-1 input: the
 * attempt count is a deterministic dex signal (AC-B2).
 */
export function demoteReviewerLane<L>(
  attempt: number | undefined,
  defaultLane: L,
  fallbackLane: L,
): L {
  return isDemotedAttempt(attempt) ? fallbackLane : defaultLane;
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

/** Unified-diff hunk header: `@@ -a[,b] +c[,d] @@`. */
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** One hunk's body range in 1-based raw-diff line numbers; `to` is exclusive. */
export interface HunkBodyRange {
  id: string;
  from: number;
  to: number;
}

/**
 * THE single source of hunk body ranges (parseUnifiedDiff's resolver and the
 * suspicion predicate both read it). Line numbers are 1-based positions in
 * the raw diff: the `@@` header at 0-based index i sits on line i + 1, so its
 * body starts on line i + 2 and runs up to (exclusive) the next header's line
 * (next index j -> line j + 1), or `lines.length + 1` for the last hunk. The
 * header line itself is therefore OUTSIDE every range and a hunk's last body
 * line is INSIDE it. Hunk ids are `h1..hN` in header order.
 */
function hunkBodyRanges(lines: readonly string[]): HunkBodyRange[] {
  const ranges: HunkBodyRange[] = [];
  let open: { id: string; from: number } | undefined;
  for (let i = 0; i < lines.length; i++) {
    if (!HUNK_HEADER_RE.test(lines[i] ?? "")) continue;
    if (open !== undefined) ranges.push({ ...open, to: i + 1 });
    open = { id: `h${ranges.length + 1}`, from: i + 2 };
  }
  if (open !== undefined) ranges.push({ ...open, to: lines.length + 1 });
  return ranges;
}

export function parseUnifiedDiff(diffText: string): ParsedDiff {
  const lines = diffText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const hunks: DiffDocument["hunks"] = [];
  for (const line of lines) {
    const m = HUNK_HEADER_RE.exec(line);
    if (m !== null) {
      hunks.push({
        hunk_id: `h${hunks.length + 1}`,
        header: line,
        old_start: Number(m[1] ?? 0),
        old_lines: m[2] === undefined ? 1 : Number(m[2]),
        new_start: Number(m[3] ?? 0),
        new_lines: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
      });
    } else {
      hunks[hunks.length - 1]?.lines.push(line);
    }
  }

  const ranges = hunkBodyRanges(lines);
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

// Markdown fence scanner (shared by the code, JSON and spec-map extractors)

interface FenceBlock {
  /** First word of the info string, lower-cased ("" for a bare fence). */
  lang: string;
  /** The fence run that opened the block, e.g. "```" or "````" or "~~~". */
  fence: string;
  /** Block content lines (no fence lines), joined with "\n". */
  body: string;
}

const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\r\n]*)$/;
const FENCE_CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;

/** Parses an opening fence line; null when the line does not open a block. */
function parseFenceOpen(line: string): { fence: string; lang: string } | null {
  const m = FENCE_OPEN_RE.exec(line);
  if (m === null) return null;
  const fence = m[1] ?? "";
  const info = (m[2] ?? "").trim();
  // CommonMark: a backtick fence's info string may not contain backticks, so a
  // line such as "```inline``` text" is prose, not an opener.
  if (fence.startsWith("`") && info.includes("`")) return null;
  return { fence, lang: (info.split(/\s+/)[0] ?? "").toLowerCase() };
}

/** True when `line` closes a block opened with `fence` (same char, >= length). */
function closesFence(line: string, fence: string): boolean {
  const m = FENCE_CLOSE_RE.exec(line);
  const run = m?.[1];
  return run !== undefined && run.startsWith(fence[0] ?? "`") && run.length >= fence.length;
}

/**
 * CommonMark-style fenced blocks in document order: a block closes at the
 * first bare fence of the SAME character and AT LEAST the opener's length, so
 * a longer outer fence (````markdown) safely contains nested ``` blocks.
 * An unterminated block is ignored (a truncated reply never yields a block).
 */
function scanFences(text: string): FenceBlock[] {
  const blocks: FenceBlock[] = [];
  let open: { fence: string; lang: string } | undefined;
  let body: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (open === undefined) {
      open = parseFenceOpen(line) ?? undefined;
      body = [];
    } else if (closesFence(line, open.fence)) {
      blocks.push({ lang: open.lang, fence: open.fence, body: body.join("\n") });
      open = undefined;
    } else {
      body.push(line);
    }
  }
  return blocks;
}

/**
 * The fence to wrap `content` in when it is embedded in a prompt: long enough
 * (>= 3) that no backtick run opening/closing a line of the content can end
 * it early.
 */
export function fenceFor(content: string): string {
  let longest = 2;
  for (const line of content.split("\n")) {
    const m = /^[ \t]*(`{3,})/.exec(line);
    if (m?.[1] !== undefined) longest = Math.max(longest, m[1].length);
  }
  return "`".repeat(longest + 1);
}

/** Upper bound on `{` start positions tried (keeps the scan linear-ish). */
const MAX_JSON_START_POSITIONS = 256;

/** The balanced `{ ... }` region starting at `start`, or null when unbalanced. */
function balancedObjectAt(text: string, start: number): string | null {
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
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extracts the first parseable JSON object from a model reply: fenced blocks
 * whose content is an object first, then EVERY `{` start position in order
 * (prose such as `see {above}: {"a":1}` no longer hides the real object
 * behind the first brace pair). Throws when nothing parses — the caller
 * retries the turn via dex rather than inventing a verdict.
 */
export function extractJsonObject(text: string): unknown {
  const candidates: string[] = [];
  for (const block of scanFences(text)) {
    const body = block.body.trim();
    if (body.startsWith("{")) candidates.push(body);
  }
  let tried = 0;
  for (let start = text.indexOf("{"); start >= 0 && tried < MAX_JSON_START_POSITIONS; start = text.indexOf("{", start + 1)) {
    tried++;
    const region = balancedObjectAt(text, start);
    if (region !== null) candidates.push(region);
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

/**
 * Extracts the complete ported file from a fenced code block: the first
 * ```typescript / ```ts block, else (no hint) the first block of any language,
 * else the first bare block. Fence-length aware (a longer outer fence wins
 * over nested ``` lines). `hint` is the legacy file-extension argument the
 * port steps pass (".ts"); a labelled non-TypeScript block is not accepted
 * when a hint is given.
 */
export function extractCodeFence(text: string, hint = ""): string {
  const blocks = scanFences(text).filter((b) => b.body.trim().length > 0);
  const pick =
    blocks.find((b) => b.lang === "typescript" || b.lang === "ts") ??
    (hint.length === 0 ? blocks[0] : undefined) ??
    blocks.find((b) => b.lang === "");
  if (pick === undefined) {
    // Legacy leniency: a closing fence glued to the last code line ("...;```")
    // is not a line-start closer, so the scanner saw an unterminated block.
    const loose =
      /```(?:typescript|ts)[ \t]*\n([\s\S]*?)```/.exec(text) ??
      (hint.length === 0 ? /```[A-Za-z]*[ \t]*\n([\s\S]*?)```/.exec(text) : null) ??
      /```[ \t]*\n([\s\S]*?)```/.exec(text);
    if (loose?.[1] === undefined || loose[1].trim().length === 0) {
      throw new Error("no fenced code block in reply");
    }
    return loose[1].replace(/\s+$/, "") + "\n";
  }
  return pick.body.replace(/\s+$/, "") + "\n";
}

/**
 * Extracts a markdown spec map from a planner reply. The spec itself contains
 * fenced examples (```typescript, ```php), so the FIRST closing fence cannot be
 * trusted: the block opened by the first markdown (else first) fence runs to
 * the LAST bare fence of at least the opener's length, which is the outer
 * closer in the single-block reply format the prep turns demand. A reply
 * without a complete outer block throws (dex retries) instead of yielding a
 * nested code block or a truncated spec.
 */
function extractMarkdownFence(text: string): string {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const openers: Array<{ index: number; fence: string; lang: string }> = [];
  lines.forEach((line, index) => {
    const parsed = parseFenceOpen(line);
    if (parsed !== null) openers.push({ index, ...parsed });
  });
  const open = openers.find((o) => o.lang === "markdown" || o.lang === "md") ?? openers[0];
  if (open === undefined) throw new Error("no fenced code block in reply");
  const openIndex = open.index;
  let closeIndex = -1;
  for (let i = lines.length - 1; i > openIndex; i--) {
    if (closesFence(lines[i] ?? "", open.fence)) {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex < 0) throw new Error("fenced markdown block is not closed (reply truncated?)");
  const body = lines.slice(openIndex + 1, closeIndex).join("\n");
  if (body.trim().length === 0) throw new Error("fenced markdown block is empty");
  // If the outer closer was lost (truncated reply) the last bare fence is an
  // INNER closer and the body ends inside a nested block: reject it.
  if (endsInsideFence(body)) {
    throw new Error("fenced markdown block ends inside a nested code fence (reply truncated?)");
  }
  return body.replace(/\s+$/, "") + "\n";
}

/** True when `text` leaves a fenced block open at its end. */
function endsInsideFence(text: string): boolean {
  let open: string | undefined;
  for (const line of text.split("\n")) {
    if (open === undefined) open = parseFenceOpen(line)?.fence;
    else if (closesFence(line, open)) open = undefined;
  }
  return open !== undefined;
}

/**
 * Structural check of a generated spec map: it must still carry the
 * source-map table. `expectedFiles` (the files the run ports) must each
 * appear in a table row — by full path, or by basename when that basename is
 * unique among the expected files (a planner may shorten `src/Money.php` to
 * `Money.php`). Returns the problems found (empty = acceptable).
 */
export function specMapProblems(specText: string, expectedFiles: readonly string[] = []): string[] {
  const rows = specText.split("\n").filter((l) => l.trimStart().startsWith("|"));
  if (rows.length === 0) return ["no source-map table (no `|` table rows)"];
  const basename = (f: string): string => f.slice(f.lastIndexOf("/") + 1);
  const mentions = (f: string): boolean => {
    const unique = expectedFiles.filter((g) => basename(g) === basename(f)).length === 1;
    return rows.some((r) => r.includes(f) || (unique && r.includes(basename(f))));
  };
  const missing = expectedFiles.filter((f) => !mentions(f));
  return missing.length > 0 ? [`source-map table lacks rows for: ${missing.join(", ")}`] : [];
}

/**
 * Prep spec-map extraction: outermost markdown fence + structural validation.
 * Throws (so dex retries the step) when the reply yields a truncated or
 * structure-less spec, which would otherwise become the prep artifact handed
 * to every implementer.
 */
export function extractSpecMap(text: string, options: { expectedFiles?: readonly string[] } = {}): string {
  const spec = extractMarkdownFence(text);
  const problems = specMapProblems(spec, options.expectedFiles ?? []);
  if (problems.length > 0) {
    throw new Error(`prep spec map rejected: ${problems.join("; ")}`);
  }
  return spec;
}

/**
 * Validates the reviewer's raw verdict and maps it onto the metrics event
 * contract's VerdictRecord. Authoritative identity fields (file, reviewer,
 * round, diff_id) are FORCED from the pipeline values — the model's copies
 * are advisory. Finding.summary is the reviewer's `description` (never the
 * disposition). The mapped record's citation_check is the DETERMINISTIC
 * citation check (`naiveCited`), not the model's self-report: the gate
 * recomputes citations and never reads the self-reported values, so the
 * report must not show them as if the gate had. The self-report survives
 * only on `agentRecord.citation_check` (advisory).
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

  const findings: MetricsFinding[] = [];
  for (const f of agentRecord.findings) {
    const evidence = resolveEvidence(f.evidence_span, input.parsedDiff, input.bodyLineOffset);
    findings.push({
      finding_id: f.finding_id,
      severity: f.severity,
      summary: f.description,
      evidence,
    });
  }

  return {
    ok: true,
    agentRecord,
    record: {
      file: input.file,
      reviewer: input.reviewer,
      round: input.round,
      diff_id: input.diffId,
      findings,
      citation_check: findings.map((f) => ({ finding_id: f.finding_id, p_cited: input.naiveCited(f) })),
    },
  };
}

// ---------------------------------------------------------------------------
// Turn composition (per-agent user messages)
// ---------------------------------------------------------------------------

/**
 * The user's PORTING.md by value, labelled AUTHORITATIVE (audit C75). The
 * planner rewrites PORTING.md into the generated prep artifact, which can drop
 * or reword its behavior requirements and known traps; only the php → ts
 * source-map rows stay deterministic. Delivering the user's text next to the
 * generated artifact lets the implementer/fixer honor it. Empty when absent
 * (runs persisted before the contract was stored).
 */
function userContractSection(userContract: string | undefined): string[] {
  if (userContract === undefined || userContract.trim().length === 0) return [];
  const fence = fenceFor(userContract);
  return [
    "## User contract — PORTING.md (AUTHORITATIVE; by value)",
    "This is the user's own contract: its source-map rows (exact php → ts targets), behavior requirements and known traps are binding. The generated prep artifact is a planner rewrite of this text; where it drops or contradicts the contract, follow the contract and say so in your summary.",
    `${fence}markdown`,
    userContract,
    fence,
    "",
  ];
}

export function composeImplementerTurn(input: {
  phpFileName: string;
  phpSource: string;
  prepExcerpt: string;
  outputPath: string;
  /** US-010: appended scope context for TEST ports (tests/* -> vitest). */
  scopeNote?: string;
  /** The user's PORTING.md text (PrepArtifact.userContract); authoritative. */
  userContract?: string;
}): string {
  return [
    `Port the PHP file \`${input.phpFileName}\` to TypeScript.`,
    ...(input.scopeNote !== undefined ? ["", input.scopeNote] : []),
    "",
    "## Output path (write target, worktree-relative)",
    input.outputPath,
    "",
    "## PHP source (read-only, by value)",
    "```php",
    input.phpSource,
    "```",
    "",
    ...userContractSection(input.userContract),
    "## Prep artifact (generated spec map, reviewed in the prep loop; by value)",
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
  /** US-010: appended scope context when the reviewed diff is a TEST port. */
  scopeNote?: string;
}): string {
  return [
    `Reviewer id: ${input.reviewerId} (use exactly this value as "reviewer" in your verdict).`,
    "Review the diff below and emit your verdict JSON per your standing instructions.",
    ...(input.scopeNote !== undefined ? ["", input.scopeNote] : []),
    "",
    input.diffBlock,
    "",
    "Emit exactly one JSON object and nothing else.",
    `${input.reviewerLabel}: remember — evidence must literally appear in the diff above.`,
  ].join("\n");
}

/**
 * US-010 test-port scope note (pure): the port loop also ports the fixture's
 * PHPUnit TEST files, so implementer and reviewer turns say so explicitly.
 * Returns null for source ports (no note).
 */
export function testPortScopeNote(phpFile: string): string | null {
  const isTest =
    phpFile.startsWith("tests/") ||
    /(^|\/)[\w-]+Test\.php$/.test(phpFile) ||
    phpFile.startsWith("test/");
  if (!isTest) return null;
  return (
    "SCOPE: this is a TEST PORT (PHPUnit -> vitest). The output file is a vitest " +
    "test module (`import { describe, it, expect } from \"vitest\"`); it exercises " +
    "the corresponding ported source module under src/. Review it as test code: " +
    "assertion quality and faithful translation of the PHP assertions matter more " +
    "than production-hardening."
  );
}

/**
 * US-006 repair re-prompt (ONE per review turn, SAME reviewer session): sent
 * on the session that already holds the diff, so it re-asks for the verdict
 * JSON only — no diff redelivery. `reasons` are the deterministic suspicion
 * reasons (src/metrics/suspicion.ts); the reply is routed through the SAME
 * harness.prompt path, so the Tier-0 degenerateReply guard applies to it.
 */
export function composeReviewerRepairTurn(input: { reasons: readonly string[] }): string {
  return [
    "Your previous reply on this review was NOT accepted as a usable verdict.",
    "Deterministic checks it failed:",
    ...input.reasons.map((r) => `- ${r}`),
    "",
    "Emit exactly one valid JSON verdict object for the SAME diff (already in this conversation) and nothing else.",
    "Rules: every finding's evidence_span lines must point INTO the diff hunks with the snippet quoted verbatim from the diff; at most 5 findings unless severities vary; output exactly one JSON object.",
  ].join("\n");
}

export function composeFixerTurn(input: {
  currentContent: string;
  findings: readonly MetricsFinding[];
  outputPath: string;
  /** The user's PORTING.md text (PrepArtifact.userContract); authoritative. */
  userContract?: string;
}): string {
  const findingsText =
    input.findings.length === 0
      ? "(no findings)"
      : input.findings
          .map(
            (f, i) =>
              `${i + 1}. [${f.severity}] ${f.finding_id}: ${f.summary} — evidence: ${
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
    ...userContractSection(input.userContract),
    "## Reply format (the ONLY thing you emit)",
    "One fenced ```typescript block containing the COMPLETE fixed file, then one short line:",
    "SUMMARY: <what you changed per finding>.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Phase 3 — prep-analysis: symbol harvesting + offline Jev resolution
// ---------------------------------------------------------------------------

/**
 * Per-file symbol cap (cost guard: every symbol costs two Jev calls). Shared
 * by the port flow and scripts/jev-spot-check.ts so the spot-check grades the
 * production path; truncation is REPORTED (see {@link SymbolHarvest},
 * {@link renderSymbolTable}), never silent.
 */
export const SYMBOL_HARVEST_CAP = 20;

/** Result of one file's symbol harvest, including what the cap cut off. */
export interface SymbolHarvest {
  symbols: PhpSymbol[];
  /** Distinct symbols found beyond the cap (0 when nothing was truncated). */
  omitted: number;
}

/**
 * Deterministic, code-only harvest of PHP symbols from one source file
 * (read-only input for the per-symbol table). Zero model calls. Captures
 * named functions, class methods, and typed properties, each with its
 * immediately preceding docblock when present. Comments never yield symbols
 * (a docblock that mentions "function helper(x)" is prose, not a function).
 *
 * @param cap maximum symbols returned (cost guard); default {@link SYMBOL_HARVEST_CAP}.
 */
export function harvestPhpSymbols(fileName: string, phpSource: string, cap = SYMBOL_HARVEST_CAP): PhpSymbol[] {
  return harvestPhpSymbolsReport(fileName, phpSource, cap).symbols;
}

/** {@link harvestPhpSymbols} plus the count of symbols the cap omitted. */
export function harvestPhpSymbolsReport(fileName: string, phpSource: string, cap = SYMBOL_HARVEST_CAP): SymbolHarvest {
  const lines = phpSource.split("\n");
  const symbols: PhpSymbol[] = [];
  const seen = new Set<string>();
  let omitted = 0;

  const docblockBefore = (index: number): string | null => {
    // Walk upward from `index` (line of the signature), skipping blanks and
    // attribute/visibility lines, collecting a contiguous /** ... */ block.
    let i = index - 1;
    while (i >= 0 && lines[i]?.trim() === "") i--;
    if (i >= 0 && (lines[i]?.includes("*/") ?? false)) {
      const block: string[] = [];
      while (i >= 0) {
        const line = lines[i] ?? "";
        block.unshift(line);
        if (line.includes("/**")) break;
        i--;
      }
      const joined = block.join("\n");
      return joined.includes("/**") ? joined.replace(/\/\*\*|\*\/|^\s*\*\s?/gm, "").trim() : null;
    }
    return null;
  };

  const push = (
    kind: PhpSymbol["kind"],
    name: string,
    signature: string,
    index: number,
    docblockOverride?: string,
  ): void => {
    const key = `${kind}:${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (symbols.length >= cap) {
      omitted++;
      return;
    }
    symbols.push({
      name,
      kind,
      file: fileName,
      signature,
      docblock: docblockOverride ?? docblockBefore(index),
      literal_usages: [],
    });
  };

  // One-line `/** @var T */ private $name;` property pairs (Money fixture style).
  for (const m of phpSource.matchAll(
    /\/\*\*\s*@var\s+([\w\\[\|]+)\s*\*\/\s*\n\s*(?:public|protected|private)\s+\$(\w+)/g,
  )) {
    const type = m[1];
    const name = m[2];
    if (type !== undefined && name !== undefined) {
      push("property", name, `$${name} — @var ${type}`, -1, `@var ${type}`);
    }
  }

  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Strip comments so neither a declaration regex nor a phantom `function`
    // mention inside a docblock / `// ...` / `# ...` can produce a symbol;
    // code sharing a line with a comment (`/** @return int */ public function
    // f()`) is still harvested. A block opener must follow whitespace or
    // punctuation, so a string such as "src/*" cannot open a bogus comment.
    let code: string;
    if (inBlockComment) {
      const end = line.indexOf("*/");
      inBlockComment = end < 0;
      code = end < 0 ? "" : line.slice(end + 2);
    } else {
      code = line.replace(/\/\*.*?\*\//g, "");
      const opener = /(^|[\s;{}(),])\/\*/.exec(code);
      if (opener !== null) {
        inBlockComment = true;
        code = code.slice(0, opener.index + (opener[1] ?? "").length);
      }
    }
    const codeTrimmed = code.trim();
    code =
      codeTrimmed.startsWith("//") || (codeTrimmed.startsWith("#") && !codeTrimmed.startsWith("#["))
        ? ""
        : code.replace(/\s\/\/.*$/, "");
    if (code.trim().length > 0) {
      // Typed properties with a @var docblock are harvested via their docblock
      // annotation (handled below); functions and methods via signatures.
      const fn = /(?:public|protected|private)?\s*(?:static\s+)?function\s+(\w+)\s*\(([^)]*)\)/.exec(code);
      if (fn !== null) {
        push("method", fn[1] ?? "", code.trim(), i);
        continue;
      }
      const typedProp = /^(?:public|protected|private)\s+(?:readonly\s+)?\??[\w\\]+\s+\$(\w+)/.exec(code.trim());
      if (typedProp !== null) {
        push("property", typedProp[1] ?? "", code.trim(), i);
        continue;
      }
    }
    // @var-annotated properties: the @var line itself names the symbol.
    const varAnnot = /@var\s+([\w\\\[\|]+)\s*$/.exec(line.trim());
    if (varAnnot !== null) {
      const next = lines[i + 1] ?? "";
      const propDecl = /(?:public|protected|private)\s+\$(\w+)/.exec(next);
      if (propDecl !== null) {
        push("property", propDecl[1] ?? "", `${next.trim()} — @var ${varAnnot[1]}`, i + 1);
      }
    }
  }
  return { symbols, omitted };
}

/** Who produced a row's `selected` value: the live model or the offline scripted double. */
export type SymbolJudge = "live" | "scripted";

/** One per-symbol table row as the planner turn renders it. */
export interface SymbolTableRowView {
  file: string;
  symbol: string;
  kind: string;
  candidates: readonly string[];
  selected: string;
  flagged: boolean;
  /** Absent on rows persisted before the judge tag existed (provenance unknown). */
  judge?: SymbolJudge;
}

/**
 * Markdown per-symbol table handed to the planner, headed by a PROVENANCE line
 * so scripted (offline first-candidate) picks are never presented as verified
 * model judgments. When `sources` are given, a file whose harvest was cut by
 * the cap gets an explicit note, so the table is never mistaken for complete
 * ("N of M symbols listed").
 */
export function renderSymbolTable(
  rows: readonly SymbolTableRowView[],
  sources: ReadonlyArray<{ name: string; source: string }> = [],
): string {
  const anyScripted = rows.some((r) => r.judge === "scripted");
  const allLive = rows.length > 0 && rows.every((r) => r.judge === "live");
  const provenance = anyScripted
    ? "> PROVENANCE: SCRIPTED OFFLINE PICKS (UNVERIFIED) — no model judged the rows marked `scripted` (no TYPESAFE_API_KEY, or TYPESAFE_OFFLINE). Their `Selected` is merely the first code-recalled candidate: use Candidates as evidence and decide each type from the PHP source."
    : allLive
      ? "> PROVENANCE: LIVE — `Selected` was judged by the live Jev model (selection + verification cascade)."
      : "> PROVENANCE: not recorded for these rows — treat `Selected` as an unverified hint.";
  const lines = [
    provenance,
    "",
    "| Symbol | Kind | File | Candidates | Selected | Flagged | Judge |",
    "|---|---|---|---|---|---|---|",
    ...rows.map(
      (r) =>
        `| ${r.symbol} | ${r.kind} | ${r.file} | ${r.candidates.join(", ") || "—"} | ${r.selected} | ${r.flagged ? "yes" : "no"} | ${r.judge ?? "unknown"} |`,
    ),
  ];
  for (const f of sources) {
    const total = harvestPhpSymbols(f.name, f.source, Number.POSITIVE_INFINITY).length;
    const listed = rows.filter((r) => r.file === f.name).length;
    if (total > listed) {
      lines.push(
        "",
        `> TRUNCATED: ${f.name} lists ${listed} of ${total} harvested symbols; the other ${total - listed} have NO pre-computed type — decide theirs from the PHP source.`,
      );
    }
  }
  return lines.join("\n");
}

/**
 * Deterministic offline responder for the in-memory Jev double (Phase 3
 * default when TYPESAFE_API_KEY is absent): Choice picks the first
 * non-NONE candidate at 0.9; nouls answer 0.95 (above the 0.8 escalation
 * threshold). These are SCRIPTED FIXTURES, not judgments: the symbol-table
 * step tags every row `judge: "scripted"`, the planner table is labelled
 * UNVERIFIED (see {@link renderSymbolTable}), and the double's synthetic
 * token counts never enter the judgment-role envelope (BUILD_NOTES: Jev-live
 * is BLOCKED-pending-key).
 */
export const offlineJevResponder: InMemoryResponder = (request) => {
  const answers: Record<string, unknown> = {};
  for (const [name, question] of Object.entries(request.questions)) {
    if (question.type === "choice") {
      const labels = Object.keys(question.criteria);
      const pick = labels.find((l) => l !== "NONE") ?? labels[0] ?? "NONE";
      const probabilities: Record<string, number> = {};
      for (const l of labels) probabilities[l] = l === pick ? 0.9 : 0.05;
      answers[name] = { type: "choice", choice: pick, confidence: 0.9, probabilities };
    } else {
      answers[name] = { type: "noul", noul: 0.95 };
    }
  }
  return answers;
};

/**
 * THE offline judgment factory: an in-memory Jev double over the scripted
 * responder. (client.ts no longer has a second, responder-less factory that
 * throws on the first call.) Its `kind` is "in-memory", which is what the
 * flow's scripted-vs-live tagging keys on.
 */
export function createOfflineJevClient(): JudgmentClient {
  return createInMemoryJevClient(offlineJevResponder);
}

/**
 * The worker's startup line for the active judgment lane. Names EVERY
 * consumer, including the symbol table, which keeps calling the offline
 * double (scripted first-candidate picks) when no real client is configured —
 * the old banner only mentioned verdict-check/prioritize/vitest-triage.
 */
export function judgmentLaneSummary(kind: JudgmentClient["kind"]): string {
  return kind === "real"
    ? "LIVE JEV — symbol-table/verdict-check/prioritize/vitest-triage consume the real billed client"
    : "NAIVE — verdict-check/prioritize/vitest-triage consume deterministic naive defaults (no Jev calls); symbol-table consumes the SCRIPTED offline double (first-candidate picks tagged judge=scripted, UNVERIFIED)";
}

// ---------------------------------------------------------------------------
// Phase 3/4 — prep-generation, prep-revision, queue-fix turn composition
// ---------------------------------------------------------------------------

/**
 * Reply-format lines shared by the prep turns: the spec map contains ```
 * code fences of its own, so the reply must be wrapped in a LONGER outer
 * fence (extractSpecMap understands fence length and, as a fallback, takes
 * the outermost block).
 */
const SPEC_REPLY_FORMAT: readonly string[] = [
  "Wrap the spec map in ONE fence opened with FOUR backticks and the word markdown (````markdown)",
  "and closed with four backticks (````): the spec contains ``` code fences of its own, which a",
  "longer outer fence keeps intact. Keep the source-map table (one row per PHP file).",
];

export function composePrepGenerateTurn(input: {
  phpFiles: ReadonlyArray<{ name: string; source: string }>;
  symbolTableText: string;
  stubPrepBaseline: string;
}): string {
  const sources = input.phpFiles
    .map((f) => `### ${f.name}\n\`\`\`php\n${f.source}\n\`\`\``)
    .join("\n\n");
  return [
    "Generate the PORTING SPEC MAP for the PHP files below.",
    "",
    "## PHP sources (read-only, by value)",
    sources,
    "",
    "## Per-symbol table (pre-computed; binding only where the Judge column says live)",
    "Rows judged `live` are binding input. Rows marked `scripted` or `unknown` are UNVERIFIED hints: Candidates are code-recalled evidence, but the PHP source wins over a `Selected` value.",
    input.symbolTableText,
    "",
    "## Prior stub baseline (supersede it; keep its section structure)",
    `${fenceFor(input.stubPrepBaseline)}markdown`,
    input.stubPrepBaseline,
    fenceFor(input.stubPrepBaseline),
    "",
    "## Reply format (the ONLY thing you emit)",
    ...SPEC_REPLY_FORMAT,
    "The block holds the COMPLETE revised spec map (source map: php file → ts target;",
    "mapping conventions; per-symbol table; known traps), then one line: SUMMARY: <key decisions>.",
  ].join("\n");
}

export function composePrepReviseTurn(input: {
  specMapText: string;
  findings: ReadonlyArray<{ finding_id: string; severity: string; summary: string; evidence: string }>;
}): string {
  const findingsText =
    input.findings.length === 0
      ? "(none)"
      : input.findings
          .map(
            (f, i) =>
              `${i + 1}. [${f.severity}] ${f.finding_id}: ${f.summary} — evidence: ${f.evidence}`,
          )
          .join("\n");
  return [
    "Revise the porting spec map below according to the validated review findings.",
    "",
    "## Current spec map (by value)",
    `${fenceFor(input.specMapText)}markdown`,
    input.specMapText,
    fenceFor(input.specMapText),
    "",
    "## Validated findings (apply all; they were citation-checked)",
    findingsText,
    "",
    "## Reply format (the ONLY thing you emit)",
    ...SPEC_REPLY_FORMAT,
    "The block holds the COMPLETE revised spec map, then one line: SUMMARY: <what changed per finding>.",
  ].join("\n");
}

export function composeQueueFixTurn(input: {
  currentContent: string;
  outputPath: string;
  errors: ReadonlyArray<{ code: string; message: string; line?: number }>;
  testFailures?: ReadonlyArray<{ name: string; message: string }>;
  /** The user's PORTING.md text (PrepArtifact.userContract); authoritative. */
  userContract?: string;
}): string {
  const errors = input.errors
    .map((e, i) => `${i + 1}. [${e.code}]${e.line !== undefined ? ` line ${e.line}:` : ""} ${e.message}`)
    .join("\n");
  const tests = (input.testFailures ?? [])
    .map((t, i) => `${i + 1}. ${t.name}: ${t.message}`)
    .join("\n");
  return [
    "Fix the ported TypeScript file below so the verification queues pass.",
    "",
    "## Output path",
    input.outputPath,
    "",
    "## Current file content (by value)",
    "```typescript",
    input.currentContent,
    "```",
    "",
    "## Compiler errors to resolve (all of them)",
    errors,
    input.testFailures !== undefined && input.testFailures.length > 0
      ? `\n## Failing tests\n${tests}`
      : "",
    "",
    ...userContractSection(input.userContract),
    "## Reply format (the ONLY thing you emit)",
    "One fenced ```typescript block containing the COMPLETE fixed file, then one line:",
    "SUMMARY: <what you changed>.",
  ].join("\n");
}
