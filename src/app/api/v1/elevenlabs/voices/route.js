import { listElevenSharedVoices, listElevenVoices } from "@/lib/elevenlabs/service";
import { errorFromThrown, guardElevenApi, json, preflight } from "../_shared";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight("GET");
}

/**
 * GET /v1/elevenlabs/voices                                   → voices in the account ("My Voices")
 * GET /v1/elevenlabs/voices?source=library&language=id&search= → community Voice Library
 * Optional: account_id, refresh=1 (bypass the voice cache)
 */
export async function GET(request) {
  const denied = await guardElevenApi(request);
  if (denied) return denied;
  try {
    const q = new URL(request.url).searchParams;
    const accountId = q.get("account_id") || q.get("accountId") || null;
    if (q.get("source") === "library") {
      const voices = await listElevenSharedVoices(accountId, {
        language: q.get("language") || "id",
        search: q.get("search") || "",
      });
      return json({ source: "library", voices });
    }
    const voices = await listElevenVoices(accountId, { force: q.get("refresh") === "1" });
    return json({ source: "account", voices });
  } catch (error) {
    return errorFromThrown(error);
  }
}
