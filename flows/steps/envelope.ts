/**
 * The ONLY step factory in the toolkit (plan §Metrics event contract).
 * Every durable step is created through {@link envelopeStepClass} (or its
 * start-marker form {@link envelopeStartMarker}); raw step creation elsewhere
 * is forbidden and policed by the Phase 1 module-boundary lint check.
 *
 * Each execution emits an envelope event:
 *   {stepId, role, file, round, attempt, started_at, ended_at, outcome,
 *    tokens, wall_clock_ms}
 *
 * `tokens` is REQUIRED (non-null) for model-calling roles (agent, review,
 * judgment) and null-as-not-applicable for non-model roles (commit, queue,
 * diff-capture, integration, record, and the verdict-check / prioritize
 * roles, whose live Jev spend is reported via pp-jev-usage, not the
 * envelope — see {@link requiresTokens}). A missing required token value is a
 * provenance failure, never zero.
 *
 * Phase 0(g) note: attribute writes are staged with a step's decision. Staged
 * writes inside an uncompleted step do NOT survive a SIGKILL, so the
 * envelope-start write that must survive is made by a preceding durable
 * mini-step: {@link envelopeStartMarker}.
 */

import {
  AttributeMap,
  DexServiceError,
  jsonCodec,
  Stream,
  Wait,
  gracefulComplete,
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
import {
  isModelCallingRole,
  type EnvelopeEvent,
  type EnvelopeOutcome,
  type EnvelopeRole,
  type TokenUsage,
  type TurnDiagnosis,
} from "../../src/metrics/types.js";

// ---------------------------------------------------------------------------
// Envelope event contract
// ---------------------------------------------------------------------------

// The contract types (role, outcome, event) are defined once, in
// src/metrics/types.ts, which the renderer and the dashboard also read; the
// flow re-exports them so flow-side imports keep one module.
export type { EnvelopeEvent, EnvelopeOutcome, EnvelopeRole };

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
 * US-007 (dex-sdk review, DRIFT S): the telemetry swallow is BOUNDED, not
 * unconditional. A DexServiceError is the EXPECTED best-effort outage shape
 * (stream store down, retention pressure) — swallowed silently per the
 * US-002 contract. Any other failure is a defect (codec, definition,
 * programming) and is logged sanitized (flowId/eventKey only, bounded
 * detail) at warn so it stays visible — but still swallowed, because a
 * telemetry mirror must never fail a durable step (US-002, test-asserted).
 */
function swallowPublishFailure(message: EnvelopeStreamMessage, err: unknown): void {
  if (err instanceof DexServiceError) return;
  const detail = err instanceof Error ? (err.message.split("\n")[0] ?? "") : String(err);
  console.warn(
    `[envelope-stream] non-service publish failure (durable write unaffected): flow=${message.flowId} event=${message.eventKey}${detail === "" ? "" : `: ${detail.slice(0, 200)}`}`,
  );
}

/**
 * The ONLY stream-publish call site in the toolkit. Emits one envelope event
 * onto the telemetry stream. EVERY failure is bounded-swallowed (see
 * {@link swallowPublishFailure}; the runner-side publisher reports its own
 * rejections the same way): a telemetry outage (no publisher, unregistered
 * stream, server unreachable) must NEVER fail a durable step — asserted by
 * tests/turn-health.test.ts and tests/jev-wiring.test.ts.
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
    // Promise.resolve also covers sync returns; the .catch routes ASYNC
    // publisher failures through the bounded swallow so a rejected publish
    // can never become an unhandled rejection (or a step failure).
    void Promise.resolve(emit(message)).catch((err: unknown) =>
      swallowPublishFailure(message, err),
    );
  } catch (err) {
    swallowPublishFailure(message, err);
  }
}

/**
 * STREAM-ONLY turn-health diagnosis record (US-003, Stage 1b). Emits one
 * record-role event carrying the diagnosis through the SAME publish path as
 * every envelope write. Fired at an ambiguous-shape throw site, where the
 * assessment happens INSIDE a throwing attempt: 0(g) means staged writes
 * cannot persist, so the durable envelope-event store is deliberately NOT
 * written here — the DURABLE diagnosis is the successor attempt's re-record
 * (buildRetryContextDiagnosis) piggybacked on its completion envelope. The
 * stream copy is best-effort telemetry: same swallow contract as
 * publishEnvelopeEvent, and absent entirely when no publisher is configured.
 */
export function publishTurnDiagnosisEvent(context: Context, diagnosis: TurnDiagnosis): void {
  const eventKey = envelopeEventKey(TURN_HEALTH_STEP_ID, context.attempt, diagnosis.turn);
  const event: EnvelopeEvent = {
    stepId: TURN_HEALTH_STEP_ID,
    role: "record",
    file: null,
    round: null,
    attempt: context.attempt,
    started_at: diagnosis.recorded_at_utc,
    ended_at: diagnosis.recorded_at_utc,
    outcome: "completed",
    tokens: null,
    wall_clock_ms: 0,
    identity: diagnosis.turn,
    turn_diagnosis: diagnosis,
  };
  publishEnvelopeEvent(context, eventKey, event);
}

/**
 * Step id of the turn-health diagnosis record event (US-003). NOT a dex step:
 * the record exists on the TELEMETRY STREAM only when an assessment fires
 * inside a throwing attempt (0(g) — a throwing attempt cannot persist staged
 * writes), and DURABLY as the `turn_diagnosis` field piggybacked on the
 * successor attempt's completion envelope. Kept out of
 * src/metrics/dispatch-anchor.ts's step table on purpose: the stream event
 * never enters the durable attribute store, so AC2 anchoring never sees it.
 */
const TURN_HEALTH_STEP_ID = "pp-turn-health";

/**
 * Roles whose steps call a model: tokens are REQUIRED, never null
 * (MODEL_CALLING_ROLES, src/metrics/types.ts).
 *
 * The TypeSafe integration roles `verdict-check` and `prioritize` are NOT
 * model-calling: the naive defaults call no model, and their envelopes keep
 * `tokens: null` EVEN WHEN a live Jev client is configured. Their live Jev
 * spend, and that of vitest triage, is recorded in the write-only
 * `pp-jev-usage` attribute (flows/port/lane-b.ts recordJevUsage) and reported
 * separately by render-metrics as Jev (judgment) tokens; it is NOT part of the
 * envelope token totals, so `validateProvenance` cannot flag it.
 */
export function requiresTokens(role: EnvelopeRole): boolean {
  return isModelCallingRole(role);
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
// envelopeStepClass — the single wrapped step factory
// ---------------------------------------------------------------------------

export interface EnvelopeSpec<I, O> {
  /** Unique durable Step type (protocol name). */
  stepType: string;
  /** Envelope step identity used as the event key prefix. */
  stepId: string;
  role: EnvelopeRole;
  /**
   * Static dex Step options (heartbeats, retries, timeouts). When omitted the
   * server defaults apply, including the 60s heartbeat timeout.
   */
  stepOptions?: StepOptions | undefined;
  /**
   * Inner handler. Returns the step output plus the token usage observed by
   * the model call — a bare total (number) or the full provider split
   * (TokenUsage object; wave-5 cost honesty). null for non-model work.
   * Throwing triggers dex retry. `turnDiagnosis` (US-003) piggybacks a
   * turn-health record on THIS step's existing completion envelope write —
   * never a separate mini-step.
   */
  inner: (
    context: Context,
    input: I,
  ) => Promise<{
    output: O;
    tokens: number | TokenUsage | null;
    outcome?: EnvelopeOutcome;
    turnDiagnosis?: TurnDiagnosis | null;
  }>;
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
    // The target is identified by `identity` (file#round); file/round stay null.
    file: null,
    round: null,
    attempt,
    started_at: startedAt,
    ended_at: null,
    outcome: "interrupted",
    tokens: null,
    wall_clock_ms: null,
    identity,
    turn_diagnosis: null,
  };
  // Staged with the decision; see the 0(g) note in the header.
  envelopeEvents.set(context, eventKey, base);
  publishEnvelopeEvent(context, eventKey, base);

  const heartbeat = heartbeatLoop(context, eventKey);
  try {
    const { output, tokens, outcome, turnDiagnosis } = await spec.inner(context, input);
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
      // US-003 piggyback: the diagnosis rides THIS existing envelope write
      // (and its stream mirror) — never a separate mini-step.
      turn_diagnosis: turnDiagnosis ?? null,
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
 * What a class-form step was built from. The dispatch anchor's step table
 * (PORT_FLOW_STEPS in src/metrics/dispatch-anchor.ts) mirrors these triples by
 * hand, because the metrics layer never imports flow code; this registry lets
 * tests/mirror-drift.test.ts compare the mirror with the real flows. A start
 * marker records its TARGET step's stepId and role (its own envelope is
 * `<stepId>:start`, role record).
 */
export interface EnvelopeStepIdentity {
  stepType: string;
  stepId: string;
  role: EnvelopeRole;
  marker: boolean;
}

const stepIdentities = new WeakMap<object, EnvelopeStepIdentity>();

/** The identity a step INSTANCE's class was built with; undefined for a step not made by the class factories. */
export function envelopeStepIdentityOf(step: object): EnvelopeStepIdentity | undefined {
  return stepIdentities.get(step.constructor);
}

/** Every step a flow registers, by dex step type, with its recorded identity (undefined when not factory-made). */
export function registeredSteps(flow: Flow<any>): Map<string, EnvelopeStepIdentity | undefined> {
  const steps = new Map<string, EnvelopeStepIdentity | undefined>();
  for (const definition of flow.getSteps()) {
    steps.set(definition.step.getStepType(), envelopeStepIdentityOf(definition.step));
  }
  return steps;
}

/**
 * Annotated type for class-form envelope steps. Flows with routing CYCLES
 * (the per-file loop in flows/port/file-steps.ts and flows/port/project-steps.ts) must annotate their step
 * constants with this type — circular implicit inference through route
 * closures otherwise fails under noImplicitAny.
 */
export type EnvelopeStepClass<I> = (new () => Step<I>) & StepClass<I>;

/**
 * Wraps an inner handler in the envelope contract and returns a dex step
 * CLASS: dex step movement (goTo) identifies steps by their runtime class, so
 * chained flows route with `goTo(NextStepClass, input)`. The returned
 * constructor is concrete so flows can instantiate it; it remains assignable
 * to dex's StepClass. This is the only sanctioned way to produce a Step in
 * the toolkit.
 */
export function envelopeStepClass<I, O>(
  spec: EnvelopeSpec<I, O>,
): EnvelopeStepClass<I> {
  const stepClass = class EnvelopeStepClass implements Step<I> {
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
  stepIdentities.set(stepClass, {
    stepType: spec.stepType,
    stepId: spec.stepId,
    role: spec.role,
    marker: false,
  });
  return stepClass;
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
  const markerClass = envelopeStepClass<I, I>({
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
  // The factory recorded the marker's own envelope (`<target>:start`, record);
  // the identity a drift check wants is the target step it precedes.
  stepIdentities.set(markerClass, {
    stepType: spec.stepType,
    stepId: spec.targetStepId,
    role: spec.role,
    marker: true,
  });
  return markerClass;
}
