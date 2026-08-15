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
    workspacePath: row.workspacePath || "",
    projectMeta: parseJson(row.projectMeta, {}),
    tasks: parseJson(row.tasks, []),
    codebase: row.codebase || "",
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
    tool_call_id: row.toolCallId || null,
    name: row.toolName || null,
    tool_calls: parseJson(row.toolCalls, null),
    reasoning: row.reasoning || "",
    segments: parseJson(row.segments, []),
    createdAt: row.createdAt,
  };
}

function messageInsertParams(message) {
  return [
    message.id,
    message.sessionId,
    message.role,
    typeof message.content === "string" ? message.content : stringifyJson(message.content),
    stringifyJson(message.attachments || []),
    message.status || "done",
    message.error || null,
    message.tokenUsage ? stringifyJson(message.tokenUsage) : null,
    message.tool_call_id || message.toolCallId || null,
    message.name || message.toolName || null,
    message.tool_calls ? stringifyJson(message.tool_calls) : null,
    message.reasoning || null,
    stringifyJson(message.segments || []),
    message.createdAt,
  ];
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

export async function getChatSession(id, { includeMessages = true, messageLimit } = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM chatSessions WHERE id = ?`, [id]);
  if (!row) return null;
  const session = rowToSession(row);
  if (includeMessages) {
    // Use unlimited loading for large contexts (250k+ tokens), default to 1000 msgs as a reasonable cap.
    const lim = typeof messageLimit !== "number" || messageLimit <= 0 ? 1000 : Math.min(Math.max(messageLimit, 1), 10000);
    const msgs = db.all(
      `SELECT * FROM chatMessages WHERE sessionId = ? ORDER BY createdAt DESC LIMIT ?`,
      [id, lim]
    );
    session.messages = msgs.reverse().map(rowToMessage);
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
    workspacePath: data.workspacePath || "",
    projectMeta: data.projectMeta || {},
    tasks: data.tasks || [],
    codebase: data.codebase || "",
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO chatSessions(id, title, model, providerId, systemPrompt, params, pinned, workspacePath, projectMeta, tasks, codebase, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      session.id,
      session.title,
      session.model,
      session.providerId,
      session.systemPrompt,
      stringifyJson(session.params),
      session.pinned ? 1 : 0,
      session.workspacePath,
      stringifyJson(session.projectMeta),
      stringifyJson(session.tasks),
      session.codebase,
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
      workspacePath: data.workspacePath !== undefined ? data.workspacePath : prev.workspacePath,
      projectMeta: data.projectMeta !== undefined ? data.projectMeta : prev.projectMeta,
      tasks: data.tasks !== undefined ? data.tasks : prev.tasks,
      codebase: data.codebase !== undefined ? data.codebase : prev.codebase,
      updatedAt: new Date().toISOString(),
    };
    db.run(
      `UPDATE chatSessions SET title = ?, model = ?, providerId = ?, systemPrompt = ?, params = ?, pinned = ?, workspacePath = ?, projectMeta = ?, tasks = ?, codebase = ?, updatedAt = ? WHERE id = ?`,
      [
        merged.title,
        merged.model,
        merged.providerId,
        merged.systemPrompt,
        stringifyJson(merged.params || {}),
        merged.pinned ? 1 : 0,
        merged.workspacePath || "",
        stringifyJson(merged.projectMeta || {}),
        stringifyJson(merged.tasks || []),
        merged.codebase || "",
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
    tool_call_id: data.tool_call_id || data.toolCallId || null,
    name: data.name || data.toolName || null,
    tool_calls: data.tool_calls || data.toolCalls || null,
    reasoning: data.reasoning || "",
    segments: data.segments || [],
    createdAt: data.createdAt || now,
  };
  db.transaction(() => {
    db.run(
      `INSERT INTO chatMessages(id, sessionId, role, content, attachments, status, error, tokenUsage, toolCallId, toolName, toolCalls, reasoning, segments, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      messageInsertParams(message)
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
      tool_call_id:
        data.tool_call_id !== undefined || data.toolCallId !== undefined
          ? data.tool_call_id || data.toolCallId || null
          : prev.tool_call_id,
      name:
        data.name !== undefined || data.toolName !== undefined
          ? data.name || data.toolName || null
          : prev.name,
      tool_calls:
        data.tool_calls !== undefined || data.toolCalls !== undefined
          ? data.tool_calls || data.toolCalls || null
          : prev.tool_calls,
      reasoning: data.reasoning !== undefined ? data.reasoning : prev.reasoning,
      segments: data.segments !== undefined ? data.segments : prev.segments,
    };
    const content =
      typeof merged.content === "string" ? merged.content : stringifyJson(merged.content);
    db.run(
      `UPDATE chatMessages SET role = ?, content = ?, attachments = ?, status = ?, error = ?, tokenUsage = ?, toolCallId = ?, toolName = ?, toolCalls = ?, reasoning = ?, segments = ? WHERE id = ?`,
      [
        merged.role,
        content,
        stringifyJson(merged.attachments || []),
        merged.status || "done",
        merged.error || null,
        merged.tokenUsage ? stringifyJson(merged.tokenUsage) : null,
        merged.tool_call_id || null,
        merged.name || null,
        merged.tool_calls ? stringifyJson(merged.tool_calls) : null,
        merged.reasoning || null,
        stringifyJson(merged.segments || []),
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

/** Compact transcript by deleting old messages, keeping last N verbatim. */
export async function compactSessionMessages(sessionId, keepLastN = 20) {
  const db = await getAdapter();
  const session = db.get(`SELECT id FROM chatSessions WHERE id = ?`, [sessionId]);
  if (!session) return null;
  
  // Get total message count
  const countResult = db.get(`SELECT COUNT(*) as cnt FROM chatMessages WHERE sessionId = ?`, [sessionId]);
  const totalCount = countResult?.cnt || 0;
  
  // If we have fewer messages than we want to keep, nothing to do
  if (totalCount <= keepLastN) {
    return { success: true, message: `Session has only ${totalCount} messages — no compaction needed (keeping last ${keepLastN})` };
  }
  
  // Delete all but the last N messages (most recent N via DESC + LIMIT)
  const deletedCount = db.run(
    `DELETE FROM chatMessages WHERE sessionId = ? AND createdAt IN (SELECT createdAt FROM chatMessages WHERE sessionId = ? ORDER BY createdAt DESC OFFSET ?)`,
    [sessionId, sessionId, Math.max(0, totalCount - keepLastN)]
  ).changes;
  
  // Update session timestamp
  db.run(`UPDATE chatSessions SET updatedAt = ? WHERE id = ?`, [new Date().toISOString(), sessionId]);
  
  return { success: true, deletedCount, keepLastN, totalCount, message: `Compacted: deleted ${deletedCount} messages, kept ${keepLastN}, total now: ${totalCount - deletedCount}` };
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
        tool_call_id: data.tool_call_id || data.toolCallId || null,
        name: data.name || data.toolName || null,
        tool_calls: data.tool_calls || data.toolCalls || null,
        reasoning: data.reasoning || "",
        segments: data.segments || [],
        createdAt: data.createdAt || now,
      };
      db.run(
        `INSERT INTO chatMessages(id, sessionId, role, content, attachments, status, error, tokenUsage, toolCallId, toolName, toolCalls, reasoning, segments, createdAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        messageInsertParams(message)
      );
      saved.push(message);
    }
    db.run(`UPDATE chatSessions SET updatedAt = ? WHERE id = ?`, [now, sessionId]);
  });
  return saved;
}

function cloneMessage(message, sessionId) {
  return {
    ...message,
    id: uuidv4(),
    sessionId,
    tool_call_id: null,
    tool_calls: null,
  };
}

export async function clearChatSession(id) {
  const db = await getAdapter();
  const session = db.get(`SELECT id FROM chatSessions WHERE id = ?`, [id]);
  if (!session) return null;
  const now = new Date().toISOString();
  db.transaction(() => {
    db.run(`DELETE FROM chatMessages WHERE sessionId = ?`, [id]);
    db.run(`UPDATE chatSessions SET updatedAt = ? WHERE id = ?`, [now, id]);
  });
  return getChatSession(id);
}

export async function undoChatExchange(id) {
  const session = await getChatSession(id);
  if (!session) return null;
  let cut = session.messages.length;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].role === "user") {
      cut = i;
      break;
    }
  }
  return { ...(await getChatSession(id, { includeMessages: false })), messages: await replaceChatMessages(id, session.messages.slice(0, cut)) };
}

export async function editChatFromMessage(id, messageId, content) {
  const session = await getChatSession(id);
  if (!session) return null;
  const index = session.messages.findIndex((message) => message.id === messageId);
  if (index < 0 || session.messages[index].role !== "user") return false;
  const messages = session.messages.slice(0, index + 1);
  messages[index] = { ...messages[index], content: String(content || "").trim() };
  return { ...(await getChatSession(id, { includeMessages: false })), messages: await replaceChatMessages(id, messages) };
}

export async function forkChatSession(id, { messageId = "", title = "" } = {}) {
  const source = await getChatSession(id);
  if (!source) return null;
  let messages = source.messages;
  if (messageId) {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index < 0) return false;
    messages = messages.slice(0, index + 1);
  }
  const fork = await createChatSession({
    ...source,
    id: undefined,
    title: title.trim() || `${source.title} (fork)`,
    pinned: false,
  });
  const cloned = messages.map((message) => cloneMessage(message, fork.id));
  return { ...fork, messages: await replaceChatMessages(fork.id, cloned) };
}
