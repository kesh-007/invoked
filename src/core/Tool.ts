import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { ToolDef } from "./types";

// ─── defineTool ───────────────────────────────────────────────────────────────

/**
 * Type-safe tool factory.
 *
 * @example
 * const getTime = defineTool({
 *   name: "get_time",
 *   description: "Returns the current UTC timestamp",
 *   input: { timezone: z.string().optional() },
 *   run: async ({ timezone }) => new Date().toISOString(),
 * });
 */
export function defineTool<T extends Record<string, z.ZodType>>(def: {
  name: string;
  description: string;
  input: T;
  run: (args: { [K in keyof T]: z.infer<T[K]> }) => Promise<string>;
}): ToolDef {
  return {
    name: def.name,
    description: def.description,
    input: def.input as Record<string, z.ZodType>,
    run: def.run as (args: Record<string, unknown>) => Promise<string>,
  };
}

// ─── MCP server builder ───────────────────────────────────────────────────────

/**
 * Converts ToolDefs + SubAgentRefs into a live MCP server for the Agent SDK.
 * Returns undefined when there is nothing to register.
 */
export function buildMcpServer(
  agentName: string,
  tools: ToolDef[],
  _subAgents: unknown[] = []
) {
  const allDefs = [...tools];
  if (allDefs.length === 0) return undefined;

  const mcpTools = allDefs.map((def) =>
    tool(
      def.name,
      def.description,
      def.input,
      async (args: Record<string, unknown>) => {
        try {
          const result = await def.run(args);
          return { content: [{ type: "text" as const, text: result }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: "text" as const, text: `Tool error: ${msg}` }],
            isError: true,
          };
        }
      }
    )
  );

  return createSdkMcpServer({ name: `${agentName}-tools`, tools: mcpTools });
}
