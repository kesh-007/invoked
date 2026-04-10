# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm build          # compile src/ → dist/ (tsc)
pnpm test           # run test.ts with ts-node
./node_modules/.bin/tsc --noEmit   # type-check without emitting
```

The test runner is `ts-node test.ts` (no test framework). `test.ts` at the repo root runs a live Orchestrator end-to-end — it makes real Claude API calls via the SDK, so it must be run from a terminal with an active Claude Code session, not from inside the IDE.

Published entry point: `dist/index.js` / `dist/index.d.ts`. Always run `pnpm build` before publishing.

---

## Architecture

This is **`invoked`** — a TypeScript SDK for building multi-agent pipelines on top of `@anthropic-ai/claude-agent-sdk`. It requires no API key; it uses the caller's Claude Code session for authentication.

### Public API surface (`src/index.ts` → `src/core/index.ts`)

Everything exported lives in `src/core/`. The public surface is:

| Export | File | Purpose |
|---|---|---|
| `Agent` | `Agent.ts` | Core agent class — wraps the SDK `query()` loop |
| `Orchestrator` | `Orchestrator.ts` | Multi-agent coordinator |
| `defineModelRouter` | `Orchestrator.ts` | Routing rules → `ModelRouter` function |
| `defineTool` | `Tool.ts` | Type-safe tool factory |
| `defineSkill` | `Skill.ts` | Skill factory (agent-backed or function-backed) |
| `loadSkills` | `loaders.ts` | Load skills from `.md` files or a directory |
| `createInputProcessor` / `createOutputProcessor` | `pipelines.ts` | Middleware helpers |
| `Memory`, `ConversationMemory` | `memory/Memory.ts` | File-backed and in-session memory |

---

### `Agent` (`src/core/Agent.ts`)

The central class. Every call goes through `_buildContext()` which assembles:
1. Runs the **input pipeline** (middleware transforms)
2. Builds a **system prompt** from `instructions` + skills block + scratchpad
3. Converts `tools` + `skills` into a local **MCP server** via `buildMcpServer()` — tools/skills are always exposed to the SDK as MCP tool calls, not native function calls
4. Loads the **session ID** from `.sessions.json` for conversation continuity (`memory: false` skips this)

Three call modes:
- `generate()` — accumulates the full result string from the SDK event loop
- `stream()` — yields `text_delta` events from `content_block_delta` stream events
- `generateObject()` — appends a JSON schema instruction to the prompt and parses the response; falls back through markdown code block extraction if the SDK doesn't return structured output directly

`withModel(model)` creates a stateless clone with a different model — used by the Orchestrator's model router.

`asSkill(description)` wraps the agent as a `SkillDef` for use inside another agent's `skills` array.

---

### `Orchestrator` (`src/core/Orchestrator.ts`)

Three-phase pipeline when `stream(task)` or `generate(task)` is called:

**Phase 1 — Plan**: An internal `planner` Agent calls `generateObject()` with a Zod schema that constrains `agent` to an enum of the provided agent names. The output is a typed workflow: `{ agent, task, runInParallel }[]`.

**Phase 2 — Execute**: Steps are grouped into batches — consecutive `runInParallel: true` steps form one batch and run via `mergeGenerators()` (a `Promise.race` loop that interleaves streaming chunks by arrival time). Sequential steps run one at a time; each receives all prior `results` injected into its prompt as context.

**Phase 3 — Synthesize**: An internal `synthesizer` Agent receives the original task + all agent outputs and produces one conclusive answer.

Yields typed `OrchestratorEvent` objects throughout. The `done` event carries both `results` (per-agent map) and `conclusion` (synthesized string).

---

### Skills vs Tools

**Tools** (`ToolDef`) — TypeScript functions Claude can call mid-conversation. Defined with `defineTool()`. Registered as MCP tools inside `Agent._buildContext()`.

**Skills** (`SkillDef`) — named capabilities backed by another `Agent` or a custom `run` function. Converted to `ToolDef` via `skillsToTools()` with the tool name `skill_<name>`. Also listed in the system prompt so Claude knows they exist.

Skills are for use within a single `Agent` (agent delegates to sub-agent autonomously). `Orchestrator` takes `Agent[]` directly and orchestrates them with explicit planning — do not use `.asSkill()` with `Orchestrator`.

---

### Session persistence

Sessions are stored in `.sessions.json` at `process.cwd()`. Keyed by agent name. Set `memory: false` on any agent that should not read/write sessions (always set this on agents created internally by `Orchestrator`).

---

### Types (`src/core/types.ts`)

Single source of truth for all interfaces. Notable:
- `OrchestratorConfig.agents` is typed as `Agent[]` via a forward-reference import to avoid circular deps
- `PlannedStep.agent` is the agent name string (not the Agent instance)
- `OrchestratorEvent` is a discriminated union — always switch on `event.type`
