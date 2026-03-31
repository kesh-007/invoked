/**
 * Core API tests for the invoked library.
 */

import { Agent, defineTool, defineSkill, createInputProcessor, createOutputProcessor, loadSkills } from "./index";
import { z } from "zod";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";

// ─── Test Utilities ─────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  status: "✓" | "✗";
  error?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, status: "✓" });
    console.log(`✓ ${name}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name, status: "✗", error });
    console.error(`✗ ${name}: ${error}`);
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("🧪 Running core API tests...\n");

  await test("Agent creation", () => {
    const agent = new Agent({ name: "test-agent", instructions: "You are helpful." });
    assert(agent.name === "test-agent", "Agent name should match");
  });

  await test("defineTool()", () => {
    const tool = defineTool({
      name: "add",
      description: "Add two numbers",
      input: { a: z.number(), b: z.number() },
      run: async ({ a, b }) => `${Number(a) + Number(b)}`,
    });
    assert(tool.name === "add", "Tool should have name");
    assert(typeof tool.run === "function", "Tool should have run function");
  });

  await test("defineSkill() with agent", () => {
    const agent = new Agent({ name: "helper", instructions: "Help" });
    const skill = defineSkill({ name: "helper_skill", description: "Helper", agent });
    assert(skill.name === "helper_skill", "Skill should have name");
    assert(skill.agent === agent, "Skill should reference agent");
  });

  await test("defineSkill() requires agent or run", () => {
    let error: Error | undefined;
    try {
      defineSkill({ name: "invalid", description: "Invalid" });
    } catch (err) {
      error = err as Error;
    }
    assert(error !== undefined, "Should throw when neither agent nor run provided");
  });

  await test("createInputProcessor()", () => {
    const processor = createInputProcessor((ctx) => ({ ...ctx, message: `PREFIX: ${ctx.message}` }));
    assert(typeof processor === "function", "Should return a function");
  });

  await test("createOutputProcessor()", () => {
    const processor = createOutputProcessor((ctx) => ({ ...ctx, result: `${ctx.result}\nSUFFIX` }));
    assert(typeof processor === "function", "Should return a function");
  });

  await test("Agent.asSkill()", () => {
    const agent = new Agent({ name: "research", instructions: "Research" });
    const skill = agent.asSkill("Handles research tasks");
    assert(skill.name === "research", "Skill name should match agent name");
    assert(skill.agent === agent, "Skill should reference agent");
  });

  await test("Agent with memory: false does not persist sessions", () => {
    const { existsSync, readFileSync } = require("fs");
    const SESSION_FILE = require("path").join(process.cwd(), ".sessions.json");

    const agent = new Agent({
      name: "stateless-summarizer",
      instructions: "Summarize text.",
      memory: false,
    });

    assert(agent.name === "stateless-summarizer", "Agent should be created");

    // Capture sessions before
    const before: Record<string, string> = existsSync(SESSION_FILE)
      ? JSON.parse(readFileSync(SESSION_FILE, "utf-8"))
      : {};

    // clearMemory should not crash even with memory: false
    agent.clearMemory();

    // Sessions file should not have gained an entry for this agent
    const after: Record<string, string> = existsSync(SESSION_FILE)
      ? JSON.parse(readFileSync(SESSION_FILE, "utf-8"))
      : {};

    assert(
      after["stateless-summarizer"] === undefined,
      "memory:false agent should never write a session entry"
    );
    assert(
      Object.keys(after).length <= Object.keys(before).length,
      "Sessions file should not grow for memory:false agent"
    );
  });

  await test("loadSkills() with single file feeds into Agent", () => {
    const dir = ".test-skill-tmp";
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "researcher.md"), `---\nname: researcher\ndescription: Research specialist\nallowedTools: ["WebSearch"]\nscratchpad: true\n---\n\nYou research topics thoroughly.`);
    try {
      const skills = loadSkills(join(dir, "researcher.md"));
      assert(skills.length === 1, "Should return array with one skill");
      assert(skills[0].name === "researcher", "Skill name should come from frontmatter");
      assert(skills[0].description === "Research specialist", "Skill description should come from frontmatter");

      const orchestrator = new Agent({
        name: "orchestrator",
        instructions: "Coordinate tasks.",
        skills,
      });
      assert(orchestrator.name === "orchestrator", "Agent with loaded skill should be created");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  await test("loadSkills() throws on missing frontmatter", () => {
    const dir = ".test-skill-tmp2";
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "bad.md"), "No frontmatter here");
    let error: Error | undefined;
    try {
      loadSkills(join(dir, "bad.md"));
    } catch (err) {
      error = err as Error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    assert(error !== undefined, "Should throw on missing frontmatter");
  });

  await test("loadSkills() loads directory and feeds into Agent", () => {
    const dir = ".test-skills-tmp";
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "s1.md"), `---\nname: skill1\ndescription: First\n---\nDo first.`);
    writeFileSync(join(dir, "s2.md"), `---\nname: skill2\ndescription: Second\n---\nDo second.`);
    try {
      const skills = loadSkills(dir);
      assert(skills.length === 2, "Should load 2 skills");
      assert(skills.some((s) => s.name === "skill1"), "Should load skill1");
      assert(skills.some((s) => s.name === "skill2"), "Should load skill2");

      const orchestrator = new Agent({
        name: "orchestrator",
        instructions: "Coordinate tasks.",
        skills,
      });
      assert(orchestrator.name === "orchestrator", "Agent with all loaded skills should be created");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Summary
  console.log("\n" + "═".repeat(50));
  const passed = results.filter((r) => r.status === "✓").length;
  const failed = results.filter((r) => r.status === "✗").length;
  console.log(`\n📊 ${passed} passed, ${failed} failed out of ${results.length} tests\n`);

  if (failed > 0) {
    results.filter((r) => r.status === "✗").forEach((r) => console.log(`  ✗ ${r.name}: ${r.error}`));
    process.exit(1);
  } else {
    console.log("✅ All tests passed!");
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
