/**
 * OpencodeHarness transport paths over SDK doubles (audit C22 + C24).
 *
 * The older harness tests (lanes / turn-health) use doubles whose
 * `session.messages` throws, so the usage-less poll loop, the call timeout and
 * the abort primitives had no coverage. Timing knobs are injected through the
 * constructor options (milliseconds, real timers) instead of fake timers.
 *
 * Covered:
 * 1. parseWaitMs / the env accessors: a valid value is used AS GIVEN (the old
 *    x4/3 scaling turned 300 into 400 ms), invalid values take the caller's
 *    fallback, defaults are 15 min (wait) and 20 min (call timeout).
 * 2. withCallTimeout through prompt(): retryable timeout naming the effective
 *    value; constructor option beats env.
 * 3. Poll loop: usage-less then completed, completed-without-usage
 *    (provenance null), empty reply, aborted reply (returned as aborted:true,
 *    not thrown), upstream failure, tolerated messages() errors, degenerate
 *    reply, message-shape variants.
 * 4. abort / abortAndConfirm / isBusy.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_PROMPT_CALL_TIMEOUT_MS,
  DEFAULT_PROMPT_WAIT_MS,
  OpencodeHarness,
  OpencodePromptError,
  parseWaitMs,
  promptCallTimeoutMs,
  promptWaitMs,
} from "./opencode.js";
import { clearHarnessEnv } from "../../tests/support/opencode-env.js";

let restoreEnv: () => void;
let restoreConsole: () => void;

beforeEach(() => {
  restoreEnv = clearHarnessEnv();
  // The poll loop narrates progress on stderr; keep test output readable.
  const original = console.error;
  console.error = () => {};
  restoreConsole = () => {
    console.error = original;
  };
});

afterEach(() => {
  restoreConsole();
  restoreEnv();
});

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

const USAGE_INFO = {
  role: "assistant",
  tokens: { input: 11, output: 7, reasoning: 3, cache: { read: 5, write: 2 } },
  cost: 0.25,
};

/** prompt() resolved but the model is still working: no tokens, no text. */
const USAGELESS_PROMPT = { data: { info: {}, parts: [] } };

interface ScriptedOptions {
  prompt?: () => Promise<unknown>;
  /** One entry per session.messages() call (a function entry is called and may throw); the last entry repeats. */
  messages?: unknown[];
  status?: Array<Record<string, { type: string }>>;
  abort?: () => Promise<unknown>;
  list?: unknown[];
}

function scripted(opts: ScriptedOptions) {
  const calls = { prompt: 0, messages: 0, abort: 0, status: 0 };
  const client = {
    session: {
      prompt: async () => {
        calls.prompt += 1;
        return opts.prompt !== undefined ? opts.prompt() : USAGELESS_PROMPT;
      },
      messages: async () => {
        const steps = opts.messages ?? [];
        const step = steps[Math.min(calls.messages, steps.length - 1)];
        calls.messages += 1;
        if (typeof step === "function") return (step as () => never)();
        return step;
      },
      abort: async () => {
        calls.abort += 1;
        return opts.abort !== undefined ? opts.abort() : { data: true };
      },
      status: async () => {
        const steps = opts.status ?? [{}];
        const step = steps[Math.min(calls.status, steps.length - 1)];
        calls.status += 1;
        return { data: step };
      },
      list: async () => ({ data: opts.list ?? [] }),
    },
  } as never;
  return { client, calls };
}

/** Fast real-timer tuning: 2 ms polls inside a 60 ms window. */
const FAST = { waitMs: 60, pollIntervalMs: 2, callTimeoutMs: 1_000 } as const;

function assistant(info: Record<string, unknown>, text?: string) {
  return {
    info: { role: "assistant", ...info },
    parts: text === undefined ? [] : [{ type: "text", text }],
  };
}

async function rejection(p: Promise<unknown>): Promise<OpencodePromptError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(OpencodePromptError);
    return err as OpencodePromptError;
  }
  throw new Error("expected the promise to reject");
}

// ---------------------------------------------------------------------------
// 1: env parsing (C24)
// ---------------------------------------------------------------------------

describe("parseWaitMs", () => {
  test("a valid value is used exactly as given (no x4/3 scaling)", () => {
    expect(parseWaitMs("300", 900_000)).toBe(300);
    expect(parseWaitMs("3000", 900_000)).toBe(3000);
    expect(parseWaitMs("1200000", 1_200_000)).toBe(1_200_000);
    expect(parseWaitMs("60000", 1_200_000)).toBe(60_000);
  });

  test("invalid values take the caller's fallback", () => {
    for (const bad of [undefined, "", "abc", "0", "-5", "NaN", String(24 * 60 * 60_000 + 1)]) {
      expect(parseWaitMs(bad, 123)).toBe(123);
    }
    expect(parseWaitMs(String(24 * 60 * 60_000), 123)).toBe(24 * 60 * 60_000);
  });
});

describe("env accessors", () => {
  test("defaults: 15 min poll window, 20 min call timeout", () => {
    expect(DEFAULT_PROMPT_WAIT_MS).toBe(15 * 60_000);
    expect(DEFAULT_PROMPT_CALL_TIMEOUT_MS).toBe(20 * 60_000);
    expect(promptWaitMs()).toBe(900_000);
    expect(promptCallTimeoutMs()).toBe(1_200_000);
  });

  test("explicit env values are honoured as written", () => {
    process.env.OPENCODE_PROMPT_CALL_TIMEOUT_MS = "60000";
    process.env.OPENCODE_PROMPT_WAIT_MS = "45000";
    expect(promptCallTimeoutMs()).toBe(60_000);
    expect(promptWaitMs()).toBe(45_000);
  });

  test("the 24h clamp is not exceeded by scaling: a huge value falls back to the default", () => {
    process.env.OPENCODE_PROMPT_CALL_TIMEOUT_MS = String(24 * 60 * 60_000 + 1);
    expect(promptCallTimeoutMs()).toBe(1_200_000);
  });
});

// ---------------------------------------------------------------------------
// 2: call timeout through the real withCallTimeout (C24)
// ---------------------------------------------------------------------------

describe("prompt call timeout", () => {
  const never = () => new Promise<never>(() => {});

  test("OPENCODE_PROMPT_CALL_TIMEOUT_MS=300 times out after 300 ms (was 400 ms) and is retryable", async () => {
    process.env.OPENCODE_PROMPT_CALL_TIMEOUT_MS = "300";
    const { client } = scripted({ prompt: never });
    const started = Date.now();
    const err = await rejection(new OpencodeHarness(client).prompt("s1", "hi"));
    const elapsed = Date.now() - started;

    expect(err.retryable).toBe(true);
    expect(err.message).toContain("SDK call timed out after 300ms");
    expect(err.message).toContain("session=s1");
    expect(elapsed).toBeGreaterThanOrEqual(280); // not cut short; the message proves it was not x4/3
  });

  test("the constructor option beats the env value", async () => {
    process.env.OPENCODE_PROMPT_CALL_TIMEOUT_MS = "60000";
    const { client } = scripted({ prompt: never });
    const err = await rejection(
      new OpencodeHarness(client, undefined, undefined, { callTimeoutMs: 25 }).prompt("s", "hi"),
    );
    expect(err.message).toContain("timed out after 25ms");
  });

  test("a prompt that settles in time is unaffected and leaves no late rejection behind", async () => {
    const { client } = scripted({
      prompt: async () => ({ data: { info: USAGE_INFO, parts: [{ type: "text", text: "ok" }] } }),
    });
    const res = await new OpencodeHarness(client, undefined, undefined, { callTimeoutMs: 20 }).prompt("s", "hi");
    expect(res.text).toBe("ok");
    await new Promise((r) => setTimeout(r, 50)); // past the (cleared) deadline
  });
});

// ---------------------------------------------------------------------------
// 3: usage-less poll loop (C22)
// ---------------------------------------------------------------------------

describe("prompt poll loop (usage-less prompt result)", () => {
  function harnessFor(opts: ScriptedOptions) {
    const { client, calls } = scripted(opts);
    return { harness: new OpencodeHarness(client, undefined, undefined, FAST), calls };
  }

  test("usage-less, then the assistant reply completes: text and usage come from the poll", async () => {
    const { harness, calls } = harnessFor({
      messages: [
        { data: [] }, // no assistant message yet
        { data: [{ info: { role: "user" }, parts: [] }, assistant({}, "partial")] }, // still no tokens
        { data: [{ info: { role: "user" }, parts: [] }, assistant(USAGE_INFO, "done")] },
      ],
    });
    const res = await harness.prompt("s", "hi");

    expect(res).toEqual({
      text: "done",
      usage: { input: 11, output: 7, reasoning: 3, cacheRead: 5, cacheWrite: 2, cost: 0.25 },
      aborted: false,
    });
    expect(calls.messages).toBe(3);
  });

  test("the newest assistant message wins and the { messages: [] } shape is understood", async () => {
    const { harness } = harnessFor({
      messages: [
        {
          data: {
            messages: [
              assistant(USAGE_INFO, "older turn"),
              { info: { role: "user" }, parts: [] },
              assistant({ ...USAGE_INFO, tokens: { ...USAGE_INFO.tokens, output: 99 } }, "newest"),
            ],
          },
        },
      ],
    });
    const res = await harness.prompt("s", "hi");
    expect(res.text).toBe("newest");
    expect(res.usage?.output).toBe(99);
  });

  test("a completed reply that never exposes usage is returned with usage null (provenance failure, never zero)", async () => {
    const { harness, calls } = harnessFor({
      messages: [{ data: [assistant({}, "answer without tokens")] }],
    });
    const res = await harness.prompt("s", "hi");

    expect(res).toEqual({ text: "answer without tokens", usage: null, aborted: false });
    expect(calls.messages).toBeGreaterThan(1); // kept polling until the window closed
  });

  test("an empty reply without usage is a RETRYABLE native-tool failure", async () => {
    const { harness } = harnessFor({ messages: [{ data: [assistant({})] }] });
    const err = await rejection(harness.prompt("s", "hi"));

    expect(err.retryable).toBe(true);
    expect(err.message).toContain("empty reply without usage");
    expect(err.usage).toBeNull();
  });

  test("no assistant message at all for the whole window is the same empty-reply failure", async () => {
    const { harness } = harnessFor({ messages: [{ data: [] }] });
    const err = await rejection(harness.prompt("s", "hi"));
    expect(err.message).toContain("empty reply without usage");
  });

  test("an aborted reply found while polling (MessageAbortedError) is returned as aborted:true, not thrown as an upstream failure", async () => {
    // Regression (INT-6): upstreamErrorOf() used to run before hasAbortedError(),
    // so MessageAbortedError (an info.error) was thrown as a retryable upstream
    // failure and `aborted` could never be true from this harness.
    const { harness } = harnessFor({
      messages: [{ data: [assistant({ error: { name: "MessageAbortedError" } }, "partial text")] }],
    });
    const res = await harness.prompt("s", "hi");

    expect(res.aborted).toBe(true);
    expect(res.text).toBe("partial text");
    expect(res.usage).toBeNull();
  });

  test("an abort in the prompt() response itself skips the poll loop and returns aborted:true", async () => {
    const { client, calls } = scripted({
      prompt: async () => ({ data: { info: { error: { name: "MessageAbortedError" } }, parts: [] } }),
    });
    const res = await new OpencodeHarness(client, undefined, undefined, FAST).prompt("s", "hi");

    expect(res).toEqual({ text: "", usage: null, aborted: true });
    expect(calls.messages).toBe(0); // an aborted turn is final: nothing to wait for
  });

  test("an aborted turn that still reports usage is NOT the degenerate no-text failure", async () => {
    const { client } = scripted({
      prompt: async () => ({
        data: { info: { ...USAGE_INFO, error: { name: "MessageAbortedError" } }, parts: [] },
      }),
    });
    const res = await new OpencodeHarness(client, undefined, undefined, FAST).prompt("s", "hi");

    expect(res.aborted).toBe(true);
    expect(res.usage?.output).toBe(7);
  });

  test("every OTHER info.error still fails RETRYABLE as an upstream failure", async () => {
    const { client } = scripted({
      prompt: async () => ({ data: { info: { error: { name: "APIError", message: "overloaded" } }, parts: [] } }),
    });
    const err = await rejection(new OpencodeHarness(client, undefined, undefined, FAST).prompt("s", "hi"));

    expect(err.retryable).toBe(true);
    expect(err.message).toBe("upstream failure: APIError: overloaded");
  });

  test("an upstream provider error found while polling fails RETRYABLE immediately", async () => {
    const { harness, calls } = harnessFor({
      messages: [
        { data: [assistant({ error: { name: "APIError", message: "rate limited" } })] },
      ],
    });
    const err = await rejection(harness.prompt("s", "hi"));

    expect(err.retryable).toBe(true);
    expect(err.message).toBe("upstream failure: APIError: rate limited");
    expect(calls.messages).toBe(1);
  });

  test("a messages() error does not end the loop: the next poll can still complete the turn", async () => {
    const { harness, calls } = harnessFor({
      messages: [
        (() => {
          throw new Error("connection reset");
        }) as () => never,
        { data: [assistant(USAGE_INFO, "recovered")] },
      ],
    });
    const res = await harness.prompt("s", "hi");

    expect(res.text).toBe("recovered");
    expect(calls.messages).toBe(2);
  });

  test("a usage-present, text-empty reply found while polling is the Tier-0 degenerate failure", async () => {
    const { harness } = harnessFor({ messages: [{ data: [assistant(USAGE_INFO)] }] });
    const err = await rejection(harness.prompt("s", "hi"));

    expect(err.retryable).toBe(true);
    expect(err.message).toContain("degenerate turn");
    expect(err.usage?.output).toBe(7);
  });

  test("text returned by the prompt call itself is kept when the poll reply carries no text", async () => {
    const { client } = scripted({
      prompt: async () => ({ data: { info: {}, parts: [{ type: "text", text: "from prompt" }] } }),
      messages: [{ data: [assistant(USAGE_INFO)] }],
    });
    const res = await new OpencodeHarness(client, undefined, undefined, FAST).prompt("s", "hi");
    expect(res.text).toBe("from prompt");
    expect(res.usage?.input).toBe(11);
  });

  test("prompt() with no message payload at all is a plain error", async () => {
    const { client } = scripted({ prompt: async () => ({ data: undefined }) });
    await expect(new OpencodeHarness(client, undefined, undefined, FAST).prompt("s9", "hi")).rejects.toThrow(
      "opencode prompt returned no message (session=s9)",
    );
  });
});

// ---------------------------------------------------------------------------
// 4: abort primitives (C22)
// ---------------------------------------------------------------------------

describe("abort / abortAndConfirm / isBusy", () => {
  test("abort() is true only when the server accepted without an error field", async () => {
    const ok = scripted({ abort: async () => ({ data: true }) });
    expect(await new OpencodeHarness(ok.client).abort("s")).toBe(true);
    const bad = scripted({ abort: async () => ({ error: { message: "no such session" } }) });
    expect(await new OpencodeHarness(bad.client).abort("s")).toBe(false);
  });

  test("isBusy: busy and retry count as busy; idle, missing and malformed do not", async () => {
    const status = (data: unknown) => ({
      session: { status: async () => ({ data }) },
    }) as never;
    expect(await new OpencodeHarness(status({ s: { type: "busy" } })).isBusy("s")).toBe(true);
    expect(await new OpencodeHarness(status({ s: { type: "retry" } })).isBusy("s")).toBe(true);
    expect(await new OpencodeHarness(status({ s: { type: "idle" } })).isBusy("s")).toBe(false);
    expect(await new OpencodeHarness(status({})).isBusy("s")).toBe(false);
    expect(await new OpencodeHarness(status(undefined)).isBusy("s")).toBe(false);
  });

  test("abortAndConfirm returns true after ONE abort when the session is already idle", async () => {
    const { client, calls } = scripted({ status: [{ s: { type: "idle" } }] });
    expect(await new OpencodeHarness(client).abortAndConfirm("s")).toBe(true);
    expect(calls.abort).toBe(1);
  });

  test("abortAndConfirm retries until the session stops being busy", async () => {
    const { client, calls } = scripted({
      status: [{ s: { type: "busy" } }, { s: { type: "retry" } }, {}],
    });
    expect(await new OpencodeHarness(client).abortAndConfirm("s")).toBe(true);
    expect(calls.abort).toBe(3);
  });

  test("abortAndConfirm gives up (false) after the try budget when the session stays busy", async () => {
    const { client, calls } = scripted({ status: [{ s: { type: "busy" } }] });
    expect(await new OpencodeHarness(client).abortAndConfirm("s")).toBe(false);
    expect(calls.abort).toBe(3);

    const again = scripted({ status: [{ s: { type: "busy" } }] });
    expect(await new OpencodeHarness(again.client).abortAndConfirm("s", 5)).toBe(false);
    expect(again.calls.abort).toBe(5);
  });

  test("a rejected abort is still confirmed by the busy check (abort error + idle session = gone)", async () => {
    const { client, calls } = scripted({
      abort: async () => ({ error: { message: "already finished" } }),
      status: [{}],
    });
    expect(await new OpencodeHarness(client).abortAndConfirm("s")).toBe(true);
    expect(calls.abort).toBe(1);
  });

  test("listSessions drops entries without a string id and defaults a missing title to ''", async () => {
    const { client } = scripted({
      list: [{ id: "a", title: "t" }, { id: "b" }, { title: "no id" }, null, { id: 5 }],
    });
    expect(await new OpencodeHarness(client).listSessions()).toEqual([
      { id: "a", title: "t" },
      { id: "b", title: "" },
    ]);
  });
});
