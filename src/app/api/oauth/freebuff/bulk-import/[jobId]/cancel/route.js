import { NextResponse } from "next/server";
import { getFreebuffBulkImportManager } from "@/lib/oauth/services/freebuffBulkImportManager";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/freebuff/bulk-import/[jobId]/cancel
 * Cancel a running Freebuff bulk import job
 */
export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getFreebuffBulkImportManager();
  const job = manager.cancelJob(jobId);

  if (!job) {
    return NextResponse.json({
      success: false,
      error: "Bulk import job not found",
    }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
