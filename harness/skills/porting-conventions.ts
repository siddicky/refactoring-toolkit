/**
 * Concrete skill: PHP → TypeScript porting conventions.
 *
 * The implementer prompt (harness/agents/implementer.ts) composes this skill
 * in by name; conventions here are the single source both the prompt and the
 * tests read. Kept deliberately small: the conventions that matter for the
 * demo port of the generated PHP fixture to a `tsc --strict`-clean TS output.
 */

import type { SkillModule } from "./types.js";

/**
 * PHP type-hint vocabulary → TS annotation. `array` maps to `unknown[]` on
 * purpose: the per-symbol table (prep artifact) is expected to narrow it;
 * staying `unknown[]` keeps implicit guesses out of `tsc --strict`.
 */
export const PHP_TO_TS_TYPE_MAP: Readonly<Record<string, string>> = {
  string: "string",
  int: "number",
  integer: "number",
  float: "number",
  double: "number",
  bool: "boolean",
  boolean: "boolean",
  array: "unknown[]",
  iterable: "Iterable<unknown>",
  callable: "(...args: unknown[]) => unknown",
  object: "Record<string, unknown>",
  mixed: "unknown",
  null: "null",
  void: "void",
  self: "this",
  static: "this",
};

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
    ...Object.entries(PHP_TO_TS_TYPE_MAP).map(([php, ts]) => `  - \`${php}\` → \`${ts}\``),
    "- Nullable PHP parameter/property (`?T` or `= null`) → `T | null`.",
    "- PHP associative arrays with stable keys → a dedicated `interface`; free-form maps → `Record<string, T>` with the narrowest `T`.",
    "- `array<T>`-style homogeneous lists → `T[]`.",
    "",
    "### Constructs",
    "- `__construct` → `constructor`; visibility keywords map directly (`public`/`protected`/`private`).",
    "- `foreach ($xs as $x)` → `for (const x of xs)`; `array_map`/`array_filter` → `map`/`filter`.",
    "- `??` and `?:` → `??` / ternary; `str_contains`, `str_starts_with`, `str_ends_with` → `includes`, `startsWith`, `endsWith`.",
    "- `require`/`include` → ES module `import`.",
    "- Traits → plain composition (interfaces + helper functions); do not emulate inheritance tricks.",
    "",
    "### Forbidden in ported output",
    "- No direct DB/IO client usage (e.g. `mysqli`, `PDO`) — call through the seam interface named by the prep artifact.",
    "- No `any`, no `@ts-ignore`, no `as unknown as X` casts to silence the compiler.",
    "- Do not modify the read-only PHP fixture or files outside your lease worktree.",
  ].join("\n"),
};
