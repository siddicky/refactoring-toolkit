/**
 * Unit tests for harness/skills — standalone, assert-based.
 * Run: bun run harness/skills/skills.test.ts
 */

import {
  findSkill,
  PORTING_CONVENTIONS,
  PHP_TO_TS_TYPE_MAP,
  SKILLS,
} from "./index.js";
import type { SkillModule } from "./types.js";
import { assertEquals, assertTrue, runTestFile } from "../../src/queues/testkit.js";

runTestFile("skills", {
  "registry contains porting-conventions and lookup works": () => {
    assertTrue(
      SKILLS.some((s) => s.name === "porting-conventions"),
      "porting-conventions is registered",
    );
    assertEquals(findSkill("porting-conventions"), PORTING_CONVENTIONS);
    assertEquals(findSkill("nope"), undefined, "unknown skill is undefined");
  },

  "every registered skill satisfies the SkillModule contract": () => {
    for (const skill of SKILLS) {
      const asSkill: SkillModule = skill;
      assertTrue(asSkill.name.length > 0, "name non-empty");
      assertTrue(asSkill.description.length > 0, "description non-empty");
      assertTrue(asSkill.instructions.length > 0, "instructions non-empty");
    }
  },

  "PHP→TS type map covers the core scalars": () => {
    assertEquals(PHP_TO_TS_TYPE_MAP["string"], "string");
    assertEquals(PHP_TO_TS_TYPE_MAP["int"], "number");
    assertEquals(PHP_TO_TS_TYPE_MAP["float"], "number");
    assertEquals(PHP_TO_TS_TYPE_MAP["bool"], "boolean");
    assertEquals(PHP_TO_TS_TYPE_MAP["array"], "unknown[]");
    assertEquals(PHP_TO_TS_TYPE_MAP["mixed"], "unknown");
    // Numeric PHP scalars must not map to string-ish TS types.
    assertTrue(
      PHP_TO_TS_TYPE_MAP["int"] !== "string" && PHP_TO_TS_TYPE_MAP["float"] !== "string",
      "numeric PHP types map to number",
    );
  },
});
