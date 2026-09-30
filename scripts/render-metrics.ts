/**
 * render-metrics — AC2 evidence driver (Phase 7): collects one flow's durable
 * evidence from the read-only dex surfaces and renders the metrics report.
 *
 *   bun scripts/render-metrics.ts --flow-id <id> [--kill-events|--events <jsonl>] [--all-runs] \
 *     [--out-dir metrics] [--generated-at <utc-iso>]
 *
 * dexcli is resolved like every other dex caller: DEXCLI_BIN (default
 * `dexcli`) and DEX_SERVER_ADDRESS (passed as `-server`).
 *
 * Inputs (all read-only, matching the proven surfaces):
 * - `dexcli flow state <flowId>` attribute store: `envelope-event/*` (the
 *   envelope stream), `pp-verdict/*` + `pp-prep-verdict/*` (ReviewTuple — the
 *   `metrics` member is the AC2 VerdictRecord — plus the US-006 tombstone
 *   variant `{reviewer, discarded, reason, attempt, tokens}`), `queue-burndown/*`,
 *   `pp-jev-usage/*` (live TypeSafe Jev spend — reported as its own
 *   "judgment (Jev)" line, never folded into the model-calling totals);
 * - `dexcli flow history <flowId>` (typed dispatch anchoring);
 * - `dexcli flow summary <flowId>` (run ids + flowStatus; fetched once);
 * - optional chaos sidecar (JSON lines, intent/completed records) merged into
 *   the renderer's KillEventsFile shape (`resumed` is supplied by this driver
 *   per kill: the flow completed, or an envelope started after the kill).
 *
 * Pure render via src/metrics/render.ts (renderReport); this script only
 * adapts wire shapes and writes metrics/report.md + metrics/report.json.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { dexConfigFromEnv } from "../src/dex/client.js";

import {
  collectBurnDown,
  collectEnvelopes,
  collectJevUsage,
  collectTombstones,
  collectVerdicts,
  type FlowFacts,
  flowFactsFromSummary,
  type FlowSummaryWire,
  type StateAttribute,
} from "../src/metrics/collect.js";
import { loadKillEvents, resumedAfterKill, withResumed } from "../src/metrics/kill-events.js";
import { renderReport } from "../src/metrics/render.js";
import type {
  EnvelopeEvent,
  JevUsageEntry,
  QueueBurnDownEvent,
  VerdictRecord,
  VerdictTombstone,
} from "../src/metrics/types.js";
import type { DispatchHistory } from "../src/metrics/dispatch-anchor.js";

/** `dexcli flow state` wire: attributes only (run ids / status live on `flow summary`). */
interface FlowState {
  attributes?: StateAttribute[];
}

class UsageError extends Error {}

/**
 * Value of `--flag <value>`; undefined when the flag is absent. A missing
 * value or one that is itself a flag (`--flow-id --out-dir x`) is a usage
 * error rather than silently swallowing the next flag as the value.
 */
export function argValueFrom(argv: readonly string[], flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${flag} requires a value`);
  }
  return value;
}

/**
 * The dexcli call every read goes through: the binary honours DEXCLI_BIN and
 * the server honours DEX_SERVER_ADDRESS (same resolution as run-demo,
 * serve-status, watch-queue-verify and the dashboard queries), so a non-default
 * dex is never silently bypassed in favour of dexcli's own 127.0.0.1:8801.
 */
export function dexcliInvocation(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): { bin: string; args: string[] } {
  return {
    bin: env.DEXCLI_BIN?.trim() || "dexcli",
    args: [...args, "-server", dexConfigFromEnv(env).serverAddress, "-output", "json"],
  };
}

function runDexcli(args: readonly string[]): unknown {
  const call = dexcliInvocation(args);
  const stdout = execFileSync(call.bin, call.args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/**
 * Dispatch history of the flow's FIRST and CURRENT run (from `flow summary`):
 * a continue-as-new flow (dex housekeeping at its event threshold) accumulates
 * envelopes across runs while `flow history` returns one run at a time — the
 * anchor needs both runs' dispatch entries or first-run envelopes fail as
 * anchorless. `dexcli flow summary` exposes no run chain, so a flow with three
 * or more runs is not fully covered (the middle runs are not enumerable).
 */
function mergedHistory(facts: FlowFacts): DispatchHistory {
  const events = facts.runIds.flatMap((rid) => {
    const h = runDexcli(["flow", "history", facts.flowId, "-run-id", rid, "-all"]) as DispatchHistory;
    return h.events ?? [];
  });
  return { flowId: facts.flowId, runId: facts.runId, events };
}

async function main(argv: readonly string[]): Promise<number> {
  const argValue = (flag: string): string | undefined => argValueFrom(argv, flag);
  const flowId = argValue("--flow-id");
  if (flowId === undefined) {
    console.error("usage: render-metrics.ts --flow-id <id> [--kill-events|--events <jsonl>] [--all-runs] [--out-dir metrics] [--generated-at <iso>]");
    return 2;
  }
  // `--events` is the flag name chaos-kill / watch-queue-verify use.
  const killEventsPath = argValue("--kill-events") ?? argValue("--events");
  if (killEventsPath !== undefined && !existsSync(killEventsPath)) {
    console.error(`[render-metrics] kill-events sidecar not found: ${killEventsPath}`);
    return 2;
  }
  const outDir = argValue("--out-dir") ?? "metrics";
  const generatedAt = argValue("--generated-at") ?? new Date().toISOString();

  // flowStatus / runId / firstRunId come from ONE `flow summary` call; the
  // `flow state` payload only carries the attribute store.
  const facts = flowFactsFromSummary(flowId, runDexcli(["flow", "summary", flowId]) as FlowSummaryWire);
  const state = runDexcli(["flow", "state", flowId]) as FlowState;
  const runId = facts.runId;
  const attrs = state.attributes ?? [];
  const flowCompleted = facts.flowCompleted;

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

  const history = mergedHistory(facts);
  for (const id of childIds) {
    const h = runDexcli(["flow", "history", id, "-all"]) as DispatchHistory;
    history.events.push(...(h.events ?? []));
  }
  // Contract B: one sidecar parser; only this flow's kills (run id, flow id)
  // are attributed to it; malformed lines are reported, not dropped.
  const runIds = [...new Set([...facts.runIds, flowId])];
  const loaded = loadKillEvents({
    explicitPath: killEventsPath,
    matchIds: runIds,
    allRuns: argv.includes("--all-runs"),
    runId,
  });
  // "resumed" is a post-kill fact this driver supplies per kill: the flow
  // completed, or an envelope started after the kill.
  const killEvents = withResumed(loaded.file, (c) => resumedAfterKill(c.utc, envelopes, flowCompleted));

  const report = renderReport({
    envelopes,
    verdicts,
    tombstones,
    burnDown,
    jevUsage,
    ...(killEvents !== null ? { killEvents } : {}),
    killEventDiagnostics: loaded.diagnostics,
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

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      if (err instanceof UsageError) {
        console.error(`[render-metrics] usage: ${err.message}`);
        process.exit(2);
      }
      console.error("[render-metrics] fatal:", err);
      process.exit(1);
    });
}
