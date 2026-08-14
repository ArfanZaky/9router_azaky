import { NextResponse } from "next/server";
import { resolveChatGate, setChatAutoApprove } from "@/lib/chat/serverRunManager.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    // Enable auto-approve mode for the run (no gate needed).
    if (body.autoApprove === true) {
      const result = setChatAutoApprove(id, true);
      if (!result) return NextResponse.json({ error: "Active run not found" }, { status: 404 });
      return NextResponse.json(result);
    }

    const gateId = String(body.gateId || "");
    if (!gateId) return NextResponse.json({ error: "gateId is required" }, { status: 400 });

    const result = resolveChatGate(id, gateId, body.outcome ?? body.answer ?? "");
    if (!result) return NextResponse.json({ error: "Gate not found or already resolved" }, { status: 404 });

    // Allow + always -> flip the run into auto-approve for subsequent approvals.
    if (body.always === true && (body.outcome ?? "") === "allow") {
      setChatAutoApprove(id, true);
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to resolve gate" }, { status: 500 });
  }
}
