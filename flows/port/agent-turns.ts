/**
 * Agent-turn plumbing of the port flows: the worker-injected harness seam, the
 * one-turn prompt composition + bridge-mode tool policy, the lease-worktree
 * file/diff helpers, and the fenced-session opener every model step uses.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  tokenTotal,
  type AgentSessionClient,
} from "../../src/harness/opencode.js";
import { git } from "../../src/git/exec.js";
import type { AgentDefinition } from "../../harness/agents/types.js";
import type { TokenUsage } from "../../src/metrics/types.js";
import { toEnvelopeUsage, toolOverridesAllOff, toolPolicyBlock } from "../../src/harness/runtime.js";

// Harness injection (worker calls configurePortHarness at startup)
// ---------------------------------------------------------------------------

let PORT_HARNESS: AgentSessionClient | undefined;

export function configurePortHarness(harness: AgentSessionClient): void {
  PORT_HARNESS = harness;
}

export function requireHarness(): AgentSessionClient {
  if (PORT_HARNESS === undefined) {
    throw new Error("configurePortHarness() was not called by the worker");
  }
  return PORT_HARNESS;
}

/** One agent turn: definition prompt + enforced tool policy + turn text. */
export function composeAgentTurn(def: AgentDefinition, turn: string): string {
  return [def.prompt, "", toolPolicyBlock(def), "", turn].join("\n\n");
}

/**
 * Stages everything in the lease worktree and returns the staged diff. Goes
 * through src/git/exec.ts so the 30s timeout and 64 MiB buffer apply (a bare
 * promisified execFile has Node's 1 MiB default buffer and no timeout).
 */
export async function gitDiffStaged(worktreePath: string): Promise<string> {
  const runner = git(worktreePath);
  await runner.run(["add", "-A"]);
  return runner.run(["diff", "--cached"]);
}

export async function writeOutFile(worktreePath: string, outPath: string, content: string): Promise<void> {
  const target = join(worktreePath, outPath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

interface AgentTurnResult {
  text: string;
  tokens: number | null;
  /** Full provider usage split (metrics-shaped); null when usage was absent. */
  usage: TokenUsage | null;
}

export async function runAgentTurn(input: {
  def: AgentDefinition;
  sessionId: string;
  turn: string;
  file: string;
  round: number;
  agent?: string;
  /** Per-turn model override (reviewer lane swap; undefined = default lane). */
  model?: { providerID: string; modelID: string };
  /** Per-turn reasoning variant (lane policy: src/harness/lanes.ts). */
  variant?: string;
}): Promise<AgentTurnResult> {
  const harness = requireHarness();
  // Bridge mode: ALL server-side tools disabled for every agent turn; the
  // toolkit mediates writes into the lease worktree (see toolOverridesAllOff).
  const reply = await harness.prompt(input.sessionId, composeAgentTurn(input.def, input.turn), {
    tools: toolOverridesAllOff(),
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.variant !== undefined ? { variant: input.variant } : {}),
  });
  if (reply.aborted) {
    throw new Error(`agent session aborted (file=${input.file} round=${input.round})`);
  }
  const tokens = reply.usage === null ? null : tokenTotal(reply.usage);
  // Wave-5 cost honesty: prefer the full usage split over the bare total —
  // the envelope contract accepts both; tokenTotalOf normalizes downstream.
  const usage = reply.usage === null ? null : toEnvelopeUsage(reply.usage);
  return { text: reply.text, tokens, usage };
}
