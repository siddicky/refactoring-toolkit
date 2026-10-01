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
 *   - a switch is on for 1/true/yes/on and off for 0/false/no/off (any case),
 *     the caller's default when blank, and anything else is an error rather
 *     than a silent default (`STATUS_STREAM_SUBSCRIBE=false` used to leave the
 *     subscriber ON, and TYPESAFE_OFFLINE=banana turned offline mode on);
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

const ON = new Set(["1", "true", "yes", "on"]);
const OFF = new Set(["0", "false", "no", "off"]);

/** A switch's value: true, false, or null when the text is neither (the caller decides what that means). */
export function parseSwitch(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (ON.has(v)) return true;
  if (OFF.has(v)) return false;
  return null;
}

/** A switch; `fallback` when unset or blank, EnvError for a value that is neither on nor off. */
export function envFlag(name: string, fallback: boolean, env: Env = process.env): boolean {
  const raw = envString(name, env);
  if (raw === undefined) return fallback;
  const value = parseSwitch(raw);
  if (value === null) {
    throw new EnvError(`${name} must be one of 1/true/yes/on or 0/false/no/off (got ${JSON.stringify(raw)})`);
  }
  return value;
}
