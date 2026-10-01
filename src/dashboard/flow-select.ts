/**
 * Which dex flows get state/history queries on each /api/state snapshot.
 *
 * Raw recency is the wrong key: the default parallel dispatch mode creates a
 * SubFlow `port.File` child per file per wave, and every child starts AFTER
 * its parent `port.Project`, so a newest-N cut evicts the parent once ~N
 * children exist. The parent owns the pp-queue / pp-lease / pp-verdict
 * attributes, so the headline, queue summary, lease grid rows and DEGRADED
 * detection would vanish mid-run. Selection is therefore by priority.
 *
 * The headline run's own children are all selected (B17): the per-file verdict,
 * tombstone and usage attributes live in them, and a child dropped from the
 * selection takes its DEGRADED round, its usage and its feed rows with it, so an
 * early degraded round would read as clean once later waves exist. The child
 * cap therefore bounds the children of OTHER runs; the headline run has only a
 * safety ceiling.
 */

import { belongsToRun, isSubFlowChild, sortFlowsNewestFirst } from "./state.js";
import type { DexFlowSummaryWire } from "./types.js";

/** Default total budget of flows that get state/history queries. */
export const DEFAULT_MAX_FLOWS = 12;
/** Default cap on SubFlow children of runs OTHER than the headline run (separate from parents). */
export const DEFAULT_MAX_CHILD_FLOWS = 8;
/** Safety ceiling on the headline run's own children (RUNNING first, then newest). */
export const DEFAULT_MAX_HEADLINE_CHILD_FLOWS = 128;
/** Default cap on top-level port.Project runs kept first (newest first). */
const DEFAULT_MAX_PARENT_FLOWS = 3;

/** Flows worth querying: the porting pipeline and the Phase 0 probe flows. */
export function flowOfInterest(flowType: string): boolean {
  return flowType.startsWith("port.") || flowType.startsWith("probe.");
}

export interface FlowSelectionOptions {
  /** Total budget (min 1). */
  maxFlows: number;
  /** Cap on SubFlow children of runs other than the headline run. Default 8. */
  maxChildFlows?: number;
  /** Safety ceiling on the headline run's own children, all of which are kept below it. Default 128. */
  maxHeadlineChildFlows?: number;
  /** Cap on top-level port.Project runs that are always kept first. Default 3. */
  maxParentFlows?: number;
}

function isRunning(flow: DexFlowSummaryWire): boolean {
  return /RUNNING/i.test(flow.flowStatus ?? "");
}

/**
 * Picks the flows to query, newest-first in the result:
 * 1. the newest top-level `port.Project` runs (up to `maxParentFlows`) ALWAYS;
 * 2. every SubFlow child of the newest of them (the headline run), up to
 *    `maxHeadlineChildFlows`, RUNNING ones first;
 * 3. then RUNNING flows, then recent flows, filling the rest of the budget,
 *    with the SubFlow children of other runs limited to `maxChildFlows`.
 */
export function selectFlows(
  flows: readonly DexFlowSummaryWire[],
  options: FlowSelectionOptions,
): DexFlowSummaryWire[] {
  const total = Math.max(1, Math.floor(options.maxFlows));
  const maxParents = Math.max(1, Math.min(total, Math.floor(options.maxParentFlows ?? DEFAULT_MAX_PARENT_FLOWS)));
  const maxChildren = Math.max(0, Math.floor(options.maxChildFlows ?? DEFAULT_MAX_CHILD_FLOWS));
  const maxHeadlineChildren = Math.max(
    0,
    Math.floor(options.maxHeadlineChildFlows ?? DEFAULT_MAX_HEADLINE_CHILD_FLOWS),
  );

  const sorted = sortFlowsNewestFirst(flows);
  const chosen = new Set<DexFlowSummaryWire>();
  for (const flow of sorted) {
    if (chosen.size >= maxParents) break;
    if (!isSubFlowChild(flow.flowId) && flow.flowType === "port.Project") chosen.add(flow);
  }

  // The headline run is the newest port.Project; all its children come along.
  const headline = sorted.find((f) => chosen.has(f));
  const ownChild = (f: DexFlowSummaryWire): boolean =>
    headline !== undefined && isSubFlowChild(f.flowId) && belongsToRun(f.flowId, headline.flowId);
  const own = sorted.filter(ownChild);
  for (const child of [...own.filter(isRunning), ...own.filter((f) => !isRunning(f))].slice(0, maxHeadlineChildren)) {
    chosen.add(child);
  }

  // The ceiling is a hard bound: the headline run's children beyond it are not
  // re-admitted through the general budget below.
  const rest = sorted.filter((f) => !chosen.has(f) && !ownChild(f));
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
