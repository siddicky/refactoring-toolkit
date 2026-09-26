/**
 * render-metrics — AC2 evidence driver (Phase 7): collects one flow's durable
 * evidence from the read-only dex surfaces and renders the metrics report.
 *
 *   bun scripts/render-metrics.ts --flow-id <id> [--kill-events <jsonl>] \
 *     [--out-dir metrics] [--generated-at <utc-iso>]
 *
 * Inputs (all read-only, matching the proven surfaces):
 * - `dexcli flow state <flowId>` attribute store: `envelope-event/*` (the
 *   envelope stream), `pp-verdict/*` + `pp-prep-verdict/*` (ReviewTuple — the
 *   `metrics` member is the AC2 VerdictRecord), `queue-burndown/*`;
 * - `dexcli flow history <flowId>` (typed dispatch anchoring);
 * - optional chaos sidecar (JSON lines, intent/completed records) merged into
 *   the renderer's KillEventsFile shape (`resumed` is supplied by this driver
 *   from the flow's terminal status: a kill + a completed terminal state means
 *   the run resumed).
 *
 * Pure render via src/metrics/render.ts (renderReport); this script only
 * adapts wire shapes and writes metrics/report.md + metrics/report.json.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { renderReport } from "../src/metrics/render.js";
import type {
  EnvelopeEvent,
  KillEvent,
  KillEventsFile,
  QueueBurnDownEvent,
  QueueKind,
  VerdictRecord,
} from "../src/metrics/types.js";
import type { DispatchHistory } from "../src/metrics/dispatch-anchor.js";

interface StateAttribute {
  key: string;
  value: unknown;
}

interface FlowState {
  flowId?: string;
  runId?: string;
  flowStatus?: string;
  attributes?: StateAttribute[];
}

interface SidecarLine {
  kind: "intent" | "completed";
  run_id: string;
  utc: string;
  monotonic_ms: number;
  target_pids?: number[];
  killed_pids?: number[];
  notes?: string;
}

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function runDexcli(args: string[]): unknown {
  const stdout = execFileSync("dexcli", args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

interface FlowSummary {
  flowId?: string;
  runId?: string;
  firstRunId?: string;
  flowStatus?: string;
}

/**
 * Merged dispatch history across ALL runs of the flow: a continue-as-new flow
 * (dex housekeeping at its event threshold) accumulates envelopes across runs
 * while `flow history` returns one run at a time — the anchor needs every
 * run's dispatch entries or first-run envelopes fail as anchorless.
 */
function mergedHistory(flowId: string): DispatchHistory {
  // firstRunId lives on the summary surface, not on flow state.
  const summary = runDexcli(["flow", "summary", flowId]) as FlowSummary;
  const runIds = [...new Set([summary.firstRunId, summary.runId].filter(
    (r): r is string => typeof r === "string" && r.length > 0,
  ))];
  const events = runIds.flatMap((rid) => {
    const h = runDexcli(["flow", "history", flowId, "-run-id", rid, "-all"]) as DispatchHistory;
    return h.events ?? [];
  });
  return {
    flowId: summary.flowId ?? flowId,
    ...(summary.runId !== undefined ? { runId: summary.runId } : {}),
    events,
  };
}

/**
 * Burn-down total rows (flow writes `file: null`) carry the iteration total;
 * per-file rows carry the groups. The renderer SUMS per iteration, so feed
 * per-file rows plus a "(total)" row only when a 0-count iteration has no
 * per-file rows (otherwise totals would double-count).
 */
function collectBurnDown(attrs: StateAttribute[]): QueueBurnDownEvent[] {
  const perFile: QueueBurnDownEvent[] = [];
  const totals = new Map<string, QueueBurnDownEvent>();
  for (const a of attrs) {
    if (!a.key.startsWith("queue-burndown/")) continue;
    const v = a.value as Partial<QueueBurnDownEvent> & { file?: string | null };
    if (
      typeof v?.queue !== "string" ||
      typeof v.iteration !== "number" ||
      typeof v.error_count !== "number" ||
      typeof v.recorded_at !== "string"
    ) {
      continue;
    }
    const queue = v.queue as QueueKind;
    const sample: QueueBurnDownEvent = {
      queue,
      // Renderer's QueueBurnDownEvent.file is a string; "(total)" marks the
      // flow's aggregate row and is only emitted when no per-file rows exist.
      file: typeof v.file === "string" && v.file !== "" ? v.file : "(total)",
      iteration: v.iteration,
      error_count: v.error_count,
      recorded_at: v.recorded_at,
    };
    if (typeof v.file === "string" && v.file !== "") {
      perFile.push(sample);
    } else {
      totals.set(`${queue}\u0000${v.iteration}`, sample);
    }
  }
  const iterationsWithFiles = new Set(perFile.map((s) => `${s.queue}\u0000${s.iteration}`));
  const out = [...perFile];
  for (const [key, total] of totals) {
    if (!iterationsWithFiles.has(key)) out.push(total);
  }
  return out;
}

function collectVerdicts(attrs: StateAttribute[]): VerdictRecord[] {
  const out: VerdictRecord[] = [];
  for (const a of attrs) {
    if (!a.key.startsWith("pp-verdict/") && !a.key.startsWith("pp-prep-verdict/")) continue;
    const tuple = a.value as { metrics?: VerdictRecord } | null;
    const rec = tuple?.metrics;
    if (
      rec !== undefined &&
      rec !== null &&
      typeof rec.file === "string" &&
      typeof rec.reviewer === "string" &&
      Array.isArray(rec.findings)
    ) {
      out.push(rec);
    }
  }
  return out.sort((p, q) =>
    `${p.file}#${p.round}#${p.reviewer}`.localeCompare(`${q.file}#${q.round}#${q.reviewer}`),
  );
}

function collectEnvelopes(attrs: StateAttribute[]): EnvelopeEvent[] {
  const out: EnvelopeEvent[] = [];
  for (const a of attrs) {
    if (!a.key.startsWith("envelope-event/")) continue;
    const v = a.value as Partial<EnvelopeEvent> | null;
    if (
      v !== null &&
      typeof v === "object" &&
      typeof v.stepId === "string" &&
      typeof v.role === "string" &&
      typeof v.attempt === "number" &&
      typeof v.outcome === "string"
    ) {
      out.push(v as EnvelopeEvent);
    }
  }
  return out.sort((p, q) => p.started_at.localeCompare(q.started_at));
}

/** Sidecar JSONL (kind "intent"/"completed") → renderer KillEventsFile. */
function collectKillEvents(path: string | undefined, runId: string, flowCompleted: boolean): KillEventsFile | null {
  if (path === undefined || !existsSync(path)) return null;
  const events: KillEvent[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    let raw: SidecarLine;
    try {
      raw = JSON.parse(line) as SidecarLine;
    } catch {
      continue;
    }
    if (raw.kind === "intent") {
      events.push({
        kind: "kill-intent",
        run_id: raw.run_id,
        utc: raw.utc,
        monotonic_ms: raw.monotonic_ms,
        target_pids: raw.target_pids ?? [],
      });
    } else if (raw.kind === "completed") {
      events.push({
        kind: "kill-completed",
        run_id: raw.run_id,
        utc: raw.utc,
        monotonic_ms: raw.monotonic_ms,
        // "resumed" is a post-kill fact this driver supplies from the flow's
        // terminal status (kill + completed terminal path = resumed).
        resumed: flowCompleted,
        note: raw.notes ?? null,
      });
    }
  }
  return events.length > 0 ? { run_id: runId, events } : null;
}

async function main(): Promise<number> {
  const flowId = argValue("--flow-id");
  if (flowId === undefined) {
    console.error("usage: render-metrics.ts --flow-id <id> [--kill-events <jsonl>] [--out-dir metrics] [--generated-at <iso>]");
    return 2;
  }
  const outDir = argValue("--out-dir") ?? "metrics";
  const generatedAt = argValue("--generated-at") ?? new Date().toISOString();

  const state = runDexcli(["flow", "state", flowId]) as FlowState & FlowSummary;
  const runId = state.runId ?? flowId;
  const attrs = state.attributes ?? [];
  const flowCompleted = state.flowStatus === "FLOW_STATUS_COMPLETED";

  const envelopes = collectEnvelopes(attrs);
  const verdicts = collectVerdicts(attrs);
  const burnDown = collectBurnDown(attrs);
  const history = mergedHistory(flowId);
  const killEvents = collectKillEvents(argValue("--kill-events"), runId, flowCompleted);

  const report = renderReport({
    envelopes,
    verdicts,
    burnDown,
    ...(killEvents !== null ? { killEvents } : {}),
    history,
    generatedAt,
  });

  mkdirSync(outDir, { recursive: true });
  const mdPath = join(outDir, "report.md");
  const jsonPath = join(outDir, "report.json");
  writeFileSync(mdPath, report.markdown, "utf8");
  writeFileSync(jsonPath, `${JSON.stringify(report.json, null, 2)}\n`, "utf8");

  console.log(
    `[render-metrics] flow=${flowId} run=${runId} envelopes=${envelopes.length} verdicts=${verdicts.length} burnDown=${burnDown.length} killEvents=${killEvents?.events.length ?? 0} provenance_ok=${report.json.provenance_ok}`,
  );
  console.log(`[render-metrics] wrote ${mdPath} + ${jsonPath}`);
  return report.json.provenance_ok ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error("[render-metrics] fatal:", err);
    process.exit(1);
  });
