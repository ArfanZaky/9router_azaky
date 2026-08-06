import { NextResponse } from "next/server";
import { getGrokCliBulkImportManager } from "@/lib/oauth/services";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/grok-cli/bulk-import/[jobId]/cancel
 * Cancel a running Grok CLI bulk import job
 */
export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getGrokCliBulkImportManager();
  const job = manager.cancelJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Bulk import job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
