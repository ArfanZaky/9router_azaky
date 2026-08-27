import { NextResponse } from "next/server";
import { getDocument, deleteDocument, refreshKBStats } from "@/lib/db/repos/knowledgeRepo";

export async function GET(request, { params }) {
  try {
    const { docId } = await params;
    const doc = await getDocument(docId);
    if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(doc);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { docId } = await params;
    const result = await deleteDocument(docId);
    if (result.ok && result.kbId) {
      await refreshKBStats(result.kbId);
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
