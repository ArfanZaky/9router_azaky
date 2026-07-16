import { NextResponse } from "next/server";
import {
  getProviderConnections,
  createProviderConnection,
} from "@/lib/localDb";

export const dynamic = "force-dynamic";

const EXPORT_STRIP = new Set([
  // keep identity + secrets; strip volatile runtime status
  "testStatus",
  "lastTested",
  "lastError",
  "lastErrorAt",
  "rateLimitedUntil",
  "errorCode",
  "consecutiveUseCount",
  "lastRefreshAt",
]);

function stripRuntime(conn) {
  const out = { ...conn };
  for (const k of EXPORT_STRIP) delete out[k];
  // Drop modelLock_* cooldown keys
  for (const k of Object.keys(out)) {
    if (k.startsWith("modelLock_")) delete out[k];
  }
  return out;
}

/**
 * GET /api/providers/[id]/accounts
 * Export all connections for a provider **including secrets** (for backup/import).
 */
export async function GET(_request, { params }) {
  try {
    const { id: providerId } = await params;
    if (!providerId) {
      return NextResponse.json({ error: "provider id required" }, { status: 400 });
    }

    const connections = await getProviderConnections({ provider: providerId });
    const accounts = connections.map(stripRuntime);

    return NextResponse.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      provider: providerId,
      count: accounts.length,
      accounts,
    });
  } catch (error) {
    console.log("Error exporting provider accounts:", error);
    return NextResponse.json({ error: "Failed to export accounts" }, { status: 500 });
  }
}

/**
 * POST /api/providers/[id]/accounts
 * Import accounts JSON for this provider.
 * Body: array | { accounts: [] } | single object
 */
export async function POST(request, { params }) {
  try {
    const { id: providerId } = await params;
    if (!providerId) {
      return NextResponse.json({ error: "provider id required" }, { status: 400 });
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return NextResponse.json(
        { error: `Invalid JSON body: ${err.message}` },
        { status: 400 }
      );
    }

    let accounts;
    if (Array.isArray(body)) accounts = body;
    else if (body && typeof body === "object" && Array.isArray(body.accounts)) accounts = body.accounts;
    else if (body && typeof body === "object") accounts = [body];
    else accounts = null;

    if (!Array.isArray(accounts) || accounts.length === 0) {
      return NextResponse.json({ error: "No accounts provided" }, { status: 400 });
    }

    const results = [];
    let success = 0;
    let failed = 0;

    // Serial — createProviderConnection reorders priority inside a transaction
    for (let i = 0; i < accounts.length; i++) {
      const raw = accounts[i];
      try {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          throw new Error("Item is not an object");
        }

        const {
          id: _rawId,
          provider: _provider,
          createdAt: _createdAt,
          updatedAt: _updatedAt,
          testStatus: _ts,
          lastTested: _lt,
          lastError: _le,
          lastErrorAt: _lea,
          rateLimitedUntil: _rl,
          errorCode: _ec,
          consecutiveUseCount: _cuc,
          lastRefreshAt: _lra,
          ...item
        } = raw;

        // Drop model locks
        for (const k of Object.keys(item)) {
          if (k.startsWith("modelLock_")) delete item[k];
        }

        const hasSecret =
          item.accessToken || item.refreshToken || item.apiKey || item.idToken;
        if (!hasSecret) {
          throw new Error("Missing credentials (accessToken / apiKey / refreshToken)");
        }

        const authType =
          item.authType ||
          (item.apiKey && !item.accessToken ? "apikey" : "oauth");

        const connection = await createProviderConnection({
          ...item,
          provider: providerId,
          authType,
          isActive: item.isActive !== false,
        });

        results.push({
          index: i,
          ok: true,
          id: connection?.id || null,
          email: connection?.email || item.email || null,
          name: connection?.name || item.name || null,
        });
        success += 1;
      } catch (err) {
        results.push({
          index: i,
          ok: false,
          error: err?.message || String(err),
        });
        failed += 1;
      }
    }

    return NextResponse.json({
      provider: providerId,
      success,
      failed,
      total: accounts.length,
      results,
    });
  } catch (error) {
    console.log("Error importing provider accounts:", error);
    return NextResponse.json({ error: "Failed to import accounts" }, { status: 500 });
  }
}
