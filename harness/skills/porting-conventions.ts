/**
 * Concrete skill: PHP → TypeScript porting conventions.
 *
 * The implementer prompt (harness/agents/implementer.ts) composes this skill
 * in by name; conventions here are the single source both the prompt and the
 * tests read. Kept deliberately small: the conventions that matter for a
 * PHP → `tsc --strict`-clean TypeScript port (the source project is whatever
 * the run's source root points at; nothing here names a specific fixture).
 */

import type { SkillModule } from "./types.js";
import { PHP_TO_TS_TYPE_MAP } from "./php-ts-type-map.js";

// The PHP → TS type map is shared with src/typesafe/symbol-types.ts (audit
// C23): one module, one mapping. Re-exported here for the existing import path.
export { PHP_TO_TS_TYPE_MAP };

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
    "- Do not modify the read-only PHP source; emit only the one file the prompt asks for.",
  ].join("\n"),
};
