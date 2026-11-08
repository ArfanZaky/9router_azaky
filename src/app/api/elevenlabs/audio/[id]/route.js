import { NextResponse } from "next/server";
import fs from "node:fs";
import { resolveElevenAudio } from "@/lib/elevenlabs/service";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { id } = await params;
  const audio = await resolveElevenAudio(id);
  if (!audio) return NextResponse.json({ error: "Audio tidak ditemukan" }, { status: 404 });

  const data = fs.readFileSync(audio.abs);
  const ext = audio.mime === "audio/ogg" ? "ogg" : "mp3";
  const headers = {
    "Content-Type": audio.mime,
    "Content-Length": String(data.byteLength),
    "Cache-Control": "private, max-age=86400",
  };
  if (new URL(request.url).searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="elevenlabs-${String(id).slice(0, 8)}.${ext}"`;
  }
  return new Response(data, { headers });
}
