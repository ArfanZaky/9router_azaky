import { NextResponse } from "next/server";
import { getBlackboxBulkImportManager } from "@/lib/oauth/services/blackboxBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId, workerId } = await params;
  const manager = getBlackboxBulkImportManager();
  const result = await manager.openManualSession(jobId, workerId);

  if (!result) {
    return NextResponse.json({ error: "Blackbox bulk import job not found" }, { status: 404 });
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
