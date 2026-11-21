import { listElevenJobs } from "@/lib/db/repos/elevenlabsRepo.js";
import { errorFromThrown, guardElevenApi, json, preflight, withAudioUrl } from "../_shared";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight("GET");
}

/** GET /v1/elevenlabs/jobs?limit=50&offset=0 — generation history, newest first (limit ≤ 200). */
export async function GET(request) {
  const denied = await guardElevenApi(request);
  if (denied) return denied;
  try {
    const q = new URL(request.url).searchParams;
    const limit = q.get("limit") || 50;
    const offset = q.get("offset") || 0;
    const jobs = await listElevenJobs({ limit, offset });
    return json({ jobs: jobs.map((j) => withAudioUrl(request, j)), limit: Number(limit), offset: Number(offset) });
  } catch (error) {
    return errorFromThrown(error);
  }
}
