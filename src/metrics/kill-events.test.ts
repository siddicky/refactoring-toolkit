import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_KILL_EVENTS_PATH,
  isFiredKill,
  killEventDiagnosticsOf,
  loadKillEvents,
  parseKillEvents,
  withResumed,
} from "./kill-events.js";
import { renderReport } from "./render.js";
import type { KillEventsFile } from "./types.js";
import killARaw from "./fixtures/kill-events-run-a.json" with { type: "json" };

const tmp = mkdtempSync(join(tmpdir(), "kill-events-test-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const intent = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    kind: "intent",
    run_id: "kill-1",
    utc: "2026-09-26T10:00:00.000Z",
    monotonic_ms: 100,
    target_pids: [4242],
    signal: "SIGKILL",
    reason: "mid-review",
    ...extra,
  });
const completed = (extra: Record<string, unknown> = {}): string =>
  JSON.stringify({
    kind: "completed",
    run_id: "kill-1",
    utc: "2026-09-26T10:00:01.000Z",
    monotonic_ms: 1100,
    killed_pids: [4242],
    notes: "all targets exited after SIGKILL",
    ...extra,
  });

describe("DEFAULT_KILL_EVENTS_PATH (contract B)", () => {
  test("is the cwd-relative .jsonl path under the gitignored metrics/ dir", () => {
    expect(DEFAULT_KILL_EVENTS_PATH).toBe("metrics/kill-events.jsonl");
  });
});

describe("parseKillEvents: formats and vocabulary", () => {
  test("chaos-kill spelling (intent/completed, JSON lines) normalizes to kill-intent/kill-completed", () => {
    const r = parseKillEvents(`${intent()}\n${completed({ fired: true })}\n`);
    expect(r.malformed).toEqual([]);
    expect(r.events).toEqual([
      {
        kind: "kill-intent",
        run_id: "kill-1",
        utc: "2026-09-26T10:00:00.000Z",
        monotonic_ms: 100,
        target_pids: [4242],
      },
      {
        kind: "kill-completed",
        run_id: "kill-1",
        utc: "2026-09-26T10:00:01.000Z",
        monotonic_ms: 1100,
        resumed: false,
        note: "all targets exited after SIGKILL",
        killed_pids: [4242],
        fired: true,
      },
    ]);
  });

  test("the renderer's own kill-intent/kill-completed spelling is accepted line by line", () => {
    const lines = [
      intent({ kind: "kill-intent" }),
      completed({ kind: "kill-completed", notes: undefined, note: "n" }),
    ].join("\n");
    const r = parseKillEvents(lines);
    expect(r.events.map((e) => e.kind)).toEqual(["kill-intent", "kill-completed"]);
  });

  test("a whole {run_id, events} document (the recorded fixture) is accepted and round-trips", () => {
    const r = parseKillEvents(JSON.stringify(killARaw));
    expect(r.malformed).toEqual([]);
    expect(r.events).toEqual((killARaw as unknown as KillEventsFile).events);
  });

  test("blank lines are ignored; an empty file yields nothing and no diagnostics", () => {
    expect(parseKillEvents("\n\n").events).toEqual([]);
    expect(killEventDiagnosticsOf(parseKillEvents(""))).toBeNull();
  });
});

describe("parseKillEvents: malformed lines are counted and described, never dropped silently", () => {
  test("bad JSON, unknown kind, missing fields and a truncated tail line", () => {
    const text = [
      intent(),
      "{not json",
      JSON.stringify({ kind: "note", run_id: "kill-1" }),
      JSON.stringify({ kind: "intent", run_id: "kill-1", monotonic_ms: 1 }),
      completed(),
      '{"kind":"completed","run_id":"kill-1","utc":"2026',
    ].join("\n");
    const r = parseKillEvents(text);
    expect(r.events.length).toBe(2);
    expect(r.malformed).toEqual([
      { line: 2, reason: "unparsable JSON" },
      { line: 3, reason: 'unknown kind "note"' },
      { line: 4, reason: "missing utc" },
      { line: 6, reason: "unparsable JSON" },
    ]);
    const diag = killEventDiagnosticsOf(r);
    expect(diag?.malformed_lines).toBe(4);
    expect(diag?.malformed_examples).toEqual([
      "line 2: unparsable JSON",
      'line 3: unknown kind "note"',
      "line 4: missing utc",
    ]);
  });
});

describe("parseKillEvents: run filtering (append-only sidecar reused across runs)", () => {
  const text = [
    intent({ run_id: "kill-a", flow_run_id: "dex-run-A" }),
    completed({ run_id: "kill-a", flow_run_id: "dex-run-A" }),
    intent({ run_id: "kill-b", flow_run_id: "dex-run-B" }),
    completed({ run_id: "kill-b", flow_run_id: "dex-run-B" }),
    intent({ run_id: "kill-legacy" }),
  ].join("\n");

  test("only events anchored to the flow's run ids survive; the rest are counted as excluded", () => {
    const r = parseKillEvents(text, { matchIds: ["dex-run-A"] });
    expect(r.events.map((e) => e.run_id)).toEqual(["kill-a", "kill-a"]);
    expect(r.excluded).toBe(3);
    expect(killEventDiagnosticsOf(r)?.excluded_events).toBe(3);
  });

  test("the flow's first AND current run ids both match (run rollover)", () => {
    const r = parseKillEvents(text, { matchIds: ["dex-run-A", "dex-run-B"] });
    expect(r.events.length).toBe(4);
    expect(r.excluded).toBe(1);
  });

  test("run_id itself also anchors (legacy watcher wrote the flow id there)", () => {
    const r = parseKillEvents(text, { matchIds: ["kill-legacy"] });
    expect(r.events.length).toBe(1);
  });

  test("no ids given keeps everything", () => {
    expect(parseKillEvents(text).events.length).toBe(5);
    expect(parseKillEvents(text, { matchIds: [] }).excluded).toBe(0);
  });
});

describe("fired:false completions are a no-op, not a kill-and-resume", () => {
  test("explicit fired:false and an empty killed_pids both mean nothing was killed", () => {
    const r = parseKillEvents(
      [
        completed({ fired: false, killed_pids: [], notes: "no live target" }),
        completed({ killed_pids: [], utc: "2026-09-26T10:00:05.000Z" }),
        completed({ fired: true, utc: "2026-09-26T10:00:09.000Z" }),
      ].join("\n"),
    );
    expect(r.events.map(isFiredKill)).toEqual([false, false, true]);
  });

  test("a legacy completion with neither fired nor killed_pids counts as fired", () => {
    const r = parseKillEvents(completed({ killed_pids: undefined }));
    expect(isFiredKill(r.events[0]!)).toBe(true);
  });

  test("withResumed marks fired completions only; a no-op stays resumed=false", () => {
    const parsed = parseKillEvents(
      [intent(), completed({ fired: false, killed_pids: [] }), completed({ fired: true })].join("\n"),
    );
    const file: KillEventsFile = { run_id: "r", events: parsed.events };
    const out = withResumed(file, () => true);
    const resumed = out?.events.flatMap((e) => (e.kind === "kill-completed" ? [e.resumed] : []));
    expect(resumed).toEqual([false, true]);
    expect(withResumed(null, () => true)).toBeNull();
  });
});

describe("loadKillEvents (driver entry)", () => {
  test("an explicit path that does not exist is an error, not 'none recorded'", () => {
    expect(() =>
      loadKillEvents({ explicitPath: join(tmp, "missing.jsonl"), matchIds: [], runId: "r" }),
    ).toThrow(/not found/);
  });

  test("no explicit path and no default file = no sidecar (null, no error)", () => {
    const r = loadKillEvents({
      explicitPath: undefined,
      matchIds: [],
      runId: "r",
      defaultPath: join(tmp, "absent", "kill-events.jsonl"),
    });
    expect(r).toEqual({ file: null, diagnostics: null, path: null });
  });

  test("the default path is used when present, and a legacy .json name holding JSON lines works", () => {
    const legacy = join(tmp, "kill-events.json");
    writeFileSync(legacy, `${intent({ flow_run_id: "dex-run-A" })}\n${completed({ flow_run_id: "dex-run-A" })}\n`);
    const viaDefault = loadKillEvents({ explicitPath: undefined, matchIds: ["dex-run-A"], runId: "dex-run-A", defaultPath: legacy });
    expect(viaDefault.path).toBe(legacy);
    expect(viaDefault.file?.events.length).toBe(2);
    expect(viaDefault.file?.run_id).toBe("dex-run-A");
  });

  test("the run filter applies unless allRuns is set; diagnostics report the exclusions", () => {
    const path = join(tmp, "reused.jsonl");
    writeFileSync(path, `${intent({ flow_run_id: "old-run" })}\n${intent({ flow_run_id: "this-run" })}\nnot json\n`);
    const filtered = loadKillEvents({ explicitPath: path, matchIds: ["this-run"], runId: "this-run" });
    expect(filtered.file?.events.length).toBe(1);
    expect(filtered.diagnostics).toEqual({
      malformed_lines: 1,
      malformed_examples: ["line 3: unparsable JSON"],
      excluded_events: 1,
    });
    const all = loadKillEvents({ explicitPath: path, matchIds: ["this-run"], runId: "this-run", allRuns: true });
    expect(all.file?.events.length).toBe(2);
    expect(all.diagnostics?.excluded_events).toBe(0);
  });
});

describe("report rendering of kill evidence", () => {
  test("killed_pids are carried, a no-op is labelled, counts and sidecar diagnostics are shown", () => {
    const parsed = parseKillEvents(
      [
        intent(),
        completed({ fired: true }),
        intent({ utc: "2026-09-26T11:00:00.000Z" }),
        completed({ utc: "2026-09-26T11:00:01.000Z", fired: false, killed_pids: [], notes: "target already gone" }),
        "garbage",
      ].join("\n"),
    );
    const rendered = renderReport({
      envelopes: [],
      verdicts: [],
      burnDown: [],
      killEvents: { run_id: "r", events: parsed.events },
      killEventDiagnostics: killEventDiagnosticsOf(parsed),
    });
    expect(rendered.markdown).toContain("killed_pids=4242");
    expect(rendered.markdown).toContain("NO-OP (nothing was killed; not a kill-and-resume)");
    expect(rendered.markdown).toContain("- kills fired: 1; no-op completions: 1");
    expect(rendered.markdown).toContain("1 malformed line(s) NOT counted as kill events (line 5: unparsable JSON)");
    expect(rendered.json.kill_event_diagnostics?.malformed_lines).toBe(1);
  });

  test("with only diagnostics (every line malformed) the section still says so instead of staying silent", () => {
    const parsed = parseKillEvents("oops");
    const rendered = renderReport({
      envelopes: [],
      verdicts: [],
      burnDown: [],
      killEventDiagnostics: killEventDiagnosticsOf(parsed),
    });
    expect(rendered.markdown).toContain("_none recorded_");
    expect(rendered.markdown).toContain("1 malformed line(s)");
  });

  test("excluded events from another run are reported", () => {
    const rendered = renderReport({
      envelopes: [],
      verdicts: [],
      burnDown: [],
      killEventDiagnostics: { malformed_lines: 0, malformed_examples: [], excluded_events: 4 },
    });
    expect(rendered.markdown).toContain("4 event(s) excluded — anchored to a different run than this flow");
  });
});
