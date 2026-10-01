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
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AsyncContext } from "@superdurable/dex";

import {
  PortProjectFlow,
  ppBurndown,
  ppConfig,
  ppPrep,
  ppQueue,
  queueVerifyTools,
  type PortQueueState,
  type PortRunInput,
  type PrepArtifact,
  type QueueBurnDownSample,
} from "../flows/port-project.js";
import { burnDownSeries, feedFromState } from "../src/dashboard/state.js";
import type { TscAccountingSample } from "../src/dashboard/types.js";
import { collectBurnDown, type StateAttribute } from "../src/metrics/collect.js";
import { renderReport } from "../src/metrics/render.js";
import type { QueueBurnDownEvent, TscRunAccounting as ReportTscAccounting } from "../src/metrics/types.js";
import type { TscRunAccounting as WriterTscAccounting } from "../src/queues/tsc-queue.js";

// ---------------------------------------------------------------------------
// Compile-time: the three declarations of the accounting are one shape. A
// field added, renamed or retyped on one side stops this file from compiling
// (typecheck is part of the gate), long before a report goes wrong.
// ---------------------------------------------------------------------------

type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const writerEqualsReport: Mutual<WriterTscAccounting, ReportTscAccounting> = true;
const reportEqualsDashboard: Mutual<ReportTscAccounting, TscAccountingSample> = true;
// The flow's own sample type must be accepted by the renderer's event type.
const flowSampleIsReportEvent = (row: QueueBurnDownSample): QueueBurnDownEvent => row;

// ---------------------------------------------------------------------------
// Harness: real QueueVerifyStep, stub ctx, fake tsc binary
// ---------------------------------------------------------------------------

type Stores = Map<unknown, Map<string, unknown>>;

function put(stores: Stores, attr: unknown, key: string, value: unknown): void {
  let s = stores.get(attr);
  if (s === undefined) {
    s = new Map();
    stores.set(attr, s);
  }
  s.set(key, value);
}

function ctxOver(stores: Stores): AsyncContext {
  return {
    attempt: 1,
    flowId: "contract-a",
    getAttribute: (attr: unknown, instance: string) => stores.get(attr)?.get(instance),
    setAttribute: (attr: unknown, value: unknown, instance: string) => put(stores, attr, instance, value),
  } as unknown as AsyncContext;
}

const tempDirs: string[] = [];
const PRODUCTION_TOOLS = { ...queueVerifyTools };

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `contract-a-${prefix}-`));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  Object.assign(queueVerifyTools, PRODUCTION_TOOLS);
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** A `tsc` that prints canned output and exits with `exit`. */
async function fakeTsc(stdout: string, exit: number): Promise<string> {
  const dir = await tempDir("bin");
  await writeFile(join(dir, "stdout"), stdout);
  const path = join(dir, "tsc");
  await writeFile(path, `#!/bin/sh\ncat "${join(dir, "stdout")}"\nexit ${exit}\n`);
  await chmod(path, 0o755);
  return path;
}

const SOURCE_MAP = { "src/A.php": { outPath: "src/a.ts", notes: "" } };

/** Runs the real QueueVerifyStep once and returns the attribute rows it wrote. */
async function runQueueVerify(tscStdout: string, tscExit: number): Promise<Stores> {
  const itg = await tempDir("checkout");
  await mkdir(join(itg, "src"), { recursive: true });
  queueVerifyTools.tscBin = await fakeTsc(tscStdout, tscExit);
  const stores: Stores = new Map();
  const queue: PortQueueState = {
    pending: [],
    current: null,
    done: [{ file: "src/A.php", round: 1, commitSha: null, treeHash: null }],
    blocked: [],
  };
  const prep: PrepArtifact = { raw: "", sourceMap: SOURCE_MAP, symbolTable: [] };
  put(stores, ppQueue, "queue", queue);
  put(stores, ppConfig, "config", { maxRounds: 2, prepMaxRounds: 1 });
  put(stores, ppPrep, "prep", prep);
  const input: PortRunInput = {
    repoRoot: itg,
    worktreeRoot: join(itg, ".wt"),
    integrationWorktreePath: itg,
    epoch: 1,
    sourceRoot: itg,
    prepPath: "",
    files: [],
    maxRounds: 2,
    dispatchMode: "parallel",
  };
  await new PortProjectFlow().queueVerify.execute(ctxOver(stores), input);
  return stores;
}

/** The durable attributes as `dexcli flow state` lists them: `<map>/<instance>`. */
function asStateAttributes(stores: Stores): StateAttribute[] {
  const rows = stores.get(ppBurndown) ?? new Map<string, unknown>();
  return [...rows.entries()].map(([instance, value]) => ({ key: `queue-burndown/${instance}`, value }));
}

function totalRow(stores: Stores): QueueBurnDownSample {
  const row = stores.get(ppBurndown)?.get("tsc-1") as QueueBurnDownSample | undefined;
  if (row === undefined) throw new Error("QueueVerifyStep wrote no tsc total row");
  return row;
}

function report(stores: Stores) {
  const burnDown = collectBurnDown(asStateAttributes(stores));
  return renderReport({ envelopes: [], verdicts: [], burnDown });
}

function dashboardPoint(stores: Stores) {
  const { burnDown } = feedFromState("contract-a", { attributes: asStateAttributes(stores) } as never);
  const tsc = burnDownSeries(burnDown).find((s) => s.queue === "tsc");
  const point = tsc?.points.find((p) => p.iteration === 1);
  if (point === undefined) throw new Error("dashboard produced no tsc point for iteration 1");
  return point;
}

// ---------------------------------------------------------------------------

describe("INT-2 Contract A: T1's tsc total row is exactly what T5 and T6 read", () => {
  test("the type declarations agree (compile-time gate; see Mutual<> above)", () => {
    expect(writerEqualsReport && reportEqualsDashboard).toBe(true);
    expect(typeof flowSampleIsReportEvent).toBe("function");
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
