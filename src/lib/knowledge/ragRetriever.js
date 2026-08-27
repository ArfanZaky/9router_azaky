/**
 * RAG Retriever — query knowledge bases, return formatted context for LLM injection.
 */
import { getKnowledgeBase, getChunksByKB } from "../db/repos/knowledgeRepo.js";
import { embedTexts } from "./embedder.js";
import { searchChunks } from "./vectorSearch.js";

/**
 * Retrieve relevant context from one or more knowledge bases.
 * @param {string} query - user query text
 * @param {string[]} kbIds - knowledge base IDs to search
 * @param {object} opts
 * @param {number} opts.topK - max chunks per KB (default 5)
 * @param {number} opts.threshold - min similarity (default 0.3)
 * @param {string} opts.baseUrl - internal base URL
 * @returns {Promise<{context: string, sources: Array}>}
 */
export async function retrieveContext(query, kbIds = [], { topK = 5, threshold = 0.3, baseUrl } = {}) {
  if (!query?.trim() || !kbIds?.length) return { context: "", sources: [] };

  const allResults = [];

  for (const kbId of kbIds) {
    const kb = await getKnowledgeBase(kbId);
    if (!kb || !kb.embeddingModel) continue;

    // Embed the query
    const [queryEmbedding] = await embedTexts([query], kb.embeddingModel, baseUrl);
    if (!queryEmbedding?.length) continue;

    // Get all chunks for this KB
    const chunks = await getChunksByKB(kbId);
    if (!chunks.length) continue;

    // Search
    const results = searchChunks(chunks, queryEmbedding, { topK, threshold });
    for (const r of results) {
      allResults.push({ ...r, kbName: kb.name, kbId });
    }
  }

  // Sort all results by score descending, take top K overall
  allResults.sort((a, b) => b.score - a.score);
  const topResults = allResults.slice(0, topK);

  if (!topResults.length) return { context: "", sources: [] };

  // Format context block
  const contextParts = topResults.map((r, i) =>
    `[Source ${i + 1}: ${r.kbName}] (relevance: ${(r.score * 100).toFixed(1)}%)\n${r.content}`
  );

  const context = `<knowledge_base_context>\n${contextParts.join("\n\n---\n\n")}\n</knowledge_base_context>`;

  const sources = topResults.map((r) => ({
    kbId: r.kbId,
    kbName: r.kbName,
    chunkId: r.id,
    docId: r.docId,
    score: r.score,
    preview: r.content.slice(0, 150),
  }));

  return { context, sources };
}
