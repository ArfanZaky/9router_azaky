import { NextResponse } from "next/server";
import { getQoderSignupBulkImportManager } from "@/lib/oauth/services/qoderSignupBulkImportManager";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const manager = getQoderSignupBulkImportManager();
  const job = manager.cancelJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Qoder signup bulk job not found" }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    job,
  });
}
