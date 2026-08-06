import { NextResponse } from "next/server";
import { getGrokCliDomainBulkImportManager } from "@/lib/oauth/services";
import { buildLookupResponse } from "@/lib/oauth/services/kiroBulkImportManager";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const scope = new URL(request.url).searchParams.get("scope");
  const job = await getGrokCliDomainBulkImportManager().getLatestJobWithPreview({
    includeRecentTerminal: scope === "recent" || scope === "all",
  });
  if (!job) {
    return NextResponse.json({ success: false, ...buildLookupResponse(null), error: "Bulk import job not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true, ...buildLookupResponse(job) });
}
