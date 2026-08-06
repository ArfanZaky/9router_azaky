import { NextResponse } from "next/server";
import { getServerChatRun, stopServerChatRun } from "@/lib/chat/serverRunManager.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const { id } = await params;
  const after = new URL(request.url).searchParams.get("after") || 0;
  const run = await getServerChatRun(id, after);
  return run ? NextResponse.json(run) : NextResponse.json({ error: "Run not found" }, { status: 404 });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const run = await stopServerChatRun(id);
  return run ? NextResponse.json(run, { status: 202 }) : NextResponse.json({ error: "Run not found" }, { status: 404 });
}
