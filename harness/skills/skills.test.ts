/**
 * Unit tests for harness/skills.
 */

import { describe, expect, test } from "bun:test";
import {
  findSkill,
  PORTING_CONVENTIONS,
  PHP_TO_TS_TYPE_MAP,
  SKILLS,
} from "./index.js";
import type { SkillModule } from "./types.js";

describe("skills", () => {
  test("registry contains porting-conventions and lookup works", () => {
    expect(SKILLS.some((s) => s.name === "porting-conventions")).toBe(true);
    expect(findSkill("porting-conventions")).toStrictEqual(PORTING_CONVENTIONS);
    expect(findSkill("nope")).toBeUndefined();
  });

  test("every registered skill satisfies the SkillModule contract", () => {
    for (const skill of SKILLS) {
      const asSkill: SkillModule = skill;
      expect(asSkill.name.length).toBeGreaterThan(0);
      expect(asSkill.description.length).toBeGreaterThan(0);
      expect(asSkill.instructions.length).toBeGreaterThan(0);
    }
  });

  test("PHP→TS type map covers the core scalars", () => {
    expect(PHP_TO_TS_TYPE_MAP.string).toBe("string");
    expect(PHP_TO_TS_TYPE_MAP.int).toBe("number");
    expect(PHP_TO_TS_TYPE_MAP.float).toBe("number");
    expect(PHP_TO_TS_TYPE_MAP.bool).toBe("boolean");
    expect(PHP_TO_TS_TYPE_MAP.array).toBe("unknown[]");
    expect(PHP_TO_TS_TYPE_MAP.mixed).toBe("unknown");
    // Numeric PHP scalars must not map to string-ish TS types.
    expect(PHP_TO_TS_TYPE_MAP.int).not.toBe("string");
    expect(PHP_TO_TS_TYPE_MAP.float).not.toBe("string");
  });
});
