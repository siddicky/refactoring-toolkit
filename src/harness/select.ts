/**
 * Harness selection for the worker / recovery commands (audit C20).
 *
 * `OpencodeHarness.connect()` only builds an SDK client and does no I/O, so
 * the old "try connect, fall back to the stub on error" could never fire for
 * an unreachable server: the worker came up "live" and failed at its first
 * createSession. Selection now probes the server (OpencodeHarness.probe) and
 * applies one explicit rule per requested mode:
 *
 *   stub      the labelled test double, no network.
 *   opencode  probe; an unreachable server is a hard failure (throws).
 *   auto      probe; unreachable -> LOUD warning + the labelled stub.
 *             (default when the flag is absent)
 *
 * Anything else is rejected instead of silently behaving like `auto`.
 */

import {
  OpencodeHarness,
  type AgentSessionClient,
  type ProbeResult,
} from "./opencode.js";

export const HARNESS_CHOICES = ["stub", "opencode", "auto"] as const;
export type HarnessChoice = (typeof HARNESS_CHOICES)[number];

/** `--harness` value -> mode. Absent / blank = auto; unknown values throw. */
export function parseHarnessChoice(raw: string | undefined): HarnessChoice {
  const value = raw?.trim() ?? "";
  if (value === "") return "auto";
  if ((HARNESS_CHOICES as readonly string[]).includes(value)) return value as HarnessChoice;
  throw new Error(
    `unknown --harness value ${JSON.stringify(raw)}; expected one of ${HARNESS_CHOICES.join("|")}`,
  );
}

/** The slice of OpencodeHarness that selection needs (lets tests inject a double). */
export interface ProbeableHarness extends AgentSessionClient {
  readonly baseUrl: string | undefined;
  probe(timeoutMs?: number): Promise<ProbeResult>;
}

export interface SelectHarnessOptions {
  /** Raw `--harness` value (or HARNESS env for recover). */
  choice: string | undefined;
  /** OPENCODE_BASE_URL (undefined = the harness default). */
  baseUrl?: string | undefined;
  /** Generic default model for the real harness. */
  model?: { providerID: string; modelID: string } | undefined;
  /** Builds the labelled test double. */
  makeStub: () => AgentSessionClient;
  /** Probe deadline in ms (default: the harness default). */
  probeTimeoutMs?: number | undefined;
  /** Loud-warning sink (default console.error). */
  warn?: ((message: string) => void) | undefined;
  /** Real-harness factory (default OpencodeHarness.connect). */
  connect?:
    | ((
        baseUrl: string | undefined,
        model: { providerID: string; modelID: string } | undefined,
      ) => Promise<ProbeableHarness>)
    | undefined;
}

export async function selectHarness(opts: SelectHarnessOptions): Promise<AgentSessionClient> {
  const choice = parseHarnessChoice(opts.choice);
  if (choice === "stub") return opts.makeStub();

  const connect = opts.connect ?? ((url, model) => OpencodeHarness.connect(url, model));
  const harness = await connect(opts.baseUrl, opts.model);
  const probe = await harness.probe(opts.probeTimeoutMs);
  if (probe.ok) return harness;

  const where = harness.baseUrl ?? opts.baseUrl ?? "(default base URL)";
  if (choice === "opencode") {
    throw new Error(
      `--harness opencode: opencode server at ${where} is not reachable (${probe.reason}). Start it, fix OPENCODE_BASE_URL, or pass --harness stub for the test double.`,
    );
  }
  (opts.warn ?? ((m: string) => console.error(m)))(
    `[run-demo] WARNING: opencode server at ${where} is not reachable (${probe.reason}); --harness auto is FALLING BACK to StubHarness — a labelled test double: fixture token counts, NO real model calls. Pass --harness opencode to fail instead.`,
  );
  return opts.makeStub();
}

/** One-line description of the harness actually in use (for startup banners). */
export function describeHarness(client: AgentSessionClient): string {
  if (client instanceof OpencodeHarness) {
    return `OpencodeHarness@${client.baseUrl ?? "(unknown base URL)"}`;
  }
  return `${client.constructor.name} (test double)`;
}
