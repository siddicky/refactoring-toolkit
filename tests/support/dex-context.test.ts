import { describe, expect, test } from "bun:test";
import type { StepDecision } from "@superdurable/dex";

import {
  declaredLoads,
  peekAttribute,
  runStep,
  seedAttribute,
  stagingContext,
  stubContext,
  type AttributeStores,
  type StepLike,
} from "./dex-context.js";

const MAP_A = { name: "map-a" };
const MAP_B = { name: "map-b" };

/** The Context's getAttribute is generic over dex's AttributeMap types; the stub is keyed by identity only. */
const read = (ctx: object, attr: unknown, instance: string): unknown =>
  (ctx as { getAttribute: (attr: unknown, instance: string) => unknown }).getAttribute(attr, instance);

describe("stubContext", () => {
  test("reads what was written, through the same stores", () => {
    const stores: AttributeStores = new Map();
    stubContext(stores).setAttribute(MAP_A as never, "v1" as never, "k");
    expect(read(stubContext(stores), MAP_A, "k")).toBe("v1");
    expect(peekAttribute<unknown>(stores, MAP_A, "k")).toBe("v1");
    expect(read(stubContext(stores), MAP_A, "missing")).toBeUndefined();
  });

  test("uses a fresh store when none is passed", () => {
    const ctx = stubContext();
    ctx.setAttribute(MAP_A as never, "v" as never, "k");
    expect(read(ctx, MAP_A, "k")).toBe("v");
    expect(read(stubContext(), MAP_A, "k")).toBeUndefined();
  });

  test("defaults: attempt 1, a flow id, and no runId unless given", () => {
    const bare = stubContext() as unknown as Record<string, unknown>;
    expect(bare.attempt).toBe(1);
    expect(typeof bare.flowId).toBe("string");
    expect("runId" in bare).toBe(false);
    const custom = stubContext(new Map(), { flowId: "f", runId: "r", attempt: 3 });
    expect([custom.flowId, custom.runId, custom.attempt]).toEqual(["f", "r", 3]);
  });

  test("with loads, a read of an undeclared map throws and names it; declared maps still read", () => {
    const stores: AttributeStores = new Map();
    seedAttribute(stores, MAP_A, "k", 1);
    seedAttribute(stores, MAP_B, "k", 2);
    const ctx = stubContext(stores, { loads: [MAP_A] });
    expect(read(ctx, MAP_A, "k")).toBe(1);
    expect(() => read(ctx, MAP_B, "k")).toThrow("AttributeMap instance was not loaded: map-b/k");
  });

  test("writes are never gated by loads", () => {
    const stores: AttributeStores = new Map();
    stubContext(stores, { loads: [] }).setAttribute(MAP_B as never, "v" as never, "k");
    expect(peekAttribute<unknown>(stores, MAP_B, "k")).toBe("v");
  });
});

describe("stagingContext", () => {
  test("records every write in order and offers no reads", () => {
    const { context, staged } = stagingContext({ flowId: "staging" });
    context.setAttribute(MAP_A as never, "one" as never, "k1");
    context.setAttribute(MAP_B as never, "two" as never, "k2");
    expect(staged).toEqual([
      { attr: MAP_A, instance: "k1", value: "one" },
      { attr: MAP_B, instance: "k2", value: "two" },
    ]);
    expect((context as unknown as Record<string, unknown>).getAttribute).toBeUndefined();
    expect(context.flowId).toBe("staging");
  });
});

describe("declaredLoads / runStep", () => {
  const readsB = (loads: readonly unknown[]): StepLike => ({
    getStepOptions: () => ({ executeLoadAttributeMaps: loads }),
    execute: ((ctx: { getAttribute: (attr: unknown, instance: string) => unknown }) => {
      return { kind: "next", value: ctx.getAttribute(MAP_B, "k") } as unknown as StepDecision;
    }) as unknown as StepLike["execute"],
  });

  test("declaredLoads is empty for a step with no options", () => {
    expect(declaredLoads({})).toEqual([]);
    expect(declaredLoads({ getStepOptions: () => undefined })).toEqual([]);
    expect(declaredLoads({ getStepOptions: () => ({ executeLoadAttributeMaps: [MAP_A] }) })).toEqual([MAP_A]);
  });

  test("runStep serves the maps the step declared and rejects a read outside them", async () => {
    const stores: AttributeStores = new Map();
    seedAttribute(stores, MAP_B, "k", "b-value");
    expect(await runStep(stores, readsB([MAP_B]), {})).toEqual({ kind: "next", value: "b-value" } as never);
    await expect(runStep(stores, readsB([MAP_A]), {})).rejects.toThrow("was not loaded");
  });
});
