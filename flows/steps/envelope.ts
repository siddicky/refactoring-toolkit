/**
 * The ONLY step factory in the toolkit (plan §Metrics event contract).
 * Every durable step is created through {@link envelopeStep} or
 * {@link recordStep}; raw step creation elsewhere is forbidden and policed by
 * the Phase 1 module-boundary lint check.
 *
 * Each execution emits an envelope event:
 *   {stepId, role, file, round, attempt, started_at, ended_at, outcome,
 *    tokens, wall_clock_ms}
 *
 * `tokens` is REQUIRED (non-null) for model-calling roles (agent, review,
 * judgment) and null-as-not-applicable for non-model roles (commit, queue,
 * diff-capture, integration, record). A missing required token value is a
 * provenance failure, never zero.
 *
 * Phase 0(g) note: attribute writes are staged with a step's decision. Whether
 * they survive SIGKILL inside an uncompleted step is decided empirically in
 * Phase 0; the pre-decided fallback — persisting session-ID and envelope-start
 * writes via a preceding durable mini-step (role `record`) — is provided by
 * {@link recordStep} so 0(g)'s outcome cannot force a later redesign.
 */

import {
  AttributeMap,
  jsonCodec,
  StepList,
  Wait,
  gracefulComplete,
  goTo,
} from "@superdurable/dex";
import type { AsyncContext, Context, Step, StepDecision, StepOptions, Flow, StepClass } from "@superdurable/dex";
import { sessionFenceMap, type SessionFence } from "../../src/harness/opencode.js";

// ---------------------------------------------------------------------------
// Envelope event contract
// ---------------------------------------------------------------------------

export type EnvelopeRole =
  | "agent"
  | "review"
  | "judgment"
  | "commit"
  | "integration"
  | "queue"
  | "diff-capture"
  | "record";

export type EnvelopeOutcome = "skipped" | "redone" | "interrupted" | "completed";

export interface EnvelopeEvent {
  stepId: string;
  role: EnvelopeRole;
  /** Lease file key; null for flow-level steps. */
  file: string | null;
  round: number | null;
  /** One-based handler attempt from the dex Context (exit 0(f): SDK-exposed). */
  attempt: number;
  /** UTC ISO-8601 timestamps; cross-process ordering asserts UTC only. */
  started_at: string;
  ended_at: string | null;
  outcome: EnvelopeOutcome;
  /** Total tokens for model-calling roles; null = not applicable. */
  tokens: number | null;
  wall_clock_ms: number | null;
}

/** AttributeMap instance; flows must include it via persistenceAttributes(). */
export const envelopeEvents = new AttributeMap<EnvelopeEvent>(
  "envelope-event",
  jsonCodec<EnvelopeEvent>(),
);

/** Roles whose steps call a model: tokens are REQUIRED, never null. */
const MODEL_CALLING_ROLES: readonly EnvelopeRole[] = ["agent", "review", "judgment"];

export function requiresTokens(role: EnvelopeRole): boolean {
  return MODEL_CALLING_ROLES.includes(role);
}

/**
 * Persistence schema fragment that every flow must return from
 * getPersistenceSchema() so envelope events and session fences are durable.
 */
export function persistenceAttributes(): [
  AttributeMap<EnvelopeEvent>,
  AttributeMap<SessionFence>,
] {
  return [envelopeEvents, sessionFenceMap];
}

// ---------------------------------------------------------------------------
// envelopeStep — the single wrapped step factory
// ---------------------------------------------------------------------------

export interface EnvelopeSpec<I, O> {
  /** Unique durable Step type (protocol name). */
  stepType: string;
  /** Envelope step identity used as the event key prefix. */
  stepId: string;
  role: EnvelopeRole;
  file?: string | undefined;
  round?: number | undefined;
  /**
   * Static dex Step options (heartbeats, retries, timeouts). When omitted the
   * server defaults apply, including the 60s heartbeat timeout.
   */
  stepOptions?: StepOptions | undefined;
  /**
   * Inner handler. Returns the step output plus the token count observed by
   * the model call (null for non-model work). Throwing triggers dex retry.
   */
  inner: (context: Context, input: I) => Promise<{ output: O; tokens: number | null; outcome?: EnvelopeOutcome }>;
  /**
   * Optional routing decision after a successful inner run. Defaults to
   * gracefulComplete(output). Chain with goTo(nextClass, input) for linear
   * flows; the final step of a flow uses the default.
   */
  route?: (context: Context, input: I, output: O) => StepDecision;
}

/**
 * Multi-minute steps are a Phase 0 exit (0c): dex fails an attempt when no
 * heartbeat arrives within `heartbeatTimeoutMs` (server default 60s; observed
 * live as `backendError: "Heartbeat"` retry loops). The envelope therefore
 * records heartbeats for the duration of the inner handler — long inner work
 * survives worker restarts with no per-step bookkeeping.
 */
const HEARTBEAT_INTERVAL_MS = 15_000;

function heartbeatLoop(context: AsyncContext, eventKey: string): { stop(): void } {
  const record = context.recordHeartbeat?.bind(context);
  if (typeof record !== "function") return { stop(): void {} };
  const timer = setInterval(() => {
    void Promise.resolve(record({ envelope: eventKey, atUtc: new Date().toISOString() })).catch(
      () => {},
    );
  }, HEARTBEAT_INTERVAL_MS);
  // A pending heartbeat timer must never keep the worker process alive.
  (timer as unknown as { unref?: () => void }).unref?.();
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}

async function executeEnvelope<I, O>(
  spec: EnvelopeSpec<I, O>,
  context: AsyncContext,
  input: I,
): Promise<StepDecision> {
  const startedMs = Date.now();
  const startedAt = new Date(startedMs).toISOString();
  const eventKey = `${spec.stepId}#${context.attempt}`;
  const attempt = context.attempt;

  const base: EnvelopeEvent = {
    stepId: spec.stepId,
    role: spec.role,
    file: spec.file ?? null,
    round: spec.round ?? null,
    attempt,
    started_at: startedAt,
    ended_at: null,
    outcome: "interrupted",
    tokens: null,
    wall_clock_ms: null,
  };
  // Staged with the decision; see the 0(g) note in the header.
  envelopeEvents.set(context, eventKey, base);

  const heartbeat = heartbeatLoop(context, eventKey);
  try {
    const { output, tokens, outcome } = await spec.inner(context, input);
    if (requiresTokens(spec.role) && tokens === null) {
      // Throw BEFORE staging a completed event: a model-calling step without
      // token usage is a provenance failure, never zero.
      throw new Error(
        `provenance failure: step ${spec.stepId} (role ${spec.role}) returned no token usage`,
      );
    }
    const endedMs = Date.now();
    envelopeEvents.set(context, eventKey, {
      ...base,
      ended_at: new Date(endedMs).toISOString(),
      outcome: outcome ?? "completed",
      tokens,
      wall_clock_ms: endedMs - startedMs,
    });
    if (spec.route !== undefined) return spec.route(context, input, output);
    return gracefulComplete(output);
  } finally {
    heartbeat.stop();
  }
}

/**
 * Wraps an inner handler in the envelope contract and returns a dex Step.
 * This is the only sanctioned way to produce a Step in the toolkit.
 */
export function envelopeStep<I, O>(spec: EnvelopeSpec<I, O>): Step<I> {
  return {
    getStepType(): string {
      return spec.stepType;
    },
    getStepOptions(): StepOptions | undefined {
      return spec.stepOptions;
    },
    waitFor(): Wait {
      return Wait.skipImmediately();
    },
    execute(context: Context, input: I): Promise<StepDecision> {
      return executeEnvelope(spec, context as AsyncContext, input);
    },
  };
}

/**
 * Class form of {@link envelopeStep}: dex step movement (goTo) identifies
 * steps by their runtime CLASS, so chained flows use this variant and route
 * with `goTo(NextStepClass, input)`. The returned constructor is concrete so
 * flows can instantiate it; it remains assignable to dex's StepClass.
 */
export function envelopeStepClass<I, O>(spec: EnvelopeSpec<I, O>): (new () => Step<I>) & StepClass<I> {
  return class EnvelopeStepClass implements Step<I> {
    getStepType(): string {
      return spec.stepType;
    }
    getStepOptions(): StepOptions | undefined {
      return spec.stepOptions;
    }
    waitFor(): Wait {
      return Wait.skipImmediately();
    }
    execute(context: Context, input: I): Promise<StepDecision> {
      return executeEnvelope(spec, context as AsyncContext, input);
    }
  };
}

// ---------------------------------------------------------------------------
// recordStep — durable mini-step (role `record`, pre-decided 0(g) fallback)
// ---------------------------------------------------------------------------

/**
 * A minimal durable step that only persists a record envelope with the given
 * payload events. Used to make session-ID (fence) and envelope-start writes
 * durable BEFORE the main step runs: the mini-step's decision lands
 * independently, so a SIGKILL inside the later step cannot erase the fence.
 */
export function recordStep(spec: {
  stepType: string;
  stepId: string;
  /** Session fence to persist before a dependent agent step runs. */
  fence?: Omit<SessionFence, "persistedAtUtc"> | undefined;
  /** Optional routing decision; defaults to gracefulComplete. */
  route?: (context: Context) => StepDecision;
}): Step<void> {
  return {
    getStepType(): string {
      return spec.stepType;
    },
    waitFor(): Wait {
      return Wait.skipImmediately();
    },
    execute(context: Context): StepDecision {
      const startedAt = new Date().toISOString();
      if (spec.fence !== undefined) {
        sessionFenceMap.set(context, spec.fence.label, {
          ...spec.fence,
          persistedAtUtc: startedAt,
        });
      }
      envelopeEvents.set(context, `${spec.stepId}#${context.attempt}`, {
        stepId: spec.stepId,
        role: "record",
        file: null,
        round: null,
        attempt: context.attempt,
        started_at: startedAt,
        ended_at: startedAt,
        outcome: "completed",
        tokens: null,
        wall_clock_ms: 0,
      });
      if (spec.route !== undefined) return spec.route(context);
      return gracefulComplete(undefined);
    },
  };
}

/** Class form of {@link recordStep} for chained flows. */
export function recordStepClass(spec: {
  stepType: string;
  stepId: string;
  fence?: Omit<SessionFence, "persistedAtUtc"> | undefined;
  route?: (context: Context) => StepDecision;
}): StepClass<void> {
  return class RecordStepClass implements Step<void> {
    getStepType(): string {
      return spec.stepType;
    }
    waitFor(): Wait {
      return Wait.skipImmediately();
    }
    execute(context: Context): StepDecision {
      const startedAt = new Date().toISOString();
      if (spec.fence !== undefined) {
        sessionFenceMap.set(context, spec.fence.label, {
          ...spec.fence,
          persistedAtUtc: startedAt,
        });
      }
      envelopeEvents.set(context, `${spec.stepId}#${context.attempt}`, {
        stepId: spec.stepId,
        role: "record",
        file: null,
        round: null,
        attempt: context.attempt,
        started_at: startedAt,
        ended_at: startedAt,
        outcome: "completed",
        tokens: null,
        wall_clock_ms: 0,
      });
      if (spec.route !== undefined) return spec.route(context);
      return gracefulComplete(undefined);
    }
  };
}

/** Convenience for chaining: startStep + otherSteps in registration order. */
export function stepListOf<I>(start: Step<I>, ...others: ReadonlyArray<Step<any>>): StepList<I> {
  return StepList.startStep(start).otherSteps(...others);
}

/** Type-only helper so flows can implement Flow<I> without importing dex. */
export type { Step, StepClass, StepList };
