/**
 * Shared environment readers (audit C79 / C3).
 *
 * The code used to read its environment five ways: `process.env.X?.trim() ||
 * default`, an untrimmed `readEnvVar`, `Number.parseInt(env ?? "1", 10)` (NaN
 * and `20m` -> 20), `!== "0"`, and a typed config object. The same variable
 * could mean different things in different places (`OPENCODE_AGENT=` was the
 * agent named "" in one and unset in another). One rule here:
 *
 *   - a variable is SET when it holds something other than whitespace; a blank
 *     one is unset, whatever the reader;
 *   - a number is whole digits (`/^\d+$/`: no sign, fraction, exponent or unit
 *     suffix) inside its bounds, else {@link EnvError};
 *
 * Every reader takes the environment as an argument (default `process.env`) so
 * a test never has to mutate the process.
 */

export type Env = Readonly<Record<string, string | undefined>>;

/** A variable holds a value the toolkit cannot use. Scripts map it to a usage error. */
export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

/** The trimmed value, or undefined when the variable is unset or blank. */
export function envString(name: string, env: Env = process.env): string | undefined {
  const value = env[name]?.trim();
  return value === undefined || value === "" ? undefined : value;
}

function boundsText(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return ` between ${min} and ${max}`;
  if (min !== undefined) return ` >= ${min}`;
  if (max !== undefined) return ` <= ${max}`;
  return "";
}

/** A whole number within `min`..`max` (inclusive), undefined when unset or blank. */
export function envInt(
  name: string,
  opts: { min?: number; max?: number; env?: Env } = {},
): number | undefined {
  const raw = envString(name, opts.env ?? process.env);
  if (raw === undefined) return undefined;
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(n) || (opts.min !== undefined && n < opts.min) || (opts.max !== undefined && n > opts.max)) {
    throw new EnvError(`${name} must be a whole number${boundsText(opts.min, opts.max)} (got ${JSON.stringify(raw)})`);
  }
  return n;
}
