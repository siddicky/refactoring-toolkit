/**
 * Skill registry — placeholder module structure for harness/skills
 * (oh-my-openagent style: skills as TS modules composing into agent prompts).
 *
 * v1 ships one concrete skill; add new skills here as they land.
 */

import type { SkillModule } from "./types.js";
import { PORTING_CONVENTIONS } from "./porting-conventions.js";

export { PORTING_CONVENTIONS, PHP_TO_TS_TYPE_MAP } from "./porting-conventions.js";
export type { SkillModule } from "./types.js";

export const SKILLS: readonly SkillModule[] = [PORTING_CONVENTIONS];

export function findSkill(name: string): SkillModule | undefined {
  return SKILLS.find((skill) => skill.name === name);
}
