/**
 * The one forward reference in the port step graph.
 *
 * dex steps route with `goTo(StepClass, input)`, so every step module has to
 * name its successors' classes. The graph is genuinely cyclic (dispatch ->
 * lease -> ... -> commit -> integrate -> release -> bootstrap -> dispatch), and
 * ES module cycles that reach a top-level `new Step()` (the flow classes) are
 * evaluation-order dependent. The modules are therefore layered, each layer
 * importing only the ones below it:
 *
 *   project-flow               (port.Project)
 *   prep-steps                 (the prep loop; ends in DispatchStep)
 *   project-steps              (dispatch, release, queues, waves; imports file-flow)
 *   file-flow                  (port.File: registers file-steps only)
 *   file-steps                 (per-file pipeline, shared by both flows)
 *   state, queue-logic, leases, lane-b, agent-turns, review-turn, queue-tools,
 *   bootstrap, step-options    (leaves: no step, no goTo())
 *
 * and the single edge that points UP the layering — the sequential tail's
 * IntegrateStep (file-steps) handing over to ReleaseStep (project-steps) — is
 * late-bound here. project-steps binds it when it is evaluated; reading it
 * earlier fails loudly instead of routing to `undefined`.
 * tests/port-project-exports.test.ts pins that the import graph stays acyclic.
 */

import type { EnvelopeStepClass } from "../steps/envelope.js";
import type { FileRoundInput } from "./state.js";

/** A late-bound step class: bound once by its defining module, read at route time. */
export interface StepLink<Input> {
  bind(step: EnvelopeStepClass<Input>): void;
  get(): EnvelopeStepClass<Input>;
}

function stepLink<Input>(name: string): StepLink<Input> {
  let bound: EnvelopeStepClass<Input> | undefined;
  return {
    bind: (step) => {
      bound = step;
    },
    get: () => {
      if (bound === undefined) {
        throw new Error(`${name} step is not linked: flows/port/project-steps.ts was never loaded`);
      }
      return bound;
    },
  };
}

/** IntegrateStep (file-steps) -> ReleaseStep (project-steps), sequential mode only. */
export const releaseStepLink: StepLink<FileRoundInput> = stepLink<FileRoundInput>("PpRelease");
