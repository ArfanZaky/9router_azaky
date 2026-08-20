import { NextResponse } from "next/server";
import {
  clearChatSession,
  editChatFromMessage,
  forkChatSession,
  undoChatExchange,
} from "@/lib/localDb";
import { isRunLiveForSession } from "@/lib/chat/serverRunManager.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");

    // Only block when a run is genuinely live in this process. A DB row stuck in
    // 'queued'/'running' after a restart is stale and must not block edits.
    if (isRunLiveForSession(id)) {
      return NextResponse.json({ error: "Stop the active run before changing this conversation" }, { status: 409 });
    }
    // Stale rows (from a crashed/restarted process) are safe to ignore; leave them
    // untouched here so history is preserved, but no longer block edits.

    let result;
    if (action === "clear") result = await clearChatSession(id);
    else if (action === "undo") result = await undoChatExchange(id);
    else if (action === "edit") {
      if (!body.messageId || !String(body.content || "").trim()) {
        return NextResponse.json({ error: "messageId and content are required" }, { status: 400 });
      }
      result = await editChatFromMessage(id, body.messageId, body.content);
    } else if (action === "fork") {
      result = await forkChatSession(id, { messageId: body.messageId, title: String(body.title || "") });
    } else {
      return NextResponse.json({ error: "Unknown session action" }, { status: 400 });
    }

    if (result === false) return NextResponse.json({ error: "Message not found or not editable" }, { status: 404 });
    if (!result) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Session action failed" }, { status: 500 });
  }
}
