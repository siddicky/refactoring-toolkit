/**
 * PortFileFlow — one file's full pipeline as an independent, kill-safe flow
 * (port.File): the child of a parallel wave. Registers only the per-file
 * pipeline steps (flows/port/file-steps.ts); the parent's WaveJoinStep targets
 * the singleton below through dex SubFlow.
 */

import { StepList } from "@superdurable/dex";
import type { Flow } from "@superdurable/dex";

import {
  CaptureDiffStep,
  ChildLeaseStep,
  ChildReleaseStep,
  CommitStep,
  FenceStep,
  FixerStart,
  FixerStep,
  ImplementStart,
  ImplementStep,
  PrioritizeStep,
  QueueFixStart,
  QueueFixStep,
  ReviewAStart,
  ReviewAStep,
  ReviewBStart,
  ReviewBStep,
  VerdictCheckStep,
} from "./file-steps.js";
import { portPersistenceSchema, type PortFileInput } from "./state.js";

/** Registration helper for the per-file child flow (registered alongside the parent). */
export class PortFileFlow implements Flow<PortFileInput> {
  readonly childLease = new ChildLeaseStep();
  readonly fence = new FenceStep();
  readonly implementStart = new ImplementStart();
  readonly implement = new ImplementStep();
  readonly queueFixStart = new QueueFixStart();
  readonly queueFix = new QueueFixStep();
  readonly captureDiff = new CaptureDiffStep();
  readonly reviewAStart = new ReviewAStart();
  readonly reviewA = new ReviewAStep();
  readonly reviewBStart = new ReviewBStart();
  readonly reviewB = new ReviewBStep();
  readonly verdictCheck = new VerdictCheckStep();
  readonly prioritize = new PrioritizeStep();
  readonly fixerStart = new FixerStart();
  readonly fixer = new FixerStep();
  readonly commit = new CommitStep();
  readonly release = new ChildReleaseStep();

  getFlowType(): string {
    return "port.File";
  }

  getSteps() {
    return StepList.startStep(this.childLease).otherSteps(
      this.fence,
      this.implementStart,
      this.implement,
      this.queueFixStart,
      this.queueFix,
      this.captureDiff,
      this.reviewAStart,
      this.reviewA,
      this.reviewBStart,
      this.reviewB,
      this.verdictCheck,
      this.prioritize,
      this.fixerStart,
      this.fixer,
      this.commit,
      this.release,
    );
  }

  getPersistenceSchema() {
    return portPersistenceSchema();
  }
}

/** The singleton the WaveJoin SubFlows target (must be worker-registered). */
export const PortFileFlowInstance = new PortFileFlow();
