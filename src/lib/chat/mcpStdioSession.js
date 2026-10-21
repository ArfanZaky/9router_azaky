// Long-lived MCP stdio connection. Stateful providers such as REA must keep
// their target/evidence session between tools/call requests in one chat run.
import { spawn } from "node:child_process";
import { normalizeStdioArgs } from "./mcpArgsHelper.js";

const PROTOCOL_VERSION = "2024-11-05";
const DEFAULT_TIMEOUT = 60_000;
let requestId = 0;

export function createMcpStdioSession(server, { timeoutMs = DEFAULT_TIMEOUT } = {}) {
  const args = normalizeStdioArgs(server.command, server.args || []);
  const child = spawn(server.command, args, {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...(server.env || {}) },
    windowsHide: true,
    // cmd/bat wrappers need a shell on Windows; executable paths with spaces do not.
    shell: process.platform === "win32" && (!/[\\/]/.test(server.command) || /\.(cmd|bat)$/i.test(server.command)), // npx.cmd needs cmd; absolute node.exe paths do not.
  });
  const pending = new Map();
  let buffer = "";
  let stderr = "";
  let closed = false;
  let reason = "MCP stdio connection closed";

  function failAll(error) {
    if (closed) return;
    closed = true;
    reason = `${error?.message || error || reason}${stderr.trim() ? `: ${stderr.trim().slice(-600)}` : ""}`;
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error(reason));
    }
    pending.clear();
  }

  child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString("utf8")).slice(-2000); });
  child.on("error", failAll);
  child.on("close", (code) => failAll(`MCP stdio exited (${code ?? "unknown"})`));
  child.stdin.on("error", failAll);
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index;
    while ((index = buffer.indexOf("\n")) !== -1) {
      const raw = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      try {
        const message = JSON.parse(raw);
        const item = pending.get(String(message.id));
        if (!item) continue;
        pending.delete(String(message.id));
        clearTimeout(item.timer);
        if (message.error) item.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else item.resolve(message.result);
      } catch { /* Ignore non-JSON server banners. */ }
    }
    if (buffer.length > 8_000_000) failAll("MCP stdio response exceeded limit");
  });

  function request(method, params = {}) {
    if (closed) return Promise.reject(new Error(reason));
    const id = `9router_${++requestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out${stderr.trim() ? `: ${stderr.trim().slice(-600)}` : ""}`));
        shutdown();
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
        if (error) failAll(error);
      });
    });
  }

  function notify(method, params = {}) {
    if (!closed) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`, (error) => {
      if (error) failAll(error);
    });
  }

  function shutdown() {
    failAll("MCP stdio connection closed");
    try { child.stdin.end(); } catch { /* already closed */ }
    try { child.kill(); } catch { /* already closed */ }
  }

  return {
    async initialize() {
      const result = await request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "9router", version: "1" },
      });
      notify("notifications/initialized");
      return result;
    },
    async listTools() {
      const result = await request("tools/list");
      if (!Array.isArray(result?.tools)) throw new Error("MCP tools/list returned no tool inventory");
      return result.tools.map((tool) => ({
        name: tool.name,
        description: tool.description || "",
        inputSchema: tool.inputSchema || { type: "object", properties: {}, additionalProperties: true },
      }));
    },
    async callTool(name, args = {}) {
      const result = await request("tools/call", { name, arguments: args });
      const textParts = (result?.content || []).filter((part) => part?.type === "text" && typeof part.text === "string").map((part) => part.text);
      const value = textParts.length ? textParts.join("\n") : JSON.stringify(result?.structuredContent ?? result);
      if (result?.isError) return { ok: false, error: value.slice(0, 50_000) };
      return { ok: true, text: value.slice(0, 50_000) };
    },
    close: shutdown,
  };
}
