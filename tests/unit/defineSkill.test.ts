import { z } from "zod";
import { defineSkill } from "../../src/core/Skill";

const mockAgent = {
  name: "test-agent",
  generate: jest.fn(async () => "agent result"),
};

describe("defineSkill", () => {
  it("accepts an agent-backed skill", () => {
    const skill = defineSkill({
      name: "research",
      description: "Handles research tasks",
      agent: mockAgent,
    });

    expect(skill.name).toBe("research");
    expect(skill.description).toBe("Handles research tasks");
    expect(skill.agent).toBe(mockAgent);
  });

  it("accepts a function-backed skill", () => {
    const run = jest.fn(async () => "function result");
    const skill = defineSkill({
      name: "format",
      description: "Formats data",
      input: { data: z.string() },
      run,
    });

    expect(skill.name).toBe("format");
    expect(skill.run).toBe(run);
  });

  it("throws when neither agent nor run is provided", () => {
    expect(() =>
      defineSkill({ name: "broken", description: "missing impl" })
    ).toThrow('Skill "broken" must have either "agent" or "run"');
  });

  it("returns the same object it was given (pass-through)", () => {
    const def = { name: "pass", description: "passthrough", agent: mockAgent };
    const skill = defineSkill(def);
    expect(skill).toBe(def);
  });
});
