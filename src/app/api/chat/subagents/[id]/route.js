import { NextResponse } from "next/server";
import { getSubAgentInfo, interruptSubAgent } from "@/lib/chat/serverRunManager.js";

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

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const result = interruptSubAgent(id);
    if (!result?.ok) {
      return NextResponse.json(result || { error: "Sub-agent not found" }, { status: 404 });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to interrupt sub-agent" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body?.reason || "User interrupted";
    const result = interruptSubAgent(id, reason);
    if (!result?.ok) {
      return NextResponse.json(result || { error: "Sub-agent not found" }, { status: 404 });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to interrupt sub-agent" }, { status: 500 });
  }
}
