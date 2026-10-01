/**
 * Unit tests for harness/agents agent definition configs.
 *
 * These test the DECLARATIVE configs (data only). Effective tool permissions
 * after config + plugin merge are runtime tests owned by worker-1/lead.
 */

import { describe, expect, test } from "bun:test";
import { IMPLEMENTER } from "./implementer.js";
import { REVIEWER } from "./reviewer.js";
import { FIXER } from "./fixer.js";
import { TOOL_CATEGORIES, type AgentDefinition } from "./types.js";
import { SEVERITIES } from "./verdict-schema.js";
import { PORTING_CONVENTIONS } from "../skills/porting-conventions.js";

const AGENTS: readonly AgentDefinition[] = [IMPLEMENTER, REVIEWER, FIXER];

describe("agent-config", () => {
  test("reviewer denies ALL tool categories and allows nothing", () => {
    expect(REVIEWER.tools.allow).toStrictEqual([]);
    expect([...REVIEWER.tools.deny].sort()).toStrictEqual([...TOOL_CATEGORIES].sort());
  });

  test("implementer and fixer have scoped writes, no git, no shell", () => {
    for (const agent of [IMPLEMENTER, FIXER]) {
      // may write
      expect(agent.tools.allow.length).toBeGreaterThan(0);
      for (const forbidden of ["git", "bash", "shell", "task", "webfetch", "mcp"]) {
        expect(agent.tools.deny).toContain(forbidden as (typeof TOOL_CATEGORIES)[number]);
      }
      // allow ∩ deny = ∅ and every allow entry is a known category.
      for (const allowed of agent.tools.allow) {
        expect(agent.tools.deny).not.toContain(allowed);
        expect(TOOL_CATEGORIES).toContain(allowed);
      }
    }
  });

  test("allow and deny only reference known categories; names are unique", () => {
    const names = AGENTS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
    for (const agent of AGENTS) {
      for (const entry of [...agent.tools.allow, ...agent.tools.deny]) {
        expect(TOOL_CATEGORIES).toContain(entry);
      }
    }
  });

  test("reviewer prompt: adversarial stance, diff-only, structured verdict, empty findings allowed", () => {
    // adversarial stance
    expect(REVIEWER.prompt).toContain("ASSUME THE CODE IS WRONG");
    // diff arrives by value; reviewer holds no tools
    expect(REVIEWER.prompt).toContain("by value");
    expect(REVIEWER.prompt).toContain("No tools");
    // the prompt single-sources the severity enum
    for (const severity of SEVERITIES) {
      expect(REVIEWER.prompt).toContain(severity);
    }
    // the prompt embeds the verdict contract fields (description, required snippet, closed disposition enum)
    expect(REVIEWER.prompt).toContain('"findings"');
    expect(REVIEWER.prompt).toContain('"description"');
    expect(REVIEWER.prompt).toContain('"snippet"');
    expect(REVIEWER.prompt).toContain("fix | wontfix");
    // citation_check is recomputed by the toolkit; the prompt no longer asks for it (C14)
    expect(REVIEWER.prompt).not.toContain('"citation_check"');
    // empty findings = valid completed verdict
    expect(REVIEWER.prompt).toContain("EMPTY findings array is a valid");
  });

  test("implementer prompt: prep artifacts, conventions skill, no git/shell", () => {
    expect(IMPLEMENTER.prompt).toContain("prep artifacts");
    // references the porting-conventions skill by name, and composes its instructions in by value
    expect(IMPLEMENTER.prompt).toContain(PORTING_CONVENTIONS.name);
    expect(IMPLEMENTER.prompt).toContain(PORTING_CONVENTIONS.instructions);
    expect(IMPLEMENTER.prompt).toContain("No git operations");
    expect(IMPLEMENTER.prompt).toContain("No shell");
    // PHP fixture is read-only input
    expect(IMPLEMENTER.prompt).toContain("READ-ONLY");
  });

  test("fixer prompt: verdict-driven, severity order, no git/shell", () => {
    expect(FIXER.prompt).toContain("verdict records");
    expect(FIXER.prompt).toContain("blocker, then major, then minor, then nit");
    expect(FIXER.prompt).toContain("No git operations");
    expect(FIXER.prompt).toContain("No shell");
    expect(FIXER.prompt).toContain("wontfix");
  });
});
