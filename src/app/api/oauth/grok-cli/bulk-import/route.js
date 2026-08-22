import { NextResponse } from "next/server";
import { getGrokCliBulkImportManager } from "@/lib/oauth/services";
import { parseKiroBulkAccounts } from "@/lib/oauth/services/kiroBulkImportManager";
import {
  resolveAllBulkImportProxies,
  resolveBulkImportProxy,
} from "@/lib/oauth/services/bulkImportProxyResolver";

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

    let resolvedProxy;
    if (body?.proxyPoolId || body?.proxyUrl) {
      resolvedProxy = await resolveBulkImportProxy({
        proxyPoolId: body.proxyPoolId,
        proxyUrl: body.proxyUrl,
        useSettingsFallback: false,
      });
    } else if (body?.proxyMode === "round-robin") {
      resolvedProxy = await resolveAllBulkImportProxies({ httpOnly: true });
    } else {
      resolvedProxy = await resolveBulkImportProxy({ useSettingsFallback: false });
    }

    const { proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, error: proxyError } = resolvedProxy;
    if (proxyError) {
      return NextResponse.json({ error: proxyError }, { status: 400 });
    }
    if (body?.proxyMode === "round-robin" && !body?.proxyPoolId && proxyUrls.length < 2) {
      return NextResponse.json(
        { error: "Round Robin Proxy requires at least 2 browser-compatible proxy URLs" },
        { status: 400 }
      );
    }

    const requestedProxyMode = body?.proxyPoolId
      ? (resolvedProxy.proxyUrls.length > 1 ? "round-robin" : (resolvedProxy.proxyUrl ? "single" : "none"))
      : (body?.proxyMode === "round-robin" ? "round-robin" : "none");

    const manager = getGrokCliBulkImportManager();
    // Camoufox handles authorization; Node issue/redeem stays on the same account proxy session.
    const job = await manager.startJob({
      accounts,
      concurrency: body?.concurrency,
      engine: "camoufox",
      proxyUrl,
      proxyUrls,
      proxyMode: requestedProxyMode,
      proxyPoolId,
      proxySource,
      jobFields: {
        proxyOffset: Math.max(0, Number.parseInt(body?.proxyOffset, 10) || 0),
        proxyAccountIndexes:
          body?.proxyAccountIndexes && typeof body.proxyAccountIndexes === "object"
            ? Object.fromEntries(
                Object.entries(body.proxyAccountIndexes)
                  .filter(([email, index]) => email.includes("@") && Number.isInteger(index) && index >= 0)
                  .map(([email, index]) => [email.toLowerCase(), index])
              )
            : {},
      },
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
