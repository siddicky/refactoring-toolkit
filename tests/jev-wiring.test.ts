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
import { liveJevClient } from "../flows/port-project.js";
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

  test("all three consumption sites (verdict-check, prioritize, vitest triage) resolve through liveJevClient()", () => {
    const src = readFileSync(join(ROOT, "flows", "port-project.ts"), "utf8");
    const sites = src.split("\n").filter((l) => l.includes("liveJevClient()"));
    // The verdict-check consumer, the prioritize consumer, and the
    // classifyVitestRecords consumer — plus the resolver's own definition.
    const consumerSites = sites.filter(
      (l) => l.includes("const jevClient = liveJevClient()") || l.includes("classifyVitestRecords("),
    );
    expect(consumerSites.length).toBe(3);
    // The dead second seam is GONE (the drift cannot regrow silently) —
    // code-shape check: comments may still recount the history.
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
