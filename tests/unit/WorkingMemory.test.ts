import { WorkingMemory } from "../../src/core/memory/WorkingMemory";

describe("WorkingMemory", () => {
  let mem: WorkingMemory;

  beforeEach(() => {
    mem = new WorkingMemory();
  });

  it("stores and retrieves a value", () => {
    mem.set("key", "value");
    expect(mem.get("key")).toBe("value");
  });

  it("returns undefined for missing keys", () => {
    expect(mem.get("missing")).toBeUndefined();
  });

  it("has() reflects presence correctly", () => {
    expect(mem.has("x")).toBe(false);
    mem.set("x", 42);
    expect(mem.has("x")).toBe(true);
  });

  it("delete() removes a key", () => {
    mem.set("temp", true);
    mem.delete("temp");
    expect(mem.has("temp")).toBe(false);
  });

  it("clear() removes all keys", () => {
    mem.set("a", 1);
    mem.set("b", 2);
    mem.clear();
    expect(mem.has("a")).toBe(false);
    expect(mem.has("b")).toBe(false);
  });

  it("set() is chainable", () => {
    const result = mem.set("a", 1).set("b", 2);
    expect(result).toBe(mem);
    expect(mem.get("a")).toBe(1);
    expect(mem.get("b")).toBe(2);
  });

  it("toObject() returns a plain object snapshot", () => {
    mem.set("x", 10);
    mem.set("y", "hello");
    expect(mem.toObject()).toEqual({ x: 10, y: "hello" });
  });

  it("format() returns null when empty", () => {
    expect(mem.format()).toBeNull();
  });

  it("format() returns key:value lines when populated", () => {
    mem.set("goal", "write tests");
    mem.set("step", 1);
    const output = mem.format()!;
    expect(output).toContain("goal");
    expect(output).toContain("write tests");
    expect(output).toContain("step");
  });

  it("stores complex values (arrays, objects)", () => {
    mem.set("notes", ["note1", "note2"]);
    expect(mem.get<string[]>("notes")).toEqual(["note1", "note2"]);

    mem.set("meta", { count: 3 });
    expect(mem.get<{ count: number }>("meta")).toEqual({ count: 3 });
  });
});
