import { NextResponse } from "next/server";
import {
  listKnowledgeBases,
  createKnowledgeBase,
} from "@/lib/db/repos/knowledgeRepo";

export async function GET() {
  try {
    const bases = await listKnowledgeBases();
    return NextResponse.json({ ok: true, data: bases });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
    }

    const newBase = await createKnowledgeBase({
      name: body.name.trim(),
      description: body.description?.trim() || "",
      embeddingModel: body.embeddingModel?.trim() || "text-embedding-3-small",
    });

    return NextResponse.json({ ok: true, data: newBase });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
