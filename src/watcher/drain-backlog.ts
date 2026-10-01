/**
 * Arm-time backlog drain for the queue-verify watcher (US-010a, audit C28).
 *
 * `listStreamMessages` returns NEWEST-FIRST pages and each `nextPageToken`
 * reads the next, OLDER page. `activeAttemptStarts()` is order-sensitive
 * (a START opens an attempt, a later same-key completion closes it), so the
 * drained list must be in stream order — oldest to newest — across page
 * boundaries. Reversing each page but appending page 0 (newest) before page 1
 * (older) produced [newer block, older block]: a closed START/DONE pair that
 * straddled the 100-message boundary read as an ACTIVE start and the drain
 * fired the kill on a finished attempt.
 *
 * The SDK call stays in the script: this module takes a `listPage` seam, so it
 * carries no SDK import and runs in tests without a dex server.
 */

import type { WatcherStreamEvent } from "./queue-verify-watcher.js";

/** Server-max page size requested by the script. */
export const DRAIN_PAGE_SIZE = 100;

/**
 * Insurance only: 500 pages of server-max size is far beyond any run's
 * retained envelope count; a server that never exhausts `nextPageToken` must
 * not hang the arm.
 */
const DEFAULT_MAX_DRAIN_PAGES = 500;

/** One retained message as the drain needs it (structural; SDK-free). */
export interface RetainedMessage {
  value: unknown;
  resumeToken: string;
}

/** One newest-first page of retained messages. */
export interface RetainedPage {
  /** Newest-first, as `listStreamMessages` returns them. */
  messages: readonly RetainedMessage[];
  /** Token for the next (older) page; "" when the stream is exhausted. */
  nextPageToken: string;
}

export interface DrainBacklogOptions {
  /** Fetches one page; `""` requests the newest page. THROWS on failure. */
  listPage: (pageToken: string) => Promise<RetainedPage>;
  /** Page bound; defaults to {@link DEFAULT_MAX_DRAIN_PAGES}. */
  maxPages?: number;
  /**
   * Called with the newest message's resume token as soon as page 0 arrives,
   * BEFORE any deeper paging — so even a mid-drain failure leaves the follow
   * lane pinned at the stream head.
   */
  onHead?: (resumeToken: string) => void;
  log?: (line: string) => void;
}

/** Coerces one retained stream message into the watcher's structural event. */
export function toWatcherEvent(message: { value: unknown }): WatcherStreamEvent {
  const envelope = (
    typeof message.value === "object" && message.value !== null ? message.value : {}
  ) as {
    eventKey?: unknown;
    event?: { stepId?: unknown; ended_at?: unknown } | null;
  };
  const endedAt = envelope.event?.ended_at;
  return {
    eventKey: String(envelope.eventKey ?? ""),
    stepId: typeof envelope.event?.stepId === "string" ? envelope.event.stepId : "",
    // Only an absent/null ended_at is a START. Any other value (even one that
    // is not the expected ISO string, e.g. an epoch number) marks a completion:
    // misreading a finished attempt as a START fails OPEN in the stale-start
    // guard and would fire the kill on an idle system.
    endedAt: endedAt === undefined || endedAt === null ? null : String(endedAt),
  };
}

/**
 * Reads every retained page (newest-first) and returns the events in STREAM
 * ORDER (oldest to newest), ready for `activeAttemptStarts()`.
 */
export async function drainRetainedBacklog(
  options: DrainBacklogOptions,
): Promise<WatcherStreamEvent[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_DRAIN_PAGES;
  // Each entry is one page already reversed to oldest-first.
  const pages: WatcherStreamEvent[][] = [];
  const inStreamOrder = (): WatcherStreamEvent[] => [...pages].reverse().flat();

  let pageToken = "";
  for (let page = 0; page < maxPages; page++) {
    const res = await options.listPage(pageToken);
    if (page === 0) {
      const newest = res.messages[0];
      if (newest !== undefined) options.onHead?.(newest.resumeToken);
    }
    pages.push(res.messages.map(toWatcherEvent).reverse());
    if (res.nextPageToken === "") return inStreamOrder(); // exhausted: at head
    pageToken = res.nextPageToken;
  }
  options.log?.(`backlog drain hit the ${maxPages}-page bound — continuing from head`);
  return inStreamOrder();
}
