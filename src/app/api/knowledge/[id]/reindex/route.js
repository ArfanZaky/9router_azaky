import { NextResponse } from "next/server";
import {
  getKnowledgeBase,
  listDocuments,
  updateKnowledgeBase,
} from "@/lib/db/repos/knowledgeRepo";
import { processDocument } from "@/lib/knowledge/documentProcessor";

/**
 * POST /api/knowledge/[id]/reindex — re-chunk and re-embed all documents.
 */
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const kb = await getKnowledgeBase(id);
    if (!kb) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });

    if (!kb.embeddingModel) {
      return NextResponse.json({ error: "No embedding model configured" }, { status: 400 });
    }

    await updateKnowledgeBase(id, { status: "indexing" });

    const docs = await listDocuments(id);
    const proto = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
    const baseUrl = `${proto}://${host}`;

    // Process all docs async
    (async () => {
      let errors = 0;
      for (const doc of docs) {
        try {
          await processDocument(doc, baseUrl);
        } catch (err) {
          errors++;
          console.error(`[Knowledge] Reindex error for doc ${doc.id}:`, err.message);
        }
      }
      await updateKnowledgeBase(id, { status: errors ? "partial" : "ready" });
    })();

    return NextResponse.json({ ok: true, message: `Reindexing ${docs.length} documents...` });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
