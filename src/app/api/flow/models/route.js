import { NextResponse } from "next/server";
import { flowPriceTable } from "@/lib/flow/bridge";

export const dynamic = "force-dynamic";

/**
 * Flow's model list with the credit price of every duration it offers. Flow
 * charges per clip, not per second, so the dashboard needs both numbers: a 4s
 * veo-fast and an 8s veo-fast cost the same 20 credits.
 */
export async function GET() {
  return NextResponse.json(flowPriceTable());
}
