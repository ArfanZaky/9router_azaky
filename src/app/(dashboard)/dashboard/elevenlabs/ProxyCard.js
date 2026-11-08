"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Input, Toggle } from "@/shared/components";
import { formatDate } from "./format";

/** Public proxy on/off for ElevenLabs API calls. Saves on each change. */
export default function ProxyCard({ config, onReload }) {
  const [pool, setPool] = useState(null);
  const [poolError, setPoolError] = useState("");
  const [attempts, setAttempts] = useState(String(config.publicProxyMaxAttempts ?? 3));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch("/api/proxy-pools/public", { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || "Gagal memuat status public proxy");
        if (alive) setPool(body);
      })
      .catch((e) => alive && setPoolError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, []);

  async function save(patch, key) {
    setBusy(key);
    setError("");
    try {
      const res = await fetch("/api/elevenlabs/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menyimpan");
      await onReload();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  async function rescan() {
    setBusy("scan");
    setPoolError("");
    try {
      await fetch("/api/proxy-pools/public", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan" }),
      });
      const r = await fetch("/api/proxy-pools/public", { cache: "no-store" });
      setPool(await r.json());
    } catch (e) {
      setPoolError(String(e.message || e));
    } finally {
      setBusy("");
    }
  }

  const httpCount = (pool?.proxies || []).filter((p) => /^https?:\/\//i.test(p.url)).length;

  return (
    <Card
      title="Public proxy"
      subtitle="Kirim request ke API ElevenLabs lewat public proxy pool 9router"
      action={config.usePublicProxy ? <Badge variant="warning" dot>Aktif</Badge> : <Badge variant="default">Mati</Badge>}
    >
      <div className="space-y-4">
        {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}

        <Toggle
          checked={Boolean(config.usePublicProxy)}
          disabled={busy === "toggle"}
          onChange={(v) => save({ usePublicProxy: v }, "toggle")}
          label="Gunakan public proxy"
          description="Berlaku untuk generate, voices, models, dan cek saldo. Tidak dipakai oleh Chrome di automation."
        />
        <Toggle
          checked={Boolean(config.publicProxyFallbackDirect)}
          disabled={!config.usePublicProxy || busy === "fallback"}
          onChange={(v) => save({ publicProxyFallbackDirect: v }, "fallback")}
          label="Fallback ke koneksi langsung"
          description="Jika semua proxy yang dicoba gagal, kirim langsung tanpa proxy. Mati = request gagal (IP asli tidak dipakai)."
        />
        <div className="flex flex-wrap items-end gap-2">
          <Input
            className="w-40"
            label="Maks proxy dicoba"
            type="number"
            min={1}
            max={10}
            value={attempts}
            disabled={!config.usePublicProxy}
            onChange={(e) => setAttempts(e.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            loading={busy === "attempts"}
            disabled={!config.usePublicProxy || Number(attempts) === config.publicProxyMaxAttempts}
            onClick={() => save({ publicProxyMaxAttempts: Number(attempts) }, "attempts")}
          >
            Simpan
          </Button>
        </div>

        <div className="rounded-lg border border-border-subtle bg-surface-2 p-3 text-sm">
          {poolError ? (
            <p className="text-red-500">{poolError}</p>
          ) : pool ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-text-main">
                <span className="font-semibold">{pool.total}</span> proxy lolos screening
                <span className="text-text-muted"> ({httpCount} HTTP yang bisa dipakai di sini)</span>
              </span>
              <span className="text-xs text-text-muted">
                maks {pool.maxLatencyMs} ms · {pool.roundRobin ? "round robin" : "sticky"} · scan terakhir {pool.lastScanTime ? formatDate(pool.lastScanTime) : "—"}
                {pool.isScanning ? " · sedang scan…" : ""}
              </span>
              <span className="ml-auto flex gap-2">
                <Button variant="ghost" size="sm" icon="radar" loading={busy === "scan"} disabled={pool.isScanning} onClick={rescan}>
                  Scan ulang
                </Button>
                <a href="/dashboard/proxy-pools" className="self-center text-xs text-brand-500 hover:underline">
                  Atur di Proxy Pools
                </a>
              </span>
            </div>
          ) : (
            <p className="text-text-muted">Memuat status public proxy…</p>
          )}
        </div>

        <p className="text-xs leading-relaxed text-text-muted">
          Public proxy dijalankan pihak tak dikenal dan sering mati atau lambat. Koneksi ke ElevenLabs tetap HTTPS end-to-end, jadi API key dan isi teks
          tidak terbaca oleh proxy, tetapi operator proxy bisa melihat bahwa Anda menghubungi api.elevenlabs.io. ElevenLabs juga bisa menandai trafik
          dari proxy/VPN publik sebagai aktivitas tidak wajar, terutama pada akun free.
        </p>
      </div>
    </Card>
  );
}
