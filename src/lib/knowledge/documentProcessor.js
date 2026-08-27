/**
 * Document processor — orchestrates: extract text → chunk → embed → store.
 */
import { v4 as uuidv4 } from "uuid";
import { chunkText, extractText } from "./chunker.js";
import { embedTexts } from "./embedder.js";
import {
  getKnowledgeBase,
  updateDocument,
  insertChunks,
  deleteChunksByDoc,
  refreshKBStats,
} from "../db/repos/knowledgeRepo.js";

/**
 * Process a document: chunk its content, embed chunks, store in DB.
 * @param {object} doc - document record from DB
 * @param {string} [baseUrl] - internal base URL for embedding API
 */
export async function processDocument(doc, baseUrl) {
  const kb = await getKnowledgeBase(doc.kbId);
  if (!kb) throw new Error(`Knowledge base ${doc.kbId} not found`);

  try {
    await updateDocument(doc.id, { status: "processing" });

    // 1. Extract text
    const rawText = extractText(doc.content, doc.type);
    if (!rawText.trim()) {
      await updateDocument(doc.id, { status: "error", error: "No text content extracted" });
      return;
    }

    // 2. Chunk
    const chunks = chunkText(rawText, {
      chunkSize: kb.chunkSize || 512,
      chunkOverlap: kb.chunkOverlap || 50,
    });

    if (!chunks.length) {
      await updateDocument(doc.id, { status: "error", error: "No chunks generated" });
      return;
    }

    // 3. Embed (if embedding model configured)
    let embeddings = [];
    if (kb.embeddingModel) {
      const texts = chunks.map((c) => c.content);
      embeddings = await embedTexts(texts, kb.embeddingModel, baseUrl);
    }

    // 4. Clear old chunks for this doc
    await deleteChunksByDoc(doc.id);

    // 5. Store chunks
    const chunkRecords = chunks.map((c, i) => ({
      id: uuidv4(),
      kbId: doc.kbId,
      docId: doc.id,
      chunkIndex: i,
      content: c.content,
      embedding: embeddings[i] || null,
      tokenCount: c.tokenCount,
    }));

    await insertChunks(chunkRecords);

    // 6. Update document status
    await updateDocument(doc.id, {
      status: "ready",
      chunkCount: chunkRecords.length,
      error: null,
    });

    // 7. Refresh KB stats
    await refreshKBStats(doc.kbId);
  } catch (err) {
    await updateDocument(doc.id, {
      status: "error",
      error: err.message?.slice(0, 500) || "Unknown error",
    });
    throw err;
  }
}
