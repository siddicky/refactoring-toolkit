/**
 * watch-queue-verify command line: its option table, exit-code table and the
 * parse adapter (audit C34, absorbed into the shared layer by C69).
 *
 * The scanner that used to live here (`parseFlagValues`) is gone: parsing,
 * validation and usage text come from src/cli/args.ts, and chaos-kill uses the
 * same layer. What stays here is what is specific to the watcher: which
 * options it takes, and the exit codes, which are disjoint (C34: the usage
 * error used to share 2 with "30-minute bound elapsed", and any fatal throw
 * shared 1 with "flow terminal before trigger"). The script itself runs on
 * import, so its table lives here where tests can import it.
 */

import { type CliParse, CLI_EXIT, defineCli, exitCodesNote, parseOptions, usageText } from "../cli/args.js";
import { DEFAULT_KILL_EVENTS_PATH } from "../metrics/kill-events.js";

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
  /** The kill fired but a target survived SIGKILL (the experiment is not valid). */
  survivor: 4,
  /** Usage error (sysexits EX_USAGE). */
  usage: CLI_EXIT.usage,
  /** Fatal internal error (sysexits EX_SOFTWARE). */
  fatal: CLI_EXIT.fatal,
} as const;

export const WATCHER_CLI = defineCli({
  name: "watch-queue-verify",
  summary:
    "Watches a port flow for the pp-queue-verify start and fires the chaos kill exactly once (stream subscription, dexcli poll as fallback).",
  options: {
    flowId: { kind: "string", metavar: "id", required: true, description: "Dex flow id to watch" },
    runId: {
      kind: "string",
      metavar: "label",
      default: "watch-queue-verify",
      description: "run_id label written to the kill sidecar",
    },
    events: {
      kind: "string",
      metavar: "sidecar.jsonl",
      default: DEFAULT_KILL_EVENTS_PATH,
      description: "kill-event sidecar path",
    },
    flowRunId: {
      kind: "string",
      metavar: "dexRunId",
      description: "Dex run id for the sidecar's flow_run_id (default: read from `dexcli flow summary`)",
    },
    deadlineMinutes: {
      kind: "number",
      greaterThan: 0,
      default: 30,
      metavar: "n",
      description: "whole-watch bound in minutes; fractions allowed",
    },
    pollSeconds: {
      kind: "int",
      min: 1,
      default: 60,
      description: "poll-fallback cadence in seconds (the SDK takes whole seconds)",
    },
    catchUpSeconds: {
      kind: "int",
      min: 1,
      default: 1,
      description: "read budget after the first event in seconds (0 would mean the 60 s server default)",
    },
  },
  notes: [
    exitCodesNote(WATCHER_EXIT, {
      fired: "kill fired",
      terminal: "flow terminal before the trigger",
      timeout: "bound elapsed without a trigger",
      noop: "trigger seen but nothing was killed",
      survivor: "a target survived SIGKILL",
      usage: "usage error",
      fatal: "fatal error",
    }),
  ],
});

/** The generated usage text (synopsis, option lines, exit codes). */
export const WATCHER_USAGE = usageText(WATCHER_CLI);

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

export type ParsedWatcherArgs = CliParse<WatcherCliOptions>;

/** Strict parse of the watcher's argv (without the `bun run script` prefix). */
export function parseWatcherArgs(argv: readonly string[]): ParsedWatcherArgs {
  const parsed = parseOptions(WATCHER_CLI, argv);
  if (!parsed.ok) return parsed;
  const o = parsed.options;
  return {
    ok: true,
    options: {
      flowId: o.flowId.trim(),
      runId: o.runId,
      eventsPath: o.events,
      flowRunId: o.flowRunId,
      deadlineMinutes: o.deadlineMinutes,
      pollSeconds: o.pollSeconds,
      catchUpSeconds: o.catchUpSeconds,
    },
  };
}
