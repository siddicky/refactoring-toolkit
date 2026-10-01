/**
 * chaos-kill — deterministic SIGKILL harness with an ordered evidence sidecar.
 *
 * Writes a kill-INTENT record (run ID, UTC + monotonic, target PIDs) BEFORE
 * sending SIGKILL, and appends the completion record after. The recovery pass
 * accepts the intent record as the kill time, so the evidence chain cannot be
 * orphaned by a killer-side crash.
 *
 * Clock domains (plan §Kill-time provenance): cross-process ordering
 * assertions use UTC only; monotonic values are compared solely within a
 * single process (here: the killer process itself).
 *
 * Usage:
 *   bun run scripts/chaos-kill.ts --pids 123,456 --reason "hello-flow-kill" \
 *     [--events metrics/kill-events.jsonl] [--run-id <id>] \
 *     [--flow-run-id <dexRunId>] [--wait-ms 5000]
 *
 * Every --pids entry must be a PID > 1 and --wait-ms a whole number of
 * milliseconds: an unparsable value is a usage error (exit 64), never silently
 * dropped (a dropped PID would shrink the kill set without a trace). Argument
 * handling is the shared layer in src/cli/args.ts: the option table is
 * CHAOS_KILL_CLI below, `--help` prints the usage generated from it, and an
 * unknown flag, a repeated flag or a flag with no value is a usage error too.
 *
 * Exit codes ({@link CHAOS_KILL_EXIT}, the SAME numbers and meanings as
 * watch-queue-verify's, so one table covers both tools): 0 every target exited
 * after SIGKILL; 3 NO-OP (no target was alive, nothing was killed); 4 a target
 * survived SIGKILL; 64 usage error; 70 fatal internal error.
 *
 * Sidecar path: `--events`, default {@link DEFAULT_KILL_EVENTS_PATH}
 * (`metrics/kill-events.jsonl`, relative to the cwd; /metrics/ is the repo's
 * gitignored run-output directory, and the parent directory is created on
 * first write). Shared by chaos-kill and watch-queue-verify (Contract B).
 *
 * Sidecar format: JSON lines, one object per line, append-only:
 *   {"kind":"intent",    run_id, utc, monotonic_ms, target_pids, signal, reason}
 *   {"kind":"completed", run_id, utc, monotonic_ms, killed_pids, notes, fired}
 * `fired` is `killed_pids.length > 0`. A completion with fired:false is a
 * NO-OP — nothing was killed — and its notes say so; it must never be read as
 * a successful kill-and-resume.
 */

import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

import { type CliParse, defineCli, exitCodesNote, parseOptions, reportParseFailure } from "../src/cli/args.js";
import { DEFAULT_KILL_EVENTS_PATH } from "../src/metrics/kill-events.js";
import { WATCHER_EXIT } from "../src/watcher/cli-args.js";

/**
 * Default kill-event sidecar path (Contract B): JSON Lines, relative to the
 * cwd, inside the gitignored /metrics/ run-output directory. Explicit
 * `--events` flags still win. Re-exported from the READER's module
 * (src/metrics/kill-events.ts): writer and reader share ONE constant, so a
 * default can never drift between chaos-kill and render-metrics.
 */
export { DEFAULT_KILL_EVENTS_PATH };

/**
 * Exit codes of the chaos-kill CLI: a subset of watch-queue-verify's table
 * (WATCHER_EXIT) with identical numbers and meanings, never overlapping it.
 */
export const CHAOS_KILL_EXIT = {
  ok: WATCHER_EXIT.fired,
  /** No target was alive: nothing was killed. */
  noop: WATCHER_EXIT.noop,
  /** A target survived SIGKILL. */
  survivors: WATCHER_EXIT.survivor,
  usage: WATCHER_EXIT.usage,
  fatal: WATCHER_EXIT.fatal,
} as const;

export interface KillEventIntent {
  kind: "intent";
  run_id: string;
  utc: string;
  monotonic_ms: number;
  target_pids: number[];
  signal: "SIGKILL";
  reason: string;
  /** Real Dex RUN id (not the flow id), when known — the sidecar self-anchors to the run. */
  flow_run_id?: string;
}

export interface KillEventCompletion {
  kind: "completed";
  run_id: string;
  utc: string;
  monotonic_ms: number;
  killed_pids: number[];
  notes: string;
  /** True only when at least one process was actually killed (`killed_pids.length > 0`). */
  fired: boolean;
  /** Real Dex RUN id (not the flow id), when known — the sidecar self-anchors to the run. */
  flow_run_id?: string;
}

/**
 * One line of the kill sidecar as this writer emits it. (Named KillSidecarLine
 * so it no longer collides with `KillEvent` in src/metrics/types.ts, the
 * renderer's normalized shape.)
 */
export type KillSidecarLine = KillEventIntent | KillEventCompletion;

export function monotonicMs(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: the process exists but is owned by another user — alive.
    if ((err as NodeJS.ErrnoException).code === "EPERM") return true;
    return false;
  }
}

/** Appends one JSON line and fsyncs so a killer-side crash cannot reorder evidence. */
export function appendKillEvent(eventsPath: string, event: KillSidecarLine): void {
  // The default path lives in metrics/, which may not exist yet.
  mkdirSync(dirname(eventsPath), { recursive: true });
  const fd = openSync(eventsPath, "a");
  try {
    appendFileSync(fd, `${JSON.stringify(event)}\n`, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export interface ChaosKillOptions {
  pids: number[];
  reason: string;
  runId: string;
  eventsPath: string;
  waitMs: number;
  /** Real Dex RUN id (not the flow id), when known: written into both sidecar records. */
  flowRunId?: string;
}

export interface ChaosKillResult {
  killed: number[];
  stillAlive: number[];
  /** True only when at least one target was actually killed. */
  fired: boolean;
}

export async function chaosKill(options: ChaosKillOptions): Promise<ChaosKillResult> {
  const { pids, reason, runId, eventsPath, waitMs, flowRunId } = options;

  // 1. INTENT BEFORE KILL — fsynced before any signal is sent.
  appendKillEvent(eventsPath, {
    kind: "intent",
    run_id: runId,
    utc: new Date().toISOString(),
    monotonic_ms: monotonicMs(),
    target_pids: pids,
    signal: "SIGKILL",
    reason,
    ...(flowRunId !== undefined ? { flow_run_id: flowRunId } : {}),
  });

  // 2. KILL
  const killed: number[] = [];
  for (const pid of pids) {
    if (!pidAlive(pid)) continue;
    try {
      process.kill(pid, "SIGKILL");
      killed.push(pid);
    } catch {
      // already gone
    }
  }

  // 3. Wait for exit confirmation.
  const deadline = Date.now() + waitMs;
  let stillAlive = killed.filter(pidAlive);
  while (stillAlive.length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    stillAlive = killed.filter(pidAlive);
  }

  // 4. COMPLETION AFTER KILL. Nothing killed is a NO-OP and says so: the old
  // note claimed "all targets exited after SIGKILL" for an empty/dead target
  // set, and a downstream renderer then showed a successful kill-and-resume.
  const fired = killed.length > 0;
  const notes = !fired
    ? `NO-OP: nothing was killed — no live target among [${pids.join(",") || "none"}] (reason=${reason})`
    : stillAlive.length === 0
      ? `all targets exited after SIGKILL (reason=${reason})`
      : `WARNING: ${stillAlive.length} target(s) survived SIGKILL: ${stillAlive.join(",")}`;
  appendKillEvent(eventsPath, {
    kind: "completed",
    run_id: runId,
    utc: new Date().toISOString(),
    monotonic_ms: monotonicMs(),
    killed_pids: killed,
    notes,
    fired,
    ...(flowRunId !== undefined ? { flow_run_id: flowRunId } : {}),
  });

  return { killed, stillAlive, fired };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

/** The CLI's option table: parsing, validation and the usage text all come from it. */
export const CHAOS_KILL_CLI = defineCli({
  name: "chaos-kill",
  summary: "Writes a kill-intent record, SIGKILLs the target PIDs, then appends the completion record to the sidecar.",
  options: {
    pids: {
      kind: "int-list",
      min: 2,
      required: true,
      metavar: "pid[,pid...]",
      description: "PIDs to kill (0 and negatives would signal a process group, so each must be > 1)",
    },
    reason: { kind: "string", default: "unspecified", metavar: "reason", description: "reason recorded in the sidecar" },
    events: {
      kind: "string",
      default: DEFAULT_KILL_EVENTS_PATH,
      metavar: "path",
      description: "kill-event sidecar (JSON Lines)",
    },
    runId: { kind: "string", metavar: "id", description: "run_id label (default: kill-<epoch ms>)" },
    flowRunId: {
      kind: "string",
      metavar: "dexRunId",
      description: "real Dex run id recorded in both sidecar records (default: omitted)",
    },
    waitMs: { kind: "int", default: 5000, description: "milliseconds to wait for the targets to exit after SIGKILL" },
  },
  notes: [
    exitCodesNote(CHAOS_KILL_EXIT, {
      ok: "every target exited after SIGKILL",
      noop: "NO-OP: no target was alive",
      survivors: "a target survived SIGKILL",
      usage: "usage error",
      fatal: "fatal error",
    }),
  ],
});

export type ParsedChaosKillArgs = CliParse<ChaosKillOptions>;

/**
 * Strict CLI parse (audit C71, now on the shared layer): every token is
 * validated instead of filtered. A flag needs a value that is not itself a
 * flag, unknown flags are rejected (a typo like `--event` would otherwise fall
 * back to the default path), every `--pids` entry must be a whole PID > 1, and
 * `--wait-ms` must be a non-negative whole number.
 */
export function parseChaosKillArgs(argv: readonly string[]): ParsedChaosKillArgs {
  const parsed = parseOptions(CHAOS_KILL_CLI, argv);
  if (!parsed.ok) return parsed;
  const o = parsed.options;
  return {
    ok: true,
    options: {
      pids: o.pids,
      reason: o.reason,
      runId: o.runId ?? `kill-${Date.now()}`,
      eventsPath: o.events,
      waitMs: o.waitMs,
      ...(o.flowRunId !== undefined ? { flowRunId: o.flowRunId } : {}),
    },
  };
}

async function main(): Promise<number> {
  const parsed = parseChaosKillArgs(process.argv.slice(2));
  if (!parsed.ok) return reportParseFailure("chaos-kill", parsed);
  const options = parsed.options;
  const result = await chaosKill(options);
  console.log(
    `[chaos-kill] run=${options.runId} fired=${result.fired} killed=[${result.killed.join(",")}] survivors=[${result.stillAlive.join(",")}] sidecar=${options.eventsPath}`,
  );
  if (!result.fired) {
    console.error("[chaos-kill] NO-OP: no target was alive — nothing was killed");
    return CHAOS_KILL_EXIT.noop;
  }
  return result.stillAlive.length === 0 ? CHAOS_KILL_EXIT.ok : CHAOS_KILL_EXIT.survivors;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error("[chaos-kill] fatal:", err);
      process.exit(CHAOS_KILL_EXIT.fatal);
    });
}
