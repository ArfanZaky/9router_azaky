import { NextResponse } from "next/server";
import { getGrokCliBulkImportManager } from "@/lib/oauth/services";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/grok-cli/bulk-import/[jobId]/manual/[workerId]
 * Open manual assist session for a worker that needs manual intervention
 */
export async function POST(_request, { params }) {
  const { jobId, workerId } = await params;
  const manager = getGrokCliBulkImportManager();
  const result = await manager.openManualSession(jobId, workerId);

  if (!result) {
    return NextResponse.json({ error: "Bulk import job not found" }, { status: 404 });
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error || "Manual session not found for this worker",
        job: result.job,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    job: result.job,
    account: result.account,
  });
}
