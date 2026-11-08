"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Input, Select, Toggle } from "@/shared/components";

function formatDate(val) {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleString("id-ID", { hour12: false });
  } catch {
    return String(val);
  }
}

export default function ConfigPanel({
  configData,
  accountsData,
  creditsData,
  priceData,
  onReload,
}) {
  const cfg = configData?.config || {};
  const runtime = configData?.runtime || {};
  const limits = priceData?.limits || configData?.limits || {};
  const videoModels = priceData?.models || configData?.models || [];
  const imageModels = priceData?.imageModels || configData?.imageModels || [];
  const stats = configData?.stats || creditsData?.stats || {};
  const history = creditsData?.history || [];
  const profiles = accountsData?.profiles || [];

  const [form, setForm] = useState({
    activeProfile: cfg.activeProfile || "",
    rotationStrategy: cfg.rotationStrategy || "active_only",
    dailyBudgetCredits: cfg.dailyBudgetCredits ?? 0,
    hostResolution: cfg.hostResolution || "720p",
    channel: cfg.channel || "chrome",
    headless: Boolean(cfg.headless),
    renderTimeoutMinutes: cfg.renderTimeoutMinutes ?? 15,
    composerTimeoutMinutes: cfg.composerTimeoutMinutes ?? 20,
    creditTimeoutMinutes: cfg.creditTimeoutMinutes ?? 3,
    defaultProjectId: cfg.defaultProjectId || "",
    dryRun: Boolean(cfg.dryRun),
  });

  const [saving, setSaving] = useState(false);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagnostics, setDiagnostics] = useState(configData?.diagnostics || null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!configData?.config) return;
    setForm({
      activeProfile: configData.config.activeProfile || "",
      rotationStrategy: configData.config.rotationStrategy || "active_only",
      dailyBudgetCredits: configData.config.dailyBudgetCredits ?? 0,
      hostResolution: configData.config.hostResolution || "720p",
      channel: configData.config.channel || "chrome",
      headless: Boolean(configData.config.headless),
      renderTimeoutMinutes: configData.config.renderTimeoutMinutes ?? 15,
      composerTimeoutMinutes: configData.config.composerTimeoutMinutes ?? 20,
      creditTimeoutMinutes: configData.config.creditTimeoutMinutes ?? 3,
      defaultProjectId: configData.config.defaultProjectId || "",
      dryRun: Boolean(configData.config.dryRun),
    });
  }, [configData]);

  async function saveConfig(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      const res = await fetch("/api/flow/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          dailyBudgetCredits: Number(form.dailyBudgetCredits) || 0,
          renderTimeoutMinutes: Number(form.renderTimeoutMinutes) || 15,
          composerTimeoutMinutes: Number(form.composerTimeoutMinutes) || 20,
          creditTimeoutMinutes: Number(form.creditTimeoutMinutes) || 3,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menyimpan konfigurasi Flow");
      setNotice("Konfigurasi Google Flow berhasil disimpan.");
      await onReload();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function runDiagnostics() {
    setError("");
    setDiagLoading(true);
    try {
      const res = await fetch("/api/flow/config?doctor=1");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menjalankan diagnostik");
      setDiagnostics(body.diagnostics || null);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setDiagLoading(false);
    }
  }

  const profileOptions = [
    { value: "", label: "Ikuti Default CLI (Otomatis)" },
    ...profiles.map((p) => ({
      value: p.name,
      label: `${p.name}${p.google_account ? ` (${p.google_account})` : ""}`,
    })),
  ];

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-600">
          {notice}
        </div>
      ) : null}

      {/* Section 1: Konfigurasi Engine & Budget */}
      <Card
        title="Konfigurasi Google Flow & Budget Harian"
        subtitle="Atur limit pemakaian kredit harian, akun default, timeout render, dan parameter browser Playwright / gflow."
      >
        <form onSubmit={saveConfig} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select
              label="Profil Akun Utama"
              value={form.activeProfile}
              onChange={(e) => setForm({ ...form, activeProfile: e.target.value })}
              options={profileOptions}
            />
            <Select
              label="Strategi Multi-Akun"
              value={form.rotationStrategy}
              onChange={(e) => setForm({ ...form, rotationStrategy: e.target.value })}
              options={[
                { value: "active_only", label: "Hanya Akun Aktif" },
                { value: "fallback", label: "Fallback (Cek Saldo Cukup)" },
                { value: "round_robin", label: "Round Robin (Bergantian)" },
              ]}
            />
            <Input
              label="Batas Kredit Harian (0 = Tanpa Batas)"
              type="number"
              min="0"
              value={String(form.dailyBudgetCredits)}
              onChange={(e) => setForm({ ...form, dailyBudgetCredits: e.target.value })}
              placeholder="0"
            />
            <Select
              label="Resolusi Host Default (Omni Flash)"
              value={form.hostResolution}
              onChange={(e) => setForm({ ...form, hostResolution: e.target.value })}
              options={[
                { value: "720p", label: "720p (Default Host Flow)" },
                { value: "360p", label: "360p" },
              ]}
            />
            <Select
              label="Browser Channel (Composer I2V)"
              value={form.channel}
              onChange={(e) => setForm({ ...form, channel: e.target.value })}
              options={[
                { value: "chrome", label: "Google Chrome" },
                { value: "auto", label: "Auto" },
                { value: "internal", label: "Playwright Chromium" },
              ]}
            />
            <Input
              label="Default Flow Project ID (Opsional)"
              value={form.defaultProjectId}
              onChange={(e) => setForm({ ...form, defaultProjectId: e.target.value })}
              placeholder="Kosongkan untuk pilih proyek terbaru otomatis"
            />
            <Input
              label="Timeout Render CLI T2V (Menit)"
              type="number"
              min="1"
              max="60"
              value={String(form.renderTimeoutMinutes)}
              onChange={(e) => setForm({ ...form, renderTimeoutMinutes: e.target.value })}
            />
            <Input
              label="Timeout Composer I2V (Menit)"
              type="number"
              min="1"
              max="60"
              value={String(form.composerTimeoutMinutes)}
              onChange={(e) => setForm({ ...form, composerTimeoutMinutes: e.target.value })}
            />
            <Input
              label="Timeout Cek Kredit (Menit)"
              type="number"
              min="1"
              max="15"
              value={String(form.creditTimeoutMinutes)}
              onChange={(e) => setForm({ ...form, creditTimeoutMinutes: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-[10px] border border-border-subtle bg-surface-2 p-3 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-text-main">Headless Browser (Composer I2V)</p>
                <p className="text-xs text-text-muted">Jalankan browser di belakang layar saat render Image-to-Video</p>
              </div>
              <Toggle
                checked={form.headless}
                onChange={(val) => setForm({ ...form, headless: Boolean(val) })}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-text-main">Dry Run Mode (Simulasi Tanpa Kredit)</p>
                <p className="text-xs text-text-muted">Uji alur antrean tanpa memanggil browser dan tanpa memotong kredit</p>
              </div>
              <Toggle
                checked={form.dryRun}
                onChange={(val) => setForm({ ...form, dryRun: Boolean(val) })}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" icon="save" loading={saving}>
              Simpan Konfigurasi
            </Button>
          </div>
        </form>
      </Card>

      {/* Section 2: Detail Limit & Kuota Google Flow */}
      <Card
        title="Detail Limit, Kuota & Aturan Google Flow"
        subtitle="Rincian batas sistem, kuota langganan Google AI, dan mekanisme proteksi kredit di 9Router."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <p className="text-xs text-text-muted">Maks Panjang Prompt</p>
            <p className="mt-1 text-base font-semibold text-text-main">{limits.maxPromptChars || 4000} char</p>
          </div>
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <p className="text-xs text-text-muted">Konkurensi Render</p>
            <p className="mt-1 text-base font-semibold text-text-main">{limits.maxConcurrentPerAccount || 1} job / akun</p>
          </div>
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <p className="text-xs text-text-muted">Maks Upload Gambar</p>
            <p className="mt-1 text-base font-semibold text-text-main">{limits.maxImageUploadMb || 10} MB</p>
          </div>
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <p className="text-xs text-text-muted">Batas Stale Worker</p>
            <p className="mt-1 text-base font-semibold text-text-main">{limits.staleJobTimeoutMin || 45} menit</p>
          </div>
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <p className="text-xs text-text-muted">Jeda Settlement Kredit</p>
            <p className="mt-1 text-base font-semibold text-text-main">{limits.creditSettlementDelaySec || 15} detik</p>
          </div>
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <p className="text-xs text-text-muted">Limit Harian Aktif</p>
            <p className="mt-1 text-base font-semibold text-text-main">
              {form.dailyBudgetCredits > 0 ? `${form.dailyBudgetCredits} credits` : "Tanpa batas"}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(limits.tiers || []).map((t) => (
            <div key={t.tier} className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text-main">{t.tier}</span>
                <Badge variant="info">{t.monthlyCredits.toLocaleString("id-ID")} credits / bulan</Badge>
              </div>
              <p className="mt-1 text-xs text-text-muted">{t.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-[10px] border border-border-subtle bg-surface-2 p-3 text-xs text-text-muted space-y-1">
          <p className="font-semibold text-text-main">Mekanisme Proteksi Kredit (Credit Gate):</p>
          <p>1. Harga dihitung per clip (flat untuk Veo 3.1 Lite/Fast/Quality), sedangkan Omni Flash mengikuti durasi (4s/6s/8s/10s) dan resolusi.</p>
          <p>2. Sebelum job dikirim ke browser, bridge mengecek saldo terakhir. Jika saldo belum pernah di-refresh atau kurang dari biaya clip, job ditolak sebelum submit agar tidak gagal di tengah jalan.</p>
          <p>3. Setiap job hanya di-submit maksimal 1 kali (tanpa auto-retry setelah tombol submit ditekan) untuk mencegah pemotongan kredit ganda.</p>
        </div>
      </Card>

      {/* Section 3: Tabel Harga & Spesifikasi Model Video + Image */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Tabel Biaya & Limit Model Video"
          subtitle={`Resolusi host aktif: ${priceData?.hostResolution || form.hostResolution || "720p"}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-text-muted">
                  <th className="py-2 pr-2">Model</th>
                  <th className="py-2 px-2">Durasi</th>
                  <th className="py-2 px-2">Rasio</th>
                  <th className="py-2 px-2">Maks Ref</th>
                  <th className="py-2 pl-2">Biaya Credits</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {videoModels.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2.5 pr-2">
                      <p className="font-semibold text-text-main">{m.name}</p>
                      <p className="text-[11px] text-text-subtle">flow/{m.id}</p>
                    </td>
                    <td className="py-2.5 px-2 text-text-main">{(m.durations || []).map((d) => `${d}s`).join(", ")}</td>
                    <td className="py-2.5 px-2 text-text-main">{(m.aspects || []).join(", ")}</td>
                    <td className="py-2.5 px-2 text-text-main">{m.maxRefs ?? 0} gambar</td>
                    <td className="py-2.5 pl-2">
                      <div className="flex flex-wrap gap-1">
                        {(m.costs || []).map((c) => (
                          <Badge key={`${m.id}-${c.duration}-${c.resolution || "def"}`} variant={c.credits === 0 ? "success" : "default"}>
                            {c.duration}s: {c.credits} cr ({c.perSecond}/s)
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          title="Spesifikasi & Limit Model Image"
          subtitle="Generate gambar melalui Google Flow (T2I & I2I)"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-text-muted">
                  <th className="py-2 pr-2">Model</th>
                  <th className="py-2 px-2">Rasio Didukung</th>
                  <th className="py-2 px-2">Maks Ref (I2I)</th>
                  <th className="py-2 pl-2">Biaya</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {imageModels.map((im) => (
                  <tr key={im.id}>
                    <td className="py-2.5 pr-2">
                      <p className="font-semibold text-text-main">{im.name}</p>
                      <p className="text-[11px] text-text-subtle">flow/{im.id}</p>
                    </td>
                    <td className="py-2.5 px-2 text-text-main">{(im.aspects || []).join(", ")}</td>
                    <td className="py-2.5 px-2 text-text-main">{im.maxRefs} gambar</td>
                    <td className="py-2.5 pl-2">
                      <Badge variant="success">0 credits (Gratis)</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 border-t border-border-subtle pt-3">
            <p className="text-xs font-semibold text-text-main mb-2">Ringkasan Pemakaian Lokal (Database 9Router)</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-border-subtle bg-surface-2 p-2">
                <p className="text-[11px] text-text-muted">Total Kredit Terpakai</p>
                <p className="text-sm font-semibold text-text-main">{stats.totalCredits ?? 0} cr</p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-2 p-2">
                <p className="text-[11px] text-text-muted">Total Job Video</p>
                <p className="text-sm font-semibold text-text-main">{stats.totalJobs ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-2 p-2">
                <p className="text-[11px] text-text-muted">Selesai (Completed)</p>
                <p className="text-sm font-semibold text-green-600">{stats.completedJobs ?? 0}</p>
              </div>
              <div className="rounded-lg border border-border-subtle bg-surface-2 p-2">
                <p className="text-[11px] text-text-muted">Gagal (Failed)</p>
                <p className="text-sm font-semibold text-red-500">{stats.failedJobs ?? 0}</p>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Section 4: Runtime Path, Riwayat Saldo & Diagnostik gflow doctor */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Lingkungan Runtime & Diagnostik CLI"
          subtitle="Status instalasi gflow-cli, path profil aktif, dan daftar proyek Flow."
          action={
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon="health_and_safety"
              loading={diagLoading}
              onClick={runDiagnostics}
            >
              Jalankan Doctor & Cek Proyek
            </Button>
          }
        >
          <div className="space-y-2 text-xs">
            <div className="flex justify-between gap-2 border-b border-border-subtle pb-1.5">
              <span className="text-text-muted">Binary CLI:</span>
              <span className="font-mono text-text-main">{runtime.gflowBin || "gflow"}</span>
            </div>
            <div className="flex justify-between gap-2 border-b border-border-subtle pb-1.5">
              <span className="text-text-muted">Output Directory:</span>
              <span className="font-mono text-text-main">{runtime.outDir || "tmp/flow_out"}</span>
            </div>
            <div className="flex flex-col gap-1 border-b border-border-subtle pb-1.5">
              <span className="text-text-muted">Path Profil Chrome Aktif:</span>
              <span className="font-mono text-[11px] text-text-main break-all">{runtime.activeProfileDir || "—"}</span>
            </div>
          </div>

          {diagnostics ? (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-main">
                  Hasil Doctor ({diagnostics.cliVersion || "gflow"}):
                </span>
                <Badge variant={diagnostics.doctor?.overall_status === "ok" ? "success" : "warning"}>
                  {diagnostics.doctor?.overall_status || "checked"}
                </Badge>
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-border-subtle bg-surface-2 p-2 text-xs">
                {(diagnostics.doctor?.checks || []).map((chk) => (
                  <div key={chk.check} className="flex items-start justify-between gap-2">
                    <span className="font-mono text-[11px] text-text-main">{chk.check}</span>
                    <span className={chk.severity === "pass" ? "text-green-600" : "text-yellow-600"}>
                      {chk.summary}
                    </span>
                  </div>
                ))}
              </div>

              <div>
                <p className="text-xs font-semibold text-text-main mb-1">
                  Proyek Flow Tercatat ({diagnostics.projects?.length || 0}):
                </p>
                {diagnostics.projects?.length ? (
                  <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border-subtle bg-surface-2 p-2 text-xs">
                    {diagnostics.projects.map((pr, idx) => (
                      <div key={pr.project_id || pr.id || idx} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-text-main truncate">
                          {pr.project_id || pr.id}
                        </span>
                        <span className="text-text-muted truncate">{pr.title || pr.profile || ""}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-text-muted">Belum ada proyek di katalog lokal.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-xs text-text-muted">
              Klik tombol &quot;Jalankan Doctor &amp; Cek Proyek&quot; untuk memeriksa kesehatan database gflow dan daftar proyek.
            </p>
          )}
        </Card>

        <Card
          title="Riwayat Snapshot Saldo Kredit"
          subtitle="Catatan pembacaan saldo dari akun Google Flow"
        >
          {history.length === 0 ? (
            <p className="text-xs text-text-muted">Belum ada riwayat pembacaan saldo.</p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border-subtle text-text-muted">
                    <th className="py-1.5 pr-2">Waktu</th>
                    <th className="py-1.5 px-2">Akun / Profil</th>
                    <th className="py-1.5 px-2">Sumber</th>
                    <th className="py-1.5 pl-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {history.slice(0, 25).map((item, i) => (
                    <tr key={`${item.createdAt}-${i}`}>
                      <td className="py-1.5 pr-2 text-text-muted">{formatDate(item.createdAt)}</td>
                      <td className="py-1.5 px-2 text-text-main">{item.profile || "default"}</td>
                      <td className="py-1.5 px-2 text-text-subtle">{item.source || "driver"}</td>
                      <td className="py-1.5 pl-2 text-right font-semibold text-text-main">{item.balance} cr</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
