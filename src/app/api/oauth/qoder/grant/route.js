import { NextResponse } from "next/server";
import { grantProTrial, checkPat } from "@/lib/oauth/services/qoderGrantService";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { pat, proxyUrl } = body;
    if (!pat) {
      return NextResponse.json({ error: "A Qoder PAT (pt-...) is required" }, { status: 400 });
    }
    const result = await grantProTrial(String(pat).trim(), { proxyUrl: proxyUrl || null });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const status = error?.code === "QODER_HARNESS_MISSING" ? 400 : 500;
    return NextResponse.json({ error: error?.message || "Qoder grant failed" }, { status });
  }
}
