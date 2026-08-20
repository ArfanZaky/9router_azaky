import { NextResponse } from "next/server";
import { compactSessionMessages } from "@/lib/db/repos/chatRepo.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const keepLastN = Number(body.keepLastN) || 20;
    
    const result = await compactSessionMessages(id, keepLastN);
    if (!result) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    
    return NextResponse.json(result);
  } catch (error) {
    console.log("Error compacting session:", error);
    return NextResponse.json({ error: error?.message || "Failed to compact session" }, { status: 500 });
  }
}
