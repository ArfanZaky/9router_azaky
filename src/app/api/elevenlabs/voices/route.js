import { NextResponse } from "next/server";
import { listElevenSharedVoices, listElevenVoices } from "@/lib/elevenlabs/service";
import { errorResponse } from "../_errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/elevenlabs/voices                      → voices in the account ("My Voices")
 * GET /api/elevenlabs/voices?source=library&language=id[&search=] → community Voice Library
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const accountId = searchParams.get("accountId") || null;
    if (searchParams.get("source") === "library") {
      const voices = await listElevenSharedVoices(accountId, {
        language: searchParams.get("language") || "id",
        search: searchParams.get("search") || "",
      });
      return NextResponse.json({ voices });
    }
    const voices = await listElevenVoices(accountId, { force: searchParams.get("refresh") === "1" });
    return NextResponse.json({ voices });
  } catch (error) {
    return errorResponse(error);
  }
}
