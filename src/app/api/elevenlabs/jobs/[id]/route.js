import { NextResponse } from "next/server";
import { deleteElevenJobWithAudio } from "@/lib/elevenlabs/service";
import { errorResponse } from "../../_errors";

export const dynamic = "force-dynamic";

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    await deleteElevenJobWithAudio(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
