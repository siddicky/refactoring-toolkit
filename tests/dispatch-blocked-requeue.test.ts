/**
 * INT-10 (T2 observation) — DispatchStep's `blocked` arm must not end the run.
 *
 * Sequential mode records a file that hit the round cap as blocked and clears
 * `queue.current`. It then routed to LeaseStep, which reads `current === null`
 * as "queue exhausted" and goes to FinalStep: every file still pending behind
 * the blocked one was silently abandoned (never leased, never recorded as
 * blocked, absent from the result). Reachable with maxRounds < 1 (every file is
 * blocked on its first pass) or an in-flight resume past the cap.
 *
 * Fixed by re-entering DispatchStep after a blocked pass, so each remaining
 * file is started or blocked in turn and the run only leaves dispatch when the
 * queue is truly empty.
 */

import { describe, expect, test } from "bun:test";
import type { StepDecision } from "@superdurable/dex";

import {
  PortProjectFlow,
  ppConfig,
  ppQueue,
  type PortQueueState,
  type PortRunInput,
} from "../flows/port-project.js";
import { declaredLoads, stubContext, type AttributeStores, type DeclaresLoads } from "./support/dex-context.js";

/** dex-like context: reading an attribute map the step did not declare throws. */
const ctxFor = (stores: AttributeStores, step: DeclaresLoads) =>
  stubContext(stores, { flowId: "int10-dispatch", loads: declaredLoads(step) });

function seeded(queue: PortQueueState, maxRounds: number): AttributeStores {
  const stores: AttributeStores = new Map();
  stores.set(ppConfig, new Map([["config", { maxRounds, prepMaxRounds: 2 }]]));
  stores.set(ppQueue, new Map([["queue", queue]]));
  return stores;
}

const RUN: PortRunInput = {
  repoRoot: "/r",
  worktreeRoot: "/r/.wt",
  integrationWorktreePath: "/r/.wt/integration",
  epoch: 4,
  sourceRoot: "/r/php",
  prepPath: "/r/prep.md",
  files: [],
  maxRounds: 2,
  dispatchMode: "sequential",
};

function next(decision: StepDecision): { step: unknown; input: Record<string, unknown> } {
  if (decision.kind !== "next") throw new Error(`expected a next decision, got ${decision.kind}`);
  const movement = decision.movements[0];
  if (movement === undefined) throw new Error("decision carries no movement");
  return { step: movement.step, input: movement.input as Record<string, unknown> };
}

const queueOf = (stores: AttributeStores): PortQueueState => stores.get(ppQueue)?.get("queue") as PortQueueState;

describe("INT-10: DispatchStep re-dispatches after a blocked pass", () => {
  test("an in-flight file past the cap is blocked and the NEXT pending file still gets started", async () => {
    const flow = new PortProjectFlow();
    const stores = seeded(
      {
        pending: ["src/B.php", "src/C.php"],
        current: { file: "src/A.php", round: 3, epoch: 4 },
        done: [],
        blocked: [],
      },
      2,
    );

    const first = next(await flow.dispatch.execute(ctxFor(stores, flow.dispatch), RUN));
    // not Lease (which would read current === null as exhausted and end the run)
    expect(first.step).toBe(flow.dispatch.constructor);
    expect(first.step).not.toBe(flow.lease.constructor);
    expect(queueOf(stores).blocked).toEqual([{ file: "src/A.php", round: 3, reason: "round cap 2 exceeded" }]);
    expect(queueOf(stores).pending).toEqual(["src/B.php", "src/C.php"]);
    // the bookkeeping flags do not leak into the re-entered step's input
    expect("requeue" in first.input).toBe(false);
    expect("done" in first.input).toBe(false);

    const second = next(await flow.dispatch.execute(ctxFor(stores, flow.dispatch), first.input as never));
    expect(second.step).toBe(flow.lease.constructor);
    expect(queueOf(stores).current).toEqual({ file: "src/B.php", round: 1, epoch: 4 });
    expect(queueOf(stores).pending).toEqual(["src/C.php"]);
  });

  test("maxRounds 0 blocks EVERY pending file with its reason, then leaves dispatch for the verify queue", async () => {
    const flow = new PortProjectFlow();
    const stores = seeded(
      { pending: ["src/A.php", "src/B.php", "src/C.php"], current: null, done: [], blocked: [] },
      0,
    );

    let input: Record<string, unknown> = { ...RUN, maxRounds: 0 };
    let step: unknown = flow.dispatch.constructor;
    let passes = 0;
    while (step === flow.dispatch.constructor) {
      if (++passes > 10) throw new Error("dispatch did not terminate");
      const decision = next(await flow.dispatch.execute(ctxFor(stores, flow.dispatch), input as never));
      step = decision.step;
      input = decision.input;
    }

    expect(passes).toBe(4); // three blocked passes + the pass that sees an empty queue
    expect(step).toBe(flow.queueVerify.constructor);
    expect(input.done).toBe(true);
    expect(queueOf(stores)).toEqual({
      pending: [],
      current: null,
      done: [],
      blocked: [
        { file: "src/A.php", round: 1, reason: "round cap 0 exceeded" },
        { file: "src/B.php", round: 1, reason: "round cap 0 exceeded" },
        { file: "src/C.php", round: 1, reason: "round cap 0 exceeded" },
      ],
    });
  });

  test("a normal start and an empty queue route as before", async () => {
    const flow = new PortProjectFlow();
    const start = seeded({ pending: ["src/A.php"], current: null, done: [], blocked: [] }, 2);
    expect(next(await flow.dispatch.execute(ctxFor(start, flow.dispatch), RUN)).step).toBe(flow.lease.constructor);

    const empty = seeded({ pending: [], current: null, done: [], blocked: [] }, 2);
    const done = next(await flow.dispatch.execute(ctxFor(empty, flow.dispatch), RUN));
    expect(done.step).toBe(flow.queueVerify.constructor);
    expect(done.input.done).toBe(true);
  });
});
