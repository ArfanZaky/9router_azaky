import { NextResponse } from "next/server";
import { updateChatMessage, deleteChatMessage } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const message = await updateChatMessage(id, body || {});
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    return NextResponse.json(message);
  } catch (error) {
    console.log("Error updating chat message:", error);
    return NextResponse.json({ error: "Failed to update message" }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const ok = await deleteChatMessage(id);
    if (!ok) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting chat message:", error);
    return NextResponse.json({ error: "Failed to delete message" }, { status: 500 });
  }
}
