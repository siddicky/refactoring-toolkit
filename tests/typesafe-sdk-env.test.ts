/**
 * INT-10 (T4a observation) — TYPESAFE_BASE_URL / TYPESAFE_DEFAULT_MODEL.
 *
 * src/typesafe/client.ts listed both in TYPESAFE_ENV_VARS but nothing in this
 * repo read them, so they looked configurable here when only the SDK honours
 * them. Decision: delete the dead constants (reading them again in the toolkit
 * would just duplicate the SDK's own precedence rules) and PROVE the variables
 * still work: the real client, built with only the environment set, sends its
 * request to TYPESAFE_BASE_URL with TYPESAFE_DEFAULT_MODEL as the model.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { createRealJevClient, noul, TYPESAFE_ENV_VARS } from "../src/typesafe/client.js";

const VARS = ["TYPESAFE_API_KEY", "TYPESAFE_BASE_URL", "TYPESAFE_DEFAULT_MODEL", "TYPESAFE_LOG_LEVEL"] as const;
const saved = new Map<string, string | undefined>(VARS.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

interface Seen {
  path: string;
  authorization: string | null;
  body: { model?: string };
}

/** A local stand-in for api.typesafe.ai that records the request and answers one noul. */
function mockApi(): { url: string; seen: Seen[]; stop: () => void } {
  const seen: Seen[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      seen.push({
        path: new URL(req.url).pathname,
        authorization: req.headers.get("authorization"),
        body: (await req.json()) as { model?: string },
      });
      return Response.json({
        model: "mock-model",
        answers: { ok: { type: "noul", noul: 0.9 } },
        usage: { input_tokens: 3, output_tokens: 1 },
      });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, seen, stop: () => void server.stop(true) };
}

describe("INT-10: TYPESAFE_BASE_URL and TYPESAFE_DEFAULT_MODEL are honoured via the SDK", () => {
  test("the toolkit no longer declares env vars it does not read", () => {
    expect(Object.keys(TYPESAFE_ENV_VARS).sort()).toEqual(["apiKey", "offline"]);
  });

  test("a client built from the environment alone targets TYPESAFE_BASE_URL with TYPESAFE_DEFAULT_MODEL", async () => {
    const api = mockApi();
    try {
      process.env.TYPESAFE_API_KEY = "test-key";
      process.env.TYPESAFE_BASE_URL = api.url;
      process.env.TYPESAFE_DEFAULT_MODEL = "model-from-env";

      const client = await createRealJevClient();
      const result = await client.systemOne({ state: "x", questions: { ok: noul("is it?") } });

      expect(api.seen).toHaveLength(1);
      expect(api.seen[0]?.path).toBe("/v1/systemone");
      expect(api.seen[0]?.body.model).toBe("model-from-env");
      expect(api.seen[0]?.authorization).toBe("Bearer test-key");
      expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 1 });
      expect(client.inputTokens).toBe(3);
    } finally {
      api.stop();
    }
  });

  test("an explicit baseURL still wins over the environment", async () => {
    const wanted = mockApi();
    const ignored = mockApi();
    try {
      process.env.TYPESAFE_API_KEY = "test-key";
      process.env.TYPESAFE_BASE_URL = ignored.url;

      const client = await createRealJevClient({ baseURL: wanted.url });
      await client.systemOne({ state: "x", questions: { ok: noul("is it?") } });

      expect(wanted.seen).toHaveLength(1);
      expect(ignored.seen).toHaveLength(0);
    } finally {
      wanted.stop();
      ignored.stop();
    }
  });
});
