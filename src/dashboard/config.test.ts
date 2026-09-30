/**
 * Launch-configuration defaults and validation (C59).
 */

import { describe, expect, test } from "bun:test";

import {
  DEFAULT_BURN_DOWN_FILES,
  DEFAULT_KILL_EVENT_FILES,
  configFromEnv,
} from "./config.js";

describe("configFromEnv defaults (C59)", () => {
  const cfg = configFromEnv({}, "/work/dir");

  test("kill-event defaults follow data contract B: metrics/kill-events.jsonl first, plus legacy names, cwd-relative", () => {
    expect(cfg.killEventFiles[0]).toBe("metrics/kill-events.jsonl");
    expect(cfg.killEventFiles).toEqual([...DEFAULT_KILL_EVENT_FILES]);
    // The legacy names still in the wild: the old metrics/ name and chaos-kill's old cwd default.
    expect(cfg.killEventFiles).toContain("metrics/kill-events.json");
    expect(cfg.killEventFiles).toContain("kill-events.json");
    // No stale absolute /tmp run artifacts.
    expect(cfg.killEventFiles.some((p) => p.startsWith("/"))).toBe(false);
    expect(cfg.burnDownFiles).toEqual([...DEFAULT_BURN_DOWN_FILES]);
  });

  test("repoRoot defaults to the working directory, not a historical /tmp trial repo", () => {
    expect(cfg.repoRoot).toBe("/work/dir");
    expect(configFromEnv({ STATUS_REPO_ROOT: " /srv/port-target " }, "/work/dir").repoRoot).toBe("/srv/port-target");
  });

  test("the documented defaults", () => {
    expect(cfg).toMatchObject({
      port: 4646,
      host: "127.0.0.1",
      dexcliBin: "dexcli",
      dexServer: "127.0.0.1:8801",
      maxFlows: 12,
      maxChildFlows: 8,
    });
    expect(cfg.warnings).toEqual([]);
  });

  test("KILL_EVENT_FILES / BURN_DOWN_FILES override the defaults (csv)", () => {
    const custom = configFromEnv({ KILL_EVENT_FILES: "a.jsonl, b.json ,", BURN_DOWN_FILES: "x.jsonl" }, "/w");
    expect(custom.killEventFiles).toEqual(["a.jsonl", "b.json"]);
    expect(custom.burnDownFiles).toEqual(["x.jsonl"]);
  });
});

describe("configFromEnv numeric validation (C59)", () => {
  test("STATUS_MAX_FLOWS=abc falls back to 12 with a warning (it used to yield NaN and zero flows)", () => {
    const cfg = configFromEnv({ STATUS_MAX_FLOWS: "abc" }, "/w");
    expect(cfg.maxFlows).toBe(12);
    expect(Number.isNaN(cfg.maxFlows)).toBe(false);
    expect(cfg.warnings.join("\n")).toContain("STATUS_MAX_FLOWS");
  });

  test("partially numeric, negative, zero and out-of-range values are rejected, not truncated", () => {
    for (const bad of ["12abc", "-3", "0", "1.5", "99999"]) {
      const cfg = configFromEnv({ STATUS_MAX_FLOWS: bad }, "/w");
      expect(cfg.maxFlows).toBe(12);
      expect(cfg.warnings.length).toBe(1);
    }
  });

  test("valid values are honoured without warnings", () => {
    const cfg = configFromEnv({ STATUS_MAX_FLOWS: "20", STATUS_MAX_CHILD_FLOWS: "0", STATUS_PORT: "8080" }, "/w");
    expect(cfg).toMatchObject({ maxFlows: 20, maxChildFlows: 0, port: 8080 });
    expect(cfg.warnings).toEqual([]);
  });

  test("a blank value is the default, silently", () => {
    const cfg = configFromEnv({ STATUS_MAX_FLOWS: "  ", STATUS_PORT: "" }, "/w");
    expect(cfg).toMatchObject({ maxFlows: 12, port: 4646 });
    expect(cfg.warnings).toEqual([]);
  });

  test("the port is STATUS_PORT; the legacy generic PORT still works (with a deprecation warning)", () => {
    expect(configFromEnv({ STATUS_PORT: "5000", PORT: "6000" }, "/w").port).toBe(5000);
    const legacy = configFromEnv({ PORT: "6000" }, "/w");
    expect(legacy.port).toBe(6000);
    expect(legacy.warnings.join("\n")).toContain("PORT is deprecated");
    // STATUS_PORT set: a stray generic PORT is ignored entirely (no warning noise).
    expect(configFromEnv({ STATUS_PORT: "5000", PORT: "6000" }, "/w").warnings).toEqual([]);
  });

  test("an invalid port falls back to 4646 with a warning", () => {
    const cfg = configFromEnv({ STATUS_PORT: "70000" }, "/w");
    expect(cfg.port).toBe(4646);
    expect(cfg.warnings.join("\n")).toContain("STATUS_PORT");
  });
});
