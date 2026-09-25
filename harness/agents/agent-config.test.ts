/**
 * Unit tests for harness/agents agent definition configs — standalone.
 * Run: bun run harness/agents/agent-config.test.ts
 *
 * These test the DECLARATIVE configs (data only). Effective tool permissions
 * after config + plugin merge are runtime tests owned by worker-1/lead.
 */

import { IMPLEMENTER } from "./implementer.js";
import { REVIEWER } from "./reviewer.js";
import { FIXER } from "./fixer.js";
import { TOOL_CATEGORIES, type AgentDefinition } from "./types.js";
import { SEVERITIES } from "./verdict-schema.js";
import { PORTING_CONVENTIONS } from "../skills/porting-conventions.js";
import { assertEquals, assertTrue, runTestFile } from "../../src/queues/testkit.js";

const AGENTS: readonly AgentDefinition[] = [IMPLEMENTER, REVIEWER, FIXER];

runTestFile("agent-config", {
  "reviewer denies ALL tool categories and allows nothing": () => {
    assertEquals(REVIEWER.tools.allow, [], "reviewer allow list is empty");
    assertEquals(
      [...REVIEWER.tools.deny].sort(),
      [...TOOL_CATEGORIES].sort(),
      "reviewer deny list covers every tool category",
    );
  },

  "implementer and fixer have scoped writes, no git, no shell": () => {
    for (const agent of [IMPLEMENTER, FIXER]) {
      assertTrue(agent.tools.allow.length > 0, `${agent.name} may write`);
      for (const forbidden of ["git", "bash", "shell", "task", "webfetch", "mcp"]) {
        assertTrue(
          agent.tools.deny.includes(
            forbidden as (typeof TOOL_CATEGORIES)[number],
          ),
          `${agent.name} denies ${forbidden}`,
        );
      }
      // allow ∩ deny = ∅ and every allow entry is a known category.
      for (const allowed of agent.tools.allow) {
        assertTrue(
          !agent.tools.deny.includes(allowed),
          `${agent.name}: ${allowed} must not be both allowed and denied`,
        );
        assertTrue(
          TOOL_CATEGORIES.includes(allowed),
          `${agent.name}: ${allowed} is a known category`,
        );
      }
    }
  },

  "allow and deny only reference known categories; names are unique": () => {
    const names = AGENTS.map((a) => a.name);
    assertEquals(new Set(names).size, names.length, "agent names unique");
    for (const agent of AGENTS) {
      for (const entry of [...agent.tools.allow, ...agent.tools.deny]) {
        assertTrue(
          TOOL_CATEGORIES.includes(entry),
          `${agent.name}: unknown tool category ${entry}`,
        );
      }
    }
  },

  "reviewer prompt: adversarial stance, diff-only, structured verdict, empty findings allowed": () => {
    assertTrue(
      REVIEWER.prompt.includes("ASSUME THE CODE IS WRONG"),
      "reviewer prompt sets the adversarial stance",
    );
    assertTrue(
      REVIEWER.prompt.includes("by value") && REVIEWER.prompt.includes("No tools"),
      "diff arrives by value; reviewer holds no tools",
    );
    for (const severity of SEVERITIES) {
      assertTrue(
        REVIEWER.prompt.includes(severity),
        `prompt single-sources the severity enum value "${severity}"`,
      );
    }
    assertTrue(
      REVIEWER.prompt.includes('"findings"') && REVIEWER.prompt.includes('"citation_check"'),
      "prompt embeds the verdict contract fields",
    );
    assertTrue(
      REVIEWER.prompt.includes("EMPTY findings array is a valid"),
      "empty findings = valid completed verdict",
    );
  },

  "implementer prompt: prep artifacts, conventions skill, no git/shell": () => {
    assertTrue(
      IMPLEMENTER.prompt.includes("prep artifacts"),
      "implementer ports per prep artifacts",
    );
    assertTrue(
      IMPLEMENTER.prompt.includes(PORTING_CONVENTIONS.name),
      "implementer prompt references the porting-conventions skill by name",
    );
    assertTrue(
      IMPLEMENTER.prompt.includes(PORTING_CONVENTIONS.instructions),
      "skill instructions are composed in by value",
    );
    assertTrue(
      IMPLEMENTER.prompt.includes("No git operations"),
      "implementer prompt forbids git",
    );
    assertTrue(
      IMPLEMENTER.prompt.includes("No shell"),
      "implementer prompt forbids shell",
    );
    assertTrue(
      IMPLEMENTER.prompt.includes("READ-ONLY"),
      "PHP fixture is read-only input",
    );
  },

  "fixer prompt: verdict-driven, severity order, no git/shell": () => {
    assertTrue(
      FIXER.prompt.includes("verdict records"),
      "fixer consumes verdict records",
    );
    assertTrue(
      FIXER.prompt.includes("blocker, then major, then minor, then nit"),
      "fixer applies findings in severity order",
    );
    assertTrue(FIXER.prompt.includes("No git operations"), "fixer forbids git");
    assertTrue(FIXER.prompt.includes("No shell"), "fixer forbids shell");
    assertTrue(
      FIXER.prompt.includes("wontfix"),
      "fixer honors wontfix dispositions",
    );
  },
});
