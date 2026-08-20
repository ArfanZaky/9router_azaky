import { NextResponse } from "next/server";
import { getFreebuffBulkImportManager } from "@/lib/oauth/services/freebuffBulkImportManager";
import { buildLookupResponse } from "@/lib/oauth/services/kiroBulkImportManager";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/freebuff/bulk-import/latest
 * Get the latest Freebuff bulk import job
 */
export async function GET(request) {
  const manager = getFreebuffBulkImportManager();
  const searchParams = new URL(request.url).searchParams;
  const scope = searchParams.get("scope");
  const includeRecentTerminal = scope === "recent" || scope === "all";
  const job = await manager.getLatestJobWithPreview({ includeRecentTerminal });

  if (!job) {
    return NextResponse.json({
      success: false,
      ...buildLookupResponse(null),
      error: "Bulk import job not found",
    }, { status: 404 });
  }

  return NextResponse.json({
    success: true,
    ...buildLookupResponse(job),
  });
}
