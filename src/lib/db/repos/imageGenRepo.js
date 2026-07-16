import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function rowToAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    jobId: row.jobId,
    path: row.path || null,
    mime: row.mime || "image/png",
    width: row.width ?? null,
    height: row.height ?? null,
    sourceUrl: row.sourceUrl || null,
    createdAt: row.createdAt,
  };
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    prompt: row.prompt || "",
    negativePrompt: row.negativePrompt || "",
    model: row.model || "",
    providerId: row.providerId || "",
    params: parseJson(row.params, {}),
    status: row.status || "done",
    error: row.error || null,
    favorite: row.favorite === 1,
    createdAt: row.createdAt,
  };
}

export async function listImageJobs({
  q = "",
  favoriteOnly = false,
  model = "",
  limit = 100,
  offset = 0,
} = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const clauses = [];
  const args = [];
  if (favoriteOnly) clauses.push(`favorite = 1`);
  if (model) {
    clauses.push(`model = ?`);
    args.push(model);
  }
  const query = String(q || "").trim();
  if (query) {
    clauses.push(`(prompt LIKE ? OR model LIKE ?)`);
    args.push(`%${query}%`, `%${query}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT * FROM imageJobs ${where} ORDER BY favorite DESC, createdAt DESC LIMIT ? OFFSET ?`,
    [...args, lim, off]
  );
  const jobs = rows.map(rowToJob);
  for (const job of jobs) {
    const assets = db.all(`SELECT * FROM imageAssets WHERE jobId = ? ORDER BY createdAt ASC`, [job.id]);
    job.assets = assets.map(rowToAsset);
  }
  return jobs;
}

export async function getImageJob(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM imageJobs WHERE id = ?`, [id]);
  if (!row) return null;
  const job = rowToJob(row);
  const assets = db.all(`SELECT * FROM imageAssets WHERE jobId = ? ORDER BY createdAt ASC`, [id]);
  job.assets = assets.map(rowToAsset);
  return job;
}

export async function createImageJob(data = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const job = {
    id: data.id || uuidv4(),
    prompt: data.prompt || "",
    negativePrompt: data.negativePrompt || "",
    model: data.model || "",
    providerId: data.providerId || "",
    params: data.params || {},
    status: data.status || "done",
    error: data.error || null,
    favorite: !!data.favorite,
    createdAt: data.createdAt || now,
  };
  const assetsIn = Array.isArray(data.assets) ? data.assets : [];
  const assets = [];
  db.transaction(() => {
    db.run(
      `INSERT INTO imageJobs(id, prompt, negativePrompt, model, providerId, params, status, error, favorite, createdAt)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        job.id,
        job.prompt,
        job.negativePrompt,
        job.model,
        job.providerId,
        stringifyJson(job.params),
        job.status,
        job.error,
        job.favorite ? 1 : 0,
        job.createdAt,
      ]
    );
    for (const a of assetsIn) {
      const asset = {
        id: a.id || uuidv4(),
        jobId: job.id,
        path: a.path || null,
        mime: a.mime || "image/png",
        width: a.width ?? null,
        height: a.height ?? null,
        sourceUrl: a.sourceUrl || null,
        createdAt: a.createdAt || now,
      };
      db.run(
        `INSERT INTO imageAssets(id, jobId, path, mime, width, height, sourceUrl, createdAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          asset.id,
          asset.jobId,
          asset.path,
          asset.mime,
          asset.width,
          asset.height,
          asset.sourceUrl,
          asset.createdAt,
        ]
      );
      assets.push(asset);
    }
  });
  return { ...job, assets };
}

export async function updateImageJob(id, data = {}) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM imageJobs WHERE id = ?`, [id]);
    if (!row) return;
    const prev = rowToJob(row);
    const merged = {
      ...prev,
      ...data,
      params: data.params !== undefined ? data.params : prev.params,
      favorite: data.favorite !== undefined ? !!data.favorite : prev.favorite,
    };
    db.run(
      `UPDATE imageJobs SET prompt = ?, negativePrompt = ?, model = ?, providerId = ?, params = ?, status = ?, error = ?, favorite = ? WHERE id = ?`,
      [
        merged.prompt,
        merged.negativePrompt,
        merged.model,
        merged.providerId,
        stringifyJson(merged.params || {}),
        merged.status,
        merged.error || null,
        merged.favorite ? 1 : 0,
        id,
      ]
    );
    const assets = db.all(`SELECT * FROM imageAssets WHERE jobId = ?`, [id]).map(rowToAsset);
    result = { ...merged, assets };
  });
  return result;
}

export async function deleteImageJob(id) {
  const db = await getAdapter();
  const assets = db.all(`SELECT * FROM imageAssets WHERE jobId = ?`, [id]).map(rowToAsset);
  let ok = false;
  db.transaction(() => {
    db.run(`DELETE FROM imageAssets WHERE jobId = ?`, [id]);
    const res = db.run(`DELETE FROM imageJobs WHERE id = ?`, [id]);
    ok = (res?.changes ?? 0) > 0;
  });
  return { ok, assets };
}

export async function getImageAsset(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM imageAssets WHERE id = ?`, [id]);
  return rowToAsset(row);
}

export async function addImageAssets(jobId, assetsIn = []) {
  const db = await getAdapter();
  const job = db.get(`SELECT id FROM imageJobs WHERE id = ?`, [jobId]);
  if (!job) return null;
  const now = new Date().toISOString();
  const assets = [];
  db.transaction(() => {
    for (const a of assetsIn) {
      const asset = {
        id: a.id || uuidv4(),
        jobId,
        path: a.path || null,
        mime: a.mime || "image/png",
        width: a.width ?? null,
        height: a.height ?? null,
        sourceUrl: a.sourceUrl || null,
        createdAt: a.createdAt || now,
      };
      db.run(
        `INSERT INTO imageAssets(id, jobId, path, mime, width, height, sourceUrl, createdAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          asset.id,
          asset.jobId,
          asset.path,
          asset.mime,
          asset.width,
          asset.height,
          asset.sourceUrl,
          asset.createdAt,
        ]
      );
      assets.push(asset);
    }
  });
  return assets;
}
