import { NextResponse } from "next/server";
import {
  getKnowledgeBase,
  getAllChunksWithVectors,
} from "@/lib/db/repos/knowledgeRepo";
import { generateEmbeddingsInternal } from "@/lib/rag/embeddingService";

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { query, topK = 5, minScore = 0.2 } = body;

    if (!query || !query.trim()) {
      return NextResponse.json({ ok: false, error: "Query is required" }, { status: 400 });
    }

    const base = await getKnowledgeBase(id);
    if (!base) {
      return NextResponse.json({ ok: false, error: "Knowledge base not found" }, { status: 404 });
    }

    // 1. Embed query
    const model = base.embeddingModel || "text-embedding-3-small";
    const [queryVec] = await generateEmbeddingsInternal([query.trim()], model);

    if (!queryVec) {
      return NextResponse.json({ ok: false, error: "Failed to generate query embedding" }, { status: 500 });
    }

    // 2. Fetch all chunks in this base
    const chunks = await getAllChunksWithVectors(id);

    // 3. Score chunks with cosine similarity
    const scored = chunks
      .map((c) => {
        const similarity = cosineSimilarity(queryVec, c.vector);
        return {
          id: c.id,
          documentId: c.documentId,
          documentTitle: c.docTitle,
          content: c.content,
          similarity,
        };
      })
      .filter((c) => c.similarity >= minScore)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);

    return NextResponse.json({ ok: true, data: scored });
  } catch (err) {
    console.error("Semantic search failed:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
