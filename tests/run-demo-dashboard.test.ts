/**
 * C72 — the `demo` dashboard side-launch.
 *
 * Before: `demo` unconditionally spawned serve-status.ts detached with stdio
 * ignored (even with --start-only), never stopped it, and printed
 * `dashboard: http://127.0.0.1:${PORT ?? 4646} (pid N)` whether or not the bind
 * succeeded. A second demo (the recovery re-dispatch) printed a fresh URL for a
 * child that had died with EADDRINUSE while the first run's dashboard kept
 * serving the first run's repository.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dashboardPort, launchDashboard, probePortInUse } from "../scripts/run-demo.js";
import { REPO_ROOT } from "./support/paths.js";

const tmpDirs: string[] = [];
const servers: Server[] = [];
const pids: number[] = [];
const logs: string[] = [];

afterEach(async () => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const d of tmpDirs.splice(0)) await rm(d, { recursive: true, force: true });
  for (const l of logs.splice(0)) await rm(l, { force: true });
});

async function tmp(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** Listens on an ephemeral port and returns it (the server stays up until cleanup). */
async function occupyPort(): Promise<number> {
  const server = createServer();
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return (server.address() as { port: number }).port;
}

/** A free port: bind an ephemeral one, release it, return the number. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}

async function fakeServeStatus(body: string): Promise<string> {
  const dir = await tmp("fake-serve-status-");
  const script = join(dir, "serve-status.ts");
  await writeFile(script, body);
  return script;
}

const LISTENING_SCRIPT = `
import { createServer } from "node:net";
createServer().listen(Number(process.env.STATUS_PORT), "127.0.0.1", () => {
  console.log("fake serve-status up repo=" + process.env.STATUS_REPO_ROOT + " port=" + process.env.STATUS_PORT);
});
`;

describe("dashboardPort", () => {
  test("STATUS_PORT (dedicated name) with default 4646; the generic PORT is ignored; bad values throw", () => {
    expect(dashboardPort({})).toBe(4646);
    expect(dashboardPort({ STATUS_PORT: "5055" })).toBe(5055);
    expect(dashboardPort({ PORT: "9999" })).toBe(4646);
    expect(() => dashboardPort({ STATUS_PORT: "abc" })).toThrow("STATUS_PORT");
    expect(() => dashboardPort({ STATUS_PORT: "70000" })).toThrow("STATUS_PORT");
  });
});

describe("probePortInUse", () => {
  test("true for a listening port, false once it is free", async () => {
    const port = await occupyPort();
    expect(await probePortInUse(port)).toBe(true);
    const free = await freePort();
    expect(await probePortInUse(free)).toBe(false);
  });
});

describe("launchDashboard", () => {
  test("a port that is already taken is reported and NOT relaunched (no false success URL)", async () => {
    const port = await occupyPort();
    const serveStatus = await fakeServeStatus(LISTENING_SCRIPT);
    const logPath = join(tmpdir(), `run-demo-dashboard-${port}.log`);
    logs.push(logPath);
    const res = await launchDashboard("/some/repo", {
      serveStatusPath: serveStatus,
      env: { ...process.env, STATUS_PORT: String(port) },
    });
    expect(res.status).toBe("in-use");
    expect(res.message).toContain("already in use");
    expect(res.message).toContain("NOT starting another");
    expect(res.message).toContain("/some/repo");
    expect(existsSync(logPath)).toBe(false); // nothing was spawned
  });

  test("a free port: the child is confirmed listening, serves the given repo, and logs to a file", async () => {
    const port = await freePort();
    const serveStatus = await fakeServeStatus(LISTENING_SCRIPT);
    const logPath = join(tmpdir(), `run-demo-dashboard-${port}.log`);
    logs.push(logPath);
    const res = await launchDashboard("/some/repo", {
      serveStatusPath: serveStatus,
      env: { ...process.env, STATUS_PORT: String(port), PORT: "1" }, // generic PORT must not leak through
    });
    if (res.status === "started") pids.push(res.pid);
    expect(res.status).toBe("started");
    if (res.status !== "started") return;
    expect(res.port).toBe(port);
    expect(res.pid).toBeGreaterThan(0);
    expect(res.message).toContain(`http://127.0.0.1:${port}`);
    expect(res.message).toContain(`kill ${res.pid}`);
    expect(res.logPath).toBe(logPath);
    expect(await probePortInUse(port)).toBe(true);
    // child output went to the log file, not /dev/null
    const deadline = Date.now() + 3000;
    let log = "";
    while (Date.now() < deadline && !log.includes("fake serve-status up")) {
      log = readFileSync(logPath, "utf8");
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(log).toContain(`repo=/some/repo port=${port}`);
  });

  test("a child that dies before listening is reported as failed with a pointer to its log", async () => {
    const port = await freePort();
    const serveStatus = await fakeServeStatus(
      `console.error("[serve-status] server error: Failed to start server. Is port in use?"); process.exit(1);`,
    );
    const logPath = join(tmpdir(), `run-demo-dashboard-${port}.log`);
    logs.push(logPath);
    const res = await launchDashboard("/some/repo", {
      serveStatusPath: serveStatus,
      env: { ...process.env, STATUS_PORT: String(port) },
      readyTimeoutMs: 5_000,
    });
    expect(res.status).toBe("failed");
    expect(res.message).toContain("exited (code 1)");
    expect(res.message).toContain(logPath);
    expect(readFileSync(logPath, "utf8")).toContain("Failed to start server");
  });

  test("a missing serve-status script is reported, not fatal", async () => {
    const res = await launchDashboard("/some/repo", { serveStatusPath: "/nonexistent/serve-status.ts" });
    expect(res.status).toBe("missing");
  });
});

describe("demo only launches the dashboard on request", () => {
  test("startDemo reaches launchDashboard only behind --dashboard and never spawns serve-status itself", () => {
    const src = readFileSync(join(REPO_ROOT, "scripts", "run-demo.ts"), "utf8");
    const start = src.indexOf("async function startDemo(");
    const end = src.indexOf("\n}\n", start);
    const body = src.slice(start, end);
    expect(body).toContain("if (options.dashboard)");
    expect(body).toContain("launchDashboard(dir)");
    expect(body).not.toContain("spawn(");
    expect(body).not.toContain("serve-status");
    // the launch sits inside the --dashboard guard, before the --start-only return
    expect(body.indexOf("options.dashboard")).toBeLessThan(body.indexOf("launchDashboard(dir)"));
    expect(body.indexOf("launchDashboard(dir)")).toBeLessThan(body.indexOf("options.startOnly"));
  });
});
