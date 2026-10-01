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
import { lookupPhpTypeHint } from "../../harness/skills/php-ts-type-map.js";

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
  /**
   * The class, interface, trait or enum the symbol is declared in, when the
   * harvest saw one. `self` / `static` map to this name; without it they have
   * no valid TypeScript spelling and recall falls back to `unknown`.
   */
  className?: string;
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
 * Where a type hint sits, which decides what `self` / `static` can become (B6).
 * TypeScript's polymorphic `this` is an error in a static member or a
 * standalone function (TS2526) and rejects another instance as a parameter, so
 * the default for both is the enclosing class's name.
 */
export interface TypeHintContext {
  /** The enclosing class: the spelling of `self` / `static`; `unknown` when not known. */
  className?: string | undefined;
  /** The hint is the return type of an instance method: `static` may be `this` there. */
  thisAllowed?: boolean;
}

/**
 * PHPDoc/PHP type hint -> TypeScript type. Handles nullable (`?T`), unions,
 * indexed sugar (`T[]`), common generics (`array<K,V>`, `list<T>`,
 * `iterable<T>`), PHPDoc keywords (from the map SHARED with the porting
 * conventions: harness/skills/php-ts-type-map.ts), `self` / `static` (see
 * {@link TypeHintContext}), and class-name passthrough (last namespace
 * segment).
 */
export function phpTypeToTsType(phpType: string, context: TypeHintContext = {}): string {
  const t = phpType.trim();
  if (t === "") return "unknown";
  if (t.startsWith("?")) return `${phpTypeToTsType(t.slice(1), context)} | null`;

  const unionParts = splitTopLevel(t, "|");
  if (unionParts.length > 1) {
    return uniqueInOrder(unionParts.map((p) => phpTypeToTsType(p, context))).join(" | ");
  }
  if (t.endsWith("[]")) return `${phpTypeToTsType(t.slice(0, -2), context)}[]`;
  const selfHint = t.toLowerCase();
  if (selfHint === "self" || selfHint === "static") {
    return selfHint === "static" && context.thisAllowed === true ? "this" : (context.className ?? "unknown");
  }
  // PHPStan/Psalm array shapes (`array{id: int}`) are not TS syntax.
  if (/^(?:array|object)\s*\{/i.test(t)) return "Record<string, unknown>";

  const genericStart = t.indexOf("<");
  if (genericStart > 0 && t.endsWith(">")) {
    const head = t.slice(0, genericStart).trim().toLowerCase();
    const args = splitTopLevel(t.slice(genericStart + 1, -1), ",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);
    if (head === "array" || head === "list" || head === "iterable") {
      const firstArg = args[0];
      const element = args.length === 1 && firstArg !== undefined ? phpTypeToTsType(firstArg, context) : null;
      if (head === "iterable") return element === null ? "Iterable<unknown>" : `Iterable<${element}>`;
      return element === null ? "unknown[]" : `${element}[]`;
    }
    return t; // unknown generic class: passthrough
  }

  const simple = lookupPhpTypeHint(t);
  if (simple !== undefined) return simple;
  const segments = t.split("\\");
  return segments[segments.length - 1] ?? t;
}

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
    if (ch === "<" || ch === "(" || ch === "{") depth++;
    else if (ch === ">" || ch === ")" || ch === "}") depth = Math.max(0, depth - 1);
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
 * The type token after each `@param` / `@return` / `@var` in a docblock:
 * either the `{int}` brace form, or a run that keeps `<...>`, `(...)` and
 * `{...}` balanced (so `array<int, string>` and `array{id: int}` survive
 * their inner whitespace) and ends at top-level whitespace or a `$variable`.
 */
function docblockTypeTokens(docblock: string): Array<{ tag: string; token: string }> {
  const tokens: Array<{ tag: string; token: string }> = [];
  for (const m of docblock.matchAll(/@(param|return|var)\s+/g)) {
    const tag = m[1] ?? "";
    const start = (m.index ?? 0) + m[0].length;
    if (docblock[start] === "{") {
      const end = docblock.indexOf("}", start);
      if (end > start + 1) tokens.push({ tag, token: docblock.slice(start + 1, end) });
      continue;
    }
    let depth = 0;
    let end = start;
    for (; end < docblock.length; end++) {
      const ch = docblock[end] ?? "";
      if (ch === "<" || ch === "(" || ch === "{") depth++;
      else if (ch === ">" || ch === ")" || ch === "}") depth = Math.max(0, depth - 1);
      else if (depth === 0 && (ch === "$" || /\s/.test(ch))) break;
    }
    if (end > start) tokens.push({ tag, token: docblock.slice(start, end) });
  }
  return tokens;
}

/** Declaration modifiers that can sit before `$name` but are not types. */
const DECLARATION_MODIFIERS: ReadonlySet<string> = new Set([
  "public",
  "protected",
  "private",
  "static",
  "readonly",
  "final",
  "abstract",
  "var",
  "const",
]);

/**
 * Code recall: candidate TS types for a symbol, deduplicated preserving
 * first-seen order across sources in this order: docblock hints, signature
 * declared types (+ signature default literals), observed literal usages.
 */
export function recallCandidates(symbol: PhpSymbol): RecallResult {
  const candidates: TsTypeCandidate[] = [];
  const seen = new Set<string>();

  // B6: `static` may become `this` only as the return type of an INSTANCE
  // method; everywhere else `self` / `static` are the enclosing class's name.
  const instanceMethod = symbol.kind === "method" && !/\bstatic\s+function\b/.test(symbol.signature);
  const contextFor = (position: "return" | "other"): TypeHintContext => ({
    className: symbol.className,
    thisAllowed: position === "return" && instanceMethod,
  });

  const push = (
    raw: string | null | undefined,
    origin: CandidateOrigin,
    position: "return" | "other" = "other",
  ): void => {
    if (raw === null || raw === undefined) return;
    const type = phpTypeToTsType(raw, contextFor(position));
    if (type.trim() === "" || seen.has(type)) return;
    seen.add(type);
    candidates.push({ type, origin });
  };

  // 1. docblock hints: @param {int} $x / @param int $x / @return array<int, string> / @var float
  for (const { tag, token } of docblockTypeTokens(symbol.docblock ?? "")) {
    push(token, "docblock", tag === "return" ? "return" : "other");
  }

  // 2. signature declared types: "?Type $name", "Type $name", return after "): Type".
  // An untyped `private $name;` matches the same shape with the visibility
  // keyword in the type slot — modifiers are not types.
  for (const m of symbol.signature.matchAll(/(\??[A-Za-z_][\w\\|<>[\]]*)\s+\$[A-Za-z_]\w*/g)) {
    const declared = m[1];
    if (declared !== undefined && DECLARATION_MODIFIERS.has(declared.toLowerCase())) continue;
    push(declared, "signature");
  }
  const returnType = symbol.signature.match(/\)\s*:\s*(\??[A-Za-z_][\w\\<>[\]|]*)\s*(?:\{|;|$)/);
  if (returnType) push(returnType[1], "signature", "return");

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

const VERIFICATION_CHECKS: readonly VerificationCheck[] = [
  "type_mismatch",
  "hallucinated",
  "unreasonable",
  "absence_wrong",
];

export type EscalationCheck =
  | VerificationCheck
  | "uncertain_band"
  | "recall_empty"
  | "none_selected";

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
  criteria.NONE =
    "abstain: EVERY recalled candidate is unsuitable. Do not abstain when a candidate is directly evidenced by the signature or docblock (declared return type, typed parameter such as `Money $other`, @return/@var hint) — in that case the evidenced candidate is the answer";

  const selection = await client.systemOne({
    state,
    questions: {
      type_selection: choice(
        `Which TypeScript type best describes PHP symbol ${symbol.name} (${symbol.kind})? ` +
          `For a method or function this means its RETURN type; for an accessor/getter method it is the mapped property's type; for a property or parameter it is that member's type. ` +
          `When the signature or docblock directly evidences one of the candidates, select that candidate — do NOT pick NONE. ` +
          `Pick NONE only when every candidate is unsuitable for this symbol.`,
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
  // US-005 (Stage 2b): the uncertain band [0.30, 0.70] is a REPORTING overlay —
  // band hits are derivable anywhere from checks[].p and are surfaced by the
  // spot-check script / metrics report as a separate rate from strong-fail
  // (< 0.8) escalations (AC-S).
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
  // US-005: low CHOICE CONFIDENCE (< 0.9) escalates even when a selection was
  // made — converts shaky selections into structured escalations instead of
  // silent weak answers. Calibrated from /tmp/jev-spot-check-after.json.
  const CHOICE_CONFIDENCE_FLOOR = 0.9;
  if (picked.confidence < CHOICE_CONFIDENCE_FLOOR) {
    escalations.push({
      file: symbol.file,
      symbol: symbol.name,
      check: "uncertain_band",
      p: picked.confidence,
      threshold: CHOICE_CONFIDENCE_FLOOR,
      reason: `choice confidence ${picked.confidence.toFixed(3)} below floor ${CHOICE_CONFIDENCE_FLOOR} (selection: ${selectedType})`,
    });
  }

  return {
    ...base,
    selected: selectedType,
    choice_confidence: picked.confidence,
    checks,
    escalations,
    flagged: escalations.length > 0,
  };
}
