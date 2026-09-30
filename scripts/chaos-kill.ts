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
 * milliseconds: an unparsable value is a usage error (exit 2), never silently
 * dropped (a dropped PID would shrink the kill set without a trace).
 *
 * Exit codes: 0 every target exited after SIGKILL; 1 a target survived;
 * 2 usage error; 3 NO-OP (no target was alive, nothing was killed).
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

/**
 * Default kill-event sidecar path (Contract B): JSON Lines, relative to the
 * cwd, inside the gitignored /metrics/ run-output directory. Explicit
 * `--events` flags still win.
 */
export const DEFAULT_KILL_EVENTS_PATH = "metrics/kill-events.jsonl";

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

const KNOWN_FLAGS = ["--pids", "--reason", "--events", "--run-id", "--flow-run-id", "--wait-ms"] as const;

const USAGE =
  "usage: chaos-kill --pids <pid[,pid...]> --reason <reason> [--events path] [--run-id id] [--flow-run-id dexRunId] [--wait-ms n]";

export type ParsedChaosKillArgs =
  | { ok: true; options: ChaosKillOptions }
  | { ok: false; error: string };

/**
 * Strict CLI parse (audit C71): every token is validated instead of filtered.
 * A flag needs a value that is not itself a flag, unknown flags are rejected
 * (a typo like `--event` would otherwise fall back to the default path), every
 * `--pids` entry must be a whole PID > 1 (0 and negatives would signal a whole
 * process group), and `--wait-ms` must be a non-negative whole number.
 */
export function parseChaosKillArgs(argv: readonly string[]): ParsedChaosKillArgs {
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

  const pidsArg = values.get("--pids");
  if (pidsArg === undefined || pidsArg.trim() === "") {
    return { ok: false, error: "--pids is required" };
  }
  const pids: number[] = [];
  const invalid: string[] = [];
  for (const raw of pidsArg.split(",")) {
    const token = raw.trim();
    const pid = /^\d+$/.test(token) ? Number(token) : Number.NaN;
    if (Number.isSafeInteger(pid) && pid > 1) pids.push(pid);
    else invalid.push(token === "" ? "<empty>" : token);
  }
  if (invalid.length > 0) {
    return { ok: false, error: `invalid --pids entr${invalid.length === 1 ? "y" : "ies"} (need whole PIDs > 1): ${invalid.join(", ")}` };
  }

  const waitArg = values.get("--wait-ms") ?? "5000";
  if (!/^\d+$/.test(waitArg.trim())) {
    return { ok: false, error: `invalid --wait-ms (need a non-negative whole number): ${waitArg}` };
  }

  const flowRunId = values.get("--flow-run-id");
  return {
    ok: true,
    options: {
      pids,
      reason: values.get("--reason") ?? "unspecified",
      runId: values.get("--run-id") ?? `kill-${Date.now()}`,
      eventsPath: values.get("--events") ?? DEFAULT_KILL_EVENTS_PATH,
      waitMs: Number(waitArg.trim()),
      ...(flowRunId !== undefined ? { flowRunId } : {}),
    },
  };
}

async function main(): Promise<number> {
  const parsed = parseChaosKillArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`[chaos-kill] ${parsed.error}\n${USAGE}`);
    return 2;
  }
  const options = parsed.options;
  const result = await chaosKill(options);
  console.log(
    `[chaos-kill] run=${options.runId} fired=${result.fired} killed=[${result.killed.join(",")}] survivors=[${result.stillAlive.join(",")}] sidecar=${options.eventsPath}`,
  );
  if (!result.fired) {
    console.error("[chaos-kill] NO-OP: no target was alive — nothing was killed");
    return 3;
  }
  return result.stillAlive.length === 0 ? 0 : 1;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error("[chaos-kill] fatal:", err);
      process.exit(1);
    });
}
