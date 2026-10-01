/**
 * `dexcli flow summary <flowId> -output json` output, as the watcher needs it.
 *
 * One subprocess call yields both the flow status (the terminal probe) and the
 * real Dex RUN id (`runId`) that the kill sidecar must carry as `flow_run_id`
 * (Contract B / audit C42): the watcher used to write the FLOW id there, so a
 * reader filtering by run id could never match it.
 */

import type { WatcherFlowStatus } from "./queue-verify-watcher.js";

export interface FlowSummary {
  /** Wire status, e.g. "FLOW_STATUS_RUNNING"; null when absent. */
  flowStatus: string | null;
  /** The Dex run id of the flow's current run; null when absent/empty. */
  runId: string | null;
}

/** Parses `dexcli flow summary` JSON. THROWS on output that is not a JSON object. */
export function parseFlowSummary(stdout: string): FlowSummary {
  const parsed: unknown = JSON.parse(stdout);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("dexcli flow summary did not return a JSON object");
  }
  const wire = parsed as { flowStatus?: unknown; runId?: unknown };
  return {
    flowStatus: typeof wire.flowStatus === "string" ? wire.flowStatus : null,
    runId: typeof wire.runId === "string" && wire.runId !== "" ? wire.runId : null,
  };
}

/**
 * The `flow_run_id` to write into the kill sidecar: an explicit operator
 * override first, then the run id observed from `dexcli flow summary`.
 * Undefined when neither is known — the field is then OMITTED. The flow id is
 * deliberately never a fallback: it is a different identifier.
 */
export function resolveFlowRunId(
  explicit: string | undefined,
  observed: string | null | undefined,
): string | undefined {
  if (explicit !== undefined && explicit !== "") return explicit;
  if (observed !== undefined && observed !== null && observed !== "") return observed;
  return undefined;
}

/**
 * Maps the wire `flowStatus` (the SDK's FlowStatus enum names) to the
 * watcher's status. Completed, failed, terminated, canceled and the
 * server-side timeout are terminal (audit C34: only the first two used to
 * be); RUNNING and CONTINUED_AS_NEW (the flow lives on in a new run) keep the
 * watch going; anything absent or unrecognized is "unknown", which never
 * terminates.
 */
export function flowStatusFromWire(wire: string | null | undefined): WatcherFlowStatus {
  switch (wire) {
    case "FLOW_STATUS_COMPLETED":
      return "completed";
    case "FLOW_STATUS_FAILED":
      return "failed";
    case "FLOW_STATUS_TERMINATED":
      return "terminated";
    case "FLOW_STATUS_CANCELED":
      return "canceled";
    case "FLOW_STATUS_SERVER_SIDE_TIMEOUT_INTERNAL_ONLY":
      return "timeout";
    case "FLOW_STATUS_RUNNING":
    case "FLOW_STATUS_CONTINUED_AS_NEW":
      return "running";
    default:
      return "unknown";
  }
}
