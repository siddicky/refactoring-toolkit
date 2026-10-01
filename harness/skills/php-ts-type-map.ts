/**
 * THE single PHP type-hint → TypeScript annotation map.
 *
 * Two consumers read it and must never disagree (audit C23):
 * - harness/skills/porting-conventions.ts renders it into the implementer and
 *   reviewer prompts ("map PHP type hints via the table below");
 * - src/typesafe/symbol-types.ts uses it for the per-symbol table's recalled
 *   candidates, which the planner and implementer also read.
 *
 * Decisions (one mapping each, valid in a `tsc --strict` annotation):
 * - `self` / `static` → `this` (the polymorphic `this` type; bare `self` and
 *   `static` are not TypeScript types);
 * - `iterable` → `Iterable<unknown>` (PHP `iterable` is array|Traversable, so
 *   `unknown[]` would be too narrow);
 * - `array` / `list` → `unknown[]` on purpose: the per-symbol table narrows
 *   them, and staying `unknown[]` keeps implicit guesses out of strict mode.
 *
 * Data only: no imports, so both layers can depend on it without a cycle.
 */
export const PHP_TO_TS_TYPE_MAP: Readonly<Record<string, string>> = {
  string: "string",
  int: "number",
  integer: "number",
  long: "number",
  float: "number",
  double: "number",
  real: "number",
  number: "number",
  numeric: "number",
  bool: "boolean",
  boolean: "boolean",
  true: "true",
  false: "false",
  scalar: "string | number | boolean",
  array: "unknown[]",
  list: "unknown[]",
  iterable: "Iterable<unknown>",
  callable: "(...args: unknown[]) => unknown",
  object: "Record<string, unknown>",
  mixed: "unknown",
  null: "null",
  void: "void",
  self: "this",
  static: "this",
};

/** Own-key lookup (a PHP class named `Constructor` must not hit Object.prototype). */
export function lookupPhpTypeHint(hint: string): string | undefined {
  const key = hint.toLowerCase();
  return Object.hasOwn(PHP_TO_TS_TYPE_MAP, key) ? PHP_TO_TS_TYPE_MAP[key] : undefined;
}
