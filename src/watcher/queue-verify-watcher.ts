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
 *   a full backlog published mid-watch is consumed within one cycle. The
 *   catch-up reads use their OWN short `catchUpTimeoutMs` (default 1 s, the
 *   SDK's whole-second floor), never the poll interval: a full-interval wait
 *   after a START let its DONE (same event key) land in the same batch and
 *   the stale-start guard cancelled the kill (audit C27).
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

/** Flow status as the watcher sees it ("unknown" = the probe failed / unrecognized). */
export type WatcherFlowStatus =
  | "running"
  | "completed"
  | "failed"
  | "terminated"
  | "canceled"
  | "timeout"
  | "unknown";

/**
 * True when the flow can no longer reach a queue-verify START: completed,
 * failed, terminated, canceled, or server-side timeout. (Audit C34: only
 * completed/failed used to count, so a terminated flow was watched for the
 * whole bound and exited "timeout" instead of the clean "terminal".)
 */
export function isTerminalFlowStatus(status: WatcherFlowStatus): boolean {
  return (
    status === "completed" ||
    status === "failed" ||
    status === "terminated" ||
    status === "canceled" ||
    status === "timeout"
  );
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
  /**
   * 60 s poll fallback probe (dexcli): true when queue-verify is active.
   * THROW on a probe failure so the watcher can log it (rate-limited) instead
   * of the fallback lane going silently blind.
   */
  poll: () => Promise<boolean>;
  /**
   * The kill action. Called AT MOST once. Resolve `{ killed: false }` when the
   * action ran but killed nothing (no live target): the watcher then reports
   * outcome "no-op" instead of a successful kill (audit C71). Resolving void
   * means the kill happened.
   */
  fire: (trigger: { via: "stream" | "poll"; atUtc: string }) => Promise<FireResult | void>;
  /**
   * Flow status probe. THROW on a query failure (the watcher logs it,
   * rate-limited, and treats the status as "unknown"); "unknown" never
   * terminates. Terminal statuses end the watch cleanly — see
   * {@link isTerminalFlowStatus}.
   */
  flowStatus: () => Promise<WatcherFlowStatus>;
  /** Hard bound on the whole watch (production: 30 min). */
  deadlineMs: number;
  /** Poll cadence (production: 60 s). */
  pollIntervalMs: number;
  /**
   * Long-poll budget for every stream read AFTER the first event of a cycle
   * (the catch-up reads). Default `min(pollIntervalMs, 1000)`. It MUST stay
   * short and non-zero: with a full `pollIntervalMs` the read that follows a
   * START blocks for the whole interval, the queue-verify DONE (same event
   * key) lands in that same batch, and the stale-start guard then suppresses
   * the kill (audit C27). The dex SDK only takes whole seconds, and 0 means
   * "server default long-poll" (60 s — measured against a live dex server),
   * NOT "do not wait", so 1000 ms is the practical floor. A value <= 0 falls
   * back to the default.
   */
  catchUpTimeoutMs?: number;
  /**
   * Wall-clock budget (ms) for the flow-status probe that GATES a kill (the
   * "is the flow already terminal?" check right before firing). It runs inside
   * the ~1.1-1.6 s kill window, so a slow or hung dexcli must not eat the
   * window: past the budget the status reads "unknown", which never
   * suppresses a live attempt. Default 500 ms. Real timer, not `sleep`.
   */
  statusGateTimeoutMs?: number;
  /** Monotonic-ish clock injection (tests advance it manually). */
  now?: () => number;
  /** Sleep injection (tests resolve immediately / pump the fake clock). */
  sleep?: (ms: number) => Promise<void>;
  /** Progress log (test-assertable). */
  log?: (line: string) => void;
}

/** What the injected kill action reports back. */
export interface FireResult {
  /** False when the action ran but nothing was killed (no live target). */
  killed: boolean;
  /** Operator-facing detail, logged when nothing was killed. */
  detail?: string;
}

export interface WatcherResult {
  /**
   * fired: the kill happened. no-op: a trigger was seen and the kill action
   * ran, but it killed nothing (no live target PIDs). timeout / terminal: no
   * trigger fired the kill.
   */
  outcome: "fired" | "no-op" | "timeout" | "terminal";
  /** Which source triggered the kill action (absent for timeout/terminal). */
  via?: "stream" | "poll";
  /** Number of real kills — 1 only when outcome === "fired", 0 otherwise. */
  firings: number;
}

/** Practical floor of a stream read wait: whole seconds (SDK), 0 = server default. */
export const DEFAULT_CATCH_UP_TIMEOUT_MS = 1_000;

const DEFAULT_NOW = () => Date.now();
const DEFAULT_SLEEP = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Log the first failure of a probe and then every Nth consecutive one. */
const PROBE_FAILURE_LOG_EVERY = 10;

/** Default wall-clock budget of the kill-gating flow-status probe. */
export const DEFAULT_STATUS_GATE_TIMEOUT_MS = 500;

/** Distinguishes "the probe ran out of budget" from every real status. */
const GATE_TIMED_OUT = Symbol("status gate timed out");

export async function runQueueVerifyWatcher(
  options: QueueVerifyWatcherOptions,
): Promise<WatcherResult> {
  const now = options.now ?? DEFAULT_NOW;
  const sleep = options.sleep ?? DEFAULT_SLEEP;
  const log = options.log ?? (() => {});
  const start = now();
  const catchUpTimeoutMs =
    options.catchUpTimeoutMs !== undefined && options.catchUpTimeoutMs > 0
      ? options.catchUpTimeoutMs
      : Math.min(options.pollIntervalMs, DEFAULT_CATCH_UP_TIMEOUT_MS);
  const statusGateMs = options.statusGateTimeoutMs ?? DEFAULT_STATUS_GATE_TIMEOUT_MS;
  // Tolerance for a long-poll that wakes marginally early, which would
  // otherwise skip a probe and double the probe cadence.
  const probeToleranceMs = Math.min(DEFAULT_CATCH_UP_TIMEOUT_MS, options.pollIntervalMs / 2);
  let fired = false;
  let streamUsable = true;

  // Probe failures are LOGGED (audit C34) — a missing/misconfigured dexcli used
  // to leave the fallback lane silently blind. Rate-limited: the first failure,
  // then every PROBE_FAILURE_LOG_EVERY-th consecutive one; a recovery is logged.
  const consecutiveFailures = new Map<string, number>();
  const probeFailed = (probe: string, err: unknown): void => {
    const count = (consecutiveFailures.get(probe) ?? 0) + 1;
    consecutiveFailures.set(probe, count);
    if (count === 1 || count % PROBE_FAILURE_LOG_EVERY === 0) {
      log(
        `${probe} probe failed (${count} consecutive; ignored, retried next cycle): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };
  const probeSucceeded = (probe: string): void => {
    const count = consecutiveFailures.get(probe) ?? 0;
    if (count > 0) log(`${probe} probe recovered after ${count} consecutive failure(s)`);
    consecutiveFailures.delete(probe);
  };
  /**
   * Flow status with failures logged and mapped to "unknown" (never terminal).
   * With `budgetMs` (the kill gate) a probe that overruns also reads "unknown"
   * instead of delaying the kill.
   */
  const probeStatus = async (budgetMs?: number): Promise<WatcherFlowStatus> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const probe = options.flowStatus();
      probe.catch(() => undefined); // a late rejection after the budget must not go unhandled
      const status =
        budgetMs === undefined
          ? await probe
          : await Promise.race([
              probe,
              new Promise<typeof GATE_TIMED_OUT>((resolve) => {
                timer = setTimeout(() => resolve(GATE_TIMED_OUT), budgetMs);
              }),
            ]);
      if (status === GATE_TIMED_OUT) {
        log(
          `flow-status probe exceeded the ${budgetMs}ms kill-gate budget — treating the flow as running (never delay a live kill)`,
        );
        return "unknown";
      }
      probeSucceeded("flow-status");
      return status;
    } catch (err) {
      probeFailed("flow-status", err);
      return "unknown"; // query failure never suppresses a live attempt
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };

  let firstResult: WatcherResult | undefined;
  const fireOnce = async (via: "stream" | "poll"): Promise<WatcherResult> => {
    if (fired) {
      // Reports what the FIRST trigger really did (never a synthetic success).
      log(`duplicate trigger via ${via} suppressed (already fired)`);
      return { ...(firstResult ?? { outcome: "no-op", via }), firings: 0 };
    }
    fired = true;
    log(`TRIGGER via ${via} — firing chaos kill`);
    // A throw from the kill action propagates (see the catch blocks below):
    // the exactly-once guard is spent, so swallowing it would end the run as a
    // silent "no kill".
    const result = await options.fire({ via, atUtc: new Date().toISOString() });
    if (result !== undefined && !result.killed) {
      log(`trigger via ${via} seen but the kill was a NO-OP: ${result.detail ?? "nothing was killed"}`);
      firstResult = { outcome: "no-op", via, firings: 0 };
      return firstResult;
    }
    firstResult = { outcome: "fired", via, firings: 1 };
    return firstResult;
  };

  /**
   * The kill gate shared by the arm-time drain and the follow batch: a flow
   * that is already terminal exits cleanly, anything else fires.
   */
  const fireIfLive = async (
    where: "backlog" | "follow",
    trigger: WatcherStreamEvent,
    status: WatcherFlowStatus,
  ): Promise<WatcherResult> => {
    if (isTerminalFlowStatus(status)) {
      log(`${where} start is stale — flow ${status} before the trigger; exiting cleanly (no kill)`);
      return { outcome: "terminal", firings: 0 };
    }
    log(
      where === "backlog"
        ? `trigger found in drained backlog: ${trigger.eventKey}`
        : `trigger in follow batch: ${trigger.eventKey}`,
    );
    return await fireOnce("stream");
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
      if (active[0] !== undefined) {
        return await fireIfLive("backlog", active[0], await probeStatus(statusGateMs));
      }
      if (startsInBacklog > 0) {
        log(
          `skipped ${startsInBacklog} stale queue-verify start(s) in the drained backlog (matched by completion — no active attempt)`,
        );
      }
    } catch (err) {
      if (fired) throw err; // the kill action itself failed: never swallow it as a drain failure
      log(
        `backlog drain failed — following from the current cursor (poll fallback unaffected): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let lastProbeAt: number | null = null;
  while (now() - start < options.deadlineMs) {
    const cycleStart = now();
    let streamEventsRead = 0;
    // 1. Stream subscription (primary): one bounded long-poll per cycle, then
    // a full CATCH-UP drain of everything already retained (fix-wave finding
    // 1) — consuming one message per pollInterval re-created the cx8 miss for
    // a backlog published AFTER arm, so the loop reads to exhaustion BEFORE
    // any poll/terminal check or sleep. The first read long-polls for
    // pollInterval; the catch-up reads use the short catchUpTimeoutMs
    // (retained events resolve immediately; only the final empty read waits)
    // and the deadline still bounds the whole loop.
    if (streamUsable) {
      try {
        // Never long-poll past the hard bound (whole seconds, >= 1 s: SDK).
        const untilDeadlineMs = options.deadlineMs - (now() - start);
        const firstReadMs = Math.min(
          options.pollIntervalMs,
          Math.max(DEFAULT_CATCH_UP_TIMEOUT_MS, Math.ceil(untilDeadlineMs / 1000) * 1000),
        );
        let event = await options.nextStreamEvent(firstReadMs);
        if (event !== null) {
          const batchStartedAt = now();
          const batch: WatcherStreamEvent[] = [];
          // Lookahead budget (C27): once a START is in the batch, the rest of
          // the retained events are read for at most catchUpTimeoutMs — enough
          // to see a same-key DONE that is ALREADY retained, short enough that
          // a DONE published ~1.5 s later cannot land in this batch and cancel
          // the kill. Quiet stream: the empty catch-up read times out after
          // catchUpTimeoutMs. Busy stream: the budget check ends it once a
          // START is in the batch, and a batch that has been draining for a
          // whole pollInterval ends regardless, so a constantly busy stream
          // cannot starve the poll/terminal probes until the deadline.
          let startSeenAt: number | null = null;
          // The kill gate's status probe starts the moment a START is read, so
          // it overlaps the lookahead instead of adding its latency after it.
          let gate: Promise<WatcherFlowStatus> | undefined;
          while (event !== null) {
            batch.push(event);
            if (startSeenAt === null && isQueueVerifyStart(event)) {
              startSeenAt = now();
              gate ??= probeStatus(statusGateMs);
            }
            if (now() - start >= options.deadlineMs) break; // bounded drain
            if (startSeenAt !== null && now() - startSeenAt >= catchUpTimeoutMs) break;
            if (now() - batchStartedAt >= options.pollIntervalMs) break;
            event = await options.nextStreamEvent(catchUpTimeoutMs);
          }
          streamEventsRead = batch.length;
          // Follow-path stale-start guard (fix-wave, same correlation as the
          // arm-time drain): fire only on a start whose attempt is UNMATCHED
          // in the batch (no same-key completion after it) AND whose flow has
          // not gone terminal — a [start, done] pair published together (or a
          // finished flow) is a stale trigger and must never fire the kill.
          log(`catch-up drained ${batch.length} follow event(s) to exhaustion before checks`);
          const startsInBatch = batch.filter((e) => isQueueVerifyStart(e)).length;
          const active = activeAttemptStarts(batch);
          if (active[0] !== undefined) {
            return await fireIfLive("follow", active[0], await (gate ?? probeStatus(statusGateMs)));
          }
          if (startsInBatch > 0) {
            log(
              `skipped ${startsInBatch} stale queue-verify start(s) in the follow batch (matched by completion — no active attempt)`,
            );
          }
        }
      } catch (err) {
        if (fired) throw err; // the kill action itself failed: never swallow it as a stream failure
        // Stream failed: the poll fallback is now the ONLY source (ENGAGED),
        // logged loudly. Never retried this run — deterministic and visible.
        streamUsable = false;
        log(
          `stream subscription failed — poll fallback ENGAGED (stream silent for the rest of this run): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // How long the stream lane itself blocked this cycle (before any probe).
    const streamBlockedMs = now() - cycleStart;

    // Probe cadence: the dexcli probes run once per pollInterval however fast
    // the cycles turn over (a busy stream must not spawn dexcli per event).
    const probeDue =
      lastProbeAt === null || now() - lastProbeAt >= options.pollIntervalMs - probeToleranceMs;
    if (probeDue) {
      lastProbeAt = now();

      // 2. Poll fallback (also a belt-and-braces echo while the stream works).
      let pollHit = false;
      try {
        pollHit = await options.poll();
        probeSucceeded("poll");
      } catch (err) {
        probeFailed("poll", err);
      }
      if (pollHit) {
        return await fireOnce("poll");
      }

      // 3. Terminal branch — FIXED (r1 finding): the watcher EXITS cleanly when
      // the flow ended before the trigger instead of looping to the deadline.
      const status = await probeStatus();
      if (isTerminalFlowStatus(status)) {
        log(`flow ${status} before trigger — exiting cleanly (no kill)`);
        return { outcome: "terminal", firings: 0 };
      }
    }

    if (now() - start >= options.deadlineMs) break;

    // Pacing. The stream long-poll is the pacing mechanism and it wakes the
    // moment a message is published, whereas a sleep leaves the watcher deaf —
    // a START published meanwhile would be read only after its ~1.5 s window
    // closed. So never sleep after a busy cycle, nor after a read that really
    // blocked (it already paced the cycle; the old unconditional
    // sleep(pollInterval) doubled the cadence to 2x the documented 60 s —
    // audit C34). Sleep only when the stream lane did not pace the cycle
    // (unusable, or a read that returned at once): just the REMAINDER of
    // pollInterval.
    if (streamEventsRead > 0) continue;
    if (streamUsable && streamBlockedMs >= DEFAULT_CATCH_UP_TIMEOUT_MS) continue;
    const sleepMs = Math.min(
      options.pollIntervalMs - (now() - cycleStart),
      options.deadlineMs - (now() - start), // never sleep past the hard bound
    );
    if (sleepMs > 0) await sleep(sleepMs);
  }

  log(`deadline reached without trigger — bounded exit`);
  return { outcome: "timeout", firings: 0 };
}
