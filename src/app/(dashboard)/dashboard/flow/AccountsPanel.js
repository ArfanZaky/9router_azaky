"use client";

import { useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/shared/components";

function formatDate(val) {
  if (!val) return "—";
  try {
    return new Date(val).toLocaleString("id-ID", { hour12: false });
  } catch {
    return String(val);
  }
}

export default function AccountsPanel({
  accountsData,
  creditsData,
  onReload,
}) {
  const [form, setForm] = useState({
    profile: "",
    account: "",
    browser: "chrome",
    setActive: true,
  });
  const [actionBusy, setActionBusy] = useState("");
  const [statusMap, setStatusMap] = useState({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const profiles = accountsData?.profiles || [];
  const activeProfile = accountsData?.activeProfile || "";
  const rotationStrategy = accountsData?.rotationStrategy || "active_only";
  const byProfileStats = new Map(
    (creditsData?.stats?.byProfile || []).map((item) => [item.profile, item])
  );

  async function runAccountAction(action, payload = {}, busyKey = action) {
    setError("");
    setNotice("");
    setActionBusy(busyKey);
    try {
      const res = await fetch("/api/flow/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Gagal menjalankan ${action}`);
      if (action === "status" && payload.profile) {
        setStatusMap((prev) => ({ ...prev, [payload.profile]: body }));
        setNotice(
          body.ok
            ? `Sesi '${payload.profile}' terverifikasi${body.email ? ` (${body.email})` : ""}`
            : `Sesi '${payload.profile}' tidak valid: ${body.output || "perlu login ulang"}`
        );
      } else if (action === "renew") {
        setNotice(
          body.ok
            ? `Sesi ${payload.all ? "semua akun" : `'${payload.profile}'`} berhasil diperbarui`
            : `Renew selesai dengan catatan: ${body.output || "cek status akun"}`
        );
      } else if (action === "refresh_credits") {
        setNotice(`Saldo '${payload.profile}' berhasil diperbarui: ${body.snapshot?.balance ?? "—"} credits`);
      } else if (action === "use") {
        setNotice(`Akun aktif diubah ke '${payload.profile}'`);
      } else if (action === "login") {
        setNotice(`Akun '${payload.profile}' berhasil login dan disimpan`);
        setForm({ profile: "", account: "", browser: "chrome", setActive: true });
      } else if (action === "delete") {
        setNotice(`Akun '${payload.profile}' dihapus`);
      }
      await onReload();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setActionBusy("");
    }
  }

  async function updateRotationStrategy(strategy) {
    setError("");
    setNotice("");
    setActionBusy("rotation");
    try {
      const res = await fetch("/api/flow/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotationStrategy: strategy }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal mengubah strategi rotasi");
      setNotice(`Strategi multi-akun diubah ke '${strategy}'`);
      await onReload();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setActionBusy("");
    }
  }

  function handleLoginSubmit(e) {
    e.preventDefault();
    if (!form.profile.trim()) return;
    runAccountAction(
      "login",
      {
        profile: form.profile.trim(),
        account: form.account.trim(),
        browser: form.browser,
        setActive: form.setActive,
      },
      "login"
    );
  }

  return (
    <div className="space-y-4">
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

      <Card
        title="Tambah / Login Akun Google Flow Baru"
        subtitle="Membuka jendela browser Chrome untuk login Google Flow dan menyimpan sesi ke profil gflow terpisah."
      >
        <form onSubmit={handleLoginSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Nama Profil (ID Unik)"
              value={form.profile}
              onChange={(e) => setForm({ ...form, profile: e.target.value })}
              placeholder="contoh: akun_studio_2"
              required
            />
            <Input
              label="Email Google (Opsional)"
              value={form.account}
              onChange={(e) => setForm({ ...form, account: e.target.value })}
              placeholder="nama@gmail.com (validasi akun)"
            />
            <Select
              label="Strategi Browser Login"
              value={form.browser}
              onChange={(e) => setForm({ ...form, browser: e.target.value })}
              options={[
                { value: "chrome", label: "Google Chrome (Recommended)" },
                { value: "auto", label: "Auto Detect" },
                { value: "internal", label: "Playwright Chromium Internal" },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-sm text-text-main cursor-pointer">
              <input
                type="checkbox"
                checked={form.setActive}
                onChange={(e) => setForm({ ...form, setActive: e.target.checked })}
                className="rounded border-border"
              />
              <span>Langsung jadikan akun aktif setelah login selesai</span>
            </label>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                icon="autorenew"
                loading={actionBusy === "renew_all"}
                disabled={Boolean(actionBusy)}
                onClick={() => runAccountAction("renew", { all: true }, "renew_all")}
              >
                Renew Semua Sesi
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="sm"
                icon="person_add"
                loading={actionBusy === "login"}
                disabled={Boolean(actionBusy) || !form.profile.trim()}
              >
                Buka Browser & Login Akun
              </Button>
            </div>
          </div>
          <p className="text-xs text-text-muted">
            Catatan: Saat klik tombol login, jendela Chrome akan terbuka di host ini. Silakan login ke akun Google yang memiliki akses Flow (labs.google / flow.google.com) hingga selesai.
          </p>
        </form>
      </Card>

      <Card
        title={`Daftar Akun Tersimpan (${profiles.length})`}
        subtitle="Pilih akun yang digunakan untuk render atau atur strategi rotasi otomatis antar akun."
        action={
          <div className="w-full sm:w-64">
            <Select
              label="Strategi Multi-Akun"
              value={rotationStrategy}
              onChange={(e) => updateRotationStrategy(e.target.value)}
              options={[
                { value: "active_only", label: "Hanya Akun Aktif (Default)" },
                { value: "fallback", label: "Fallback (Pindah jika kredit kurang)" },
                { value: "round_robin", label: "Round Robin (Bergantian)" },
              ]}
            />
          </div>
        }
      >
        {profiles.length === 0 ? (
          <p className="text-sm text-text-muted">
            Belum ada profil akun Google Flow yang terdaftar. Tambahkan akun baru melalui form di atas.
          </p>
        ) : (
          <div className="space-y-3">
            {profiles.map((p) => {
              const isCurrent = p.name === activeProfile || (!activeProfile && p.is_default);
              const stat = byProfileStats.get(p.name);
              const st = statusMap[p.name];
              return (
                <div
                  key={p.name}
                  className={`rounded-[10px] border p-4 transition-all ${
                    isCurrent
                      ? "border-brand-500 bg-brand-500/5"
                      : "border-border-subtle bg-surface-2"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-semibold text-text-main">{p.name}</span>
                        {isCurrent ? (
                          <Badge variant="success" dot>
                            Aktif Digunakan
                          </Badge>
                        ) : null}
                        {p.is_default ? (
                          <Badge variant="info">CLI Default</Badge>
                        ) : null}
                        <Badge variant={p.cookies_present ? "success" : "warning"}>
                          {p.cookies_present ? "Cookies Ada" : "Cookies Kosong"}
                        </Badge>
                        {st ? (
                          <Badge variant={st.ok ? "success" : "error"}>
                            {st.ok ? "Verified" : "Unverified"}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-text-muted">
                        Email: <span className="font-medium text-text-main">{p.google_account || "—"}</span>
                      </p>
                      <p className="text-xs text-text-subtle break-all">
                        Folder Profil: {p.profile_dir || "—"}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {!isCurrent ? (
                        <Button
                          variant="primary"
                          size="sm"
                          icon="check_circle"
                          loading={actionBusy === `use:${p.name}`}
                          disabled={Boolean(actionBusy)}
                          onClick={() => runAccountAction("use", { profile: p.name }, `use:${p.name}`)}
                        >
                          Gunakan Akun Ini
                        </Button>
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        icon="account_balance_wallet"
                        loading={actionBusy === `credits:${p.name}`}
                        disabled={Boolean(actionBusy)}
                        onClick={() => runAccountAction("refresh_credits", { profile: p.name }, `credits:${p.name}`)}
                      >
                        Cek Kredit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        icon="verified_user"
                        loading={actionBusy === `status:${p.name}`}
                        disabled={Boolean(actionBusy)}
                        onClick={() => runAccountAction("status", { profile: p.name }, `status:${p.name}`)}
                      >
                        Cek Sesi
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        icon="refresh"
                        loading={actionBusy === `renew:${p.name}`}
                        disabled={Boolean(actionBusy)}
                        onClick={() => runAccountAction("renew", { profile: p.name }, `renew:${p.name}`)}
                      >
                        Renew
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        icon="login"
                        loading={actionBusy === `relogin:${p.name}`}
                        disabled={Boolean(actionBusy)}
                        onClick={() =>
                          runAccountAction(
                            "login",
                            { profile: p.name, account: p.google_account || "", browser: "chrome", setActive: isCurrent },
                            `relogin:${p.name}`
                          )
                        }
                      >
                        Re-Login
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="delete"
                        loading={actionBusy === `del:${p.name}`}
                        disabled={Boolean(actionBusy)}
                        onClick={() => {
                          if (!window.confirm(`Hapus sesi profil "${p.name}" (${p.google_account || "tanpa email"})?`)) return;
                          runAccountAction("delete", { profile: p.name }, `del:${p.name}`);
                        }}
                      >
                        Hapus
                      </Button>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border-subtle pt-3 sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-text-muted">Saldo Terakhir</p>
                      <p className="text-sm font-semibold text-text-main">
                        {p.balance !== null && p.balance !== undefined ? `${p.balance} credits` : "Belum dicek"}
                      </p>
                      {p.balanceAt ? (
                        <p className="text-[11px] text-text-subtle">{formatDate(p.balanceAt)}</p>
                      ) : null}
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Total Pemakaian Lokal</p>
                      <p className="text-sm font-semibold text-text-main">
                        {stat ? `${stat.credits} credits (${stat.completedJobs} clip)` : "0 credits"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Terakhir Dipakai (CLI)</p>
                      <p className="text-sm text-text-main">{formatDate(p.last_used_at)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-text-muted">Status Probe Terakhir</p>
                      <p className="truncate text-xs text-text-muted">
                        {st ? st.output || (st.ok ? "Sesi aktif" : "Sesi kedaluwarsa") : "Klik 'Cek Sesi' untuk verifikasi"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
