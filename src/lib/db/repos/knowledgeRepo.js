import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// ── Row mappers ──
function rowToKB(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name || "Untitled",
    description: row.description || "",
    embeddingModel: row.embeddingModel || "",
    chunkSize: row.chunkSize ?? 512,
    chunkOverlap: row.chunkOverlap ?? 50,
    status: row.status || "ready",
    docCount: row.docCount ?? 0,
    chunkCount: row.chunkCount ?? 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || row.createdAt,
  };
}

function rowToDoc(row) {
  if (!row) return null;
  return {
    id: row.id,
    kbId: row.kbId,
    name: row.name || "",
    type: row.type || "text",
    size: row.size ?? 0,
    status: row.status || "pending",
    chunkCount: row.chunkCount ?? 0,
    error: row.error || null,
    content: row.content || "",
    createdAt: row.createdAt,
  };
}

function rowToChunk(row) {
  if (!row) return null;
  return {
    id: row.id,
    kbId: row.kbId,
    docId: row.docId,
    chunkIndex: row.chunkIndex,
    content: row.content || "",
    embedding: parseJson(row.embedding, null),
    tokenCount: row.tokenCount ?? 0,
    createdAt: row.createdAt,
  };
}

// ── Knowledge Bases CRUD ──
export async function listKnowledgeBases({ q = "", limit = 50, offset = 0 } = {}) {
  const db = await getAdapter();
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const clauses = [];
  const args = [];
  const query = String(q || "").trim();
  if (query) {
    clauses.push(`(name LIKE ? OR description LIKE ?)`);
    args.push(`%${query}%`, `%${query}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return db.all(`SELECT * FROM knowledgeBases ${where} ORDER BY updatedAt DESC LIMIT ? OFFSET ?`, [...args, lim, off]).map(rowToKB);
}

export async function getKnowledgeBase(id) {
  const db = await getAdapter();
  return rowToKB(db.get(`SELECT * FROM knowledgeBases WHERE id = ?`, [id]));
}

export async function createKnowledgeBase(data = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const kb = {
    id: data.id || uuidv4(),
    name: data.name || "Untitled",
    description: data.description || "",
    embeddingModel: data.embeddingModel || "",
    chunkSize: data.chunkSize ?? 512,
    chunkOverlap: data.chunkOverlap ?? 50,
    status: "ready",
    docCount: 0,
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  db.run(
    `INSERT INTO knowledgeBases(id, name, description, embeddingModel, chunkSize, chunkOverlap, status, docCount, chunkCount, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [kb.id, kb.name, kb.description, kb.embeddingModel, kb.chunkSize, kb.chunkOverlap, kb.status, kb.docCount, kb.chunkCount, kb.createdAt, kb.updatedAt]
  );
  return kb;
}

export async function updateKnowledgeBase(id, data = {}) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM knowledgeBases WHERE id = ?`, [id]);
  if (!row) return null;
  const prev = rowToKB(row);
  const now = new Date().toISOString();
  const merged = { ...prev, ...data, updatedAt: now };
  db.run(
    `UPDATE knowledgeBases SET name=?, description=?, embeddingModel=?, chunkSize=?, chunkOverlap=?, status=?, docCount=?, chunkCount=?, updatedAt=? WHERE id=?`,
    [merged.name, merged.description, merged.embeddingModel, merged.chunkSize, merged.chunkOverlap, merged.status, merged.docCount, merged.chunkCount, merged.updatedAt, id]
  );
  return merged;
}

export async function deleteKnowledgeBase(id) {
  const db = await getAdapter();
  let ok = false;
  db.transaction(() => {
    db.run(`DELETE FROM knowledgeChunks WHERE kbId = ?`, [id]);
    db.run(`DELETE FROM knowledgeDocuments WHERE kbId = ?`, [id]);
    const res = db.run(`DELETE FROM knowledgeBases WHERE id = ?`, [id]);
    ok = (res?.changes ?? 0) > 0;
  });
  return { ok };
}

// ── Documents CRUD ──
export async function listDocuments(kbId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM knowledgeDocuments WHERE kbId = ? ORDER BY createdAt DESC`, [kbId]).map(rowToDoc);
}

export async function getDocument(id) {
  const db = await getAdapter();
  return rowToDoc(db.get(`SELECT * FROM knowledgeDocuments WHERE id = ?`, [id]));
}

export async function createDocument(data = {}) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const doc = {
    id: data.id || uuidv4(),
    kbId: data.kbId,
    name: data.name || "Untitled",
    type: data.type || "text",
    size: data.size ?? 0,
    status: "pending",
    chunkCount: 0,
    error: null,
    content: data.content || "",
    createdAt: now,
  };
  db.run(
    `INSERT INTO knowledgeDocuments(id, kbId, name, type, size, status, chunkCount, error, content, createdAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [doc.id, doc.kbId, doc.name, doc.type, doc.size, doc.status, doc.chunkCount, doc.error, doc.content, doc.createdAt]
  );
  return doc;
}

export async function updateDocument(id, data = {}) {
  const db = await getAdapter();
  const sets = [];
  const args = [];
  for (const [k, v] of Object.entries(data)) {
    sets.push(`${k} = ?`);
    args.push(v);
  }
  if (!sets.length) return;
  args.push(id);
  db.run(`UPDATE knowledgeDocuments SET ${sets.join(", ")} WHERE id = ?`, args);
}

export async function deleteDocument(id) {
  const db = await getAdapter();
  const doc = db.get(`SELECT * FROM knowledgeDocuments WHERE id = ?`, [id]);
  if (!doc) return { ok: false };
  db.transaction(() => {
    db.run(`DELETE FROM knowledgeChunks WHERE docId = ?`, [id]);
    db.run(`DELETE FROM knowledgeDocuments WHERE id = ?`, [id]);
  });
  return { ok: true, kbId: doc.kbId };
}

// ── Chunks CRUD ──
export async function insertChunks(chunks = []) {
  if (!chunks.length) return;
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const c of chunks) {
      db.run(
        `INSERT INTO knowledgeChunks(id, kbId, docId, chunkIndex, content, embedding, tokenCount, createdAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [c.id || uuidv4(), c.kbId, c.docId, c.chunkIndex, c.content, stringifyJson(c.embedding), c.tokenCount ?? 0, now]
      );
    }
  });
}

export async function deleteChunksByDoc(docId) {
  const db = await getAdapter();
  db.run(`DELETE FROM knowledgeChunks WHERE docId = ?`, [docId]);
}

export async function getChunksByKB(kbId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM knowledgeChunks WHERE kbId = ? ORDER BY chunkIndex ASC`, [kbId]).map(rowToChunk);
}

export async function getChunksByDoc(docId) {
  const db = await getAdapter();
  return db.all(`SELECT * FROM knowledgeChunks WHERE docId = ? ORDER BY chunkIndex ASC`, [docId]).map(rowToChunk);
}

// ── Stats helpers ──
export async function refreshKBStats(kbId) {
  const db = await getAdapter();
  const docCount = db.get(`SELECT COUNT(*) as c FROM knowledgeDocuments WHERE kbId = ?`, [kbId])?.c ?? 0;
  const chunkCount = db.get(`SELECT COUNT(*) as c FROM knowledgeChunks WHERE kbId = ?`, [kbId])?.c ?? 0;
  const now = new Date().toISOString();
  db.run(`UPDATE knowledgeBases SET docCount=?, chunkCount=?, updatedAt=? WHERE id=?`, [docCount, chunkCount, now, kbId]);
  return { docCount, chunkCount };
}
