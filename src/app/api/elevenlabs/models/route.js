import { NextResponse } from "next/server";
import { listElevenModels } from "@/lib/elevenlabs/service";
import { errorResponse } from "../_errors";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const accountId = new URL(request.url).searchParams.get("accountId") || null;
    return NextResponse.json(await listElevenModels(accountId));
  } catch (error) {
    return errorResponse(error);
  }
}
