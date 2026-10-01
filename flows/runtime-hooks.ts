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

/**
 * Every fault the worker can inject, in one table (B13). A fault is armed by an
 * exact string `<kind>:<target>` (see {@link faultMatches}); a spec nothing
 * matches arms nothing and the rehearsal "passes" vacuously, so the worker
 * validates the spec against this table before it starts.
 */
export interface FaultKind {
  kind: string;
  /** The flows that contain the crash point; a fault for the other flows never fires. */
  flows: "probe" | "port";
  /** The target shape, for the usage text. */
  target: string;
  accepts: (target: string) => boolean;
  /** Where the worker dies (or what it injects). */
  effect: string;
}

const isFileRound = (target: string): boolean => /^.+#[1-9]\d*$/.test(target);
const isSeed = (target: string): boolean => target === "seed";

export const FAULT_KINDS: readonly FaultKind[] = [
  {
    kind: "commit:post-commit",
    flows: "probe",
    target: "<file>#<round>",
    accepts: isFileRound,
    effect: "SIGKILL after the keyed git commit lands, before the completion marker persists",
  },
  {
    kind: "agent-write:mid",
    flows: "probe",
    target: "<file>#<round>",
    accepts: isFileRound,
    effect: "SIGKILL in the middle of the agent's file write",
  },
  {
    kind: "symbol-table:post",
    flows: "port",
    target: "seed",
    accepts: isSeed,
    effect: "SIGKILL after the symbol-table Jev loop, before its durable write",
  },
  {
    kind: "queue-verify:inject-error",
    flows: "port",
    target: "seed",
    accepts: isSeed,
    effect: "queue verify iteration 1 sees one synthetic tsc error, so a fix round runs (no crash)",
  },
];

/** One line per fault kind, for a usage text. */
export function faultKindsUsage(): string {
  return FAULT_KINDS.map((k) => `${k.kind}:${k.target} (--flows ${k.flows}: ${k.effect})`).join("; ");
}

/** Why `spec` could never fire for `flows`, or null when it can. */
export function faultSpecProblem(spec: string, flows: "probe" | "port"): string | null {
  const kind = FAULT_KINDS.find((k) => spec.startsWith(`${k.kind}:`));
  if (kind === undefined) {
    return `unknown fault ${JSON.stringify(spec)}; use one of: ${faultKindsUsage()}`;
  }
  const target = spec.slice(kind.kind.length + 1);
  if (!kind.accepts(target)) {
    return `fault ${kind.kind} takes the target ${kind.target} (got ${JSON.stringify(target)})`;
  }
  if (kind.flows !== flows) {
    return `fault ${kind.kind} belongs to the ${kind.flows} flows and the worker runs --flows ${flows}, so it would never fire`;
  }
  return null;
}

/** Deterministic crash point: SIGKILL this worker process (kill smokes). */
export function crashPortWorker(where: string): never {
  console.error(`[fault-injection] deterministic SIGKILL at ${where} (pid ${process.pid})`);
  process.kill(process.pid, "SIGKILL");
  throw new Error(`unreachable after SIGKILL at ${where}`);
}
