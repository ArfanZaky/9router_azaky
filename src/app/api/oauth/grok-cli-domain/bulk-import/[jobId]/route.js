import { NextResponse } from "next/server";
import { getGrokCliDomainBulkImportManager } from "@/lib/oauth/services";
import { buildLookupResponse } from "@/lib/oauth/services/kiroBulkImportManager";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { jobId } = await params;
  const job = await getGrokCliDomainBulkImportManager().getJobWithPreview(jobId);
  if (!job) {
    return NextResponse.json({ success: false, ...buildLookupResponse(null, { stale: true }), error: "Bulk import job not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, ...buildLookupResponse(job) });
}
