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
 * - `self` / `static` are NOT in this table: they have no context-free
 *   spelling. Bare `self` and `static` are not TypeScript types, and the
 *   polymorphic `this` is a compile error in a static member or a standalone
 *   function (TS2526) and rejects another instance as a parameter. They become
 *   the enclosing class's name; only an instance method that returns `static`
 *   may use `this` as its return type. {@link SELF_TYPE_RULE} states that for
 *   the prompts and src/typesafe/symbol-types.ts applies it;
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
};

/**
 * What `self` / `static` become, as one line for the prompts (the table above
 * cannot hold them: the right spelling depends on the position). The symbol
 * recall applies the same rule through its `TypeHintContext`.
 */
export const SELF_TYPE_RULE =
  "`self` / `static` → the enclosing class's own name (e.g. `Money`) in every position; the exception is an instance method that returns `static` (fluent / late static binding), whose return type may be `this`. Never use `this` in a static method, a standalone function, or as a parameter type (TS2526; it rejects other instances).";

/** Own-key lookup (a PHP class named `Constructor` must not hit Object.prototype). */
export function lookupPhpTypeHint(hint: string): string | undefined {
  const key = hint.toLowerCase();
  return Object.hasOwn(PHP_TO_TS_TYPE_MAP, key) ? PHP_TO_TS_TYPE_MAP[key] : undefined;
}
