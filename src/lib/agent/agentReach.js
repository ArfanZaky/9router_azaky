import { spawn } from "node:child_process";
import path from "node:path";
import { isIP } from "node:net";

const MAX_OUTPUT = 200_000;
const TIMEOUT_MS = 30_000;
const CHANNELS = new Set(["web"]);
let activeCalls = 0;
const MAX_CONCURRENT = 3;

export function buildAgentReachArgs({ action, query, url }) {
  if (action === "search") {
    if (typeof query !== "string" || !query.trim() || query.length > 500) {
      throw new Error("search query required, maximum 500 characters");
    }
    return ["web", "search", query.trim(), "--limit", "5", "--backend", "exa", "--timeout", "25"];
  }
  if (action === "read") {
    if (typeof url !== "string" || url.length > 2048) throw new Error("public HTTP URL required");
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error("public HTTP URL required"); }
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    const addressType = isIP(host);
    const privateV4 = addressType === 4 && /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(host);
    const privateV6 = addressType === 6 && (host === "::1" || host === "::" || /^(fc|fd|fe8|fe9|fea|feb)/i.test(host));
    const privateName = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal");
    if (!new Set(["http:", "https:"]).has(parsed.protocol) || parsed.username || parsed.password || privateV4 || privateV6 || privateName) {
      throw new Error("public HTTP URL required");
    }
    return ["read", parsed.href, "--backend", "jina", "--timeout", "25"];
  }
  throw new Error("action must be search or read");
}

function safeItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  return Object.fromEntries(["title", "url", "author", "published_at", "text"]
    .map((key) => [key, typeof item[key] === "string" ? item[key].slice(0, 20_000) : null]));
}

export async function runAgentReach(args, { signal } = {}) {
  const argv = buildAgentReachArgs(args);
  if (signal?.aborted) return { ok: false, error: "Agent Reach request cancelled" };
  if (activeCalls >= MAX_CONCURRENT) return { ok: false, error: "Agent Reach is busy. Retry shortly." };
  const executable = process.env.AGENT_REACH_BIN || "";
  if (!path.isAbsolute(executable)) {
    return { ok: false, error: "Set AGENT_REACH_BIN to an absolute trusted Agent Reach executable path" };
  }
  if (signal?.aborted) return { ok: false, error: "Agent Reach request cancelled" };
  const baseEnv = Object.fromEntries(["PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]));
  if (process.platform === "win32") {
    baseEnv.SystemRoot = process.env.SystemRoot || "C:\\Windows";
    baseEnv.WINDIR = process.env.WINDIR || baseEnv.SystemRoot;
    baseEnv.USERNAME = process.env.USERNAME || "";
  }
  baseEnv.PYTHONNOUSERSITE = "1";
  activeCalls++;
  return await new Promise((resolve) => {
    let stdout = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      activeCalls--;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      resolve(value);
    };
    const child = spawn(executable, argv, {
      shell: false,
      windowsHide: true,
      env: baseEnv,
    });
    const abort = () => { child.kill(); finish({ ok: false, error: "Agent Reach request cancelled" }); };
    const timer = setTimeout(() => { child.kill(); finish({ ok: false, error: "Agent Reach timed out" }); }, TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      if (Buffer.byteLength(stdout) + chunk.length > MAX_OUTPUT) {
        child.kill();
        finish({ ok: false, error: "Agent Reach output exceeded limit" });
        return;
      }
      stdout += chunk;
    });
    child.stderr.on("data", () => {});
    child.on("error", (error) => finish({ ok: false, error: error.code === "ENOENT" ? "Agent Reach not installed. Install Agent Reach CLI and set AGENT_REACH_BIN if needed." : "Agent Reach failed to start" }));
    child.on("close", (code) => {
      if (code !== 0) return finish({ ok: false, error: "Agent Reach request failed" });
      try {
        const result = JSON.parse(stdout);
        if (!result || typeof result !== "object" || typeof result.ok !== "boolean") throw new Error("invalid result");
        finish({
          ok: result.ok,
          channel: CHANNELS.has(result.channel) ? result.channel : null,
          action: typeof result.action === "string" ? result.action : null,
          items: Array.isArray(result.items) ? result.items.slice(0, 5).map(safeItem).filter(Boolean) : [],
          error: result.error && typeof result.error === "object"
            ? { code: String(result.error.code || "ERROR").slice(0, 64), message: String(result.error.message || "Request failed").slice(0, 500) }
            : null,
        });
      } catch {
        finish({ ok: false, error: "Agent Reach returned invalid JSON" });
      }
    });
  });
}
