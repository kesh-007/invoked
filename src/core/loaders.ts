import { readFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { Agent } from "./Agent";
import type { McpServerConfig, SkillDef } from "./types";

// ─── Frontmatter parser ───────────────────────────────────────────────────────

interface SkillFrontmatter {
  name: string;
  description: string;
  allowedTools?: string[];
  scratchpad?: boolean;
  mcpServers?: Record<string, McpServerConfig>;
}

function parseFrontmatter(source: string): { meta: SkillFrontmatter; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("Skill file is missing frontmatter (expected --- block at top)");

  const raw = match[1];
  const body = match[2].trim();
  const meta: Record<string, unknown> = {};

  for (const line of raw.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line.slice(colon + 1).trim();
    if (!key) continue;

    // JSON array or object
    if (val.startsWith("[") || val.startsWith("{")) {
      try { meta[key] = JSON.parse(val); } catch { meta[key] = val; }
    }
    // boolean
    else if (val === "true")  meta[key] = true;
    else if (val === "false") meta[key] = false;
    // string
    else meta[key] = val;
  }

  if (!meta.name)        throw new Error('Skill frontmatter must include "name"');
  if (!meta.description) throw new Error('Skill frontmatter must include "description"');

  return { meta: meta as unknown as SkillFrontmatter, body };
}

// ─── loadSkills ───────────────────────────────────────────────────────────────

/**
 * Load skills from a `.md` file or a directory of `.md` files.
 *
 * - Pass a **file path** → returns an array with that one skill.
 * - Pass a **directory** → returns all `.md` files in it as skills.
 *
 * Each markdown file must have a frontmatter block with `name` and `description`.
 * The file body becomes the agent's instructions.
 *
 * @example single file
 * ```typescript
 * const skills = loadSkills("./skills/researcher.md");
 * ```
 *
 * @example directory
 * ```typescript
 * const skills = loadSkills("./skills");
 *
 * const orchestrator = new Agent({
 *   name: "orchestrator",
 *   instructions: "Coordinate tasks using your skills.",
 *   skills,
 * });
 * ```
 */
export function loadSkills(path: string): SkillDef[] {
  if (statSync(path).isDirectory()) {
    const files = readdirSync(path).filter((f) => extname(f) === ".md");
    return files.map((f) => loadOne(join(path, f)));
  }
  return [loadOne(path)];
}

function loadOne(filePath: string): SkillDef {
  const source = readFileSync(filePath, "utf-8");
  const { meta, body } = parseFrontmatter(source);

  const agent = new Agent({
    name: meta.name,
    instructions: body,
    allowedTools: meta.allowedTools,
    scratchpad: meta.scratchpad,
    mcpServers: meta.mcpServers,
  });

  return agent.asSkill(meta.description);
}
