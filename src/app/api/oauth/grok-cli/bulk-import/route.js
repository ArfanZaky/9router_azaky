import { NextResponse } from "next/server";
import { getGrokCliBulkImportManager } from "@/lib/oauth/services";
import { parseKiroBulkAccounts } from "@/lib/oauth/services/kiroBulkImportManager";
import { resolveBulkImportProxy } from "@/lib/oauth/services/bulkImportProxyResolver";

export const dynamic = "force-dynamic";

/**
 * POST /api/oauth/grok-cli/bulk-import
 * Start a new Grok CLI bulk import job
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    const { parsed, invalidLines } = parseKiroBulkAccounts(accounts);

    if (!parsed.length) {
      return NextResponse.json(
        { error: "At least one account entry is required" },
        { status: 400 }
      );
    }

    if (invalidLines.length > 0) {
      return NextResponse.json(
        {
          error: "Invalid account format. Use: email@gmail.com:password or email|password or email\tpassword",
          invalidLines,
        },
        { status: 400 }
      );
    }

    const { proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, error: proxyError } = await resolveBulkImportProxy({
      proxyPoolId: body?.proxyPoolId,
      proxyUrl: body?.proxyUrl,
    });
    if (proxyError) {
      return NextResponse.json({ error: proxyError }, { status: 400 });
    }

    const manager = getGrokCliBulkImportManager();
    // xAI device_code redeem rejects Chromium/Node TLS fingerprint → Access denied.
    // Manual Providers OAuth uses real browser; bulk must use Camoufox for authorize + token poll.
    const job = await manager.startJob({
      accounts,
      concurrency: body?.concurrency,
      engine: "camoufox",
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
    const status = Array.isArray(error?.invalidLines) ? 400 : 500;
    return NextResponse.json(
      {
        error: error?.error || error?.message || "Failed to start Grok CLI bulk import",
        ...(Array.isArray(error?.invalidLines) ? { invalidLines: error.invalidLines } : {}),
      },
      { status }
    );
  }
}
