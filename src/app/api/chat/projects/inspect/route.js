import { NextResponse } from "next/server";
import { inspectProjectWorkspace } from "@/lib/chat/projectWorkspace.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(inspectProjectWorkspace(body.path, body.depth));
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to inspect workspace" }, { status: 400 });
  }
}
