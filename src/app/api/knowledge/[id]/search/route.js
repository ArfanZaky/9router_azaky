import { NextResponse } from "next/server";
import { getKnowledgeBase, getChunksByKB } from "@/lib/db/repos/knowledgeRepo";
import { embedTexts } from "@/lib/knowledge/embedder";
import { searchChunks } from "@/lib/knowledge/vectorSearch";

/**
 * POST /api/knowledge/[id]/search — semantic search within a knowledge base.
 * Body: { query: string, topK?: number, threshold?: number }
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const kb = await getKnowledgeBase(id);
    if (!kb) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });

    const body = await request.json();
    const query = body.query?.trim();
    if (!query) return NextResponse.json({ error: "Missing query" }, { status: 400 });

    if (!kb.embeddingModel) {
      return NextResponse.json({ error: "No embedding model configured for this knowledge base" }, { status: 400 });
    }

    const proto = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
    const baseUrl = `${proto}://${host}`;

    // Embed query
    const [queryEmbedding] = await embedTexts([query], kb.embeddingModel, baseUrl);
    if (!queryEmbedding?.length) {
      return NextResponse.json({ error: "Failed to embed query" }, { status: 500 });
    }

    // Get chunks and search
    const chunks = await getChunksByKB(id);
    const results = searchChunks(chunks, queryEmbedding, {
      topK: body.topK || 5,
      threshold: body.threshold || 0.3,
    });

    return NextResponse.json({ results, total: chunks.length });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
