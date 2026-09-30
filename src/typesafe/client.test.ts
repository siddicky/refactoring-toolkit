import { describe, expect, test } from "bun:test";
import {
  createInMemoryJevClient,
  createRealJevClient,
  isTypesafeOffline,
  JevConfigError,
  TYPESAFE_ENV_VARS,
  type InMemoryResponder,
} from "./client.js";

function envAccessor(): { get(name: string): string | undefined; set(name: string, value: string | undefined): void } {
  const proc = (globalThis as { process?: { env: Record<string, string | undefined> } }).process;
  if (!proc) throw new Error("test requires a process env shim");
  return {
    get: (name) => proc.env[name],
    set: (name, value) => {
      if (value === undefined) delete proc.env[name];
      else proc.env[name] = value;
    },
  };
}

describe("InMemoryJudgmentClient (offline test double)", () => {
  test("returns scripted answers keyed by question name and counts usage", async () => {
    const responder: InMemoryResponder = () => ({
      a: { type: "noul", noul: 0.75 },
      b: { type: "choice", choice: "x", confidence: 0.8, probabilities: { x: 0.8, y: 0.2 } },
    });
    const client = createInMemoryJevClient(responder);
    const result = await client.systemOne({
      state: "state text",
      questions: {
        a: { type: "noul", instructions: "is it so?" },
        b: { type: "choice", instructions: "which?", criteria: { x: null, y: null } },
      },
    });
    expect(result.model).toBe("in-memory-double");
    expect(result.answers.a.noul).toBe(0.75);
    expect(result.answers.b.choice).toBe("x");
    expect(result.usage.input_tokens).toBe(20); // 10 per question, deterministic
    expect(result.usage.output_tokens).toBe(2);
    expect(client.callCount).toBe(1);
    expect(client.requests[0]?.state).toBe("state text");
  });

  test("missing scripted answer for a question throws", async () => {
    const client = createInMemoryJevClient(() => ({ a: { type: "noul", noul: 1 } }));
    await expect(
      client.systemOne({
        state: null,
        questions: { a: { type: "noul" }, missing: { type: "noul" } },
      }),
    ).rejects.toThrow('no answer for question "missing"');
  });

  test("without a responder the double throws instead of faking judgments", async () => {
    const client = createInMemoryJevClient();
    await expect(
      client.systemOne({ state: null, questions: { a: { type: "noul" } } }),
    ).rejects.toThrow("no scripted responder");
  });
});

describe("createRealJevClient (env-only credentials, lazy SDK import)", () => {
  test("throws JevConfigError without TYPESAFE_API_KEY (never hardcoded)", async () => {
    const env = envAccessor();
    const savedKey = env.get(TYPESAFE_ENV_VARS.apiKey);
    env.set(TYPESAFE_ENV_VARS.apiKey, undefined);
    try {
      await expect(createRealJevClient()).rejects.toBeInstanceOf(JevConfigError);
    } finally {
      if (savedKey !== undefined) env.set(TYPESAFE_ENV_VARS.apiKey, savedKey);
    }
  });
});

describe("offline mode (network skippable via env flag)", () => {
  test("isTypesafeOffline parses truthy variants", () => {
    const env = envAccessor();
    const saved = env.get(TYPESAFE_ENV_VARS.offline);
    try {
      env.set(TYPESAFE_ENV_VARS.offline, undefined);
      expect(isTypesafeOffline()).toBe(false);
      env.set(TYPESAFE_ENV_VARS.offline, "0");
      expect(isTypesafeOffline()).toBe(false);
      env.set(TYPESAFE_ENV_VARS.offline, "false");
      expect(isTypesafeOffline()).toBe(false);
      env.set(TYPESAFE_ENV_VARS.offline, "1");
      expect(isTypesafeOffline()).toBe(true);
      env.set(TYPESAFE_ENV_VARS.offline, "true");
      expect(isTypesafeOffline()).toBe(true);
    } finally {
      if (saved === undefined) env.set(TYPESAFE_ENV_VARS.offline, undefined);
      else env.set(TYPESAFE_ENV_VARS.offline, saved);
    }
  });
});
