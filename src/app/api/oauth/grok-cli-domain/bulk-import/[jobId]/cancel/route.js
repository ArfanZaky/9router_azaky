import { NextResponse } from "next/server";
import { getGrokCliDomainBulkImportManager } from "@/lib/oauth/services";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  const { jobId } = await params;
  const job = getGrokCliDomainBulkImportManager().cancelJob(jobId);
  if (!job) return NextResponse.json({ error: "Bulk import job not found" }, { status: 404 });
  return NextResponse.json({ success: true, job });
}
