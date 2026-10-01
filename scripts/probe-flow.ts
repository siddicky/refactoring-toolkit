/**
 * Phase 0 probe flows — side-effect-real scaffolding for the exit criteria
 * 0(a)-0(e). These flows exercise the REAL seams (envelope factory, git
 * worktree operations, session fencing) against a live dex server; they are
 * retained as upgrade regression suites when the wider toolkit lands.
 *
 * Deterministic fault injection (exit 0d): set PORTING_KIT_FAULT to one of
 *   commit:post-commit:<file>#<round>   — crash the worker AFTER the keyed
 *                                         git commit lands, BEFORE the
 *                                         completion marker decision persists
 *   agent-write:mid:<file>#<round>      — crash the worker mid agent write
 *
 * The `agent` role steps call the harness injected via configureProbe(). With
 * a reachable opencode server (OPENCODE_BASE_URL, or the default
 * http://127.0.0.1:4096) the real harness is used; under --harness auto an
 * unreachable server falls back to a labelled StubHarness with a loud warning;
 * --harness stub is explicit (src/harness/select.ts). The stub is a labeled
 * test double — its token numbers are deterministic test fixtures, never
 * reported as live usage.
 */

import {
  AttributeMap,
  StepList,
  jsonCodec,
  stringCodec,
  goTo,
} from "@superdurable/dex";
import type { Context, Flow, StepDecision } from "@superdurable/dex";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  envelopeStepClass,
  envelopeStream,
  persistenceAttributes,
  type EnvelopeOutcome,
} from "../flows/steps/envelope.js";
import {
  fenceLabel,
  sessionFenceMap,
  type AgentSessionClient,
} from "../src/harness/opencode.js";
import {
  commitLeaseChanges,
  findCommitByOpId,
  integratedContentExists,
  mergeLeaseIntoIntegration,
  operationId,
  type CompletionMarker,
} from "../src/git/worktree.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Probe-durable attributes
// ---------------------------------------------------------------------------

/** Completion markers — plan payload: {round, disposition, content_hash}. */
export const completionMarkers = new AttributeMap<CompletionMarker>(
  "completion-marker",
  jsonCodec<CompletionMarker>(),
);
/** Captured diffs stored pass-by-value (plan §Flow contract step 2). */
export const capturedDiffs = new AttributeMap<string>("captured-diff", stringCodec);

/** AttributeMap instances prohibit `/`. */
export function markerKey(file: string, round: number): string {
  return `${file.replace(/\//g, "__")}#${round}`;
}

export function probePersistenceSchema(): {
  attributes: readonly (
    | AttributeMap<CompletionMarker>
    | AttributeMap<string>
    | ReturnType<typeof persistenceAttributes>[number]
  )[];
} {
  return {
    attributes: [...persistenceAttributes(), completionMarkers, capturedDiffs],
  };
}

// ---------------------------------------------------------------------------
// Deterministic fault injection
// ---------------------------------------------------------------------------

export type FaultSpec = string | undefined;

let FAULT: FaultSpec = undefined;
let HARNESS: AgentSessionClient | undefined = undefined;

export function configureProbe(harness: AgentSessionClient, fault: FaultSpec): void {
  HARNESS = harness;
  FAULT = fault;
}

export function faultMatches(kind: string, opId: string): boolean {
  return FAULT === `${kind}:${opId}`;
}

/** Deterministic crash point: SIGKILL this worker process. */
export function crashSelf(where: string): never {
  console.error(`[fault-injection] deterministic SIGKILL at ${where} (pid ${process.pid})`);
  process.kill(process.pid, "SIGKILL");
  throw new Error(`unreachable after SIGKILL at ${where}`);
}

// ---------------------------------------------------------------------------
// Shared probe input
// ---------------------------------------------------------------------------

export interface RoundInput {
  file: string;
  round: number;
  epoch: number;
  repoRoot: string;
  worktreePath: string;
  integrationWorktreePath: string;
  promptText: string;
  writtenContent: string;
}

async function gitDiff(worktreePath: string): Promise<string> {
  try {
    const { stdout } = await execFileP("git", ["diff", "HEAD"], { cwd: worktreePath });
    return stdout;
  } catch (err) {
    return `<<diff failed: ${(err as Error).message}>>`;
  }
}

// ---------------------------------------------------------------------------
// HelloFlow — exit 0(a)/0(b) baseline
// ---------------------------------------------------------------------------

const HelloStep = envelopeStepClass<void, { message: string }>({
  stepType: "ProbeHello",
  stepId: "probe-hello",
  role: "record",
  inner: async () => ({ output: { message: "hello from probe flow" }, tokens: null }),
});

export class HelloFlow implements Flow<void> {
  readonly hello = new HelloStep();
  getFlowType(): string {
    return "probe.Hello";
  }
  getSteps() {
    return StepList.startStep(this.hello);
  }
  getPersistenceSchema() {
    // US-002: this probe flow type owns `envelopeStream` in the PROBE
    // registry (probe worker) so the runner-side stream publisher can mirror
    // HelloFlow envelopes; port.Project owns it in the port registry.
    return { ...probePersistenceSchema(), streams: [envelopeStream] };
  }
}

// ---------------------------------------------------------------------------
// LongStepFlow — exit 0(c): multi-minute step survives SIGKILL of server+worker
// ---------------------------------------------------------------------------

const LongSleepStep = envelopeStepClass<{ ms: number }, { sleptMs: number }>({
  stepType: "ProbeLongSleep",
  stepId: "probe-long-sleep",
  role: "record",
  inner: async (_ctx, input) => {
    await new Promise((r) => setTimeout(r, input.ms));
    return { output: { sleptMs: input.ms }, tokens: null };
  },
});

export class LongStepFlow implements Flow<{ ms: number }> {
  readonly sleep = new LongSleepStep();
  getFlowType(): string {
    return "probe.LongStep";
  }
  getSteps() {
    return StepList.startStep(this.sleep);
  }
  getPersistenceSchema() {
    return probePersistenceSchema();
  }
}

// ---------------------------------------------------------------------------
// PortRoundFlow — one file-round: fence → agent write → diff → commit →
// integration. Exits 0(d)/0(d2)/0(d3)/0(e) drive this flow.
// ---------------------------------------------------------------------------

const ProbeFenceStep = envelopeStepClass<RoundInput, { sessionId: string }>({
  stepType: "ProbeFence",
  stepId: "probe-fence",
  role: "record",
  inner: async (ctx, input) => {
    if (HARNESS === undefined) throw new Error("configureProbe() was not called");
    const label = fenceLabel(input.file, input.round, input.epoch);
    // Mini-step semantics: the session exists and the fence lands durably
    // (with this step's decision) BEFORE the agent step prompts.
    const session = await HARNESS.createSession(label);
    sessionFenceMap.set(ctx, label, {
      sessionId: session.id,
      stepId: "probe-agent-write",
      epoch: input.epoch,
      label,
      persistedAtUtc: new Date().toISOString(),
    });
    return { output: { sessionId: session.id }, tokens: null };
  },
  route: (_ctx, input) => goTo(ProbeAgentWriteStep, input),
});

const ProbeAgentWriteStep = envelopeStepClass<RoundInput, { tokensTotal: number | null }>({
  stepType: "ProbeAgentWrite",
  stepId: "probe-agent-write",
  role: "agent",
  // Reads the session fence: AttributeMap reads must be declared per step.
  stepOptions: { executeLoadAttributeMaps: [sessionFenceMap] },
  inner: async (ctx, input) => {
    if (HARNESS === undefined) throw new Error("configureProbe() was not called");
    const opId = operationId(input.file, input.round);
    const label = fenceLabel(input.file, input.round, input.epoch);
    const fence = sessionFenceMap.get(ctx, label);

    if (faultMatches("agent-write:mid", opId)) {
      // Kill during an in-flight agent write, AFTER the fence persisted.
      const target = `${input.worktreePath}/${input.file}`;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, input.writtenContent.slice(0, Math.max(1, input.writtenContent.length >> 1)));
      crashSelf(`agent-write:mid:${opId}`);
    }

    const promptResult = await HARNESS.prompt(
      fence?.sessionId ?? "",
      input.promptText,
    );
    if (promptResult.aborted) {
      throw new Error(`agent session aborted (file=${input.file} round=${input.round})`);
    }
    const target = `${input.worktreePath}/${input.file}`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.writtenContent);
    const total = promptResult.usage === null ? null : tokenSum(promptResult.usage);
    return { output: { tokensTotal: total }, tokens: total };
  },
  route: (_ctx, input) => goTo(ProbeCaptureDiffStep, input),
});

const ProbeCaptureDiffStep = envelopeStepClass<RoundInput, { diffChars: number }>({
  stepType: "ProbeCaptureDiff",
  stepId: "probe-capture-diff",
  role: "diff-capture",
  inner: async (ctx, input) => {
    const diff = await gitDiff(input.worktreePath);
    capturedDiffs.set(ctx, markerKey(input.file, input.round), diff);
    return { output: { diffChars: diff.length }, tokens: null };
  },
  route: (_ctx, input) => goTo(ProbeCommitStep, input),
});

const ProbeCommitStep = envelopeStepClass<RoundInput, { opId: string; dedup: boolean; sha: string | null }>({
  stepType: "ProbeCommit",
  stepId: "probe-commit",
  role: "commit",
  // Reads completion markers (no-op assertion path): declare the map load.
  stepOptions: { executeLoadAttributeMaps: [completionMarkers] },
  inner: async (ctx, input): Promise<{ output: { opId: string; dedup: boolean; sha: string | null }; tokens: number | null; outcome?: EnvelopeOutcome }> => {
    const opId = operationId(input.file, input.round);
    const key = markerKey(input.file, input.round);

    // Sole-committer dedup: keyed lookup scans ALL branches first.
    const keyed = await findCommitByOpId(input.repoRoot, opId);
    if (keyed !== undefined) {
      completionMarkers.set(ctx, key, {
        round: input.round,
        disposition: `committed:${opId}`,
        content_hash: keyed.contentHash ?? keyed.sha,
      });
      return {
        output: { opId, dedup: true, sha: keyed.sha },
        tokens: null,
        outcome: "skipped",
      };
    }

    const res = await commitLeaseChanges(
      input.worktreePath,
      opId,
      `porting-toolkit: port ${input.file} (round ${input.round})`,
    );

    // Deterministic fault injection (exit 0d): the keyed commit has LANDED as
    // a side effect; the marker decision has NOT persisted. The retry (next
    // worker) must dedup via the op-ID lookup above, never re-commit.
    if (res.sha !== null && faultMatches("commit:post-commit", opId)) {
      crashSelf(`commit:post-commit:${opId}`);
    }

    completionMarkers.set(ctx, key, {
      round: input.round,
      disposition: res.disposition,
      content_hash: res.contentHash,
    });
    return {
      output: { opId, dedup: false, sha: res.sha },
      tokens: null,
      outcome: res.disposition === "no-op-empty-diff" ? "skipped" : "completed",
    };
  },
  route: (_ctx, input) => goTo(ProbeIntegrateStep, input),
});

const ProbeIntegrateStep = envelopeStepClass<RoundInput, { integratedSha: string; fastForward: boolean }>({
  stepType: "ProbeIntegrate",
  stepId: "probe-integrate",
  role: "integration",
  // Reads the completion marker for the no-op content assertion.
  stepOptions: { executeLoadAttributeMaps: [completionMarkers] },
  inner: async (ctx, input) => {
    const result = await mergeLeaseIntoIntegration(
      input.repoRoot,
      input.integrationWorktreePath,
      (await leaseBranchOf(input)),
      "integration",
    );
    // No-op rounds presuppose prior committed content in the output project.
    const key = markerKey(input.file, input.round);
    const marker = completionMarkers.get(ctx, key);
    if (marker !== undefined && marker.disposition === "no-op-empty-diff") {
      const exists = await integratedContentExists(
        input.integrationWorktreePath,
        input.file,
      );
      if (!exists) {
        throw new Error(
          `no-op round for ${input.file} but integrated output lacks the file`,
        );
      }
    }
    return { output: { integratedSha: result.sha, fastForward: result.fastForward }, tokens: null };
  },
});

async function leaseBranchOf(input: RoundInput): Promise<string> {
  const { stdout } = await execFileP(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: input.worktreePath },
  );
  return stdout.trim();
}

function tokenSum(usage: { input: number; output: number; reasoning: number; cacheRead: number; cacheWrite: number }): number {
  return usage.input + usage.output + usage.reasoning + usage.cacheRead + usage.cacheWrite;
}

export class PortRoundFlow implements Flow<RoundInput> {
  readonly fence = new ProbeFenceStep();
  readonly agentWrite = new ProbeAgentWriteStep();
  readonly captureDiff = new ProbeCaptureDiffStep();
  readonly commit = new ProbeCommitStep();
  readonly integrate = new ProbeIntegrateStep();

  getFlowType(): string {
    return "probe.PortRound";
  }
  getSteps() {
    return StepList.startStep(this.fence).otherSteps(
      this.agentWrite,
      this.captureDiff,
      this.commit,
      this.integrate,
    );
  }
  getPersistenceSchema() {
    return probePersistenceSchema();
  }
}

export function probeFlows(): Flow<any>[] {
  return [new HelloFlow(), new LongStepFlow(), new PortRoundFlow()];
}

export type { Context, StepDecision };
