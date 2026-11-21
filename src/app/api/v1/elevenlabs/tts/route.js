import fs from "node:fs";
import { generateElevenSpeech, resolveElevenAudio } from "@/lib/elevenlabs/service";
import { apiError, errorFromThrown, guardElevenApi, json, preflight, withAudioUrl, CORS_HEADERS } from "../_shared";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight("POST");
}

const pick = (body, ...keys) => {
  for (const k of keys) if (body[k] !== undefined && body[k] !== null) return body[k];
  return undefined;
};

/**
 * POST /v1/elevenlabs/tts
 * Same pipeline as the dashboard's Generate tab: account rotation, daily credit cap,
 * history + saved audio. Fields accept camelCase or ElevenLabs' snake_case.
 *
 *   text*            string
 *   voice_id         default: Config tab
 *   model_id         default: Config tab (e.g. eleven_v4)
 *   output_format    mp3_44100_128 | mp3_44100_192 | mp3_44100_64 | mp3_22050_32 | opus_48000_128
 *   language_code    "id", "en", … ("" = auto-detect)
 *   voice_settings   { stability, similarity_boost, style, use_speaker_boost, speed }
 *   seed             integer
 *   account_id       pin one stored account (skips rotation)
 *   voice_name       label stored in history
 *   library_owner_id public_owner_id of a Voice Library voice (auto-added to the account)
 *   response_format  "audio" (default, raw bytes) | "json" (job + audio_url)
 */
export async function POST(request) {
  const denied = await guardElevenApi(request);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "Invalid JSON body", "invalid_json");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return apiError(400, "Body must be a JSON object", "invalid_json");

  const responseFormat = String(
    new URL(request.url).searchParams.get("response_format") || body.response_format || body.responseFormat || "audio"
  ).toLowerCase();
  if (!["audio", "json"].includes(responseFormat)) {
    return apiError(400, "response_format must be 'audio' or 'json'", "invalid_response_format");
  }

  let result;
  try {
    result = await generateElevenSpeech({
      text: pick(body, "text", "input"),
      voiceId: pick(body, "voiceId", "voice_id", "voice"),
      model: pick(body, "model", "modelId", "model_id"),
      outputFormat: pick(body, "outputFormat", "output_format"),
      languageCode: pick(body, "languageCode", "language_code"),
      voiceSettings: pick(body, "voiceSettings", "voice_settings"),
      seed: pick(body, "seed"),
      accountId: pick(body, "accountId", "account_id") || null,
      voiceName: pick(body, "voiceName", "voice_name"),
      libraryOwnerId: pick(body, "libraryOwnerId", "library_owner_id", "public_owner_id"),
    });
  } catch (error) {
    return errorFromThrown(error);
  }

  const { job, attempts, switchedTo } = result;
  const meta = {
    "X-Job-Id": job.id,
    "X-Character-Cost": String(job.characterCost ?? 0),
    "X-Model": job.model,
    "X-Voice-Id": job.voiceId,
    "Access-Control-Expose-Headers": "X-Job-Id, X-Character-Cost, X-Model, X-Voice-Id",
  };

  if (responseFormat === "json") {
    return json({ job: withAudioUrl(request, job), attempts, switchedTo }, 201, meta);
  }

  const audio = await resolveElevenAudio(job.id);
  if (!audio) return apiError(500, "Audio was generated but could not be read back", "audio_missing", { job_id: job.id });
  const data = fs.readFileSync(audio.abs);
  return new Response(data, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      ...meta,
      "Content-Type": audio.mime,
      "Content-Length": String(data.byteLength),
    },
  });
}
