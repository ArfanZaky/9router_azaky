import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../dataDir.js";

const MAX_PROJECT_MEMORY_CHARS = 2400; // ~600 tokens
const MAX_USER_PREF_CHARS = 1400;     // ~350 tokens

export function getMemoryPaths(workspace) {
  let dir = "";
  if (workspace && typeof workspace === "string") {
    try {
      const targetDir = path.resolve(workspace, ".9router");
      dir = targetDir;
    } catch {
      dir = path.join(DATA_DIR, "memory");
    }
  } else {
    dir = path.join(DATA_DIR, "memory");
  }

  return {
    memoryDir: dir,
    projectMemoryFile: path.join(dir, "MEMORY.md"),
    userMemoryFile: path.join(dir, "USER.md"),
  };
}

export function loadDualTierMemory(workspace) {
  const { projectMemoryFile, userMemoryFile } = getMemoryPaths(workspace);
  let projectMemory = "";
  let userMemory = "";

  try {
    if (fs.existsSync(projectMemoryFile)) {
      projectMemory = fs.readFileSync(projectMemoryFile, "utf8").trim();
    }
  } catch {
    // ignore
  }

  try {
    if (fs.existsSync(userMemoryFile)) {
      userMemory = fs.readFileSync(userMemoryFile, "utf8").trim();
    }
  } catch {
    // ignore
  }

  // Also check global fallback if workspace-specific userMemory is empty
  if (!userMemory) {
    try {
      const globalUserFile = path.join(DATA_DIR, "memory", "USER.md");
      if (fs.existsSync(globalUserFile)) {
        userMemory = fs.readFileSync(globalUserFile, "utf8").trim();
      }
    } catch {
      // ignore
    }
  }

  return {
    projectMemory: projectMemory.slice(0, MAX_PROJECT_MEMORY_CHARS),
    userMemory: userMemory.slice(0, MAX_USER_PREF_CHARS),
  };
}

function dedupeAndBoundLines(existingContent, newFact, maxChars) {
  const cleanFact = String(newFact || "").trim();
  if (!cleanFact) return existingContent || "";

  let lines = (existingContent || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Normalize bullet lines
  const factLines = cleanFact
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => (l.startsWith("- ") || l.startsWith("* ") ? l : `- ${l}`));

  for (const f of factLines) {
    const fLower = f.toLowerCase().replace(/^[-*]\s*/, "");
    // Remove conflicting or exact duplicate line
    lines = lines.filter((line) => {
      const lLower = line.toLowerCase().replace(/^[-*]\s*/, "");
      return lLower !== fLower;
    });
    lines.push(f);
  }

  let result = lines.join("\n");
  while (result.length > maxChars && lines.length > 1) {
    lines.shift(); // Evict oldest facts first to stay bounded
    result = lines.join("\n");
  }

  return result;
}

export function saveDualTierMemory(workspace, { type, content, mode = "append" }) {
  const { memoryDir, projectMemoryFile, userMemoryFile } = getMemoryPaths(workspace);
  try {
    fs.mkdirSync(memoryDir, { recursive: true });
  } catch {
    return { ok: false, error: "Cannot create memory directory" };
  }

  const isUser = type === "user";
  const targetFile = isUser ? userMemoryFile : projectMemoryFile;
  const maxChars = isUser ? MAX_USER_PREF_CHARS : MAX_PROJECT_MEMORY_CHARS;

  let finalContent = "";
  if (mode === "replace") {
    finalContent = String(content || "").trim().slice(0, maxChars);
  } else {
    let existing = "";
    try {
      if (fs.existsSync(targetFile)) {
        existing = fs.readFileSync(targetFile, "utf8").trim();
      }
    } catch {
      existing = "";
    }
    finalContent = dedupeAndBoundLines(existing, content, maxChars);
  }

  try {
    fs.writeFileSync(targetFile, finalContent, "utf8");
    return { ok: true, file: targetFile, bytes: Buffer.byteLength(finalContent), content: finalContent };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export function formatDualTierMemoryForPrompt(workspace) {
  const { projectMemory, userMemory } = loadDualTierMemory(workspace);
  if (!projectMemory && !userMemory) return "";

  const sections = ["## Persistent Memory (Hermes Dual-Tier)"];
  if (projectMemory) {
    sections.push(`### Project Knowledge & Gotchas (MEMORY.md):\n${projectMemory}`);
  }
  if (userMemory) {
    sections.push(`### User Preferences & Style (USER.md):\n${userMemory}`);
  }
  sections.push("Use these remembered facts and preferences without asking the user to repeat them.");
  return sections.join("\n\n");
}
