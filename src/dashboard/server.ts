/**
 * The status dashboard's HTTP shell: two read-only routes and the request
 * guard. Extracted from scripts/serve-status.ts so it is testable against a
 * real server on an ephemeral port.
 *
 *   GET|HEAD /, /index.html   the static page (fixed file, no path traversal)
 *   GET|HEAD /api/state       aggregated JSON snapshot
 *
 * Guard (every route): only GET/HEAD are served, and the Host header must be
 * an allow-listed hostname. The bind default is 127.0.0.1 and no CORS headers
 * are sent, but without a Host check a page on an attacker domain that
 * DNS-rebinds to 127.0.0.1 is same-origin with the dashboard and can read run
 * metadata (repo paths, commit subjects, the feed); binding a non-loopback
 * STATUS_HOST would expose it unauthenticated.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Snapshotter } from "./snapshot.js";

// ---------------------------------------------------------------------------
// Host / method guard
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "[::1]"] as const;
const WILDCARD_BINDS = new Set(["0.0.0.0", "::", "[::]", ""]);

/** Lower-cased hostname of a Host header value, port stripped (IPv6 keeps its brackets). */
export function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1);
  }
  const colon = value.lastIndexOf(":");
  return colon === -1 ? value : value.slice(0, colon);
}

/**
 * Hostnames a request may address: loopback names, the configured bind
 * address (unless it is a wildcard), and any explicit STATUS_ALLOWED_HOSTS.
 */
export function allowedHostsFor(bindHost: string, extra: readonly string[] = []): Set<string> {
  const allowed = new Set<string>(LOOPBACK_HOSTS);
  // A configured address has no port; a bare IPv6 literal appears bracketed in Host headers.
  const normalize = (raw: string): string => {
    const v = raw.trim().toLowerCase();
    if (v.startsWith("[")) return hostnameOf(v);
    return v.split(":").length > 2 ? `[${v}]` : hostnameOf(v);
  };
  const bind = bindHost.trim().toLowerCase();
  if (!WILDCARD_BINDS.has(bind)) allowed.add(normalize(bind));
  for (const host of extra) {
    const name = normalize(host);
    if (name.length > 0) allowed.add(name);
  }
  return allowed;
}

export type GuardResult =
  | { ok: true }
  | { ok: false; status: 403 | 405; message: string; allow?: string };

export function guardRequest(
  req: { method?: string | undefined; headers: { host?: string | string[] | undefined } },
  allowedHosts: ReadonlySet<string>,
): GuardResult {
  const hostHeader = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
  if (hostHeader === undefined || hostHeader.trim() === "") {
    return { ok: false, status: 403, message: "forbidden: missing Host header" };
  }
  if (!allowedHosts.has(hostnameOf(hostHeader))) {
    return {
      ok: false,
      status: 403,
      message: `forbidden: Host ${JSON.stringify(hostHeader)} is not allowed (set STATUS_ALLOWED_HOSTS to add hostnames)`,
    };
  }
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return { ok: false, status: 405, message: "method not allowed (GET, HEAD only)", allow: "GET, HEAD" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export interface DashboardServerOptions {
  snapshot: Snapshotter;
  /** Directory holding index.html. */
  staticDir: string;
  /** Hostnames accepted in the Host header (see allowedHostsFor). */
  allowedHosts: ReadonlySet<string>;
}

const BASE_HEADERS = { "x-content-type-options": "nosniff" } as const;

function respond(res: ServerResponse, status: number, headers: Record<string, string>, body: string | Buffer): void {
  res.writeHead(status, { ...BASE_HEADERS, ...headers });
  res.end(body);
}

export function createDashboardServer(options: DashboardServerOptions): Server {
  const { snapshot, staticDir, allowedHosts } = options;
  let lastGoodHtml: Buffer | null = null;

  async function handleIndex(res: ServerResponse): Promise<void> {
    const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
    try {
      const html = await readFile(join(staticDir, "index.html"));
      lastGoodHtml = html;
      respond(res, 200, headers, html);
    } catch {
      if (lastGoodHtml !== null) {
        respond(res, 200, headers, lastGoodHtml);
        return;
      }
      respond(res, 500, { "content-type": "text/plain" }, "dashboard page missing: src/dashboard/static/index.html");
    }
  }

  async function handleState(res: ServerResponse): Promise<void> {
    try {
      const state = await snapshot();
      respond(
        res,
        200,
        { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        JSON.stringify(state),
      );
    } catch (e) {
      // Aggregation itself must never take the server down.
      const message = e instanceof Error ? e.message : String(e);
      respond(
        res,
        500,
        { "content-type": "application/json; charset=utf-8" },
        JSON.stringify({ error: `snapshot failed: ${message}` }),
      );
    }
  }

  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const guard = guardRequest(req, allowedHosts);
    if (!guard.ok) {
      respond(
        res,
        guard.status,
        { "content-type": "text/plain", ...(guard.allow !== undefined ? { allow: guard.allow } : {}) },
        guard.message,
      );
      return;
    }
    const url = (req.url ?? "/").split("?")[0] ?? "/";
    if (url === "/" || url === "/index.html") {
      void handleIndex(res);
      return;
    }
    if (url === "/api/state") {
      void handleState(res);
      return;
    }
    respond(res, 404, { "content-type": "text/plain" }, "not found (routes: GET /, GET /api/state)");
  });
}
