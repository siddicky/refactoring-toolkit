/**
 * Status-server configuration (env parsing). Extracted from
 * scripts/serve-status.ts so it is importable (and testable) without starting
 * the server.
 */

import { DEFAULT_MAX_CHILD_FLOWS, DEFAULT_MAX_FLOWS } from "./flow-select.js";

export interface StatusConfig {
  port: number;
  host: string;
  repoRoot: string;
  dexcliBin: string;
  dexServer: string;
  maxFlows: number;
  maxChildFlows: number;
  killEventFiles: string[];
  burnDownFiles: string[];
  feedLimit: number;
  commitLimit: number;
}

export function csv(value: string | undefined, fallback: string[]): string[] {
  if (value === undefined || value.trim() === "") return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): StatusConfig {
  return {
    port: Number.parseInt(env.PORT ?? "4646", 10),
    host: env.STATUS_HOST?.trim() || "127.0.0.1",
    repoRoot: env.STATUS_REPO_ROOT?.trim() || "/tmp/pk-trial",
    dexcliBin: env.DEXCLI_BIN?.trim() || "dexcli",
    dexServer: env.DEX_SERVER_ADDRESS?.trim() || "127.0.0.1:8801",
    maxFlows: Number.parseInt(env.STATUS_MAX_FLOWS ?? String(DEFAULT_MAX_FLOWS), 10),
    maxChildFlows: Number.parseInt(env.STATUS_MAX_CHILD_FLOWS ?? String(DEFAULT_MAX_CHILD_FLOWS), 10),
    killEventFiles: csv(env.KILL_EVENT_FILES, [
      "metrics/kill-events.json",
      "metrics/kill-events.jsonl",
      "/tmp/kill-events-phase0.jsonl",
    ]),
    burnDownFiles: csv(env.BURN_DOWN_FILES, ["metrics/burn-down.json", "metrics/burn-down.jsonl"]),
    feedLimit: 80,
    commitLimit: 40,
  };
}
