import { NextResponse } from "next/server";
import { getBlackboxBulkImportManager } from "@/lib/oauth/services/blackboxBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getBlackboxBulkImportManager();
  const job = manager.cancelJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Blackbox bulk import job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
