import { NextResponse } from "next/server";
import { exportElevenAccounts } from "@/lib/elevenlabs/service";
import { errorResponse } from "../../_errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/elevenlabs/accounts/export?format=json|txt
 * Returns plain API keys as a download. Behind the dashboard auth guard; never cached.
 */
export async function GET(request) {
  try {
    const format = new URL(request.url).searchParams.get("format") === "txt" ? "txt" : "json";
    const accounts = await exportElevenAccounts();
    const stamp = new Date().toISOString().slice(0, 10);
    const body =
      format === "txt"
        ? `# ElevenLabs accounts (name|apiKey) — exported ${stamp}\n${accounts.map((a) => `${a.name}|${a.apiKey}`).join("\n")}\n`
        : JSON.stringify({ exportedAt: new Date().toISOString(), accounts }, null, 2);
    return new NextResponse(body, {
      headers: {
        "Content-Type": format === "txt" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="elevenlabs-accounts-${stamp}.${format}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
