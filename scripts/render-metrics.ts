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
 *   `metrics` member is the AC2 VerdictRecord — plus the US-006 tombstone
 *   variant `{reviewer, discarded, reason, attempt, tokens}`), `queue-burndown/*`,
 *   `pp-jev-usage/*` (live TypeSafe Jev spend — reported as its own
 *   "judgment (Jev)" line, never folded into the model-calling totals);
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

import {
  collectBurnDown,
  collectEnvelopes,
  collectJevUsage,
  collectTombstones,
  collectVerdicts,
  type StateAttribute,
} from "../src/metrics/collect.js";
import { renderReport } from "../src/metrics/render.js";
import type {
  EnvelopeEvent,
  JevUsageEntry,
  KillEvent,
  KillEventsFile,
  QueueBurnDownEvent,
  VerdictRecord,
  VerdictTombstone,
} from "../src/metrics/types.js";
import type { DispatchHistory } from "../src/metrics/dispatch-anchor.js";

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

  // Parallel topology (v1.1): child flows are published by the parent under
  // `pp-wave-children/children` — but that attribute is OVERWRITTEN on every wave, so
  // the final state only names the LAST wave's children (live finding cx-5e:
  // 10 children across 6 waves, 1 in final state). Walk the parent's durable
  // HISTORY for every pp-wave-children upsert, then merge the final state's
  // copy; every child's envelope/verdict/burn-down evidence joins the report.
  const childIds: Set<string> = new Set();
  for (const a of attrs) {
    if (!a.key.startsWith("pp-wave-children")) continue;
    const v = a.value as { children?: Array<{ flowId?: string }> } | null;
    for (const c of v?.children ?? []) {
      if (typeof c?.flowId === "string" && c.flowId.length > 0) childIds.add(c.flowId);
    }
  }
  interface HistoryChildrenWire {
    events?: Array<{
      payload?: {
        output?: {
          upsertAttributes?: Array<{
            key?: string;
            value?: { children?: Array<{ flowId?: string }> };
          }>;
        };
      };
    }>;
  }
  const parentHistory = runDexcli(["flow", "history", flowId, "-all"]) as HistoryChildrenWire;
  for (const event of parentHistory.events ?? []) {
    for (const up of event.payload?.output?.upsertAttributes ?? []) {
      if (up?.key === undefined || !up.key.startsWith("pp-wave-children")) continue;
      for (const c of up.value?.children ?? []) {
        if (typeof c?.flowId === "string" && c.flowId.length > 0) childIds.add(c.flowId);
      }
    }
  }
  const envelopes: EnvelopeEvent[] = [];
  const verdicts: VerdictRecord[] = [];
  const tombstones: Array<VerdictTombstone & { file: string; round: number }> = [];
  const burnDown: QueueBurnDownEvent[] = [];
  const jevUsage: JevUsageEntry[] = [];
  for (const id of [flowId, ...childIds]) {
    const s = id === flowId ? state : (runDexcli(["flow", "state", id]) as FlowState);
    envelopes.push(...collectEnvelopes(s.attributes ?? []));
    verdicts.push(...collectVerdicts(s.attributes ?? []));
    tombstones.push(...collectTombstones(s.attributes ?? []));
    burnDown.push(...collectBurnDown(s.attributes ?? []));
    jevUsage.push(...collectJevUsage(s.attributes ?? []));
  }

  const history = mergedHistory(flowId);
  for (const id of childIds) {
    const h = runDexcli(["flow", "history", id, "-all"]) as DispatchHistory;
    history.events.push(...(h.events ?? []));
  }
  const killEvents = collectKillEvents(argValue("--kill-events"), runId, flowCompleted);

  const report = renderReport({
    envelopes,
    verdicts,
    tombstones,
    burnDown,
    jevUsage,
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
    `[render-metrics] flow=${flowId} run=${runId} envelopes=${envelopes.length} verdicts=${verdicts.length} tombstones=${tombstones.length} degradedRounds=${report.json.summary.degraded_round_count} burnDown=${burnDown.length} jevTokens=${report.json.jev_usage?.total_tokens ?? 0} killEvents=${killEvents?.events.length ?? 0} provenance_ok=${report.json.provenance_ok}`,
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
