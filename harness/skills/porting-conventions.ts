/**
 * Concrete skill: PHP → TypeScript porting conventions.
 *
 * The implementer prompt (harness/agents/implementer.ts) composes this skill
 * in by name; conventions here are the single source both the prompt and the
 * tests read. Kept deliberately small: the conventions that matter for a
 * PHP → `tsc --strict`-clean TypeScript port (the source project is whatever
 * the run's source root points at; nothing here names a specific fixture).
 *
 * Two audiences read the same rules (B8). The author (implementer, fixer)
 * receives them all, including the ones that point at inputs only an author
 * has: the prep per-symbol table, the prep artifact's seam interfaces, the
 * read-only PHP source. The reviewer receives a one-diff turn and no PHP, so
 * {@link REVIEWER_CONVENTIONS} carries only what can be checked from the diff
 * itself: the type map, strict-mode and forbidden-pattern rules, worded so that
 * "not in the table" is never a violation the reviewer cannot verify.
 */

import type { SkillModule } from "./types.js";
import { PHP_TO_TS_TYPE_MAP, SELF_TYPE_RULE } from "./php-ts-type-map.js";

// The PHP → TS type map is shared with src/typesafe/symbol-types.ts (audit
// C23): one module, one mapping. Re-exported here for the existing import path.
export { PHP_TO_TS_TYPE_MAP };

/** The type map as prompt lines (one row per entry, then the self/static rule). */
const TYPE_MAP_LINES: readonly string[] = [
  ...Object.entries(PHP_TO_TS_TYPE_MAP).map(([php, ts]) => `  - \`${php}\` → \`${ts}\``),
  `  - ${SELF_TYPE_RULE}`,
];

const SHAPE_RULES: readonly string[] = [
  "- Nullable PHP parameter/property (`?T` or `= null`) → `T | null`.",
  "- PHP associative arrays with stable keys → a dedicated `interface`; free-form maps → `Record<string, T>` with the narrowest `T`.",
  "- `array<T>`-style homogeneous lists → `T[]`.",
];

const CONSTRUCT_RULES: readonly string[] = [
  "- `__construct` → `constructor`; visibility keywords map directly (`public`/`protected`/`private`).",
  "- `foreach ($xs as $x)` → `for (const x of xs)`; `array_map`/`array_filter` → `map`/`filter`.",
  "- `??` and `?:` → `??` / ternary; `str_contains`, `str_starts_with`, `str_ends_with` → `includes`, `startsWith`, `endsWith`.",
  "- `require`/`include` → ES module `import`.",
  "- Traits → plain composition (interfaces + helper functions); do not emulate inheritance tricks.",
];

const STRICT_FORBIDDEN_RULE =
  "- No `any`, no `@ts-ignore`, no `as unknown as X` casts to silence the compiler.";

/** Every rule, for the author: the type table, then the inputs only an author has. */
export const PORTING_CONVENTIONS: SkillModule = {
  name: "porting-conventions",
  description:
    "PHP → TypeScript mapping conventions for the porting loop (scalars, arrays, nullability, OOP constructs, forbidden patterns).",
  instructions: [
    "## PHP → TypeScript porting conventions",
    "",
    "### Type annotations",
    "- Annotate every parameter, property, and return type. `tsc --strict` is the bar; implicit `any` is a defect.",
    "- Map PHP type hints via the table below; anything not in the table must come from the prep per-symbol table, never guessed:",
    ...TYPE_MAP_LINES,
    ...SHAPE_RULES,
    "",
    "### Constructs",
    ...CONSTRUCT_RULES,
    "",
    "### Forbidden in ported output",
    "- No direct DB/IO client usage (e.g. `mysqli`, `PDO`) — call through the seam interface named by the prep artifact.",
    STRICT_FORBIDDEN_RULE,
    "- Do not modify the read-only PHP source; emit only the one file the prompt asks for.",
  ].join("\n"),
};

/**
 * The subset a reviewer can apply to ONE diff with no PHP source and no prep
 * artifact: the same type table, shape and construct rules, the strict-mode
 * rule and the IO rule as it shows in the diff. The rules about the per-symbol
 * table, the seam interfaces and the read-only source are the author's.
 */
export const REVIEWER_CONVENTIONS: SkillModule = {
  name: "porting-conventions-review",
  description:
    "The porting conventions a reviewer can check from the diff alone (type table, strict mode, constructs, forbidden patterns).",
  instructions: [
    "## PHP → TypeScript porting conventions (the part you can check from the diff)",
    "",
    "### Type annotations",
    "- Every parameter, property, and return type is annotated. `tsc --strict` is the bar; implicit `any` is a defect.",
    "- PHP type hints map via the table below. A type that is NOT in the table is not a violation by itself: you cannot see the per-symbol types the author had, so flag a type only when the diff itself shows it is wrong (an `any`, an annotation the code contradicts, a cast or `!` that hides a null).",
    ...TYPE_MAP_LINES,
    ...SHAPE_RULES,
    "",
    "### Constructs",
    ...CONSTRUCT_RULES,
    "",
    "### Forbidden in ported output",
    "- No direct DB/IO client usage (e.g. `mysqli`, `PDO`) in the diff.",
    STRICT_FORBIDDEN_RULE,
  ].join("\n"),
};
