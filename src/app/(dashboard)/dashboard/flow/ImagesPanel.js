"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Card, Input } from "@/shared/components";

export default function ImagesPanel({ onUseForVideo }) {
  const [images, setImages] = useState([]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const fileRef = useRef(null);

  const load = useCallback(async (term = "") => {
    const res = await fetch(`/api/flow/images?limit=200${term ? `&q=${encodeURIComponent(term)}` : ""}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "gagal memuat library");
    setImages(body.images || []);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      load(q).catch((e) => setError(String(e.message || e)));
    }, 250);
    return () => clearTimeout(timer);
  }, [q, load]);

  async function upload(file) {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      if (name.trim()) form.set("name", name.trim());
      const res = await fetch("/api/flow/images", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "upload gagal");
      setName("");
      if (fileRef.current) fileRef.current.value = "";
      await load(q);
      setSelectedId(body.id);
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(image) {
    if (!window.confirm(`Hapus "${image.name || image.id}" dari library?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/flow/images/${image.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "hapus gagal");
      }
      if (selectedId === image.id) setSelectedId("");
      await load(q);
    } catch (e) {
      setError(String(e.message || e));
    }
  }

  const selected = images.find((image) => image.id === selectedId) || null;

  return (
    <div className="space-y-4">
      <Card title="Upload gambar" subtitle="PNG, JPG, WebP atau GIF. Maksimal 10MB.">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            upload(e.dataTransfer?.files?.[0]);
          }}
          className={`rounded-[10px] border-2 border-dashed p-6 text-center transition-colors ${
            dragging ? "border-brand-500 bg-brand-500/5" : "border-border-subtle bg-surface-2"
          }`}
        >
          <p className="text-sm text-text-main">Tarik file ke sini, atau</p>
          <div className="mt-3 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => upload(e.target.files?.[0])}
              className="max-w-full text-sm text-text-main file:mr-3 file:rounded-[8px] file:border-0 file:bg-surface-3 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-text-main"
            />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama (opsional)" className="w-full sm:w-56" />
            {busy ? <Badge variant="info" dot>uploading</Badge> : null}
          </div>
        </div>
        {error ? <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}
      </Card>

      <Card
        title="Library"
        subtitle={`${images.length} gambar`}
        action={
          <div className="w-full max-w-xs">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama…" icon="search" />
          </div>
        }
      >
        {images.length === 0 ? (
          <p className="text-sm text-text-muted">Belum ada gambar. Upload di atas.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {images.map((image) => {
              const active = image.id === selectedId;
              return (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setSelectedId(active ? "" : image.id)}
                  className={`overflow-hidden rounded-[10px] border text-left transition-all ${
                    active ? "border-brand-500 ring-2 ring-brand-500/30" : "border-border-subtle hover:border-brand-500/40"
                  }`}
                >
                  <img src={`/api/flow/images/${image.id}`} alt={image.name || "image"} className="h-32 w-full object-cover" />
                  <div className="flex items-center justify-between gap-2 p-2">
                    <span className="truncate text-xs text-text-main">{image.name || image.id.slice(0, 8)}</span>
                    {image.view ? <Badge variant="default" size="sm">{image.view}</Badge> : null}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {selected ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] border border-border-subtle bg-surface p-3">
          <span className="text-sm text-text-main">{selected.name || selected.id}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="outline" size="sm" icon="delete" onClick={() => remove(selected)}>
              Hapus
            </Button>
            <Button variant="primary" size="sm" icon="movie" onClick={() => onUseForVideo(selected)}>
              Pakai untuk video
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
