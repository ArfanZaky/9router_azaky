import { NextResponse } from "next/server";
import {
  getChatSession,
  listChatMessages,
  createChatMessage,
  replaceChatMessages,
} from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const session = await getChatSession(id, { includeMessages: false });
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get("limit") || 500;
    const offset = searchParams.get("offset") || 0;
    const messages = await listChatMessages(id, { limit, offset });
    return NextResponse.json({ messages });
  } catch (error) {
    console.log("Error listing chat messages:", error);
    return NextResponse.json({ error: "Failed to list messages" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    // Bulk replace: { messages: [...] }
    if (Array.isArray(body?.messages)) {
      const saved = await replaceChatMessages(id, body.messages);
      if (!saved) return NextResponse.json({ error: "Session not found" }, { status: 404 });
      return NextResponse.json({ messages: saved }, { status: 201 });
    }

    // Single message append
    const message = await createChatMessage(id, body || {});
    if (!message) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    console.log("Error creating chat message:", error);
    return NextResponse.json({ error: "Failed to create message" }, { status: 500 });
  }
}
