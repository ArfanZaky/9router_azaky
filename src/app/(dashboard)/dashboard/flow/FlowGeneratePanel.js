"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Card, Input, Select } from "@/shared/components";

export default function FlowGeneratePanel({ price, busy, startAsset, onClearStart, onPickImage, onQueued, onReload }) {
  const [mode, setMode] = useState("i2v");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("omni-flash");
  const [duration, setDuration] = useState(4);
  const [aspect, setAspect] = useState("16:9");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const modelSpec = useMemo(() => price?.models?.find((m) => m.id === model), [price, model]);
  const cost = useMemo(() => {
    const row = (modelSpec?.costs || []).find((c) => c.duration === duration);
    return row?.credits ?? null;
  }, [modelSpec, duration]);

  useEffect(() => {
    if (!modelSpec) return;
    if (!modelSpec.durations.includes(duration)) setDuration(modelSpec.durations[0]);
    if (!modelSpec.aspects.includes(aspect)) setAspect(modelSpec.aspects[0] || "16:9");
  }, [modelSpec, duration, aspect]);

  useEffect(() => {
    if (startAsset && mode !== "i2v") setMode("i2v");
  }, [startAsset, mode]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (mode === "i2v" && !startAsset) {
        throw new Error("i2v butuh start frame: pilih gambar di tab Images atau Characters");
      }
      const res = await fetch("/api/flow/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          prompt,
          model,
          duration,
          aspect,
          ...(mode === "i2v" ? { imageAssetId: startAsset.id } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "could not queue the job");
      setPrompt("");
      onClearStart();
      await onReload();
      onQueued();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card
      title="Generate video"
      subtitle={cost === null ? "kombinasi ini tidak tersedia" : `${modelSpec?.name || model} · ${duration}s · ${aspect} = ${cost} credits`}
      action={
        <div className="flex gap-2">
          <Button type="button" variant={mode === "i2v" ? "primary" : "outline"} size="sm" onClick={() => setMode("i2v")}>
            Image to video
          </Button>
          <Button type="button" variant={mode === "t2v" ? "primary" : "outline"} size="sm" onClick={() => setMode("t2v")}>
            Text to video
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}

        <Input
          label="Prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Lima orang itu makan sambil mengucapkan hidup jokowi"
          required
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Model"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            options={(price?.models || []).map((m) => ({ value: m.id, label: m.name }))}
          />
          <Select
            label="Duration"
            value={String(duration)}
            onChange={(e) => setDuration(Number(e.target.value))}
            options={(modelSpec?.durations || [4]).map((d) => ({ value: String(d), label: `${d}s` }))}
          />
          <Select
            label="Aspect"
            value={aspect}
            onChange={(e) => setAspect(e.target.value)}
            options={(modelSpec?.aspects || ["16:9"]).map((a) => ({ value: a, label: a }))}
          />
        </div>

        {mode === "i2v" ? (
          <div className="rounded-[10px] border border-border-subtle bg-surface-2 p-3">
            <p className="mb-2 text-xs text-text-muted">Start frame</p>
            {startAsset ? (
              <div className="flex flex-wrap items-center gap-3">
                <img
                  src={`/api/flow/images/${startAsset.id}`}
                  alt={startAsset.name || "start frame"}
                  className="h-24 w-24 rounded-[10px] border border-border-subtle object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm text-text-main">{startAsset.name || startAsset.id}</p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={onPickImage}>
                      Ganti
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={onClearStart}>
                      Lepas
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-text-muted">Belum ada gambar dipilih.</p>
                <Button type="button" variant="outline" size="sm" icon="photo_library" onClick={onPickImage}>
                  Pilih dari library
                </Button>
              </div>
            )}
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="submit" variant="primary" loading={submitting || busy} disabled={!prompt.trim() || cost === null}>
            Queue render
          </Button>
        </div>
      </form>
    </Card>
  );
}
