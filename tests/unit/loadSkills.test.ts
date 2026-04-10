import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { loadSkills } from "../../src/core/loaders";

function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "invoked-test-"));
}

function writeSkillFile(dir: string, filename: string, content: string) {
  const path = join(dir, filename);
  writeFileSync(path, content);
  return path;
}

const VALID_SKILL = `---
name: researcher
description: Searches and summarises information
allowedTools: ["WebSearch"]
---

You are a research specialist. Return key findings about the given topic.
`;

const MINIMAL_SKILL = `---
name: formatter
description: Formats text
---

Format the given text cleanly.
`;

describe("loadSkills", () => {
  it("loads a single .md file as a SkillDef", () => {
    const dir = makeTmpDir();
    const path = writeSkillFile(dir, "researcher.md", VALID_SKILL);

    const skills = loadSkills(path);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("researcher");
    expect(skills[0].description).toBe("Searches and summarises information");
    expect(skills[0].agent).toBeDefined();
  });

  it("loads all .md files from a directory", () => {
    const dir = makeTmpDir();
    writeSkillFile(dir, "researcher.md", VALID_SKILL);
    writeSkillFile(dir, "formatter.md", MINIMAL_SKILL);

    const skills = loadSkills(dir);
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["formatter", "researcher"]);
  });

  it("ignores non-.md files in a directory", () => {
    const dir = makeTmpDir();
    writeSkillFile(dir, "researcher.md", VALID_SKILL);
    writeFileSync(join(dir, "notes.txt"), "ignore me");
    writeFileSync(join(dir, "config.json"), "{}");

    const skills = loadSkills(dir);
    expect(skills).toHaveLength(1);
    expect(skills[0].name).toBe("researcher");
  });

  it("throws when frontmatter is missing", () => {
    const dir = makeTmpDir();
    const path = writeSkillFile(dir, "bad.md", "No frontmatter here, just text.");
    expect(() => loadSkills(path)).toThrow(/frontmatter/i);
  });

  it("throws when 'name' is missing from frontmatter", () => {
    const dir = makeTmpDir();
    const path = writeSkillFile(dir, "no-name.md", `---\ndescription: missing name\n---\nBody.`);
    expect(() => loadSkills(path)).toThrow(/name/i);
  });

  it("throws when 'description' is missing from frontmatter", () => {
    const dir = makeTmpDir();
    const path = writeSkillFile(dir, "no-desc.md", `---\nname: my-skill\n---\nBody.`);
    expect(() => loadSkills(path)).toThrow(/description/i);
  });

  it("loaded skill has an agent that is the underlying Agent instance", () => {
    const dir = makeTmpDir();
    const path = writeSkillFile(dir, "skill.md", MINIMAL_SKILL);
    const skills = loadSkills(path);
    expect(skills[0].agent).toHaveProperty("name", "formatter");
    expect(typeof skills[0].agent!.generate).toBe("function");
  });

  it("returns an empty array for an empty directory", () => {
    const dir = makeTmpDir();
    // create a sub-directory so it still exists but has no .md files
    mkdirSync(join(dir, "sub"));
    const skills = loadSkills(dir);
    expect(skills).toEqual([]);
  });
});
