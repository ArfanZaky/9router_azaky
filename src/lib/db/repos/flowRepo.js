// Google Flow job queue + credit snapshots.
// Persisted because a Flow job outlives a poll: the client polls
// GET /v1/videos/{id} while the bridge renders in the browser.
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

export function rowToFlowJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId || null,
    mode: row.mode,
    model: row.model,
    prompt: row.prompt,
    imagePath: row.imagePath || null,
    duration: row.duration ?? null,
    aspect: row.aspect || null,
    resolution: row.resolution || null,
    creditCost: row.creditCost ?? 0,
    status: row.status,
    step: row.step || null,
    error: row.error || null,
    mediaPath: row.mediaPath || null,
    sourceUrl: row.sourceUrl || null,
    dryRun: row.dryRun === 1 || row.dryRun === true,
    createdAt: row.createdAt,
    startedAt: row.startedAt || null,
    finishedAt: row.finishedAt || null,
  };
}

export async function createFlowJob(data = {}) {
  const db = await getAdapter();
  const job = {
    id: data.id || uuidv4(),
    projectId: data.projectId || null,
    mode: data.mode === "i2v" ? "i2v" : "t2v",
    model: data.model,
    prompt: data.prompt || "",
    imagePath: data.imagePath || null,
    duration: data.duration ?? null,
    aspect: data.aspect || null,
    resolution: data.resolution || null,
    creditCost: Number(data.creditCost) || 0,
    status: data.status || "queued",
    step: data.step || "queued",
    error: null,
    mediaPath: null,
    sourceUrl: null,
    dryRun: data.dryRun ? 1 : 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
  };
  db.run(
    `INSERT INTO flowJobs
      (id, projectId, mode, model, prompt, imagePath, duration, aspect, resolution, creditCost, status, step, error, mediaPath, sourceUrl, dryRun, createdAt, startedAt, finishedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      job.id, job.projectId, job.mode, job.model, job.prompt, job.imagePath, job.duration,
      job.aspect, job.resolution, job.creditCost, job.status, job.step, job.error, job.mediaPath,
      job.sourceUrl, job.dryRun, job.createdAt, job.startedAt, job.finishedAt,
    ]
  );
  return rowToFlowJob({ ...job });
}

export async function getFlowJob(id) {
  const db = await getAdapter();
  return rowToFlowJob(db.get(`SELECT * FROM flowJobs WHERE id = ?`, [id]));
}

export async function listFlowJobs({ status = "", limit = 50, offset = 0 } = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const rows = status
    ? db.all(`SELECT * FROM flowJobs WHERE status = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [status, lim, off])
    : db.all(`SELECT * FROM flowJobs ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [lim, off]);
  return rows.map(rowToFlowJob);
}

const UPDATABLE = ["projectId", "status", "step", "error", "mediaPath", "sourceUrl", "startedAt", "finishedAt"];

export async function updateFlowJob(id, patchData = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM flowJobs WHERE id = ?`, [id]);
  if (!row) return null;
  const prev = rowToFlowJob(row);
  const next = { ...prev };
  for (const key of UPDATABLE) {
    if (patchData[key] !== undefined) next[key] = patchData[key];
  }
  db.run(
    `UPDATE flowJobs
     SET projectId = ?, status = ?, step = ?, error = ?, mediaPath = ?, sourceUrl = ?, startedAt = ?, finishedAt = ?
     WHERE id = ?`,
    [next.projectId, next.status, next.step, next.error, next.mediaPath, next.sourceUrl, next.startedAt, next.finishedAt, id]
  );
  return next;
}

export async function deleteFlowJob(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM flowJobs WHERE id = ?`, [id]);
  return { ok: (res?.changes ?? 0) > 0 };
}

/**
 * Atomically move the oldest queued job to running. Two workers can race the
 * SELECT; only the one whose UPDATE reports a change owns the job.
 */
export async function claimNextFlowJob() {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM flowJobs WHERE status = 'queued' ORDER BY createdAt ASC LIMIT 1`);
  if (!row) return null;
  const res = db.run(
    `UPDATE flowJobs SET status = 'running', startedAt = ? WHERE id = ? AND status = 'queued'`,
    [new Date().toISOString(), row.id]
  );
  if (!res?.changes) return null;
  return getFlowJob(row.id);
}

export async function addFlowCreditSnapshot({ balance, source = "bridge" } = {}) {
  const db = await getAdapter();
  const createdAt = new Date().toISOString();
  db.run(`INSERT INTO flowCreditSnapshots (balance, source, createdAt) VALUES (?,?,?)`, [
    Number(balance) || 0,
    source,
    createdAt,
  ]);
  return { balance: Number(balance) || 0, source, createdAt };
}

export async function deleteFlowCreditSnapshotsBySource(source = "test") {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM flowCreditSnapshots WHERE source = ?`, [source]);
  return res?.changes || 0;
}

export async function getLatestFlowCreditSnapshot() {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM flowCreditSnapshots ORDER BY createdAt DESC LIMIT 1`);
  return row ? { balance: row.balance, source: row.source, createdAt: row.createdAt } : null;
}

/** Most recent balances first, for the dashboard sparkline. */
export async function listFlowCreditSnapshots({ limit = 60 } = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 60, 1), 500);
  const rows = db.all(`SELECT * FROM flowCreditSnapshots ORDER BY createdAt DESC LIMIT ?`, [lim]);
  return rows.map((row) => ({ balance: row.balance, source: row.source, createdAt: row.createdAt }));
}

/**
 * Mark jobs whose worker died as failed. A running row with no owner would
 * otherwise block the dashboard's "running" state forever, and the clip (if any)
 * was already paid for, so it is reported instead of silently dropped.
 */
export async function failStaleFlowJobs({ olderThanMinutes = 45 } = {}) {
  const db = await getAdapter();
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000).toISOString();
  const res = await db.run(
    `UPDATE flowJobs
     SET status = 'failed', step = 'stale', error = ?, finishedAt = ?
     WHERE status = 'running' AND (startedAt IS NULL OR startedAt < ?)`,
    [
      `worker vanished (no update for ${olderThanMinutes} min). The clip may exist in Flow: check the project before re-running, a second submit spends credits twice.`,
      new Date().toISOString(),
      cutoff,
    ]
  );
  return res?.changes || 0;
}

/**
 * Credits committed to jobs started since `sinceIso`. Counts completed jobs only:
 * a failed job is not charged, and a running one is not yet known to be.
 */
export async function sumFlowCreditsSince(sinceIso) {
  const db = await getAdapter();
  const row = db.get(
    `SELECT COALESCE(SUM(creditCost), 0) AS total, COUNT(*) AS jobs FROM flowJobs WHERE status = 'completed' AND createdAt >= ?`,
    [sinceIso]
  );
  return { credits: Number(row?.total) || 0, jobs: Number(row?.jobs) || 0 };
}
