import { NextResponse } from "next/server";
import { FlowRequestError, resumeFlowJobQueued } from "@/lib/flow/bridge";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

/**
 * Finish an i2v job whose submit already went out but whose worker died
 * (server restart, killed process): find the clip Flow made for it in the
 * project listing and download it. Never submits again, so no new credits.
 * Runs through the bridge's serial lock so it never shares the Chrome profile
 * with a render.
 */
export async function POST(_request, { params }) {
  const { id } = await params;
  try {
    const done = await resumeFlowJobQueued(id);
    return NextResponse.json(done);
  } catch (error) {
    const status = error instanceof FlowRequestError ? error.status : 502;
    return NextResponse.json({ error: String(error?.message || error).slice(0, 800) }, { status });
  }
}
