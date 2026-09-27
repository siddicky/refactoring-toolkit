/**
 * Dashboard wire + view types.
 *
 * Wire types mirror the JSON shapes returned by the read-only `dexcli` surface
 * (`flow search` / `flow state` / `flow history -output json`) as observed
 * against dex 0.13.5 (see BUILD_NOTES.md, exit 0(h)). The dashboard queries dex
 * only through the CLI (read-only); it never starts flows and never opens a
 * blob cache.
 *
 * View types are what /api/state returns and the static page renders. All
 * aggregation lives in state.ts as pure functions over these shapes.
 */

// ---------------------------------------------------------------------------
// dex wire shapes (dexcli JSON output)
// ---------------------------------------------------------------------------

export interface DexFlowSummaryWire {
  flowId: string;
  flowType: string;
  /** e.g. "FLOW_STATUS_RUNNING" | "FLOW_STATUS_COMPLETED" | "FLOW_STATUS_FAILED". */
  flowStatus: string;
  flowStatusCode: number;
  runId: string;
  startTime: string;
  closeTime?: string | null;
  indexedAttributes?: Array<{ key: string; value: string[] }>;
}

export interface DexSearchWire {
  flows: DexFlowSummaryWire[];
  nextPageToken?: string;
}

export interface DexAttributeWire {
  key: string;
  value: unknown;
}

export interface DexActiveStepWire {
  stepExecutionId: string;
  stepType: string;
  /** e.g. "ACTIVE_STEP_PHASE_ACTIVE". */
  phase: string;
  lastFailureInfo?: {
    attempt?: number;
    backendError?: string;
    subStatus?: string;
    details?: {
      originalWorkerErrorDetail?: string;
      originalWorkerErrorType?: string;
    };
  };
  movement?: {
    stepType?: string;
    stepInput?: Record<string, unknown>;
  };
}

export interface DexStateWire {
  activeStepExecutions: DexActiveStepWire[];
  attributes: DexAttributeWire[];
}

/** One durable history event (`dexcli flow history <id> -output json`). */
export interface DexHistoryEventWire {
  eventId: string;
  eventTime: string;
  type: string;
  payload: {
    /** FlowStartedOrContinued. */
    initialStart?: { stepInput?: Record<string, unknown> };
    /** Step events: dispatch context (carries file/round once leasing began). */
    context?: { stepExecutionId?: string; stepType?: string; finalAttempt?: number };
    input?: { stepInput?: Record<string, unknown> };
    movement?: { stepInput?: Record<string, unknown> };
    output?: {
      stepDecision?: {
        nextSteps?: Array<{ stepType?: string; stepInput?: Record<string, unknown> }>;
      };
      upsertAttributes?: DexAttributeWire[];
      /**
       * US-002 dispatch-gate: present on `StepExecuteFailed` events (observed
       * live against dexcli v0.13.5, BUILD_NOTES 0(h) wire). Absent on
       * completed events.
       */
      failure?: {
        attempt?: number;
        backendError?: string;
        details?: { originalWorkerErrorDetail?: string } | null;
      } | null;
    };
  };
}

export interface DexHistoryWire {
  flowId: string;
  runId: string;
  events: DexHistoryEventWire[];
  nextPageToken?: string;
}

// ---------------------------------------------------------------------------
// git wire shapes (read-only queries)
// ---------------------------------------------------------------------------

export interface GitCommitRow {
  sha: string;
  shortSha: string;
  author: string;
  /** ISO-8601 author date. */
  date: string;
  subject: string;
  /** Ref decorations (branch tips, HEAD). */
  refs: string;
  /** Operation-ID trailer value when present (sole-committer evidence). */
  opId: string | null;
  /** Content-Hash trailer value when present (evidence only, never identity). */
  contentHash: string | null;
}

export interface GitWorktreeRow {
  path: string;
  head: string;
  /** e.g. "refs/heads/lease/src__Money.php/1" or "(detached)". */
  branch: string;
  /** null when the worktree dir is not readable/status failed. */
  clean: boolean | null;
}

// ---------------------------------------------------------------------------
// kill-event wire shapes (metrics/kill-events.json|jsonl + chaos sidecars)
// ---------------------------------------------------------------------------

/**
 * Normalized kill event. Accepts BOTH spellings in the wild:
 * - chaos-kill.ts sidecars: kind "intent" | "completed"
 * - src/metrics/types.ts KillEvent: kind "kill-intent" | "kill-completed"
 */
export interface NormalizedKillEvent {
  source: string;
  kind: "intent" | "completed";
  runId: string;
  /** UTC ISO-8601. Cross-process ordering uses UTC only. */
  utc: string;
  monotonicMs: number | null;
  /** Target PIDs (intent) or killed PIDs (completed). */
  pids: number[];
  signal: string | null;
  reason: string | null;
  note: string | null;
  resumed: boolean | null;
}

// ---------------------------------------------------------------------------
// burn-down samples (QueueBurnDownEvent-compatible, src/metrics/types.ts)
// ---------------------------------------------------------------------------

/** Minimal shape check target; matches metrics QueueBurnDownEvent fields. */
export interface BurnDownSample {
  queue: string;
  file: string | null;
  iteration: number;
  error_count: number;
  recorded_at: string | null;
}

// ---------------------------------------------------------------------------
// view model (/api/state payload)
// ---------------------------------------------------------------------------

export interface SourceStatus {
  available: boolean;
  error: string | null;
  detail: string | null;
}

export interface FlowView {
  flowId: string;
  flowType: string;
  status: string;
  startTime: string;
  closeTime: string | null;
  runId: string;
}

export interface GridRow {
  id: string;
  kind: "lease" | "blocked" | "idle-worktree";
  file: string | null;
  round: number | null;
  worktree: string | null;
  worktreeName: string | null;
  branch: string | null;
  epoch: number | null;
  holder: string | null;
  clean: boolean | null;
  /** Human stage label: implementer / reviewer-1 / reviewer-2 / fixer / commit / ... */
  stage: string | null;
  stepExecutionId: string | null;
  attempt: number | null;
  lastOutcome: string | null;
  inFlight: boolean;
  note: string | null;
  flowId: string | null;
  acquiredAt: string | null;
}

export interface QueueSummaryView {
  pending: string[];
  current: { file: string; round: number; epoch: number } | null;
  done: Array<{ file: string; round: number; commitSha: string | null }>;
  blocked: Array<{ file: string; round: number; reason: string }>;
  flowId: string;
}

export interface FeedEntry {
  flowId: string;
  ts: string;
  startedAt: string;
  endedAt: string | null;
  stepId: string;
  role: string;
  file: string | null;
  round: number | null;
  attempt: number;
  outcome: string;
  /** Total tokens; null = not applicable (non-model step). */
  tokens: number | null;
  /**
   * Wave-5 cost honesty: provider-reported usage split for envelopes that
   * carry the full TokenUsage object (null for bare-total envelopes).
   */
  usage: UsageSplitView | null;
  wallClockMs: number | null;
  /** True for model-calling roles (local mirror of the envelope contract). */
  tokensRequired: boolean;
}

/** Normalized provider usage split (metrics TokenUsage, flattened view). */
export interface UsageSplitView {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

/** Per-role agent usage aggregate for the dashboard grid (cost honesty). */
export interface AgentUsageView {
  role: string;
  calls: number;
  /** Sum over envelopes carrying the full split; null when none do. */
  input: number | null;
  cacheRead: number | null;
  output: number | null;
  reasoning: number | null;
  costUsd: number | null;
  /** True when tokens flowed without provider-reported per-call cost. */
  estimated: boolean;
}

export interface BurnDownSeriesView {
  queue: string;
  points: Array<{ iteration: number; errorCount: number; recordedAt: string | null }>;
}

export interface CommitView {
  sha: string;
  shortSha: string;
  author: string;
  date: string;
  subject: string;
  refs: string;
  opId: string | null;
  contentHash: string | null;
}

export interface KillTimelineEntryView {
  kind: "intent" | "completed";
  utc: string;
  monotonicMs: number | null;
  pids: number[];
  signal: string | null;
  reason: string | null;
  note: string | null;
  resumed: boolean | null;
  source: string;
}

export interface KillTimelineGroupView {
  runId: string;
  entries: KillTimelineEntryView[];
}

/**
 * US-006 degraded round: a file+round that reached verdict-check with BOTH
 * reviewers tombstoned (discarded) — the round proceeded as unreviewed. A
 * degraded round must never read as clean on any surface; it is surfaced
 * here (the /api/state payload) and folded into the headline marker.
 */
export interface DegradedRoundView {
  flowId: string;
  file: string;
  round: number;
  reviewers: string[];
  reasons: string[];
}

export interface DashboardStateView {
  generatedAt: string;
  /**
   * Wave-5 lifecycle headline (takeaways-synthesis #3): one-line run status
   * for the newest port flow with the live running → killed → resumed →
   * completed flip (derived from flow status + kill sidecar ordering).
   * US-006: carries a `DEGRADED (N unreviewed)` marker when the headline
   * flow has degraded rounds.
   */
  headline: string;
  sources: {
    dex: SourceStatus;
    git: SourceStatus & { repoRoot: string };
    killEvents: SourceStatus & { filesScanned: string[] };
  };
  flows: FlowView[];
  grid: GridRow[];
  queueSummaries: QueueSummaryView[];
  feed: FeedEntry[];
  burnDown: BurnDownSeriesView[];
  commits: CommitView[];
  worktrees: Array<{ path: string; branch: string; head: string; clean: boolean | null }>;
  killTimeline: KillTimelineGroupView[];
  agentUsage: AgentUsageView[];
  /** US-006: rounds whose every reviewer verdict is a tombstone. */
  degradedRounds: DegradedRoundView[];
}

/**
 * US-007: one message on the envelope telemetry stream (`port/<flowId>/events`).
 * Structural mirror of flows/steps/envelope.ts EnvelopeStreamMessage — the
 * dashboard deliberately does not import flow modules (same rationale as the
 * ParsedEnvelope duplication note in state.ts). `event` is shape-checked by
 * parseEnvelope downstream, never cast.
 */
export interface StreamEventMessage {
  /** Topic: `port/<flowId>/events` (self-describing for stream consumers). */
  topic: string;
  /** Flow instance ID the event belongs to (the originating dex flow). */
  flowId: string;
  /** The durable envelope-event attribute key this message mirrors. */
  eventKey: string;
  /** The mirrored envelope event (same payload as the durable write). */
  event: unknown;
}
