import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMcpStdioSession } from "../../src/lib/chat/mcpStdioSession.js";

describe("persistent chat MCP stdio session", () => {
  it("initializes once and preserves provider state between calls", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "chat-mcp-test-"));
    const fixture = path.join(dir, "fixture.cjs");
    writeFileSync(fixture, `let target = null;
process.stdin.setEncoding('utf8'); let buf = '';
process.stdin.on('data', chunk => { buf += chunk; let i; while ((i = buf.indexOf('\\n')) >= 0) {
  const line = buf.slice(0, i); buf = buf.slice(i + 1);
  const req = JSON.parse(line); if (!req.id) continue;
  let result;
  if (req.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fixture', version: '1' } };
  if (req.method === 'tools/list') result = { tools: [{ name: 'open_binary', inputSchema: {type: 'object'} }, { name: 'binary_session' }] };
  if (req.method === 'tools/call') { if (req.params.name === 'open_binary') target = req.params.arguments.path; result = { content: [{ type: 'text', text: JSON.stringify({ target }) }] }; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\\n');
}});`);
    const session = createMcpStdioSession({ command: process.execPath, args: [fixture] }, { timeoutMs: 5000 });
    try {
      await session.initialize();
      expect((await session.listTools()).map((tool) => tool.name)).toEqual(["open_binary", "binary_session"]);
      expect((await session.callTool("open_binary", { path: "example.exe" })).text).toContain("example.exe");
      expect((await session.callTool("binary_session")).text).toContain("example.exe");
    } finally {
      session.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
