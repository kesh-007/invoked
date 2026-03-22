import type { z } from "zod";

// ─── Contexts ─────────────────────────────────────────────────────────────────

export interface InputContext {
  message: string;
  agentName: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface OutputContext {
  result: string;
  agentName: string;
  input: InputContext;
  metadata: Record<string, unknown>;
}

// ─── Processors ───────────────────────────────────────────────────────────────

/** Full middleware (has next() for chaining) */
export type InputMiddleware = (
  ctx: InputContext,
  next: (ctx: InputContext) => Promise<InputContext>
) => Promise<InputContext>;

export type OutputMiddleware = (
  ctx: OutputContext,
  next: (ctx: OutputContext) => Promise<OutputContext>
) => Promise<OutputContext>;

// ─── Tools ────────────────────────────────────────────────────────────────────

export interface ToolDef {
  name: string;
  description: string;
  input: Record<string, z.ZodType>;
  run: (args: Record<string, unknown>) => Promise<string>;
}

// ─── Skills ───────────────────────────────────────────────────────────────────

/**
 * A Skill is a named capability the agent can invoke autonomously.
 * Back it with another Agent or a custom function.
 */
export interface SkillDef {
  name: string;
  description: string;
  /** Delegate to another Agent */
  agent?: { generate: (prompt: string) => Promise<string>; name: string };
  /** Custom input schema (only when not using agent) */
  input?: Record<string, z.ZodType>;
  /** Custom implementation (only when not using agent) */
  run?: (args: Record<string, unknown>) => Promise<string>;
}

// ─── Memory ───────────────────────────────────────────────────────────────────

/**
 * Kept as a building block for memory extension packages.
 * Not used by the core Agent — agents are stateless by default.
 */
export interface MemoryConfig {
  conversation?: number | false;
  longTerm?: number | false;
}

// ─── Agent Config ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  instructions: string | ((ctx: InputContext) => string);

  /**
   * Enable the agent's internal scratchpad.
   * When true, the agent automatically tracks its current goal and can write
   * notes to itself via the built-in `remember` tool so it never drifts.
   * Defaults to false — agents are stateless by default.
   */
  scratchpad?: boolean;

  /** Built-in Claude Code tools: "Read", "Bash", "WebSearch", etc. */
  allowedTools?: string[];

  /** Custom tools — use defineTool() */
  tools?: ToolDef[];

  /**
   * Skills — other agents or functions the main agent can invoke autonomously.
   * Use defineSkill() to create them.
   * Each skill is auto-exposed as a callable tool named `skill_<name>`.
   */
  skills?: SkillDef[];

  /** Transform the message before the agent sees it */
  inputPipeline?: InputMiddleware[];

  /** Transform the result before it is returned */
  outputPipeline?: OutputMiddleware[];
}
