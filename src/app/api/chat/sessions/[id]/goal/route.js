import { NextResponse } from "next/server";
import {
  setChatGoal, pauseChatGoal, resumeChatGoal, clearChatGoal, getActiveChatGoal,
} from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const goal = await getActiveChatGoal(id);
    return NextResponse.json({ goal });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to get goal" }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "");
    let goal;
    if (action === "set") {
      if (!String(body.text || "").trim()) return NextResponse.json({ error: "text is required" }, { status: 400 });
      goal = await setChatGoal(id, String(body.text).trim());
    } else if (action === "pause") goal = await pauseChatGoal(id);
    else if (action === "resume") goal = await resumeChatGoal(id);
    else if (action === "clear") { await clearChatGoal(id); goal = null; }
    else return NextResponse.json({ error: "Unknown goal action" }, { status: 400 });
    return NextResponse.json({ goal });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to update goal" }, { status: 500 });
  }
}
