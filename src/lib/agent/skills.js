import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function candidateSkillRoots() {
  const roots = [];
  const add = (p) => {
    if (p && !roots.includes(p)) roots.push(p);
  };
  add(path.join(process.cwd(), "skills"));
  // src/lib/agent → ../../../skills
  add(path.resolve(__dirname, "../../../skills"));
  add(path.resolve(__dirname, "../../../../skills"));
  if (process.env.NINEROUTER_SKILLS_DIR) add(process.env.NINEROUTER_SKILLS_DIR);
  return roots;
}

export function resolveSkillsDir() {
  for (const root of candidateSkillRoots()) {
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return root;
    } catch {
      // ignore
    }
  }
  return null;
}

export function loadAllSkills({ maxChars = 24_000 } = {}) {
  const dir = resolveSkillsDir();
  if (!dir) return { dir: null, skills: [], text: "" };

  const skills = [];
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { dir, skills: [], text: "" };
  }

  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillMd = path.join(dir, ent.name, "SKILL.md");
    if (!fs.existsSync(skillMd)) continue;
    try {
      const raw = fs.readFileSync(skillMd, "utf8");
      skills.push({ id: ent.name, path: skillMd, content: raw });
    } catch {
      // skip
    }
  }

  // Prefer entry skill first
  skills.sort((a, b) => {
    if (a.id === "9router") return -1;
    if (b.id === "9router") return 1;
    return a.id.localeCompare(b.id);
  });

  let text = "";
  for (const s of skills) {
    const block = `\n### Skill: ${s.id}\n\n${s.content}\n`;
    if (text.length + block.length > maxChars) {
      text += `\n… [remaining skills truncated for context budget]\n`;
      break;
    }
    text += block;
  }

  return { dir, skills, text };
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
    parts.push(`## Available 9Router skills (reference)`, text);
  }

  return parts.join("\n");
}
