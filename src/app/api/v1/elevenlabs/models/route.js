import { listElevenModels, OUTPUT_FORMATS } from "@/lib/elevenlabs/service";
import { errorFromThrown, guardElevenApi, json, preflight } from "../_shared";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight("GET");
}

/** GET /v1/elevenlabs/models — TTS models (with credit multiplier + max chars) and output formats. */
export async function GET(request) {
  const denied = await guardElevenApi(request);
  if (denied) return denied;
  try {
    const q = new URL(request.url).searchParams;
    const data = await listElevenModels(q.get("account_id") || q.get("accountId") || null);
    return json({ ...data, outputFormats: OUTPUT_FORMATS.map(({ value, label, mime }) => ({ value, label, mime })) });
  } catch (error) {
    return errorFromThrown(error);
  }
}
