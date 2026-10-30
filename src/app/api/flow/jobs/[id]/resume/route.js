import { NextResponse } from "next/server";
import { resumeFlowJob } from "@/lib/flow/composer";
import { getFlowJob, updateFlowJob } from "@/lib/db/repos/flowRepo";

export const dynamic = "force-dynamic";

/**
 * Finish a job whose submit already went out but whose worker died (server
 * restart, killed process). Answers the pending credit gate and downloads the
 * clip. Never submits again: a second submit would spend credits twice.
 */
export async function POST(_request, { params }) {
  const { id } = await params;
  const job = await getFlowJob(id);
  if (!job) return NextResponse.json({ error: "Flow job not found" }, { status: 404 });
  if (job.status === "completed") return NextResponse.json({ error: "Job already completed" }, { status: 409 });
  if (job.mode !== "i2v") {
    return NextResponse.json(
      { error: "Only composer jobs can be resumed. A t2v job runs through the gflow CLI: re-run it, the CLI's own log says whether it submitted." },
      { status: 409 }
    );
  }

  try {
    const result = await resumeFlowJob(job, {});
    const done = await updateFlowJob(id, {
      status: "completed",
      step: "done",
      error: null,
      mediaPath: result.mediaPath,
      sourceUrl: result.sourceUrl,
      finishedAt: new Date().toISOString(),
    });
    return NextResponse.json(done);
  } catch (error) {
    const message = String(error?.message || error).slice(0, 800);
    await updateFlowJob(id, { status: "failed", step: "resume-failed", error: message, finishedAt: new Date().toISOString() });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
