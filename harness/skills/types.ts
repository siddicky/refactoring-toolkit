/**
 * Skill module contract (oh-my-openagent style: skills as TS modules).
 *
 * A skill is a named, reusable instruction payload that agent prompts compose
 * in by value. This is the placeholder module structure for harness/skills —
 * v1 ships exactly one concrete skill (porting-conventions); the registry is
 * the growth point for later skills without touching agent definitions.
 */

export interface SkillModule {
  /** Stable identifier agents reference (e.g. in prompts). */
  name: string;
  /** One-line description of when the skill applies. */
  description: string;
  /** The instruction body agents receive. */
  instructions: string;
}
