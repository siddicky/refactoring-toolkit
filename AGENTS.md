# Agent guidance

This is an agent-operated migration toolkit. For a request to start or resume a migration, read [the migration skill](.agents/skills/porting-toolkit-migration/SKILL.md) and operate the workflow for the user. The user supplies goals and decisions in conversation; the agent inspects code, writes `PORTING.md`, sets up dependencies and services, runs the migration, and verifies the output.

The implemented runner currently handles PHP → TypeScript. Fixture defaults are demonstration data. Keep the source repository read-only unless the user explicitly requests source changes, and adapt the runner before attempting another language pair.
