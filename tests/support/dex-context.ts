/**
 * Test helper (not a test file): in-memory stand-ins for the dex step Context.
 *
 * Flow-step tests run a step's `execute` directly. Dex hands a step a Context
 * whose attribute reads and writes go to durable AttributeMaps, and it only
 * serves the maps the step declared in `executeLoadAttributeMaps`. Every test
 * that drives a step needs the same stub, so it lives here once:
 *
 *   - {@link stubContext}: reads and writes against {@link AttributeStores}.
 *     Pass `loads: declaredLoads(step)` to enforce the declared-load rule
 *     (a read of an undeclared map throws, as dex does).
 *   - {@link stagingContext}: write-only; records each setAttribute call.
 *     For steps that only emit envelope events and never read.
 *
 * Both return AsyncContext (a subtype of Context), so the result can be passed
 * to any step handler without a cast.
 */

import type { AsyncContext, StepDecision } from "@superdurable/dex";

/** AttributeMap identity -> instance key -> value: the durable state a step reads and writes. */
export type AttributeStores = Map<unknown, Map<string, unknown>>;

/** Anything dex can ask for step options (a step instance, or a bare `{ getStepOptions }`). */
export interface DeclaresLoads {
  getStepOptions?: () => unknown;
}

/** A step as the tests drive it: options for declared loads, plus `execute`. */
export interface StepLike extends DeclaresLoads {
  execute: (context: never, input: never) => StepDecision | Promise<StepDecision>;
}

/** The AttributeMaps the step declared in `executeLoadAttributeMaps` (empty when none). */
export function declaredLoads(step: DeclaresLoads): readonly unknown[] {
  const options = step.getStepOptions?.() as { executeLoadAttributeMaps?: readonly unknown[] } | undefined;
  return options?.executeLoadAttributeMaps ?? [];
}

/** Writes `value` at `attr`/`key`, creating the map's store on first use. */
export function seedAttribute(stores: AttributeStores, attr: unknown, key: string, value: unknown): void {
  let store = stores.get(attr);
  if (store === undefined) {
    store = new Map();
    stores.set(attr, store);
  }
  store.set(key, value);
}

/** Reads `attr`/`key` back (undefined when absent). */
export function peekAttribute<T = unknown>(stores: AttributeStores, attr: unknown, key: string): T | undefined {
  return stores.get(attr)?.get(key) as T | undefined;
}

export interface StubContextOptions {
  /** Defaults to "stub-flow". Pick a distinctive id when a test asserts on envelope keys. */
  flowId?: string;
  /** Omitted from the context unless given. */
  runId?: string;
  /** Defaults to 1. */
  attempt?: number;
  /**
   * When given, getAttribute throws for any AttributeMap outside this list,
   * like dex does for a map the step did not declare. Omit for an ungated stub.
   */
  loads?: readonly unknown[];
}

/** Context over in-memory attribute stores (a fresh store when none is passed). */
export function stubContext(stores: AttributeStores = new Map(), options: StubContextOptions = {}): AsyncContext {
  const { flowId = "stub-flow", runId, attempt = 1, loads } = options;
  return {
    attempt,
    flowId,
    ...(runId === undefined ? {} : { runId }),
    getAttribute: (attr: unknown, instance: string) => {
      if (loads !== undefined && !loads.includes(attr)) {
        throw new Error(`AttributeMap instance was not loaded: ${(attr as { name?: string }).name ?? "?"}/${instance}`);
      }
      return stores.get(attr)?.get(instance);
    },
    setAttribute: (attr: unknown, value: unknown, instance: string) => {
      seedAttribute(stores, attr, instance, value);
    },
  } as unknown as AsyncContext;
}

/** Runs a step the way dex would: a context that enforces the step's declared loads, then `execute`. */
export async function runStep(
  stores: AttributeStores,
  step: StepLike,
  input: unknown,
  options: Omit<StubContextOptions, "loads"> = {},
): Promise<StepDecision> {
  return step.execute(stubContext(stores, { ...options, loads: declaredLoads(step) }) as never, input as never);
}

export interface StagedWrite {
  attr: unknown;
  instance: string;
  value: unknown;
}

/** Write-only context: records every setAttribute call and has no getAttribute. */
export function stagingContext(options: Pick<StubContextOptions, "flowId" | "attempt"> = {}): {
  context: AsyncContext;
  staged: StagedWrite[];
} {
  const { flowId = "stub-flow", attempt = 1 } = options;
  const staged: StagedWrite[] = [];
  const context = {
    attempt,
    flowId,
    setAttribute: (attr: unknown, value: unknown, instance: string) => {
      staged.push({ attr, instance, value });
    },
  } as unknown as AsyncContext;
  return { context, staged };
}
