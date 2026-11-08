"use client";

import { useState } from "react";
import { Button, Card, Input, Select } from "@/shared/components";
import { formatNumber } from "./format";
import ProxyCard from "./ProxyCard";

export default function ConfigPanel({ configData, models, onReload }) {
  // Parent remounts with a new key whenever the saved config changes.
  const [form, setForm] = useState(() => ({ ...configData.config }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const stats = configData?.stats;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/elevenlabs/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dailyBudgetCredits: form.dailyBudgetCredits,
          minRemainingCredits: form.minRemainingCredits,
          defaultModel: form.defaultModel,
          defaultVoiceId: form.defaultVoiceId,
          defaultOutputFormat: form.defaultOutputFormat,
          defaultLanguageCode: form.defaultLanguageCode,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal menyimpan");
      setNotice("Config tersimpan");
      await onReload();
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Limit & proteksi credit" subtitle="Dicek sebelum setiap request dikirim ke ElevenLabs">
        <form onSubmit={save} className="space-y-4">
          {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}
          {notice ? <div className="rounded-lg border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-600">{notice}</div> : null}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input
              label="Limit credit harian (semua akun)"
              type="number"
              min={0}
              value={form.dailyBudgetCredits}
              onChange={(e) => set({ dailyBudgetCredits: e.target.value })}
              hint="0 = tanpa limit. Request yang melewati limit ditolak sebelum dikirim."
            />
            <Input
              label="Sisa saldo minimum per akun"
              type="number"
              min={0}
              value={form.minRemainingCredits}
              onChange={(e) => set({ minRemainingCredits: e.target.value })}
              hint="Mode fallback/round robin melewati akun yang saldonya akan turun di bawah angka ini."
            />
          </div>

          <h4 className="pt-2 text-sm font-semibold text-text-main">Default generate</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Bahasa default"
              value={form.defaultLanguageCode === "" ? "auto" : form.defaultLanguageCode ?? "id"}
              onChange={(e) => set({ defaultLanguageCode: e.target.value === "auto" ? "" : e.target.value })}
              options={[
                { value: "id", label: "Indonesia" },
                { value: "en", label: "English" },
                { value: "ms", label: "Melayu" },
                { value: "auto", label: "Otomatis (deteksi dari teks)" },
              ]}
              placeholder="Pilih bahasa"
            />
            <Select
              label="Model default"
              value={form.defaultModel}
              onChange={(e) => set({ defaultModel: e.target.value })}
              options={models.map((m) => ({ value: m.id, label: m.name }))}
            />
            <Input
              label="Voice ID default"
              value={form.defaultVoiceId}
              onChange={(e) => set({ defaultVoiceId: e.target.value.trim() })}
              hint="JBFqnCBsd6RMkjVDRZzb = George"
            />
            <Select
              label="Output default"
              value={form.defaultOutputFormat}
              onChange={(e) => set({ defaultOutputFormat: e.target.value })}
              options={configData?.outputFormats || []}
            />
          </div>
          <p className="text-xs text-text-muted">Voice settings default (stability, similarity, dll.) diambil dari config ini dan bisa diubah per request di tab Generate.</p>

          <div className="flex justify-end">
            <Button type="submit" variant="primary" icon="save" loading={saving}>
              Simpan
            </Button>
          </div>
        </form>
      </Card>

      <ProxyCard config={configData.config} onReload={onReload} />

      <Card title="Statistik" subtitle="Dari history yang tersimpan di dashboard ini">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-text-muted">Total generate</p>
            <p className="text-lg font-semibold text-text-main">{formatNumber(stats?.jobs || 0)}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Total credit terpakai</p>
            <p className="text-lg font-semibold text-text-main">{formatNumber(stats?.credits || 0)}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Gagal</p>
            <p className="text-lg font-semibold text-text-main">{formatNumber(stats?.failed || 0)}</p>
          </div>
        </div>
        {stats?.byModel?.length ? (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted">
                <th className="py-1 font-medium">Model</th>
                <th className="py-1 text-right font-medium">Generate</th>
                <th className="py-1 text-right font-medium">Credits</th>
              </tr>
            </thead>
            <tbody>
              {stats.byModel.map((r) => (
                <tr key={r.model} className="border-t border-border-subtle">
                  <td className="py-1.5 text-text-main">{r.model}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-main">{formatNumber(r.jobs)}</td>
                  <td className="py-1.5 text-right tabular-nums text-text-main">{formatNumber(r.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </div>
  );
}
