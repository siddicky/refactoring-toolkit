import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendKillEvent,
  chaosKill,
  monotonicMs,
  type KillEventIntent,
} from "../scripts/chaos-kill.js";
import { extractTokenUsage, fenceLabel, tokenTotal } from "../src/harness/opencode.js";
import { markerKey } from "../scripts/probe-flow.js";
import { requiresTokens } from "../flows/steps/envelope.js";

describe("kill sidecar (chaos-kill)", () => {
  let dir: string;
  afterEach(async () => {
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  });

  test("intent record is written BEFORE SIGKILL and completion AFTER; target dies", async () => {
    dir = await mkdtemp(join(tmpdir(), "porting-kit-kill-"));
    const eventsPath = join(dir, "kill-events.json");

    // A real, killable target process.
    const target = Bun.spawn(["sleep", "30"]);
    await new Promise((r) => setTimeout(r, 100)); // let it start
    expect(target.exitCode).toBeNull();

    const result = await chaosKill({
      pids: [target.pid as number],
      reason: "sidecar-ordering-test",
      runId: "test-run-1",
      eventsPath,
      waitMs: 5000,
    });
    expect(result.killed).toEqual([target.pid]);
    expect(result.stillAlive).toEqual([]);

    const raw = await readFile(eventsPath, "utf8");
    const lines = raw.trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    const intent = lines[0] as unknown as KillEventIntent;
    const completion = lines[1] as Record<string, unknown>;
    expect(intent.kind).toBe("intent");
    expect(intent.target_pids).toEqual([target.pid]);
    expect(intent.utc).toBeDefined();
    expect(completion.kind).toBe("completed");
    // UTC ordering across records (cross-process ordering asserts UTC only).
    expect(new Date(completion.utc as string).getTime()).toBeGreaterThanOrEqual(
      new Date(intent.utc).getTime(),
    );
    // Monotonic within this killer process is non-decreasing.
    expect((completion.monotonic_ms as number) >= intent.monotonic_ms).toBe(true);
  });

  test("appendKillEvent fsyncs lines in file order (intent first)", async () => {
    dir = await mkdtemp(join(tmpdir(), "porting-kit-kill-"));
    const eventsPath = join(dir, "kill-events.json");
    appendKillEvent(eventsPath, {
      kind: "intent",
      run_id: "r",
      utc: new Date().toISOString(),
      monotonic_ms: monotonicMs(),
      target_pids: [1],
      signal: "SIGKILL",
      reason: "x",
    });
    appendKillEvent(eventsPath, {
      kind: "completed",
      run_id: "r",
      utc: new Date().toISOString(),
      monotonic_ms: monotonicMs(),
      killed_pids: [],
      notes: "n/a",
      fired: false,
    });
    const raw = await readFile(eventsPath, "utf8");
    const kinds = raw.trim().split("\n").map((l) => (JSON.parse(l) as { kind: string }).kind);
    expect(kinds).toEqual(["intent", "completed"]);
  });
});

describe("harness pure helpers", () => {
  test("extractTokenUsage narrows an opencode AssistantMessage-shaped payload", () => {
    const usage = extractTokenUsage({
      tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 3, write: 4 } },
      cost: 0.01,
    });
    expect(usage).toEqual({
      input: 10,
      output: 5,
      reasoning: 2,
      cacheRead: 3,
      cacheWrite: 4,
      cost: 0.01,
    });
    expect(tokenTotal(usage as NonNullable<typeof usage>)).toBe(24);
  });

  test("extractTokenUsage returns null (provenance failure path) when tokens are absent", () => {
    expect(extractTokenUsage({})).toBeNull();
    expect(extractTokenUsage({ tokens: { input: "x" } })).toBeNull();
    expect(extractTokenUsage(undefined)).toBeNull();
  });

  test("fenceLabel sanitizes slashes (AttributeMap instance keys prohibit /)", () => {
    const label = fenceLabel("src/a.php", 1, 2);
    expect(label).toBe("porting-kit:src__a.php#1#2");
    expect(label.includes(`#${2}`)).toBe(true);
  });

  test("markerKey is slash-free and stable per file+round", () => {
    expect(markerKey("src/a.php", 1)).toBe("src__a.php#1");
  });

  test("token requirements by role (model-calling roles require usage)", () => {
    expect(requiresTokens("agent")).toBe(true);
    expect(requiresTokens("review")).toBe(true);
    expect(requiresTokens("judgment")).toBe(true);
    expect(requiresTokens("commit")).toBe(false);
    expect(requiresTokens("record")).toBe(false);
    expect(requiresTokens("integration")).toBe(false);
  });
});
