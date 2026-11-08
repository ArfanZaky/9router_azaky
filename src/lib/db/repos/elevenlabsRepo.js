// ElevenLabs Studio: TTS history + subscription snapshots.
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export function rowToElevenJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    connectionId: row.connectionId || null,
    accountName: row.accountName || null,
    model: row.model,
    voiceId: row.voiceId,
    voiceName: row.voiceName || null,
    text: row.text,
    outputFormat: row.outputFormat || null,
    settings: parseJson(row.settings, {}),
    status: row.status,
    error: row.error || null,
    characterCost: row.characterCost ?? 0,
    hasAudio: Boolean(row.mediaPath),
    mime: row.mime || null,
    bytes: row.bytes ?? null,
    latencyMs: row.latencyMs ?? null,
    requestId: row.requestId || null,
    historyItemId: row.historyItemId || null,
    createdAt: row.createdAt,
  };
}

export async function createElevenJob(data = {}) {
  const db = await getAdapter();
  const job = {
    id: data.id || uuidv4(),
    connectionId: data.connectionId || null,
    accountName: data.accountName || null,
    model: data.model,
    voiceId: data.voiceId,
    voiceName: data.voiceName || null,
    text: data.text || "",
    outputFormat: data.outputFormat || null,
    settings: stringifyJson(data.settings || {}),
    status: data.status || "completed",
    error: data.error || null,
    characterCost: Number(data.characterCost) || 0,
    mediaPath: data.mediaPath || null,
    mime: data.mime || null,
    bytes: data.bytes ?? null,
    latencyMs: data.latencyMs ?? null,
    requestId: data.requestId || null,
    historyItemId: data.historyItemId || null,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO elevenlabsJobs
      (id, connectionId, accountName, model, voiceId, voiceName, text, outputFormat, settings, status, error,
       characterCost, mediaPath, mime, bytes, latencyMs, requestId, historyItemId, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      job.id, job.connectionId, job.accountName, job.model, job.voiceId, job.voiceName, job.text,
      job.outputFormat, job.settings, job.status, job.error, job.characterCost, job.mediaPath, job.mime,
      job.bytes, job.latencyMs, job.requestId, job.historyItemId, job.createdAt,
    ]
  );
  return rowToElevenJob(job);
}

/** Raw row, including mediaPath. Server-side only — never send it to the client. */
export async function getElevenJobRow(id) {
  const db = await getAdapter();
  return db.get(`SELECT * FROM elevenlabsJobs WHERE id = ?`, [id]) || null;
}

export async function listElevenJobs({ limit = 50, offset = 0 } = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  return db
    .all(`SELECT * FROM elevenlabsJobs ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [lim, off])
    .map(rowToElevenJob);
}

export async function deleteElevenJob(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM elevenlabsJobs WHERE id = ?`, [id]);
}

/** Credits charged since local midnight, optionally for one account. */
export async function sumElevenCostSince(sinceIso, connectionId = null) {
  const db = await getAdapter();
  const row = connectionId
    ? db.get(
        `SELECT COALESCE(SUM(characterCost),0) AS n FROM elevenlabsJobs WHERE status = 'completed' AND createdAt >= ? AND connectionId = ?`,
        [sinceIso, connectionId]
      )
    : db.get(
        `SELECT COALESCE(SUM(characterCost),0) AS n FROM elevenlabsJobs WHERE status = 'completed' AND createdAt >= ?`,
        [sinceIso]
      );
  return Number(row?.n) || 0;
}

export async function getElevenStats() {
  const db = await getAdapter();
  const total = db.get(
    `SELECT COUNT(*) AS jobs, COALESCE(SUM(characterCost),0) AS credits,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM elevenlabsJobs`
  );
  const byModel = db.all(
    `SELECT model, COUNT(*) AS jobs, COALESCE(SUM(characterCost),0) AS credits
       FROM elevenlabsJobs WHERE status = 'completed' GROUP BY model ORDER BY credits DESC`
  );
  return {
    jobs: Number(total?.jobs) || 0,
    credits: Number(total?.credits) || 0,
    failed: Number(total?.failed) || 0,
    byModel: byModel.map((r) => ({ model: r.model, jobs: Number(r.jobs) || 0, credits: Number(r.credits) || 0 })),
  };
}

function rowToSnapshot(row) {
  if (!row) return null;
  const limit = Number(row.characterLimit) || 0;
  const used = Number(row.characterCount) || 0;
  return {
    connectionId: row.connectionId,
    tier: row.tier || null,
    characterCount: used,
    characterLimit: limit,
    remaining: Math.max(0, limit - used),
    nextResetUnix: row.nextResetUnix ?? null,
    createdAt: row.createdAt,
  };
}

export async function insertElevenCreditSnapshot(data) {
  const db = await getAdapter();
  const row = {
    connectionId: data.connectionId,
    tier: data.tier || null,
    characterCount: Number(data.characterCount) || 0,
    characterLimit: Number(data.characterLimit) || 0,
    nextResetUnix: data.nextResetUnix ?? null,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO elevenlabsCreditSnapshots (connectionId, tier, characterCount, characterLimit, nextResetUnix, createdAt)
     VALUES (?,?,?,?,?,?)`,
    [row.connectionId, row.tier, row.characterCount, row.characterLimit, row.nextResetUnix, row.createdAt]
  );
  // Keep the table small: the dashboard only ever needs the latest few per account.
  db.run(
    `DELETE FROM elevenlabsCreditSnapshots WHERE connectionId = ? AND id NOT IN
       (SELECT id FROM elevenlabsCreditSnapshots WHERE connectionId = ? ORDER BY createdAt DESC LIMIT 50)`,
    [row.connectionId, row.connectionId]
  );
  return rowToSnapshot(row);
}

export async function getLatestElevenCreditSnapshot(connectionId) {
  const db = await getAdapter();
  return rowToSnapshot(
    db.get(`SELECT * FROM elevenlabsCreditSnapshots WHERE connectionId = ? ORDER BY createdAt DESC LIMIT 1`, [connectionId])
  );
}

export async function deleteElevenCreditSnapshots(connectionId) {
  const db = await getAdapter();
  db.run(`DELETE FROM elevenlabsCreditSnapshots WHERE connectionId = ?`, [connectionId]);
}
