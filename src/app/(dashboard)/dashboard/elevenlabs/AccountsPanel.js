"use client";

import { useState } from "react";
import { Badge, Button, Card, ConfirmModal, Input, Select, Toggle } from "@/shared/components";
import { formatDate, formatNumber, formatReset } from "./format";
import ImportExportCard from "./ImportExportCard";

const STRATEGIES = [
  { value: "active_only", label: "Hanya akun aktif" },
  { value: "fallback", label: "Fallback: akun aktif dulu, habis → lanjut ke akun berikutnya" },
  { value: "round_robin", label: "Round robin: bergiliran antar akun" },
];

export default function AccountsPanel({ accountsData, onReload }) {
  const [form, setForm] = useState({ name: "", apiKey: "", setActive: true });
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);

  const accounts = accountsData?.accounts || [];
  const strategy = accountsData?.rotationStrategy || "active_only";

  async function post(payload, key, successText) {
    setError("");
    setNotice("");
    setBusyKey(key);
    try {
      const res = await fetch("/api/elevenlabs/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Aksi gagal");
      const text = typeof successText === "function" ? successText(body) : successText;
      if (text) setNotice(text);
      await onReload();
      return body;
    } catch (e) {
      setError(String(e.message || e));
      onReload().catch(() => {});
      return null;
    } finally {
      setBusyKey("");
    }
  }

  async function addAccount(e) {
    e.preventDefault();
    const body = await post(
      { action: "add", name: form.name.trim(), apiKey: form.apiKey.trim(), setActive: form.setActive },
      "add",
      (b) =>
        b.creditCheck === "missing_user_read"
          ? `Akun '${form.name.trim()}' ditambahkan. Key ini tidak punya permission user_read, jadi saldo tidak bisa dibaca (TTS tetap jalan).`
          : `Akun '${form.name.trim()}' ditambahkan dan saldo terbaca.`
    );
    if (body) setForm({ name: "", apiKey: "", setActive: true });
  }

  async function saveConfig(patch, key, text) {
    setError("");
    setNotice("");
    setBusyKey(key);
    try {
      const res = await fetch("/api/elevenlabs/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menyimpan");
      setNotice(text);
      await onReload();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusyKey("");
    }
  }

  async function updateStrategy(value) {
    setError("");
    setNotice("");
    setBusyKey("strategy");
    try {
      const res = await fetch("/api/elevenlabs/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rotationStrategy: value }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menyimpan strategi");
      setNotice(`Strategi multi-akun: ${value}`);
      await onReload();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="space-y-4">
      {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}
      {notice ? <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-600">{notice}</div> : null}

      <Card title="Tambah API key ElevenLabs" subtitle="Key divalidasi ke ElevenLabs sebelum disimpan. Key juga otomatis dipakai provider ElevenLabs di gateway /v1/audio/speech.">
        <form onSubmit={addAccount} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Nama akun"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="contoh: eleven_utama"
              required
            />
            <Input
              label="API key"
              type="password"
              autoComplete="off"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              placeholder="sk_…"
              required
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-text-main">
              <input
                type="checkbox"
                checked={form.setActive}
                onChange={(e) => setForm({ ...form, setActive: e.target.checked })}
                className="rounded border-border"
              />
              <span>Jadikan akun aktif</span>
            </label>
            <Button type="submit" variant="primary" size="sm" icon="person_add" loading={busyKey === "add"} disabled={Boolean(busyKey) || !form.name.trim() || !form.apiKey.trim()}>
              Validasi &amp; simpan
            </Button>
          </div>
          <p className="text-xs text-text-muted">
            Agar saldo bisa dicek, aktifkan permission <span className="font-medium">User → Read</span> pada key di dashboard ElevenLabs (Developers → API Keys). Text to Speech butuh permission <span className="font-medium">Text to Speech</span> dan <span className="font-medium">Voices → Read</span>.
          </p>
        </form>
      </Card>

      <ImportExportCard accountCount={accounts.length} onReload={onReload} />

      <Card
        title={`Akun (${accounts.length})`}
        subtitle="Saldo dibaca dari /v1/user/subscription dan diperbarui otomatis setelah setiap generate"
        action={
          <Button variant="outline" size="sm" icon="refresh" loading={busyKey === "refresh_all"} disabled={Boolean(busyKey) || !accounts.length} onClick={() => post({ action: "refresh_all" }, "refresh_all", "Saldo semua akun diperbarui")}>
            Refresh semua
          </Button>
        }
      >
        <div className="mb-4 space-y-3">
          <div className="max-w-xl">
            <Select label="Strategi multi-akun" value={strategy} disabled={busyKey === "strategy"} onChange={(e) => updateStrategy(e.target.value)} options={STRATEGIES} />
          </div>
          {strategy === "fallback" ? (
            <>
              <p className="text-xs leading-relaxed text-text-muted">
                Urutan dipakai sesuai nomor di bawah. Saat akun aktif tidak cukup credit (saldo tersimpan kurang, atau ElevenLabs menjawab quota
                exceeded), request langsung dicoba di akun berikutnya, lalu berikutnya lagi, dan kembali ke awal setelah akun terakhir. Akun yang
                dinonaktifkan dilewati.
              </p>
              <Toggle
                checked={accountsData?.autoSwitchActive !== false}
                disabled={busyKey === "autoswitch"}
                onChange={(v) =>
                  saveConfig({ autoSwitchActive: v }, "autoswitch", v ? "Akun aktif akan pindah otomatis saat credit habis" : "Akun aktif tidak dipindah otomatis")
                }
                label="Pindahkan akun aktif otomatis"
                description="Akun yang berhasil melayani request menjadi akun aktif, sehingga request berikutnya tidak mencoba akun yang sudah habis lagi."
              />
            </>
          ) : null}
        </div>

        <div className="space-y-3">
          {accounts.length === 0 ? <p className="text-sm text-text-muted">Belum ada akun.</p> : null}
          {accounts.map((a, index) => {
            const c = a.credits;
            const pct = c?.characterLimit ? Math.min(100, Math.round((c.characterCount / c.characterLimit) * 100)) : 0;
            return (
              <div key={a.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold tabular-nums text-text-muted">
                    {index + 1}
                  </span>
                  <span className="font-medium text-text-main">{a.name}</span>
                  <span className="font-mono text-xs text-text-muted">{a.keyPreview}</span>
                  {a.isActive ? <Badge variant="success" size="sm" dot>Aktif</Badge> : null}
                  {!a.enabled ? <Badge variant="default" size="sm">Disabled</Badge> : null}
                  {c?.tier ? <Badge variant="info" size="sm">{c.tier}</Badge> : null}
                  {a.creditCheck === "missing_user_read" ? <Badge variant="warning" size="sm">Tanpa user_read</Badge> : null}
                  {c && c.remaining <= 0 ? <Badge variant="error" size="sm">Credit habis</Badge> : null}
                  <span className="ml-auto flex gap-1">
                    <Button
                      variant="ghost"
                      size="xs"
                      icon="arrow_upward"
                      aria-label={`Naikkan ${a.name}`}
                      disabled={Boolean(busyKey) || index === 0}
                      onClick={() => post({ action: "move", id: a.id, direction: "up" }, `move:${a.id}`, "")}
                    />
                    <Button
                      variant="ghost"
                      size="xs"
                      icon="arrow_downward"
                      aria-label={`Turunkan ${a.name}`}
                      disabled={Boolean(busyKey) || index === accounts.length - 1}
                      onClick={() => post({ action: "move", id: a.id, direction: "down" }, `move:${a.id}`, "")}
                    />
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-text-muted">Sisa credit</p>
                    {c ? (
                      <>
                        <p className="font-semibold text-text-main">
                          {formatNumber(c.remaining)} <span className="text-xs font-normal text-text-muted">/ {formatNumber(c.characterLimit)}</span>
                        </p>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </>
                    ) : (
                      <p className="text-text-muted">—</p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Terpakai hari ini (dari dashboard ini)</p>
                    <p className="font-semibold text-text-main">{formatNumber(a.spentToday)} credits</p>
                  </div>
                  <div>
                    <p className="text-xs text-text-muted">Reset kuota</p>
                    <p className="text-text-main">{c ? formatReset(c.nextResetUnix) : "—"}</p>
                    {c ? <p className="text-xs text-text-muted">dicek {formatDate(c.createdAt)}</p> : null}
                  </div>
                </div>

                {a.lastError ? <p className="mt-2 text-xs text-red-500">Error terakhir: {a.lastError}</p> : null}

                <div className="mt-3 flex flex-wrap gap-2">
                  {!a.isActive ? (
                    <Button variant="outline" size="sm" icon="check_circle" loading={busyKey === `use:${a.id}`} disabled={Boolean(busyKey)} onClick={() => post({ action: "use", id: a.id }, `use:${a.id}`, `Akun aktif: ${a.name}`)}>
                      Jadikan aktif
                    </Button>
                  ) : null}
                  <Button variant="outline" size="sm" icon="refresh" loading={busyKey === `refresh:${a.id}`} disabled={Boolean(busyKey)} onClick={() => post({ action: "refresh_credits", id: a.id }, `refresh:${a.id}`, (b) => `Saldo '${a.name}': ${formatNumber(b.snapshot?.remaining)} credits`)}>
                    Refresh saldo
                  </Button>
                  <Button variant="ghost" size="sm" icon={a.enabled ? "pause_circle" : "play_circle"} loading={busyKey === `toggle:${a.id}`} disabled={Boolean(busyKey)} onClick={() => post({ action: a.enabled ? "disable" : "enable", id: a.id }, `toggle:${a.id}`, `Akun '${a.name}' ${a.enabled ? "dinonaktifkan" : "diaktifkan"}`)}>
                    {a.enabled ? "Nonaktifkan" : "Aktifkan"}
                  </Button>
                  <Button variant="ghost" size="sm" icon="delete" disabled={Boolean(busyKey)} onClick={() => setPendingDelete(a)}>
                    Hapus
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <ConfirmModal
        isOpen={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          const a = pendingDelete;
          await post({ action: "delete", id: a.id }, `delete:${a.id}`, `Akun '${a.name}' dihapus`);
          setPendingDelete(null);
        }}
        title="Hapus akun ElevenLabs?"
        message={`API key '${pendingDelete?.name || ""}' akan dihapus dari 9router, termasuk dari provider ElevenLabs di gateway. Key di ElevenLabs sendiri tidak dicabut.`}
        confirmText="Hapus"
        cancelText="Batal"
        loading={busyKey.startsWith("delete:")}
      />
    </div>
  );
}
