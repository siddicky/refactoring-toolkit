/**
 * render-metrics — AC2 evidence driver (Phase 7): collects one flow's durable
 * evidence from the read-only dex surfaces and renders the metrics report.
 *
 *   bun scripts/render-metrics.ts --flow-id <id> [--kill-events|--events <jsonl>] [--all-runs] \
 *     [--legacy-flow-keyed-envelopes] \
 *     [--out-dir metrics] [--generated-at <utc-iso>]
 *
 * Argument handling is the shared layer in src/cli/args.ts; the option table is
 * RENDER_METRICS_CLI below and `--help` prints the usage generated from it. A
 * flag with no value, a flag where a value belongs, an unknown flag and a
 * repeated flag are usage errors (exit 64). Exit codes: {@link RENDER_METRICS_EXIT}.
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
 *   "judgment (Jev)" line, never folded into the model-calling totals),
 *   `pp-kept/*` (the citation gate's own p_cited and decision per reviewer,
 *   shown beside the deterministic check on the verdict record);
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

import {
  type CliParse,
  CLI_EXIT,
  defineCli,
  exitCodesNote,
  parseOptions,
  reportParseFailure,
} from "../src/cli/args.js";
import { dexConfigFromEnv } from "../src/dex/client.js";
import {
  collectBurnDown,
  collectCitationGates,
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
  CitationGateView,
  EnvelopeEvent,
  JevUsageEntry,
  QueueBurnDownEvent,
  VerdictRecord,
  VerdictTombstone,
} from "../src/metrics/types.js";
import type { DispatchHistory, DispatchHistoryEvent } from "../src/metrics/dispatch-anchor.js";

/** `dexcli flow state` wire: attributes only (run ids / status live on `flow summary`). */
interface FlowState {
  attributes?: StateAttribute[];
}

/** Exit codes of render-metrics. Usage is the shared 64; "failed" also covers any fatal error. */
export const RENDER_METRICS_EXIT = {
  ok: 0,
  /** The report's provenance check failed, or a fatal error. */
  failed: 1,
  /** `--kill-events` / `--events` names a sidecar that does not exist. */
  sidecarMissing: 2,
  usage: CLI_EXIT.usage,
} as const;

/** The CLI's option table: parsing, validation and the usage text all come from it. */
export const RENDER_METRICS_CLI = defineCli({
  name: "render-metrics.ts",
  summary:
    "Collects one flow's durable evidence from the read-only dex surfaces and writes <out-dir>/report.md and report.json.",
  options: {
    flowId: { kind: "string", metavar: "id", required: true, description: "flow to report on" },
    killEvents: { kind: "string", metavar: "jsonl", description: "chaos kill sidecar (JSON Lines) to merge" },
    events: { kind: "string", metavar: "jsonl", description: "alias of --kill-events (the chaos-kill / watcher name)" },
    allRuns: { kind: "flag", description: "attribute every run in the sidecar to this report, not only this flow's" },
    legacyFlowKeyedEnvelopes: {
      kind: "flag",
      description: "accept pre-identityOf envelopes keyed by flow id (cx-5e style evidence)",
    },
    outDir: { kind: "string", metavar: "dir", default: "metrics", description: "output directory" },
    generatedAt: { kind: "string", metavar: "utc-iso", description: "report timestamp (default: now)" },
  },
  notes: [
    exitCodesNote(RENDER_METRICS_EXIT, {
      ok: "report written, provenance ok",
      failed: "provenance check failed, or fatal error",
      sidecarMissing: "kill-events sidecar not found",
      usage: "usage error",
    }),
  ],
});

export interface RenderMetricsOptions {
  flowId: string;
  /** `--kill-events`, else `--events`. */
  killEventsPath: string | undefined;
  allRuns: boolean;
  legacyFlowKeyedEnvelopes: boolean;
  outDir: string;
  /** Undefined means "now". */
  generatedAt: string | undefined;
}

/** Strict parse of render-metrics' argv (without the `bun run script` prefix). */
export function parseRenderMetricsArgs(argv: readonly string[]): CliParse<RenderMetricsOptions> {
  const parsed = parseOptions(RENDER_METRICS_CLI, argv);
  if (!parsed.ok) return parsed;
  const o = parsed.options;
  return {
    ok: true,
    options: {
      flowId: o.flowId,
      killEventsPath: o.killEvents ?? o.events,
      allRuns: o.allRuns,
      legacyFlowKeyedEnvelopes: o.legacyFlowKeyedEnvelopes,
      outDir: o.outDir,
      generatedAt: o.generatedAt,
    },
  };
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

/** Upper bound on the runs walked back from the current one (a malformed chain cannot loop). */
export const MAX_RUN_CHAIN = 256;

/**
 * The run a continued run took over from: its history opens with a
 * FlowStartedOrContinued event whose continued-start carries `previousRunId`
 * (dex.d.ts FlowContinuedStart; dexcli prints the oneof as `payload.continuedStart`,
 * the SDK form is `payload.startOrContinue`). A first run (initialStart), or a
 * history that does not say, gives undefined.
 */
export function previousRunIdOf(events: readonly DispatchHistoryEvent[]): string | undefined {
  for (const event of events) {
    const payload = event.payload as
      | {
          continuedStart?: { previousRunId?: unknown } | null;
          startOrContinue?: { $case?: string; value?: { previousRunId?: unknown } } | null;
        }
      | null
      | undefined;
    const direct = payload?.continuedStart?.previousRunId;
    const viaCase = payload?.startOrContinue?.$case === "continuedStart" ? payload.startOrContinue.value?.previousRunId : undefined;
    const id = direct ?? viaCase;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return undefined;
}

/**
 * Dispatch history of EVERY run of a flow, oldest first. A continue-as-new
 * flow (dex housekeeping at its event threshold) accumulates envelopes across
 * runs while `flow history` returns one run at a time, so the anchor needs
 * every run's dispatch entries or earlier envelopes fail as anchorless.
 * `flow summary` names only the first and the current run, so the middle runs
 * are found by walking back from the current one: each continued run's history
 * opens with a continued-start carrying `previousRunId`. If the chain breaks
 * before it reaches the first run (a history that does not name its
 * predecessor), the first run is still fetched, so the result is never smaller
 * than first + current. The parent and every child use this same helper.
 */
export function mergedHistory(facts: FlowFacts, run: DexRunner = runDexcli): DispatchHistory {
  const fetchRun = (rid: string | undefined): DispatchHistoryEvent[] => {
    const args =
      rid === undefined
        ? ["flow", "history", facts.flowId, "-all"]
        : ["flow", "history", facts.flowId, "-run-id", rid, "-all"];
    const h = run(args) as DispatchHistory;
    // Step execution ids are per flow and run, so the merged list must remember
    // where each event came from or two children's `PpImplement-1` collapse.
    const historySource = `${facts.flowId}@${rid ?? "latest"}`;
    return (h.events ?? []).map((event) => ({ ...event, historySource }));
  };

  // A summary without run ids falls back to dexcli's default (latest) run
  // instead of silently fetching nothing.
  const currentRunId = facts.runIds[facts.runIds.length - 1];
  const firstRunId = facts.runIds[0];
  const newest = fetchRun(currentRunId);
  let events = newest;
  const visited = new Set<string>(currentRunId === undefined ? [] : [currentRunId]);
  let previous = previousRunIdOf(newest);
  while (previous !== undefined && !visited.has(previous) && visited.size < MAX_RUN_CHAIN) {
    visited.add(previous);
    const older = fetchRun(previous);
    events = [...older, ...events];
    previous = previousRunIdOf(older);
  }
  if (firstRunId !== undefined && !visited.has(firstRunId)) {
    events = [...fetchRun(firstRunId), ...events];
  }
  return { flowId: facts.flowId, runId: facts.runId, events };
}

/** {@link mergedHistory} for a flow known only by id (fetches its summary first). */
export function mergedHistoryOf(flowId: string, run: DexRunner = runDexcli): DispatchHistory {
  const summary = run(["flow", "summary", flowId]) as FlowSummaryWire;
  return mergedHistory(flowFactsFromSummary(flowId, summary), run);
}

async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseRenderMetricsArgs(argv);
  if (!parsed.ok) return reportParseFailure("render-metrics", parsed);
  const { flowId, killEventsPath, outDir } = parsed.options;
  const generatedAt = parsed.options.generatedAt ?? new Date().toISOString();
  if (killEventsPath !== undefined && !existsSync(killEventsPath)) {
    console.error(`[render-metrics] kill-events sidecar not found: ${killEventsPath}`);
    return RENDER_METRICS_EXIT.sidecarMissing;
  }

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
  const citationGates: CitationGateView[] = [];
  for (const id of [flowId, ...childIds]) {
    const s = id === flowId ? state : (runDexcli(["flow", "state", id]) as FlowState);
    envelopes.push(...collectEnvelopes(s.attributes ?? []));
    verdicts.push(...collectVerdicts(s.attributes ?? []));
    tombstones.push(...collectTombstones(s.attributes ?? []));
    burnDown.push(...collectBurnDown(s.attributes ?? []));
    jevUsage.push(...collectJevUsage(s.attributes ?? []));
    citationGates.push(...collectCitationGates(s.attributes ?? []));
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
    allRuns: parsed.options.allRuns,
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
    citationGates,
    ...(killEvents !== null ? { killEvents } : {}),
    killEventDiagnostics: loaded.diagnostics,
    history,
    // Old (pre-identityOf, cx-5e style) evidence only; strict anchoring otherwise.
    ...(parsed.options.legacyFlowKeyedEnvelopes ? { legacyFlowKeyedEnvelopes: true } : {}),
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
  return report.json.provenance_ok ? RENDER_METRICS_EXIT.ok : RENDER_METRICS_EXIT.failed;
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error("[render-metrics] fatal:", err);
      process.exit(RENDER_METRICS_EXIT.failed);
    });
}
