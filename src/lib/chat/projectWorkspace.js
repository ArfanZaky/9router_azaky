import fs from "node:fs";
import path from "node:path";

const SKIP = new Set([".git", ".next", "node_modules"]);

export function resolveProjectWorkspace(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const resolved = fs.realpathSync(path.resolve(raw));
  if (!fs.statSync(resolved).isDirectory()) throw new Error("Workspace must be a directory");
  return resolved;
}

export function inspectProjectWorkspace(value, depth = 2) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) return { workspacePath: "", name: "", files: [], scripts: {}, packageName: "" };
  const files = [];
  const walk = (current, level, relative = "") => {
    if (level < 0 || files.length >= 400) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || files.length >= 400) continue;
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      files.push({ path: rel, type: entry.isDirectory() ? "directory" : "file" });
      if (entry.isDirectory()) walk(path.join(current, entry.name), level - 1, rel);
    }
  };
  walk(workspacePath, Math.min(Math.max(Number(depth) || 2, 0), 4));
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(workspacePath, "package.json"), "utf8")); } catch { /* optional */ }
  return {
    workspacePath,
    name: path.basename(workspacePath),
    files,
    scripts: pkg.scripts || {},
    packageName: pkg.name || "",
  };
}
