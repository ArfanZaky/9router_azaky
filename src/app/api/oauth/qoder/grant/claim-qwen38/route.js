import { NextResponse } from "next/server";
import { claimQwen38 } from "@/lib/oauth/services/qoderGrantService";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { pat, proxyUrl } = body;
    if (!pat) {
      return NextResponse.json({ error: "A Qoder PAT (pt-...) is required" }, { status: 400 });
    }
    const result = await claimQwen38(String(pat).trim(), { proxyUrl: proxyUrl || null });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Qwen38 claim failed" }, { status: 500 });
  }
}
