import { NextResponse } from "next/server";
import { generateElevenSpeech } from "@/lib/elevenlabs/service";
import { listElevenJobs } from "@/lib/db/repos/elevenlabsRepo.js";
import { errorResponse } from "../_errors";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const jobs = await listElevenJobs({ limit: searchParams.get("limit") || 50, offset: searchParams.get("offset") || 0 });
  return NextResponse.json({ jobs });
}

/** Synchronous: ElevenLabs returns audio in a few seconds, so no queue is needed. */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await generateElevenSpeech(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
