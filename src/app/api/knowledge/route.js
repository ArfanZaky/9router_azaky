import { NextResponse } from "next/server";
import {
  listKnowledgeBases,
  createKnowledgeBase,
} from "@/lib/db/repos/knowledgeRepo";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const kbs = await listKnowledgeBases({ q });
    return NextResponse.json(kbs);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const kb = await createKnowledgeBase(body);
    return NextResponse.json(kb, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
