import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function toGoal(row) {
  if (!row) return null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    text: row.text,
    status: row.status,
    iterations: row.iterations || 0,
    judgeResult: row.judgeResult || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getActiveChatGoal(sessionId) {
  const db = await getAdapter();
  return toGoal(db.get(
    `SELECT * FROM chatGoals WHERE sessionId = ? AND status = 'active' ORDER BY createdAt DESC LIMIT 1`,
    [sessionId]
  ));
}

export async function setChatGoal(sessionId, text) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const existing = await getActiveChatGoal(sessionId);
  if (existing) {
    db.run(`UPDATE chatGoals SET text = ?, updatedAt = ? WHERE id = ?`, [text, now, existing.id]);
    return { ...existing, text, updatedAt: now };
  }
  const goal = { id: uuidv4(), sessionId, text, status: "active", iterations: 0, judgeResult: "", createdAt: now, updatedAt: now };
  db.run(`INSERT INTO chatGoals(id, sessionId, text, status, iterations, judgeResult, createdAt, updatedAt)
    VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [goal.id, goal.sessionId, goal.text, goal.status, 0, "", now, now]);
  return goal;
}

export async function pauseChatGoal(sessionId) {
  const db = await getAdapter();
  const goal = await getActiveChatGoal(sessionId);
  if (!goal) return null;
  db.run(`UPDATE chatGoals SET status = 'paused', updatedAt = ? WHERE id = ?`, [new Date().toISOString(), goal.id]);
  return { ...goal, status: "paused" };
}

export async function resumeChatGoal(sessionId) {
  const db = await getAdapter();
  const goal = db.get(`SELECT * FROM chatGoals WHERE sessionId = ? AND status = 'paused' ORDER BY updatedAt DESC LIMIT 1`, [sessionId]);
  if (!goal) return null;
  db.run(`UPDATE chatGoals SET status = 'active', updatedAt = ? WHERE id = ?`, [new Date().toISOString(), goal.id]);
  return toGoal({ ...goal, status: "active" });
}

export async function clearChatGoal(sessionId) {
  const db = await getAdapter();
  db.run(`UPDATE chatGoals SET status = 'cleared', updatedAt = ? WHERE sessionId = ? AND status = 'active'`, [new Date().toISOString(), sessionId]);
  return true;
}

export async function bumpChatGoalIteration(sessionId) {
  const db = await getAdapter();
  const goal = await getActiveChatGoal(sessionId);
  if (!goal) return null;
  const next = { ...goal, iterations: (goal.iterations || 0) + 1, updatedAt: new Date().toISOString() };
  db.run(`UPDATE chatGoals SET iterations = ?, updatedAt = ? WHERE id = ?`, [next.iterations, next.updatedAt, goal.id]);
  return next;
}

export async function completeChatGoal(sessionId, judgeResult) {
  const db = await getAdapter();
  const goal = await getActiveChatGoal(sessionId);
  if (!goal) return null;
  db.run(`UPDATE chatGoals SET status = 'completed', judgeResult = ?, updatedAt = ? WHERE id = ?`, [judgeResult || "", new Date().toISOString(), goal.id]);
  return { ...goal, status: "completed", judgeResult: judgeResult || "" };
}
