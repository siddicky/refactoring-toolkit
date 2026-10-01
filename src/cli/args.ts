/**
 * Shared command-line layer for scripts/ (audit C69).
 *
 * Every script used to carry its own argument scanner (`argValue`,
 * `argValueFrom`, `parseFlagValues`, an inline `indexOf`). None of them
 * validated: a value that was another flag was swallowed, a trailing flag
 * produced `undefined` and then NaN from `parseInt`, enum-like flags
 * (`--dispatch`, `--harness`, `--flows`) silently coerced, and a usage error
 * exited 1 in one script and 2 in another. This module replaces all of them.
 *
 * A script declares ONE option table. Everything else is derived from it:
 *
 *   - parsing: node:util `parseArgs` in strict mode (unknown flags, stray
 *     positionals, a flag with no value and a flag where a value belongs all
 *     throw), with the thrown errors mapped to stable messages;
 *   - typing: `int`, `number`, `enum` and `int-list` options are validated
 *     here (`/^\d+$/`, no sign, no exponent, no NaN or Infinity), and the
 *     result type is inferred from the table (a flag, a required option or an
 *     option with a default is always present; any other option may be
 *     absent);
 *   - usage text: the synopsis and the option lines are generated from the
 *     same table, so they cannot drift from what is parsed;
 *   - exit code: a usage error is {@link CLI_EXIT}.usage (64, sysexits
 *     EX_USAGE), the number the watcher and chaos-kill tables already use.
 *
 * Rules every option follows:
 *   - the flag name is the kebab-case of the table key (`flowId` -> `--flow-id`);
 *   - `--flag value` and `--flag=value` both work; a space-separated value may
 *     not start with `-` (a forgotten value cannot swallow the next flag),
 *     write `--flag=-value` for a value that legitimately does;
 *   - a value option may be given once; a repeat is an error rather than a
 *     silent overwrite (a repeat would drop the earlier `--pids` list);
 *   - a value may not be empty or whitespace only;
 *   - `-h` / `--help` prints the generated usage and exits 0.
 */

import { parseArgs } from "node:util";

/** Exit codes every script shares for argument handling (sysexits.h). */
export const CLI_EXIT = {
  /** EX_USAGE: bad, missing or unknown argument; nothing was started. */
  usage: 64,
  /** EX_SOFTWARE: fatal internal error. */
  fatal: 70,
} as const;

// ---------------------------------------------------------------------------
// Option table
// ---------------------------------------------------------------------------

/** A boolean switch: absent is `false`, present is `true`. */
export interface FlagOption {
  readonly kind: "flag";
  readonly description: string;
}

interface ValueOptionBase {
  readonly description: string;
  /** Placeholder shown in the usage text (`<id>`); defaults depend on the kind. */
  readonly metavar?: string;
  /** The option must be given. Mutually exclusive with `default`. */
  readonly required?: true;
}

/** Free text; must not be empty or whitespace only. */
export interface StringOption extends ValueOptionBase {
  readonly kind: "string";
  readonly default?: string;
}

/** A whole number written as digits (`/^\d+$/`): no sign, fraction or exponent. */
export interface IntOption extends ValueOptionBase {
  readonly kind: "int";
  /** Inclusive lower bound; default 0. */
  readonly min?: number;
  /** Inclusive upper bound; default none. */
  readonly max?: number;
  readonly default?: number;
}

/** A finite decimal written as digits (`12` or `0.5`), strictly above `greaterThan`. */
export interface NumberOption extends ValueOptionBase {
  readonly kind: "number";
  readonly greaterThan: number;
  readonly default?: number;
}

/** One of a fixed set of strings. */
export interface EnumOption<C extends readonly string[] = readonly string[]> extends ValueOptionBase {
  readonly kind: "enum";
  readonly choices: C;
  readonly default?: C[number];
}

/** A comma-separated list of whole numbers (`123,456`); every entry is checked. */
export interface IntListOption extends ValueOptionBase {
  readonly kind: "int-list";
  /** Inclusive lower bound of each entry; default 0. */
  readonly min?: number;
}

export type OptionSpec = FlagOption | StringOption | IntOption | NumberOption | EnumOption | IntListOption;

/** Option table: camelCase key -> spec. The flag is `--` + the kebab-case key. */
export type OptionTable = { readonly [key: string]: OptionSpec };

type ValueOf<S> = S extends { kind: "flag" }
  ? boolean
  : S extends { kind: "string" }
    ? string
    : S extends { kind: "int" | "number" }
      ? number
      : S extends { kind: "int-list" }
        ? number[]
        : S extends { kind: "enum"; choices: readonly (infer V)[] }
          ? V
          : never;

type PresentKey<T extends OptionTable> = {
  [K in keyof T]: T[K] extends { kind: "flag" } | { required: true } | { default: unknown } ? K : never;
}[keyof T];

type Simplify<T> = { [K in keyof T]: T[K] } & {};

/**
 * The parsed result for a table: a flag, a required option and an option with
 * a default are always present; every other option is absent when not given.
 */
export type ParsedOptions<T extends OptionTable> = Simplify<
  { [K in PresentKey<T>]: ValueOf<T[K]> } & { [K in Exclude<keyof T, PresentKey<T>>]?: ValueOf<T[K]> }
>;

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

/** A script with one flat set of options. */
export interface CliSpec<T extends OptionTable = OptionTable> {
  /** Script name as shown after `usage:` (`chaos-kill`, `render-metrics.ts`). */
  readonly name: string;
  readonly summary: string;
  readonly options: T;
  /** Extra paragraphs appended to the usage text (exit codes, environment). */
  readonly notes?: readonly string[];
}

export interface CommandSpec<T extends OptionTable = OptionTable> {
  readonly summary: string;
  readonly options: T;
}

/** A script with subcommands (`run-demo.ts <command> ...`). */
export interface ProgramSpec<C extends { readonly [command: string]: CommandSpec } = { readonly [command: string]: CommandSpec }> {
  readonly name: string;
  readonly summary: string;
  readonly commands: C;
  readonly notes?: readonly string[];
}

const HELP_FLAGS = ["--help", "-h"] as const;

/** `flowId` -> `flow-id`. */
export function flagName(key: string): string {
  return `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/** Throws on a malformed table: a bug in the script, found at load time. */
function validateTable(owner: string, table: OptionTable): void {
  const seen = new Set<string>();
  for (const [key, spec] of Object.entries(table)) {
    const where = `${owner}: option "${key}"`;
    if (!/^[a-z][A-Za-z0-9]*$/.test(key)) throw new Error(`${where} must be a camelCase key`);
    const flag = flagName(key);
    if (flag === "--help") throw new Error(`${where} collides with the built-in --help`);
    if (seen.has(flag)) throw new Error(`${where} duplicates ${flag}`);
    seen.add(flag);
    if (spec.description.trim() === "") throw new Error(`${where} needs a description`);
    if (spec.kind === "flag") continue;
    if (spec.required === true && "default" in spec && spec.default !== undefined) {
      throw new Error(`${where} cannot be both required and have a default`);
    }
    if (spec.kind === "enum") {
      if (spec.choices.length === 0) throw new Error(`${where} has no choices`);
      if (spec.default !== undefined && !spec.choices.includes(spec.default)) {
        throw new Error(`${where} default ${JSON.stringify(spec.default)} is not one of its choices`);
      }
    }
    if (spec.kind === "int") {
      const { min = 0, max } = spec;
      if (max !== undefined && max < min) throw new Error(`${where} has max < min`);
      if (spec.default !== undefined && (spec.default < min || (max !== undefined && spec.default > max))) {
        throw new Error(`${where} default ${spec.default} is outside its range`);
      }
    }
    if (spec.kind === "number" && spec.default !== undefined && !(spec.default > spec.greaterThan)) {
      throw new Error(`${where} default ${spec.default} is not > ${spec.greaterThan}`);
    }
  }
}

/** Declares a single-command script's CLI. Infers the table's literal types. */
export function defineCli<const T extends OptionTable>(spec: CliSpec<T>): CliSpec<T> {
  validateTable(spec.name, spec.options);
  return spec;
}

/** Declares a script with subcommands. Infers each command's table. */
export function defineProgram<const C extends { readonly [command: string]: CommandSpec }>(
  spec: ProgramSpec<C>,
): ProgramSpec<C> {
  for (const [command, c] of Object.entries(spec.commands)) {
    validateTable(`${spec.name} ${command}`, c.options);
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Parse results
// ---------------------------------------------------------------------------

/**
 * Parsing did not produce options to run with. `help` is true when the caller
 * asked for `--help` (not an error: print `usage` and exit 0); otherwise
 * `error` says what was wrong and the exit code is {@link CLI_EXIT}.usage.
 */
export interface CliFailure {
  readonly ok: false;
  readonly help: boolean;
  readonly error: string;
  readonly usage: string;
}

export type CliParse<V> = { readonly ok: true; readonly options: V } | CliFailure;

export type CommandParse<C extends { readonly [command: string]: CommandSpec }> =
  | {
      [K in keyof C & string]: {
        readonly ok: true;
        readonly command: K;
        readonly options: ParsedOptions<C[K]["options"]>;
      };
    }[keyof C & string]
  | CliFailure;

/**
 * Prints a failed parse (usage on stdout for `--help`, the error plus usage on
 * stderr otherwise) and returns the exit code: 0 for help, 64 for an error.
 */
export function reportParseFailure(
  name: string,
  failure: CliFailure,
  io: { out(line: string): void; err(line: string): void } = { out: console.log, err: console.error },
): number {
  if (failure.help) {
    io.out(failure.usage);
    return 0;
  }
  io.err(`[${name.replace(/\.ts$/, "")}] ${failure.error}\n${failure.usage}`);
  return CLI_EXIT.usage;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

type RawParse = { ok: true; values: Record<string, unknown> } | { ok: false; help: boolean; error: string };

/** Turns a parseArgs TypeError into a stable one-line message (the codes are API; the text is not). */
function describeParseArgsError(err: unknown): string {
  if (!(err instanceof TypeError)) throw err;
  const code = (err as { code?: unknown }).code;
  const message = err.message;
  const option = /'(-{1,2}[^'\s]+)/.exec(message)?.[1];
  if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
    return `unknown argument: ${/Unknown option '([^']+)'/.exec(message)?.[1] ?? option ?? message}`;
  }
  if (code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL") {
    return `unexpected argument: ${/Unexpected argument '([^']*)'/.exec(message)?.[1] ?? message}`;
  }
  if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE" && option !== undefined) {
    if (/does not take an argument/.test(message)) return `${option} does not take a value`;
    if (/ambiguous/.test(message)) {
      return `${option} requires a value (the next argument starts with "-"; write ${option}=<value> if that is the value)`;
    }
    return `${option} requires a value`;
  }
  return message.split("\n")[0] ?? message;
}

function parseAgainst(table: OptionTable, argv: readonly string[]): RawParse {
  const nodeOptions: Record<string, { type: "boolean" | "string"; short?: string }> = {
    help: { type: "boolean", short: "h" },
  };
  for (const [key, spec] of Object.entries(table)) {
    nodeOptions[flagName(key).slice(2)] = { type: spec.kind === "flag" ? "boolean" : "string" };
  }

  let values: Record<string, unknown>;
  let tokens: ReadonlyArray<{ kind: string; name?: string }>;
  try {
    const parsed = parseArgs({
      args: [...argv],
      options: nodeOptions,
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    values = parsed.values;
    tokens = parsed.tokens;
  } catch (err) {
    // `tool --typo --help` should answer the help request, not the typo (but a
    // `--help` after the `--` terminator is a positional, not a request).
    const end = argv.indexOf("--");
    const options = end < 0 ? argv : argv.slice(0, end);
    if (options.some((token) => (HELP_FLAGS as readonly string[]).includes(token))) {
      return { ok: false, help: true, error: "" };
    }
    return { ok: false, help: false, error: describeParseArgsError(err) };
  }
  if (values.help === true) return { ok: false, help: true, error: "" };

  // A value option given twice would silently keep only the last value.
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== "option" || token.name === undefined || nodeOptions[token.name]?.type !== "string") continue;
    if (seen.has(token.name)) return { ok: false, help: false, error: `--${token.name} was given more than once` };
    seen.add(token.name);
  }

  const out: Record<string, unknown> = {};
  const errors: string[] = [];
  for (const [key, spec] of Object.entries(table)) {
    const flag = flagName(key);
    const raw = values[flag.slice(2)];
    if (spec.kind === "flag") {
      out[key] = raw === true;
      continue;
    }
    if (typeof raw !== "string") {
      if (spec.required === true) errors.push(`${flag} is required`);
      else if ("default" in spec && spec.default !== undefined) out[key] = spec.default;
      continue;
    }
    if (raw.trim() === "") {
      errors.push(`${flag} requires a non-empty value`);
      continue;
    }
    const coerced = coerce(flag, spec, raw);
    if (coerced.ok) out[key] = coerced.value;
    else errors.push(coerced.error);
  }
  if (errors.length > 0) return { ok: false, help: false, error: errors.join("\n") };
  return { ok: true, values: out };
}

const INT_PATTERN = /^\d+$/;
const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;

function intRange(min: number, max: number | undefined): string {
  return max === undefined ? `>= ${min}` : `between ${min} and ${max}`;
}

type Coerced = { ok: true; value: unknown } | { ok: false; error: string };

function coerce(flag: string, spec: Exclude<OptionSpec, FlagOption>, raw: string): Coerced {
  const text = raw.trim();
  const bad = (what: string): Coerced => ({ ok: false, error: `${flag} must be ${what}, got ${JSON.stringify(raw)}` });
  switch (spec.kind) {
    case "string":
      return { ok: true, value: raw };
    case "enum":
      return spec.choices.includes(raw) ? { ok: true, value: raw } : bad(`one of ${spec.choices.join(", ")}`);
    case "int": {
      const { min = 0, max } = spec;
      const n = INT_PATTERN.test(text) ? Number(text) : Number.NaN;
      return Number.isSafeInteger(n) && n >= min && (max === undefined || n <= max)
        ? { ok: true, value: n }
        : bad(`a whole number ${intRange(min, max)}`);
    }
    case "number": {
      const n = DECIMAL_PATTERN.test(text) ? Number(text) : Number.NaN;
      return Number.isFinite(n) && n > spec.greaterThan ? { ok: true, value: n } : bad(`a number > ${spec.greaterThan}`);
    }
    case "int-list": {
      const min = spec.min ?? 0;
      const numbers: number[] = [];
      const invalid: string[] = [];
      for (const part of raw.split(",")) {
        const token = part.trim();
        const n = INT_PATTERN.test(token) ? Number(token) : Number.NaN;
        if (Number.isSafeInteger(n) && n >= min) numbers.push(n);
        else invalid.push(token === "" ? "<empty>" : token);
      }
      return invalid.length === 0
        ? { ok: true, value: numbers }
        : {
            ok: false,
            error: `invalid ${flag} entr${invalid.length === 1 ? "y" : "ies"} (need whole numbers >= ${min}): ${invalid.join(", ")}`,
          };
    }
  }
}

/** Parses a single-command script's argv (without `bun run script`). */
export function parseOptions<T extends OptionTable>(spec: CliSpec<T>, argv: readonly string[]): CliParse<ParsedOptions<T>> {
  const raw = parseAgainst(spec.options, argv);
  if (raw.ok) return { ok: true, options: raw.values as ParsedOptions<T> };
  return { ok: false, help: raw.help, error: raw.error, usage: usageText(spec) };
}

/** Parses `<command> [options]` for a script with subcommands (argv without `bun run script`). */
export function parseCommand<C extends { readonly [command: string]: CommandSpec }>(
  program: ProgramSpec<C>,
  argv: readonly string[],
): CommandParse<C> {
  const fail = (error: string, usage: string, help = false): CliFailure => ({ ok: false, help, error, usage });
  const first = argv[0];
  if (first === undefined) return fail("missing command", programUsageText(program));
  if ((HELP_FLAGS as readonly string[]).includes(first)) return fail("", programUsageText(program), true);
  if (first.startsWith("-")) return fail(`expected a command before options, got ${first}`, programUsageText(program));
  if (!Object.hasOwn(program.commands, first)) {
    return fail(`unknown command: ${first}`, programUsageText(program));
  }
  const command = first as keyof C & string;
  const spec = program.commands[command] as CommandSpec;
  const raw = parseAgainst(spec.options, argv.slice(1));
  if (!raw.ok) return fail(raw.error, commandUsageText(program, command), raw.help);
  return { ok: true, command, options: raw.values } as CommandParse<C>;
}

// ---------------------------------------------------------------------------
// Usage text
// ---------------------------------------------------------------------------

const WRAP_AT = 100;

function metavarOf(spec: Exclude<OptionSpec, FlagOption>): string {
  if (spec.kind === "enum") return spec.choices.join("|");
  if (spec.metavar !== undefined) return `<${spec.metavar}>`;
  if (spec.kind === "int" || spec.kind === "number") return "<n>";
  if (spec.kind === "int-list") return "<n[,n...]>";
  return "<value>";
}

function synopsisToken(key: string, spec: OptionSpec): string {
  if (spec.kind === "flag") return `[${flagName(key)}]`;
  const body = `${flagName(key)} ${metavarOf(spec)}`;
  return spec.required === true ? body : `[${body}]`;
}

function constraintOf(spec: Exclude<OptionSpec, FlagOption>): string | undefined {
  switch (spec.kind) {
    case "int":
      return `whole number ${intRange(spec.min ?? 0, spec.max)}`;
    case "number":
      return `number > ${spec.greaterThan}`;
    case "int-list":
      return `comma-separated whole numbers >= ${spec.min ?? 0}`;
    default:
      return undefined;
  }
}

/** Greedy wrap of `head` followed by `tokens`; continuation lines are indented. */
function wrapTokens(head: string, tokens: readonly string[]): string {
  const lines: string[] = [];
  let line = head;
  for (const token of tokens) {
    if (line.length + 1 + token.length > WRAP_AT) {
      lines.push(line);
      line = `    ${token}`;
    } else {
      line = `${line} ${token}`;
    }
  }
  lines.push(line);
  return lines.join("\n");
}

function optionLines(table: OptionTable): string[] {
  const rows: Array<[string, string]> = Object.entries(table).map(([key, spec]) => {
    const left = spec.kind === "flag" ? flagName(key) : `${flagName(key)} ${metavarOf(spec)}`;
    if (spec.kind === "flag") return [left, spec.description];
    const facts = [
      constraintOf(spec),
      spec.required === true ? "required" : undefined,
      "default" in spec && spec.default !== undefined ? `default: ${spec.default}` : undefined,
    ].filter((f): f is string => f !== undefined);
    return [left, facts.length > 0 ? `${spec.description} (${facts.join("; ")})` : spec.description];
  });
  rows.push(["-h, --help", "show this help and exit"]);
  const width = Math.max(...rows.map(([left]) => left.length));
  return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
}

function renderUsage(
  name: string,
  synopsisHead: string,
  summary: string,
  table: OptionTable,
  notes: readonly string[] | undefined,
): string {
  const tokens = Object.entries(table).map(([key, spec]) => synopsisToken(key, spec));
  const head = `usage: ${name}${synopsisHead === "" ? "" : ` ${synopsisHead}`}`;
  const sections = [
    wrapTokens(head, tokens),
    summary,
    ["options:", ...optionLines(table)].join("\n"),
    ...(notes ?? []),
  ];
  return sections.join("\n\n");
}

/**
 * "exit codes: 0 ok; 3 ..." paragraph for `notes`, built from the script's own
 * exit-code table plus a meaning per entry, so the usage text lists the numbers
 * the script actually returns.
 */
export function exitCodesNote<T extends Readonly<Record<string, number>>>(
  table: T,
  meanings: { readonly [K in keyof T]: string },
): string {
  const rows = (Object.keys(table) as Array<keyof T & string>)
    .map((key) => [table[key] as number, meanings[key]] as const)
    .sort((a, b) => a[0] - b[0])
    .map(([code, meaning], i, all) => `${code} ${meaning}${i < all.length - 1 ? ";" : ""}`);
  return wrapTokens("exit codes:", rows);
}

/** Usage text of a single-command script, generated from its option table. */
export function usageText(spec: CliSpec): string {
  return renderUsage(spec.name, "", spec.summary, spec.options, spec.notes);
}

/** Usage text of one subcommand. */
export function commandUsageText(program: ProgramSpec, command: string): string {
  const spec = program.commands[command];
  if (spec === undefined) throw new Error(`${program.name}: no such command ${command}`);
  return renderUsage(program.name, command, spec.summary, spec.options, program.notes);
}

/** Top-level usage of a script with subcommands: the command list. */
export function programUsageText(program: ProgramSpec): string {
  const names = Object.keys(program.commands);
  const width = Math.max(...names.map((n) => n.length));
  const lines = names.map((n) => `  ${n.padEnd(width)}  ${(program.commands[n] as CommandSpec).summary}`);
  return [
    `usage: ${program.name} <${names.join("|")}> [options]`,
    program.summary,
    ["commands:", ...lines].join("\n"),
    `run \`${program.name} <command> --help\` for a command's options.`,
    ...(program.notes ?? []),
  ].join("\n\n");
}
