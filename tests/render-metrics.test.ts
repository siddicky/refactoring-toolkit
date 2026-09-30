/**
 * scripts/render-metrics.ts (AC2 evidence driver) — driver-level tests.
 *
 * Pure helpers are imported directly (main() is guarded by import.meta.main);
 * whole-driver behaviour runs as a subprocess against a stub dexcli, so no dex
 * server is needed.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  argValueFrom,
  dexcliInvocation,
  type DexRunner,
  mergedHistory,
  mergedHistoryOf,
} from "../scripts/render-metrics.js";
import { discoverChildFlowIds, flowFactsFromSummary } from "../src/metrics/collect.js";
import eventStreamRaw from "../src/metrics/fixtures/event-stream-run-a.json" with { type: "json" };
import historyRaw from "../src/metrics/fixtures/dex-history-run-a.json" with { type: "json" };

const tmp = mkdtempSync(join(tmpdir(), "render-metrics-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("dexcli invocation honours DEXCLI_BIN and DEX_SERVER_ADDRESS (C36)", () => {
  test("defaults: dexcli on PATH against the default dex server, JSON output", () => {
    expect(dexcliInvocation(["flow", "summary", "f1"], {})).toEqual({
      bin: "dexcli",
      args: ["flow", "summary", "f1", "-server", "127.0.0.1:8801", "-output", "json"],
    });
  });

  test("DEXCLI_BIN and DEX_SERVER_ADDRESS win (trimmed), like every other dexcli caller", () => {
    const call = dexcliInvocation(["flow", "history", "f1", "-all"], {
      DEXCLI_BIN: " /opt/dex/bin/dexcli ",
      DEX_SERVER_ADDRESS: " dex.internal:9901 ",
    });
    expect(call.bin).toBe("/opt/dex/bin/dexcli");
    expect(call.args).toEqual(["flow", "history", "f1", "-all", "-server", "dex.internal:9901", "-output", "json"]);
  });

  test("blank env values fall back to the defaults", () => {
    const call = dexcliInvocation(["flow", "state", "f1"], { DEXCLI_BIN: "  ", DEX_SERVER_ADDRESS: "" });
    expect(call.bin).toBe("dexcli");
    expect(call.args).toContain("127.0.0.1:8801");
  });
});

describe("render-metrics flag parsing (C36)", () => {
  test("returns the value, or undefined when the flag is absent", () => {
    expect(argValueFrom(["--flow-id", "f1", "--out-dir", "o"], "--flow-id")).toBe("f1");
    expect(argValueFrom(["--flow-id", "f1"], "--out-dir")).toBeUndefined();
  });

  test("a flag given where a value belongs is rejected instead of being swallowed as the value", () => {
    expect(() => argValueFrom(["--flow-id", "--out-dir", "x"], "--flow-id")).toThrow(/requires a value/);
    expect(() => argValueFrom(["--flow-id"], "--flow-id")).toThrow(/requires a value/);
  });
});

/** In-memory dexcli: answers `flow <sub> <id> [-run-id r]` from a table and records every call. */
function fakeDex(table: Record<string, unknown>): { run: DexRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: DexRunner = (args) => {
    calls.push([...args]);
    const sub = args[1];
    const id = args[2];
    const runId = args.includes("-run-id") ? args[args.indexOf("-run-id") + 1] : "latest";
    const key = sub === "history" ? `history:${id}:${runId}` : `${sub}:${id}`;
    if (!(key in table)) throw new Error(`no fixture for ${key}`);
    return table[key];
  };
  return { run, calls };
}

const ev = (eventId: string) => ({ eventId, type: "StepStarted", payload: { context: { stepType: "PpPrep" } } });

describe("mergedHistory: first + current run, one helper for parent and children (C45)", () => {
  test("fetches the first AND current run and concatenates their events in run order", () => {
    const { run, calls } = fakeDex({
      "history:f1:run-1": { events: [ev("a1"), ev("a2")] },
      "history:f1:run-2": { events: [ev("b1")] },
    });
    const facts = flowFactsFromSummary("f1", { runId: "run-2", firstRunId: "run-1" });
    const h = mergedHistory(facts, run);
    expect(h.events.map((e) => e.eventId)).toEqual(["a1", "a2", "b1"]);
    expect(h.flowId).toBe("f1");
    expect(h.runId).toBe("run-2");
    expect(calls.map((c) => c[c.indexOf("-run-id") + 1])).toEqual(["run-1", "run-2"]);
  });

  test("a single-run flow (first == current) is fetched once", () => {
    const { run, calls } = fakeDex({ "history:f1:run-1": { events: [ev("a1")] } });
    mergedHistory(flowFactsFromSummary("f1", { runId: "run-1", firstRunId: "run-1" }), run);
    expect(calls.length).toBe(1);
  });

  test("documented limit: only the first and current run of a 3-run flow are enumerable from flow summary", () => {
    const { run, calls } = fakeDex({
      "history:f1:run-1": { events: [ev("a1")] },
      "history:f1:run-3": { events: [ev("c1")] },
    });
    const h = mergedHistory(flowFactsFromSummary("f1", { runId: "run-3", firstRunId: "run-1" }), run);
    // run-2's events are not reachable (the summary exposes no run chain); the
    // driver's comment says so rather than claiming ALL runs.
    expect(h.events.map((e) => e.eventId)).toEqual(["a1", "c1"]);
    expect(calls.some((c) => c.includes("run-2"))).toBe(false);
  });

  test("a summary without run ids falls back to the default-run history instead of fetching nothing", () => {
    const { run, calls } = fakeDex({ "history:f1:latest": { events: [ev("d1")] } });
    const h = mergedHistory(flowFactsFromSummary("f1", {}), run);
    expect(h.events.map((e) => e.eventId)).toEqual(["d1"]);
    expect(calls).toEqual([["flow", "history", "f1", "-all"]]);
  });

  test("a child is fetched through the same helper: summary first, then each of its runs", () => {
    const { run, calls } = fakeDex({
      "summary:child-1": { flowId: "child-1", runId: "c-run-2", firstRunId: "c-run-1" },
      "history:child-1:c-run-1": { events: [ev("x1")] },
      "history:child-1:c-run-2": { events: [ev("x2")] },
    });
    const h = mergedHistoryOf("child-1", run);
    expect(h.events.map((e) => e.eventId)).toEqual(["x1", "x2"]);
    expect(calls.map((c) => c[1])).toEqual(["summary", "history", "history"]);
  });
});

describe("discoverChildFlowIds: every wave's children, not only the last (C45)", () => {
  const upsert = (...ids: string[]) => ({
    payload: { output: { upsertAttributes: [{ key: "pp-wave-children/children", value: { children: ids.map((flowId) => ({ flowId })) } }] } },
  });

  test("merges the final state's copy with every pp-wave-children upsert in history, de-duplicated", () => {
    const ids = discoverChildFlowIds(
      [{ key: "pp-wave-children/children", value: { children: [{ flowId: "w3-a" }] } }],
      [upsert("w1-a", "w1-b"), upsert("w2-a"), upsert("w3-a"), { payload: {} }, null],
    );
    expect(ids.sort()).toEqual(["w1-a", "w1-b", "w2-a", "w3-a"]);
  });

  test("ignores unrelated attributes and empty ids", () => {
    const ids = discoverChildFlowIds(
      [{ key: "pp-queue/x", value: { children: [{ flowId: "nope" }] } }],
      [upsert("")],
    );
    expect(ids).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Whole-driver tests: a stub dexcli (DEXCLI_BIN) answers from a JSON table.
// ---------------------------------------------------------------------------

const SCRIPT = join(import.meta.dir, "..", "scripts", "render-metrics.ts");

async function runDriver(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, DEXCLI_BIN: "/nonexistent/dexcli", ...env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("render-metrics usage errors (C36)", () => {
  test("`--flow-id --out-dir x` is a usage error (exit 2), not flow id '--out-dir'", async () => {
    const r = await runDriver(["--flow-id", "--out-dir", "x"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("--flow-id requires a value");
  });
});

describe("render-metrics kill-events flag handling (C42)", () => {
  test("an explicit --kill-events path that does not exist exits 2 before touching dex", async () => {
    const r = await runDriver(["--flow-id", "flow-x", "--kill-events", "/nonexistent/kill-events.jsonl"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("kill-events sidecar not found: /nonexistent/kill-events.jsonl");
  });

  test("--events (the chaos-kill / watcher flag name) is honoured the same way", async () => {
    const r = await runDriver(["--flow-id", "flow-x", "--events", "/nonexistent/events.jsonl"]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("kill-events sidecar not found: /nonexistent/events.jsonl");
  });
});

describe("render-metrics end to end against a stub dexcli (C36 C39 C42 C45 C38)", () => {
  const stub = join(tmp, "stub-dexcli");
  const table = join(tmp, "table.json");
  const log = join(tmp, "calls.log");
  const outDir = join(tmp, "out");
  const sidecar = join(tmp, "kill-events.jsonl");

  // Split the recorded run-a dispatch history across two runs of one flow.
  const history = historyRaw as unknown as { events: Array<{ eventTime: string }> };
  const firstRun = history.events.filter((e) => e.eventTime < "2026-09-25T10:20:00");
  const secondRun = history.events.filter((e) => e.eventTime >= "2026-09-25T10:20:00");
  const stream = eventStreamRaw as unknown as {
    envelopes: unknown[];
    verdicts: Array<{ file: string; round: number; reviewer: string }>;
    burn_down: unknown[];
  };
  const waveUpsert = {
    eventId: "h-wave",
    type: "StepExecuteCompleted",
    payload: {
      output: {
        upsertAttributes: [{ key: "pp-wave-children/children", value: { children: [{ flowId: "child-1" }] } }],
      },
    },
  };
  const attributes = [
    ...stream.envelopes.map((v, i) => ({ key: `envelope-event/${i}`, value: v })),
    ...stream.verdicts.map((v) => ({
      key: `pp-verdict/${v.file.replace(/\//g, "__")}#${v.round}#${v.reviewer}`,
      value: { metrics: v },
    })),
    ...stream.burn_down.map((v, i) => ({ key: `queue-burndown/${i}`, value: v })),
  ];

  writeFileSync(
    table,
    JSON.stringify({
      "summary:flow-e2e": {
        flowId: "flow-e2e",
        runId: "run-2",
        firstRunId: "run-1",
        flowStatus: "FLOW_STATUS_COMPLETED",
      },
      "state:flow-e2e": { attributes },
      "history:flow-e2e:run-1": { events: [...firstRun, waveUpsert] },
      "history:flow-e2e:run-2": { events: secondRun },
      "summary:child-1": { flowId: "child-1", runId: "c-run-1", firstRunId: "c-run-1" },
      "state:child-1": {
        attributes: [
          {
            key: "pp-jev-usage/usage",
            value: [{ stepId: "pp-verdict-check:src/a.php#1", tokens: 321, atUtc: "2026-09-25T10:21:00Z" }],
          },
        ],
      },
      "history:child-1:c-run-1": { events: [] },
      // A flow whose attributes carry no envelopes at all (C48).
      "summary:flow-empty": { flowId: "flow-empty", runId: "run-e", firstRunId: "run-e", flowStatus: "FLOW_STATUS_RUNNING" },
      "state:flow-empty": { attributes: [] },
      "history:flow-empty:run-e": { events: [] },
    }),
  );
  writeFileSync(
    stub,
    `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify(argv) + "\\n");
const table = JSON.parse(readFileSync(process.env.STUB_TABLE, "utf8"));
const sub = argv[1];
const id = argv[2];
const i = argv.indexOf("-run-id");
const key = sub === "history" ? "history:" + id + ":" + (i >= 0 ? argv[i + 1] : "latest") : sub + ":" + id;
if (!(key in table)) { console.error("stub: no fixture for " + key); process.exit(3); }
process.stdout.write(JSON.stringify(table[key]));
`,
  );
  chmodSync(stub, 0o755);
  writeFileSync(
    sidecar,
    [
      // Anchored to the flow's FIRST run (the kill happened before the rollover).
      JSON.stringify({ kind: "intent", run_id: "kill-1", flow_run_id: "run-1", utc: "2026-09-25T10:29:55.000Z", monotonic_ms: 10, target_pids: [77], signal: "SIGKILL", reason: "t" }),
      JSON.stringify({ kind: "completed", run_id: "kill-1", flow_run_id: "run-1", utc: "2026-09-25T10:29:55.400Z", monotonic_ms: 410, killed_pids: [77], notes: "ok", fired: true }),
      // Another run's kill in the reused sidecar: must not leak into this report.
      JSON.stringify({ kind: "intent", run_id: "kill-0", flow_run_id: "some-other-run", utc: "2026-09-24T09:00:00.000Z", monotonic_ms: 5, target_pids: [1], signal: "SIGKILL", reason: "t" }),
      "{truncated",
    ].join("\n"),
  );

  test("renders a clean report: both runs merged, children followed, kills attributed, exit 0", async () => {
    const r = await runDriver(
      ["--flow-id", "flow-e2e", "--kill-events", sidecar, "--out-dir", outDir, "--generated-at", "2026-09-30T00:00:00.000Z"],
      { DEXCLI_BIN: stub, DEX_SERVER_ADDRESS: "dex.test:1234", STUB_LOG: log, STUB_TABLE: table },
    );
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    const report = JSON.parse(readFileSync(join(outDir, "report.json"), "utf8")) as {
      provenance_ok: boolean;
      summary: { envelope_count: number };
      dispatch_anchor: { ok: boolean; failures: string[] } | null;
      kill_events: { events: Array<{ kind: string; resumed?: boolean; killed_pids?: number[] }> } | null;
      kill_event_diagnostics: {
        malformed_lines: number;
        malformed_examples: string[];
        excluded_events: number;
      } | null;
      jev_usage: { total_tokens: number } | null;
    };
    expect(report.summary.envelope_count).toBe(54);
    // Anchoring only passes when the first-run AND current-run histories are merged.
    expect(report.dispatch_anchor?.failures).toEqual([]);
    expect(report.provenance_ok).toBe(true);
    // The flow completed (from `flow summary`, not `flow state`): the fired kill resumed.
    expect(report.kill_events?.events.map((e) => e.kind)).toEqual(["kill-intent", "kill-completed"]);
    const completed = report.kill_events?.events[1];
    expect(completed?.resumed).toBe(true);
    expect(completed?.killed_pids).toEqual([77]);
    expect(report.kill_event_diagnostics).toEqual({
      malformed_lines: 1,
      malformed_examples: ["line 4: unparsable JSON"],
      excluded_events: 1,
    });
    // Child flow's Jev usage joined the report.
    expect(report.jev_usage?.total_tokens).toBe(321);
  });

  test("a flow with no envelope evidence exits non-zero with NO EVIDENCE instead of a vacuous pass (C48)", async () => {
    const emptyOut = join(tmp, "out-empty");
    const r = await runDriver(["--flow-id", "flow-empty", "--out-dir", emptyOut], {
      DEXCLI_BIN: stub,
      DEX_SERVER_ADDRESS: "dex.test:1234",
      STUB_LOG: log,
      STUB_TABLE: table,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("NO EVIDENCE");
    const report = JSON.parse(readFileSync(join(emptyOut, "report.json"), "utf8")) as {
      provenance_ok: boolean;
      no_evidence: boolean;
    };
    expect(report.no_evidence).toBe(true);
    expect(report.provenance_ok).toBe(false);
    expect(readFileSync(join(emptyOut, "report.md"), "utf8")).toContain("status: NO EVIDENCE");
  });

  test("every dexcli call goes through DEXCLI_BIN with -server from DEX_SERVER_ADDRESS; summary fetched once", () => {
    const calls = readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as string[]);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.slice(-4)).toEqual(["-server", "dex.test:1234", "-output", "json"]);
    }
    expect(calls.filter((c) => c[1] === "summary" && c[2] === "flow-e2e").length).toBe(1);
    expect(calls.filter((c) => c[1] === "state" && c[2] === "flow-e2e").length).toBe(1);
  });
});
