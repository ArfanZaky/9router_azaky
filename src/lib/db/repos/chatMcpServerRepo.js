import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson } from "../helpers/jsonCol.js";

function toServer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    transport: row.transport,
    command: row.command || "",
    args: parseJson(row.args, []),
    env: parseJson(row.env, {}),
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listChatMcpServers() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM chatMcpServers ORDER BY createdAt ASC`);
  return rows.map(toServer);
}

export async function getChatMcpServer(id) {
  const db = await getAdapter();
  return toServer(db.get(`SELECT * FROM chatMcpServers WHERE id = ?`, [id]));
}

export async function createChatMcpServer(data = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const server = {
    id: data.id || uuidv4(),
    name: String(data.name || "").trim(),
    url: String(data.url || "").trim(),
    transport: data.transport === "stdio" ? "stdio" : "sse",
    command: data.command || "",
    args: Array.isArray(data.args) ? data.args : [],
    env: data.env && typeof data.env === "object" ? data.env : {},
    enabled: data.enabled !== false,
    createdAt: now,
    updatedAt: now,
  };
  if (!server.name) throw new Error("MCP server name is required");
  if (server.transport === "sse" && !server.url) throw new Error("MCP server URL is required");
  if (server.transport === "stdio" && !server.command) throw new Error("MCP server command is required");
  db.run(
    `INSERT INTO chatMcpServers(id, name, url, transport, command, args, env, enabled, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [server.id, server.name, server.url, server.transport, server.command, JSON.stringify(server.args), JSON.stringify(server.env), server.enabled ? 1 : 0, now, now]
  );
  return server;
}

export async function updateChatMcpServer(id, data = {}) {
  const db = await getAdapter();
  const prev = getChatMcpServer(id);
  if (!prev) return null;
  const merged = {
    ...prev,
    name: data.name !== undefined ? String(data.name).trim() : prev.name,
    url: data.url !== undefined ? String(data.url).trim() : prev.url,
    transport: data.transport === "stdio" ? "stdio" : data.transport === "sse" ? "sse" : prev.transport,
    command: data.command !== undefined ? data.command : prev.command,
    args: Array.isArray(data.args) ? data.args : prev.args,
    env: data.env && typeof data.env === "object" ? data.env : prev.env,
    enabled: data.enabled !== undefined ? !!data.enabled : prev.enabled,
    updatedAt: new Date().toISOString(),
  };
  db.run(
    `UPDATE chatMcpServers SET name = ?, url = ?, transport = ?, command = ?, args = ?, env = ?, enabled = ?, updatedAt = ? WHERE id = ?`,
    [merged.name, merged.url, merged.transport, merged.command, JSON.stringify(merged.args), JSON.stringify(merged.env), merged.enabled ? 1 : 0, merged.updatedAt, id]
  );
  return merged;
}

export async function deleteChatMcpServer(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM chatMcpServers WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
