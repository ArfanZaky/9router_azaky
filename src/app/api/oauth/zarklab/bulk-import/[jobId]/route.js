import { NextResponse } from "next/server";
import { getZarkLabBulkImportManager } from "@/lib/oauth/services/zarklabBulkImportManager";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { jobId } = await params;
    const manager = getZarkLabBulkImportManager();
    const job = await manager.getJob(jobId);

    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch ZarkLab job" },
      { status: 500 }
    );
  }
}
