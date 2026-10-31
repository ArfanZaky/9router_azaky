"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, Input, ModelSelectModal } from "@/shared/components";

const VIEWS = ["front", "back", "left", "right"];
const VIEW_LABEL = { front: "Depan", back: "Belakang", left: "Kiri", right: "Kanan" };
const STATUS_VARIANT = { draft: "default", generating: "info", ready: "success", failed: "error" };

export default function CharactersPanel({ onUseForVideo }) {
  const [characters, setCharacters] = useState([]);
  const [providers, setProviders] = useState([]);
  const [aliases, setAliases] = useState({});
  const [form, setForm] = useState({ name: "", description: "", style: "" });
  const [model, setModel] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/flow/characters");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "gagal memuat karakter");
    setCharacters(body.characters || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [providersRes, aliasesRes] = await Promise.all([fetch("/api/providers"), fetch("/api/models/alias")]);
        const providersData = await providersRes.json().catch(() => ({}));
        const aliasesData = await aliasesRes.json().catch(() => ({}));
        if (cancelled) return;
        setProviders(providersData.connections || []);
        setAliases(aliasesData.aliases || {});
        await load();
      } catch (e) {
        if (!cancelled) setError(String(e.message || e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function create(event) {
    event.preventDefault();
    setError("");
    setCreating(true);
    try {
      const res = await fetch("/api/flow/characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, imageModel: model }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "gagal membuat karakter");
      setForm({ name: "", description: "", style: "" });
      await load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setCreating(false);
    }
  }

  async function generate(character, views) {
    if (!model && !character.imageModel) {
      setError("Pilih model gambar dulu sebelum generate");
      return;
    }
    setError("");
    setBusyId(character.id);
    try {
      const res = await fetch(`/api/flow/characters/${character.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ views, model: model || character.imageModel }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "generate gagal");
      if (body.errors?.length) setError(`${character.name}: ${body.errors.join(" | ")}`);
      await load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusyId("");
    }
  }

  async function remove(character) {
    if (!window.confirm(`Hapus karakter "${character.name}" beserta ${character.images?.length || 0} gambarnya?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/flow/characters/${character.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "hapus gagal");
      }
      await load();
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  return (
    <div className="space-y-4">
      <Card
        title="Karakter baru"
        subtitle="Empat sudut dibuat dari deskripsi yang sama. Semakin rinci deskripsi, semakin konsisten hasilnya."
      >
        <form onSubmit={create} className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Input label="Nama" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input
              label="Style"
              value={form.style}
              onChange={(e) => setForm({ ...form, style: e.target.value })}
              placeholder="anime, fotorealistik, 3D render…"
            />
          </div>
          <Input
            label="Deskripsi"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="perempuan 25 tahun, rambut panjang hitam, jaket kulit coklat, celana jeans"
          />
          <div className="flex flex-wrap items-end gap-2">
            <Button type="button" variant="outline" size="md" icon="image" onClick={() => setModelOpen(true)}>
              {model || "Pilih model gambar"}
            </Button>
            <Button type="submit" variant="primary" loading={creating} disabled={!form.name.trim()} className="ml-auto">
              Simpan karakter
            </Button>
          </div>
        </form>
        {error ? <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}
      </Card>

      {characters.length === 0 ? (
        <Card title="Karakter">
          <p className="text-sm text-text-muted">Belum ada karakter.</p>
        </Card>
      ) : null}

      {characters.map((character) => {
        const byView = new Map((character.images || []).map((image) => [image.view, image]));
        const generating = busyId === character.id || character.status === "generating";
        return (
          <Card
            key={character.id}
            title={character.name}
            subtitle={character.description || "tanpa deskripsi"}
            action={
              <div className="flex items-center gap-2">
                <Badge variant={STATUS_VARIANT[character.status] || "default"} dot>
                  {character.status}
                </Badge>
                <Button variant="ghost" size="sm" icon="delete" onClick={() => remove(character)} aria-label={`Hapus ${character.name}`} />
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {VIEWS.map((view) => {
                const image = byView.get(view);
                return (
                  <div key={view} className="space-y-2">
                    {image ? (
                      <>
                        <img
                          src={`/api/flow/images/${image.id}`}
                          alt={`${character.name} ${VIEW_LABEL[view]}`}
                          className="aspect-[3/4] w-full rounded-[10px] border border-border-subtle object-cover"
                        />
                        <div className="flex gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => onUseForVideo({ id: image.id, name: `${character.name} (${VIEW_LABEL[view]})` })}
                          >
                            Pakai
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon="refresh"
                            disabled={generating}
                            onClick={() => generate(character, [view])}
                            aria-label={`Regenerate ${view}`}
                          />
                        </div>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={generating}
                        onClick={() => generate(character, [view])}
                        className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-1 rounded-[10px] border-2 border-dashed border-border-subtle bg-surface-2 text-text-muted hover:border-brand-500/40 disabled:opacity-50"
                      >
                        <span className="material-symbols-outlined text-[22px]">add_photo_alternate</span>
                        <span className="text-xs">{generating ? "…" : VIEW_LABEL[view]}</span>
                      </button>
                    )}
                    <p className="text-center text-xs text-text-muted">{VIEW_LABEL[view]}</p>
                  </div>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                icon="auto_awesome"
                loading={generating}
                onClick={() => generate(character, VIEWS)}
              >
                Generate 4 sudut
              </Button>
              <span className="text-xs text-text-muted">{character.imageModel || "model belum dipilih"}</span>
              {character.error ? <span className="w-full text-xs text-red-500">{character.error}</span> : null}
            </div>
          </Card>
        );
      })}

      <ModelSelectModal
        isOpen={modelOpen}
        onClose={() => setModelOpen(false)}
        onSelect={(m) => {
          setModel(m?.value || m?.name || "");
          setModelOpen(false);
        }}
        selectedModel={model}
        activeProviders={providers}
        modelAliases={aliases}
        kindFilter="image"
        title="Pilih model gambar"
      />
    </div>
  );
}
