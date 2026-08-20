import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function candidateSkillRoots() {
  const roots = [];
  const add = (p) => {
    if (p && !roots.includes(p)) roots.push(p);
  };
  add(path.join(process.cwd(), "skills"));
  add(path.resolve(__dirname, "../../../skills"));
  add(path.resolve(__dirname, "../../../../skills"));
  // OpenCode global skills (~/.config/opencode/skills) — like opencode, so the
  // chat agent has the same skill library.
  add(path.join(os.homedir(), ".config", "opencode", "skills"));
  if (process.env.OPENCODE_CONFIG_DIR) add(path.join(process.env.OPENCODE_CONFIG_DIR, "skills"));
  if (process.env.NINEROUTER_SKILLS_DIR) add(process.env.NINEROUTER_SKILLS_DIR);
  return roots;
}

export function resolveSkillRoots() {
  const roots = [];
  for (const root of candidateSkillRoots()) {
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) roots.push(root);
    } catch {
      // ignore
    }
  }
  return roots;
}

// Parse YAML-ish front matter between leading "---" lines. Returns { meta, body }.
export function parseSkillFrontmatter(raw) {
  if (typeof raw !== "string") return { meta: {}, body: "" };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { meta: {}, body: raw };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (m) meta[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return { meta, body: match[2].trim() };
}

// Scan all skill roots and return { id, path, name, description, body }.
export function loadAllSkillIndex() {
  const roots = resolveSkillRoots();
  const skills = [];
  const seen = new Set();
  for (const dir of roots) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (seen.has(ent.name)) continue;
      const skillMd = path.join(dir, ent.name, "SKILL.md");
      if (!fs.existsSync(skillMd)) continue;
      try {
        const raw = fs.readFileSync(skillMd, "utf8");
        const { meta, body } = parseSkillFrontmatter(raw);
        seen.add(ent.name);
        skills.push({
          id: ent.name,
          path: skillMd,
          name: meta.name || ent.name,
          description: meta.description || "",
          body: body || raw,
        });
      } catch {
        // skip unreadable
      }
    }
  }
  skills.sort((a, b) => (a.id === "9router" ? -1 : b.id === "9router" ? 1 : a.id.localeCompare(b.id)));
  return skills;
}

// Catalogue-only text (name + description), like opencode: keeps the prompt small
// and bodies are fetched on demand via read_skill.
export function buildSkillCatalogue(skills, maxChars = 8000) {
  let text = "";
  for (const s of skills) {
    const line = s.description ? `- ${s.name}: ${s.description}` : `- ${s.name}`;
    if (text.length + line.length + 1 > maxChars) {
      text += `\n… [remaining skills omitted — read_skill to load]`;
      break;
    }
    text += `\n${line}`;
  }
  return text.trim();
}

export function getSkillByName(name) {
  const skills = loadAllSkillIndex();
  return skills.find((s) => s.id === name || s.name === name) || null;
}

// Backward-compat helpers used elsewhere.
export function resolveSkillsDir() {
  return resolveSkillRoots()[0] || null;
}

export function loadAllSkills({ maxChars = 24_000 } = {}) {
  const skills = loadAllSkillIndex();
  const text = buildSkillCatalogue(skills, maxChars);
  return { dir: resolveSkillsDir(), skills, text };
}

export function buildAgentSystemPrompt({ workspace, userSystem = "", accessMode = "sandbox" } = {}) {
  const { dir, skills, text } = loadAllSkills();
  const mode = accessMode === "full" ? "full" : "sandbox";
  const roots =
    mode === "full"
      ? [workspace || process.cwd(), process.cwd()].filter(Boolean)
      : [workspace || process.cwd()].filter(Boolean);

  const accessLine =
    mode === "full"
      ? `Access mode: FULL — bash, write_file, read/list/grep, web, image generation.`
      : `Access mode: SANDBOX — read_file, list_dir, grep, web_search/fetch, generate_image only. No bash/write.`;

  const parts = [
    `You are 9Router Agent — an OpenCode-style coding agent running inside the 9Router dashboard.`,
    `You can use tools within the current access policy and 9Router capabilities.`,
    ``,
    accessLine,
    `Workspace roots: ${[...new Set(roots)].join(" | ")}`,
    `Skills dir: ${dir || "(not found)"} (${skills.length} skills loaded)`,
    `Platform: ${process.platform}`,
    ``,
    `Rules:`,
    `- Prefer tools over guessing about local files or shell state.`,
    `- Keep tool usage minimal and purposeful.`,
    `- After tools finish, give a clear final answer.`,
    `- Do not attempt destructive system operations (disk format, reboot, wiping roots).`,
    mode === "sandbox" ? `- Paths must stay under workspace roots.` : ``,
    mode === "sandbox" ? `- Sandbox: do not request bash/write_file; use read-only tools.` : ``,
    ``,
  ].filter(Boolean);

  if (userSystem?.trim()) {
    parts.push(`User system instructions:\n${userSystem.trim()}`, ``);
  }

  if (text) {
    parts.push(
      `## Available skills (catalogue)\nWhen a task matches a skill, load it with read_skill <name> and follow it.${text}`,
      ``,
    );
  }

  return parts.join("\n");
}
