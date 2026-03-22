import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { z } from "zod";

import { WorkingMemory } from "./memory/WorkingMemory";
import { runInputPipeline, runOutputPipeline } from "./pipelines";
import { buildMcpServer } from "./Tool";
import { skillsToTools, formatSkillsForPrompt } from "./Skill";
import type { AgentConfig, InputContext, OutputContext, SkillDef, ToolDef } from "./types";

// ─── Session persistence ──────────────────────────────────────────────────────

const SESSION_FILE = join(process.cwd(), ".sessions.json");

function loadSessions(): Record<string, string> {
  if (!existsSync(SESSION_FILE)) return {};
  try {
    const parsed = JSON.parse(readFileSync(SESSION_FILE, "utf-8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {
    // corrupted file — start fresh
  }
  return {};
}

function persistSession(name: string, id: string) {
  const s = loadSessions();
  s[name] = id;
  writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2));
}

function dropSession(name: string) {
  const s = loadSessions();
  delete s[name];
  writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2));
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export class Agent {
  readonly name: string;

  private cfg: AgentConfig;

  /**
   * Internal scratchpad — only active when `scratchpad: true` is passed to
   * the constructor. Stores the current goal and any notes the agent writes
   * to itself during a run so it never loses track of what it is doing.
   */
  private _scratchpad: WorkingMemory | null;

  constructor(config: AgentConfig) {
    this.cfg = config;
    this.name = config.name;
    this._scratchpad = config.scratchpad === true ? new WorkingMemory() : null;
  }

  // ── generate ───────────────────────────────────────────────────────────────

  /**
   * Send a prompt and receive the full response as a string.
   *
   * @example
   * const answer = await agent.generate("Summarise this codebase");
   */
  async generate(
    prompt: string,
    metadata: Record<string, unknown> = {}
  ): Promise<string> {
    const ctx = await this._buildContext(prompt, metadata);

    let result = "";
    let newSessionId: string | undefined;

    for await (const message of query({
      prompt: ctx.inputCtx.message,
      options: {
        systemPrompt: ctx.systemPrompt,
        allowedTools: ctx.allowedTools,
        ...(ctx.prevSession ? { resume: ctx.prevSession } : {}),
        ...(ctx.mcpServers ? { mcpServers: ctx.mcpServers } : {}),
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        newSessionId = (message as Record<string, unknown>).session_id as string;
      }
      if ("result" in message) {
        result = (message.result as string) ?? "";
      }
    }

    if (newSessionId) persistSession(this.name, newSessionId);
    return this._finalise(result, ctx.inputCtx, metadata);
  }

  // ── stream ─────────────────────────────────────────────────────────────────

  /**
   * Send a prompt and receive an async generator that yields text as it arrives.
   *
   * @example
   * for await (const chunk of agent.stream("Explain async generators")) {
   *   process.stdout.write(chunk);
   * }
   */
  async *stream(
    prompt: string,
    metadata: Record<string, unknown> = {}
  ): AsyncGenerator<string> {
    const ctx = await this._buildContext(prompt, metadata);

    let fullResult = "";
    let newSessionId: string | undefined;

    for await (const message of query({
      prompt: ctx.inputCtx.message,
      options: {
        systemPrompt: ctx.systemPrompt,
        allowedTools: ctx.allowedTools,
        includePartialMessages: true,
        ...(ctx.prevSession ? { resume: ctx.prevSession } : {}),
        ...(ctx.mcpServers ? { mcpServers: ctx.mcpServers } : {}),
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        newSessionId = (message as Record<string, unknown>).session_id as string;
      }

      if (message.type === "stream_event") {
        const event = (message as Record<string, unknown>).event as Record<string, unknown>;
        if (
          event?.type === "content_block_delta" &&
          (event.delta as Record<string, unknown>)?.type === "text_delta"
        ) {
          const text = (event.delta as Record<string, unknown>).text as string;
          if (text) yield text;
        }
      }

      if ("result" in message) {
        fullResult = (message.result as string) ?? "";
      }
    }

    if (newSessionId) persistSession(this.name, newSessionId);
    await this._finalise(fullResult, ctx.inputCtx, metadata);
  }

  // ── generateObject ─────────────────────────────────────────────────────────

  /**
   * Send a prompt and receive a fully typed, structured object — nothing else.
   * Uses the SDK's native JSON schema output mode, so the response is
   * guaranteed to match your schema (no markdown, no extra text).
   *
   * @example
   * const result = await agent.generateObject(
   *   "Extract the person's details from this text: John is 30 years old.",
   *   z.object({ name: z.string(), age: z.number() })
   * );
   * // result → { name: "John", age: 30 }
   */
  async generateObject<T extends z.ZodType>(
    prompt: string,
    schema: T,
    metadata: Record<string, unknown> = {}
  ): Promise<z.infer<T>> {
    const ctx = await this._buildContext(prompt, metadata);

    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;

    let structuredOutput: unknown;
    let rawResult = "";
    let newSessionId: string | undefined;

    for await (const message of query({
      prompt: ctx.inputCtx.message,
      options: {
        systemPrompt: ctx.systemPrompt,
        allowedTools: ctx.allowedTools,
        outputFormat: { type: "json_schema", schema: jsonSchema },
        ...(ctx.prevSession ? { resume: ctx.prevSession } : {}),
        ...(ctx.mcpServers ? { mcpServers: ctx.mcpServers } : {}),
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        newSessionId = (message as Record<string, unknown>).session_id as string;
      }
      if ("result" in message) {
        const msg = message as Record<string, unknown>;
        structuredOutput = msg.structured_output;
        rawResult = (msg.result as string) ?? "";
      }
    }

    if (newSessionId) persistSession(this.name, newSessionId);
    await this._finalise(rawResult, ctx.inputCtx, metadata);
    return schema.parse(structuredOutput);
  }

  // ── clearMemory ────────────────────────────────────────────────────────────

  /** Wipe the scratchpad and session. No-op if scratchpad is disabled. */
  clearMemory() {
    this._scratchpad?.clear();
    dropSession(this.name);
    console.log(`[${this.name}] Memory cleared.`);
  }

  /**
   * Expose this agent as a Skill that another agent can invoke.
   *
   * @example
   * const orchestrator = new Agent({
   *   skills: [researcher.asSkill("Handles all web research tasks")],
   * });
   */
  asSkill(description: string): SkillDef {
    return { name: this.name, description, agent: this };
  }

  // ── private ────────────────────────────────────────────────────────────────

  private async _buildContext(prompt: string, metadata: Record<string, unknown>) {
    // 1. Track current goal in scratchpad (only when enabled)
    this._scratchpad?.set("goal", prompt);

    // 2. Input context
    let inputCtx: InputContext = {
      message: prompt,
      agentName: this.name,
      timestamp: new Date().toISOString(),
      metadata,
    };

    // 3. Input pipeline
    if (this.cfg.inputPipeline?.length) {
      inputCtx = await runInputPipeline(inputCtx, this.cfg.inputPipeline);
    }

    // 4. System prompt assembly
    const base =
      typeof this.cfg.instructions === "function"
        ? this.cfg.instructions(inputCtx)
        : this.cfg.instructions;

    const parts: string[] = [base];

    if (this.cfg.skills?.length) {
      parts.push(formatSkillsForPrompt(this.cfg.skills));
    }

    // Scratchpad — injected only when enabled
    if (this._scratchpad) {
      const scratch = this._scratchpad.format();
      if (scratch) parts.push(`\n\n## Scratchpad\n${scratch}`);
    }

    const systemPrompt = parts.join("").trim();

    // 5. Built-in remember tool (only when scratchpad is enabled) + user tools + skills
    const allTools: ToolDef[] = [];

    if (this._scratchpad) {
      const scratchpad = this._scratchpad;
      const rememberTool: ToolDef = {
        name: "remember",
        description:
          "Write a note to your scratchpad. Use this to track decisions, sub-goals, or progress so you never lose track of your task.",
        input: { note: z.string().describe("The note to write") },
        run: async (args) => {
          const notes = scratchpad.get<string[]>("notes") ?? [];
          notes.push(String(args.note));
          scratchpad.set("notes", notes);
          return "Noted.";
        },
      };
      allTools.push(rememberTool);
    }

    allTools.push(...(this.cfg.tools ?? []), ...skillsToTools(this.cfg.skills ?? []));

    const serverKey = `${this.name}-tools`;
    const server = buildMcpServer(this.name, allTools, []);
    const mcpServers = server ? { [serverKey]: server } : undefined;

    const mcpToolNames = allTools.map((t) => `mcp__${serverKey}__${t.name}`);
    const allowedTools = [
      ...new Set([...(this.cfg.allowedTools ?? []), ...mcpToolNames]),
    ];

    // 6. Session
    const prevSession = loadSessions()[this.name];

    return { inputCtx, systemPrompt, mcpServers, allowedTools, prevSession };
  }

  private async _finalise(
    result: string,
    inputCtx: InputContext,
    metadata: Record<string, unknown>
  ): Promise<string> {
    let outputCtx: OutputContext = {
      result,
      agentName: this.name,
      input: inputCtx,
      metadata,
    };

    if (this.cfg.outputPipeline?.length) {
      outputCtx = await runOutputPipeline(outputCtx, this.cfg.outputPipeline);
    }

    return outputCtx.result;
  }
}
