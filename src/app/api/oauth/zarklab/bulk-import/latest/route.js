import { NextResponse } from "next/server";
import { getZarkLabBulkImportManager } from "@/lib/oauth/services/zarklabBulkImportManager";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get("scope");
    const manager = getZarkLabBulkImportManager();
    const job = await manager.getLatestJob({ recoverableOnly: scope === "recoverable" });

    if (!job) {
      return NextResponse.json({ error: "No bulk import job found" }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      job,
      recoverable: Boolean(job && !["completed", "failed", "cancelled"].includes(job.status)),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to fetch latest ZarkLab job" },
      { status: 500 }
    );
  }
}
