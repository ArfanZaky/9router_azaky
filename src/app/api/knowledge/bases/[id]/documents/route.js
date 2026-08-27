import { NextResponse } from "next/server";
import {
  listDocuments,
  addDocument,
  getKnowledgeBase,
} from "@/lib/db/repos/knowledgeRepo";
import { generateEmbeddingsInternal } from "@/lib/rag/embeddingService";

function chunkText(text, maxChars = 1500, overlap = 200) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
    start += maxChars - overlap;
  }
  return chunks;
}

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const docs = await listDocuments(id);
    return NextResponse.json({ ok: true, data: docs });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const base = await getKnowledgeBase(id);

    if (!base) {
      return NextResponse.json({ ok: false, error: "Knowledge base not found" }, { status: 404 });
    }

    const { title, content, docType } = body;
    if (!content || !content.trim()) {
      return NextResponse.json({ ok: false, error: "Content is required" }, { status: 400 });
    }

    // 1. Chunk content
    const textChunks = chunkText(content.trim());
    if (textChunks.length === 0) {
      return NextResponse.json({ ok: false, error: "No content to index" }, { status: 400 });
    }

    // 2. Generate embeddings for chunks
    const model = base.embeddingModel || "text-embedding-3-small";
    const embeddings = await generateEmbeddingsInternal(textChunks, model);

    // 3. Prepare chunk objects
    const chunks = textChunks.map((chunkText, idx) => ({
      content: chunkText,
      tokenCount: Math.ceil(chunkText.length / 4),
      vector: embeddings[idx] || null,
    }));

    // 4. Save to DB
    const doc = await addDocument({
      baseId: id,
      title: title || "Untitled",
      docType: docType || "text",
      content: content.trim(),
      tokenCount: Math.ceil(content.length / 4),
      chunks,
    });

    return NextResponse.json({ ok: true, data: doc });
  } catch (err) {
    console.error("Failed to add document:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
