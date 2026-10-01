/**
 * Status-server configuration (env parsing). Extracted from
 * scripts/serve-status.ts so it is importable (and testable) without starting
 * the server.
 *
 * Every numeric knob is validated: a non-numeric, partially numeric,
 * fractional or out-of-range value falls back to the default and records a
 * warning (the server logs them at startup) instead of becoming NaN, which
 * used to blank the whole view (`STATUS_MAX_FLOWS=abc` -> zero flows).
 */

import { DEFAULT_KILL_EVENTS_PATH } from "../metrics/kill-events.js";
import { BLOB_CACHE_DIRS, dexcliFromEnv } from "../dex/defaults.js";
import { parseSwitch } from "../env.js";
import { DEFAULT_MAX_CHILD_FLOWS, DEFAULT_MAX_FLOWS } from "./flow-select.js";

/**
 * The page's poll interval (POLL_MS in static/index.html; asserted equal by
 * tests). Server-side cache TTLs must not be shorter than this.
 */
export const CLIENT_POLL_MS = 2_000;

const DEFAULT_PORT = 4646;

/** The dashboard's own cache: a SIBLING of the worker's, never inside it (src/dex/defaults.ts). */
const DEFAULT_BLOB_CACHE_DIR = BLOB_CACHE_DIRS.dashboard;

/**
 * Kill-event sidecars the dashboard scans by default, relative to the working
 * directory. Data contract B: the writers' default is
 * metrics/kill-events.jsonl (the repo's gitignored /metrics/ run-output dir).
 * The other two are legacy names still found in older runs: the pre-contract
 * metrics/ name and chaos-kill's old cwd default. Files that do not exist are
 * skipped silently.
 */
export const DEFAULT_KILL_EVENT_FILES: readonly string[] = [
  DEFAULT_KILL_EVENTS_PATH,
  "metrics/kill-events.json",
  "kill-events.json",
];

export const DEFAULT_BURN_DOWN_FILES: readonly string[] = ["metrics/burn-down.json", "metrics/burn-down.jsonl"];

export interface StatusConfig {
  port: number;
  host: string;
  /**
   * Extra hostnames accepted in the Host header (DNS-rebinding guard). The
   * loopback names and the bind address are always accepted.
   */
  allowedHosts: string[];
  repoRoot: string;
  dexcliBin: string;
  dexServer: string;
  maxFlows: number;
  maxChildFlows: number;
  killEventFiles: string[];
  burnDownFiles: string[];
  feedLimit: number;
  commitLimit: number;
  /** false when STATUS_STREAM_SUBSCRIBE is off (0/false/no/off): dexcli polling only. */
  streamSubscribe: boolean;
  /**
   * Blob-cache directory of the stream subscriber's read-side client. Under
   * the already-ignored `.dex-cache/`, and deliberately NOT the worker's
   * DEX_BLOB_CACHE_DIR (see stream-feed.ts).
   */
  blobCacheDir: string;
  /** Problems found while reading the environment (invalid values, deprecated names). */
  warnings: string[];
}

/** True for bind addresses that only local processes can reach. */
function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || /^127(?:\.\d{1,3}){3}$/.test(h);
}

function csv(value: string | undefined, fallback: readonly string[]): string[] {
  if (value === undefined || value.trim() === "") return [...fallback];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Strict integer env: blank/absent -> fallback (silently); anything that is
 * not a plain non-negative integer inside [min, max] -> fallback + a warning.
 */
function intEnv(
  raw: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number,
  warnings: string[],
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const text = raw.trim();
  const value = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  if (!Number.isInteger(value) || value < min || value > max) {
    warnings.push(`${name}=${JSON.stringify(raw)} is not an integer in [${min}, ${max}]; using ${fallback}`);
    return fallback;
  }
  return value;
}

/**
 * A switch (src/env.ts parseSwitch): 1/true/yes/on and 0/false/no/off; blank ->
 * fallback silently; anything else -> fallback + a warning. `=false` used to
 * leave the subscriber ON because only the literal "0" opted out.
 */
function switchEnv(raw: string | undefined, name: string, fallback: boolean, warnings: string[]): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = parseSwitch(raw);
  if (value === null) {
    warnings.push(`${name}=${JSON.stringify(raw)} is not one of 1/true/yes/on or 0/false/no/off; using ${fallback ? "on" : "off"}`);
    return fallback;
  }
  return value;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): StatusConfig {
  const warnings: string[] = [];

  // STATUS_PORT is the knob; the generic PORT is only honoured as a legacy
  // fallback when STATUS_PORT is unset (other tools export PORT for themselves).
  let portRaw = env.STATUS_PORT;
  let portName = "STATUS_PORT";
  if ((portRaw === undefined || portRaw.trim() === "") && env.PORT !== undefined && env.PORT.trim() !== "") {
    portRaw = env.PORT;
    portName = "PORT";
    warnings.push("PORT is deprecated for serve-status; use STATUS_PORT");
  }

  const dexcli = dexcliFromEnv(env);
  const host = env.STATUS_HOST?.trim() || "127.0.0.1";
  if (!isLoopbackHost(host)) {
    warnings.push(
      `STATUS_HOST=${host} is not a loopback address: the dashboard has NO authentication and exposes run metadata ` +
        "(repo paths, commit subjects, the activity feed) to anything that can reach it; requests must carry an " +
        "allow-listed Host header (the bind address, plus STATUS_ALLOWED_HOSTS)",
    );
  }

  return {
    port: intEnv(portRaw, portName, DEFAULT_PORT, 0, 65_535, warnings),
    host,
    allowedHosts: csv(env.STATUS_ALLOWED_HOSTS, []),
    repoRoot: env.STATUS_REPO_ROOT?.trim() || cwd,
    dexcliBin: dexcli.bin,
    dexServer: dexcli.server,
    maxFlows: intEnv(env.STATUS_MAX_FLOWS, "STATUS_MAX_FLOWS", DEFAULT_MAX_FLOWS, 1, 500, warnings),
    maxChildFlows: intEnv(env.STATUS_MAX_CHILD_FLOWS, "STATUS_MAX_CHILD_FLOWS", DEFAULT_MAX_CHILD_FLOWS, 0, 500, warnings),
    killEventFiles: csv(env.KILL_EVENT_FILES, DEFAULT_KILL_EVENT_FILES),
    burnDownFiles: csv(env.BURN_DOWN_FILES, DEFAULT_BURN_DOWN_FILES),
    feedLimit: 80,
    commitLimit: 40,
    streamSubscribe: switchEnv(env.STATUS_STREAM_SUBSCRIBE, "STATUS_STREAM_SUBSCRIBE", true, warnings),
    blobCacheDir: env.STATUS_BLOB_CACHE_DIR?.trim() || DEFAULT_BLOB_CACHE_DIR,
    warnings,
  };
}
