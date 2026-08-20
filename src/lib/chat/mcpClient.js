// MCP runtime client for the chat agent. Supports:
//  - "sse" (HTTP POST with optional SSE streamed responses, MCP 2025-06-18)
//  - "stdio" (spawn a child process, newline-delimited JSON-RPC)
//
// Each call is stateless-ish: we do initialize → tools/list → tools/call in one
// shot per call for HTTP, and keep a short-lived child for stdio.

import { spawn } from "node:child_process";

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 30_000;
const MAX_RESULT_CHARS = 50_000;

let seq = 0;
const nextId = () => `mcp_${++seq}_${Date.now()}`;

function truncateText(value) {
  const s = String(value ?? "");
  if (s.length <= MAX_RESULT_CHARS) return s;
  return `${s.slice(0, MAX_RESULT_CHARS)}\n\n… [truncated ${s.length - MAX_RESULT_CHARS} chars]`;
}

function normalizeToolResult(payload) {
  // Accept result.content[{type:"text",text}], result.structuredContent, or result directly.
  const result = payload?.result;
  if (!result) {
    if (payload?.error) return { ok: false, error: payload.error.message || JSON.stringify(payload.error) };
    return { ok: false, error: "Empty MCP result" };
  }
  const content = Array.isArray(result.content) ? result.content : [];
  const textParts = content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text);
  if (textParts.length) return { ok: true, text: truncateText(textParts.join("\n")) };
  if (result.structuredContent != null) return { ok: true, text: truncateText(JSON.stringify(result.structuredContent)) };
  return { ok: true, text: truncateText(JSON.stringify(result)) };
}

// ── HTTP / SSE transport ────────────────────────────────────────────────
async function httpJsonRpc(url, method, params, { sessionId } = {}) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId(), method, params }),
      signal: ac.signal,
    });
    const newSessionId = res.headers.get("mcp-session-id") || sessionId;
    const ct = res.headers.get("content-type") || "";
    let data;
    if (ct.includes("text/event-stream")) {
      const text = await res.text();
      data = parseSseJsonRpc(text);
    } else {
      data = await res.json().catch(() => null);
    }
    return { data, sessionId: newSessionId };
  } finally {
    clearTimeout(timer);
  }
}

function parseSseJsonRpc(text) {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      const obj = JSON.parse(payload);
      if (obj?.result || obj?.error) return obj;
    } catch {
      // skip malformed line
    }
  }
  return null;
}

// ── stdio transport ─────────────────────────────────────────────────────
function stdioRpc(command, args, method, params, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args || [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...env },
      windowsHide: true,
    });
    const id = nextId();
    let buffer = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; try { child.kill(); } catch { /* ignore */ } resolve({ error: { message: "stdio MCP timeout" } }); }
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const raw = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!raw) continue;
        try {
          const msg = JSON.parse(raw);
          if (msg.id === id && !settled) {
            settled = true;
            clearTimeout(timer);
            try { child.kill(); } catch { /* ignore */ }
            resolve(msg);
            return;
          }
        } catch {
          // ignore non-JSON
        }
      }
    });
    child.on("error", (err) => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ error: { message: err.message } }); }
    });
    child.on("close", () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ error: { message: "stdio MCP exited before response" } }); }
    });

    // Initialize first (required by spec).
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: nextId(), method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "9router", version: "1" } } })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    // Then the actual request.
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

// ── Public API ──────────────────────────────────────────────────────────
export async function listTools(server) {
  if (server.transport === "stdio") {
    const msg = await stdioRpc(server.command, server.args, "tools/list", {}, server.env || {});
    return (msg?.result?.tools || []).map((t) => ({ name: t.name, description: t.description || "" }));
  }
  const { data, sessionId } = await httpJsonRpc(server.url, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "9router", version: "1" },
  });
  if (data?.error) throw new Error(data.error.message || "MCP initialize failed");
  await httpJsonRpc(server.url, "notifications/initialized", {}, { sessionId }).catch(() => {});
  const list = await httpJsonRpc(server.url, "tools/list", {}, { sessionId });
  if (list?.data?.error) throw new Error(list.data.error.message || "tools/list failed");
  return (list?.data?.result?.tools || []).map((t) => ({ name: t.name, description: t.description || "" }));
}

export async function callTool(server, name, args = {}) {
  if (server.transport === "stdio") {
    const msg = await stdioRpc(server.command, server.args, "tools/call", { name, arguments: args || {} }, server.env || {});
    return normalizeToolResult(msg);
  }
  const { data, sessionId } = await httpJsonRpc(server.url, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "9router", version: "1" },
  });
  if (data?.error) throw new Error(data.error.message || "MCP initialize failed");
  await httpJsonRpc(server.url, "notifications/initialized", {}, { sessionId }).catch(() => {});
  const res = await httpJsonRpc(server.url, "tools/call", { name, arguments: args || {} }, { sessionId });
  return normalizeToolResult(res?.data);
}
