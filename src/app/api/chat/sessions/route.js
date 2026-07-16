import { NextResponse } from "next/server";
import { listChatSessions, createChatSession } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const limit = searchParams.get("limit") || 100;
    const offset = searchParams.get("offset") || 0;
    const sessions = await listChatSessions({ q, limit, offset });
    return NextResponse.json({ sessions });
  } catch (error) {
    console.log("Error listing chat sessions:", error);
    return NextResponse.json({ error: "Failed to list chat sessions" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const session = await createChatSession(body || {});
    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    console.log("Error creating chat session:", error);
    return NextResponse.json({ error: "Failed to create chat session" }, { status: 500 });
  }
}
