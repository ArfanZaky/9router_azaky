import { NextResponse } from "next/server";
import { getBlackboxBulkImportManager } from "@/lib/oauth/services/blackboxBulkImportManager";
import { resolveBulkImportProxy } from "@/lib/oauth/services/bulkImportProxyResolver";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const { proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, error: proxyError } = await resolveBulkImportProxy({
      proxyPoolId: body?.proxyPoolId,
      proxyUrl: body?.proxyUrl,
    });
    if (proxyError) {
      return NextResponse.json({ error: proxyError }, { status: 400 });
    }

    const manager = getBlackboxBulkImportManager();
    const job = await manager.startJob({
      count: body?.count,
      concurrency: body?.concurrency,
      engine: body?.engine,
      proxyUrl,
      proxyUrls,
      proxyMode,
      proxyPoolId,
      proxySource,
      domain: body?.domain,
      keyName: body?.keyName,
    });

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to start Blackbox bulk import" },
      { status: 400 }
    );
  }
}
