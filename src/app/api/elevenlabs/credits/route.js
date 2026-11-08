import { NextResponse } from "next/server";
import { elevenBudgetState, listElevenAccounts, refreshElevenCredits } from "@/lib/elevenlabs/service";
import { errorResponse } from "../_errors";

export const dynamic = "force-dynamic";

/** Stored balance of the active account + today's spend against the daily cap. */
export async function GET() {
  try {
    const [budget, { accounts, activeAccountId }] = await Promise.all([elevenBudgetState(), listElevenAccounts()]);
    const active = accounts.find((a) => a.id === activeAccountId) || null;
    return NextResponse.json({
      ...budget,
      account: active ? { id: active.id, name: active.name, creditCheck: active.creditCheck } : null,
      credits: active?.credits || null,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Re-read the balance from ElevenLabs (one GET, ~200 ms). */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const snapshot = await refreshElevenCredits(body?.id || null);
    return NextResponse.json({ ok: true, snapshot });
  } catch (error) {
    return errorResponse(error);
  }
}
