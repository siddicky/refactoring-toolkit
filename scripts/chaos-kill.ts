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
 *     [--events /tmp/kill-events.json] [--run-id <id>] [--wait-ms 5000]
 *
 * Sidecar format: JSON lines, one object per line, append-only:
 *   {"kind":"intent",    run_id, utc, monotonic_ms, target_pids, signal, reason}
 *   {"kind":"completed", run_id, utc, monotonic_ms, killed_pids, notes}
 */

import { appendFileSync, closeSync, fsyncSync, openSync } from "node:fs";

export interface KillEventIntent {
  kind: "intent";
  run_id: string;
  utc: string;
  monotonic_ms: number;
  target_pids: number[];
  signal: "SIGKILL";
  reason: string;
  /** Dex flow run id, when known — the sidecar self-anchors to the run. */
  flow_run_id?: string;
}

export interface KillEventCompletion {
  kind: "completed";
  run_id: string;
  utc: string;
  monotonic_ms: number;
  killed_pids: number[];
  notes: string;
  /** Dex flow run id, when known — the sidecar self-anchors to the run. */
  flow_run_id?: string;
}

export type KillEvent = KillEventIntent | KillEventCompletion;

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
export function appendKillEvent(eventsPath: string, event: KillEvent): void {
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
  /** Dex flow run id (verifier F3-analog): written into both sidecar records. */
  flowRunId?: string;
}

export async function chaosKill(options: ChaosKillOptions): Promise<{
  killed: number[];
  stillAlive: number[];
}> {
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

  // 4. COMPLETION AFTER KILL.
  appendKillEvent(eventsPath, {
    kind: "completed",
    run_id: runId,
    utc: new Date().toISOString(),
    monotonic_ms: monotonicMs(),
    killed_pids: killed,
    notes:
      stillAlive.length === 0
        ? `all targets exited after SIGKILL (reason=${reason})`
        : `WARNING: ${stillAlive.length} target(s) survived SIGKILL: ${stillAlive.join(",")}`,
    ...(flowRunId !== undefined ? { flow_run_id: flowRunId } : {}),
  });

  return { killed, stillAlive };
}

// ---------------------------------------------------------------------------
// CLI entrypoint
// ---------------------------------------------------------------------------

function argValue(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const pidsArg = argValue(argv, "--pids");
  if (pidsArg === undefined || pidsArg.trim() === "") {
    console.error("usage: chaos-kill --pids <pid[,pid...]> --reason <reason> [--events path] [--run-id id] [--wait-ms n]");
    return 2;
  }
  const pids = pidsArg
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 1);
  if (pids.length === 0) {
    console.error("no valid pids given");
    return 2;
  }
  const flowRunId = argValue(argv, "--flow-run-id");
  const options: ChaosKillOptions = {
    pids,
    reason: argValue(argv, "--reason") ?? "unspecified",
    runId: argValue(argv, "--run-id") ?? `kill-${Date.now()}`,
    eventsPath: argValue(argv, "--events") ?? "kill-events.json",
    waitMs: Number.parseInt(argValue(argv, "--wait-ms") ?? "5000", 10),
    ...(flowRunId !== undefined ? { flowRunId } : {}),
  };
  const result = await chaosKill(options);
  console.log(
    `[chaos-kill] run=${options.runId} killed=[${result.killed.join(",")}] survivors=[${result.stillAlive.join(",")}] sidecar=${options.eventsPath}`,
  );
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
