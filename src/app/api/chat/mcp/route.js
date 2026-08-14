import { NextResponse } from "next/server";
import {
  listChatMcpServers,
  createChatMcpServer,
} from "@/lib/localDb";
import { listTools } from "@/lib/chat/mcpClient.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const servers = await listChatMcpServers();
    return NextResponse.json({ servers });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to list MCP servers" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const server = await createChatMcpServer(body || {});
    return NextResponse.json(server, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to create MCP server" }, { status: 400 });
  }
}

export async function PATCH(request) {
  try {
    // Probe endpoint: { probe: { transport, url|command, args } } → list tools
    const body = await request.json().catch(() => ({}));
    if (body?.probe) {
      const tools = await listTools(body.probe);
      return NextResponse.json({ tools });
    }
    return NextResponse.json({ error: "Use POST /api/chat/mcp/:id for updates" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Probe failed", tools: [] }, { status: 400 });
  }
}
