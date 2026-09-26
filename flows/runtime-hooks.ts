/**
 * Flow-side runtime hooks: judgment-client wiring (Phase 3 Jev swap-in) and
 * deterministic fault injection (kill smokes), kept in ONE small module so
 * the flow steps depend on a narrow seam instead of env/SDK details.
 *
 * - configurePortJudgment: the worker resolves the Jev client ONCE
 *   (offline → deterministic in-memory double; TYPESAFE_API_KEY → real SDK
 *   client) and injects it. Without a key the port loop's verdict-check /
 *   prioritize steps stay NAIVE (never see the client).
 * - configurePortFault / faultMatches: deterministic crash points for the
 *   kill smokes (PORTING_KIT_FAULT env), same mechanism as the Phase 0 probe.
 */

import { execFileSync } from "node:child_process";
import type { JudgmentClient } from "../src/typesafe/client.js";
import type { TurnHealthAssessor } from "../src/metrics/types.js";

let PORT_JUDGMENT: JudgmentClient | undefined;
let PORT_FAULT: string | undefined;
/**
 * Tier-1 turn-health assessor (US-003). NULL by default = Tier-1 unavailable:
 * ambiguous turns degrade to no-diagnosis and the step proceeds unchanged
 * (AC-B3). The IMPLEMENTATION lives in src/typesafe/turn-health.ts — this
 * module (and every control-flow module) imports only the interface; the
 * import-boundary test asserts the judgment module is never loaded by flows.
 */
let PORT_TURN_HEALTH: TurnHealthAssessor | null = null;

export function configurePortJudgment(client: JudgmentClient): void {
  PORT_JUDGMENT = client;
}

/** Injects (or removes, null) the Tier-1 assessor. Runner-side, idempotent. */
export function configureTurnHealthAssessor(assessor: TurnHealthAssessor | null): void {
  PORT_TURN_HEALTH = assessor;
}

/** The configured assessor, or null when Tier-1 is unavailable (fail-open). */
export function portTurnHealthAssessor(): TurnHealthAssessor | null {
  return PORT_TURN_HEALTH;
}

export function requirePortJudgment(): JudgmentClient {
  if (PORT_JUDGMENT === undefined) {
    throw new Error("configurePortJudgment() was not called by the worker");
  }
  return PORT_JUDGMENT;
}

/** True when a REAL (billed) Jev client is configured — gates the swap-in. */
export function portJevLive(): boolean {
  return PORT_JUDGMENT?.kind === "real";
}

export function configurePortFault(fault: string | undefined): void {
  PORT_FAULT = fault;
}

export function faultMatches(kind: string, target: string): boolean {
  return PORT_FAULT === `${kind}:${target}`;
}

/** Deterministic crash point: SIGKILL this worker process (kill smokes). */
export function crashPortWorker(where: string): never {
  console.error(`[fault-injection] deterministic SIGKILL at ${where} (pid ${process.pid})`);
  process.kill(process.pid, "SIGKILL");
  throw new Error(`unreachable after SIGKILL at ${where}`);
}

/**
 * Resolves tsc/vitest binaries for the toolkit-owned queue steps WITHOUT
 * network: prefers the toolkit's own node_modules (.bin) and falls back to
 * bare names. Used by scripts/flows that run queues on the integration
 * checkout; exported for tests.
 */
export function queueBin(rootDir: string, name: "tsc" | "vitest"): string | null {
  for (const candidate of [
    `${rootDir}/node_modules/.bin/${name}`,
    name,
  ]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore", timeout: 30_000 });
      return candidate;
    } catch {
      // try next candidate
    }
  }
  return null;
}
