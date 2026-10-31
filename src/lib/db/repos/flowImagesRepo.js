// Reusable Flow image library. Rows point at files under DATA_DIR/media/images
// (src/lib/media/imageStore.js); `characterId` + `view` mark the four angles of
// a generated character, everything else is a plain upload or one-off render.
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function rowToFlowImage(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || "",
    path: row.path,
    mime: row.mime || "image/png",
    width: row.width ?? null,
    height: row.height ?? null,
    origin: row.origin || "upload",
    characterId: row.characterId || null,
    view: row.view || null,
    createdAt: row.createdAt,
  };
}

export async function addFlowImage(data = {}) {
  const db = await getAdapter();
  const image = {
    id: data.id || uuidv4(),
    name: data.name || "",
    path: data.path,
    mime: data.mime || "image/png",
    width: data.width ?? null,
    height: data.height ?? null,
    origin: data.origin === "generated" ? "generated" : "upload",
    characterId: data.characterId || null,
    view: data.view || null,
    createdAt: data.createdAt || new Date().toISOString(),
  };
  if (!image.path) throw new Error("flowImages.path is required");
  db.run(
    `INSERT INTO flowImages (id, name, path, mime, width, height, origin, characterId, view, createdAt)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [image.id, image.name, image.path, image.mime, image.width, image.height, image.origin, image.characterId, image.view, image.createdAt]
  );
  return image;
}

export async function getFlowImage(id) {
  const db = await getAdapter();
  return rowToFlowImage(db.get(`SELECT * FROM flowImages WHERE id = ?`, [id]));
}

export async function listFlowImages({ q = "", characterId = "", limit = 100, offset = 0 } = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);
  const where = [];
  const args = [];
  const term = String(q || "").trim();
  if (term) {
    where.push(`name LIKE ?`);
    args.push(`%${term}%`);
  }
  if (characterId) {
    where.push(`characterId = ?`);
    args.push(characterId);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.all(`SELECT * FROM flowImages ${clause} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...args, lim, off]);
  return rows.map(rowToFlowImage);
}

/** Every character-owned image, so one GET can render all character cards. */
export async function listFlowCharacterImages() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM flowImages WHERE characterId IS NOT NULL ORDER BY createdAt ASC`);
  return rows.map(rowToFlowImage);
}

/** Returns the deleted row (caller removes the file) or null when unknown. */
export async function deleteFlowImage(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM flowImages WHERE id = ?`, [id]);
  if (!row) return null;
  db.run(`DELETE FROM flowImages WHERE id = ?`, [id]);
  return rowToFlowImage(row);
}

/** Delete every angle of a character; the files are removed by the caller. */
export async function deleteFlowImagesByCharacter(characterId) {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM flowImages WHERE characterId = ?`, [characterId]);
  db.run(`DELETE FROM flowImages WHERE characterId = ?`, [characterId]);
  return rows.map(rowToFlowImage);
}
