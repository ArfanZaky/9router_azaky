import { NextResponse } from "next/server";
import { getGrokCliDomainBulkImportManager } from "@/lib/oauth/services";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId, workerId } = await params;
  const result = await getGrokCliDomainBulkImportManager().openManualSession(jobId, workerId);
  if (!result) return NextResponse.json({ error: "Bulk import job not found" }, { status: 404 });
  if (!result.ok) return NextResponse.json({ error: result.error || "Manual session not found", job: result.job }, { status: 404 });
  return NextResponse.json({ success: true, job: result.job, account: result.account });
}
