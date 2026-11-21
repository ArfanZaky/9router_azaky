import fs from "node:fs";
import { resolveElevenAudio } from "@/lib/elevenlabs/service";
import { apiError, guardElevenApi, preflight, CORS_HEADERS } from "../../_shared";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight("GET");
}

/** GET /v1/elevenlabs/audio/:id[?download=1] — the saved audio bytes of a job. */
export async function GET(request, { params }) {
  const denied = await guardElevenApi(request);
  if (denied) return denied;
  const { id } = await params;
  // resolveElevenAudio only returns files inside AUDIO_DIR (no path traversal via the DB row).
  const audio = await resolveElevenAudio(id);
  if (!audio) return apiError(404, "Audio not found", "not_found");

  const data = fs.readFileSync(audio.abs);
  const ext = audio.mime === "audio/ogg" ? "ogg" : "mp3";
  const headers = {
    ...CORS_HEADERS,
    "Content-Type": audio.mime,
    "Content-Length": String(data.byteLength),
    "Cache-Control": "private, max-age=86400",
  };
  if (new URL(request.url).searchParams.get("download") === "1") {
    headers["Content-Disposition"] = `attachment; filename="elevenlabs-${String(id).replace(/[^A-Za-z0-9-]/g, "").slice(0, 8)}.${ext}"`;
  }
  return new Response(data, { headers });
}
