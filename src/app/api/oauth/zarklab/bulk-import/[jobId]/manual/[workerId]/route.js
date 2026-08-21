import { NextResponse } from "next/server";
import { getZarkLabBulkImportManager } from "@/lib/oauth/services/zarklabBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { jobId, workerId } = await params;
    const manager = getZarkLabBulkImportManager();
    const job = await manager.openManualSession(jobId, Number.parseInt(workerId, 10));

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to open manual session for ZarkLab" },
      { status: 400 }
    );
  }
}
