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
  dexcliInvocation,
  dexcliRunner,
  type DexRunner,
  isUtcIsoTimestamp,
  mergedHistory,
  mergedHistoryOf,
  parseRenderMetricsArgs,
  RENDER_METRICS_CLI,
  RENDER_METRICS_EXIT,
} from "../scripts/render-metrics.js";
import { CLI_EXIT, usageText } from "../src/cli/args.js";
import { discoverChildFlowIds, flowFactsFromSummary } from "../src/metrics/collect.js";
import { extractDispatchEntries } from "../src/metrics/dispatch-anchor.js";
import eventStreamRaw from "../src/metrics/fixtures/event-stream-run-a.json" with { type: "json" };
import historyRaw from "../src/metrics/fixtures/dex-history-run-a.json" with { type: "json" };
import { isolatedEnv } from "./support/env.js";
import { REPO_ROOT } from "./support/paths.js";

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

describe("dexcliRunner: every read goes through the shared exec helper with a timeout (C4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "dexcli-runner-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  function script(name: string, body: string): string {
    const path = join(dir, name);
    writeFileSync(path, `#!/bin/sh\n${body}\n`);
    chmodSync(path, 0o755);
    return path;
  }

  test("a dexcli that never answers is killed at the timeout and the error says so (it used to hang the report)", async () => {
    const hang = script("hang", "exec sleep 30");
    const started = Date.now();
    const run = dexcliRunner(300, { DEXCLI_BIN: hang });
    await expect(run(["flow", "summary", "f1"])).rejects.toThrow(/timed out after 300ms/);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  test("a failing dexcli is reported with its command and stderr, not as a bare exit", async () => {
    const fail = script("fail", 'echo "flow not found" >&2; exit 3');
    const run = dexcliRunner(5_000, { DEXCLI_BIN: fail, DEX_SERVER_ADDRESS: "dex.test:1" });
    const err = await run(["flow", "summary", "f1"]).catch((e: Error) => e);
    expect((err as Error).message).toContain("flow summary f1 -server dex.test:1 -output json");
    expect((err as Error).message).toContain("flow not found");
    expect((err as Error).message).toContain("exit 3");
  });

  test("a good answer is parsed JSON", async () => {
    const ok = script("ok", `printf '%s' '{"flowId":"f1","runId":"r1"}'`);
    expect(await dexcliRunner(5_000, { DEXCLI_BIN: ok })(["flow", "summary", "f1"])).toEqual({ flowId: "f1", runId: "r1" });
  });
});

describe("--generated-at is validated (C4)", () => {
  test("isUtcIsoTimestamp accepts what toISOString writes (with or without milliseconds) and nothing else", () => {
    for (const good of ["2026-09-30T12:00:00Z", "2026-09-30T12:00:00.5Z", "2026-09-30T12:00:00.123Z", new Date().toISOString()]) {
      expect([good, isUtcIsoTimestamp(good)]).toEqual([good, true]);
    }
    for (const bad of [
      "yesterday",
      "2026-09-30",
      "2026-09-30 12:00:00",
      "2026-09-30T12:00:00",
      "2026-09-30T12:00:00+02:00",
      "2026-13-01T00:00:00Z",
      "2026-02-30T00:00:00Z", // the calendar has no such day; Date would roll it to 03-02
      "2026-09-30T24:00:00Z",
      "2026-09-30T12:00:00.1234Z",
      "",
    ]) {
      expect([bad, isUtcIsoTimestamp(bad)]).toEqual([bad, false]);
    }
  });

  test("a malformed --generated-at is a usage error naming the flag, before dex is contacted", async () => {
    const parsed = parseRenderMetricsArgs(["--flow-id", "f", "--generated-at", "yesterday"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain('--generated-at must be a UTC ISO-8601 timestamp such as 2026-09-30T12:00:00Z, got "yesterday"');
      expect(parsed.usage).toContain("usage: render-metrics.ts");
    }
    const r = await runDriver(["--flow-id", "f", "--generated-at", "2026-02-30T00:00:00Z"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("--generated-at must be a UTC ISO-8601 timestamp");
    expect(parseRenderMetricsArgs(["--flow-id", "f", "--generated-at", "2026-09-30T00:00:00Z"]).ok).toBe(true);
  });
});

describe("render-metrics flag parsing (C36, shared layer C69)", () => {
  const parse = (...argv: string[]) => parseRenderMetricsArgs(argv);
  const failure = (...argv: string[]) => {
    const parsed = parse(...argv);
    if (parsed.ok) throw new Error("expected a failure");
    return parsed;
  };

  test("valid: defaults, both spellings of every flag, --events as the alias of --kill-events", () => {
    const minimal = parse("--flow-id", "f1");
    expect(minimal.ok && minimal.options).toEqual({
      flowId: "f1",
      killEventsPath: undefined,
      allRuns: false,
      legacyFlowKeyedEnvelopes: false,
      outDir: "metrics",
      generatedAt: undefined,
    });
    const full = parse(
      "--flow-id=f1", "--events", "e.jsonl", "--all-runs", "--legacy-flow-keyed-envelopes",
      "--out-dir=o", "--generated-at", "2026-09-30T00:00:00Z",
    );
    expect(full.ok && full.options).toEqual({
      flowId: "f1",
      killEventsPath: "e.jsonl",
      allRuns: true,
      legacyFlowKeyedEnvelopes: true,
      outDir: "o",
      generatedAt: "2026-09-30T00:00:00Z",
    });
    const both = parse("--flow-id", "f1", "--events", "b.jsonl", "--kill-events", "a.jsonl");
    expect(both.ok && both.options.killEventsPath).toBe("a.jsonl"); // --kill-events wins, as before
  });

  test("missing value: a flag at the end of the line, and --flow-id absent, are usage errors", () => {
    expect(failure("--flow-id").error).toBe("--flow-id requires a value");
    expect(failure("--flow-id", "f1", "--out-dir").error).toBe("--out-dir requires a value");
    expect(failure("--out-dir", "o").error).toBe("--flow-id is required");
  });

  test("a flag given where a value belongs is rejected instead of being swallowed as the value", () => {
    expect(failure("--flow-id", "--out-dir", "x").error).toContain("--flow-id requires a value");
    expect(failure("--flow-id", "f1", "--out-dir", "--all-runs").error).toContain("--out-dir requires a value");
    expect(parse("--flow-id=--weird").ok).toBe(true);
  });

  test("unknown flags, stray positionals, repeats and a value on a switch are rejected", () => {
    expect(failure("--flow-id", "f1", "--out", "x").error).toBe("unknown argument: --out");
    expect(failure("--flow-id", "f1", "stray").error).toBe("unexpected argument: stray");
    expect(failure("--flow-id", "a", "--flow-id", "b").error).toContain("more than once");
    expect(failure("--flow-id", "f1", "--all-runs=yes").error).toBe("--all-runs does not take a value");
  });

  test("--help is not an error and the usage lists every flag from the table", () => {
    const help = failure("--help");
    expect(help.help).toBe(true);
    expect(help.usage).toBe(usageText(RENDER_METRICS_CLI));
    for (const flag of ["--flow-id", "--kill-events", "--events", "--all-runs", "--legacy-flow-keyed-envelopes", "--out-dir", "--generated-at"]) {
      expect(help.usage).toContain(flag);
    }
    expect(help.usage).toContain("usage: render-metrics.ts --flow-id <id>");
  });

  test("exit codes: usage is the shared 64; 1 and 2 keep their old meanings", () => {
    expect(RENDER_METRICS_EXIT).toEqual({ ok: 0, failed: 1, sidecarMissing: 2, usage: CLI_EXIT.usage });
  });
});

/** In-memory dexcli: answers `flow <sub> <id> [-run-id r]` from a table and records every call. */
function fakeDex(table: Record<string, unknown>): { run: DexRunner; calls: string[][] } {
  const calls: string[][] = [];
  const run: DexRunner = async (args) => {
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
  test("fetches the first AND current run and concatenates their events in run order", async () => {
    const { run, calls } = fakeDex({
      "history:f1:run-1": { events: [ev("a1"), ev("a2")] },
      "history:f1:run-2": { events: [ev("b1")] },
    });
    const facts = flowFactsFromSummary("f1", { runId: "run-2", firstRunId: "run-1" });
    const h = await mergedHistory(facts, run);
    expect(h.events.map((e) => e.eventId)).toEqual(["a1", "a2", "b1"]);
    expect(h.flowId).toBe("f1");
    expect(h.runId).toBe("run-2");
    expect(calls.map((c) => c[c.indexOf("-run-id") + 1]).sort()).toEqual(["run-1", "run-2"]);
  });

  test("a single-run flow (first == current) is fetched once", async () => {
    const { run, calls } = fakeDex({ "history:f1:run-1": { events: [ev("a1")] } });
    await mergedHistory(flowFactsFromSummary("f1", { runId: "run-1", firstRunId: "run-1" }), run);
    expect(calls.length).toBe(1);
  });

  const continuedFrom = (previousRunId: string) => ({
    eventId: `start-from-${previousRunId}`,
    type: "FlowStartedOrContinued",
    payload: { continuedStart: { previousRunId } },
  });
  const firstStart = { eventId: "start-1", type: "FlowStartedOrContinued", payload: { initialStart: {} } };

  test("C45: the middle runs of a 3-run flow are walked back from the current run via previousRunId", async () => {
    const { run, calls } = fakeDex({
      "history:f1:run-1": { events: [firstStart, ev("a1")] },
      "history:f1:run-2": { events: [continuedFrom("run-1"), ev("b1")] },
      "history:f1:run-3": { events: [continuedFrom("run-2"), ev("c1")] },
    });
    const h = await mergedHistory(flowFactsFromSummary("f1", { runId: "run-3", firstRunId: "run-1" }), run);
    // Oldest run first, every run exactly once.
    expect(h.events.map((e) => e.eventId)).toEqual(["start-1", "a1", "start-from-run-1", "b1", "start-from-run-2", "c1"]);
    expect(h.events.map((e) => e.historySource)).toEqual([
      "f1@run-1",
      "f1@run-1",
      "f1@run-2",
      "f1@run-2",
      "f1@run-3",
      "f1@run-3",
    ]);
    expect(calls.map((c) => c[c.indexOf("-run-id") + 1]).sort()).toEqual(["run-1", "run-2", "run-3"]);
  });

  test("C45: a 5-run chain is followed all the way back, middle dispatch entries included", async () => {
    const table: Record<string, unknown> = {};
    for (let n = 1; n <= 5; n++) {
      table[`history:f1:run-${n}`] = { events: [n === 1 ? firstStart : continuedFrom(`run-${n - 1}`), ev(`e${n}`)] };
    }
    const { run } = fakeDex(table);
    const h = await mergedHistory(flowFactsFromSummary("f1", { runId: "run-5", firstRunId: "run-1" }), run);
    expect(h.events.map((e) => e.eventId).filter((id) => /^e\d$/.test(id ?? ""))).toEqual(["e1", "e2", "e3", "e4", "e5"]);
  });

  test("C45: a broken chain (the current run does not name its predecessor) still yields first + current", async () => {
    const { run, calls } = fakeDex({
      "history:f1:run-1": { events: [ev("a1")] },
      "history:f1:run-3": { events: [ev("c1")] },
    });
    const h = await mergedHistory(flowFactsFromSummary("f1", { runId: "run-3", firstRunId: "run-1" }), run);
    expect(h.events.map((e) => e.eventId)).toEqual(["a1", "c1"]);
    expect(calls.some((c) => c.includes("run-2"))).toBe(false);
  });

  test("C45: a cyclic previousRunId chain terminates", async () => {
    const { run, calls } = fakeDex({
      "history:f1:run-a": { events: [continuedFrom("run-b")] },
      "history:f1:run-b": { events: [continuedFrom("run-a")] },
    });
    await mergedHistory(flowFactsFromSummary("f1", { runId: "run-a", firstRunId: "run-a" }), run);
    expect(calls.length).toBe(2);
  });

  test("a summary without run ids falls back to the default-run history instead of fetching nothing", async () => {
    const { run, calls } = fakeDex({ "history:f1:latest": { events: [ev("d1")] } });
    const h = await mergedHistory(flowFactsFromSummary("f1", {}), run);
    expect(h.events.map((e) => e.eventId)).toEqual(["d1"]);
    expect(calls).toEqual([["flow", "history", "f1", "-all"]]);
  });

  test("a child is fetched through the same helper: summary first, then each of its runs", async () => {
    const { run, calls } = fakeDex({
      "summary:child-1": { flowId: "child-1", runId: "c-run-2", firstRunId: "c-run-1" },
      "history:child-1:c-run-1": { events: [ev("x1")] },
      "history:child-1:c-run-2": { events: [ev("x2")] },
    });
    const h = await mergedHistoryOf("child-1", run);
    expect(h.events.map((e) => e.eventId)).toEqual(["x1", "x2"]);
    expect(calls.map((c) => c[1])).toEqual(["summary", "history", "history"]);
  });

  test("B15: events are stamped with their flow and run, so two children's PpImplement-1 stay two dispatch entries", async () => {
    const dispatch = (id: string, file: string) => ({
      eventId: id,
      type: "StepExecuteCompleted",
      payload: {
        context: { stepExecutionId: "PpImplement-1", stepType: "PpImplement", finalAttempt: 1 },
        input: { stepInput: { file, round: 1 } },
      },
    });
    const { run } = fakeDex({
      "summary:child-a": { flowId: "child-a", runId: "ra", firstRunId: "ra" },
      "summary:child-b": { flowId: "child-b", runId: "rb", firstRunId: "rb" },
      "history:child-a:ra": { events: [dispatch("a", "src/a.php")] },
      "history:child-b:rb": { events: [dispatch("b", "src/b.php")] },
    });
    // The driver concatenates every child's events into the parent's list.
    const events = [...(await mergedHistoryOf("child-a", run)).events, ...(await mergedHistoryOf("child-b", run)).events];
    expect(new Set(events.map((e) => e.historySource)).size).toBe(2);
    expect(extractDispatchEntries({ events }).map((e) => e.identity)).toEqual(["src__a.php#1", "src__b.php#1"]);
  });

  test("B15: the two runs of one continued flow carry distinct sources too", async () => {
    const { run } = fakeDex({
      "history:f1:run-1": { events: [ev("a1")] },
      "history:f1:run-2": { events: [ev("b1")] },
    });
    const h = await mergedHistory(flowFactsFromSummary("f1", { runId: "run-2", firstRunId: "run-1" }), run);
    expect(h.events.map((e) => e.historySource)).toEqual(["f1@run-1", "f1@run-2"]);
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

const SCRIPT = join(REPO_ROOT, "scripts", "render-metrics.ts");

async function runDriver(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bun", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: isolatedEnv({ DEXCLI_BIN: "/nonexistent/dexcli", ...env }),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

describe("render-metrics usage errors (C36)", () => {
  test("`--flow-id --out-dir x` is a usage error (exit 64), not flow id '--out-dir'", async () => {
    const r = await runDriver(["--flow-id", "--out-dir", "x"]);
    expect(r.code).toBe(64);
    expect(r.stderr).toContain("--flow-id requires a value");
    expect(r.stderr).toContain("usage: render-metrics.ts");
  });

  test("a missing --flow-id and an unknown flag exit 64 before dex is contacted", async () => {
    const missing = await runDriver([]);
    expect(missing.code).toBe(64);
    expect(missing.stderr).toContain("--flow-id is required");
    const unknown = await runDriver(["--flow-id", "f", "--bogus"]);
    expect(unknown.code).toBe(64);
    expect(unknown.stderr).toContain("unknown argument: --bogus");
  });

  test("--help exits 0 and prints the generated usage", async () => {
    const r = await runDriver(["--help"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("usage: render-metrics.ts --flow-id <id>");
    expect(r.stdout).toContain("exit codes: 0 report written, provenance ok; 1");
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
    // The citation gate's own record for one round (C14): live Jev dropped F2 at 0.30.
    {
      key: "pp-kept/src__Auth__LdapAuth.php#1",
      value: {
        findings: [],
        dropped: [{ finding_id: "F2", reviewer: "reviewer-A", reason: "citation check failed (p_cited=0.3)", p_cited: 0.3 }],
        citationGate: [
          { reviewer: "reviewer-A", checker: "jev", fallbackReason: null, scores: [{ finding_id: "F1", p_cited: 0.97 }, { finding_id: "F2", p_cited: 0.3 }] },
        ],
      },
    },
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
    // The citation gate's own score is read from pp-kept and shown (C14).
    expect(readFileSync(join(outDir, "report.md"), "utf8")).toContain(
      "- citation gate (jev) reviewer-A: F1=0.97 kept, F2=0.30 dropped (citation)",
    );
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

  test("every dexcli call goes through DEXCLI_BIN with -server from DEX_SERVER_ADDRESS; summary fetched once", async () => {
    // Its own run and its own call log: it used to read the log the tests above
    // wrote, so it failed alone (`-t`) or under --randomize (B27).
    const ownLog = join(tmp, "calls-own.log");
    const r = await runDriver(
      ["--flow-id", "flow-e2e", "--out-dir", join(tmp, "out-own"), "--generated-at", "2026-09-30T00:00:00.000Z"],
      { DEXCLI_BIN: stub, DEX_SERVER_ADDRESS: "dex.test:1234", STUB_LOG: ownLog, STUB_TABLE: table },
    );
    expect(r.code).toBe(0);
    const calls = readFileSync(ownLog, "utf8")
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
