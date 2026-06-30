"use client";

import { useMemo } from "react";
import ProviderIcon from "@/shared/components/ProviderIcon";
import QuotaTable from "./QuotaTable";
import Card from "@/shared/components/Card";

/**
 * Converts a summary API response into normalized quota rows for QuotaTable.
 * Each row: { name, used, total, resetAt }
 * Values are the per-account average (sumUsed / accountCount).
 */
function buildSummaryQuotas(quotas, displayMode) {
  return Object.entries(quotas).map(([name, q]) => ({
    name,
    used: displayMode === "avg" ? q.avgUsed : q.sumUsed,
    total: displayMode === "avg" ? q.avgTotal : q.sumTotal,
    resetAt: q.resetAt,
    // tooltip info
    sumUsed: q.sumUsed,
    sumTotal: q.sumTotal,
    avgUsed: q.avgUsed,
    avgTotal: q.avgTotal,
    accountsWithData: q.accountsWithData,
  }));
}

/**
 * QuotaSummaryCard
 * Shows an aggregated quota box for all accounts of a single provider.
 *
 * Props:
 *   summary  — object from GET /api/usage/summary?provider=X
 *   loading  — boolean
 *   error    — string|null
 *   onRefresh — () => void
 *   displayMode — "avg" | "sum"  (default "avg")
 */
export default function QuotaSummaryCard({
  summary,
  loading,
  error,
  onRefresh,
  displayMode = "avg",
}) {
  const quotaRows = useMemo(() => {
    if (!summary?.quotas) return [];
    return buildSummaryQuotas(summary.quotas, displayMode);
  }, [summary, displayMode]);

  const provider = summary?.provider ?? "";
  const accountCount = summary?.accountCount ?? 0;
  const cachedCount = summary?.cachedCount ?? 0;
  const hasData = quotaRows.length > 0;

  return (
    <Card padding="none" className="border-primary/30 bg-primary/[0.02] dark:bg-primary/[0.03]">
      {/* Header */}
      <div className="px-3 py-2 border-b border-primary/20 dark:border-primary/20">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {/* Provider icon */}
            <div className="w-8 h-8 shrink-0 rounded-md flex items-center justify-center overflow-hidden">
              <ProviderIcon
                src={`/providers/${provider}.png`}
                alt={provider}
                size={32}
                className="object-contain"
                fallbackText={provider.slice(0, 2).toUpperCase() || "PR"}
              />
            </div>

            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h3 className="text-sm font-semibold text-text-primary capitalize">
                  {provider}
                </h3>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  Summary
                </span>
              </div>
              <p className="text-xs text-text-muted">
                {accountCount} account{accountCount !== 1 ? "s" : ""}
                {cachedCount < accountCount && cachedCount > 0 && (
                  <span className="ml-1 text-amber-500">
                    ({cachedCount} with data)
                  </span>
                )}
                {cachedCount === 0 && accountCount > 0 && !loading && (
                  <span className="ml-1 text-amber-500">— no data yet, refresh accounts first</span>
                )}
                {displayMode === "avg"
                  ? " · avg per account"
                  : " · total combined"}
              </p>
            </div>
          </div>

          {/* Refresh button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh summary"
            className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-50 shrink-0"
          >
            <span
              className={`material-symbols-outlined text-[18px] text-text-muted ${loading ? "animate-spin" : ""}`}
            >
              refresh
            </span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="px-2 py-1.5">
        {loading ? (
          <div className="text-center py-5 text-text-muted">
            <span className="material-symbols-outlined text-[28px] animate-spin">
              progress_activity
            </span>
          </div>
        ) : error ? (
          <div className="text-center py-5">
            <span className="material-symbols-outlined text-[28px] text-red-500">error</span>
            <p className="mt-1.5 text-xs text-text-muted">{error}</p>
          </div>
        ) : !hasData ? (
          <div className="text-center py-5">
            <span className="material-symbols-outlined text-[28px] text-text-muted opacity-30">
              bar_chart
            </span>
            <p className="mt-1.5 text-xs text-text-muted">
              No quota data yet. Refresh the accounts to populate the cache.
            </p>
          </div>
        ) : (
          <QuotaTable quotas={quotaRows} compact sortMode="default" />
        )}
      </div>
    </Card>
  );
}
