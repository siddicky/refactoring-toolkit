/**
 * Which dex flows get state/history queries on each /api/state snapshot.
 *
 * Raw recency is the wrong key: the default parallel dispatch mode creates a
 * SubFlow `port.File` child per file per wave, and every child starts AFTER
 * its parent `port.Project`, so a newest-N cut evicts the parent once ~N
 * children exist. The parent owns the pp-queue / pp-lease / pp-verdict
 * attributes, so the headline, queue summary, lease grid rows and DEGRADED
 * detection would vanish mid-run. Selection is therefore by priority.
 */

import { isSubFlowChild, sortFlowsNewestFirst } from "./state.js";
import type { DexFlowSummaryWire } from "./types.js";

/** Default total budget of flows that get state/history queries. */
export const DEFAULT_MAX_FLOWS = 12;
/** Default cap on SubFlow children inside that budget (separate from parents). */
export const DEFAULT_MAX_CHILD_FLOWS = 8;
/** Default cap on top-level port.Project runs kept first (newest first). */
export const DEFAULT_MAX_PARENT_FLOWS = 3;

/** Flows worth querying: the porting pipeline and the Phase 0 probe flows. */
export function flowOfInterest(flowType: string): boolean {
  return flowType.startsWith("port.") || flowType.startsWith("probe.");
}

export interface FlowSelectionOptions {
  /** Total budget (min 1). */
  maxFlows: number;
  /** Cap on SubFlow children within the budget. Default 8. */
  maxChildFlows?: number;
  /** Cap on top-level port.Project runs that are always kept first. Default 3. */
  maxParentFlows?: number;
}

function isRunning(flow: DexFlowSummaryWire): boolean {
  return /RUNNING/i.test(flow.flowStatus ?? "");
}

/**
 * Picks the flows to query, newest-first in the result:
 * 1. the newest top-level `port.Project` runs (up to `maxParentFlows`) ALWAYS;
 * 2. then RUNNING flows, then recent flows, filling the rest of the budget,
 *    with SubFlow children limited to `maxChildFlows`.
 */
export function selectFlows(
  flows: readonly DexFlowSummaryWire[],
  options: FlowSelectionOptions,
): DexFlowSummaryWire[] {
  const total = Math.max(1, Math.floor(options.maxFlows));
  const maxParents = Math.max(1, Math.min(total, Math.floor(options.maxParentFlows ?? DEFAULT_MAX_PARENT_FLOWS)));
  const maxChildren = Math.max(0, Math.floor(options.maxChildFlows ?? DEFAULT_MAX_CHILD_FLOWS));

  const sorted = sortFlowsNewestFirst(flows);
  const chosen = new Set<DexFlowSummaryWire>();
  for (const flow of sorted) {
    if (chosen.size >= maxParents) break;
    if (!isSubFlowChild(flow.flowId) && flow.flowType === "port.Project") chosen.add(flow);
  }

  const rest = sorted.filter((f) => !chosen.has(f));
  const ranked = [...rest.filter(isRunning), ...rest.filter((f) => !isRunning(f))];
  let children = 0;
  for (const flow of ranked) {
    if (chosen.size >= total) break;
    if (isSubFlowChild(flow.flowId)) {
      if (children >= maxChildren) continue;
      children += 1;
    }
    chosen.add(flow);
  }
  return sorted.filter((f) => chosen.has(f));
}
