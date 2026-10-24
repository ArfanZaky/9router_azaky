"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export default function DashboardError({ error, reset }) {
  const [autoReloading, setAutoReloading] = useState(false);

  useEffect(() => {
    const errorMsg = String(error?.message || "");
    const errorName = String(error?.name || "");

    const isChunkOrFetchError =
      errorName === "ChunkLoadError" ||
      errorMsg.includes("Loading chunk") ||
      errorMsg.includes("Failed to fetch dynamically imported module") ||
      errorMsg.includes("Importing a module script failed") ||
      errorMsg.includes("failed to fetch");

    if (isChunkOrFetchError && typeof window !== "undefined") {
      const reloadKey = "last_chunk_reload_ts";
      const countKey = "chunk_reload_count";
      const now = Date.now();
      const lastReload = Number(sessionStorage.getItem(reloadKey) || 0);
      const reloadCount = Number(sessionStorage.getItem(countKey) || 0);

      // Allow up to 2 auto-reloads within 15 seconds to fetch latest build chunks
      if (now - lastReload > 15000 || reloadCount < 2) {
        setAutoReloading(true);
        sessionStorage.setItem(reloadKey, String(now));
        sessionStorage.setItem(countKey, String(now - lastReload > 15000 ? 1 : reloadCount + 1));
        setTimeout(() => {
          window.location.reload();
        }, 300);
      }
    }
  }, [error]);

  const handleManualReload = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-4 text-center">
      <div className="p-6 max-w-md w-full bg-surface border border-border rounded-2xl shadow-xl space-y-4">
        <div className="size-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-500 flex items-center justify-center mx-auto">
          <span className="material-symbols-outlined text-[24px]">
            {autoReloading ? "autorenew" : "sync_problem"}
          </span>
        </div>

        <div>
          <h2 className="text-base font-semibold text-text-main">
            {autoReloading ? "Memperbarui Halaman..." : "Halaman Perlu Dimuat Ulang"}
          </h2>
          <p className="text-xs text-text-muted mt-1 leading-relaxed">
            {autoReloading
              ? "Versi terbaru dashboard sedang dimuat. Halaman akan refresh otomatis."
              : error?.message || "Terdapat pembaruan bundle dashboard. Silakan muat ulang halaman untuk melanjutkan."}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2 pt-2">
          <button
            type="button"
            onClick={handleManualReload}
            className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-semibold shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            <span>Muat Ulang Halaman</span>
          </button>

          {reset && (
            <button
              type="button"
              onClick={() => reset()}
              className="w-full sm:flex-1 py-2.5 px-4 rounded-xl bg-surface-2 hover:bg-surface-3 text-text-main border border-border text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer min-h-[44px]"
            >
              <span className="material-symbols-outlined text-[16px]">restart_alt</span>
              <span>Coba Lagi</span>
            </button>
          )}
        </div>

        <div>
          <Link
            href="/dashboard"
            className="text-xs text-primary hover:underline inline-flex items-center gap-1 pt-1"
          >
            <span className="material-symbols-outlined text-[14px]">arrow_back</span>
            <span>Kembali ke Beranda Dashboard</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
