import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export function rowToProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title || "Untitled Storyboard",
    prompt: row.prompt || "",
    llmModel: row.llmModel || "",
    imageModel: row.imageModel || "",
    videoModel: row.videoModel || "",
    style: row.style || "Cinematic",
    targetEngine: row.targetEngine || "General AI Video",
    characterDesc: row.characterDesc || "",
    scenes: parseJson(row.scenes, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
  };
}

export async function listVideoPromptProjects({
  q = "",
  limit = 50,
  offset = 0,
} = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const clauses = [];
  const args = [];
  const query = String(q || "").trim();
  if (query) {
    clauses.push(`(title LIKE ? OR prompt LIKE ?)`);
    args.push(`%${query}%`, `%${query}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.all(
    `SELECT * FROM videoPromptProjects ${where} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`,
    [...args, lim, off]
  );
  return rows.map(rowToProject);
}

export async function getVideoPromptProject(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM videoPromptProjects WHERE id = ?`, [id]);
  return rowToProject(row);
}

export async function createVideoPromptProject(data = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const project = {
    id: data.id || uuidv4(),
    title: data.title || "Untitled Storyboard",
    prompt: data.prompt || "",
    llmModel: data.llmModel || "",
    imageModel: data.imageModel || "",
    videoModel: data.videoModel || "",
    style: data.style || "Cinematic",
    targetEngine: data.targetEngine || "General AI Video",
    characterDesc: data.characterDesc || "",
    scenes: Array.isArray(data.scenes) ? data.scenes : [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
  db.run(
    `INSERT INTO videoPromptProjects(id, title, prompt, llmModel, imageModel, videoModel, style, targetEngine, characterDesc, scenes, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      project.id,
      project.title,
      project.prompt,
      project.llmModel,
      project.imageModel,
      project.videoModel,
      project.style,
      project.targetEngine,
      project.characterDesc,
      stringifyJson(project.scenes),
      project.createdAt,
      project.updatedAt,
    ]
  );
  return project;
}

export async function updateVideoPromptProject(id, data = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM videoPromptProjects WHERE id = ?`, [id]);
  if (!row) return null;
  const prev = rowToProject(row);
  const now = new Date().toISOString();
  const merged = {
    ...prev,
    ...data,
    scenes: data.scenes !== undefined ? data.scenes : prev.scenes,
    updatedAt: now,
  };
  db.run(
    `UPDATE videoPromptProjects
     SET title = ?, prompt = ?, llmModel = ?, imageModel = ?, videoModel = ?, style = ?, targetEngine = ?, characterDesc = ?, scenes = ?, updatedAt = ?
     WHERE id = ?`,
    [
      merged.title,
      merged.prompt,
      merged.llmModel,
      merged.imageModel,
      merged.videoModel,
      merged.style,
      merged.targetEngine,
      merged.characterDesc,
      stringifyJson(merged.scenes),
      merged.updatedAt,
      id,
    ]
  );
  return merged;
}

export async function deleteVideoPromptProject(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM videoPromptProjects WHERE id = ?`, [id]);
  return { ok: (res?.changes ?? 0) > 0 };
}
