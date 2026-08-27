import { NextResponse } from "next/server";
import {
  listDocuments,
  createDocument,
  getKnowledgeBase,
} from "@/lib/db/repos/knowledgeRepo";
import { processDocument } from "@/lib/knowledge/documentProcessor";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const docs = await listDocuments(id);
    return NextResponse.json(docs);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST - Upload document (JSON body with content, or multipart form with file).
 */
export async function POST(request, { params }) {
  try {
    const { id: kbId } = await params;
    const kb = await getKnowledgeBase(kbId);
    if (!kb) return NextResponse.json({ error: "Knowledge base not found" }, { status: 404 });

    let name, content, type, size;
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file) return NextResponse.json({ error: "No file uploaded" }, { status: 400 });

      name = file.name || "Untitled";
      const ext = name.split(".").pop()?.toLowerCase() || "txt";
      type = ext;
      const buffer = await file.arrayBuffer();
      content = new TextDecoder("utf-8").decode(buffer);
      size = buffer.byteLength;
    } else {
      const body = await request.json();
      name = body.name || "Untitled";
      content = body.content || "";
      type = body.type || "txt";
      size = new TextEncoder().encode(content).length;
    }

    if (!content.trim()) {
      return NextResponse.json({ error: "Empty content" }, { status: 400 });
    }

    const doc = await createDocument({ kbId, name, content, type, size });

    // Process async (chunk + embed)
    const proto = request.headers.get("x-forwarded-proto") || "http";
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
    const baseUrl = `${proto}://${host}`;

    processDocument(doc, baseUrl).catch((err) => {
      console.error(`[Knowledge] Document processing failed for ${doc.id}:`, err.message);
    });

    return NextResponse.json(doc, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
