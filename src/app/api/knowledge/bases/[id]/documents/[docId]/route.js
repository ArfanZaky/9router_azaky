import { NextResponse } from "next/server";
import { deleteDocument } from "@/lib/db/repos/knowledgeRepo";

export async function DELETE(request, { params }) {
  try {
    const { id, docId } = await params;
    await deleteDocument(docId);
    return NextResponse.json({ ok: true, deleted: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
