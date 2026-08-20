import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

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

// Best-effort git status for the project folder (read-only).
function git(cwd, ...args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
    }).trim();
  } catch {
    return "";
  }
}

export function gitProjectStatus(value) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) return { repo: false };
  if (!fs.existsSync(path.join(workspacePath, ".git"))) return { repo: false };
  const branch = git(workspacePath, "rev-parse", "--abbrev-ref", "HEAD") || "HEAD";
  const last = git(workspacePath, "log", "-1", "--pretty=%h %s") || "";
  const ahead = git(workspacePath, "rev-list", "--count", "@{upstream}..HEAD");
  const behind = git(workspacePath, "rev-list", "--count", "HEAD..@{upstream}");
  const statusLines = git(workspacePath, "status", "--porcelain=v1");
  const changes = statusLines
    .split("\n")
    .filter(Boolean)
    .slice(0, 100)
    .map((line) => {
      const xy = line.slice(0, 2);
      const p = line.slice(3);
      let status = "modified";
      if (xy.includes("??")) status = "untracked";
      else if (xy[0] === "D" || xy[1] === "D") status = "deleted";
      else if (xy[0] === "A" || xy[1] === "A") status = "staged";
      return { path: p, status };
    });
  return {
    repo: true,
    branch,
    last,
    ahead: ahead && Number.isFinite(Number(ahead)) ? Number(ahead) : 0,
    behind: behind && Number.isFinite(Number(behind)) ? Number(behind) : 0,
    changes,
  };
}

export function readProjectPlan(value) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) return { exists: false };
  for (const name of [".antares/plan.md", "PLAN.md", "plan.md"]) {
    const p = path.join(workspacePath, name);
    if (fs.existsSync(p)) {
      return { exists: true, path: name, raw: fs.readFileSync(p, "utf8") };
    }
  }
  return { exists: false };
}

export function listProjectTree(value, sub = "") {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) return [];
  const dir = path.resolve(workspacePath, sub || "");
  if (!dir.startsWith(workspacePath)) return [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => !SKIP.has(e.name))
    .slice(0, 200)
    .map((e) => ({
      name: e.name,
      path: path.relative(workspacePath, path.join(dir, e.name)).replace(/\\/g, "/"),
      is_dir: e.isDirectory(),
    }));
}

export function projectEnvFiles(value) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) return [];
  let entries = [];
  try { entries = fs.readdirSync(workspacePath); } catch { return []; }
  return entries.filter((n) => /^\.env(\.[a-zA-Z0-9_-]+)?$/.test(n));
}

