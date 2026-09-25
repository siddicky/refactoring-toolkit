/**
 * Per-symbol TS-type selection (plan TypeSafe integration point 1).
 *
 * 1. CODE RECALL (pure code, no model): gather candidate TypeScript types for
 *    a PHP symbol from docblock hints, declared signature types (params,
 *    returns, properties), signature default literals, and observed literal
 *    usages — regex/tokenizer only, mapped through a PHP-doc -> TS type map.
 * 2. SELECTION: a TypeSafe Choice question whose options ARE the candidates
 *    (+ a NONE escape) picks the intended type.
 * 3. VERIFICATION CASCADE (SDE shape): four nouls — type_mismatch,
 *    hallucinated, unreasonable, absence_wrong — gate the selection. Any noul
 *    scoring below the escalation threshold flags the symbol.
 * 4. ESCALATION: flagged symbols (including the NONE escape and empty recall)
 *    return escalation records — the CALLER decides (plan: escalate to the
 *    implementer agent).
 */
import { choice, noul, type ChoiceCriteria, type ChoiceResponse, type JudgmentClient } from "./client.js";

// ---- inputs -----------------------------------------------------------------

export type PhpSymbolKind =
  | "function"
  | "method"
  | "property"
  | "parameter"
  | "variable"
  | "class"
  | "constant";

/** A PHP symbol extracted by the prep-analysis phase (read-only input). */
export interface PhpSymbol {
  name: string;
  kind: PhpSymbolKind;
  file: string;
  /** Raw signature line, e.g. `function countItems(array $items): int`. */
  signature: string;
  /** Raw docblock text (without delimiters is fine); null when absent. */
  docblock: string | null;
  /** Literal values observed at usages, e.g. `"42"`, `'"abc"'`, `"true"`. */
  literal_usages: readonly string[];
}

// ---- recall -------------------------------------------------------------------

export type CandidateOrigin = "docblock" | "signature" | "literal";

export interface TsTypeCandidate {
  type: string;
  origin: CandidateOrigin;
}

export interface RecallResult {
  candidates: TsTypeCandidate[];
}

/**
 * PHPDoc/PHP type hint -> TypeScript type. Handles nullable (`?T`), unions,
 * indexed sugar (`T[]`), common generics (`array<K,V>`, `list<T>`,
 * `iterable<T>`), PHPDoc keywords, and class-name passthrough (last
 * namespace segment).
 */
export function phpTypeToTsType(phpType: string): string {
  const t = phpType.trim();
  if (t === "") return "unknown";
  if (t.startsWith("?")) return `${phpTypeToTsType(t.slice(1))} | null`;

  const unionParts = splitTopLevel(t, "|");
  if (unionParts.length > 1) {
    return uniqueInOrder(unionParts.map((p) => phpTypeToTsType(p))).join(" | ");
  }
  if (t.endsWith("[]")) return `${phpTypeToTsType(t.slice(0, -2))}[]`;

  const genericStart = t.indexOf("<");
  if (genericStart > 0 && t.endsWith(">")) {
    const head = t.slice(0, genericStart).trim().toLowerCase();
    const args = splitTopLevel(t.slice(genericStart + 1, -1), ",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    if (head === "array" || head === "list" || head === "iterable") {
      const firstArg = args[0];
      if (args.length === 1 && firstArg !== undefined) return `${phpTypeToTsType(firstArg)}[]`;
      return "unknown[]";
    }
    return t; // unknown generic class: passthrough
  }

  const simple = PHP_TYPE_TO_TS[t.toLowerCase()];
  if (simple !== undefined) return simple;
  const segments = t.split("\\");
  return segments[segments.length - 1] ?? t;
}

const PHP_TYPE_TO_TS: Readonly<Record<string, string>> = {
  int: "number",
  integer: "number",
  long: "number",
  float: "number",
  double: "number",
  real: "number",
  number: "number",
  numeric: "number",
  string: "string",
  bool: "boolean",
  boolean: "boolean",
  true: "true",
  false: "false",
  null: "null",
  mixed: "unknown",
  array: "unknown[]",
  list: "unknown[]",
  iterable: "unknown[]",
  callable: "(...args: unknown[]) => unknown",
  object: "Record<string, unknown>",
  scalar: "string | number",
  void: "void",
  self: "self",
  static: "static",
};

/** Classify one PHP literal (source text) into a TS type; null when unrecognizable. */
export function literalTypeToTs(literal: string): string | null {
  const t = literal.trim();
  if (/^-?\d+$/.test(t) || /^-?\d+\.\d+$/.test(t)) return "number";
  if (t === "true" || t === "false") return "boolean";
  if (t === "null") return "null";
  if (t.length >= 2 && /^["']/.test(t) && /["']$/.test(t)) return "string";
  if (t.startsWith("[") && t.endsWith("]")) return "unknown[]";
  return null;
}

/** Split on `sep` only at angle-bracket/paren depth 0 (for unions and generics). */
function splitTopLevel(input: string, sep: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const ch of input) {
    if (ch === "<" || ch === "(") depth++;
    else if (ch === ">" || ch === ")") depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * Code recall: candidate TS types for a symbol, deduplicated preserving
 * first-seen order across sources in this order: docblock hints, signature
 * declared types (+ signature default literals), observed literal usages.
 */
export function recallCandidates(symbol: PhpSymbol): RecallResult {
  const candidates: TsTypeCandidate[] = [];
  const seen = new Set<string>();

  const push = (raw: string | null | undefined, origin: CandidateOrigin): void => {
    if (raw === null || raw === undefined) return;
    const type = phpTypeToTsType(raw);
    if (type.trim() === "" || seen.has(type)) return;
    seen.add(type);
    candidates.push({ type, origin });
  };

  // 1. docblock hints: @param {int} $x / @param int $x / @return int[] / @var float
  for (const m of symbol.docblock?.matchAll(/@(?:param|return|var)\s+(?:\{([^}]+)\}|([^\s$]+))/g) ??
    []) {
    push(m[1] ?? m[2], "docblock");
  }

  // 2. signature declared types: "?Type $name", "Type $name", return after "): Type"
  for (const m of symbol.signature.matchAll(/(\??[A-Za-z_][\w\\|<>[\]]*)\s+\$[A-Za-z_]\w*/g)) {
    push(m[1], "signature");
  }
  const returnType = symbol.signature.match(/\)\s*:\s*(\??[A-Za-z_][\w\\<>[\]|]*)\s*(?:\{|;|$)/);
  if (returnType) push(returnType[1], "signature");

  // 3. signature default literals: `$x = 10,` / `$x = 'a')`
  for (const m of symbol.signature.matchAll(
    /=\s*(-?\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|null)\s*[,)]/g,
  )) {
    const literal = m[1];
    if (literal !== undefined) push(literalTypeToTs(literal), "literal");
  }

  // 4. observed literal usages
  for (const lit of symbol.literal_usages) {
    push(literalTypeToTs(lit), "literal");
  }

  return { candidates };
}

// ---- selection + verification cascade ------------------------------------------

export type VerificationCheck = "type_mismatch" | "hallucinated" | "unreasonable" | "absence_wrong";

export const VERIFICATION_CHECKS: readonly VerificationCheck[] = [
  "type_mismatch",
  "hallucinated",
  "unreasonable",
  "absence_wrong",
];

export type EscalationCheck = VerificationCheck | "recall_empty" | "none_selected";

/** Default threshold: a verification noul scoring below this flags the symbol. */
export const DEFAULT_ESCALATION_THRESHOLD = 0.8;

export interface CheckResult {
  check: VerificationCheck;
  p: number;
  flagged: boolean;
}

export interface EscalationRecord {
  file: string;
  symbol: string;
  check: EscalationCheck;
  /** Noul probability when known; null for recall-level escalations. */
  p: number | null;
  /** Threshold applied when known; null for recall-level escalations. */
  threshold: number | null;
  reason: string;
}

export interface SymbolTypeDecision {
  file: string;
  symbol: string;
  candidates: TsTypeCandidate[];
  selected: string | "NONE";
  choice_confidence: number | null;
  checks: CheckResult[];
  escalations: EscalationRecord[];
  /** True when escalations is non-empty; the caller decides what to do. */
  flagged: boolean;
}

export interface SymbolTypeOptions {
  escalationThreshold?: number;
  model?: string;
}

/**
 * Full per-symbol flow: recall -> Choice over candidates (+NONE) -> four
 * verification nouls -> decision with escalation records. Two judgments calls
 * (selection, then the parallel cascade); zero calls when recall is empty.
 */
export async function selectSymbolType(
  client: JudgmentClient,
  symbol: PhpSymbol,
  options: SymbolTypeOptions = {},
): Promise<SymbolTypeDecision> {
  const threshold = options.escalationThreshold ?? DEFAULT_ESCALATION_THRESHOLD;
  const recall = recallCandidates(symbol);
  const base = {
    file: symbol.file,
    symbol: symbol.name,
    candidates: recall.candidates,
  };

  if (recall.candidates.length === 0) {
    return {
      ...base,
      selected: "NONE",
      choice_confidence: null,
      checks: [],
      escalations: [
        {
          file: symbol.file,
          symbol: symbol.name,
          check: "recall_empty",
          p: null,
          threshold: null,
          reason: "code recall found no candidate TypeScript types; escalate to the implementer agent",
        },
      ],
      flagged: true,
    };
  }

  const state = {
    symbol: {
      name: symbol.name,
      kind: symbol.kind,
      file: symbol.file,
      signature: symbol.signature,
      docblock: symbol.docblock,
      literal_usages: [...symbol.literal_usages],
    },
    candidates: recall.candidates.map((c) => c.type),
  };

  const criteria: ChoiceCriteria = {};
  for (const c of recall.candidates) {
    criteria[c.type] = `candidate recalled from ${c.origin}`;
  }
  criteria.NONE = "no recalled candidate is a suitable TypeScript type for this symbol; abstain";

  const selection = await client.systemOne({
    state,
    questions: {
      type_selection: choice(
        `Which TypeScript type best describes PHP symbol ${symbol.name} (${symbol.kind})? Pick NONE if none of the candidates is suitable.`,
        criteria,
      ),
    },
    ...(options.model === undefined ? {} : { model: options.model }),
  });
  const picked: ChoiceResponse<typeof criteria> = selection.answers.type_selection;

  if (picked.choice === "NONE") {
    return {
      ...base,
      selected: "NONE",
      choice_confidence: picked.confidence,
      checks: [],
      escalations: [
        {
          file: symbol.file,
          symbol: symbol.name,
          check: "none_selected",
          p: picked.confidence,
          threshold,
          reason: "the Choice selected the NONE escape; escalate to the implementer agent",
        },
      ],
      flagged: true,
    };
  }

  const selectedType = picked.choice;
  const cascadeState = { ...state, selected: selectedType };
  const cascade = await client.systemOne({
    state: cascadeState,
    questions: {
      type_mismatch: noul(
        `Does TypeScript type "${selectedType}" correctly match the usage of symbol ${symbol.name}? Answer true when the type fits every observed usage (signature, docblock, literals); false when it mismatches.`,
        { true: "the type matches the symbol's usage", false: "the type mismatches the symbol's usage" },
      ),
      hallucinated: noul(
        `Is "${selectedType}" a real, commonly used TypeScript type rather than an invented or nonexistent one?`,
        { true: "the type is real", false: "the type is invented or nonexistent" },
      ),
      unreasonable: noul(
        `Is "${selectedType}" a reasonable type for ${symbol.name} (${symbol.kind}) given this code's context?`,
        { true: "reasonable", false: "unreasonable" },
      ),
      absence_wrong: noul(
        `Given that NONE (abstain) was available as an answer, is choosing "${selectedType}" clearly better than abstaining for symbol ${symbol.name}?`,
        { true: "choosing the type is clearly better than abstaining", false: "abstaining would have been the better answer" },
      ),
    },
    ...(options.model === undefined ? {} : { model: options.model }),
  });

  const checks: CheckResult[] = VERIFICATION_CHECKS.map((check) => {
    const answer = cascade.answers[check];
    return { check, p: answer.noul, flagged: answer.noul < threshold };
  });
  const escalations: EscalationRecord[] = checks
    .filter((c) => c.flagged)
    .map((c) => ({
      file: symbol.file,
      symbol: symbol.name,
      check: c.check,
      p: c.p,
      threshold,
      reason: `verification noul ${c.check} scored ${c.p.toFixed(3)} below threshold ${threshold}`,
    }));

  return {
    ...base,
    selected: selectedType,
    choice_confidence: picked.confidence,
    checks,
    escalations,
    flagged: escalations.length > 0,
  };
}
