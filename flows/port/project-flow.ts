/**
 * PortProjectFlow — flow registration of the v1 core loop (port.Project). The
 * loop shape and the design notes live with the steps: flows/port/prep-steps.ts
 * (Phase 3 prep), flows/port/project-steps.ts (dispatch, queues, waves) and
 * flows/port/file-steps.ts (the per-file pipeline).
 */

import { StepList } from "@superdurable/dex";
import type { Flow } from "@superdurable/dex";

import { envelopeStream } from "../steps/envelope.js";
import {
  CaptureDiffStep,
  CommitStep,
  FenceStep,
  FixerStart,
  FixerStep,
  ImplementStart,
  ImplementStep,
  IntegrateStep,
  PrioritizeStep,
  QueueFixStart,
  QueueFixStep,
  ReviewAStart,
  ReviewAStep,
  ReviewBStart,
  ReviewBStep,
  VerdictCheckStep,
} from "./file-steps.js";
import {
  PrepDiffCaptureStep,
  PrepFinalizeStep,
  PrepGenerateStep,
  PrepLoopDecisionStep,
  PrepReviewAStart,
  PrepReviewAStep,
  PrepReviewBStart,
  PrepReviewBStep,
  PrepReviseStart,
  PrepReviseStep,
  PrepStart,
  PrepStep,
  PrepVerdictCheckStep,
  SymbolStart,
  SymbolTableStep,
} from "./prep-steps.js";
import {
  BootstrapStep,
  DispatchStep,
  FinalStep,
  LeaseStep,
  QueueVerifyStep,
  ReleaseStep,
  WaveDispatchStep,
  WaveJoinStep,
} from "./project-steps.js";
import { portPersistenceSchema, type PortRunInput } from "./state.js";

export class PortProjectFlow implements Flow<PortRunInput> {
  readonly prep = new PrepStep();
  readonly symbolStart = new SymbolStart();
  readonly symbolTable = new SymbolTableStep();
  readonly prepStart = new PrepStart();
  readonly prepGenerate = new PrepGenerateStep();
  readonly prepDiffCapture = new PrepDiffCaptureStep();
  readonly prepReviewAStart = new PrepReviewAStart();
  readonly prepReviewA = new PrepReviewAStep();
  readonly prepReviewBStart = new PrepReviewBStart();
  readonly prepReviewB = new PrepReviewBStep();
  readonly prepVerdictCheck = new PrepVerdictCheckStep();
  readonly prepLoopDecision = new PrepLoopDecisionStep();
  readonly prepReviseStart = new PrepReviseStart();
  readonly prepRevise = new PrepReviseStep();
  readonly prepFinalize = new PrepFinalizeStep();
  readonly dispatch = new DispatchStep();
  readonly lease = new LeaseStep();
  readonly fence = new FenceStep();
  readonly implementStart = new ImplementStart();
  readonly implement = new ImplementStep();
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
  readonly integrate = new IntegrateStep();
  readonly bootstrap = new BootstrapStep();
  readonly release = new ReleaseStep();
  readonly queueVerify = new QueueVerifyStep();
  readonly queueFixStart = new QueueFixStart();
  readonly queueFix = new QueueFixStep();
  readonly waveDispatch = new WaveDispatchStep();
  readonly waveJoin = new WaveJoinStep();
  readonly final = new FinalStep();

  getFlowType(): string {
    return "port.Project";
  }

  getSteps() {
    return StepList.startStep(this.prep).otherSteps(
      this.symbolStart,
      this.symbolTable,
      this.prepStart,
      this.prepGenerate,
      this.prepDiffCapture,
      this.prepReviewAStart,
      this.prepReviewA,
      this.prepReviewBStart,
      this.prepReviewB,
      this.prepVerdictCheck,
      this.prepLoopDecision,
      this.prepReviseStart,
      this.prepRevise,
      this.prepFinalize,
      this.dispatch,
      this.lease,
      this.fence,
      this.implementStart,
      this.implement,
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
      this.integrate,
      this.bootstrap,
      this.release,
      this.queueVerify,
      this.queueFixStart,
      this.queueFix,
      this.waveDispatch,
      this.waveJoin,
      this.final,
    );
  }

  getPersistenceSchema() {
    // US-002 telemetry stream: dex's Registry allows ONE flow type to own a
    // given Stream instance. port.Project owns `envelopeStream` here; the
    // worker's runner-side publisher (Client.writeStream) uses it for every
    // mirrored envelope event (child flows included — flowId is the
    // per-instance key; open question for US-007 consumers, recorded in
    // flows/steps/envelope.ts).
    return { ...portPersistenceSchema(), streams: [envelopeStream] };
  }
}
