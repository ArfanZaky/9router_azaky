import { NextResponse } from "next/server";
import { getGrokCliDomainBulkImportManager } from "@/lib/oauth/services";
import { parseKiroBulkAccounts } from "@/lib/oauth/services/kiroBulkImportManager";
import {
  resolveAllBulkImportProxies,
  resolveBulkImportProxy,
} from "@/lib/oauth/services/bulkImportProxyResolver";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const accounts = Array.isArray(body?.accounts) ? body.accounts : [];
    const { parsed, invalidLines } = parseKiroBulkAccounts(accounts);
    if (!parsed.length || invalidLines.length) {
      return NextResponse.json({
        error: parsed.length ? "Invalid account format. Use email:password" : "At least one account entry is required",
        ...(invalidLines.length ? { invalidLines } : {}),
      }, { status: 400 });
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

    if (resolvedProxy.error) {
      return NextResponse.json({ error: resolvedProxy.error }, { status: 400 });
    }
    if (body?.proxyMode === "round-robin" && !body?.proxyPoolId && resolvedProxy.proxyUrls.length < 2) {
      return NextResponse.json({ error: "Round Robin Proxy requires at least 2 active HTTP/HTTPS proxies" }, { status: 400 });
    }

    const requestedProxyMode = body?.proxyPoolId
      ? (resolvedProxy.proxyUrls.length > 1 ? "round-robin" : (resolvedProxy.proxyUrl ? "single" : "none"))
      : (body?.proxyMode === "round-robin" ? "round-robin" : "none");

    const manager = getGrokCliDomainBulkImportManager();
    const job = await manager.startJob({
      accounts,
      concurrency: 1,
      engine: "camoufox",
      proxyUrl: resolvedProxy.proxyUrl,
      proxyUrls: resolvedProxy.proxyUrls,
      proxyMode: requestedProxyMode,
      proxyPoolId: resolvedProxy.proxyPoolId,
      proxySource: resolvedProxy.proxySource,
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
    return NextResponse.json({ success: true, job });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to start Grok domain email bulk import" }, { status: 500 });
  }
}
