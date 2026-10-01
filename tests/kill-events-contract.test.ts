/**
 * INT-3 — Contract B (kill-event sidecar), writer to both readers.
 *
 *   T7 writes   scripts/chaos-kill.ts chaosKill() -> metrics/kill-events.jsonl
 *   T5 reads    src/metrics/kill-events.ts loadKillEvents -> renderReport
 *   T6 reads    src/dashboard/queries.ts readKillEventSources -> headline
 *
 * The contract: ONE default path, `fired` is true only when something was
 * really killed (a `fired:false` completion is a no-op, never a successful
 * kill-and-resume), and `flow_run_id` is the real Dex run id so a sidecar
 * reused across runs does not leak one run's kill into another's report.
 *
 * Writer runs here are REAL: one SIGKILLs a `sleep` child this test spawned,
 * one targets a dead PID, one is another flow's kill.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { DEFAULT_KILL_EVENTS_PATH as WRITER_DEFAULT, chaosKill } from "../scripts/chaos-kill.js";
import { DEFAULT_KILL_EVENT_FILES } from "../src/dashboard/config.js";
import { readKillEventSources } from "../src/dashboard/queries.js";
import { headlineKillEvents, lifecycleHeadlineView } from "../src/dashboard/state.js";
import type { FlowView } from "../src/dashboard/types.js";
import {
  DEFAULT_KILL_EVENTS_PATH as READER_DEFAULT,
  loadKillEvents,
  resumedAfterKill,
  withResumed,
} from "../src/metrics/kill-events.js";
import { renderReport } from "../src/metrics/render.js";
import { REPO_ROOT } from "./support/paths.js";

const DEAD_PID = 99_999_999;
const FLOW_ID = "demo-flow";
const RUN_A = "dex-run-A";
const RUN_OTHER = "dex-run-OTHER";

let dir: string | undefined;
afterEach(async () => {
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("INT-3: one DEFAULT_KILL_EVENTS_PATH", () => {
  test("chaos-kill re-exports the reader's constant; the dashboard scans it first", () => {
    expect(WRITER_DEFAULT).toBe(READER_DEFAULT);
    expect(DEFAULT_KILL_EVENT_FILES[0]).toBe(READER_DEFAULT);
  });

  test("chaos-kill no longer defines its own literal", () => {
    const source = readFileSync(join(REPO_ROOT, "scripts", "chaos-kill.ts"), "utf8");
    expect(source).toContain('from "../src/metrics/kill-events.js"');
    expect(source).not.toMatch(/DEFAULT_KILL_EVENTS_PATH\s*=\s*"/);
  });
});

describe("INT-3: writer -> T5 reader -> report, and -> T6 reader -> headline", () => {
  /** A sidecar at the SHARED default path with a real kill, a no-op and another flow's kill. */
  async function writeSidecar(): Promise<{ sidecar: string; killedPid: number }> {
    dir = await mkdtemp(join(tmpdir(), "contract-b-"));
    const sidecar = join(dir, WRITER_DEFAULT);
    const target = Bun.spawn(["sleep", "30"]);
    await new Promise((r) => setTimeout(r, 100));
    const real = await chaosKill({
      pids: [target.pid],
      reason: "real kill",
      runId: "kill-real",
      eventsPath: sidecar,
      flowRunId: RUN_A,
      waitMs: 5_000,
    });
    expect(real.fired).toBe(true);
    const noop = await chaosKill({
      pids: [DEAD_PID],
      reason: "dead target",
      runId: "kill-noop",
      eventsPath: sidecar,
      flowRunId: RUN_A,
      waitMs: 100,
    });
    expect(noop.fired).toBe(false);
    const other = Bun.spawn(["sleep", "30"]);
    await new Promise((r) => setTimeout(r, 100));
    const foreign = await chaosKill({
      pids: [other.pid],
      reason: "another flow",
      runId: "kill-foreign",
      eventsPath: sidecar,
      flowRunId: RUN_OTHER,
      waitMs: 5_000,
    });
    expect(foreign.fired).toBe(true);
    return { sidecar, killedPid: target.pid };
  }

  test("T5: only this run's events are kept, the no-op is flagged and not counted as a kill", async () => {
    const { sidecar, killedPid } = await writeSidecar();

    const loaded = loadKillEvents({
      explicitPath: sidecar,
      matchIds: [RUN_A, FLOW_ID],
      runId: RUN_A,
    });
    expect(loaded.diagnostics).toEqual({ malformed_lines: 0, malformed_examples: [], excluded_events: 2 });
    const events = loaded.file?.events ?? [];
    expect(events.map((e) => `${e.kind}:${e.run_id}`)).toEqual([
      "kill-intent:kill-real",
      "kill-completed:kill-real",
      "kill-intent:kill-noop",
      "kill-completed:kill-noop",
    ]);

    // The driver's post-kill step: only a FIRED completion can be "resumed".
    const resumed = withResumed(loaded.file, (c) => resumedAfterKill(c.utc, [], true));
    const completions = (resumed?.events ?? []).filter((e) => e.kind === "kill-completed");
    expect(completions.map((c) => [c.run_id, c.fired, c.resumed])).toEqual([
      ["kill-real", true, true],
      ["kill-noop", false, false],
    ]);

    const rendered = renderReport({
      envelopes: [],
      verdicts: [],
      burnDown: [],
      killEvents: resumed,
      killEventDiagnostics: loaded.diagnostics,
    });
    expect(rendered.markdown).toContain("kills fired: 1; no-op completions: 1");
    expect(rendered.markdown).toContain(`killed_pids=${killedPid}`);
    expect(rendered.markdown).toContain("NO-OP (nothing was killed; not a kill-and-resume)");
    expect(rendered.markdown).toContain("2 event(s) excluded");
  });

  test("T5 with the run filter off (--all-runs) keeps the other flow's kill too", async () => {
    const { sidecar } = await writeSidecar();
    const loaded = loadKillEvents({ explicitPath: sidecar, matchIds: [RUN_A], allRuns: true, runId: RUN_A });
    expect(loaded.file?.events.map((e) => e.run_id)).toContain("kill-foreign");
    expect(loaded.diagnostics).toBeNull();
  });

  test("T5 finds the sidecar at the shared default path with no flag", async () => {
    const { sidecar } = await writeSidecar();
    const loaded = loadKillEvents({ explicitPath: undefined, matchIds: [RUN_A], runId: RUN_A, defaultPath: sidecar });
    expect(loaded.path).toBe(sidecar);
    expect(loaded.file?.events.length).toBe(4);
  });

  test("T6: the same sidecar yields headline events for the real kill only", async () => {
    const { sidecar } = await writeSidecar();
    const { events, errors, scanned } = await readKillEventSources([sidecar]);
    expect(errors).toEqual([]);
    expect(scanned).toEqual([sidecar]);

    const flow: FlowView = {
      flowId: FLOW_ID,
      flowType: "port.Project",
      status: "running",
      startTime: "2000-01-01T00:00:00.000Z",
      closeTime: null,
      runId: RUN_A,
    };
    const headline = headlineKillEvents(events, flow);
    // no-op run dropped (fired:false voids its intent AND completion); the
    // other flow's run id does not apply to this flow.
    expect([...new Set(headline.map((e) => e.runId))]).toEqual(["kill-real"]);
    expect(headline.find((e) => e.kind === "completed")?.fired).toBe(true);
    expect(headline.every((e) => e.flowRunId === RUN_A)).toBe(true);
  });

  test("T6: a sidecar holding only a no-op never reads as killed / resumed", async () => {
    dir = await mkdtemp(join(tmpdir(), "contract-b-"));
    const sidecar = join(dir, WRITER_DEFAULT);
    await chaosKill({ pids: [DEAD_PID], reason: "dead", runId: "kill-noop", eventsPath: sidecar, flowRunId: RUN_A, waitMs: 100 });

    const { events } = await readKillEventSources([sidecar]);
    const flow: FlowView = {
      flowId: FLOW_ID,
      flowType: "port.Project",
      status: "running",
      startTime: "2000-01-01T00:00:00.000Z",
      closeTime: null,
      runId: RUN_A,
    };
    const view = lifecycleHeadlineView({
      flow,
      filesDone: 1,
      filesTotal: 3,
      killEvents: headlineKillEvents(events, flow),
      dexAvailable: true,
      feed: [],
    });
    expect(view.state).toBe("running");
    expect(view.text).not.toMatch(/kill|resumed/);
  });
});
