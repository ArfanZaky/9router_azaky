import { NextResponse } from "next/server";
import { getQoderSignupBulkImportManager } from "@/lib/oauth/services/qoderSignupBulkImportManager";
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

    const manager = getQoderSignupBulkImportManager();
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
      otpTimeoutMs: body?.otpTimeoutMs,
      visionProvider: body?.visionProvider,
      visionModel: body?.visionModel,
      showTmdBrowser: body?.showTmdBrowser,
    });

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to start Qoder signup bulk job" },
      { status: 400 }
    );
  }
}
