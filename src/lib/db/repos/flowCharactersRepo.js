// Flow characters: one row per character, four flowImages rows carry the angles.
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToCharacter(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    style: row.style || "",
    imageModel: row.imageModel || "",
    refAssetId: row.refAssetId || null,
    status: row.status || "draft",
    error: row.error || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createFlowCharacter(data = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const character = {
    id: data.id || uuidv4(),
    name: String(data.name || "").trim(),
    description: String(data.description || "").trim(),
    style: String(data.style || "").trim(),
    imageModel: String(data.imageModel || "").trim(),
    refAssetId: data.refAssetId || null,
    status: "draft",
    error: null,
    createdAt: now,
    updatedAt: now,
  };
  if (!character.name) throw new Error("name is required");
  db.run(
    `INSERT INTO flowCharacters (id, name, description, style, imageModel, refAssetId, status, error, createdAt, updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [character.id, character.name, character.description, character.style, character.imageModel, character.refAssetId, character.status, character.error, character.createdAt, character.updatedAt]
  );
  return character;
}

export async function getFlowCharacter(id) {
  const db = await getAdapter();
  return rowToCharacter(db.get(`SELECT * FROM flowCharacters WHERE id = ?`, [id]));
}

export async function listFlowCharacters() {
  const db = await getAdapter();
  return db.all(`SELECT * FROM flowCharacters ORDER BY updatedAt DESC`).map(rowToCharacter);
}

const UPDATABLE = ["name", "description", "style", "imageModel", "refAssetId", "status", "error"];

export async function updateFlowCharacter(id, patchData = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM flowCharacters WHERE id = ?`, [id]);
  if (!row) return null;
  const next = rowToCharacter(row);
  for (const key of UPDATABLE) {
    if (patchData[key] !== undefined) next[key] = patchData[key];
  }
  next.updatedAt = new Date().toISOString();
  db.run(
    `UPDATE flowCharacters SET name = ?, description = ?, style = ?, imageModel = ?, refAssetId = ?, status = ?, error = ?, updatedAt = ? WHERE id = ?`,
    [next.name, next.description, next.style, next.imageModel, next.refAssetId, next.status, next.error, next.updatedAt, id]
  );
  return next;
}

export async function deleteFlowCharacter(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM flowCharacters WHERE id = ?`, [id]);
  return { ok: (res?.changes ?? 0) > 0 };
}
