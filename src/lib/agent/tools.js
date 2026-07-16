import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR } from "../dataDir.js";

const MAX_READ = 200_000;
const MAX_LIST = 500;
const MAX_BASH_OUT = 100_000;
const BASH_TIMEOUT_MS = 60_000;

const DENY_CMD = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+[\/\\]/i,
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  />\s*\/dev\/sd/i,
];

/** full = workspace + cwd + DATA_DIR; sandbox = workspace only (stricter) */
function getWorkspaceRoots(workspace, accessMode = "sandbox") {
  const roots = [];
  const add = (p) => {
    if (!p) return;
    try {
      const abs = path.resolve(p);
      if (fs.existsSync(abs) && !roots.includes(abs)) roots.push(abs);
    } catch {
      // ignore
    }
  };
  add(workspace);
  if (accessMode === "full") {
    add(process.cwd());
    add(DATA_DIR);
    add(process.env.AGENT_WORKSPACE);
  }
  return roots.length ? roots : [path.resolve(workspace || process.cwd())];
}

function resolveSafePath(inputPath, workspace, accessMode = "sandbox") {
  const roots = getWorkspaceRoots(workspace, accessMode);
  const raw = String(inputPath || "").trim() || ".";
  const abs = path.isAbsolute(raw)
    ? path.resolve(raw)
    : path.resolve(workspace || process.cwd(), raw);
  const normalized = path.normalize(abs);
  const ok = roots.some((root) => {
    const r = path.normalize(root);
    return normalized === r || normalized.startsWith(r + path.sep);
  });
  if (!ok) {
    throw new Error(
      `Path blocked (${accessMode}): ${normalized}. Allowed roots: ${roots.join(", ")}`
    );
  }
  return normalized;
}

const TOOL_ACCESS = {
  // tool name → minimum access: "sandbox" | "full"
  bash: "full",
  write_file: "full",
  read_file: "sandbox",
  list_dir: "sandbox",
  grep: "sandbox",
  web_search: "sandbox",
  web_fetch: "sandbox",
  generate_image: "sandbox",
};

export function getOpenAiTools(accessMode = "sandbox") {
  const mode = accessMode === "full" ? "full" : "sandbox";
  return TOOL_DEFS.filter((t) => {
    const need = TOOL_ACCESS[t.function.name] || "full";
    if (mode === "full") return true;
    return need === "sandbox";
  });
}

function truncate(str, max) {
  const s = String(str ?? "");
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n… [truncated ${s.length - max} chars]`;
}

async function runBash(command, { cwd, timeoutMs = BASH_TIMEOUT_MS } = {}) {
  const cmd = String(command || "").trim();
  if (!cmd) return { ok: false, error: "Empty command" };
  for (const re of DENY_CMD) {
    if (re.test(cmd)) return { ok: false, error: `Blocked dangerous command pattern` };
  }
  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", cmd] : ["-c", cmd];
  return await new Promise((resolve) => {
    const child = spawn(shell, args, {
      cwd: cwd || process.cwd(),
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
      resolve({
        ok: false,
        error: `Timeout after ${timeoutMs}ms`,
        stdout: truncate(stdout, MAX_BASH_OUT),
        stderr: truncate(stderr, MAX_BASH_OUT),
      });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += d.toString();
      if (stdout.length > MAX_BASH_OUT * 2) stdout = stdout.slice(-MAX_BASH_OUT);
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
      if (stderr.length > MAX_BASH_OUT * 2) stderr = stderr.slice(-MAX_BASH_OUT);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        exitCode: code,
        stdout: truncate(stdout, MAX_BASH_OUT),
        stderr: truncate(stderr, MAX_BASH_OUT),
      });
    });
  });
}

function walkDir(dir, { max = MAX_LIST, depth = 3, prefix = "" } = {}) {
  const out = [];
  function walk(current, d, rel) {
    if (out.length >= max || d < 0) return;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (e) {
      out.push(`${rel || "."}: ERROR ${e.message}`);
      return;
    }
    for (const ent of entries) {
      if (out.length >= max) break;
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".next") continue;
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      const full = path.join(current, ent.name);
      if (ent.isDirectory()) {
        out.push(`${childRel}/`);
        walk(full, d - 1, childRel);
      } else {
        out.push(childRel);
      }
    }
  }
  walk(dir, depth, prefix);
  return out;
}

export const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "bash",
      description:
        "Run a shell command on the host machine (Windows cmd / Unix sh). Use for git, npm, builds, diagnostics. Prefer non-interactive commands.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          cwd: { type: "string", description: "Working directory (must be under workspace)" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file from the host filesystem (workspace-scoped).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path absolute or relative to workspace" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write/create a UTF-8 text file on the host (workspace-scoped).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files/directories under a path (skips node_modules/.git/.next).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path" },
          depth: { type: "number", description: "Max depth (default 2)" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grep",
      description: "Search file contents with a regex/string under a directory.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "File or directory to search" },
          max_results: { type: "number" },
        },
        required: ["pattern", "path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web via 9Router /v1/search. Needs a connected web-search provider model id (e.g. tavily).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          model: {
            type: "string",
            description: "Search provider model id if known; optional",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch a public URL as markdown/text via 9Router /v1/web/fetch.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          model: { type: "string", description: "Fetch provider model id if known" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image via 9Router /v1/images/generations and save under DATA_DIR/media/images.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          model: { type: "string", description: "Image model id e.g. openai/dall-e-3" },
          size: { type: "string" },
        },
        required: ["prompt", "model"],
      },
    },
  },
];

function grepFiles(root, pattern, maxResults = 40) {
  let re;
  try {
    re = new RegExp(pattern, "i");
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
  const hits = [];
  function scanFile(file, rel) {
    if (hits.length >= maxResults) return;
    let text;
    try {
      const st = fs.statSync(file);
      if (!st.isFile() || st.size > 2_000_000) return;
      text = fs.readFileSync(file, "utf8");
    } catch {
      return;
    }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= maxResults) break;
      if (re.test(lines[i])) {
        hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 240)}`);
      }
    }
  }
  function walk(dir, rel) {
    if (hits.length >= maxResults) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (hits.length >= maxResults) break;
      if (ent.name === "node_modules" || ent.name === ".git" || ent.name === ".next") continue;
      const full = path.join(dir, ent.name);
      const childRel = rel ? `${rel}/${ent.name}` : ent.name;
      if (ent.isDirectory()) walk(full, childRel);
      else scanFile(full, childRel);
    }
  }
  const st = fs.statSync(root);
  if (st.isFile()) scanFile(root, path.basename(root));
  else walk(root, "");
  return hits;
}

export async function executeTool(name, args = {}, ctx = {}) {
  const workspace = ctx.workspace || process.cwd();
  const accessMode = ctx.accessMode === "full" ? "full" : "sandbox";
  const apiKey = ctx.apiKey || "";
  const origin = ctx.origin || "http://127.0.0.1:20128";

  const need = TOOL_ACCESS[name] || "full";
  if (accessMode === "sandbox" && need === "full") {
    return JSON.stringify({
      ok: false,
      error: `Tool "${name}" requires Full access. Switch Access to Full or stay in Sandbox with read-only tools.`,
    });
  }

  try {
    switch (name) {
      case "bash": {
        const cwd = args.cwd
          ? resolveSafePath(args.cwd, workspace, accessMode)
          : path.resolve(workspace || process.cwd());
        // sandbox never reaches here; full still denies dangerous patterns
        const result = await runBash(args.command, { cwd });
        return JSON.stringify(result);
      }
      case "read_file": {
        const p = resolveSafePath(args.path, workspace, accessMode);
        if (!fs.existsSync(p)) return JSON.stringify({ ok: false, error: "File not found" });
        const st = fs.statSync(p);
        if (!st.isFile()) return JSON.stringify({ ok: false, error: "Not a file" });
        const content = fs.readFileSync(p, "utf8");
        return JSON.stringify({
          ok: true,
          path: p,
          bytes: st.size,
          content: truncate(content, MAX_READ),
        });
      }
      case "write_file": {
        const p = resolveSafePath(args.path, workspace, accessMode);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, String(args.content ?? ""), "utf8");
        return JSON.stringify({ ok: true, path: p, bytes: Buffer.byteLength(String(args.content ?? "")) });
      }
      case "list_dir": {
        const p = resolveSafePath(args.path || ".", workspace, accessMode);
        if (!fs.existsSync(p)) return JSON.stringify({ ok: false, error: "Not found" });
        const depth = Math.min(Math.max(Number(args.depth) || 2, 0), 5);
        const entries = walkDir(p, { depth, max: MAX_LIST });
        return JSON.stringify({ ok: true, path: p, count: entries.length, entries });
      }
      case "grep": {
        const p = resolveSafePath(args.path || ".", workspace, accessMode);
        if (!fs.existsSync(p)) return JSON.stringify({ ok: false, error: "Not found" });
        const max = Math.min(Math.max(Number(args.max_results) || 40, 1), 200);
        const hits = grepFiles(p, String(args.pattern || ""), max);
        return JSON.stringify({ ok: true, path: p, count: hits.length, hits });
      }
      case "web_search": {
        const body = {
          query: args.query,
          ...(args.model ? { model: args.model } : {}),
        };
        const res = await fetch(`${origin}/api/v1/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return JSON.stringify({
            ok: false,
            error: data.error?.message || data.error || `HTTP ${res.status}`,
            hint: "Connect a web-search provider and pass model/provider id",
          });
        }
        return truncate(JSON.stringify({ ok: true, data }), MAX_READ);
      }
      case "web_fetch": {
        const body = {
          url: args.url,
          format: "markdown",
          ...(args.model ? { model: args.model } : {}),
        };
        const res = await fetch(`${origin}/api/v1/web/fetch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return JSON.stringify({
            ok: false,
            error: data.error?.message || data.error || `HTTP ${res.status}`,
          });
        }
        return truncate(JSON.stringify({ ok: true, data }), MAX_READ);
      }
      case "generate_image": {
        const body = {
          model: args.model,
          prompt: args.prompt,
          size: args.size || "1024x1024",
          response_format: "b64_json",
          n: 1,
        };
        const res = await fetch(`${origin}/api/v1/images/generations`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          return JSON.stringify({
            ok: false,
            error: data.error?.message || data.error || `HTTP ${res.status}`,
          });
        }
        // Persist via image-gen jobs API for gallery consistency
        const save = await fetch(`${origin}/api/image-gen/jobs`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: args.prompt,
            model: args.model,
            params: { size: body.size, source: "agent" },
            data: data.data || [],
          }),
        }).catch(() => null);
        const job = save ? await save.json().catch(() => ({})) : {};
        const assetId = job?.assets?.[0]?.id;
        return JSON.stringify({
          ok: true,
          jobId: job?.id || null,
          assetUrl: assetId ? `/api/image-gen/assets/${assetId}` : null,
          created: data.created,
        });
      }
      default:
        return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ ok: false, error: e.message || String(e) });
  }
}

// getOpenAiTools defined above (filters by accessMode)
