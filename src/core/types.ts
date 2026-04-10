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

// ─── MCP ──────────────────────────────────────────────────────────────────────

export type McpStdioServerConfig = {
  type?: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
};

export type McpSseServerConfig = {
  type: "sse";
  url: string;
  headers?: Record<string, string>;
};

export type McpServerConfig = McpStdioServerConfig | McpSseServerConfig;

// ─── Model Router ─────────────────────────────────────────────────────────────

/**
 * A single routing rule: if `match` returns true for a task string, use `model`.
 * Evaluated in order — first match wins.
 */
export interface ModelRoute {
  /** String (substring), RegExp, or async predicate */
  match: string | RegExp | ((task: string) => boolean | Promise<boolean>);
  /** Full model ID or alias: 'claude-opus-4-6' | 'claude-sonnet-4-6' | 'claude-haiku-4-5-20251001' */
  model: string;
  /** Optional human-readable label */
  label?: string;
}

/** A function that maps a task string to the appropriate model ID. */
export type ModelRouter = (task: string) => Promise<string>;

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface PlannedStep {
  agent: string;
  task: string;
  runInParallel: boolean;
}

export type OrchestratorEvent =
  | { type: "planning"; message: string }
  | { type: "plan"; reasoning: string; steps: PlannedStep[] }
  | { type: "agent_start"; agent: string; task: string }
  | { type: "agent_chunk"; agent: string; chunk: string }
  | { type: "agent_done"; agent: string; result: string }
  | { type: "synthesizing"; message: string }
  | { type: "conclusion_chunk"; chunk: string }
  | { type: "conclusion"; result: string }
  | { type: "done"; results: Record<string, string>; conclusion: string };

export interface OrchestratorConfig {
  name: string;
  /** The agents available to the orchestrator for task execution */
  agents: import("./Agent").Agent[];
  /** Extra guidance appended to the planner's system prompt */
  instructions?: string;
  /** Model for the planning step. Defaults to "claude-sonnet-4-6". */
  plannerModel?: string;
  /** Model for the final synthesis/conclusion step. Defaults to plannerModel or "claude-sonnet-4-6". */
  synthesizerModel?: string;
  /**
   * Dynamic model router — maps each agent's task string to the best model.
   * Create one with `defineModelRouter()`.
   */
  modelRouter?: ModelRouter;
}

// ─── Agent Config ─────────────────────────────────────────────────────────────

export interface AgentConfig {
  name: string;
  /** Short description of what this agent does. Used by the Orchestrator's planner. */
  description?: string;
  instructions: string | ((ctx: InputContext) => string);

  /**
   * Claude model to use. Accepts a model alias or a full model ID.
   * Defaults to the model you have active in Claude Code.
   *
   * Aliases:  'sonnet' | 'opus' | 'haiku'
   * Full IDs: 'claude-sonnet-4-6' | 'claude-opus-4-6' | 'claude-haiku-4-5-20251001'
   */
  model?: string;

  /**
   * Set to `false` to disable session persistence — every call is completely
   * independent with no history loaded or saved. Ideal for one-shot tasks like
   * summarization, classification, or formatting.
   * Defaults to true.
   */
  memory?: boolean;

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

  /**
   * External MCP servers the agent can call tools from.
   * Supports stdio (local process) and SSE (remote HTTP) transports.
   *
   * @example — local filesystem server
   * mcpServers: {
   *   filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "./"] }
   * }
   *
   * @example — remote SSE server
   * mcpServers: {
   *   myApi: { type: "sse", url: "https://my-mcp-server.com/sse" }
   * }
   */
  mcpServers?: Record<string, McpServerConfig>;

  /** Transform the message before the agent sees it */
  inputPipeline?: InputMiddleware[];

  /** Transform the result before it is returned */
  outputPipeline?: OutputMiddleware[];
}
