import { NextResponse } from "next/server";
import { getFreebuffBulkImportManager } from "@/lib/oauth/services/freebuffBulkImportManager";
import { buildLookupResponse } from "@/lib/oauth/services/kiroBulkImportManager";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/freebuff/bulk-import/[jobId]
 * Get status of a specific Freebuff bulk import job
 */
export async function GET(_request, { params }) {
  const { jobId } = await params;
  const manager = getFreebuffBulkImportManager();
  const job = await manager.getJobWithPreview(jobId);

  if (!job) {
    return NextResponse.json({
      success: false,
      ...buildLookupResponse(null, { stale: true }),
      error: "Bulk import job not found",
    }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ...buildLookupResponse(job),
  });
}
