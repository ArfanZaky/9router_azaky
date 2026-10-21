import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";

function toShortcode(row) {
  if (!row) return null;
  return {
    id: row.id,
    tag: row.tag,
    description: row.description,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listChatShortcodes(search = "") {
  const db = await getAdapter();
  const q = String(search || "").trim();
  if (q) {
    const param = `%${q}%`;
    const rows = db.all(
      `SELECT * FROM chatShortcodes WHERE tag LIKE ? OR description LIKE ? ORDER BY tag ASC`,
      [param, param]
    );
    return rows.map(toShortcode);
  }
  const rows = db.all(`SELECT * FROM chatShortcodes ORDER BY tag ASC`);
  return rows.map(toShortcode);
}

export async function getChatShortcode(id) {
  const db = await getAdapter();
  return toShortcode(db.get(`SELECT * FROM chatShortcodes WHERE id = ?`, [id]));
}

export async function getChatShortcodeByTag(tag) {
  const db = await getAdapter();
  const cleanTag = String(tag || "").trim().replace(/^\//, "");
  if (!cleanTag) return null;
  return toShortcode(db.get(`SELECT * FROM chatShortcodes WHERE LOWER(tag) = LOWER(?) LIMIT 1`, [cleanTag]));
}

export async function createChatShortcode(data = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const rawTag = String(data.tag || "").trim().replace(/^\//, "");
  const description = String(data.description || "").trim();
  if (!rawTag) throw new Error("Shortcode tag is required");
  if (!description) throw new Error("Shortcode description is required");

  const existing = await getChatShortcodeByTag(rawTag);
  if (existing) {
    throw new Error(`Shortcode with tag "${rawTag}" already exists`);
  }

  const shortcode = {
    id: data.id || uuidv4(),
    tag: rawTag,
    description,
    createdAt: now,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO chatShortcodes(id, tag, description, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?)`,
    [shortcode.id, shortcode.tag, shortcode.description, shortcode.createdAt, shortcode.updatedAt]
  );
  return shortcode;
}

export async function updateChatShortcode(id, data = {}) {
  const db = await getAdapter();
  const prev = await getChatShortcode(id);
  if (!prev) return null;

  const rawTag = data.tag !== undefined ? String(data.tag).trim().replace(/^\//, "") : prev.tag;
  const description = data.description !== undefined ? String(data.description).trim() : prev.description;
  if (!rawTag) throw new Error("Shortcode tag cannot be empty");
  if (!description) throw new Error("Shortcode description cannot be empty");

  if (rawTag.toLowerCase() !== prev.tag.toLowerCase()) {
    const existing = await getChatShortcodeByTag(rawTag);
    if (existing && existing.id !== id) {
      throw new Error(`Shortcode with tag "${rawTag}" already exists`);
    }
  }

  const merged = {
    ...prev,
    tag: rawTag,
    description,
    updatedAt: new Date().toISOString(),
  };

  db.run(
    `UPDATE chatShortcodes SET tag = ?, description = ?, updatedAt = ? WHERE id = ?`,
    [merged.tag, merged.description, merged.updatedAt, id]
  );
  return merged;
}

export async function deleteChatShortcode(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM chatShortcodes WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}
