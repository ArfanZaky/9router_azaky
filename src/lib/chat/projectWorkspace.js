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

// ── Git Binary Resolver & Environment Isolation ─────────────────────────────
// On Windows, resolve the direct native binary (e.g. mingw64\bin\git.exe) to bypass
// cmd/batch wrappers that trigger brief console / terminal window flashes.
let resolvedGitBin = null;
function getGitBinary() {
  if (resolvedGitBin) return resolvedGitBin;
  if (process.platform !== "win32") {
    resolvedGitBin = "git";
    return "git";
  }

  const localApp = process.env.LOCALAPPDATA || "";
  const progFiles = process.env["ProgramFiles"] || "C:\\Program Files";
  const progFiles86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

  const candidates = [
    process.env.GIT_PATH,
    path.join(progFiles, "Git", "mingw64", "bin", "git.exe"),
    path.join(progFiles, "Git", "bin", "git.exe"),
    path.join(progFiles, "Git", "cmd", "git.exe"),
    path.join(progFiles86, "Git", "mingw64", "bin", "git.exe"),
    path.join(progFiles86, "Git", "bin", "git.exe"),
    path.join(progFiles86, "Git", "cmd", "git.exe"),
    path.join(localApp, "Programs", "Git", "mingw64", "bin", "git.exe"),
    path.join(localApp, "Programs", "Git", "bin", "git.exe"),
    path.join(localApp, "Programs", "Git", "cmd", "git.exe"),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        resolvedGitBin = c;
        return c;
      }
    } catch {
      // ignore
    }
  }

  resolvedGitBin = "git.exe";
  return "git.exe";
}

const GIT_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_ASKPASS: "",
  SSH_ASKPASS: "",
  GCM_INTERACTIVE: "never",
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
};

// Best-effort git command runner for the project folder.
// NOTE: Do NOT .trim() raw output because git status --porcelain relies on column 0 leading whitespace!
function git(cwd, ...args) {
  try {
    return execFileSync(getGitBinary(), args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: GIT_ENV,
      timeout: 10000,
    });
  } catch {
    return "";
  }
}

function gitExec(cwd, args) {
  try {
    const out = execFileSync(getGitBinary(), args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: GIT_ENV,
      timeout: 20000,
      maxBuffer: 15 * 1024 * 1024,
    });
    return { ok: true, out: (out || "").trim() };
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString().trim() : "";
    const stdout = err.stdout ? err.stdout.toString().trim() : "";
    return { ok: false, err: stderr || stdout || err.message || "Git command failed" };
  }
}

/**
 * Scan workspace directory and immediate child folders for git repositories.
 * Pure filesystem check without spawning external git child processes.
 */
export function listGitRepositories(value) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) return [];

  const repos = [];
  const visited = new Set();

  const addIfRepo = (dirPath, label) => {
    try {
      const real = fs.realpathSync(dirPath);
      if (visited.has(real)) return;
      const dotGit = path.join(real, ".git");
      if (fs.existsSync(dotGit)) {
        visited.add(real);
        const name = path.basename(real) || label;
        repos.push({
          path: real,
          name,
          label: label || name,
          isRoot: real === workspacePath,
        });
      }
    } catch {
      // ignore unreadable dirs
    }
  };

  // 1. Check workspacePath itself
  addIfRepo(workspacePath, `${path.basename(workspacePath)} (root)`);

  // 2. Check parent directories (up to 3 levels) via pure fs (no processes spawned)
  try {
    let cur = path.dirname(workspacePath);
    for (let i = 0; i < 3; i++) {
      if (!cur || cur === path.dirname(cur)) break;
      if (fs.existsSync(path.join(cur, ".git"))) {
        addIfRepo(cur, `${path.basename(cur)} (root repo)`);
        break;
      }
      cur = path.dirname(cur);
    }
  } catch {
    // ignore
  }

  // 3. Scan 1-level subdirectories for nested git repos
  try {
    const entries = fs.readdirSync(workspacePath, { withFileTypes: true });
    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name.startsWith(".") || ent.name === "node_modules") continue;
      const subPath = path.join(workspacePath, ent.name);
      if (fs.existsSync(path.join(subPath, ".git"))) {
        addIfRepo(subPath, ent.name);
      }
    }
  } catch {
    // ignore
  }

  return repos;
}

// In-memory status cache to avoid repeated child process spawns on rapid session switching
const gitStatusCache = new Map(); // workspacePath -> { data, timestamp }
const CACHE_TTL_MS = 2500;

export function invalidateGitCache(targetPath = null) {
  if (targetPath) {
    gitStatusCache.delete(targetPath);
  } else {
    gitStatusCache.clear();
  }
}

/**
 * Optimized git status query:
 * Combines branch, tracking upstream, ahead/behind, and staged/unstaged changes
 * into a single `git status --porcelain=v1 --branch` execution.
 */
export function gitProjectStatus(value, rootPath = null) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) return { repo: false };

  // Check cache for instant response without spawning processes
  const now = Date.now();
  const cached = gitStatusCache.get(workspacePath);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  // Scan repositories using rootPath if provided, or workspacePath (pure fs, 0 processes)
  const scanTarget = rootPath ? resolveProjectWorkspace(rootPath) || workspacePath : workspacePath;
  const repos = listGitRepositories(scanTarget);

  const hasDotGit = fs.existsSync(path.join(workspacePath, ".git"));
  const isRepo = hasDotGit || Boolean((git(workspacePath, "rev-parse", "--is-inside-work-tree") || "").trim());

  if (!isRepo) {
    const result = {
      repo: false,
      workspacePath,
      repos,
    };
    gitStatusCache.set(workspacePath, { data: result, timestamp: now });
    return result;
  }

  // Single fast command to get branch, tracking upstream, ahead/behind, AND changed files!
  const statusOutput = git(workspacePath, "status", "--porcelain=v1", "--branch");
  const lines = statusOutput.split(/\r?\n/).filter(Boolean);

  let branch = "HEAD";
  let upstream = "";
  let ahead = 0;
  let behind = 0;

  let fileLines = lines;
  if (lines.length > 0 && lines[0].startsWith("## ")) {
    const header = lines[0].slice(3).trim();
    fileLines = lines.slice(1);

    // Parse header: e.g. "master...origin/master [ahead 1, behind 2]" or "master" or "HEAD (no branch)"
    const match = header.match(/^([^.\s]+)(?:\.\.\.([^\s\[]+))?(?:\s+\[(.*)\])?/);
    if (match) {
      branch = match[1] || "HEAD";
      upstream = match[2] || "";
      const syncInfo = match[3] || "";
      const aheadMatch = syncInfo.match(/ahead\s+(\d+)/);
      const behindMatch = syncInfo.match(/behind\s+(\d+)/);
      if (aheadMatch) ahead = Number(aheadMatch[1]) || 0;
      if (behindMatch) behind = Number(behindMatch[1]) || 0;
    } else {
      branch = header;
    }
  }

  // Quick 1-line log
  const last = (git(workspacePath, "log", "-1", "--pretty=%h %s") || "").trim();

  const staged = [];
  const unstaged = [];
  const changes = [];

  for (const line of fileLines) {
    if (!line || line.length < 2) continue;

    let x, y, rawPath;
    if (line.length >= 3 && line[2] === " ") {
      x = line[0];
      y = line[1];
      rawPath = line.slice(3);
    } else if (line.length >= 2 && line[1] === " ") {
      x = " ";
      y = line[0];
      rawPath = line.slice(2);
    } else {
      x = line[0];
      y = line[1];
      rawPath = line.slice(2);
    }

    let filePath = rawPath.trim();
    if (filePath.startsWith('"') && filePath.endsWith('"')) {
      filePath = filePath.slice(1, -1);
    }
    let origPath = null;
    if (filePath.includes(" -> ")) {
      const parts = filePath.split(" -> ");
      origPath = parts[0]?.trim();
      filePath = parts[1]?.trim();
    }

    // Staged (index) changes: X is not space, ?, !
    if (x !== " " && x !== "?" && x !== "!") {
      let status = "modified";
      let letter = "M";
      if (x === "A") { status = "added"; letter = "A"; }
      else if (x === "D") { status = "deleted"; letter = "D"; }
      else if (x === "R") { status = "renamed"; letter = "R"; }
      else if (x === "C") { status = "copied"; letter = "C"; }
      staged.push({ path: filePath, origPath, status, letter });
    }

    // Unstaged (work tree) changes: Y is not space, ! or X is ?
    if (x === "?" && y === "?") {
      unstaged.push({ path: filePath, origPath: null, status: "untracked", letter: "U" });
      changes.push({ path: filePath, status: "untracked" });
    } else if (y !== " " && y !== "!") {
      let status = "modified";
      let letter = "M";
      if (y === "D") { status = "deleted"; letter = "D"; }
      else if (y === "M") { status = "modified"; letter = "M"; }
      unstaged.push({ path: filePath, origPath, status, letter });
      changes.push({ path: filePath, status });
    }
  }

  const result = {
    repo: true,
    workspacePath,
    branch,
    upstream,
    last,
    ahead,
    behind,
    staged,
    unstaged,
    changes,
    totalCount: staged.length + unstaged.length,
    repos,
  };

  gitStatusCache.set(workspacePath, { data: result, timestamp: now });
  return result;
}

export function gitStagePath(value, targetPath) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) throw new Error("Invalid workspace path");
  invalidateGitCache(workspacePath);
  if (!targetPath || targetPath === "all" || targetPath === ".") {
    const res = gitExec(workspacePath, ["add", "-A"]);
    if (!res.ok) throw new Error(res.err);
    return res.out;
  }
  const res = gitExec(workspacePath, ["add", "--", targetPath]);
  if (!res.ok) throw new Error(res.err);
  return res.out;
}

export function gitUnstagePath(value, targetPath) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) throw new Error("Invalid workspace path");
  invalidateGitCache(workspacePath);
  if (!targetPath || targetPath === "all" || targetPath === ".") {
    const res = gitExec(workspacePath, ["restore", "--staged", "."]);
    if (!res.ok) {
      const fallback = gitExec(workspacePath, ["reset", "HEAD"]);
      if (!fallback.ok) throw new Error(fallback.err || res.err);
      return fallback.out;
    }
    return res.out;
  }
  const res = gitExec(workspacePath, ["restore", "--staged", "--", targetPath]);
  if (!res.ok) {
    const fallback = gitExec(workspacePath, ["reset", "HEAD", "--", targetPath]);
    if (!fallback.ok) throw new Error(fallback.err || res.err);
    return fallback.out;
  }
  return res.out;
}

export function gitDiscardPath(value, targetPath, isUntracked = false) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) throw new Error("Invalid workspace path");
  invalidateGitCache(workspacePath);
  if (!targetPath || targetPath === "all" || targetPath === ".") {
    gitExec(workspacePath, ["restore", "."]);
    gitExec(workspacePath, ["clean", "-fd"]);
    return "All changes discarded";
  }
  if (isUntracked) {
    const res = gitExec(workspacePath, ["clean", "-fd", "--", targetPath]);
    if (!res.ok) {
      try {
        const full = path.join(workspacePath, targetPath);
        if (fs.existsSync(full)) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      } catch {
        throw new Error(res.err);
      }
    }
    return res.out || "Untracked file deleted";
  }
  const res = gitExec(workspacePath, ["restore", "--", targetPath]);
  if (!res.ok) {
    const fallback = gitExec(workspacePath, ["checkout", "--", targetPath]);
    if (!fallback.ok) throw new Error(fallback.err || res.err);
    return fallback.out;
  }
  return res.out || "File reverted";
}

export function gitCommitChanges(value, message, { stageAll = false } = {}) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) throw new Error("Invalid workspace path");
  invalidateGitCache(workspacePath);
  const msg = String(message || "").trim();
  if (!msg) throw new Error("Commit message is required");

  if (stageAll) {
    gitStagePath(workspacePath, "all");
  }

  const res = gitExec(workspacePath, ["commit", "-m", msg]);
  if (!res.ok) throw new Error(res.err);
  const last = (git(workspacePath, "log", "-1", "--pretty=%h %s") || "").trim();
  return { message: res.out, last };
}

export function gitPushBranch(value, { remote = "origin", branch = null } = {}) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) throw new Error("Invalid workspace path");
  invalidateGitCache(workspacePath);
  const currentBranch = branch || (git(workspacePath, "rev-parse", "--abbrev-ref", "HEAD") || "").trim() || "HEAD";
  const upstream = (git(workspacePath, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}") || "").trim();

  if (!upstream) {
    const res = gitExec(workspacePath, ["push", "-u", remote, currentBranch]);
    if (!res.ok) throw new Error(res.err);
    return res.out || "Pushed and upstream set";
  }

  const res = gitExec(workspacePath, ["push"]);
  if (!res.ok) throw new Error(res.err);
  return res.out || "Pushed to upstream";
}

export function gitPullBranch(value) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) throw new Error("Invalid workspace path");
  invalidateGitCache(workspacePath);
  const res = gitExec(workspacePath, ["pull"]);
  if (!res.ok) throw new Error(res.err);
  return res.out || "Already up to date";
}

export function gitDiffPath(value, targetPath, staged = false) {
  const workspacePath = resolveProjectWorkspace(value);
  if (!workspacePath) throw new Error("Invalid workspace path");
  if (!targetPath) return "";

  const args = staged ? ["diff", "--staged", "--", targetPath] : ["diff", "--", targetPath];
  const res = gitExec(workspacePath, args);
  if (res.ok && res.out) return res.out;

  if (!staged) {
    try {
      const full = path.join(workspacePath, targetPath);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) {
        const content = fs.readFileSync(full, "utf8");
        const lines = content.split("\n");
        return `--- /dev/null\n+++ b/${targetPath}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}`;
      }
    } catch {
      // ignore
    }
  }

  return res.out || "";
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
