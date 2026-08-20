import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function toRun(row) {
  if (!row) return null;
  return {
    id: row.id, sessionId: row.sessionId, mode: row.mode, status: row.status,
    request: parseJson(row.request, {}), result: parseJson(row.result, null), error: row.error || null,
    createdAt: row.createdAt, startedAt: row.startedAt || null, finishedAt: row.finishedAt || null,
    updatedAt: row.updatedAt,
  };
}

export async function createChatRun(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const run = { ...data, status: "queued", createdAt: now, updatedAt: now, startedAt: null, finishedAt: null, result: null, error: null };
  db.run(`INSERT INTO chatRuns(id, sessionId, mode, status, request, result, error, createdAt, startedAt, finishedAt, updatedAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [run.id, run.sessionId, run.mode, run.status, stringifyJson(run.request || {}), null, null, now, null, null, now]);
  return run;
}

export async function getChatRunRecord(id) {
  const db = await getAdapter();
  return toRun(db.get(`SELECT * FROM chatRuns WHERE id = ?`, [id]));
}

export async function getActiveChatRunForSession(sessionId) {
  const db = await getAdapter();
  return toRun(db.get(
    `SELECT * FROM chatRuns WHERE sessionId = ? AND status IN ('queued', 'running') ORDER BY createdAt DESC LIMIT 1`,
    [sessionId]
  ));
}

export async function updateChatRunRecord(id, patch = {}) {
  const db = await getAdapter();
  const previous = toRun(db.get(`SELECT * FROM chatRuns WHERE id = ?`, [id]));
  if (!previous) return null;
  const now = new Date().toISOString();
  const next = { ...previous, ...patch, updatedAt: now };
  db.run(`UPDATE chatRuns SET status = ?, result = ?, error = ?, startedAt = ?, finishedAt = ?, updatedAt = ? WHERE id = ?`,
    [next.status, next.result == null ? null : stringifyJson(next.result), next.error || null, next.startedAt, next.finishedAt, now, id]);
  return next;
}

export async function appendChatRunEvent(runId, event) {
  const db = await getAdapter();
  db.run(`INSERT OR REPLACE INTO chatRunEvents(runId, seq, type, data, createdAt) VALUES(?, ?, ?, ?, ?)`,
    [runId, event.seq, event.type, stringifyJson(event.data), event.createdAt]);
  return event;
}

export async function listChatRunEvents(runId, { after = 0, limit = 2000 } = {}) {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM chatRunEvents WHERE runId = ? AND seq > ? ORDER BY seq ASC LIMIT ?`,
    [runId, Math.max(Number(after) || 0, 0), Math.min(Math.max(Number(limit) || 2000, 1), 5000)]);
  return rows.map((row) => ({ runId: row.runId, seq: row.seq, type: row.type, data: parseJson(row.data, {}), createdAt: row.createdAt }));
}
