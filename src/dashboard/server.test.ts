/**
 * HTTP guard (C62): Host allow-list, GET/HEAD only, nosniff — asserted
 * against a real server bound to an ephemeral port.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { request, type Server } from "node:http";
import { connect, type AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { configFromEnv } from "./config.js";
import { allowedHostsFor, createDashboardServer, guardRequest, hostnameOf } from "./server.js";
import type { Snapshotter } from "./snapshot.js";

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "static");

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function send(
  port: number,
  options: { method?: string; path?: string; host?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (options.host !== undefined) headers.host = options.host;
    const req = request(
      {
        host: "127.0.0.1",
        port,
        method: options.method ?? "GET",
        path: options.path ?? "/api/state",
        headers,
        setHost: options.host === undefined, // we control the Host header when one is given
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("guardRequest / hostnameOf (pure)", () => {
  const allowed = allowedHostsFor("127.0.0.1");

  test("hostnameOf strips the port and keeps IPv6 brackets", () => {
    expect(hostnameOf("localhost:4646")).toBe("localhost");
    expect(hostnameOf("LocalHost")).toBe("localhost");
    expect(hostnameOf("[::1]:4646")).toBe("[::1]");
    expect(hostnameOf("[::1]")).toBe("[::1]");
    expect(hostnameOf("127.0.0.1:1")).toBe("127.0.0.1");
  });

  test("loopback names are allowed with or without a port", () => {
    for (const host of ["localhost", "localhost:4646", "127.0.0.1", "127.0.0.1:9", "[::1]:4646"]) {
      expect(guardRequest({ method: "GET", headers: { host } }, allowed)).toEqual({ ok: true });
    }
  });

  test("other hosts, rebinding-style look-alikes and a missing Host are forbidden", () => {
    for (const host of ["evil.example.com", "127.0.0.1.evil.com", "localhost.evil.com", "evil.com:4646", "0.0.0.0"]) {
      expect(guardRequest({ method: "GET", headers: { host } }, allowed)).toMatchObject({ ok: false, status: 403 });
    }
    expect(guardRequest({ method: "GET", headers: {} }, allowed)).toMatchObject({ ok: false, status: 403 });
  });

  test("only GET and HEAD are served", () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const res = guardRequest({ method, headers: { host: "localhost" } }, allowed);
      expect(res).toMatchObject({ ok: false, status: 405, allow: "GET, HEAD" });
    }
    expect(guardRequest({ method: "HEAD", headers: { host: "localhost" } }, allowed)).toEqual({ ok: true });
  });

  test("the bind address and STATUS_ALLOWED_HOSTS extend the allow-list; a wildcard bind adds nothing", () => {
    const lan = allowedHostsFor("10.0.0.5", ["dash.internal", "Other.Host:8080"]);
    for (const host of ["10.0.0.5:4646", "dash.internal", "other.host"]) {
      expect(guardRequest({ method: "GET", headers: { host } }, lan)).toEqual({ ok: true });
    }
    const wildcard = allowedHostsFor("0.0.0.0");
    expect(wildcard.has("0.0.0.0")).toBe(false);
    expect([...wildcard].sort()).toEqual(["127.0.0.1", "[::1]", "localhost"]);
    expect(allowedHostsFor("::1").has("[::1]")).toBe(true);
  });
});

describe("dashboard server over real HTTP (C62)", () => {
  let server: Server;
  let port = 0;
  let snapshotCalls = 0;

  const snapshot = Object.assign(
    async () => {
      snapshotCalls += 1;
      return { generatedAt: "2026-09-28T10:00:00.000Z", headline: "ok" } as never;
    },
    { cacheSizes: () => ({ state: 0, history: 0 }) },
  ) as unknown as Snapshotter;

  beforeAll(async () => {
    server = createDashboardServer({
      snapshot,
      staticDir: STATIC_DIR,
      allowedHosts: allowedHostsFor("127.0.0.1", ["dash.internal"]),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("GET /api/state with a loopback Host is 200 JSON with nosniff", async () => {
    const res = await send(port);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ headline: "ok" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-type"]).toContain("application/json");
  });

  test("GET / serves the static page with nosniff", async () => {
    const res = await send(port, { path: "/" });
    expect(res.status).toBe(200);
    expect(res.body).toContain("mission control");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  test("loopback names with the real port and an allow-listed extra host are accepted", async () => {
    for (const host of [`localhost:${port}`, `127.0.0.1:${port}`, "dash.internal"]) {
      expect((await send(port, { host })).status).toBe(200);
    }
  });

  test("a foreign Host header is 403 and never reaches the snapshot (DNS rebinding)", async () => {
    const before = snapshotCalls;
    for (const host of ["evil.example.com", "127.0.0.1.evil.com", `attacker.test:${port}`]) {
      const res = await send(port, { host });
      expect(res.status).toBe(403);
      expect(res.body).not.toContain("headline");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    }
    expect(snapshotCalls).toBe(before);
  });

  test("a request without a Host header is 403", async () => {
    // Raw socket: HTTP clients add Host on their own, so speak HTTP/1.0 by hand.
    const status = await new Promise<number>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => socket.write("GET /api/state HTTP/1.0\r\n\r\n"));
      let raw = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        raw += chunk;
      });
      socket.on("end", () => resolve(Number(/^HTTP\/1\.[01] (\d{3})/.exec(raw)?.[1] ?? 0)));
      socket.on("error", reject);
    });
    expect(status).toBe(403);
  });

  test("POST/PUT/DELETE are 405 with an Allow header and never run the snapshot", async () => {
    const before = snapshotCalls;
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await send(port, { method });
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe("GET, HEAD");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    }
    expect(snapshotCalls).toBe(before);
  });

  test("HEAD / is allowed and carries no body", async () => {
    const res = await send(port, { method: "HEAD", path: "/" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("");
  });

  test("unknown routes and traversal attempts are 404 (only the fixed index.html is ever read)", async () => {
    for (const path of ["/nope", "/../../package.json", "/static/index.html", "/api/state/extra"]) {
      const res = await send(port, { path });
      expect(res.status).toBe(404);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    }
  });

  test("a throwing snapshot is a 500 JSON error, not a crashed server", async () => {
    const bad = createDashboardServer({
      snapshot: Object.assign(
        async () => {
          throw new Error("boom");
        },
        { cacheSizes: () => ({ state: 0, history: 0 }) },
      ) as unknown as Snapshotter,
      staticDir: STATIC_DIR,
      allowedHosts: allowedHostsFor("127.0.0.1"),
    });
    await new Promise<void>((resolve) => bad.listen(0, "127.0.0.1", resolve));
    try {
      const res = await send((bad.address() as AddressInfo).port);
      expect(res.status).toBe(500);
      expect(JSON.parse(res.body).error).toContain("boom");
    } finally {
      await new Promise<void>((resolve) => bad.close(() => resolve()));
    }
  });
});

describe("non-loopback bind warning (C62)", () => {
  test("a loopback STATUS_HOST is silent", () => {
    for (const host of ["127.0.0.1", "localhost", "::1", "127.0.0.2"]) {
      expect(configFromEnv({ STATUS_HOST: host }, "/w").warnings).toEqual([]);
    }
  });

  test("a non-loopback STATUS_HOST warns that there is no authentication and names STATUS_ALLOWED_HOSTS", () => {
    for (const host of ["0.0.0.0", "10.1.2.3", "my-box.local"]) {
      const warnings = configFromEnv({ STATUS_HOST: host }, "/w").warnings.join("\n");
      expect(warnings).toContain("NO authentication");
      expect(warnings).toContain("STATUS_ALLOWED_HOSTS");
    }
  });

  test("STATUS_ALLOWED_HOSTS is parsed as a csv", () => {
    expect(configFromEnv({ STATUS_ALLOWED_HOSTS: "a.test, b.test" }, "/w").allowedHosts).toEqual(["a.test", "b.test"]);
    expect(configFromEnv({}, "/w").allowedHosts).toEqual([]);
  });
});
