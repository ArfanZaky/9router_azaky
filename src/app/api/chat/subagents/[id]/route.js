import { NextResponse } from "next/server";
import { getSubAgentInfo } from "@/lib/chat/serverRunManager.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const info = getSubAgentInfo(id);
    if (!info) return NextResponse.json({ error: "Sub-agent not found or run ended" }, { status: 404 });
    return NextResponse.json(info);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to fetch sub-agent" }, { status: 500 });
  }
}
