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
  Stream,
  Wait,
  gracefulComplete,
  goTo,
} from "@superdurable/dex";
import type {
  AsyncContext,
  Context,
  Step,
  StepDecision,
  StepOptions,
  Flow,
  StepClass,
  Wait as DexWait,
} from "@superdurable/dex";
import {
  sessionFenceMap,
  type SessionFence,
} from "../../src/harness/opencode.js";
import type { TokenUsage } from "../../src/metrics/types.js";

// ---------------------------------------------------------------------------
// Envelope event contract
// ---------------------------------------------------------------------------

export type EnvelopeRole =
  | "agent"
  | "review"
  | "judgment"
  | "verdict-check"
  | "prioritize"
  | "commit"
  | "integration"
  | "queue"
  | "diff-capture"
  | "record";

export type EnvelopeOutcome =
  "skipped" | "redone" | "interrupted" | "completed";

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
  /**
   * Token TOTAL (number) or the full provider usage split (TokenUsage object,
   * wave-5 cost honesty: cache/reasoning split + USD cost) for model-calling
   * roles; null = not applicable. Consumers normalize via tokenTotalOf.
   */
  tokens: number | TokenUsage | null;
  wall_clock_ms: number | null;
  /** Per-target identity (sanitized file#round) appended to the event key. */
  identity: string | null;
}

/**
 * Event key for one envelope execution. M2: multi-target runs (one flow,
 * many file-rounds) collide on `stepId#attempt` alone — the identity
 * (sanitized file#round for per-file steps) keeps every execution's event
 * distinct. AttributeMap keys prohibit `/`; callers sanitize.
 */
export function envelopeEventKey(stepId: string, attempt: number, identity?: string): string {
  return identity !== undefined && identity !== ""
    ? `${stepId}#${attempt}@${identity}`
    : `${stepId}#${attempt}`;
}

/** AttributeMap instance; flows must include it via persistenceAttributes(). */
export const envelopeEvents = new AttributeMap<EnvelopeEvent>(
  "envelope-event",
  jsonCodec<EnvelopeEvent>(),
);

// ---------------------------------------------------------------------------
// Telemetry stream (US-002): best-effort mirror of every durable envelope
// write, consumed US-007-side (dashboard + watcher). Correctness paths never
// read the stream — the durable envelope-event attribute remains the only
// source of truth.
//
// DEVIATION (recorded per the US-002 spec, live-confirmed 2026-09-26): the
// publish does NOT use Context.writeStream from inside the step. dex's
// Registry forbids ONE Stream instance being registered by multiple Flow
// types (live probe: FlowDefinitionError "Stream events is registered by
// multiple Flows"), and the envelope factory's steps are SHARED across
// port.Project / port.File / probe.* while the step Context carries no flow
// type — so no single stream registration can serve the shared factory.
// Per the spec's fallback, publishing happens RUNNER-SIDE: the worker
// process configures a publisher (src/dex/client.ts Client.writeStream over
// its own registry, where exactly one flow type owns `envelopeStream`) and
// the factory hands it each durable event. With no publisher configured the
// hook is a no-op.
// ---------------------------------------------------------------------------

/** One message on the envelope telemetry stream. */
export interface EnvelopeStreamMessage {
  /** Topic: `port/<flowId>/events` (self-describing for stream consumers). */
  topic: string;
  /** Flow instance ID the event belongs to (the originating dex flow). */
  flowId: string;
  /** The durable envelope-event attribute key this message mirrors. */
  eventKey: string;
  /** The mirrored envelope event (same payload as the durable write). */
  event: EnvelopeEvent;
}

/**
 * Stream definition for the envelope telemetry. Registered in the persistence
 * schema of EXACTLY ONE flow type per registry (the runner chooses — the port
 * worker registers it on port.Project). Client.writeStream resolves the flow
 * type from this registration; per-instance keying is by flowId.
 */
export const envelopeStream = new Stream<EnvelopeStreamMessage>(
  "events",
  jsonCodec<EnvelopeStreamMessage>(),
  4 * 1024 * 1024, // ~4 MiB shared budget per flow instance
);

/**
 * Runner-side publisher contract. Implementations call the dex Client's
 * writeStream (see src/dex/client.ts startDexWorker / openDexClient) and MUST
 * swallow their own async failures; the hook below swallows sync failures.
 */
export type EnvelopeStreamPublisher = (message: EnvelopeStreamMessage) => void;

let envelopeStreamPublisher: EnvelopeStreamPublisher | undefined;

/** Installs (or removes) the runner-side stream publisher. Idempotent. */
export function configureEnvelopeStreamPublisher(
  publisher: EnvelopeStreamPublisher | undefined,
): void {
  envelopeStreamPublisher = publisher;
}

/**
 * The ONLY stream-publish call site in the toolkit. Emits one envelope event
 * onto the telemetry stream. EVERY call is try/catch-swallowed (and the
 * runner-side publisher swallows its own rejections): a telemetry outage
 * (no publisher, unregistered stream, server unreachable) must NEVER fail a
 * durable step — asserted by tests/turn-health.test.ts.
 */
function publishEnvelopeEvent(context: Context, eventKey: string, event: EnvelopeEvent): void {
  const emit = envelopeStreamPublisher;
  if (emit === undefined) return;
  const message: EnvelopeStreamMessage = {
    topic: `port/${context.flowId}/events`,
    flowId: context.flowId,
    eventKey,
    event,
  };
  try {
    // Promise.resolve also covers sync returns; the .catch swallows ASYNC
    // publisher failures so a rejected publish can never become an
    // unhandled rejection (or a step failure).
    void Promise.resolve(emit(message)).catch(() => {
      // Swallowed deliberately: telemetry is best-effort (US-002 spec).
    });
  } catch {
    // Swallowed deliberately: telemetry is best-effort (US-002 spec).
  }
}

/** Roles whose steps call a model: tokens are REQUIRED, never null. */
const MODEL_CALLING_ROLES: readonly EnvelopeRole[] = [
  "agent",
  "review",
  "judgment",
];

export function requiresTokens(role: EnvelopeRole): boolean {
  return MODEL_CALLING_ROLES.includes(role);
}

/**
 * Roles that sit at TypeSafe integration points but are CODE-ONLY in Phase 2
 * (naive verdict-check / naive prioritize): they call no model, so their
 * tokens are null-as-not-applicable. When Phase 3 swaps in Jev these steps
 * move to the model-calling `judgment` role and tokens become required.
 */
export const NAIVE_JUDGMENT_ROLES: readonly EnvelopeRole[] = ["verdict-check", "prioritize"];

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
   * Inner handler. Returns the step output plus the token usage observed by
   * the model call — a bare total (number) or the full provider split
   * (TokenUsage object; wave-5 cost honesty). null for non-model work.
   * Throwing triggers dex retry.
   */
  inner: (
    context: Context,
    input: I,
  ) => Promise<{ output: O; tokens: number | TokenUsage | null; outcome?: EnvelopeOutcome }>;
  /**
   * Optional routing decision after a successful inner run. Defaults to
   * gracefulComplete(output). Chain with goTo(nextClass, input) for linear
   * flows; the final step of a flow uses the default.
   */
  route?: (context: Context, input: I, output: O) => StepDecision;
  /**
   * M2: per-target identity for the event key (e.g. sanitized `file#round`
   * for per-file steps). Flow-level steps omit it. Called for the start
   * event (before inner) and the completion event with the same value.
   */
  identityOf?: (context: Context, input: I) => string;
  /**
   * Optional durable readiness conditions evaluated BEFORE execute (dex
   * `waitFor` handler) — e.g. `Wait.allOf(...SubFlow.run(child))` for the
   * v1.1 parallel wave join. Passed through unchanged; heartbeats apply to
   * inner work only.
   */
  waitFor?: (context: Context, input: I) => DexWait | Promise<DexWait>;
}

/**
 * Multi-minute steps are a Phase 0 exit (0c): dex fails an attempt when no
 * heartbeat arrives within `heartbeatTimeoutMs` (server default 60s; observed
 * live as `backendError: "Heartbeat"` retry loops). The envelope therefore
 * records heartbeats for the duration of the inner handler — long inner work
 * survives worker restarts with no per-step bookkeeping.
 */
const HEARTBEAT_INTERVAL_MS = 15_000;

function heartbeatLoop(
  context: AsyncContext,
  eventKey: string,
): { stop(): void } {
  const record = context.recordHeartbeat?.bind(context);
  if (typeof record !== "function") return { stop(): void {} };
  const timer = setInterval(() => {
    try {
      void Promise.resolve(
        record({ envelope: eventKey, atUtc: new Date().toISOString() }),
      ).catch(() => {});
    } catch {
      // dex's recordHeartbeat throws synchronously (not via rejection) once
      // the invocation is dead — this catch is the crash guard.
      clearInterval(timer);
    }
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
  const identity = spec.identityOf?.(context, input) ?? null;
  const eventKey = envelopeEventKey(spec.stepId, context.attempt, identity ?? undefined);
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
    identity,
  };
  // Staged with the decision; see the 0(g) note in the header.
  envelopeEvents.set(context, eventKey, base);
  publishEnvelopeEvent(context, eventKey, base);

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
    const completedEvent: EnvelopeEvent = {
      ...base,
      ended_at: new Date(endedMs).toISOString(),
      outcome: outcome ?? "completed",
      tokens,
      wall_clock_ms: endedMs - startedMs,
    };
    envelopeEvents.set(context, eventKey, completedEvent);
    publishEnvelopeEvent(context, eventKey, completedEvent);
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
/**
 * Annotated type for class-form envelope steps. Flows with routing CYCLES
 * (the per-file loop in flows/port-project.ts) must annotate their step
 * constants with this type — circular implicit inference through route
 * closures otherwise fails under noImplicitAny.
 */
export type EnvelopeStepClass<I> = (new () => Step<I>) & StepClass<I>;

export function envelopeStepClass<I, O>(
  spec: EnvelopeSpec<I, O>,
): EnvelopeStepClass<I> {
  return class EnvelopeStepClass implements Step<I> {
    getStepType(): string {
      return spec.stepType;
    }
    getStepOptions(): StepOptions | undefined {
      return spec.stepOptions;
    }
    waitFor(context: Context, input: I): Wait | Promise<Wait> {
      return spec.waitFor !== undefined
        ? spec.waitFor(context, input)
        : Wait.skipImmediately();
    }
    execute(context: Context, input: I): Promise<StepDecision> {
      return executeEnvelope(spec, context as AsyncContext, input);
    }
  };
}

// ---------------------------------------------------------------------------
// recordStep — durable mini-step (role `record`, pre-decided 0(g) fallback)
// ---------------------------------------------------------------------------

/** Shared writer for record-role mini-steps (fold m7: single code path). */
function writeRecordEvent(
  context: Context,
  stepId: string,
  attempt: number,
  identity?: string,
): void {
  const startedAt = new Date().toISOString();
  const eventKey = envelopeEventKey(stepId, attempt, identity);
  const recordEvent: EnvelopeEvent = {
    stepId,
    role: "record",
    file: null,
    round: null,
    attempt,
    started_at: startedAt,
    ended_at: startedAt,
    outcome: "completed",
    tokens: null,
    wall_clock_ms: 0,
    identity: identity ?? null,
  };
  envelopeEvents.set(context, eventKey, recordEvent);
  publishEnvelopeEvent(context, eventKey, recordEvent);
}

function writeFence(context: Context, fence: Omit<SessionFence, "persistedAtUtc"> | undefined): void {
  if (fence === undefined) return;
  sessionFenceMap.set(context, fence.label, {
    ...fence,
    persistedAtUtc: new Date().toISOString(),
  });
}

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
  /** Optional per-target identity for the event key. */
  identity?: string | undefined;
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
      writeFence(context, spec.fence);
      writeRecordEvent(context, spec.stepId, context.attempt, spec.identity);
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
  identity?: string | undefined;
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
      writeFence(context, spec.fence);
      writeRecordEvent(context, spec.stepId, context.attempt, spec.identity);
      if (spec.route !== undefined) return spec.route(context);
      return gracefulComplete(undefined);
    }
  };
}

// ---------------------------------------------------------------------------
// envelopeStartMarker — durable PRE-start record for model-calling steps (M4)
// ---------------------------------------------------------------------------

/**
 * A record-role mini-step inserted BEFORE a model-calling step that persists
 * a durable "step started" marker (attempt 0, outcome `interrupted`,
 * `ended_at` null). 0(g) finding: the envelope's own start event is staged
 * with the step's decision, so a SIGKILL inside the step leaves NO envelope —
 * an AC1 evidence hole. The marker's decision lands INDEPENDENTLY, so every
 * model-calling execution is provable even when killed mid-turn.
 *
 * Markers use attempt 0 and role `record` semantics so Phase 5's AC2
 * provenance pass can exclude them from token totals while still joining
 * them to the target step's real envelopes by (stepId, identity).
 */
export interface StartMarkerSpec<I> {
  /** The mini-step's own durable Step type. */
  stepType: string;
  /** stepId of the model-calling step this marker precedes. */
  targetStepId: string;
  /** The target step's role (recorded on the marker for joining). */
  role: EnvelopeRole;
  identityOf?: (context: Context, input: I) => string;
  /**
   * Static step options — REQUIRED when identityOf reads durable attributes
   * (declare the loads; dex freezes step options at startFlow, so an
   * identityOf that needs a map MUST declare it from the start).
   */
  stepOptions?: StepOptions | undefined;
  route: (input: I) => StepDecision;
}

export function envelopeStartMarker<I>(spec: StartMarkerSpec<I>): EnvelopeStepClass<I> {
  return envelopeStepClass<I, I>({
    stepType: spec.stepType,
    stepId: `${spec.targetStepId}:start`,
    role: "record",
    ...(spec.identityOf !== undefined ? { identityOf: spec.identityOf } : {}),
    ...(spec.stepOptions !== undefined ? { stepOptions: spec.stepOptions } : {}),
    inner: async (ctx, input) => {
      const identity = spec.identityOf?.(ctx, input) ?? null;
      const startedAt = new Date().toISOString();
      const markerKey = `${envelopeEventKey(spec.targetStepId, 0, identity ?? undefined)}@start`;
      const markerEvent: EnvelopeEvent = {
        stepId: spec.targetStepId,
        role: spec.role,
        file: null,
        round: null,
        attempt: 0,
        started_at: startedAt,
        ended_at: null,
        outcome: "interrupted",
        tokens: null,
        wall_clock_ms: null,
        identity,
      };
      envelopeEvents.set(ctx, markerKey, markerEvent);
      publishEnvelopeEvent(ctx, markerKey, markerEvent);
      return { output: input, tokens: null };
    },
    route: (_ctx, input) => spec.route(input),
  });
}

/** Convenience for chaining: startStep + otherSteps in registration order. */
export function stepListOf<I>(
  start: Step<I>,
  ...others: ReadonlyArray<Step<any>>
): StepList<I> {
  return StepList.startStep(start).otherSteps(...others);
}

/** Type-only helper so flows can implement Flow<I> without importing dex. */
export type { Step, StepClass, StepList };
