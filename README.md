# invoked

Build Claude-powered agents, cron jobs, and webhook automations — no API key needed.

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

## Peer dependencies

```bash
npm install @anthropic-ai/claude-agent-sdk @anthropic-ai/claude-code zod
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
| Scratchpad | Opt-in internal notepad — agent tracks its own goal and notes |
| Automations | Cron jobs + HTTP webhooks wired to agents |

Agents are **stateless by default**. No history is stored between calls unless you opt in.

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

When enabled, the agent automatically records its current goal and can write notes to itself via a built-in `remember` tool — preventing it from drifting on long tasks.

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

---

## Automations

Wire agents to cron schedules and HTTP webhooks with a fluent builder:

```typescript
import { Agent, createAutomation, startAutomations } from "invoked";

const reporter = new Agent({
  name: "reporter",
  instructions: "You write concise daily summary reports.",
  allowedTools: ["Read", "Glob"],
});

// Run on a schedule
createAutomation("daily-report")
  .cron("0 9 * * 1-5")       // weekdays at 9 am
  .agent(reporter)
  .prompt("Summarise recent changes in ./src")
  .start();

// Receive HTTP webhooks
createAutomation("github-pr")
  .webhook("/github/pr", { method: "POST" })
  .agent(codeReviewer)
  .prompt((req) => `Review this PR: ${JSON.stringify(req.body)}`)
  .start();

// Custom handler with full control
createAutomation("health")
  .webhook("/health", { method: "GET" })
  .run((_req, ctx) => ({ status: "ok", timestamp: ctx.triggeredAt }));

// Boot everything
await startAutomations({ port: 3000 });
```

`startAutomations()` is smart about what it starts:
- **Cron only** → no HTTP server, no port needed
- **Webhooks** → starts HTTP server on `port`
- **Both** → does both

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
| `scratchpad` | `boolean` | `false` | Enable internal goal + notes tracking |
| `allowedTools` | `string[]` | `[]` | Built-in Claude Code tools to allow |
| `tools` | `ToolDef[]` | `[]` | Custom tools |
| `skills` | `SkillDef[]` | `[]` | Sub-agents to delegate to |
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
