/**
 * Phase 5 — typed 1:N dispatch anchoring + provenance cross-check (AC2).
 *
 * Plan ("Metrics event contract"): every envelope step ID must appear as >= 1
 * dex dispatch entry of matching type; dispatch entries WITHOUT envelopes must
 * all be non-agent kinds (timer/condition/channel/record). Retries are the 1:N
 * case: one completed envelope (the final attempt) anchors N dispatch entries
 * whose max `finalAttempt` must equal the envelope attempt (0(f) verified the
 * live match: envelope `attempt` == dispatch `finalAttempt`).
 *
 * Input surfaces (both pure data — no I/O, no dex imports):
 * - the dex history JSON as emitted by the read-only dexcli surface
 *   (`dexcli flow history <id> -output json`; wire shapes modeled on
 *   src/dashboard/types.ts DexHistoryWire — the surface proven by exit 0(h)
 *   to expose stepType / stepExecutionId / finalAttempt);
 * - the envelope/verdict attribute view (src/metrics/types.ts EnvelopeEvent,
 *   the mirror of the live factory's durable events, M2 identity keying
 *   `stepId#attempt@file#round` and M4 attempt-0 start markers).
 *
 * The flow step table below mirrors flows/port-project.ts (stepType/stepId/
 * role triples) — duplicated deliberately so metrics never imports flow code
 * (same pattern as the dashboard's stageLabel/MODEL_ROLES mirrors). If the
 * flow adds or renames a step, update the table: drift is exactly what the
 * anchor is supposed to surface.
 */
import {
  type EnvelopeEvent,
  type EnvelopeRole,
  fileFromIdentity,
  identityKeyOf,
  isModelCallingRole,
  type ModelCallingRole,
} from "./types.js";

export { fileFromIdentity, identityKeyOf };

// ---------------------------------------------------------------------------
// dex history wire shapes (dexcli `flow history -output json` subset)
// ---------------------------------------------------------------------------

/** Input echo possibly carried by a dispatch event (FileRoundInput-shaped). */
export interface DispatchStepInputEcho {
  file?: unknown;
  round?: unknown;
  [key: string]: unknown;
}

/** One durable history event (subset of dashboard DexHistoryEventWire). */
export interface DispatchHistoryEvent {
  eventId?: string;
  eventTime?: string;
  type?: string;
  payload?: {
    /** FlowStartedOrContinued and other flow-level events. */
    initialStart?: Record<string, unknown> | null;
    context?: {
      stepExecutionId?: unknown;
      stepType?: unknown;
      finalAttempt?: unknown;
    } | null;
    input?: { stepInput?: DispatchStepInputEcho | null } | null;
    movement?: { stepInput?: DispatchStepInputEcho | null } | null;
  } | null;
}

/** dexcli history payload (subset of dashboard DexHistoryWire). */
export interface DispatchHistory {
  flowId?: string;
  runId?: string;
  events: DispatchHistoryEvent[];
}

/** One extracted dispatch entry (the plan's "dispatch log" row). */
export interface DispatchEntry {
  stepExecutionId: string;
  stepType: string;
  finalAttempt: number;
  /** Sanitized `file#round` when the input echo carries file+round; else null. */
  identity: string | null;
}

function stepInputOf(event: DispatchHistoryEvent): DispatchStepInputEcho | null {
  const fromInput = event.payload?.input?.stepInput;
  if (fromInput !== undefined && fromInput !== null && typeof fromInput === "object") {
    return fromInput;
  }
  const fromMovement = event.payload?.movement?.stepInput;
  if (fromMovement !== undefined && fromMovement !== null && typeof fromMovement === "object") {
    return fromMovement;
  }
  return null;
}

/**
 * Identity from a dispatch event's input echo: only when BOTH file (string)
 * and round (number) are present, sanitized exactly like the flow's
 * markerKeyOf. Anything else -> null (flow-level / not derivable).
 */
function identityFromEvent(event: DispatchHistoryEvent): string | null {
  const echo = stepInputOf(event);
  if (echo === null) return null;
  const { file, round } = echo;
  if (typeof file === "string" && typeof round === "number" && file.length > 0) {
    return identityKeyOf(file, round);
  }
  return null;
}

/**
 * Extract dispatch entries from a dexcli history payload. Events without a
 * `payload.context.stepType` are not step dispatches (flow-level events) and
 * are skipped. A missing finalAttempt defaults to 1 (dex always reports it
 * per 0(h); the default keeps hand-made fixtures honest).
 *
 * One step execution emits SEVERAL history events (started / execute
 * completed / waitFor ...) carrying the same context, so events are deduped
 * per (stepType, stepExecutionId, finalAttempt): an entry is one execution
 * ATTEMPT, never one event. Retries stay distinct (different finalAttempt or
 * execution id). Events without a stepExecutionId cannot be deduped and each
 * count. When duplicates disagree on identity the one that carries the file
 * +round input echo wins.
 */
export function extractDispatchEntries(history: DispatchHistory): DispatchEntry[] {
  const entries: DispatchEntry[] = [];
  const seen = new Map<string, DispatchEntry>();
  for (const event of history.events) {
    const context = event.payload?.context;
    if (context === undefined || context === null) continue;
    const stepType = context.stepType;
    if (typeof stepType !== "string" || stepType.length === 0) continue;
    const stepExecutionId = typeof context.stepExecutionId === "string" ? context.stepExecutionId : "";
    const finalAttempt = context.finalAttempt;
    const entry: DispatchEntry = {
      stepExecutionId,
      stepType,
      finalAttempt: typeof finalAttempt === "number" && Number.isInteger(finalAttempt) && finalAttempt >= 1 ? finalAttempt : 1,
      identity: identityFromEvent(event),
    };
    if (stepExecutionId === "") {
      entries.push(entry);
      continue;
    }
    const key = `${stepType}\u0000${stepExecutionId}\u0000${entry.finalAttempt}`;
    const existing = seen.get(key);
    if (existing === undefined) {
      seen.set(key, entry);
      entries.push(entry);
    } else if (existing.identity === null && entry.identity !== null) {
      existing.identity = entry.identity;
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Typed step table (mirror of flows/port-project.ts — no flow imports)
// ---------------------------------------------------------------------------

/** What kind of envelope a flow step's dispatch MUST anchor to. */
export type PortStepKind = "model" | "support" | "marker";

export interface PortStepSpec {
  stepType: string;
  stepId: string;
  role: EnvelopeRole;
  kind: PortStepKind;
  /**
   * Live shape (worker-1c, first full-run reconciliation): an M4 start
   * mini-step ALSO writes its own envelope-factory record under stepId
   * `<targetStepId>:start` (role "record", real attempt) — in addition to the
   * attempt-0 marker it stages for the TARGET step. That self-envelope must
   * anchor to the mini-step's dispatch entries like any other envelope.
   */
  selfStepId?: string;
}

/**
 * All steps of the v1 flow. `marker` entries are the M4 record mini-steps:
 * their dispatch entries anchor to the attempt-0 start-marker envelope of
 * the TARGET step (same stepId/role, attempt 0).
 */
export const PORT_FLOW_STEPS: readonly PortStepSpec[] = [
  // Phase 3 (prep-analysis) — maintained by worker-1b per the mirror rule.
  { stepType: "PpSymbolStart", stepId: "pp-symbol-table", role: "judgment", kind: "marker", selfStepId: "pp-symbol-table:start" },
  { stepType: "PpSymbolTable", stepId: "pp-symbol-table", role: "judgment", kind: "model" },
  { stepType: "PpPrepGenerateStart", stepId: "pp-prep-generate", role: "agent", kind: "marker", selfStepId: "pp-prep-generate:start" },
  { stepType: "PpPrepGenerate", stepId: "pp-prep-generate", role: "agent", kind: "model" },
  { stepType: "PpPrepDiffCapture", stepId: "pp-prep-diff-capture", role: "diff-capture", kind: "support" },
  { stepType: "PpPrepReviewAStart", stepId: "pp-prep-review-a", role: "review", kind: "marker", selfStepId: "pp-prep-review-a:start" },
  { stepType: "PpPrepReviewA", stepId: "pp-prep-review-a", role: "review", kind: "model" },
  { stepType: "PpPrepReviewBStart", stepId: "pp-prep-review-b", role: "review", kind: "marker", selfStepId: "pp-prep-review-b:start" },
  { stepType: "PpPrepReviewB", stepId: "pp-prep-review-b", role: "review", kind: "model" },
  { stepType: "PpPrepVerdictCheck", stepId: "pp-prep-verdict-check", role: "verdict-check", kind: "support" },
  { stepType: "PpPrepLoopDecision", stepId: "pp-prep-loop-decision", role: "record", kind: "support" },
  { stepType: "PpPrepReviseStart", stepId: "pp-prep-revise", role: "agent", kind: "marker", selfStepId: "pp-prep-revise:start" },
  { stepType: "PpPrepRevise", stepId: "pp-prep-revise", role: "agent", kind: "model" },
  { stepType: "PpPrepFinalize", stepId: "pp-prep-finalize", role: "record", kind: "support" },
  { stepType: "PpPrep", stepId: "pp-prep", role: "record", kind: "support" },
  { stepType: "PpDispatch", stepId: "pp-dispatch", role: "record", kind: "support" },
  { stepType: "PpLease", stepId: "pp-lease", role: "record", kind: "support" },
  { stepType: "PpFence", stepId: "pp-fence", role: "record", kind: "support" },
  { stepType: "PpImplementStart", stepId: "pp-implement", role: "agent", kind: "marker", selfStepId: "pp-implement:start" },
  { stepType: "PpImplement", stepId: "pp-implement", role: "agent", kind: "model" },
  { stepType: "PpCaptureDiff", stepId: "pp-capture-diff", role: "diff-capture", kind: "support" },
  { stepType: "PpReviewAStart", stepId: "pp-review-a", role: "review", kind: "marker", selfStepId: "pp-review-a:start" },
  { stepType: "PpReviewA", stepId: "pp-review-a", role: "review", kind: "model" },
  { stepType: "PpReviewBStart", stepId: "pp-review-b", role: "review", kind: "marker", selfStepId: "pp-review-b:start" },
  { stepType: "PpReviewB", stepId: "pp-review-b", role: "review", kind: "model" },
  { stepType: "PpVerdictCheck", stepId: "pp-verdict-check", role: "verdict-check", kind: "support" },
  { stepType: "PpPrioritize", stepId: "pp-prioritize", role: "prioritize", kind: "support" },
  { stepType: "PpFixerStart", stepId: "pp-fixer", role: "agent", kind: "marker", selfStepId: "pp-fixer:start" },
  { stepType: "PpFixer", stepId: "pp-fixer", role: "agent", kind: "model" },
  { stepType: "PpCommit", stepId: "pp-commit", role: "commit", kind: "support" },
  { stepType: "PpIntegrate", stepId: "pp-integrate", role: "integration", kind: "support" },
  // US-010: integration bootstrap (vitest runner provisioning; flows/
  // port-project.ts BootstrapStep). Non-model, flow-level ("bootstrap").
  { stepType: "PpBootstrap", stepId: "pp-bootstrap", role: "integration", kind: "support" },
  { stepType: "PpRelease", stepId: "pp-release", role: "record", kind: "support" },
  // Phase 4 (verification queues + fix rounds) — maintained by worker-1b.
  { stepType: "PpQueueVerify", stepId: "pp-queue-verify", role: "queue", kind: "support" },
  { stepType: "PpQueueFixStart", stepId: "pp-queue-fix", role: "agent", kind: "marker", selfStepId: "pp-queue-fix:start" },
  { stepType: "PpQueueFix", stepId: "pp-queue-fix", role: "agent", kind: "model" },
  { stepType: "PpFinal", stepId: "pp-final", role: "record", kind: "support" },
  // v1.1 parallel dispatch (worker-1c): the parent runs waves of per-file
  // SubFlow children (port.File). The child reuses the SAME step types
  // (PpLease→…→PpCommit→PpChildRelease) inside its OWN flow, so per-flow
  // anchoring works unchanged; only the wave orchestration + child bookkeeping
  // steps are new.
  { stepType: "PpWaveDispatch", stepId: "pp-wave-dispatch", role: "record", kind: "support" },
  { stepType: "PpWaveJoin", stepId: "pp-wave-join", role: "record", kind: "support" },
  { stepType: "PpChildLease", stepId: "pp-child-lease", role: "record", kind: "support" },
  { stepType: "PpChildRelease", stepId: "pp-child-release", role: "record", kind: "support" },
];

/**
 * Dex-level non-agent dispatch kinds that legitimately carry no envelope
 * (plan: "dispatch entries without envelopes must all be non-agent kinds").
 */
export const NON_AGENT_DEX_KINDS: readonly string[] = ["timer", "condition", "channel", "record"];

const SPEC_BY_STEP_TYPE = new Map(PORT_FLOW_STEPS.map((s) => [s.stepType, s]));

/** The flow spec for a dex step type, or null when the type is unknown. */
export function specForStepType(stepType: string): PortStepSpec | null {
  return SPEC_BY_STEP_TYPE.get(stepType) ?? null;
}

/** All flow specs sharing a step id (a model step and its M4 marker), including marker self-envelope ids. */
export function specsForStepId(stepId: string): PortStepSpec[] {
  return PORT_FLOW_STEPS.filter((s) => s.stepId === stepId || s.selfStepId === stepId);
}

/** True when the step type is a known dex non-agent kind (case-insensitive). */
export function isNonAgentDexKind(stepType: string): boolean {
  return NON_AGENT_DEX_KINDS.includes(stepType.toLowerCase());
}

/**
 * Classify a dispatch entry's step type for the anchor.
 * "flow-step" -> envelope-carrying (needs its envelope/marker);
 * "non-agent" -> allowed without an envelope (dex kinds);
 * "unknown"   -> unexplained (anchor failure).
 */
export function classifyDispatchStepType(stepType: string): "flow-step" | "non-agent" | "unknown" {
  if (SPEC_BY_STEP_TYPE.has(stepType)) return "flow-step";
  if (isNonAgentDexKind(stepType)) return "non-agent";
  return "unknown";
}

// ---------------------------------------------------------------------------
// Anchoring
// ---------------------------------------------------------------------------

export interface AnchorOptions {
  /**
   * Require an attempt-0 start-marker envelope for every model-calling
   * envelope (M4 guarantees the marker precedes all 4 model-calling steps).
   * Default true.
   */
  requireStartMarkers?: boolean;
}

export interface DispatchAnchorGroup {
  stepType: string;
  identity: string | null;
  kind: PortStepKind;
  /** Max envelope attempt joined to this group (null = no envelope). */
  envelope_attempt: number | null;
  /** Max finalAttempt across the group's dispatch entries (null = none). */
  dispatch_final_attempt: number | null;
  dispatch_count: number;
  ok: boolean;
}

export interface DispatchAnchorResult {
  ok: boolean;
  /** Deterministic, sorted, human-readable failures. */
  failures: string[];
  /** Envelope events (real attempts + markers) joined to >= 1 dispatch entry. */
  envelopes_anchored: number;
  dispatch_entries_total: number;
  non_agent_dispatch_entries: number;
  unexplained_dispatch_entries: number;
  /** Model-calling envelopes missing their M4 attempt-0 start marker. */
  model_steps_missing_start_marker: number;
  groups: DispatchAnchorGroup[];
}

interface EntryGroup {
  spec: PortStepSpec;
  identity: string | null;
  maxFinalAttempt: number | null;
  count: number;
}

function groupKey(stepType: string, identity: string | null): string {
  return `${stepType}@@${identity ?? ""}`;
}

function identityDisplay(identity: string | null): string {
  return identity ?? "<flow-level>";
}

/**
 * Core typed 1:N anchor. Pure over (envelopes, entries).
 *
 * Directions enforced per (stepType, identity) group:
 * 1. envelope -> dispatch: every envelope (real attempt or M4 marker) must
 *    join >= 1 dispatch entry of its expected step type (exact identity, or a
 *    flow-level entry that cannot be refuted);
 * 2. dispatch -> envelope: every flow-step/marker dispatch group must be
 *    anchored by an envelope, and the max envelope attempt must EQUAL the max
 *    dispatch finalAttempt (1 envelope : N retry dispatch entries);
 * 3. unknown step types fail; non-agent dex kinds are allowed envelope-less;
 * 4. model-calling envelopes must have their attempt-0 start marker (when
 *    requireStartMarkers, default on).
 */
export function anchorDispatch(
  envelopes: readonly EnvelopeEvent[],
  entries: readonly DispatchEntry[],
  options: AnchorOptions = {},
): DispatchAnchorResult {
  const requireStartMarkers = options.requireStartMarkers ?? true;
  const failures: string[] = [];

  // ---- classify + group dispatch entries ---------------------------------
  const entryGroups = new Map<string, EntryGroup>();
  let nonAgentCount = 0;
  let unexplainedCount = 0;
  for (const entry of entries) {
    const kind = classifyDispatchStepType(entry.stepType);
    if (kind === "non-agent") {
      nonAgentCount++;
      continue;
    }
    if (kind === "unknown") {
      unexplainedCount++;
      failures.push(
        `unexplained dispatch entry of type "${entry.stepType}" (not a known port-flow step type and not a non-agent dex kind)`,
      );
      continue;
    }
    const spec = specForStepType(entry.stepType);
    if (spec === null) continue; // unreachable by classification
    const key = groupKey(entry.stepType, entry.identity);
    const group = entryGroups.get(key);
    if (group === undefined) {
      entryGroups.set(key, {
        spec,
        identity: entry.identity,
        maxFinalAttempt: entry.finalAttempt,
        count: 1,
      });
    } else {
      group.count += 1;
      group.maxFinalAttempt = Math.max(group.maxFinalAttempt ?? entry.finalAttempt, entry.finalAttempt);
    }
  }

  // ---- group envelopes by expected step type + identity -------------------
  interface EnvelopeGroup {
    spec: PortStepSpec;
    identity: string | null;
    maxAttempt: number | null;
    count: number;
    anchored: boolean;
  }
  const envelopeGroups = new Map<string, EnvelopeGroup>();
  let anchoredEnvelopes = 0;
  let missingMarkerCount = 0;
  const markersChecked = new Set<string>();

  for (const env of envelopes) {
    const specs = specsForStepId(env.stepId);
    if (specs.length === 0) {
      failures.push(
        `envelope ${env.stepId}#${env.attempt} does not match any known port-flow step type mapping`,
      );
      continue;
    }
    const isMarker = env.attempt === 0;
    // The start mini-step's own envelope (`<target>:start`, role record, real
    // attempt) anchors under its marker spec: the dispatch entry IS the same
    // step execution that staged the attempt-0 marker.
    const selfSpec = !isMarker ? specs.find((s) => s.selfStepId === env.stepId) : undefined;
    const spec = selfSpec ?? specs.find((s) => (isMarker ? s.kind === "marker" : s.kind !== "marker"));
    if (spec === undefined) {
      failures.push(
        isMarker
          ? `envelope ${env.stepId}#${env.attempt} is a start marker but flow spec has no marker step for it`
          : `envelope ${env.stepId}#${env.attempt} has no non-marker flow spec`,
      );
      continue;
    }
    // The self-envelope carries role "record" by design (marker specs carry
    // the TARGET role) — role equality applies only to non-self envelopes.
    if (spec.role !== env.role && selfSpec === undefined) {
      failures.push(
        `envelope ${env.stepId}#${env.attempt} role "${env.role}" does not match flow spec role "${spec.role}"`,
      );
      continue;
    }

    const key = groupKey(spec.stepType, env.identity);
    const group = envelopeGroups.get(key);
    if (group === undefined) {
      envelopeGroups.set(key, {
        spec,
        identity: env.identity,
        maxAttempt: env.attempt,
        count: 1,
        anchored: false,
      });
    } else {
      group.count += 1;
      group.maxAttempt = Math.max(group.maxAttempt ?? env.attempt, env.attempt);
    }

    // M4: every model-calling real attempt needs its attempt-0 start marker
    // (checked once per stepId+identity; the answer is key-determined).
    if (requireStartMarkers && spec.kind === "model" && isModelCallingRole(env.role)) {
      const markerKey = `${env.stepId}@@${env.identity ?? ""}`;
      if (!markersChecked.has(markerKey)) {
        markersChecked.add(markerKey);
        // cx-5e: a flow-keyed completion envelope accepts an identity-bearing
        // marker of the same step (the marker carries the file#round the
        // envelope lacks).
        const hasMarker = envelopes.some(
          (m) =>
            m.stepId === env.stepId &&
            m.attempt === 0 &&
            (env.identity === null ? true : m.identity === env.identity),
        );
        if (!hasMarker) {
          missingMarkerCount++;
          failures.push(
            `model step ${env.stepId} (${identityDisplay(env.identity)}) has no attempt-0 start marker`,
          );
        }
      }
    }
  }

  // ---- envelope -> dispatch direction -------------------------------------
  for (const [key, envGroup] of envelopeGroups.entries()) {
    const exact = entryGroups.get(key);
    const flowLevel =
      envGroup.identity !== null ? entryGroups.get(groupKey(envGroup.spec.stepType, null)) : undefined;
    // cx-5e accommodation: some per-file steps wrote FLOW-KEYED completion
    // envelopes (identity null) while their dispatch entries carry file#round
    // (ChildLease / queue-fix before identityOf was added). A flow-keyed
    // envelope anchors against ANY dispatch entry of the same type — the
    // reverse direction below still proves every entry individually.
    const sameTypeAnyIdentity =
      envGroup.identity === null && exact === undefined && flowLevel === undefined
        ? [...entryGroups.values()].find((g) => g.spec.stepType === envGroup.spec.stepType)
        : undefined;
    if (exact === undefined && flowLevel === undefined && sameTypeAnyIdentity === undefined) {
      failures.push(
        `envelope ${envGroup.spec.stepId} (${identityDisplay(envGroup.identity)}) has no dispatch entry of type ${envGroup.spec.stepType}`,
      );
      continue;
    }
    envGroup.anchored = true;
    anchoredEnvelopes += envGroup.count;
  }

  // ---- dispatch -> envelope direction + attempt equality ------------------
  const groups: DispatchAnchorGroup[] = [];
  for (const [key, entryGroup] of entryGroups) {
    const exactEnv = envelopeGroups.get(key);
    let envelopeAttempt = exactEnv?.maxAttempt ?? null;
    if (envelopeAttempt === null && entryGroup.identity !== null) {
      // cx-5e accommodation (reverse of the flow-keyed join above): an entry
      // whose completion envelope was written flow-keyed anchors through
      // (a) SUPPORT steps (ChildLease/ChildRelease run once per child flow,
      //     the type-matched flow-keyed envelope proves the execution), or
      // (b) MODEL steps whose identity-bearing attempt-0 start marker exists
      //     (the marker proves the file#round; the flow-keyed completion
      //     envelope proves the attempt).
      const flowKeyed = envelopeGroups.get(groupKey(entryGroup.spec.stepType, null));
      if (flowKeyed !== undefined && entryGroup.spec.kind === "support") {
        envelopeAttempt = flowKeyed.maxAttempt;
      } else if (flowKeyed !== undefined && entryGroup.spec.kind === "model") {
        const markerProvesIdentity = [...envelopeGroups.values()].some(
          (g) =>
            g.spec.kind === "marker" &&
            g.spec.stepId === entryGroup.spec.stepId &&
            g.identity === entryGroup.identity,
        );
        if (markerProvesIdentity) envelopeAttempt = flowKeyed.maxAttempt;
      }
    }
    if (envelopeAttempt === null && entryGroup.identity === null) {
      // Flow-level dispatch entry (input echo without file/round): ANY
      // envelope of this step type anchors it — the echo loss means identity
      // cannot be refuted either.
      let best: number | null = null;
      for (const envGroup of envelopeGroups.values()) {
        if (envGroup.spec.stepType === entryGroup.spec.stepType && envGroup.maxAttempt !== null) {
          best = best === null ? envGroup.maxAttempt : Math.max(best, envGroup.maxAttempt);
        }
      }
      envelopeAttempt = best;
    }

    let ok = true;
    if (entryGroup.spec.kind === "marker") {
      // Markers dispatch once but their ENVELOPE is attempt 0 by design (M4):
      // presence is the only requirement; attempt equality does not apply.
      if (envelopeAttempt === null) {
        ok = false;
        failures.push(
          `dispatch entry(ies) of type ${entryGroup.spec.stepType} (${identityDisplay(entryGroup.identity)}) with no matching attempt-0 start-marker envelope`,
        );
      }
    } else if (envelopeAttempt === null) {
      ok = false;
      failures.push(
        `dispatch entry(ies) of type ${entryGroup.spec.stepType} (${identityDisplay(entryGroup.identity)}) reached finalAttempt ${entryGroup.maxFinalAttempt ?? "?"} with no matching envelope`,
      );
    } else if (entryGroup.maxFinalAttempt !== null && envelopeAttempt > entryGroup.maxFinalAttempt) {
      ok = false;
      failures.push(
        `envelope ${entryGroup.spec.stepId} (${identityDisplay(entryGroup.identity)}) attempt ${envelopeAttempt} exceeds max dispatched finalAttempt ${entryGroup.maxFinalAttempt} for type ${entryGroup.spec.stepType}`,
      );
    } else if (entryGroup.maxFinalAttempt !== null && envelopeAttempt < entryGroup.maxFinalAttempt) {
      ok = false;
      failures.push(
        `dispatch entry(ies) of type ${entryGroup.spec.stepType} (${identityDisplay(entryGroup.identity)}) reached finalAttempt ${entryGroup.maxFinalAttempt} beyond envelope attempt ${envelopeAttempt} (dispatch without envelope)`,
      );
    }
    groups.push({
      stepType: entryGroup.spec.stepType,
      identity: entryGroup.identity,
      kind: entryGroup.spec.kind,
      envelope_attempt: envelopeAttempt,
      dispatch_final_attempt: entryGroup.maxFinalAttempt,
      dispatch_count: entryGroup.count,
      ok,
    });
  }

  failures.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  groups.sort((a, b) => {
    if (a.stepType !== b.stepType) return a.stepType < b.stepType ? -1 : 1;
    return identityDisplay(a.identity) < identityDisplay(b.identity) ? -1 : 1;
  });

  return {
    ok: failures.length === 0,
    failures,
    envelopes_anchored: anchoredEnvelopes,
    dispatch_entries_total: entries.length,
    non_agent_dispatch_entries: nonAgentCount,
    unexplained_dispatch_entries: unexplainedCount,
    model_steps_missing_start_marker: missingMarkerCount,
    groups,
  };
}

// ---------------------------------------------------------------------------
// Integration entry (AC2 cross-check)
// ---------------------------------------------------------------------------

/** Combined AC2 cross-check result: envelope provenance + dispatch anchor. */
export interface ProvenanceCrossCheck {
  ok: boolean;
  /** Envelope-internal provenance failures + dispatch anchoring failures. */
  failures: string[];
  anchor: DispatchAnchorResult;
}

/**
 * Phase 5 / Phase 7 evidence-run entry point.
 *
 * @param historyJson - the dexcli JSON payload (`dexcli flow history <flowId>
 *   -output json`; a DexHistoryWire-shaped object). Structurally compatible
 *   with src/dashboard/types.ts.
 * @param envelopes - the envelope-event attribute view (the durable
 *   envelope-event attribute values, src/metrics/types.ts EnvelopeEvent).
 * @param options - `requireStartMarkers` (default true) enforces M4 markers
 *   on model-calling envelopes.
 * @returns combined cross-check: `ok` is true only when the envelope stream
 *   passes provenance validation AND the typed 1:N dispatch mapping holds.
 *
 * Example (worker-1b evidence run):
 * ```ts
 * const history = JSON.parse(await dexHistoryJson); // dexcli -output json
 * const cross = anchorForRun(history, envelopeEventValues);
 * if (!cross.ok) recordProvenanceFailure(cross.failures);
 * ```
 */
export function anchorForRun(
  historyJson: DispatchHistory,
  envelopes: readonly EnvelopeEvent[],
  options: AnchorOptions = {},
): ProvenanceCrossCheck {
  const entries = extractDispatchEntries(historyJson);
  const anchor = anchorDispatch(envelopes, entries, options);
  return { ok: anchor.ok, failures: anchor.failures, anchor };
}
