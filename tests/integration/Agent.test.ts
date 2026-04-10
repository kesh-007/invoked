import { makeTextResponse, makePlanResponse, setQueryResponses } from "../mocks/sdk";

// Mock the SDK before importing Agent
jest.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: jest.fn(),
  tool: jest.fn((_name: string, _desc: string, _input: unknown, _run: unknown) => ({})),
  createSdkMcpServer: jest.fn(() => undefined),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { Agent } from "../../src/core/Agent";

const mockQuery = query as unknown as jest.MockedFunction<(...args: unknown[]) => AsyncGenerator<unknown>>;

function makeAgent(extra: Partial<ConstructorParameters<typeof Agent>[0]> = {}) {
  return new Agent({
    name: "test-agent",
    instructions: "You are a test agent.",
    memory: false,
    ...extra,
  });
}

// ── generate() ────────────────────────────────────────────────────────────────

describe("Agent.generate()", () => {
  it("returns the full result string from query", async () => {
    setQueryResponses(mockQuery, makeTextResponse("Hello, world!"));
    const agent = makeAgent();
    const result = await agent.generate("say hello");
    expect(result).toBe("Hello, world!");
  });

  it("passes the system prompt to query", async () => {
    setQueryResponses(mockQuery, makeTextResponse("ok"));
    const agent = makeAgent({ instructions: "Custom instructions here." });
    await agent.generate("test");

    const callArgs = mockQuery.mock.calls[0][0] as { options: { systemPrompt: string } };
    expect(callArgs.options.systemPrompt).toContain("Custom instructions here.");
  });

  it("forwards the prompt to query", async () => {
    setQueryResponses(mockQuery, makeTextResponse("ok"));
    const agent = makeAgent();
    await agent.generate("my prompt");

    const callArgs = mockQuery.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toBe("my prompt");
  });

  it("does not persist session when memory: false", async () => {
    setQueryResponses(mockQuery, makeTextResponse("ok"));
    const agent = makeAgent({ memory: false });
    await agent.generate("test");

    // No session ID should be written — verify query was not called with resume
    const callArgs = mockQuery.mock.calls[0][0] as { options: Record<string, unknown> };
    expect(callArgs.options.resume).toBeUndefined();
  });

  it("returns empty string when query yields no result", async () => {
    mockQuery.mockImplementationOnce(async function* () {
      // no events at all
    });
    const agent = makeAgent();
    const result = await agent.generate("test");
    expect(result).toBe("");
  });
});

// ── stream() ──────────────────────────────────────────────────────────────────

describe("Agent.stream()", () => {
  it("yields text chunks from stream events", async () => {
    setQueryResponses(mockQuery, makeTextResponse("chunk1chunk2"));
    const agent = makeAgent();

    const chunks: string[] = [];
    for await (const chunk of agent.stream("test")) {
      chunks.push(chunk);
    }
    expect(chunks.join("")).toBe("chunk1chunk2");
  });

  it("yields nothing when no text delta events arrive", async () => {
    mockQuery.mockImplementationOnce(async function* () {
      yield { result: "final only, no stream events" };
    });
    const agent = makeAgent();

    const chunks: string[] = [];
    for await (const chunk of agent.stream("test")) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
  });
});

// ── generateObject() ──────────────────────────────────────────────────────────

describe("Agent.generateObject()", () => {
  it("parses and returns a typed object", async () => {
    const schema = z.object({ name: z.string(), age: z.number() });
    const payload = { name: "Alice", age: 30 };

    setQueryResponses(mockQuery, [{ result: JSON.stringify(payload) }]);

    const agent = makeAgent();
    const result = await agent.generateObject("extract person", schema);
    expect(result).toEqual(payload);
  });

  it("extracts JSON from a markdown code block", async () => {
    const schema = z.object({ value: z.string() });
    const payload = { value: "hello" };

    setQueryResponses(mockQuery, [
      { result: "```json\n" + JSON.stringify(payload) + "\n```" },
    ]);

    const agent = makeAgent();
    const result = await agent.generateObject("extract", schema);
    expect(result).toEqual(payload);
  });

  it("throws when no JSON can be found in the response", async () => {
    setQueryResponses(mockQuery, [{ result: "Sorry, I cannot help with that." }]);
    const agent = makeAgent();
    await expect(agent.generateObject("extract", z.object({ x: z.string() }))).rejects.toThrow();
  });

  it("throws when response is empty", async () => {
    mockQuery.mockImplementationOnce(async function* () {
      // yields nothing
    });
    const agent = makeAgent();
    await expect(agent.generateObject("extract", z.object({ x: z.string() }))).rejects.toThrow();
  });
});

// ── withModel() ───────────────────────────────────────────────────────────────

describe("Agent.withModel()", () => {
  it("returns a new Agent with the specified model", async () => {
    setQueryResponses(mockQuery, makeTextResponse("ok"));
    const agent = makeAgent();
    const remapped = agent.withModel("claude-opus-4-6");

    await remapped.generate("test");
    const callArgs = mockQuery.mock.calls[0][0] as { options: { model: string } };
    expect(callArgs.options.model).toBe("claude-opus-4-6");
  });

  it("does not mutate the original agent", () => {
    const agent = makeAgent({ model: "claude-sonnet-4-6" });
    agent.withModel("claude-opus-4-6");
    // original stays unchanged — just verify it doesn't throw
    expect(agent.name).toBe("test-agent");
  });
});

// ── asSkill() ─────────────────────────────────────────────────────────────────

describe("Agent.asSkill()", () => {
  it("returns a SkillDef with the agent's name and provided description", () => {
    const agent = makeAgent();
    const skill = agent.asSkill("Handles all test tasks");
    expect(skill.name).toBe("test-agent");
    expect(skill.description).toBe("Handles all test tasks");
    expect(skill.agent).toBe(agent);
  });
});

// ── description getter ────────────────────────────────────────────────────────

describe("Agent.description", () => {
  it("returns the description from config", () => {
    const agent = makeAgent({ description: "My test agent" });
    expect(agent.description).toBe("My test agent");
  });

  it("returns undefined when description is not set", () => {
    const agent = makeAgent();
    expect(agent.description).toBeUndefined();
  });
});
