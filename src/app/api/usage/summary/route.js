import { getAllCachedQuotasByProvider } from "@/lib/db/repos/quotaCacheRepo";
import { getProviderConnections } from "@/lib/db/repos/connectionsRepo";
import { USAGE_SUPPORTED_PROVIDERS } from "@/shared/constants/providers";

/**
 * GET /api/usage/summary?provider=antigravity
 *
 * Reads cached quota for ALL connections of the given provider and
 * returns a single aggregated summary object:
 * {
 *   provider: string,
 *   accountCount: number,         // total connections for provider
 *   cachedCount: number,          // connections that have cached quota data
 *   quotas: {
 *     [name]: {
 *       sumUsed:  number,         // sum across all accounts
 *       sumTotal: number,         // sum across all accounts
 *       avgUsed:  number,         // sumUsed / accountCount
 *       avgTotal: number,         // sumTotal / accountCount
 *       resetAt:  string|null,    // earliest reset time across accounts
 *       accountsWithData: number, // how many accounts contributed
 *     }
 *   }
 * }
 */
export async function GET(request) {
  try {
    const url = new URL(request.url);
    const provider = url.searchParams.get("provider");

    if (!provider || provider === "all") {
      return Response.json(
        { error: "provider query param required (not 'all')" },
        { status: 400 },
      );
    }

    if (!USAGE_SUPPORTED_PROVIDERS.includes(provider)) {
      return Response.json(
        { error: `Provider '${provider}' is not supported` },
        { status: 400 },
      );
    }

    // Total connection count for this provider — active only
    const allConnections = await getProviderConnections({ provider, isActive: true });
    const accountCount = allConnections.length;

    if (accountCount === 0) {
      return Response.json({
        provider,
        accountCount: 0,
        cachedCount: 0,
        quotas: {},
      });
    }

    // Cached quota snapshots — only for active connections
    const activeIds = new Set(allConnections.map((c) => c.id));
    const allCachedRows = await getAllCachedQuotasByProvider(provider);
    const cachedRows = allCachedRows.filter((r) => activeIds.has(r.connectionId));
    const cachedCount = cachedRows.length;

    // Aggregate: group by quota name across all cached accounts
    // Structure per quota entry (normalized by parseQuotaData on the client):
    // { name, used, total, resetAt, remainingPercentage? }
    const aggregated = {};

    for (const row of cachedRows) {
      const data = row.data;
      if (!data || !data.quotas || typeof data.quotas !== "object") continue;

      for (const [key, quota] of Object.entries(data.quotas)) {
        // Use displayName if available (e.g. Antigravity), else key
        const name = quota.displayName || key;

        if (!aggregated[name]) {
          aggregated[name] = {
            sumUsed: 0,
            sumTotal: 0,
            resetAt: null,
            accountsWithData: 0,
            modelKey: key,
          };
        }

        const used = Number(quota.used) || 0;
        const total = Number(quota.total) || 0;

        aggregated[name].sumUsed += used;
        aggregated[name].sumTotal += total;
        aggregated[name].accountsWithData += 1;

        // Keep earliest resetAt (soonest reset = most relevant)
        if (quota.resetAt) {
          const t = new Date(quota.resetAt).getTime();
          if (
            !aggregated[name].resetAt ||
            t < new Date(aggregated[name].resetAt).getTime()
          ) {
            aggregated[name].resetAt = quota.resetAt;
          }
        }
      }
    }

    // Build final quotas object with avg values
    const quotas = {};
    for (const [name, agg] of Object.entries(aggregated)) {
      quotas[name] = {
        sumUsed: agg.sumUsed,
        sumTotal: agg.sumTotal,
        avgUsed: accountCount > 0 ? agg.sumUsed / accountCount : 0,
        avgTotal: accountCount > 0 ? agg.sumTotal / accountCount : 0,
        resetAt: agg.resetAt,
        accountsWithData: agg.accountsWithData,
        modelKey: agg.modelKey,
      };
    }

    return Response.json({
      provider,
      accountCount,
      cachedCount,
      quotas,
    });
  } catch (error) {
    console.error("[Usage/Summary] error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
}
