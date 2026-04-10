import { existsSync, rmSync } from "fs";
import { join } from "path";
import { Memory, ConversationMemory } from "../../src/core/memory/Memory";

const MEMORY_DIR = join(process.cwd(), ".memory");

function cleanup() {
  if (existsSync(MEMORY_DIR)) {
    rmSync(MEMORY_DIR, { recursive: true, force: true });
  }
}

// ── Memory (file-backed) ──────────────────────────────────────────────────────

describe("Memory", () => {
  afterEach(cleanup);

  it("starts empty — read() returns []", () => {
    const mem = new Memory("test-agent");
    expect(mem.read()).toEqual([]);
  });

  it("append() persists entries across instances", () => {
    new Memory("agent-a").append("hello", "world");
    const entries = new Memory("agent-a").read();
    expect(entries).toHaveLength(1);
    expect(entries[0].user).toBe("hello");
    expect(entries[0].assistant).toBe("world");
  });

  it("each agent has its own file (no cross-contamination)", () => {
    new Memory("agent-a").append("user-a", "assistant-a");
    new Memory("agent-b").append("user-b", "assistant-b");

    expect(new Memory("agent-a").read()[0].user).toBe("user-a");
    expect(new Memory("agent-b").read()[0].user).toBe("user-b");
  });

  it("respects the max entries limit", () => {
    const mem = new Memory("agent-limit", 3);
    mem.append("u1", "a1");
    mem.append("u2", "a2");
    mem.append("u3", "a3");
    mem.append("u4", "a4"); // should evict u1

    const entries = mem.read();
    expect(entries).toHaveLength(3);
    expect(entries[0].user).toBe("u2");
    expect(entries[2].user).toBe("u4");
  });

  it("format() returns null when empty", () => {
    expect(new Memory("agent-empty").format()).toBeNull();
  });

  it("format() returns human-readable text when populated", () => {
    const mem = new Memory("agent-fmt");
    mem.append("What is TypeScript?", "A typed superset of JavaScript.");
    const text = mem.format()!;
    expect(text).toContain("What is TypeScript?");
    expect(text).toContain("A typed superset of JavaScript.");
  });

  it("clear() removes the file", () => {
    const mem = new Memory("agent-clear");
    mem.append("u", "a");
    expect(mem.read()).toHaveLength(1);
    mem.clear();
    expect(mem.read()).toEqual([]);
  });
});

// ── ConversationMemory ────────────────────────────────────────────────────────

describe("ConversationMemory", () => {
  it("starts empty — format() returns null", () => {
    expect(new ConversationMemory().format()).toBeNull();
  });

  it("add() and format() produce labelled lines", () => {
    const mem = new ConversationMemory();
    mem.add("user", "Hello");
    mem.add("assistant", "Hi there");
    const text = mem.format()!;
    expect(text).toContain("User: Hello");
    expect(text).toContain("Assistant: Hi there");
  });

  it("enforces maxPairs — oldest turns are evicted", () => {
    const mem = new ConversationMemory(2); // 2 pairs = 4 turns max
    mem.add("user", "u1"); mem.add("assistant", "a1");
    mem.add("user", "u2"); mem.add("assistant", "a2");
    mem.add("user", "u3"); mem.add("assistant", "a3"); // evicts u1/a1

    const text = mem.format()!;
    expect(text).not.toContain("u1");
    expect(text).toContain("u2");
    expect(text).toContain("u3");
  });

  it("clear() empties all turns", () => {
    const mem = new ConversationMemory();
    mem.add("user", "hello");
    mem.clear();
    expect(mem.format()).toBeNull();
  });
});
