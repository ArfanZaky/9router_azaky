"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button, ModelSelectModal } from "@/shared/components";

const SIZE_OPTIONS = ["auto", "1024x1024", "1024x1536", "1536x1024", "1024x1792", "1792x1024"];
const QUALITY_OPTIONS = ["auto", "low", "medium", "high", "standard", "hd"];
const STYLE_OPTIONS = ["", "vivid", "natural"];
const BACKGROUND_OPTIONS = ["auto", "transparent", "opaque"];
const FORMAT_OPTIONS = ["png", "jpeg", "webp"];

const PROMPT_CHIPS = [
  "watercolor mountains at sunrise",
  "neon cyberpunk city street at night",
  "cute cat wearing a tiny hat, studio photo",
  "minimal product shot of wireless earbuds",
];

const DEFAULT_PARAMS = {
  n: 1,
  size: "1024x1024",
  quality: "auto",
  style: "",
  background: "auto",
  output_format: "png",
  response_format: "b64_json",
};

function textValue(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "object") {
    if (typeof value.message === "string") return value.message;
    if (typeof value.error === "string") return value.error;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function assetUrl(asset) {
  if (!asset) return "";
  if (asset.path) return `/api/image-gen/assets/${asset.id}`;
  return asset.sourceUrl || "";
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function ImageGenPageClient() {
  const [jobs, setJobs] = useState([]);
  const [apiKey, setApiKey] = useState("");
  const [activeProviders, setActiveProviders] = useState([]);
  const [modelAliases, setModelAliases] = useState({});
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [params, setParams] = useState(DEFAULT_PARAMS);
  const [refImage, setRefImage] = useState("");
  const [refUrlDraft, setRefUrlDraft] = useState("");
  const [refDragging, setRefDragging] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState(null);
  const refFileInputRef = useRef(null);

  const filteredJobs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return jobs.filter((job) => {
      if (favoriteOnly && !job.favorite) return false;
      if (!q) return true;
      return (
        (job.prompt || "").toLowerCase().includes(q) ||
        (job.model || "").toLowerCase().includes(q)
      );
    });
  }, [jobs, search, favoriteOnly]);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/image-gen/jobs?limit=200");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to load gallery");
    setJobs(data.jobs || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const [keysRes, providersRes, aliasesRes] = await Promise.all([
          fetch("/api/keys"),
          fetch("/api/providers"),
          fetch("/api/models/alias"),
        ]);
        const keysData = await keysRes.json().catch(() => ({}));
        const providersData = await providersRes.json().catch(() => ({}));
        const aliasesData = await aliasesRes.json().catch(() => ({}));
        if (cancelled) return;
        setApiKey((keysData.keys || []).find((k) => k.isActive !== false)?.key || "");
        setActiveProviders(providersData.connections || []);
        setModelAliases(aliasesData.aliases || {});
        await loadJobs();
      } catch (e) {
        if (!cancelled) setError(textValue(e.message) || "Failed to init image gen");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadJobs]);

  const handleSelectModel = (m) => {
    setModel(m?.value || m?.name || "");
  };

  const setParam = (key, value) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  };

  const setRefFromFile = async (file) => {
    if (!file || !file.type?.startsWith("image/")) {
      setError("Reference must be an image file");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setError("Reference image too large (max 15MB)");
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    setRefImage(dataUrl);
    setRefUrlDraft("");
    setError("");
  };

  const handleRefFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await setRefFromFile(file);
  };

  const handleRefDrop = async (event) => {
    event.preventDefault();
    setRefDragging(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) await setRefFromFile(file);
  };

  const applyRefUrl = () => {
    const url = refUrlDraft.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !url.startsWith("data:image/")) {
      setError("Reference URL must start with http(s):// or data:image/");
      return;
    }
    setRefImage(url);
    setError("");
  };

  const clearRefImage = () => {
    setRefImage("");
    setRefUrlDraft("");
  };

  const useAssetAsRef = (asset) => {
    const src = assetUrl(asset);
    if (!src) return;
    setRefImage(src.startsWith("http") || src.startsWith("data:") ? src : `${window.location.origin}${src}`);
    setRefUrlDraft("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const resolveRefForRequest = async (src) => {
    if (!src) return "";
    if (src.startsWith("data:image/")) return src;
    // Convert same-origin / relative asset URLs to data URI so providers can read them
    try {
      const absolute = src.startsWith("/") ? `${window.location.origin}${src}` : src;
      const isLocal =
        absolute.includes(window.location.host) ||
        absolute.startsWith("http://127.0.0.1") ||
        absolute.startsWith("http://localhost");
      if (isLocal || absolute.includes("/api/image-gen/assets/")) {
        const res = await fetch(absolute);
        if (!res.ok) throw new Error(`Failed to load reference (${res.status})`);
        const blob = await res.blob();
        return await fileToDataUrl(blob);
      }
    } catch (e) {
      throw new Error(e.message || "Failed to resolve reference image");
    }
    return src;
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Prompt is required");
      return;
    }
    if (!model) {
      setError("Select an image model first");
      return;
    }
    if (!apiKey) {
      setError("No API key. Create one in Endpoint & Key.");
      return;
    }

    setRunning(true);
    setError("");
    try {
      let resolvedRef = "";
      if (refImage) {
        resolvedRef = await resolveRefForRequest(refImage);
        if (!resolvedRef) throw new Error("Could not read reference image");
      }

      const body = {
        model,
        prompt: prompt.trim(),
        n: Number(params.n) || 1,
        response_format: params.response_format || "b64_json",
      };
      if (params.size && params.size !== "auto") body.size = params.size;
      if (params.quality && params.quality !== "auto") body.quality = params.quality;
      if (params.style) body.style = params.style;
      if (params.background && params.background !== "auto") body.background = params.background;
      if (params.output_format) body.output_format = params.output_format;
      if (negativePrompt.trim()) body.negative_prompt = negativePrompt.trim();
      if (resolvedRef) {
        body.image = resolvedRef;
        // Also send images[] for adapters that prefer multi-ref shape
        body.images = [resolvedRef];
      }

      const res = await fetch("/api/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          textValue(data.error?.message || data.error || data.message) ||
            `HTTP ${res.status}`
        );
      }

      const providerId = model.includes("/") ? model.split("/")[0] : "";
      const saveRes = await fetch("/api/image-gen/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          negativePrompt: negativePrompt.trim(),
          model,
          providerId,
          params: {
            n: body.n,
            size: body.size,
            quality: body.quality,
            style: body.style,
            background: body.background,
            output_format: body.output_format,
            hasRefImage: !!refImage,
          },
          status: "done",
          data: data.data || [],
        }),
      });
      const job = await saveRes.json().catch(() => ({}));
      if (!saveRes.ok) throw new Error(job.error || "Failed to save job");
      setJobs((prev) => [job, ...prev]);
      if (job.assets?.[0]) {
        setLightbox({ job, asset: job.assets[0] });
      }
    } catch (e) {
      setError(textValue(e.message) || "Generation failed");
    } finally {
      setRunning(false);
    }
  };

  const handleToggleFavorite = async (job) => {
    try {
      const res = await fetch(`/api/image-gen/jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: !job.favorite }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update");
      setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, ...data } : j)));
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const handleDelete = async (job) => {
    try {
      const res = await fetch(`/api/image-gen/jobs/${job.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      setJobs((prev) => prev.filter((j) => j.id !== job.id));
      if (lightbox?.job?.id === job.id) setLightbox(null);
    } catch (e) {
      setError(textValue(e.message));
    }
  };

  const handleRerun = (job) => {
    setPrompt(job.prompt || "");
    setNegativePrompt(job.negativePrompt || "");
    setModel(job.model || "");
    setParams({
      ...DEFAULT_PARAMS,
      ...(job.params || {}),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDownload = (asset, job) => {
    const url = assetUrl(asset);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(job.prompt || "image").slice(0, 40).replace(/\s+/g, "-")}-${asset.id}.png`;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.click();
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-text-muted">
        Loading image gen…
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 h-full w-full overflow-hidden bg-background text-text-main">
      {/* Left: controls */}
      <aside className="w-full max-w-md shrink-0 border-r border-border overflow-y-auto custom-scrollbar p-4 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Image Generation</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Playground over `/v1/images/generations` · gallery in SQLite
          </p>
        </div>

        <button
          type="button"
          onClick={() => setModelModalOpen(true)}
          className="w-full flex items-center gap-2 rounded-xl border border-border bg-sidebar/50 px-3 py-2.5 text-left hover:bg-sidebar"
        >
          <span className="material-symbols-outlined text-primary">image</span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{model || "Select image model"}</p>
            <p className="text-[11px] text-text-muted">kindFilter=image</p>
          </div>
        </button>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">Prompt</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={4}
            placeholder="Describe the image…"
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-y min-h-[96px]"
          />
        </label>

        <div className="flex flex-wrap gap-1.5">
          {PROMPT_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setPrompt(chip)}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] hover:bg-sidebar"
            >
              {chip}
            </button>
          ))}
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-text-muted">Negative prompt (optional)</span>
          <input
            value={negativePrompt}
            onChange={(e) => setNegativePrompt(e.target.value)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            placeholder="blurry, watermark, text…"
          />
        </label>

        {/* Reference image — primary control for edit / img2img */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-text-muted">Reference image (optional)</span>
            {refImage ? (
              <button type="button" onClick={clearRefImage} className="text-[11px] text-red-500 hover:underline">
                Remove
              </button>
            ) : null}
          </div>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setRefDragging(true);
            }}
            onDragLeave={() => setRefDragging(false)}
            onDrop={handleRefDrop}
            className={`rounded-xl border border-dashed p-3 transition ${
              refDragging
                ? "border-primary bg-primary/10"
                : refImage
                  ? "border-border bg-sidebar/40"
                  : "border-border hover:border-primary/50 hover:bg-sidebar/30"
            }`}
          >
            {refImage ? (
              <div className="flex items-start gap-3">
                <img
                  src={refImage}
                  alt="Reference"
                  className="h-24 w-24 shrink-0 rounded-lg border border-border object-cover bg-black/10"
                />
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="text-[11px] text-text-muted">
                    Sent as <code className="font-mono bg-sidebar px-1 rounded">image</code> for edit / img2img models.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => refFileInputRef.current?.click()}
                      className="rounded-lg border border-border px-2.5 py-1 text-[11px] hover:bg-sidebar"
                    >
                      Replace file
                    </button>
                    <button
                      type="button"
                      onClick={clearRefImage}
                      className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-red-500 hover:bg-sidebar"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => refFileInputRef.current?.click()}
                className="w-full text-left"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-[28px] text-primary">add_photo_alternate</span>
                  <div>
                    <p className="text-sm font-medium">Drop image or click to upload</p>
                    <p className="text-[11px] text-text-muted mt-0.5">
                      PNG/JPG/WebP · used as prompt reference for edit-capable models
                    </p>
                  </div>
                </div>
              </button>
            )}
            <input
              ref={refFileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleRefFile}
            />
          </div>
          <div className="flex gap-2">
            <input
              value={refUrlDraft}
              onChange={(e) => setRefUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyRefUrl();
                }
              }}
              placeholder="Or paste image URL…"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={applyRefUrl}
              disabled={!refUrlDraft.trim()}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-sidebar disabled:opacity-40"
            >
              Use URL
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-text-muted space-y-1">
            <span>n</span>
            <input
              type="number"
              min={1}
              max={4}
              value={params.n}
              onChange={(e) => setParam("n", Math.min(4, Math.max(1, Number(e.target.value) || 1)))}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-main"
            />
          </label>
          <label className="text-xs text-text-muted space-y-1">
            <span>Size</span>
            <select
              value={params.size}
              onChange={(e) => setParam("size", e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-main"
            >
              {SIZE_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="text-xs text-primary flex items-center gap-1"
        >
          <span className="material-symbols-outlined text-[16px]">
            {advancedOpen ? "expand_less" : "expand_more"}
          </span>
          Advanced params
        </button>

        {advancedOpen ? (
          <div className="grid grid-cols-2 gap-2 rounded-xl border border-border p-3 bg-sidebar/30">
            <label className="text-xs text-text-muted space-y-1">
              <span>Quality</span>
              <select
                value={params.quality}
                onChange={(e) => setParam("quality", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-main"
              >
                {QUALITY_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-text-muted space-y-1">
              <span>Style</span>
              <select
                value={params.style}
                onChange={(e) => setParam("style", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-main"
              >
                {STYLE_OPTIONS.map((o) => (
                  <option key={o || "none"} value={o}>
                    {o || "(default)"}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-text-muted space-y-1">
              <span>Background</span>
              <select
                value={params.background}
                onChange={(e) => setParam("background", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-main"
              >
                {BACKGROUND_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-text-muted space-y-1">
              <span>Codec</span>
              <select
                value={params.output_format}
                onChange={(e) => setParam("output_format", e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-main"
              >
                {FORMAT_OPTIONS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}

        {!apiKey ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
            No API key.{" "}
            <Link href="/dashboard/endpoint" className="underline font-medium">
              Endpoint & Key
            </Link>
          </div>
        ) : null}

        {error ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <Button
          className="w-full"
          icon={running ? "progress_activity" : "auto_awesome"}
          onClick={handleGenerate}
          disabled={running || !prompt.trim() || !model || !apiKey}
        >
          {running ? "Generating…" : "Generate"}
        </Button>
      </aside>

      {/* Right: gallery */}
      <section className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search prompt or model…"
            className="min-w-[12rem] flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={() => setFavoriteOnly((v) => !v)}
            className={`rounded-lg border px-3 py-2 text-xs ${
              favoriteOnly
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-text-muted hover:bg-sidebar"
            }`}
          >
            Favorites
          </button>
          <Button variant="ghost" size="sm" icon="refresh" onClick={() => loadJobs().catch((e) => setError(textValue(e.message)))}>
            Refresh
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          {filteredJobs.length === 0 ? (
            <div className="flex min-h-[50vh] flex-col items-center justify-center text-center gap-3">
              <span className="material-symbols-outlined text-[36px] text-text-muted">
                photo_library
              </span>
              <p className="text-sm text-text-muted">No images yet. Generate one on the left.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
              {filteredJobs.map((job) => {
                const asset = job.assets?.[0];
                const src = assetUrl(asset);
                return (
                  <div
                    key={job.id}
                    className="group rounded-xl border border-border bg-sidebar/30 overflow-hidden flex flex-col"
                  >
                    <button
                      type="button"
                      className="relative aspect-square bg-black/20"
                      onClick={() => asset && setLightbox({ job, asset })}
                    >
                      {src ? (
                        <img src={src} alt={job.prompt} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-text-muted text-xs">
                          No asset
                        </div>
                      )}
                    </button>
                    <div className="p-2.5 space-y-1.5">
                      <p className="text-xs line-clamp-2">{job.prompt}</p>
                      <p className="text-[10px] text-text-muted truncate">{job.model}</p>
                      <div className="flex items-center gap-1 pt-1">
                        <button
                          type="button"
                          className={`material-symbols-outlined text-[16px] ${
                            job.favorite ? "text-amber-500" : "text-text-muted"
                          }`}
                          onClick={() => handleToggleFavorite(job)}
                          title="Favorite"
                        >
                          star
                        </button>
                        <button
                          type="button"
                          className="material-symbols-outlined text-[16px] text-text-muted hover:text-primary"
                          onClick={() => handleRerun(job)}
                          title="Re-run"
                        >
                          replay
                        </button>
                        <button
                          type="button"
                          className="material-symbols-outlined text-[16px] text-text-muted hover:text-primary"
                          onClick={() => asset && handleDownload(asset, job)}
                          title="Download"
                        >
                          download
                        </button>
                        <button
                          type="button"
                          className="material-symbols-outlined text-[16px] text-text-muted hover:text-primary"
                          onClick={() => navigator.clipboard?.writeText(job.prompt || "")}
                          title="Copy prompt"
                        >
                          content_copy
                        </button>
                        {asset ? (
                          <button
                            type="button"
                            className="material-symbols-outlined text-[16px] text-text-muted hover:text-primary"
                            onClick={() => useAssetAsRef(asset)}
                            title="Use as reference"
                          >
                            add_photo_alternate
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="ml-auto material-symbols-outlined text-[16px] text-text-muted hover:text-red-500"
                          onClick={() => handleDelete(job)}
                          title="Delete"
                        >
                          delete
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {lightbox ? (
        <div
          className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="max-w-4xl w-full max-h-[90vh] overflow-auto rounded-2xl bg-background border border-border p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold line-clamp-2">{lightbox.job.prompt}</p>
                <p className="text-xs text-text-muted mt-1">{lightbox.job.model}</p>
              </div>
              <button
                type="button"
                className="material-symbols-outlined text-text-muted"
                onClick={() => setLightbox(null)}
              >
                close
              </button>
            </div>
            <img
              src={assetUrl(lightbox.asset)}
              alt={lightbox.job.prompt}
              className="w-full max-h-[70vh] object-contain rounded-xl bg-black/10"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" icon="download" onClick={() => handleDownload(lightbox.asset, lightbox.job)}>
                Download
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon="add_photo_alternate"
                onClick={() => {
                  useAssetAsRef(lightbox.asset);
                  setLightbox(null);
                }}
              >
                Use as ref
              </Button>
              <Button size="sm" variant="ghost" icon="replay" onClick={() => handleRerun(lightbox.job)}>
                Re-run
              </Button>
              <Button size="sm" variant="ghost" icon="star" onClick={() => handleToggleFavorite(lightbox.job)}>
                Favorite
              </Button>
            </div>
            {lightbox.job.assets?.length > 1 ? (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {lightbox.job.assets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setLightbox({ job: lightbox.job, asset: a })}
                    className={`rounded-lg overflow-hidden border ${
                      a.id === lightbox.asset.id ? "border-primary" : "border-border"
                    }`}
                  >
                    <img src={assetUrl(a)} alt="" className="h-20 w-full object-cover" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <ModelSelectModal
        isOpen={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        onSelect={handleSelectModel}
        selectedModel={model}
        activeProviders={activeProviders}
        modelAliases={modelAliases}
        kindFilter="image"
        title="Select image model"
      />
    </div>
  );
}
