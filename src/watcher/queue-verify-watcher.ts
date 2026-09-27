/**
 * Queue-verify kill watcher — CORE (US-007, Stage 2d).
 *
 * Watches for the START of the PpQueueVerify step and fires the chaos kill
 * exactly once (the durable fix-round kill window of the AC1 smoke). All I/O
 * is injected: the stream subscription, the 60 s poll probe, the kill action,
 * and the flow-status probe — the module is a pure bounded state machine and
 * runs in tests without a dex server.
 *
 * What it replaces (and fixes):
 * - /tmp/watch-queuefix-kill.sh + /tmp/watch-ac1-parallel.sh poll loops
 *   (10 s dexcli subprocess polling) — replaced by a STREAM subscription for
 *   the queue-verify start envelope with a 60 s poll FALLBACK;
 * - the r1-review non-exiting terminal branch: a flow that reaches
 *   COMPLETED/FAILED before the trigger now returns cleanly (outcome
 *   "terminal") instead of looping;
 * - the whole watch is BOUNDED: `deadlineMs` (30 min in production) ends it
 *   with outcome "timeout" — a watcher can never hang.
 *
 * US-010a drain-to-head: on arm the retained stream is drained to its head
 * (all listStreamMessages pages, via the injected `drainBacklog` seam) and
 * scanned for the trigger BEFORE the follow loop starts at that head — a
 * trigger already in the backlog fires, and the follow phase reads only
 * post-arm messages instead of a stale backlog at ~1 message/pollInterval
 * (the cx8 miss: cursor ~28 min behind, ~1.1-1.6 s windows never reached).
 *
 * Fix-wave hardening (reviewer findings 1+2):
 * - FOLLOW CATCH-UP: arming on an EMPTY stream is not enough — the follow
 *   loop itself consumed retained events at ~1 message/pollInterval, so a
 *   backlog published AFTER arm re-created the cx8 miss inside the window.
 *   After each (non-empty) follow read the loop now keeps reading until the
 *   retained events are exhausted BEFORE any poll/terminal check or sleep —
 *   a full backlog published mid-watch is consumed within one cycle.
 * - STALE-START GUARD: a start in the drained backlog fires only when its
 *   attempt is still ACTIVE (no same-key completion appears later in the
 *   backlog — start/completion correlated by event key) AND the flow has
 *   not already gone terminal. A stale trigger never fires the kill; a
 *   terminal flow exits cleanly (outcome "terminal", firings 0). The SAME
 *   correlation + terminal check guards the FOLLOW batch (fix-wave follow
 *   guard): a [start, done] pair that arrives together post-arm is a
 *   completed attempt, not a kill window, and never fires.
 *
 * Exactly-once: `fire` is called at most ONCE per watcher lifetime; every
 * later trigger (stream repeat, poll echo) is logged and suppressed.
 *
 * Event semantics: "pp-queue-verify:start" is the START envelope of the
 * queue-verify step — on the stream it is the message whose eventKey begins
 * with `pp-queue-verify` and whose `ended_at` is null (the envelope factory
 * publishes the start event the moment the step begins, BEFORE its durable
 * attribute can exist — that early visibility is the point of the stream).
 */

export interface WatcherStreamEvent {
  /** Envelope event key, e.g. `pp-queue-verify#1` (or `...:start` markers). */
  eventKey: string;
  /** Envelope completion timestamp; null on a start event. */
  endedAt: string | null;
  /** Envelope stepId, e.g. `pp-queue-verify`. */
  stepId: string;
}

/** True when a stream message is the queue-verify START (the kill window). */
export function isQueueVerifyStart(event: WatcherStreamEvent): boolean {
  return event.stepId === "pp-queue-verify" && event.endedAt === null;
}

/**
 * Stale-start guard (fix-wave finding 2): the starts whose attempt is still
 * ACTIVE after correlating the drained backlog by event key. A completion
 * (`endedAt` set, same eventKey) closes the open start it matches — the
 * envelope factory publishes start and completion under ONE event key
 * (`stepId#attempt[@identity]`). A start with no later same-key completion
 * is an unmatched, possibly-live attempt; a fully matched start is stale and
 * must never fire the kill.
 */
export function activeAttemptStarts(events: readonly WatcherStreamEvent[]): WatcherStreamEvent[] {
  const open = new Map<string, WatcherStreamEvent>();
  for (const event of events) {
    if (isQueueVerifyStart(event)) {
      open.set(event.eventKey, event);
    } else if (event.stepId === "pp-queue-verify" && event.endedAt !== null) {
      open.delete(event.eventKey);
    }
  }
  return [...open.values()];
}

export interface QueueVerifyWatcherOptions {
  /**
   * Stream subscription: resolves the next event or null when the source is
   * exhausted/disabled; THROWS on failure (the watcher then relies on the
   * poll fallback and stops touching the stream).
   */
  nextStreamEvent: (timeoutMs: number) => Promise<WatcherStreamEvent | null>;
  /**
   * US-010a drain-to-head (fixes the cx8 miss): called ONCE at arm, BEFORE
   * the follow loop. Returns every currently-retained stream event in stream
   * order (oldest→newest) — the implementation reads all available
   * listStreamMessages pages until exhausted — and MUST leave the follow
   * cursor (`nextStreamEvent`'s resume token) at the drained HEAD, so the
   * follow phase reads only messages published after arm instead of
   * consuming a stale backlog at ~1 message/pollInterval (the cursor fell
   * ~28 min behind in cx8 and every ~1.1-1.6 s queue-verify window was
   * missed). A start envelope still ACTIVE after start/completion
   * correlation (fix-wave stale-start guard) fires — gated on the flow not
   * being terminal.
   * THROWS on failure: the watcher logs loudly and keeps following from
   * wherever the cursor ended up (worst case: the pre-US-010a behavior).
   */
  drainBacklog?: () => Promise<WatcherStreamEvent[]>;
  /** 60 s poll fallback probe (dexcli): true when queue-verify is active. */
  poll: () => Promise<boolean>;
  /** The kill action. Called AT MOST once. */
  fire: (trigger: { via: "stream" | "poll"; atUtc: string }) => Promise<void>;
  /** Flow terminal probe; "unknown" (query failure) never terminates. */
  flowStatus: () => Promise<"running" | "completed" | "failed" | "unknown">;
  /** Hard bound on the whole watch (production: 30 min). */
  deadlineMs: number;
  /** Poll cadence (production: 60 s). */
  pollIntervalMs: number;
  /** Monotonic-ish clock injection (tests advance it manually). */
  now?: () => number;
  /** Sleep injection (tests resolve immediately / pump the fake clock). */
  sleep?: (ms: number) => Promise<void>;
  /** Progress log (test-assertable). */
  log?: (line: string) => void;
}

export interface WatcherResult {
  outcome: "fired" | "timeout" | "terminal";
  /** Which source triggered the kill (absent unless outcome === "fired"). */
  via?: "stream" | "poll";
  /** Number of kill firings — MUST be 1 when fired, 0 otherwise. */
  firings: number;
}

const DEFAULT_NOW = () => Date.now();
const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runQueueVerifyWatcher(
  options: QueueVerifyWatcherOptions,
): Promise<WatcherResult> {
  const now = options.now ?? DEFAULT_NOW;
  const sleep = options.sleep ?? DEFAULT_SLEEP;
  const log = options.log ?? (() => {});
  const start = now();
  let fired = false;
  let streamUsable = true;

  const fireOnce = async (via: "stream" | "poll"): Promise<WatcherResult> => {
    if (fired) {
      log(`duplicate trigger via ${via} suppressed (already fired)`);
      return { outcome: "fired", via, firings: 0 };
    }
    fired = true;
    log(`TRIGGER via ${via} — firing chaos kill`);
    await options.fire({ via, atUtc: new Date().toISOString() });
    return { outcome: "fired", via, firings: 1 };
  };

  log(
    `watcher start: waiting for pp-queue-verify start (stream + ${Math.round(options.pollIntervalMs / 1000)}s poll fallback, bounded ${Math.round(options.deadlineMs / 60000)}min)`,
  );

  // US-010a drain-to-head: arm-time scan of the retained backlog BEFORE any
  // follow read, terminal check, or deadline arithmetic. Order is the fix —
  // a flow that completes quickly must not exit on the terminal branch while
  // its trigger still sits unread in the retained stream.
  //
  // Fix-wave stale-start guard: the drained start fires only when its
  // attempt is UNMATCHED (no same-key completion later in the backlog) AND
  // the flow is not already terminal — a retained [start, done] pair (or a
  // finished flow) never fires the kill.
  if (options.drainBacklog !== undefined) {
    try {
      const backlog = await options.drainBacklog();
      log(`drained ${backlog.length} retained stream event(s) to head — following from head`);
      const startsInBacklog = backlog.filter((e) => isQueueVerifyStart(e)).length;
      const active = activeAttemptStarts(backlog);
      if (active.length > 0) {
        let status: "running" | "completed" | "failed" | "unknown" = "unknown";
        try {
          status = await options.flowStatus();
        } catch {
          status = "unknown"; // query failure never suppresses a live attempt
        }
        if (status === "completed" || status === "failed") {
          log(
            `backlog start is stale — flow ${status} before the trigger; exiting cleanly (no kill)`,
          );
          return { outcome: "terminal", firings: 0 };
        }
        const trigger = active[0] as WatcherStreamEvent;
        log(`trigger found in drained backlog: ${trigger.eventKey}`);
        return await fireOnce("stream");
      }
      if (startsInBacklog > 0) {
        log(
          `skipped ${startsInBacklog} stale queue-verify start(s) in the drained backlog (matched by completion — no active attempt)`,
        );
      }
    } catch (err) {
      log(
        `backlog drain failed — following from the current cursor (poll fallback unaffected): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  while (now() - start < options.deadlineMs) {
    // 1. Stream subscription (primary): one bounded long-poll per cycle, then
    // a full CATCH-UP drain of everything already retained (fix-wave finding
    // 1) — consuming one message per pollInterval re-created the cx8 miss for
    // a backlog published AFTER arm, so the loop reads to exhaustion BEFORE
    // any poll/terminal check or sleep. Each read uses the same bounded
    // long-poll (retained events resolve immediately; only the final empty
    // read waits) and the deadline still bounds the whole loop.
    if (streamUsable) {
      try {
        let event = await options.nextStreamEvent(options.pollIntervalMs);
        if (event !== null) {
          const batch: WatcherStreamEvent[] = [];
          while (event !== null) {
            batch.push(event);
            if (now() - start >= options.deadlineMs) break; // bounded drain
            event = await options.nextStreamEvent(options.pollIntervalMs);
          }
          // Follow-path stale-start guard (fix-wave, same correlation as the
          // arm-time drain): fire only on a start whose attempt is UNMATCHED
          // in the batch (no same-key completion after it) AND whose flow has
          // not gone terminal — a [start, done] pair published together (or a
          // finished flow) is a stale trigger and must never fire the kill.
          log(`catch-up drained ${batch.length} follow event(s) to exhaustion before checks`);
          const startsInBatch = batch.filter((e) => isQueueVerifyStart(e)).length;
          const active = activeAttemptStarts(batch);
          if (active.length > 0) {
            let status: "running" | "completed" | "failed" | "unknown" = "unknown";
            try {
              status = await options.flowStatus();
            } catch {
              status = "unknown"; // query failure never suppresses a live attempt
            }
            if (status === "completed" || status === "failed") {
              log(
                `follow start is stale — flow ${status} before the trigger; exiting cleanly (no kill)`,
              );
              return { outcome: "terminal", firings: 0 };
            }
            log(`trigger in follow batch: ${active[0]!.eventKey}`);
            return await fireOnce("stream");
          }
          if (startsInBatch > 0) {
            log(
              `skipped ${startsInBatch} stale queue-verify start(s) in the follow batch (matched by completion — no active attempt)`,
            );
          }
        }
      } catch (err) {
        // Stream failed: the poll fallback is now the ONLY source (ENGAGED),
        // logged loudly. Never retried this run — deterministic and visible.
        streamUsable = false;
        log(
          `stream subscription failed — poll fallback ENGAGED (stream silent for the rest of this run): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 2. Poll fallback (also a belt-and-braces echo while the stream works).
    let pollHit = false;
    try {
      pollHit = await options.poll();
    } catch (err) {
      log(`poll probe failed (ignored, retried next cycle): ${err instanceof Error ? err.message : String(err)}`);
    }
    if (pollHit) {
      return await fireOnce("poll");
    }

    // 3. Terminal branch — FIXED (r1 finding): the watcher EXITS cleanly when
    // the flow ended before the trigger instead of looping to the deadline.
    let status: "running" | "completed" | "failed" | "unknown" = "unknown";
    try {
      status = await options.flowStatus();
    } catch {
      status = "unknown";
    }
    if (status === "completed" || status === "failed") {
      log(`flow ${status} before trigger — exiting cleanly (no kill)`);
      return { outcome: "terminal", firings: 0 };
    }

    if (now() - start >= options.deadlineMs) break;
    await sleep(options.pollIntervalMs);
  }

  log(`deadline reached without trigger — bounded exit`);
  return { outcome: "timeout", firings: 0 };
}
