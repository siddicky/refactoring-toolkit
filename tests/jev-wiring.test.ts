/**
 * US-007 (Stage 2d) — Jev live wiring + bounded telemetry swallow.
 *
 * 1. Wiring (dex-sdk skill review, DRIFT S "silent naive fallback"): the old
 *    `configurePortJevLive`/`PORT_JEV_LIVE` second seam was NEVER called by
 *    the worker, so a TYPESAFE_API_KEY worker silently ran the naive
 *    classifier in verdict-check, prioritize, and vitest triage while its
 *    log claimed "Jev: REAL client". The fix collapses the seam: one
 *    resolution point (`liveJevClient()` over the runtime-hooks judgment
 *    client configured by the worker) serves all three consumption sites.
 *
 * 2. Swallow bound (review DRIFT S, error-handling.md §Client failures): the
 *    telemetry publisher swallow is narrowed to DexServiceError-class
 *    failures; anything else is logged sanitized at warn — the durable write
 *    path is protected either way.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { DexServiceError, ErrorSubStatus } from "@superdurable/dex";
import { status } from "@grpc/grpc-js";

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { configurePortJudgment } from "../flows/runtime-hooks.js";
import { portFlowSource } from "./helpers/port-flow-source.js";
import {
  liveJevClient,
  markerKeyOf,
  PortFileFlow,
  ppDiff,
  ppJevUsage,
  ppKept,
  ppVerdict,
  type FileRoundInput,
} from "../flows/port-project.js";
import {
  configureEnvelopeStreamPublisher,
  envelopeStep,
  type EnvelopeStreamMessage,
} from "../flows/steps/envelope.js";
import {
  createInMemoryJevClient,
  type JudgmentClient,
} from "../src/typesafe/client.js";
import type { Context } from "@superdurable/dex";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---------------------------------------------------------------------------
// 1: wiring — key present -> the REAL client reaches the consumption sites;
//    key absent (or offline double) -> naive, no crash.
// ---------------------------------------------------------------------------

describe("Jev live wiring (US-007): single seam to all three consumers", () => {
  afterEach(() => {
    // bun runs files in one process: a REAL-kind seam must never leak into
    // other files' steps — verdict-check now consumes it (which is exactly
    // the wiring this story fixes; the leak IS the end-to-end proof).
    configurePortJudgment(createInMemoryJevClient());
  });

  test("nothing configured -> undefined (naive) without crashing", () => {
    // Runs BEFORE any configurePortJudgment call in this file: the unconfigured
    // worker path (probe-only workers, unit tests) must stay naive + quiet.
    expect(liveJevClient()).toBeUndefined();
  });

  test("an in-memory (non-real) client configured -> naive, no crash", () => {
    const offline = createInMemoryJevClient();
    configurePortJudgment(offline);
    expect(liveJevClient()).toBeUndefined();
  });

  test("a REAL client configured -> the SAME instance is reachable at the consumption sites", () => {
    // Real-kind double: no network — only `kind` and systemOne are consulted.
    const real: JudgmentClient = {
      kind: "real",
      systemOne: (() => {
        throw new Error("no network in unit tests");
      }) as JudgmentClient["systemOne"],
    };
    configurePortJudgment(real);
    expect(liveJevClient()).toBe(real);
  });

  /** Runs the REAL verdict-check and prioritize steps against `client`; returns the client's call counts. */
  async function exerciseLaneBSteps(
    client: JudgmentClient & { calls: number },
  ): Promise<{ verdictCheckCalls: number; prioritizeCalls: number }> {
    configurePortJudgment(client);
    const file = "src/Money.php";
    const key = markerKeyOf(file, 1);
    const fri: FileRoundInput = {
      repoRoot: "/r",
      worktreeRoot: "/r/.wt",
      integrationWorktreePath: "/r/.wt/integration",
      sourceRoot: "/r/src",
      epoch: 1,
      file,
      round: 1,
      worktreePath: "/r/.wt/money-1",
      branch: "lease/money/1",
    };
    const finding = {
      finding_id: "A1",
      severity: "major" as const,
      summary: "s",
      evidence: { hunk_id: "h1", start_line: 1, end_line: 1, quote: "export class Money {" },
    };
    const doc = {
      diff_id: "d1",
      file,
      base_ref: "HEAD",
      hunks: [
        { hunk_id: "h1", header: "@@ -0,0 +1,1 @@", old_start: 0, old_lines: 0, new_start: 1, new_lines: 1, lines: ["+export class Money {"] },
      ],
    };
    const tuple = (reviewer: string, findings: Array<typeof finding>): unknown => ({
      agent: {
        file,
        reviewer,
        round: 1,
        diff_id: "d1",
        findings: findings.map((f) => ({
          finding_id: f.finding_id,
          severity: f.severity,
          description: f.summary,
          evidence_span: { start_line: 1, end_line: 1, snippet: f.evidence.quote },
          disposition: "fix",
        })),
        citation_check: [],
      },
      metrics: { file, reviewer, round: 1, diff_id: "d1", findings, citation_check: [] },
    });
    const stores = new Map<unknown, Map<string, unknown>>([
      [ppDiff, new Map([[key, { diffId: "d1", raw: "", doc, bodyLineOffset: 0 }]])],
      [ppVerdict, new Map([[`${key}#reviewer-A`, tuple("reviewer-A", [finding])], [`${key}#reviewer-B`, tuple("reviewer-B", [])]])],
      [ppKept, new Map()],
      [ppJevUsage, new Map()],
    ]);
    const ctx = {
      attempt: 1,
      flowId: "us007-wiring-steps",
      getAttribute: (attr: unknown, instance: string) => stores.get(attr)?.get(instance),
      setAttribute: (attr: unknown, value: unknown, instance: string) => {
        if (!stores.has(attr)) stores.set(attr, new Map());
        stores.get(attr)?.set(instance, value);
      },
    } as unknown as Context;

    const flow = new PortFileFlow();
    const before = client.calls;
    await flow.verdictCheck.execute(ctx as never, fri);
    const afterVerdictCheck = client.calls;
    await flow.prioritize.execute(ctx as never, fri);
    return { verdictCheckCalls: afterVerdictCheck - before, prioritizeCalls: client.calls - afterVerdictCheck };
  }

  function countingClient(kind: "real" | "in-memory"): JudgmentClient & { calls: number } {
    const client = {
      kind,
      calls: 0,
      systemOne: async (request: { questions: Record<string, unknown> }) => {
        client.calls += 1;
        const answers: Record<string, { type: "noul"; noul: number }> = {};
        for (const name of Object.keys(request.questions)) answers[name] = { type: "noul", noul: 0.99 };
        return { model: "double", answers, usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
    return client as unknown as JudgmentClient & { calls: number };
  }

  test("verdict-check and prioritize consume the REAL client resolved through liveJevClient()", async () => {
    const real = countingClient("real");
    const calls = await exerciseLaneBSteps(real);
    expect(calls.verdictCheckCalls).toBeGreaterThan(0);
    expect(calls.prioritizeCalls).toBeGreaterThan(0);
  });

  test("a non-real (in-memory) client is never consulted by verdict-check or prioritize (naive default)", async () => {
    const offline = countingClient("in-memory");
    const calls = await exerciseLaneBSteps(offline);
    expect(calls).toEqual({ verdictCheckCalls: 0, prioritizeCalls: 0 });
  });

  test("the vitest-triage site (QueueVerifyStep -> classifyVitestRecords) resolves through liveJevClient()", () => {
    // QueueVerifyStep shells out to tsc/vitest, so it is not executed here;
    // the call site is pinned narrowly. The dead second seam is GONE (the
    // drift cannot regrow silently) — code-shape checks: comments may still
    // recount the history.
    const src = portFlowSource();
    const callSites = src.split("\n").filter((l) => /\bclassifyVitestRecords\(/.test(l) && !l.includes("function classifyVitestRecords"));
    expect(callSites.length).toBe(1);
    expect(callSites[0]).toContain("liveJevClient()");
    expect(src.match(/let PORT_JEV_LIVE\b/)).toBeNull();
    expect(src.match(/function configurePortJevLive\b/)).toBeNull();
    expect(src.match(/function portJevLiveClient\b/)).toBeNull();
  });

  test("the worker wires configurePortJudgment from resolveJudgment and announces the lane", () => {
    const src = readFileSync(join(ROOT, "scripts", "run-demo.ts"), "utf8");
    expect(src).toContain("const judgment = await resolveJudgment();");
    expect(src).toContain("configurePortJudgment(judgment);");
    expect(src).toContain("JUDGMENT LANE:");
  });
});

// ---------------------------------------------------------------------------
// 2: bounded telemetry swallow
// ---------------------------------------------------------------------------

describe("bounded telemetry swallow (US-007): DexServiceError silent, defects loud, durable path safe", () => {
  function fakeContext(): { context: Context; staged: Array<{ instance: string }> } {
    const staged: Array<{ instance: string }> = [];
    const context = {
      attempt: 1,
      flowId: "us007-wiring-flow",
      setAttribute: (_attr: unknown, _value: unknown, instance: string) => {
        staged.push({ instance });
      },
    } as unknown as Context;
    return { context, staged };
  }

  const step = envelopeStep<{ n: number }, { n: number }>({
    stepType: "ProbeWiringSwallow",
    stepId: "pp-wiring-swallow",
    role: "record",
    inner: async (_ctx, input) => ({ output: { n: input.n }, tokens: null }),
  });

  let warns: string[] = [];
  const originalWarn = console.warn;
  const captureWarn = (): void => {
    warns = [];
    console.warn = (...args: unknown[]) => {
      warns.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
    };
  };

  afterEach(() => {
    console.warn = originalWarn;
    configureEnvelopeStreamPublisher(undefined);
  });

  test("a DexServiceError rejection (expected outage) is swallowed SILENTLY; step completes", async () => {
    captureWarn();
    const probe = fakeContext();
    configureEnvelopeStreamPublisher(() =>
      Promise.reject(
        new DexServiceError(
          status.UNAVAILABLE,
          ErrorSubStatus.UNCATEGORIZED,
          "stream store unavailable",
          "writeStream",
          "us007-wiring-flow",
        ),
      ),
    );
    const decision = await step.execute(probe.context as never, { n: 1 });
    expect(decision.kind).toBe("gracefulComplete");
    expect(probe.staged.length).toBe(2); // start + completion, durable
    expect(warns).toEqual([]); // silent: expected best-effort outage
  });

  test("a non-service rejection (defect) is logged sanitized at warn; step STILL completes", async () => {
    captureWarn();
    const probe = fakeContext();
    configureEnvelopeStreamPublisher(() =>
      Promise.reject(new TypeError("codec returned a non-object (programming defect)")),
    );
    const decision = await step.execute(probe.context as never, { n: 2 });
    expect(decision.kind).toBe("gracefulComplete");
    expect(probe.staged.length).toBe(2);
    expect(warns.length).toBe(2); // start + completion publishes both failed
    expect(warns[0]).toContain("non-service publish failure");
    // Sanitized identity only: flow id + event key, no payload dump.
    expect(warns[0]).toContain("flow=us007-wiring-flow");
    expect(warns[0]).toContain("event=pp-wiring-swallow#1");
    expect(warns[0]).toContain("programming defect");
  });

  test("a synchronous publisher throw is routed through the same bounded swallow", async () => {
    captureWarn();
    const probe = fakeContext();
    configureEnvelopeStreamPublisher((_msg: EnvelopeStreamMessage) => {
      throw new RangeError("publisher bug (sync)");
    });
    const decision = await step.execute(probe.context as never, { n: 3 });
    expect(decision.kind).toBe("gracefulComplete");
    expect(probe.staged.length).toBe(2);
    expect(warns.length).toBe(2);
    expect(warns[0]).toContain("publisher bug (sync)");
  });

  test("no publisher configured -> hook is a no-op, no warn", async () => {
    captureWarn();
    const probe = fakeContext();
    const decision = await step.execute(probe.context as never, { n: 4 });
    expect(decision.kind).toBe("gracefulComplete");
    expect(probe.staged.length).toBe(2);
    expect(warns).toEqual([]);
  });
});
