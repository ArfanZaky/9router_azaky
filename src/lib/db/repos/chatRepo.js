import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || "New chat",
    model: row.model || "",
    providerId: row.providerId || "",
    systemPrompt: row.systemPrompt || "",
    params: parseJson(row.params, {}),
    pinned: row.pinned === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role,
    content: row.content || "",
    attachments: parseJson(row.attachments, []),
    status: row.status || "done",
    error: row.error || null,
    tokenUsage: parseJson(row.tokenUsage, null),
    createdAt: row.createdAt,
  };
}

export async function listChatSessions({ q = "", limit = 100, offset = 0 } = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const query = String(q || "").trim();
  let rows;
  if (query) {
    const like = `%${query}%`;
    rows = db.all(
      `SELECT * FROM chatSessions
       WHERE title LIKE ? OR model LIKE ? OR systemPrompt LIKE ?
       ORDER BY pinned DESC, updatedAt DESC
       LIMIT ? OFFSET ?`,
      [like, like, like, lim, off]
    );
  } else {
    rows = db.all(
      `SELECT * FROM chatSessions ORDER BY pinned DESC, updatedAt DESC LIMIT ? OFFSET ?`,
      [lim, off]
    );
  }
  return rows.map(rowToSession);
}

export async function getChatSession(id, { includeMessages = true, messageLimit = 500 } = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM chatSessions WHERE id = ?`, [id]);
  if (!row) return null;
  const session = rowToSession(row);
  if (includeMessages) {
    const lim = Math.min(Math.max(Number(messageLimit) || 500, 1), 2000);
    const msgs = db.all(
      `SELECT * FROM chatMessages WHERE sessionId = ? ORDER BY createdAt ASC LIMIT ?`,
      [id, lim]
    );
    session.messages = msgs.map(rowToMessage);
  }
  return session;
}

export async function createChatSession(data = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const session = {
    id: data.id || uuidv4(),
    title: data.title || "New chat",
    model: data.model || "",
    providerId: data.providerId || "",
    systemPrompt: data.systemPrompt || "",
    params: data.params || {},
    pinned: !!data.pinned,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO chatSessions(id, title, model, providerId, systemPrompt, params, pinned, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.title,
      session.model,
      session.providerId,
      session.systemPrompt,
      stringifyJson(session.params),
      session.pinned ? 1 : 0,
      session.createdAt,
      session.updatedAt,
    ]
  );
  return { ...session, messages: [] };
}

export async function updateChatSession(id, data = {}) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM chatSessions WHERE id = ?`, [id]);
    if (!row) return;
    const prev = rowToSession(row);
    const merged = {
      ...prev,
      ...data,
      params: data.params !== undefined ? data.params : prev.params,
      pinned: data.pinned !== undefined ? !!data.pinned : prev.pinned,
      updatedAt: new Date().toISOString(),
    };
    db.run(
      `UPDATE chatSessions SET title = ?, model = ?, providerId = ?, systemPrompt = ?, params = ?, pinned = ?, updatedAt = ? WHERE id = ?`,
      [
        merged.title,
        merged.model,
        merged.providerId,
        merged.systemPrompt,
        stringifyJson(merged.params || {}),
        merged.pinned ? 1 : 0,
        merged.updatedAt,
        id,
      ]
    );
    result = merged;
  });
  return result;
}

export async function deleteChatSession(id) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    db.run(`DELETE FROM chatMessages WHERE sessionId = ?`, [id]);
    const res = db.run(`DELETE FROM chatSessions WHERE id = ?`, [id]);
    ok = (res?.changes ?? 0) > 0;
  });
  return ok;
}

export async function listChatMessages(sessionId, { limit = 500, offset = 0 } = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = db.all(
    `SELECT * FROM chatMessages WHERE sessionId = ? ORDER BY createdAt ASC LIMIT ? OFFSET ?`,
    [sessionId, lim, off]
  );
  return rows.map(rowToMessage);
}

export async function createChatMessage(sessionId, data = {}) {
  const db = await getAdapter();
  const session = db.get(`SELECT id FROM chatSessions WHERE id = ?`, [sessionId]);
  if (!session) return null;
  const now = new Date().toISOString();
  const message = {
    id: data.id || uuidv4(),
    sessionId,
    role: data.role || "user",
    content: data.content ?? "",
    attachments: data.attachments || [],
    status: data.status || "done",
    error: data.error || null,
    tokenUsage: data.tokenUsage || null,
    createdAt: data.createdAt || now,
  };
  db.transaction(() => {
    db.run(
      `INSERT INTO chatMessages(id, sessionId, role, content, attachments, status, error, tokenUsage, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.sessionId,
        message.role,
        typeof message.content === "string" ? message.content : stringifyJson(message.content),
        stringifyJson(message.attachments),
        message.status,
        message.error,
        message.tokenUsage ? stringifyJson(message.tokenUsage) : null,
        message.createdAt,
      ]
    );
    db.run(`UPDATE chatSessions SET updatedAt = ? WHERE id = ?`, [now, sessionId]);
  });
  return message;
}

export async function updateChatMessage(id, data = {}) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM chatMessages WHERE id = ?`, [id]);
    if (!row) return;
    const prev = rowToMessage(row);
    const merged = {
      ...prev,
      ...data,
      attachments: data.attachments !== undefined ? data.attachments : prev.attachments,
      tokenUsage: data.tokenUsage !== undefined ? data.tokenUsage : prev.tokenUsage,
    };
    const content =
      typeof merged.content === "string" ? merged.content : stringifyJson(merged.content);
    db.run(
      `UPDATE chatMessages SET role = ?, content = ?, attachments = ?, status = ?, error = ?, tokenUsage = ? WHERE id = ?`,
      [
        merged.role,
        content,
        stringifyJson(merged.attachments || []),
        merged.status || "done",
        merged.error || null,
        merged.tokenUsage ? stringifyJson(merged.tokenUsage) : null,
        id,
      ]
    );
    db.run(`UPDATE chatSessions SET updatedAt = ? WHERE id = ?`, [
      new Date().toISOString(),
      merged.sessionId,
    ]);
    result = { ...merged, content };
  });
  return result;
}

export async function deleteChatMessage(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT sessionId FROM chatMessages WHERE id = ?`, [id]);
  if (!row) return false;
  const res = db.run(`DELETE FROM chatMessages WHERE id = ?`, [id]);
  if ((res?.changes ?? 0) > 0) {
    db.run(`UPDATE chatSessions SET updatedAt = ? WHERE id = ?`, [
      new Date().toISOString(),
      row.sessionId,
    ]);
    return true;
  }
  return false;
}

export async function replaceChatMessages(sessionId, messages = []) {
  const db = await getAdapter();
  const session = db.get(`SELECT id FROM chatSessions WHERE id = ?`, [sessionId]);
  if (!session) return null;
  const now = new Date().toISOString();
  const saved = [];
  db.transaction(() => {
    db.run(`DELETE FROM chatMessages WHERE sessionId = ?`, [sessionId]);
    for (const data of messages) {
      const message = {
        id: data.id || uuidv4(),
        sessionId,
        role: data.role || "user",
        content: data.content ?? "",
        attachments: data.attachments || [],
        status: data.status || "done",
        error: data.error || null,
        tokenUsage: data.tokenUsage || null,
        createdAt: data.createdAt || now,
      };
      db.run(
        `INSERT INTO chatMessages(id, sessionId, role, content, attachments, status, error, tokenUsage, createdAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          message.id,
          message.sessionId,
          message.role,
          typeof message.content === "string" ? message.content : stringifyJson(message.content),
          stringifyJson(message.attachments),
          message.status,
          message.error,
          message.tokenUsage ? stringifyJson(message.tokenUsage) : null,
          message.createdAt,
        ]
      );
      saved.push(message);
    }
    db.run(`UPDATE chatSessions SET updatedAt = ? WHERE id = ?`, [now, sessionId]);
  });
  return saved;
}
