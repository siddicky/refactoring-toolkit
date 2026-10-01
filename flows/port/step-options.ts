/**
 * Shared dex step options of the port flows: the connection-failure retry
 * schedule that outlives a worker restart, applied to model steps and to the
 * pre-start markers.
 */

/**
 * US-009-final (cx7 live finding): the connection-failure retry budget. After
 * a kill+resume, the dex server re-dispatches in-flight steps to the worker
 * target (127.0.0.1:8803) while the worker is still coming up — a restart
 * window of ~60s. The old budget (maximumAttempts 3, ~7s of backoff) was
 * shorter than the window, so the resumed marker/model steps exhausted
 * (dial refused → WORKER_API_ERROR, finalAttempt 3) and the flow FAILED
 * before the worker ever came back (cx7 resume fingerprint). This schedule
 * spans ~155s of exponential backoff (5s, 10s, 20s, then 30s-capped waits
 * across 8 attempts total), so re-dispatch retries outlive the restart window
 * with margin. dex 0.12.1 RetryPolicy has no error-class filter (verified
 * against dist/src/step.d.ts), so non-connection failures on these steps get
 * the same longer SCHEDULE — the exhaustion semantics are unchanged (the
 * final attempt still fails the step/flow), and policies outside the
 * marker/model/review scope keep their existing bounds (PpPrep stays at 1 —
 * a bad run input is permanent). The in-step REVIEW_STEP_MAX_ATTEMPTS
 * tombstone bound is independent of this retry budget and untouched.
 */
export const RESTART_WINDOW_RETRY = {
  maximumAttempts: 8,
  initialIntervalMs: 5_000,
  backoffCoefficient: 2,
  maximumIntervalMs: 30_000,
} as const;

/** Model/review/fixer step retry policy (dex executeRetry). */
export const MODEL_STEP_OPTIONS = { executeRetry: RESTART_WINDOW_RETRY } as const;

/** Pre-start marker retry policy — markers are the FIRST re-dispatched steps
 *  after a resume, so they carry the same restart-window budget. */
export const MARKER_STEP_OPTIONS = { executeRetry: RESTART_WINDOW_RETRY } as const;
