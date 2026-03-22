import { z } from "zod";
import type { SkillDef, ToolDef } from "./types";

// ─── defineSkill ──────────────────────────────────────────────────────────────

/**
 * Define a skill — a named capability the agent can invoke autonomously.
 *
 * @example — backed by another agent
 * const researchSkill = defineSkill({
 *   name: "research",
 *   description: "Search the web and return a detailed summary with sources",
 *   agent: researcherAgent,
 * });
 *
 * @example — custom function
 * const formatSkill = defineSkill({
 *   name: "format_json",
 *   description: "Pretty-print a JSON string",
 *   input: { json: z.string() },
 *   run: async ({ json }) => JSON.stringify(JSON.parse(String(json)), null, 2),
 * });
 */
export function defineSkill(def: SkillDef): SkillDef {
  if (!def.agent && !def.run) {
    throw new Error(`Skill "${def.name}" must have either "agent" or "run"`);
  }
  return def;
}

// ─── Internal: convert skills to ToolDefs ────────────────────────────────────

/**
 * Converts a list of SkillDefs into ToolDefs so they can be registered
 * as MCP tools.  Each skill gets the tool name `skill_<name>`.
 */
export function skillsToTools(skills: SkillDef[]): ToolDef[] {
  return skills.map((skill): ToolDef => {
    if (skill.agent) {
      return {
        name: `skill_${skill.name}`,
        description: skill.description,
        input: {
          task: z.string().describe(
            `The full task to send to the "${skill.name}" skill`
          ),
        },
        run: async (args) => skill.agent!.generate(String(args.task ?? "")),
      };
    }

    return {
      name: `skill_${skill.name}`,
      description: skill.description,
      input: skill.input ?? { task: z.string() },
      run: skill.run!,
    };
  });
}

/**
 * Builds the skills block injected into the system prompt,
 * so the agent is aware of what skills it can invoke.
 */
export function formatSkillsForPrompt(skills: SkillDef[]): string {
  if (!skills.length) return "";
  const lines = skills.map(
    (s) =>
      `  • skill_${s.name}${s.agent ? ` (via ${s.agent.name})` : ""}: ${s.description}`
  );
  return `\n\n## Skills You Can Invoke\n${lines.join("\n")}`;
}
