/**
 * Skills Registry: loads Agent Skill definitions from the skills/ directory.
 *
 * Each skill is a directory containing a SKILL.md file with YAML frontmatter
 * that declares `name` and `description`. The body of the SKILL.md contains
 * detailed instructions that are loaded lazily on demand via the `read_skill` tool.
 *
 * Progressive disclosure:
 * - Startup: only name + description are surfaced (in the system prompt)
 * - On demand: full SKILL.md content is returned when Claude calls read_skill()
 */

import { readFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve skills/ relative to the mcp-app-host package root.
const SKILLS_DIR = join(__dirname, "..", "..", "skills");

export interface SkillSummary {
  name: string;
  description: string;
}

interface LoadedSkill extends SkillSummary {
  content: string; // Full SKILL.md text (including frontmatter)
}

/**
 * Maps skill name → the tool names it exposes.
 * Update this when adding new skills or tools.
 */
export const SKILL_TOOL_MAP: Record<string, string[]> = {
  "date-tools": ["get_current_datetime", "calculate_date_offset"],
  "gold-guide": ["ask_gold_guide"],
  "ltft-calculator": ["calculate_ltft_cct"]
};

const loadedSkills = new Map<string, LoadedSkill>();

/**
 * Parse YAML frontmatter from a SKILL.md string.
 * Returns { name, description } from the frontmatter, or null if missing/invalid.
 */
function parseFrontmatter(
  content: string
): { name: string; description: string } | null {
  const parsed = matter(content);
  const name = parsed.data.name;
  const description = parsed.data.description;

  if (typeof name !== "string" || typeof description !== "string") {
    return null;
  }

  return {
    name: name.trim(),
    description: description.trim()
  };
}

/** Load all skills from the skills/ directory. Called once at startup. */
export async function loadSkills(): Promise<void> {
  try {
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillPath = join(SKILLS_DIR, entry.name, "SKILL.md");
      try {
        const content = await readFile(skillPath, "utf-8");
        const frontmatter = parseFrontmatter(content);

        if (!frontmatter) {
          console.warn(
            `[Skills] Skipping ${entry.name}: missing or invalid frontmatter`
          );
          continue;
        }

        loadedSkills.set(frontmatter.name, {
          name: frontmatter.name,
          description: frontmatter.description,
          content
        });

        console.log(
          `[Skills] Loaded skill: ${frontmatter.name} — ${frontmatter.description.slice(0, 60)}…`
        );
      } catch (err) {
        console.warn(`[Skills] Failed to load ${skillPath}:`, err);
      }
    }
  } catch (err) {
    console.warn("[Skills] Failed to read skills directory:", err);
  }
}

/** Returns lightweight summaries for injection into the system prompt. */
export function getSkillSummaries(): SkillSummary[] {
  return Array.from(loadedSkills.values()).map(({ name, description }) => ({
    name,
    description
  }));
}

/**
 * Returns the full SKILL.md content for a given skill name.
 * Returns an error string if the skill is not found.
 */
export function getSkillContent(skillName: string): string {
  const skill = loadedSkills.get(skillName);
  if (!skill) {
    const available = Array.from(loadedSkills.keys()).join(", ");
    return `Skill "${skillName}" not found. Available skills: ${available}`;
  }
  return skill.content;
}

/**
 * Returns the tool names associated with a skill.
 * Returns an empty array if the skill has no registered tools.
 */
export function getToolNamesForSkill(skillName: string): string[] {
  return SKILL_TOOL_MAP[skillName] ?? [];
}

/** Returns true if the skill exists in the loaded registry. */
export function hasSkill(skillName: string): boolean {
  return loadedSkills.has(skillName);
}
