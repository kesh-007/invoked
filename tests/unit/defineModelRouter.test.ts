import { defineModelRouter } from "../../src/core/Orchestrator";

describe("defineModelRouter", () => {
  it("matches a string rule (case-insensitive)", async () => {
    const router = defineModelRouter([
      { match: "search", model: "claude-haiku-4-5-20251001" },
    ]);
    expect(await router("search the web")).toBe("claude-haiku-4-5-20251001");
    expect(await router("SEARCH for data")).toBe("claude-haiku-4-5-20251001");
  });

  it("matches a RegExp rule", async () => {
    const router = defineModelRouter([
      { match: /write|draft/i, model: "claude-sonnet-4-6" },
    ]);
    expect(await router("write a blog post")).toBe("claude-sonnet-4-6");
    expect(await router("DRAFT a report")).toBe("claude-sonnet-4-6");
  });

  it("matches an async predicate", async () => {
    const router = defineModelRouter([
      { match: async (task) => task.length > 50, model: "claude-opus-4-6" },
    ]);
    const longTask = "a".repeat(51);
    const shortTask = "short";
    expect(await router(longTask)).toBe("claude-opus-4-6");
    expect(await router(shortTask)).toBe("claude-sonnet-4-6"); // falls to default
  });

  it("returns the first matching rule (order matters)", async () => {
    const router = defineModelRouter([
      { match: /analyze/i, model: "claude-opus-4-6" },
      { match: /analyze|write/i, model: "claude-sonnet-4-6" },
    ]);
    expect(await router("analyze this")).toBe("claude-opus-4-6");
  });

  it("falls back to default model when nothing matches", async () => {
    const router = defineModelRouter([{ match: "search", model: "claude-haiku-4-5-20251001" }]);
    expect(await router("unrelated task")).toBe("claude-sonnet-4-6");
  });

  it("uses a custom default model", async () => {
    const router = defineModelRouter(
      [{ match: "search", model: "claude-haiku-4-5-20251001" }],
      "claude-opus-4-6"
    );
    expect(await router("unrelated task")).toBe("claude-opus-4-6");
  });

  it("returns default when routes array is empty", async () => {
    const router = defineModelRouter([]);
    expect(await router("anything")).toBe("claude-sonnet-4-6");
  });
});
