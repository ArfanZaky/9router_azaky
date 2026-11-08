import { NextResponse } from "next/server";
import { getElevenConfig, saveElevenConfig, OUTPUT_FORMATS } from "@/lib/elevenlabs/service";
import { getElevenStats } from "@/lib/db/repos/elevenlabsRepo.js";
import { errorResponse } from "../_errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [config, stats] = await Promise.all([getElevenConfig(), getElevenStats()]);
    return NextResponse.json({
      config,
      stats,
      outputFormats: OUTPUT_FORMATS.map(({ value, label }) => ({ value, label })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ ok: true, config: await saveElevenConfig(body) });
  } catch (error) {
    return errorResponse(error);
  }
}
