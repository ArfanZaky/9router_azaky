import { NextResponse } from "next/server";
import { flowBudgetState, refreshFlowCredits } from "@/lib/flow/bridge";
import { listFlowCreditSnapshots } from "@/lib/db/repos/flowRepo";

export const dynamic = "force-dynamic";

/** Stored balance. The bridge reads it from Flow's own menu; this never guesses. */
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const limit = Number(searchParams.get("limit")) || 60;
  const profile = searchParams.get("profile") || null;
  const [state, history] = await Promise.all([flowBudgetState(profile), listFlowCreditSnapshots({ profile: profile || "", limit })]);
  return NextResponse.json({ ...state, latest: { balance: state.balance, createdAt: state.balanceAt, profile: state.profile }, history });
}

/**
 * Refresh from the browser (~15s, opens Chrome). Refused while a job is running
 * because both would drive the same Chrome profile.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const snapshot = await refreshFlowCredits(body?.profile || null);
    return NextResponse.json(snapshot);
  } catch (error) {
    const message = String(error?.message || error);
    const busy = /ProfileLocked|profile is already in use|SingletonLock/i.test(message);
    return NextResponse.json(
      {
        error: busy
          ? "Flow profile is busy (a generation is running in Chrome). Refresh once it finishes."
          : message.slice(0, 500),
        locked: busy,
      },
      { status: busy ? 409 : 502 }
    );
  }
}
