import { NextResponse } from "next/server";
import { checkPat } from "@/lib/oauth/services/qoderGrantService";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { pat } = body;
    if (!pat) {
      return NextResponse.json({ error: "A Qoder PAT (pt-...) is required" }, { status: 400 });
    }
    const result = await checkPat(String(pat).trim());
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Qoder status check failed" }, { status: 500 });
  }
}
