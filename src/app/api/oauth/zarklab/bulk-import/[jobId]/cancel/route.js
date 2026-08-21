import { NextResponse } from "next/server";
import { getZarkLabBulkImportManager } from "@/lib/oauth/services/zarklabBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const { jobId } = await params;
    const manager = getZarkLabBulkImportManager();
    const job = await manager.cancelJob(jobId);

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to cancel ZarkLab job" },
      { status: 400 }
    );
  }
}
