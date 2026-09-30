/**
 * render-metrics — AC2 evidence driver (Phase 7): collects one flow's durable
 * evidence from the read-only dex surfaces and renders the metrics report.
 *
 *   bun scripts/render-metrics.ts --flow-id <id> [--kill-events|--events <jsonl>] [--all-runs] \
 *     [--legacy-flow-keyed-envelopes] \
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
  discoverChildFlowIds,
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

/** One dexcli read returning the parsed JSON payload (injectable for tests). */
export type DexRunner = (args: readonly string[]) => unknown;

const runDexcli: DexRunner = (args) => {
  const call = dexcliInvocation(args);
  const stdout = execFileSync(call.bin, call.args, {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return JSON.parse(stdout);
};

/**
 * Dispatch history of a flow's FIRST and CURRENT run (from its `flow
 * summary`). A continue-as-new flow (dex housekeeping at its event threshold)
 * accumulates envelopes across runs while `flow history` returns one run at a
 * time, so the anchor needs both runs' dispatch entries or first-run envelopes
 * fail as anchorless. `dexcli flow summary` exposes no run chain, so the
 * middle runs of a flow with three or more runs are NOT enumerable and not
 * covered. The parent and every child use this same helper.
 */
export function mergedHistory(facts: FlowFacts, run: DexRunner = runDexcli): DispatchHistory {
  // A summary without run ids falls back to dexcli's default (latest) run
  // instead of silently fetching nothing.
  const runs: Array<string | undefined> = facts.runIds.length > 0 ? facts.runIds : [undefined];
  const events = runs.flatMap((rid) => {
    const args =
      rid === undefined
        ? ["flow", "history", facts.flowId, "-all"]
        : ["flow", "history", facts.flowId, "-run-id", rid, "-all"];
    const h = run(args) as DispatchHistory;
    return h.events ?? [];
  });
  return { flowId: facts.flowId, runId: facts.runId, events };
}

/** {@link mergedHistory} for a flow known only by id (fetches its summary first). */
export function mergedHistoryOf(flowId: string, run: DexRunner = runDexcli): DispatchHistory {
  const summary = run(["flow", "summary", flowId]) as FlowSummaryWire;
  return mergedHistory(flowFactsFromSummary(flowId, summary), run);
}

async function main(argv: readonly string[]): Promise<number> {
  const argValue = (flag: string): string | undefined => argValueFrom(argv, flag);
  const flowId = argValue("--flow-id");
  if (flowId === undefined) {
    console.error("usage: render-metrics.ts --flow-id <id> [--kill-events|--events <jsonl>] [--all-runs] [--legacy-flow-keyed-envelopes] [--out-dir metrics] [--generated-at <iso>]");
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

  // Parallel topology (v1.1): every child's envelope/verdict/burn-down
  // evidence joins the report. Children come from the parent's final state AND
  // every pp-wave-children upsert in its durable history.
  const history = mergedHistory(facts);
  const childIds = discoverChildFlowIds(attrs, history.events);
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

  for (const id of childIds) {
    history.events.push(...mergedHistoryOf(id).events);
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
    // Old (pre-identityOf, cx-5e style) evidence only; strict anchoring otherwise.
    ...(argv.includes("--legacy-flow-keyed-envelopes") ? { legacyFlowKeyedEnvelopes: true } : {}),
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
  if (report.json.no_evidence) {
    console.error(
      `[render-metrics] NO EVIDENCE: flow ${flowId} has no envelope events (wrong flow id, attributes not read, or no steps yet) — the report verifies nothing`,
    );
  }
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
