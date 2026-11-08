"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input } from "@/shared/components";

const DONE = ["completed", "failed", "cancelled"];
const STATUS_VARIANT = {
  queued: "default",
  completed: "success",
  failed: "error",
  cancelled: "default",
  waiting_login: "warning",
  waiting_key: "warning",
};
const STATUS_LABEL = {
  queued: "Antre",
  starting: "Memulai",
  signing_in: "Sign in",
  waiting_login: "Menunggu login Google",
  creating_key: "Membuat API key",
  waiting_key: "Menunggu API key",
  saving: "Menyimpan",
  completed: "Selesai",
  failed: "Gagal",
  cancelled: "Dibatalkan",
};

function time(value) {
  return value ? new Date(value).toLocaleTimeString("id-ID", { hour12: false }) : "";
}

export default function ElevenLabsAutomationPanel({ onRefresh }) {
  const [mode, setMode] = useState("multiple");
  const [form, setForm] = useState({ name: "", email: "", password: "", accounts: "", setActive: true, keepBrowserOpen: false });
  const [jobs, setJobs] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const fetchJobs = useCallback(async () => {
    const res = await fetch("/api/elevenlabs/automation", { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "Gagal memuat status automation");
    return body;
  }, []);

  const refresh = useCallback(async () => {
    const body = await fetchJobs();
    setJobs(body.jobs || []);
    setProfiles(body.profiles || []);
    return body;
  }, [fetchJobs]);

  useEffect(() => {
    let alive = true;
    fetchJobs()
      .then((body) => {
        if (!alive) return;
        setJobs(body.jobs || []);
        setProfiles(body.profiles || []);
      })
      .catch((e) => alive && setError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, [fetchJobs]);

  const activeJobs = jobs.filter((j) => !DONE.includes(j.status));
  const queuedJobs = jobs.filter((j) => j.status === "queued");
  const activeKey = activeJobs.map((j) => `${j.id}:${j.status}`).join(",");
  useEffect(() => {
    if (!activeJobs.length) return undefined;
    const timer = setInterval(() => {
      refresh()
        .then((body) => {
          const updated = body.jobs || [];
          const justDone = activeJobs.some((aj) => updated.find((u) => u.id === aj.id)?.status === "completed");
          if (justDone) onRefresh?.();
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [activeKey, activeJobs.length, refresh, onRefresh]);

  async function post(payload, key) {
    setError("");
    setBusy(key);
    try {
      const res = await fetch("/api/elevenlabs/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Aksi gagal");
      await refresh();
      return true;
    } catch (e) {
      setError(String(e.message || e));
      return false;
    } finally {
      setBusy("");
    }
  }

  async function start(e) {
    e.preventDefault();
    const payload =
      mode === "multiple"
        ? {
            action: "start",
            accounts: form.accounts,
            setActive: form.setActive,
            keepBrowserOpen: form.keepBrowserOpen,
          }
        : {
            action: "start",
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password.trim(),
            setActive: form.setActive,
            keepBrowserOpen: form.keepBrowserOpen,
          };
    const ok = await post(payload, "start");
    if (ok) {
      setForm((prev) => ({ ...prev, name: "", email: "", password: "", accounts: "" }));
    }
  }

  const canSubmit = mode === "multiple" ? Boolean(form.accounts.trim()) : Boolean(form.name.trim() || form.email.trim());
  const parsedCount =
    mode === "multiple"
      ? form.accounts
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean).length
      : form.name.trim() || form.email.trim()
        ? 1
        : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border-subtle bg-surface-2 p-3 text-xs leading-relaxed text-text-muted">
        Membuka Google Chrome di komputer ini dengan profil khusus per akun, lalu klik <span className="font-medium text-text-main">Sign in with Google</span> di
        elevenlabs.io. Anda bisa memasukkan banyak akun sekaligus; login akan dijalankan <span className="font-medium text-text-main">bergiliran (queue)</span> satu per satu.
        Setelah masuk, automation membuat API key di Settings → API Keys dan menyimpannya ke halaman ElevenLabs, lalu lanjut ke akun berikutnya di antrean.
      </div>

      {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-border bg-surface-2 p-1">
          <button
            type="button"
            onClick={() => setMode("multiple")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === "multiple" ? "bg-brand-500 text-white" : "text-text-muted hover:text-text-main"
            }`}
          >
            Multiple Akun (Queue)
          </button>
          <button
            type="button"
            onClick={() => setMode("single")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === "single" ? "bg-brand-500 text-white" : "text-text-muted hover:text-text-main"
            }`}
          >
            Satu Akun
          </button>
        </div>
        {profiles.length > 0 ? (
          <span className="text-xs text-text-muted">Profil tersimpan: {profiles.join(", ")}</span>
        ) : null}
      </div>

      <form onSubmit={start} className="flex flex-col gap-3">
        {mode === "multiple" ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="eleven-bulk-accounts" className="text-xs font-medium text-text-main">
              Daftar Akun (1 akun per baris)
            </label>
            <textarea
              id="eleven-bulk-accounts"
              rows={5}
              value={form.accounts}
              onChange={(e) => setForm({ ...form, accounts: e.target.value })}
              placeholder={"akun1@gmail.com|password123\nakun2@gmail.com|password456\neleven_3|akun3@gmail.com|password789"}
              className="w-full rounded-[10px] border border-border bg-background p-3 font-mono text-xs text-text-main placeholder:text-text-muted focus:border-brand-500/40 focus:ring-2 focus:ring-brand-500/30 focus:outline-none"
            />
            <span className="text-xs text-text-muted">
              Format per baris: <code className="rounded bg-surface-2 px-1 py-0.5">email@gmail.com|password</code>, <code className="rounded bg-surface-2 px-1 py-0.5">nama_profil|email@gmail.com|password</code>, <code className="rounded bg-surface-2 px-1 py-0.5">nama_profil|email@gmail.com</code>, atau <code className="rounded bg-surface-2 px-1 py-0.5">email@gmail.com</code>.
            </span>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Nama akun / profil (opsional)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="otomatis dari email jika kosong"
              hint="Dipakai sebagai nama profil Chrome"
            />
            <Input
              label="Email Google"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="nama@gmail.com"
              hint="Diisi otomatis di layar login Google"
            />
            <Input
              label="Password Google (opsional)"
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="••••••••"
              hint="Diisi otomatis setelah email"
            />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
              <input type="checkbox" checked={form.setActive} onChange={(e) => setForm({ ...form, setActive: e.target.checked })} />
              Jadikan akun aktif
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
              <input type="checkbox" checked={form.keepBrowserOpen} onChange={(e) => setForm({ ...form, keepBrowserOpen: e.target.checked })} />
              Biarkan Chrome terbuka setelah selesai
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {queuedJobs.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                icon="clear_all"
                loading={busy === "cancel:all_queued"}
                onClick={() => post({ action: "cancel", id: "all_queued" }, "cancel:all_queued")}
              >
                Batalkan Antrean ({queuedJobs.length})
              </Button>
            ) : null}
            <Button type="submit" size="sm" icon="queue" loading={busy === "start"} disabled={!canSubmit}>
              {activeJobs.length > 0
                ? `Tambah ke Antrean${parsedCount > 0 ? ` (${parsedCount})` : ""}`
                : `Mulai Login & Buat Key${parsedCount > 1 ? ` (${parsedCount} Akun)` : ""}`}
            </Button>
          </div>
        </div>
      </form>

      <div className="flex flex-col gap-3">
        {jobs.length === 0 ? <p className="text-sm text-text-muted">Belum ada automation yang dijalankan.</p> : null}
        {jobs.map((job) => (
          <Card key={job.id} padding="sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_VARIANT[job.status] || "info"} dot>
                {job.status === "queued" && job.queuePosition
                  ? `Antrean #${job.queuePosition}`
                  : STATUS_LABEL[job.status] || job.status}
              </Badge>
              <span className="text-sm font-medium text-text-main">{job.accountName}</span>
              {job.email ? <span className="text-xs text-text-muted">{job.email}</span> : null}
              {job.result?.keyPreview ? <span className="font-mono text-xs text-text-muted">{job.result.keyPreview}</span> : null}
              <span className="ml-auto text-xs text-text-muted">{time(job.createdAt)}</span>
              {!DONE.includes(job.status) ? (
                <Button size="sm" variant="ghost" icon="close" loading={busy === `cancel:${job.id}`} onClick={() => post({ action: "cancel", id: job.id }, `cancel:${job.id}`)}>
                  Batalkan
                </Button>
              ) : null}
            </div>
            <ol className="mt-2 max-h-48 space-y-1 overflow-y-auto text-xs">
              {job.steps.map((s, i) => (
                <li key={`${s.at}-${i}`} className="flex gap-2">
                  <span className="shrink-0 tabular-nums text-text-muted">{time(s.at)}</span>
                  <span className="text-text-main">{s.message}</span>
                </li>
              ))}
            </ol>
            {job.status === "completed" ? (
              <a href="/dashboard/elevenlabs" className="mt-2 inline-block text-sm text-brand-500 hover:underline">
                Buka halaman ElevenLabs
              </a>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
