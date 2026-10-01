/**
 * What the flow writes and declares is what something reads (audit C50).
 *
 * Three leftovers of earlier designs were still in the flow:
 *  - every envelope event carried `file: null, round: null`, written by all three
 *    writers and read by nobody on the live path (a per-file step is identified by
 *    `identity`);
 *  - the per-file SubFlow input carried `maxRounds`, a cap no child step reads (the
 *    parent enforces it before it dispatches);
 *  - ImplementStep declared `ppQueue` among the maps it loads and never read it,
 *    paying a durable read on every attempt of the most expensive step.
 */

import { gracefulComplete } from "@superdurable/dex";
import { afterEach, describe, expect, test } from "bun:test";

import { ImplementStep } from "../flows/port/file-steps.js";
import { childInputOf } from "../flows/port/queue-logic.js";
import { ppPrep, ppQueue, type PortRunInput, type PrepArtifact } from "../flows/port/state.js";
import {
  configureEnvelopeStreamPublisher,
  envelopeEvents,
  envelopeStartMarker,
  envelopeStepClass,
  publishTurnDiagnosisEvent,
  type EnvelopeEvent,
  type EnvelopeStreamMessage,
} from "../flows/steps/envelope.js";
import { sessionFenceMap } from "../src/harness/opencode.js";
import { declaredLoads, runStep, stubContext, type AttributeStores } from "./support/dex-context.js";

interface In {
  n: number;
}

const perFile = envelopeStepClass<In, In>({
  stepType: "LeftoverPerFile",
  stepId: "leftover-per-file",
  role: "record",
  identityOf: (_ctx, input) => `src__a.php#${input.n}`,
  inner: async (_ctx, input) => ({ output: input, tokens: null }),
});

const flowLevel = envelopeStepClass<In, In>({
  stepType: "LeftoverFlowLevel",
  stepId: "leftover-flow-level",
  role: "record",
  inner: async (_ctx, input) => ({ output: input, tokens: null }),
});

const marker = envelopeStartMarker<In>({
  stepType: "LeftoverStart",
  targetStepId: "leftover-model",
  role: "agent",
  identityOf: (_ctx, input) => `src__a.php#${input.n}`,
  route: (input) => gracefulComplete(input),
});

/** Every event written durably and mirrored to the stream during `body`. */
async function collect(body: (stores: AttributeStores) => Promise<void> | void): Promise<{
  durable: EnvelopeEvent[];
  streamed: EnvelopeEvent[];
}> {
  const stores: AttributeStores = new Map();
  const streamed: EnvelopeEvent[] = [];
  configureEnvelopeStreamPublisher((message: EnvelopeStreamMessage) => {
    streamed.push(message.event);
  });
  await body(stores);
  return { durable: [...(stores.get(envelopeEvents)?.values() ?? [])] as EnvelopeEvent[], streamed };
}

afterEach(() => configureEnvelopeStreamPublisher(undefined));

function expectNoOwnFileOrRound(events: readonly EnvelopeEvent[]): void {
  expect(events.length).toBeGreaterThan(0);
  for (const event of events) {
    expect("file" in event).toBe(false);
    expect("round" in event).toBe(false);
  }
}

describe("envelope events carry no file/round of their own", () => {
  test("a per-file step's open and completed events, durable and streamed, are keyed by identity alone", async () => {
    const { durable, streamed } = await collect((stores) => runStep(stores, new perFile(), { n: 2 }).then(() => {}));
    expectNoOwnFileOrRound(durable);
    expectNoOwnFileOrRound(streamed);
    expect([...durable, ...streamed].every((e) => e.identity === "src__a.php#2")).toBe(true);
  });

  test("a flow-level step's events have no identity and no file/round", async () => {
    const { durable, streamed } = await collect((stores) => runStep(stores, new flowLevel(), { n: 1 }).then(() => {}));
    expectNoOwnFileOrRound(durable);
    expectNoOwnFileOrRound(streamed);
    expect([...durable, ...streamed].every((e) => e.identity === null)).toBe(true);
  });

  test("the attempt-0 start marker has none either", async () => {
    const { durable, streamed } = await collect((stores) => runStep(stores, new marker(), { n: 3 }).then(() => {}));
    const markers = [...durable, ...streamed].filter((e) => e.attempt === 0);
    expectNoOwnFileOrRound(markers);
    expect(markers.every((e) => e.identity === "src__a.php#3")).toBe(true);
  });

  test("the stream-only turn-diagnosis record has none", async () => {
    const { streamed } = await collect(() => {
      publishTurnDiagnosisEvent(stubContext(), {
        turn: "pp-review-a#1",
        recorded_at_utc: "2026-09-30T10:00:00.000Z",
      } as never);
    });
    expect(streamed).toHaveLength(1);
    expectNoOwnFileOrRound(streamed);
  });
});

describe("the per-file SubFlow input carries what the child reads", () => {
  test("childInputOf has no round cap: the parent enforces it before dispatch", () => {
    const base: PortRunInput = {
      repoRoot: "/r",
      worktreeRoot: "/r/.worktrees",
      integrationWorktreePath: "/r/.worktrees/integration",
      epoch: 1,
      sourceRoot: "/src",
      prepPath: "/p.md",
      files: ["src/a.php"],
      maxRounds: 4,
    };
    const prep: PrepArtifact = { raw: "", sourceMap: {}, symbolTable: [] };
    const input = childInputOf(base, prep, "src/a.php", 2, [], []);
    expect(Object.keys(input).sort()).toEqual(
      [
        "epoch",
        "file",
        "integrationWorktreePath",
        "prep",
        "queueFixErrors",
        "queueFixVitest",
        "repoRoot",
        "round",
        "sourceRoot",
        "worktreeRoot",
      ].sort(),
    );
  });
});

describe("ImplementStep declares the maps it reads", () => {
  test("the fence and the prep artifact, and not the queue it never touches", () => {
    const loads = declaredLoads(new ImplementStep());
    expect(loads).toEqual([sessionFenceMap, ppPrep]);
    expect(loads).not.toContain(ppQueue);
  });
});
