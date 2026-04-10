import { z } from "zod";
import { defineTool } from "../../src/core/Tool";

describe("defineTool", () => {
  it("returns a ToolDef with correct name and description", () => {
    const tool = defineTool({
      name: "get_time",
      description: "Returns current time",
      input: {},
      run: async () => new Date().toISOString(),
    });

    expect(tool.name).toBe("get_time");
    expect(tool.description).toBe("Returns current time");
  });

  it("run function executes and returns a string", async () => {
    const tool = defineTool({
      name: "add",
      description: "Adds two numbers",
      input: { a: z.number(), b: z.number() },
      run: async ({ a, b }) => String((a as number) + (b as number)),
    });

    const result = await tool.run({ a: 3, b: 4 });
    expect(result).toBe("7");
  });

  it("input schema is preserved on the returned ToolDef", () => {
    const schema = { city: z.string() };
    const tool = defineTool({
      name: "weather",
      description: "Get weather",
      input: schema,
      run: async () => "sunny",
    });

    expect(tool.input).toBe(schema);
  });

  it("run can use all typed input fields", async () => {
    const tool = defineTool({
      name: "greet",
      description: "Greets a user",
      input: { name: z.string(), formal: z.boolean() },
      run: async ({ name, formal }) =>
        formal ? `Good day, ${name}.` : `Hey ${name}!`,
    });

    expect(await tool.run({ name: "Alice", formal: true })).toBe("Good day, Alice.");
    expect(await tool.run({ name: "Bob", formal: false })).toBe("Hey Bob!");
  });
});
