import { NextResponse } from "next/server";
import { startServerChatRun } from "@/lib/chat/serverRunManager.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json();
    const run = await startServerChatRun(body);
    return NextResponse.json(run, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to start chat run" }, { status: 400 });
  }
}
