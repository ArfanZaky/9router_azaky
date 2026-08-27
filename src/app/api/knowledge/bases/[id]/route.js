import { NextResponse } from "next/server";
import {
  getKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from "@/lib/db/repos/knowledgeRepo";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const base = await getKnowledgeBase(id);
    if (!base) {
      return NextResponse.json({ ok: false, error: "Knowledge base not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, data: base });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateKnowledgeBase(id, body);
    return NextResponse.json({ ok: true, data: updated });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    await deleteKnowledgeBase(id);
    return NextResponse.json({ ok: true, deleted: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
