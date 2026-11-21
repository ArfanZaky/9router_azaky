import { getElevenJobRow, rowToElevenJob } from "@/lib/db/repos/elevenlabsRepo.js";
import { deleteElevenJobWithAudio } from "@/lib/elevenlabs/service";
import { apiError, errorFromThrown, guardElevenApi, json, preflight, withAudioUrl } from "../../_shared";

export const dynamic = "force-dynamic";

export function OPTIONS() {
  return preflight("GET, DELETE");
}

/** GET /v1/elevenlabs/jobs/:id — one history entry. */
export async function GET(request, { params }) {
  const denied = await guardElevenApi(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    const job = rowToElevenJob(await getElevenJobRow(id));
    if (!job) return apiError(404, "Job not found", "not_found");
    return json({ job: withAudioUrl(request, job) });
  } catch (error) {
    return errorFromThrown(error);
  }
}

/** DELETE /v1/elevenlabs/jobs/:id — remove the history entry and its audio file. */
export async function DELETE(request, { params }) {
  const denied = await guardElevenApi(request);
  if (denied) return denied;
  try {
    const { id } = await params;
    if (!(await getElevenJobRow(id))) return apiError(404, "Job not found", "not_found");
    await deleteElevenJobWithAudio(id);
    return json({ ok: true, id });
  } catch (error) {
    return errorFromThrown(error);
  }
}
