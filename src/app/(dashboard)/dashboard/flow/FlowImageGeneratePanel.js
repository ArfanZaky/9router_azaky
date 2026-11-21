"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Card, Select } from "@/shared/components";

const MAX_PROMPT = 4000;
const COUNTS = [1, 2, 3, 4];

export default function FlowImageGeneratePanel({ price, profiles = [], activeProfile = "", onUseForVideo }) {
  const imageModels = useMemo(() => price?.imageModels || [], [price]);
  const dailyLimits = price?.limits?.imageDailyLimits || [];

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("nano2");
  const [aspect, setAspect] = useState("16:9");
  const [count, setCount] = useState(1);
  const [profile, setProfile] = useState("");
  const [refs, setRefs] = useState([]);
  const [library, setLibrary] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState([]);

  const spec = imageModels.find((m) => m.id === model) || null;
  const aspects = spec?.aspects || ["16:9"];
  const maxRefs = spec?.maxRefs ?? 0;

  function changeModel(next) {
    setModel(next);
    const nextSpec = imageModels.find((m) => m.id === next);
    if (nextSpec && !nextSpec.aspects.includes(aspect)) setAspect(nextSpec.aspects[0]);
    if (nextSpec && refs.length > nextSpec.maxRefs) setRefs(refs.slice(0, nextSpec.maxRefs));
  }

  async function openPicker() {
    setPickerOpen((open) => !open);
    if (library) return;
    try {
      const res = await fetch("/api/flow/images?limit=60");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "gagal memuat library");
      setLibrary(body.images || []);
    } catch (e) {
      setError(String(e.message || e));
      setLibrary([]);
    }
  }

  function toggleRef(image) {
    setRefs((current) => {
      if (current.some((r) => r.id === image.id)) return current.filter((r) => r.id !== image.id);
      return current.length < maxRefs ? [...current, image] : current;
    });
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch("/api/flow/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model,
          aspect,
          count,
          ...(profile ? { profile } : {}),
          ...(refs.length ? { refAssetIds: refs.map((r) => r.id) } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `generate gagal (${res.status})`);
      setResults((current) => [...(body.images || []).map((image) => ({ ...image, dryRun: body.dryRun })), ...current]);
      // New renders land in the library, so the cached picker is stale now.
      setLibrary(null);
      setPickerOpen(false);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Generate gambar"
        subtitle={`${spec?.name || model} · ${aspect} · ${count} gambar. Tidak memakai kredit, tapi mengurangi kuota harian gambar Flow.`}
      >
        <form onSubmit={submit} className="space-y-4">
          {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="flow-image-prompt" className="text-sm font-medium text-text-main">
              Prompt<span className="ml-1 text-red-500">*</span>
            </label>
            <textarea
              id="flow-image-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={MAX_PROMPT}
              rows={4}
              required
              placeholder="Potret close-up nenek penjual jamu di pasar pagi, cahaya matahari dari samping, lensa 85mm"
              className="w-full resize-y rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 text-[16px] text-text-main placeholder-text-muted/70 transition-all focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30 sm:text-sm"
            />
            <p className="text-right text-xs text-text-muted">
              {prompt.length}/{MAX_PROMPT}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              label="Model"
              value={model}
              onChange={(e) => changeModel(e.target.value)}
              options={imageModels.map((m) => ({ value: m.id, label: m.name }))}
            />
            <Select
              label="Aspek"
              value={aspect}
              onChange={(e) => setAspect(e.target.value)}
              options={aspects.map((a) => ({ value: a, label: a }))}
            />
            <Select
              label="Jumlah"
              value={String(count)}
              onChange={(e) => setCount(Number(e.target.value))}
              options={COUNTS.map((n) => ({ value: String(n), label: `${n} gambar` }))}
            />
            <Select
              label="Akun / Profil"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              options={[
                { value: "", label: `Otomatis (${activeProfile || "Default"})` },
                ...profiles.map((p) => ({ value: p.name, label: p.name })),
              ]}
            />
          </div>

          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-text-muted">
                Gambar referensi (opsional) · {refs.length}/{maxRefs}
              </p>
              <Button type="button" variant="outline" size="sm" icon="photo_library" onClick={openPicker} className="ml-auto">
                {pickerOpen ? "Tutup library" : "Pilih dari library"}
              </Button>
            </div>

            {refs.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {refs.map((ref) => (
                  <button
                    key={ref.id}
                    type="button"
                    onClick={() => toggleRef(ref)}
                    title={`Lepas ${ref.name || ref.id}`}
                    className="relative overflow-hidden rounded-[8px] border border-brand-500"
                  >
                    <img src={`/api/flow/images/${ref.id}`} alt={ref.name || "referensi"} className="h-16 w-16 object-cover" />
                    <span className="material-symbols-outlined absolute right-0.5 top-0.5 rounded-full bg-surface text-[14px] text-text-main">close</span>
                  </button>
                ))}
              </div>
            ) : null}

            {refs.length ? (
              <p className="mt-3 text-xs text-yellow-600 dark:text-yellow-400">
                Akun dengan composer agent-only belum bisa image-to-image lewat gflow. Kalau generate ditolak, lepas referensinya lalu coba lagi.
              </p>
            ) : null}

            {pickerOpen ? (
              <div className="mt-3">
                {library === null ? (
                  <p className="text-sm text-text-muted">Memuat library…</p>
                ) : library.length === 0 ? (
                  <p className="text-sm text-text-muted">Library kosong. Upload gambar di tab Images.</p>
                ) : maxRefs === 0 ? (
                  <p className="text-sm text-text-muted">{spec?.name || model} tidak menerima gambar referensi.</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
                    {library.map((image) => {
                      const picked = refs.some((r) => r.id === image.id);
                      const full = !picked && refs.length >= maxRefs;
                      return (
                        <button
                          key={image.id}
                          type="button"
                          disabled={full}
                          onClick={() => toggleRef(image)}
                          title={image.name || image.id}
                          className={`overflow-hidden rounded-[8px] border transition-all disabled:cursor-not-allowed disabled:opacity-40 ${
                            picked ? "border-brand-500 ring-2 ring-brand-500/30" : "border-border-subtle hover:border-brand-500/40"
                          }`}
                        >
                          <img src={`/api/flow/images/${image.id}`} alt={image.name || "image"} className="h-20 w-full object-cover" />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            {submitting ? (
              <p className="text-xs text-text-muted">Flow sedang membuat gambar. Biasanya sekitar 1 menit, lebih lama kalau ada render video yang sedang jalan.</p>
            ) : null}
            <Button type="submit" variant="primary" icon="image" loading={submitting} disabled={!prompt.trim() || !spec}>
              Generate
            </Button>
          </div>
        </form>
      </Card>

      {results.length ? (
        <Card title="Hasil" subtitle="Semua hasil sudah tersimpan di tab Images.">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {results.map((image) => (
              <div key={image.id} className="overflow-hidden rounded-[10px] border border-border-subtle">
                <a href={image.url} target="_blank" rel="noreferrer">
                  <img src={image.url} alt={image.name || "hasil"} className="h-40 w-full object-cover" />
                </a>
                <div className="flex items-center justify-between gap-2 p-2">
                  <span className="truncate text-xs text-text-main">{image.name || image.id.slice(0, 8)}</span>
                  {image.dryRun ? <Badge variant="info" size="sm">dry run</Badge> : null}
                </div>
                <div className="px-2 pb-2">
                  <Button variant="outline" size="sm" icon="movie" className="w-full" onClick={() => onUseForVideo(image)}>
                    Pakai untuk video
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {dailyLimits.length ? (
        <Card title="Kuota harian gambar" subtitle="Dari Google Flow. Reset 24 jam setelah generate pertama dengan model itu.">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-text-muted">
                  <th className="py-2 pr-2">Model / Fitur</th>
                  <th className="px-2 py-2">Tanpa paket</th>
                  <th className="px-2 py-2">Plus & Pro</th>
                  <th className="py-2 pl-2">Ultra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {dailyLimits.map((row) => (
                  <tr key={row.item}>
                    <td className="py-2 pr-2 text-text-main">{row.item}</td>
                    <td className="px-2 py-2 text-text-main">{row.free || "—"}</td>
                    <td className="px-2 py-2 text-text-main">{row.plusPro || "—"}</td>
                    <td className="py-2 pl-2 text-text-main">{row.ultra || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
