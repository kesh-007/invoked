# invoked

Build Claude-powered agents — no API key needed.

Runs on your existing **Claude Code** subscription. Authentication is handled automatically.

```bash
npm install invoked
```

---

## Quick start

```typescript
import { Agent } from "invoked";

const agent = new Agent({
  name: "assistant",
  instructions: "You are a helpful assistant.",
});

const answer = await agent.generate("What is TypeScript?");
console.log(answer);
```

---

## Install

```bash
npm install invoked zod
```

---

## Core features

| Feature | Description |
|---|---|
| `generate()` | Full response as a string |
| `stream()` | Real token-by-token streaming |
| `generateObject()` | Typed structured output via Zod schemas |
| Tools | Custom TypeScript functions Claude can call |
| Skills | Delegate sub-tasks to specialised agents |
| MCP servers | Connect to any MCP server — stdio or SSE |
| Scratchpad | Opt-in internal notepad — agent tracks its own goal and notes |
| Processors | Middleware pipeline to transform inputs and outputs |

Agents remember conversation history across calls by default. Set `memory: false` for one-shot tasks where history is irrelevant.

---

## Agents

```typescript
import { Agent } from "invoked";

const agent = new Agent({
  name: "assistant",
  instructions: "You are a helpful assistant.",
});

// Full response
const answer = await agent.generate("Explain closures in JavaScript");

// Stream token by token
for await (const chunk of agent.stream("Write a short story")) {
  process.stdout.write(chunk);
}
```

### Structured output

```typescript
import { z } from "zod";

const result = await agent.generateObject(
  "Extract: Alice is 30 years old and knows TypeScript.",
  z.object({ name: z.string(), age: z.number() })
);
// result.name → "Alice"
// result.age  → 30
```

### Built-in Claude Code tools

```typescript
new Agent({
  allowedTools: ["Read", "Glob", "Grep"],   // read files
  // or
  allowedTools: ["Bash"],                   // shell commands
  // or
  allowedTools: ["WebSearch", "WebFetch"],  // web access
});
```

### Stateless agents

Set `memory: false` for agents that should never load or save session history — every call is completely independent:

```typescript
const summarizer = new Agent({
  name: "summarizer",
  instructions: "Summarize the given text concisely.",
  memory: false,
});

// Each call is fully independent — no history, no session written
const summary = await summarizer.generate(longText);
```

Useful for summarization, classification, formatting, or any one-shot task.

### Scratchpad

Enable the scratchpad when your agent needs to track its own goal and progress across a complex multi-step task:

```typescript
const agent = new Agent({
  name: "researcher",
  instructions: "You are a research analyst.",
  allowedTools: ["WebSearch", "WebFetch"],
  scratchpad: true,
});
```

---

## Tools

```typescript
import { Agent, defineTool } from "invoked";
import { z } from "zod";

const getWeather = defineTool({
  name: "get_weather",
  description: "Get current weather for a city",
  input: { city: z.string() },
  run: async ({ city }) => `22°C and sunny in ${city}`,
});

const agent = new Agent({
  name: "weather-bot",
  instructions: "You help with weather queries.",
  tools: [getWeather],
});
```

---

## Skills

Skills are sub-agents the main agent can invoke autonomously to handle complete sub-tasks:

```typescript
import { Agent } from "invoked";

const researcher = new Agent({
  name: "researcher",
  instructions: "Search the web and summarise findings.",
  allowedTools: ["WebSearch", "WebFetch"],
});

const orchestrator = new Agent({
  name: "orchestrator",
  instructions: "You coordinate tasks. Delegate research to your skills.",
  skills: [researcher.asSkill("Handles all web research")],
});

await orchestrator.generate("Research the latest TypeScript 6 news");
```

### Loading skills from files

Define skills as markdown files and load them at runtime:

```markdown
---
name: researcher
description: Searches the web and summarises findings
allowedTools: ["WebSearch", "WebFetch"]
scratchpad: true
---

You are a research analyst. Search the web and summarise findings with cited sources.
```

```typescript
import { Agent, loadSkills } from "invoked";

// Single file → array with one skill
const skills = loadSkills("./skills/researcher.md");

// Directory → all .md files loaded as skills
const skills = loadSkills("./skills");

const orchestrator = new Agent({
  name: "orchestrator",
  instructions: "Coordinate tasks using your skills.",
  skills,
});
```

---

## MCP servers

Connect agents to any [Model Context Protocol](https://modelcontextprotocol.io) server:

```typescript
// Stdio server (local process)
const agent = new Agent({
  name: "coder",
  instructions: "You help with code tasks.",
  mcpServers: {
    filesystem: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "./src"],
    },
  },
});

// SSE server (remote HTTP)
const agent = new Agent({
  name: "assistant",
  instructions: "You are a helpful assistant.",
  mcpServers: {
    myApi: {
      type: "sse",
      url: "https://my-mcp-server.com/sse",
      headers: { Authorization: "Bearer my-token" },
    },
  },
});
```

---

## Input / Output processors

Transform messages before Claude sees them, or results before they're returned:

```typescript
import { createInputProcessor, createOutputProcessor } from "invoked";
import { appendFileSync } from "fs";

const addDate = createInputProcessor((ctx) => ({
  ...ctx,
  message: `[${ctx.timestamp.slice(0, 10)}] ${ctx.message}`,
}));

const auditLog = createOutputProcessor((ctx) => {
  appendFileSync("./audit.log", `${ctx.input.timestamp} | ${ctx.result.slice(0, 100)}\n`);
  return ctx;
});

const agent = new Agent({
  name: "audited",
  instructions: "You are a helpful assistant.",
  inputPipeline: [addDate],
  outputPipeline: [auditLog],
});
```

---

## API reference

### `new Agent(config)`

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Unique agent name |
| `instructions` | `string \| (ctx) => string` | required | System prompt |
| `memory` | `boolean` | `true` | Set to `false` to disable session persistence — every call is fully independent |
| `scratchpad` | `boolean` | `false` | Enable internal goal + notes tracking |
| `allowedTools` | `string[]` | `[]` | Built-in Claude Code tools to allow |
| `tools` | `ToolDef[]` | `[]` | Custom tools |
| `skills` | `SkillDef[]` | `[]` | Sub-agents to delegate to |
| `mcpServers` | `Record<string, McpServerConfig>` | `{}` | External MCP servers |
| `inputPipeline` | `InputMiddleware[]` | `[]` | Pre-process the message |
| `outputPipeline` | `OutputMiddleware[]` | `[]` | Post-process the result |

### Methods

| Method | Returns | Description |
|---|---|---|
| `generate(prompt, metadata?)` | `Promise<string>` | Full response |
| `stream(prompt, metadata?)` | `AsyncGenerator<string>` | Token-by-token |
| `generateObject(prompt, schema, metadata?)` | `Promise<z.infer<T>>` | Typed object |
| `clearMemory()` | `void` | Clear scratchpad + session |
| `asSkill(description)` | `SkillDef` | Expose as skill for another agent |

---

## License

MIT
