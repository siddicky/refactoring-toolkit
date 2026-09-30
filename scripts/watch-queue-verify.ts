/**
 * watch-queue-verify — US-007 stream-subscription kill watcher (Stage 2d).
 *
 * Replaces the /tmp shell poll loops (watch-queuefix-kill.sh /
 * watch-ac1-parallel.sh): the PRIMARY source is a dex STREAM subscription for
 * the pp-queue-verify START envelope (`port/<flowId>/events`), with the old
 * dexcli polling retained as a 60 s FALLBACK probe. Bounded to 30 minutes.
 * Fires the chaos kill EXACTLY ONCE and exits cleanly:
 *
 *   exit 0  kill fired (via stream or poll)
 *   exit 1  flow reached COMPLETED/FAILED before the trigger (clean, no kill;
 *           this is the r1-review non-exiting-terminal-branch fix)
 *   exit 2  30-minute bound elapsed without trigger
 *   exit 3  trigger seen but the kill was a NO-OP (no live target PIDs; the
 *           sidecar's completed record says fired:false)
 *
 * Event visibility note: the envelope factory publishes the stream message
 * the moment PpQueueVerify STARTS — before any durable attribute could exist
 * — so the stream sees the kill window that plain state polling could only
 * infer from an ACTIVE step execution (still the poll fallback's predicate).
 *
 * US-010a drain-to-head (cx8 finding): on arm the retained stream is drained
 * via listStreamMessages (all pages, newest-first, until exhausted), scanned
 * for the trigger, and the follow cursor is pinned to the drained HEAD — the
 * follow long-poll then sees post-arm messages ~immediately instead of
 * consuming a stale backlog at ~1 message/pollInterval (cx8: cursor ~28 min
 * behind; both ~1.1-1.6 s queue-verify windows missed). The follow long-poll
 * wakes the moment a message is published, so `--poll-seconds` only sets the
 * poll-fallback cadence; the reads AFTER the first event use their own short
 * `--catch-up-seconds` (default 1 s — the SDK takes whole seconds and 0 means
 * the 60 s server default, not "no wait"), so the DONE that closes the kill
 * window can no longer land in the same batch as its START and cancel the kill
 * (audit C27). A window shorter than ~1 s stays structurally unkillable.
 *
 * Scope: kill only. The resume (dex server + worker restart on the same DB)
 * stays the documented operator procedure — this watcher never restarts
 * infrastructure it did not start.
 *
 * Usage:
 *   bun run scripts/watch-queue-verify.ts --flow-id <id> --run-id <runId> \
 *     --events /tmp/kill-events.jsonl [--deadline-minutes 30] [--poll-seconds 60] \
 *     [--catch-up-seconds 1]
 *
 * Env: DEX_SERVER_ADDRESS / DEX_BLOB_CACHE_DIR (per-process cache dir is
 * deliberate — cross-process BlobCache sharing is not the guidance).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  DexServiceError,
} from "@superdurable/dex";
import { openDexClient, dexConfigFromEnv } from "../src/dex/client.js";
import { dexCliQueries } from "../src/dashboard/queries.js";
import { envelopeStream } from "../flows/steps/envelope.js";
import { PortProjectFlow } from "../flows/port-project.js";
import { chaosKill } from "./chaos-kill.js";
import {
  runQueueVerifyWatcher,
  type WatcherStreamEvent,
} from "../src/watcher/queue-verify-watcher.js";
import {
  DRAIN_PAGE_SIZE,
  drainRetainedBacklog,
  toWatcherEvent,
} from "../src/watcher/drain-backlog.js";

const execFileP = promisify(execFile);

/**
 * cx6b live finding: the readStream long-poll wake-up ("nothing arrived in
 * the poll window") surfaces as a DexServiceError with the STABLE subStatus
 * "longPollTimeout" — the watcher treated it as a subscription failure and
 * always degraded to the 45 s poll, which then MISSED the short (~15 s)
 * queue-verify window entirely (the run completed with no kill). Mirror the
 * dashboard subscriber's rule: classify by subStatus, treat the wake-up as
 * an empty read, keep the subscription alive.
 */
function isLongPollWakeUp(err: unknown): boolean {
  return (
    err instanceof DexServiceError &&
    (err as { subStatus?: unknown }).subStatus === "longPollTimeout"
  );
}

function argValue(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function log(line: string): void {
  console.log(`[watch-queue-verify ${new Date().toISOString()}] ${line}`);
}

/** Live PIDs for the dex server and the port worker (pgrep, may be empty). */
async function targetPids(): Promise<number[]> {
  const patterns = ["dexcli dev", "run-demo.ts worker"];
  const pids: number[] = [];
  for (const pattern of patterns) {
    try {
      const { stdout } = await execFileP("pgrep", ["-f", pattern], { timeout: 5_000 });
      for (const line of stdout.split("\n")) {
        const pid = Number.parseInt(line.trim(), 10);
        if (Number.isInteger(pid) && pid > 0 && !pids.includes(pid)) pids.push(pid);
      }
    } catch {
      // pgrep exits 1 on no match — no PIDs for this pattern.
    }
  }
  return pids;
}

async function main(): Promise<number> {
  const flowId = argValue("--flow-id");
  if (flowId === undefined || flowId === "") {
    console.error("usage: watch-queue-verify.ts --flow-id <id> --run-id <runId> --events <sidecar>");
    return 2;
  }
  const runId = argValue("--run-id", "watch-queue-verify") as string;
  const eventsPath = argValue("--events", "/tmp/kill-events.jsonl") as string;
  const deadlineMinutes = Number.parseInt(argValue("--deadline-minutes", "30") as string, 10);
  const pollSeconds = Number.parseInt(argValue("--poll-seconds", "60") as string, 10);
  const catchUpSeconds = Number.parseInt(argValue("--catch-up-seconds", "1") as string, 10);

  // Read-side stream client: a registry with EXACTLY the flow type that owns
  // envelopeStream (port.Project — one-flow stream ownership, dex Registry
  // rule), over its own blob-cache directory (per-process sharing).
  const config = {
    ...dexConfigFromEnv(),
    blobCacheDir: process.env.DEX_BLOB_CACHE_DIR?.trim() || ".dex-cache-watch",
  };
  let runtime: Awaited<ReturnType<typeof openDexClient>> | undefined;
  try {
    runtime = await openDexClient([new PortProjectFlow()], config);
  } catch (err) {
    // Fail-open: without a stream client the watcher still runs on the poll
    // fallback alone (same protection, slower trigger).
    log(`stream client unavailable (${(err as Error).message}) — poll fallback only`);
  }

  const cli = dexCliQueries({
    bin: process.env.DEXCLI_BIN?.trim() || "dexcli",
    server: config.serverAddress,
    timeoutMs: 10_000,
  });

  try {
    // Resume token for the subscription (empty = retained head on first read).
    let resumeToken = "";
    // Arm-time backlog drain (cx8 fix): read ALL retained pages newest-first
    // until exhausted, scan them for the trigger, and leave `resumeToken` at
    // the drained HEAD so the follow phase long-polls only post-arm messages
    // (the old cursor-at-retained-head follow consumed the backlog at
    // ~1 message/pollInterval and fell ~28 min behind the ~1.5 s windows).
    // The cursor is pinned to page 1's newest message BEFORE deep paging, so
    // even a mid-drain failure leaves the follow lane at head. The pages are
    // stitched into STREAM ORDER by drainRetainedBacklog (audit C28).
    const drainBacklog = async (): Promise<WatcherStreamEvent[]> => {
      if (runtime === undefined) return []; // poll-only degradation
      const client = runtime.client;
      return await drainRetainedBacklog({
        listPage: (pageToken) =>
          client.listStreamMessages(flowId, envelopeStream, DRAIN_PAGE_SIZE, pageToken),
        onHead: (token) => {
          resumeToken = token;
        },
        log,
      });
    };
    const result = await runQueueVerifyWatcher({
      deadlineMs: deadlineMinutes * 60_000,
      pollIntervalMs: pollSeconds * 1_000,
      catchUpTimeoutMs: catchUpSeconds * 1_000,
      drainBacklog,
      nextStreamEvent: async (timeoutMs) => {
        if (runtime === undefined) return null; // poll-only degradation
        let message: Awaited<ReturnType<typeof runtime.client.readStream>>;
        try {
          message = await runtime.client.readStream(
            flowId,
            envelopeStream,
            resumeToken,
            timeoutMs,
          );
        } catch (err) {
          if (isLongPollWakeUp(err)) return null; // empty long-poll wake-up
          throw err; // genuine stream failure -> poll fallback (once)
        }
        resumeToken = message.resumeToken;
        const event = toWatcherEvent(message);
        log(`stream event: ${event.eventKey}`);
        return event;
      },
      poll: async () => {
        // Old watcher predicate: an ACTIVE PpQueueVerify step execution.
        const state = await cli.flowState(flowId);
        if (!state.ok) return false;
        return (state.value.activeStepExecutions ?? []).some(
          (s) => s.stepType === "PpQueueVerify",
        );
      },
      flowStatus: async () => {
        try {
          const out = await execFileP(
            process.env.DEXCLI_BIN?.trim() || "dexcli",
            ["flow", "summary", flowId, "-server", config.serverAddress, "-output", "json"],
            { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 },
          );
          const parsed = JSON.parse(out.stdout) as { flowStatus?: string };
          if (parsed.flowStatus === "FLOW_STATUS_COMPLETED") return "completed";
          if (parsed.flowStatus === "FLOW_STATUS_FAILED") return "failed";
          return "running";
        } catch {
          return "unknown";
        }
      },
      fire: async ({ via }) => {
        const pids = await targetPids();
        log(`kill via ${via}: pids=${pids.join(",") || "none"} events=${eventsPath} run=${runId} flow=${flowId}`);
        const kill = await chaosKill({
          pids,
          reason: `US-007 stream watcher: pp-queue-verify start (via ${via})`,
          runId,
          eventsPath,
          flowRunId: flowId,
          waitMs: 5_000,
        });
        return {
          killed: kill.fired,
          detail: `no live target PID (pgrep found ${pids.length}); sidecar records fired=false`,
        };
      },
      log,
    });

    if (result.outcome === "fired") {
      log(`done: kill fired once via ${result.via}`);
      return 0;
    }
    if (result.outcome === "no-op") {
      log(`done: trigger seen via ${result.via} but NO kill happened (no live target PIDs)`);
      return 3;
    }
    if (result.outcome === "terminal") {
      log("done: flow terminal before trigger");
      return 1;
    }
    log("done: bounded timeout without trigger");
    return 2;
  } finally {
    await runtime?.close();
  }
}

const started = Date.now();
main()
  .then((code) => {
    log(`exit ${code} after ${Math.round((Date.now() - started) / 1000)}s`);
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error("[watch-queue-verify] fatal:", err);
    process.exit(1);
  });
