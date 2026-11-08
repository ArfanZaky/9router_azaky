import { NextResponse } from "next/server";
import { ElevenRequestError } from "@/lib/elevenlabs/service";

/** Map a thrown error to a JSON response without leaking stack traces. */
export function errorResponse(error) {
  if (error instanceof ElevenRequestError) {
    return NextResponse.json(
      { error: error.message, code: error.code || null, ...(error.job ? { job: error.job } : {}) },
      { status: error.status }
    );
  }
  return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status: 500 });
}
