/**
 * Harness selection + reachability probe (audit C20).
 *
 * Before: pickHarness wrapped OpencodeHarness.connect() in try/catch, but
 * connect() only builds an SDK client (no I/O), so an unreachable or
 * malformed server never triggered the documented stub fallback; any
 * --harness value other than "stub" behaved like auto.
 *
 * Covered: parseHarnessChoice, selectHarness (stub / opencode / auto over a
 * connect double), OpencodeHarness.probe over real sockets (ok, refused, HTTP
 * 500, hang, not-an-opencode-server, malformed URL) and describeHarness.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { OpencodeHarness, type AgentSessionClient } from "./opencode.js";
import {
  describeHarness,
  parseHarnessChoice,
  selectHarness,
  type ProbeableHarness,
} from "./select.js";
import { clearHarnessEnv } from "../../tests/support/opencode-env.js";

let restoreEnv: () => void;
beforeEach(() => {
  restoreEnv = clearHarnessEnv();
});
afterEach(() => restoreEnv());

class FakeStub implements AgentSessionClient {
  async createSession(label: string) {
    return { id: "stub", title: label };
  }
  async prompt() {
    return { text: "", usage: null, aborted: false };
  }
  async abortSessionsNotTagged() {
    return [];
  }
}

function fakeReal(probe: ProbeableHarness["probe"], baseUrl = "http://fake:4096"): ProbeableHarness {
  return {
    baseUrl,
    probe,
    createSession: async (label: string) => ({ id: "real", title: label }),
    prompt: async () => ({ text: "", usage: null, aborted: false }),
    abortSessionsNotTagged: async () => [],
  };
}

describe("parseHarnessChoice", () => {
  test("absent / blank = auto; the three modes parse", () => {
    expect(parseHarnessChoice(undefined)).toBe("auto");
    expect(parseHarnessChoice("")).toBe("auto");
    expect(parseHarnessChoice("  ")).toBe("auto");
    expect(parseHarnessChoice("auto")).toBe("auto");
    expect(parseHarnessChoice("opencode")).toBe("opencode");
    expect(parseHarnessChoice("stub")).toBe("stub");
  });

  test("unknown values are rejected instead of behaving like auto", () => {
    for (const bad of ["real", "Stub", "--flows", "opencodex", "none"]) {
      expect(() => parseHarnessChoice(bad)).toThrow(/unknown --harness value .*stub\|opencode\|auto/);
    }
  });
});

describe("selectHarness", () => {
  const stub = new FakeStub();
  const base = { makeStub: () => stub };

  test("stub: returns the double and never touches the network", async () => {
    let connected = 0;
    const got = await selectHarness({
      ...base,
      choice: "stub",
      connect: async () => {
        connected += 1;
        return fakeReal(async () => ({ ok: true }));
      },
    });
    expect(got).toBe(stub);
    expect(connected).toBe(0);
  });

  test("auto + reachable server: the real harness, no warning", async () => {
    const warnings: string[] = [];
    const real = fakeReal(async () => ({ ok: true }));
    const got = await selectHarness({
      ...base,
      choice: undefined,
      connect: async () => real,
      warn: (m) => warnings.push(m),
    });
    expect(got).toBe(real);
    expect(warnings).toEqual([]);
  });

  test("auto + unreachable server: LOUD labelled warning, then the stub", async () => {
    const warnings: string[] = [];
    const got = await selectHarness({
      ...base,
      choice: "auto",
      connect: async () =>
        fakeReal(async () => ({ ok: false, reason: "Unable to connect" }), "http://127.0.0.1:4096"),
      warn: (m) => warnings.push(m),
    });
    expect(got).toBe(stub);
    expect(warnings).toHaveLength(1);
    const w = warnings[0] as string;
    expect(w).toContain("WARNING");
    expect(w).toContain("http://127.0.0.1:4096");
    expect(w).toContain("Unable to connect");
    expect(w).toContain("FALLING BACK to StubHarness");
    expect(w).toContain("test double");
    expect(w).toContain("NO real model calls");
  });

  test("opencode + unreachable server: hard failure, no stub", async () => {
    const warnings: string[] = [];
    await expect(
      selectHarness({
        ...base,
        choice: "opencode",
        connect: async () =>
          fakeReal(async () => ({ ok: false, reason: "HTTP 503" }), "http://127.0.0.1:9"),
        warn: (m) => warnings.push(m),
      }),
    ).rejects.toThrow(/--harness opencode: opencode server at http:\/\/127\.0\.0\.1:9 is not reachable \(HTTP 503\)/);
    expect(warnings).toEqual([]);
  });

  test("opencode + reachable server: the real harness", async () => {
    const real = fakeReal(async () => ({ ok: true }));
    expect(await selectHarness({ ...base, choice: "opencode", connect: async () => real })).toBe(real);
  });

  test("a connect() that throws is handled like an unreachable server", async () => {
    const warnings: string[] = [];
    const boom = async (): Promise<ProbeableHarness> => {
      throw new Error("invalid base URL");
    };
    expect(
      await selectHarness({ ...base, choice: "auto", connect: boom, warn: (m) => warnings.push(m) }),
    ).toBe(stub);
    expect(warnings[0]).toContain("invalid base URL");
    await expect(selectHarness({ ...base, choice: "opencode", connect: boom })).rejects.toThrow(
      /--harness opencode: .*invalid base URL/,
    );
  });

  test("requireReal (recovery): auto on an unreachable server FAILS instead of skipping the abort fence on a stub", async () => {
    const warnings: string[] = [];
    await expect(
      selectHarness({
        ...base,
        choice: undefined,
        requireReal: true,
        connect: async () => fakeReal(async () => ({ ok: false, reason: "Unable to connect" })),
        warn: (m) => warnings.push(m),
      }),
    ).rejects.toThrow(/--harness auto: opencode server at http:\/\/fake:4096 is not reachable \(Unable to connect\)/);
    expect(warnings).toEqual([]);
  });

  test("requireReal keeps a reachable real harness and still honours an explicit stub", async () => {
    const real = fakeReal(async () => ({ ok: true }));
    expect(await selectHarness({ ...base, choice: "auto", requireReal: true, connect: async () => real })).toBe(real);
    expect(await selectHarness({ ...base, choice: "stub", requireReal: true })).toBe(stub);
  });

  test("an unknown --harness value fails before any connection is attempted", async () => {
    let connected = 0;
    await expect(
      selectHarness({
        ...base,
        choice: "bogus",
        connect: async () => {
          connected += 1;
          return fakeReal(async () => ({ ok: true }));
        },
      }),
    ).rejects.toThrow("unknown --harness value");
    expect(connected).toBe(0);
  });

  test("base URL, model and probe timeout are forwarded", async () => {
    const seen: { url?: string | undefined; model?: unknown; timeout?: number | undefined } = {};
    const model = { providerID: "p", modelID: "m" };
    await selectHarness({
      ...base,
      choice: "opencode",
      baseUrl: "http://example:1234",
      model,
      probeTimeoutMs: 77,
      connect: async (url, m) => {
        seen.url = url;
        seen.model = m;
        return fakeReal(async (t) => {
          seen.timeout = t;
          return { ok: true };
        });
      },
    });
    expect(seen).toEqual({ url: "http://example:1234", model, timeout: 77 });
  });
});

describe("describeHarness", () => {
  test("reports the resolved class and base URL", async () => {
    expect(describeHarness(new FakeStub())).toBe("FakeStub (test double)");
    const real = await OpencodeHarness.connect("http://127.0.0.1:4999");
    expect(describeHarness(real)).toBe("OpencodeHarness@http://127.0.0.1:4999");
    expect((await OpencodeHarness.connect()).baseUrl).toBe("http://127.0.0.1:4096");
  });
});

// ---------------------------------------------------------------------------
// OpencodeHarness.probe over real sockets
// ---------------------------------------------------------------------------

describe("OpencodeHarness.probe", () => {
  const servers: Array<{ stop(force?: boolean): unknown }> = [];
  afterEach(() => {
    for (const s of servers.splice(0)) void s.stop(true);
  });

  function serve(handler: () => Response | Promise<Response>): string {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: handler });
    servers.push(server);
    return `http://127.0.0.1:${server.port}`;
  }

  test("a server that answers session.list with an array is reachable", async () => {
    const url = serve(() => Response.json([{ id: "ses_1", title: "x" }]));
    expect(await (await OpencodeHarness.connect(url)).probe(2_000)).toEqual({ ok: true });
  });

  test("a closed port is not reachable (connect() itself still resolves — the audit's bug)", async () => {
    const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
    const url = `http://127.0.0.1:${server.port}`;
    await server.stop(true);

    const harness = await OpencodeHarness.connect(url); // no I/O: does not throw
    const res = await harness.probe(2_000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason.length).toBeGreaterThan(0);
  });

  test("an HTTP error answer is not ok and names the status", async () => {
    const url = serve(() => new Response("boom", { status: 500 }));
    const res = await (await OpencodeHarness.connect(url)).probe(2_000);
    expect(res).toEqual({ ok: false, reason: "server answered HTTP 500" });
  });

  test("a server that accepts the connection and never answers times out", async () => {
    const url = serve(() => new Promise<Response>(() => {}));
    const started = Date.now();
    const res = await (await OpencodeHarness.connect(url)).probe(120);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("within 120ms");
    expect(Date.now() - started).toBeLessThan(1_500);
  });

  test("a 200 that is not a session array is not an opencode server", async () => {
    const url = serve(() => Response.json({ hello: "world" }));
    const res = await (await OpencodeHarness.connect(url)).probe(2_000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain("not an opencode server");
  });

  test("a malformed base URL is reported, never thrown", async () => {
    for (const bad of ["not-a-url", "http://[::1", ""]) {
      const res = await (await OpencodeHarness.connect(bad)).probe(1_000);
      expect(res.ok).toBe(false);
    }
  });

  test("selectHarness over a real dead port: auto warns + stub, opencode throws", async () => {
    const dead = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
    const url = `http://127.0.0.1:${dead.port}`;
    await dead.stop(true);

    const stub = new FakeStub();
    const warnings: string[] = [];
    const auto = await selectHarness({
      choice: "auto",
      baseUrl: url,
      makeStub: () => stub,
      probeTimeoutMs: 2_000,
      warn: (m) => warnings.push(m),
    });
    expect(auto).toBe(stub);
    expect(warnings[0]).toContain(url);

    await expect(
      selectHarness({ choice: "opencode", baseUrl: url, makeStub: () => stub, probeTimeoutMs: 2_000 }),
    ).rejects.toThrow(`opencode server at ${url} is not reachable`);
  });
});
