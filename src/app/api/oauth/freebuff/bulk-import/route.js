import { NextResponse } from "next/server";
import { getFreebuffBulkImportManager } from "@/lib/oauth/services/freebuffBulkImportManager";
import { resolveBulkImportProxy } from "@/lib/oauth/services/bulkImportProxyResolver";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/freebuff/bulk-import
 * Start a new Freebuff bulk import job
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];

    const { proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, error: proxyError } = await resolveBulkImportProxy({
      proxyPoolId: body?.proxyPoolId,
      proxyUrl: body?.proxyUrl,
      useSettingsFallback: false,
    });
    if (proxyError) {
      return NextResponse.json({ error: proxyError }, { status: 400 });
    }

    const manager = getFreebuffBulkImportManager();
    const job = await manager.startJob({
      accounts,
      concurrency: body?.concurrency,
      engine: body?.engine,
      proxyUrl,
      proxyUrls,
      proxyMode,
      proxyPoolId,
      proxySource,
    });

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to start Freebuff bulk import" },
      { status: 400 }
    );
  }
}
