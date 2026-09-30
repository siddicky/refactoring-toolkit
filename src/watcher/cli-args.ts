/**
 * watch-queue-verify command-line parsing and exit codes (audit C34).
 *
 * The script's old parsing had three defects: `parseInt("abc")` produced NaN
 * (`--deadline-minutes abc` made the watcher exit "timeout" immediately after
 * arming), `argValue` happily took the NEXT FLAG as a value, and the usage
 * error shared exit code 2 with "30-minute bound elapsed" while any fatal
 * throw shared exit code 1 with "flow terminal before trigger". Parsing is now
 * strict and pure (importable by tests; the script itself runs on import),
 * and the exit codes are disjoint.
 */

/** Exit codes of scripts/watch-queue-verify.ts — every outcome has its own. */
export const WATCHER_EXIT = {
  /** The kill fired (via stream or poll). */
  fired: 0,
  /** The flow reached a terminal status before the trigger (clean, no kill). */
  terminal: 1,
  /** The bound elapsed without a trigger. */
  timeout: 2,
  /** A trigger was seen but the kill was a NO-OP (no live target PIDs). */
  noop: 3,
  /** Usage error (sysexits EX_USAGE). */
  usage: 64,
  /** Fatal internal error (sysexits EX_SOFTWARE). */
  fatal: 70,
} as const;

export interface WatcherCliOptions {
  flowId: string;
  /** Sidecar `run_id` label. */
  runId: string;
  /** Kill-event sidecar path. */
  eventsPath: string;
  /** Explicit Dex run id override for the sidecar's flow_run_id. */
  flowRunId: string | undefined;
  /** Whole-watch bound, in minutes (finite, > 0; fractions allowed). */
  deadlineMinutes: number;
  /** Poll-fallback cadence, whole seconds >= 1 (the SDK takes whole seconds). */
  pollSeconds: number;
  /** Catch-up read budget, whole seconds >= 1 (0 would mean the 60 s server default). */
  catchUpSeconds: number;
}

export type ParsedWatcherArgs =
  | { ok: true; options: WatcherCliOptions }
  | { ok: false; error: string };

export const WATCHER_USAGE =
  "usage: watch-queue-verify --flow-id <id> [--run-id <label>] [--events <sidecar.jsonl>] [--flow-run-id <dexRunId>] [--deadline-minutes <n>] [--poll-seconds <n>] [--catch-up-seconds <n>]";

const KNOWN_FLAGS = [
  "--flow-id",
  "--run-id",
  "--events",
  "--flow-run-id",
  "--deadline-minutes",
  "--poll-seconds",
  "--catch-up-seconds",
] as const;

export interface WatcherArgDefaults {
  /** Default sidecar path (chaos-kill's DEFAULT_KILL_EVENTS_PATH). */
  eventsPath: string;
}

function positiveInteger(flag: string, raw: string): number | string {
  const text = raw.trim();
  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < 1) {
    return `${flag} must be a whole number >= 1, got ${JSON.stringify(raw)}`;
  }
  return value;
}

/** Strict parse of the watcher's argv (without the `bun run script` prefix). */
export function parseWatcherArgs(
  argv: readonly string[],
  defaults: WatcherArgDefaults,
): ParsedWatcherArgs {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] as string;
    if (!(KNOWN_FLAGS as readonly string[]).includes(flag)) {
      return { ok: false, error: `unknown argument: ${flag}` };
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      return { ok: false, error: `${flag} requires a value` };
    }
    values.set(flag, value);
    i++;
  }

  const flowId = values.get("--flow-id");
  if (flowId === undefined || flowId.trim() === "") {
    return { ok: false, error: "--flow-id is required" };
  }

  const deadlineRaw = values.get("--deadline-minutes") ?? "30";
  const deadlineMinutes = /^\d+(\.\d+)?$/.test(deadlineRaw.trim()) ? Number(deadlineRaw.trim()) : Number.NaN;
  if (!Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0) {
    return {
      ok: false,
      error: `--deadline-minutes must be a number > 0, got ${JSON.stringify(deadlineRaw)}`,
    };
  }

  const pollSeconds = positiveInteger("--poll-seconds", values.get("--poll-seconds") ?? "60");
  if (typeof pollSeconds === "string") return { ok: false, error: pollSeconds };
  const catchUpSeconds = positiveInteger(
    "--catch-up-seconds",
    values.get("--catch-up-seconds") ?? "1",
  );
  if (typeof catchUpSeconds === "string") return { ok: false, error: catchUpSeconds };

  return {
    ok: true,
    options: {
      flowId: flowId.trim(),
      runId: values.get("--run-id") ?? "watch-queue-verify",
      eventsPath: values.get("--events") ?? defaults.eventsPath,
      flowRunId: values.get("--flow-run-id"),
      deadlineMinutes,
      pollSeconds,
      catchUpSeconds,
    },
  };
}
