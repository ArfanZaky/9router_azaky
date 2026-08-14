import { NextResponse } from "next/server";
import {
  getChatMcpServer,
  updateChatMcpServer,
  deleteChatMcpServer,
} from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const server = await updateChatMcpServer(id, body || {});
    if (!server) return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    return NextResponse.json(server);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to update MCP server" }, { status: 400 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const ok = await deleteChatMcpServer(id);
    if (!ok) return NextResponse.json({ error: "MCP server not found" }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to delete MCP server" }, { status: 500 });
  }
}
