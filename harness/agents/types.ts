/**
 * Shared vocabulary for opencode agent definition configs (oh-my-openagent
 * style: agents as TS modules, data only — no runtime in this directory).
 *
 * Tool vocabulary is deliberately CATEGORY-level (bash, git, read, ...), not
 * concrete opencode tool names: mapping categories onto the merged opencode
 * tool surface (including `mcp__*` server tools) happens at plugin merge and
 * is owned by worker-1/lead.
 *
 * ISOLATION NOTE (plan §Reviewer isolation enforcement): these ALLOW/DENY
 * configs are declarative intent. EFFECTIVE permissions must be tested after
 * the config + plugin merge — the merged reviewer agent must have zero
 * effective tools, and runtime probes must show denied-tool invocations are
 * refused. Those tests are worker-1/lead's, not this module's.
 */

/** Tool categories referenced by the plan's isolation requirements. */
export const TOOL_CATEGORIES = [
  "bash",
  "shell",
  "git",
  "read",
  "write",
  "edit",
  "glob",
  "grep",
  "task",
  "webfetch",
  "mcp",
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/**
 * A category may appear in at most one of allow/deny; DENY is authoritative:
 * anything denied must stay denied after plugin merge (no re-enable).
 */
export interface AgentToolConfig {
  allow: readonly ToolCategory[];
  deny: readonly ToolCategory[];
}

/** A data-only opencode agent definition. */
export interface AgentDefinition {
  name: string;
  description: string;
  /** Full role prompt rendered into the agent's system prompt. */
  prompt: string;
  tools: AgentToolConfig;
}

/** Tools the implementer/fixer may use — scoped to their lease worktree. */
export const AGENT_WRITE_TOOLS: readonly ToolCategory[] = [
  "read",
  "write",
  "edit",
  "glob",
  "grep",
];

/**
 * Everything porting agents are barred from. Includes ALL git access (plan
 * v6: agents hold no git access at all — the toolkit-owned commit step is the
 * sole committer) and all shell (slow commands forbidden inside the port
 * loop, spec git-safety rules).
 */
export const AGENT_FORBIDDEN_TOOLS: readonly ToolCategory[] = [
  "bash",
  "shell",
  "git",
  "task",
  "webfetch",
  "mcp",
];

/** Reviewers get DENY ALL (plan: explicit deny list, zero effective tools). */
export const REVIEWER_DENY_ALL: readonly ToolCategory[] = TOOL_CATEGORIES;
