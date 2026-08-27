/**
 * Vector search — cosine similarity on SQLite-stored embeddings.
 * For small-medium KBs (< 100k chunks) this is perfectly adequate.
 */

/**
 * Cosine similarity between two vectors.
 */
function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Search chunks by cosine similarity to query embedding.
 * @param {Array<{id, content, embedding, docId, chunkIndex, tokenCount}>} chunks
 * @param {number[]} queryEmbedding
 * @param {number} topK - max results
 * @param {number} threshold - min similarity (0-1)
 * @returns {Array<{id, content, docId, chunkIndex, score}>}
 */
export function searchChunks(chunks, queryEmbedding, { topK = 5, threshold = 0.3 } = {}) {
  if (!queryEmbedding?.length || !chunks?.length) return [];

  const scored = [];
  for (const chunk of chunks) {
    if (!chunk.embedding?.length) continue;
    const score = cosineSim(queryEmbedding, chunk.embedding);
    if (score >= threshold) {
      scored.push({
        id: chunk.id,
        content: chunk.content,
        docId: chunk.docId,
        chunkIndex: chunk.chunkIndex,
        tokenCount: chunk.tokenCount,
        score,
      });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
