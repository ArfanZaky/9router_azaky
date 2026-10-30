import { NextResponse } from "next/server";
import { getFlowJobResponse } from "@/lib/flow/bridge";
import { deleteFlowJob } from "@/lib/db/repos/flowRepo";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const job = await getFlowJobResponse(id);
  if (!job) return NextResponse.json({ error: "Flow job not found" }, { status: 404 });
  return NextResponse.json(job);
}

/** Removes the queue row only. The mp4 stays on disk; Flow still owns the media. */
export async function DELETE(_request, { params }) {
  const { id } = await params;
  const { ok } = await deleteFlowJob(id);
  if (!ok) return NextResponse.json({ error: "Flow job not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
