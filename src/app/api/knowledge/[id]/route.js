import { NextResponse } from "next/server";
import {
  getKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
} from "@/lib/db/repos/knowledgeRepo";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const kb = await getKnowledgeBase(id);
    if (!kb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(kb);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const kb = await updateKnowledgeBase(id, body);
    if (!kb) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(kb);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const result = await deleteKnowledgeBase(id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
