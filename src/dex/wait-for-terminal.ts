/**
 * Typed terminal wait over the dex Client (dex-sdk review 1.6 fix).
 *
 * dex's waitForFlow long-poll times out periodically by DESIGN, so callers
 * poll until the flow reaches a terminal state or the deadline passes. The
 * transient classification is TYPED, never text-matched (error-handling.md
 * §Client failures; gotchas "Catch exported SDK errors, not error.message"):
 * - LongPollTimeoutError — the normal periodic wake-up when the Flow is
 *   still open at the long-poll timeout (exported, thrown by waitForFlow,
 *   verified against installed 0.12.1 declarations);
 * - DexServiceError with gRPC code 14 (UNAVAILABLE) — a transient transport
 *   blip while the server restarts (kill/resume window).
 * Any other error is rethrown immediately; so is any error past the deadline.
 */

import { DexServiceError, LongPollTimeoutError } from "@superdurable/dex";
import { status } from "@grpc/grpc-js";

/** Poll cadence between transient-failure retries. */
const RETRY_DELAY_MS = 2_000;

/**
 * Robust flow wait: poll through the two TYPED transient failures until the
 * flow reaches a terminal state or the deadline passes (last failure wins).
 * `retryDelayMs` is the cadence between retries (tests shrink it; production
 * keeps the 2 s default).
 */
export async function waitForFlowTerminal(
  runtime: { client: { waitForFlow(flowId: string): Promise<unknown> } },
  flowId: string,
  deadlineMs: number,
  retryDelayMs: number = RETRY_DELAY_MS,
): Promise<unknown> {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    try {
      return await runtime.client.waitForFlow(flowId);
    } catch (err) {
      const transient =
        err instanceof LongPollTimeoutError ||
        (err instanceof DexServiceError && err.code === status.UNAVAILABLE);
      if (!transient || Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }
  }
}
