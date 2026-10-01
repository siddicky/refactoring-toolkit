/**
 * INT-2 — Contract A (tsc accounting), end to end across three teams.
 *
 *   T1 writes   flows/port-project.ts QueueVerifyStep -> `queue-burndown/tsc-<n>`
 *               (file null) with `tsc: {state, reason, exit_code, unlocated}`
 *   T5 renders  src/metrics/collect.ts collectBurnDown -> renderReport
 *   T6 shows    src/dashboard/state.ts feedFromState -> burnDownSeries
 *
 * Each module has tests for its own half, written against hand-built rows.
 * Nothing proved that the row T1 REALLY writes is the row T5 and T6 READ, so
 * a rename on either side would pass every per-module suite. This executes the
 * real QueueVerifyStep over a fake `tsc`, takes the attribute row it produced
 * and pushes that exact value through both consumers.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { ppBurndown, type QueueBurnDownSample } from "../flows/port-project.js";
import { burnDownSeries, feedFromState } from "../src/dashboard/state.js";
import type { TscAccountingSample } from "../src/dashboard/types.js";
import { collectBurnDown, type StateAttribute } from "../src/metrics/collect.js";
import { renderReport } from "../src/metrics/render.js";
import type { QueueBurnDownEvent, TscRunAccounting as ReportTscAccounting } from "../src/metrics/types.js";
import type { TscRunAccounting as WriterTscAccounting } from "../src/queues/tsc-queue.js";
import type { AttributeStores } from "./support/dex-context.js";
import { cleanupQueueVerifyRun, runQueueVerifyOverFakeTools } from "./support/queue-verify-run.js";

// ---------------------------------------------------------------------------
// Compile-time: the three declarations of the accounting are one shape. A
// field added, renamed or retyped on one side stops this file from compiling
// (typecheck is part of the gate), long before a report goes wrong.
// ---------------------------------------------------------------------------

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const writerEqualsReport: Mutual<WriterTscAccounting, ReportTscAccounting> = true;
const reportEqualsDashboard: Mutual<ReportTscAccounting, TscAccountingSample> = true;
// The flow's own sample type must be accepted by the renderer's event type.
const flowSampleIsReportEvent: [QueueBurnDownSample] extends [QueueBurnDownEvent] ? true : never = true;

// ---------------------------------------------------------------------------
// Harness: the real QueueVerifyStep over a fake `tsc` (tests/support)
// ---------------------------------------------------------------------------

afterEach(cleanupQueueVerifyRun);

/** Runs the real QueueVerifyStep once and returns the attribute rows it wrote. */
const runQueueVerify = (tscStdout: string, tscExit: number): Promise<AttributeStores> =>
  runQueueVerifyOverFakeTools({ tscStdout, tscExit });

/** The durable attributes as `dexcli flow state` lists them: `<map>/<instance>`. */
function asStateAttributes(stores: AttributeStores): StateAttribute[] {
  const rows = stores.get(ppBurndown) ?? new Map<string, unknown>();
  return [...rows.entries()].map(([instance, value]) => ({ key: `queue-burndown/${instance}`, value }));
}

function totalRow(stores: AttributeStores): QueueBurnDownSample {
  const row = stores.get(ppBurndown)?.get("tsc-1") as QueueBurnDownSample | undefined;
  if (row === undefined) throw new Error("QueueVerifyStep wrote no tsc total row");
  return row;
}

function report(stores: AttributeStores) {
  const burnDown = collectBurnDown(asStateAttributes(stores));
  return renderReport({ envelopes: [], verdicts: [], burnDown });
}

function dashboardPoint(stores: AttributeStores) {
  const { burnDown } = feedFromState("contract-a", { attributes: asStateAttributes(stores) } as never);
  const tsc = burnDownSeries(burnDown).find((s) => s.queue === "tsc");
  const point = tsc?.points.find((p) => p.iteration === 1);
  if (point === undefined) throw new Error("dashboard produced no tsc point for iteration 1");
  return point;
}

// ---------------------------------------------------------------------------

describe("INT-2 Contract A: T1's tsc total row is exactly what T5 and T6 read", () => {
  test("the type declarations agree (compile-time gate; see Mutual<> above)", () => {
    expect(writerEqualsReport && reportEqualsDashboard && flowSampleIsReportEvent).toBe(true);
  });

  test("the written row: file null, accounting under `tsc`, snake_case keys, nothing else on it", async () => {
    const stores = await runQueueVerify("error TS18003: No inputs were found in config file 'tsconfig.json'.\n", 2);
    const row = totalRow(stores);

    expect(row.queue).toBe("tsc");
    expect(row.file).toBeNull();
    expect(Object.keys(row.tsc ?? {}).sort()).toEqual(["exit_code", "reason", "state", "unlocated"]);
    // per-file rows must not carry accounting (T5/T6 read the TOTAL row only)
    for (const [key, value] of stores.get(ppBurndown) ?? []) {
      if (key !== "tsc-1") expect((value as QueueBurnDownSample).tsc).toBeUndefined();
    }
  });

  test("NOT RUN: the report line and the dashboard point both say so, with T1's reason, never 0 or PASS", async () => {
    const stores = await runQueueVerify("error TS18003: No inputs were found in config file 'tsconfig.json'.\n", 2);
    const row = totalRow(stores);
    expect(row.tsc?.state).toBe("not-run");
    expect(row.error_count).toBe(0); // the vacuous count T5/T6 must NOT trust
    const reason = row.tsc?.reason ?? "";
    expect(reason).toContain("TS18003");

    // T1 -> T5
    const rendered = report(stores);
    const verification = rendered.json.summary.verification;
    expect(verification.tsc).toEqual(row.tsc as WriterTscAccounting);
    expect(verification.tsc_verified).toBeNull();
    expect(verification.tsc_final_error_count).toBeNull();
    expect(rendered.markdown).toContain(`typecheck (tsc): NOT RUN (${reason})`);
    expect(rendered.markdown).not.toContain("typecheck (tsc): PASS");

    // T1 -> T6
    const point = dashboardPoint(stores);
    expect(point.state).toBe("not-run");
    expect(point.errorCount).toBeNull();
    expect(point.reason).toBe(reason);
  });

  test("RAN with located errors and an unlocated one: T5 refuses PASS and counts it, T6 plots the located count", async () => {
    const stores = await runQueueVerify(
      [
        "src/a.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.",
        "src/a.ts(2,1): error TS2322: Type 'string' is not assignable to type 'number'.",
        "error TS5083: Cannot read file '/x/tsconfig.json'.",
        "",
      ].join("\n"),
      2,
    );
    const row = totalRow(stores);
    expect(row.tsc).toEqual({ state: "ran", reason: null, exit_code: 2, unlocated: 1 });
    expect(row.error_count).toBe(2);

    const rendered = report(stores);
    expect(rendered.json.summary.verification.tsc_verified).toBe(false);
    expect(rendered.json.summary.verification.tsc_final_error_count).toBe(2);
    expect(rendered.json.summary.verification.tsc).toEqual(row.tsc as WriterTscAccounting);
    expect(rendered.markdown).toContain("2 error(s) (+1 unlocated diagnostic(s)) remain at final iteration");

    const point = dashboardPoint(stores);
    expect(point.state).toBe("ran");
    expect(point.errorCount).toBe(2);
    expect(point.reason).toBeNull();
  });

  test("RAN clean: a genuine zero is the only thing T5 reports as PASS", async () => {
    const stores = await runQueueVerify("", 0);
    const row = totalRow(stores);
    expect(row.tsc).toEqual({ state: "ran", reason: null, exit_code: 0, unlocated: 0 });

    const rendered = report(stores);
    expect(rendered.json.summary.verification.tsc_verified).toBe(true);
    expect(rendered.markdown).toContain("typecheck (tsc): PASS at final iteration (0 remaining errors)");
    const point = dashboardPoint(stores);
    expect(point.state).toBe("ran");
    expect(point.errorCount).toBe(0);
  });
});
