"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, Input, Select } from "@/shared/components";

const STATUS_VARIANT = { queued: "default", running: "info", completed: "success", failed: "error" };

function mediaUrl(job) {
  if (!job?.mediaPath) return "";
  // Every finished clip is copied into the shared video store, so the existing
  // range-capable route serves it.
  return `/api/video-prompt/media/${job.id}`;
}

function when(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("id-ID", { hour12: false });
}

export default function FlowPageClient() {
  const [price, setPrice] = useState(null);
  const [credits, setCredits] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [mode, setMode] = useState("i2v");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("omni-flash");
  const [duration, setDuration] = useState(4);
  const [aspect, setAspect] = useState("16:9");
  const [image, setImage] = useState(null);

  const load = useCallback(async () => {
    const [p, c, j] = await Promise.all([
      fetch("/api/flow/models").then((r) => r.json()),
      fetch("/api/flow/credits").then((r) => r.json()),
      fetch("/api/flow/jobs?limit=25").then((r) => r.json()),
    ]);
    setPrice(p);
    setCredits(c);
    setJobs(j.jobs || []);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e.message || e)));
  }, [load]);

  // Poll only while something is in flight: Flow takes ~1-2 min per clip.
  const active = jobs.some((j) => j.status === "queued" || j.status === "running");
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => {
      fetch("/api/flow/jobs?limit=25")
        .then((r) => r.json())
        .then((j) => setJobs(j.jobs || []))
        .catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, [active]);

  const modelSpec = useMemo(() => price?.models?.find((m) => m.id === model), [price, model]);
  const costs = useMemo(() => (modelSpec?.costs || []).filter((c) => c.duration === duration), [modelSpec, duration]);
  const cost = costs[0]?.credits ?? null;

  useEffect(() => {
    if (!modelSpec) return;
    if (!modelSpec.durations.includes(duration)) setDuration(modelSpec.durations[0]);
  }, [modelSpec, duration]);

  async function refreshCredits() {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/flow/credits", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "refresh failed");
      await load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const form = new FormData();
      form.set("mode", mode);
      form.set("prompt", prompt);
      form.set("model", model);
      form.set("duration", String(duration));
      form.set("aspect", aspect);
      if (mode === "i2v") {
        if (!image) throw new Error("i2v needs an image: the clip starts from that frame");
        form.set("image", image);
      }
      const res = await fetch("/api/flow/jobs", { method: "POST", body: form });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "could not queue the job");
      setPrompt("");
      await load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function resume(job) {
    setError("");
    setBusy(true);
    try {
      const res = await fetch(`/api/flow/jobs/${job.id}/resume`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "resume failed");
      await load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const balance = credits?.balance;
  const cap = credits?.dailyCap || 0;
  const spentToday = credits?.spentToday || 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-text-main">Google Flow</h1>
        <p className="text-sm text-text-muted">
          Renders run in the Chrome profile that is already signed into Flow. One clip at a time; each submit spends credits.
        </p>
      </header>

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div>
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <Card title="Balance" subtitle={credits?.balanceAt ? `read ${when(credits.balanceAt)}` : "not read yet"}>
          <div className="flex items-end gap-3">
            <span className="text-2xl font-semibold text-text-main">{balance ?? "—"}</span>
            <span className="pb-1 text-xs text-text-muted">credits</span>
          </div>
          <Button variant="outline" size="sm" loading={busy} onClick={refreshCredits} className="mt-3">
            Refresh from Flow
          </Button>
        </Card>
        <Card title="Spent today" subtitle={`${credits?.jobsToday ?? 0} clip(s) completed`}>
          <div className="flex items-end gap-3">
            <span className="text-2xl font-semibold text-text-main">{spentToday}</span>
            <span className="pb-1 text-xs text-text-muted">{cap ? `of ${cap} cap` : "no daily cap"}</span>
          </div>
          <p className="mt-3 text-xs text-text-muted">
            {cap ? "Set FLOW_DAILY_BUDGET_CREDITS to change the cap." : "Set FLOW_DAILY_BUDGET_CREDITS to cap spending."}
          </p>
        </Card>
        <Card title="Queue" subtitle={`${jobs.filter((j) => j.status === "queued").length} waiting`}>
          <div className="text-2xl font-semibold text-text-main">{jobs.filter((j) => j.status === "running").length}</div>
          <p className="mt-3 text-xs text-text-muted">Serial: Flow allows one generation per account.</p>
        </Card>
      </section>

      <Card title="Price per clip" subtitle={`Host renders ${price?.hostResolution || "720p"}. Flow bills per clip, not per second.`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-text-muted">
              <tr>
                <th className="py-2">Model</th>
                <th className="py-2">Duration</th>
                <th className="py-2">Credits</th>
                <th className="py-2">Credits / second</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(price?.models || []).flatMap((m) =>
                m.costs.map((c) => (
                  <tr key={`${m.id}-${c.duration}-${c.resolution || "default"}`}>
                    <td className="py-2 text-text-main">
                      {m.name}
                      {c.resolution ? <span className="ml-2 text-xs text-text-muted">{c.resolution}</span> : null}
                    </td>
                    <td className="py-2 text-text-muted">{c.duration}s</td>
                    <td className="py-2 text-text-main">{c.credits ?? "n/a"}</td>
                    <td className="py-2 text-text-muted">{c.perSecond ?? "n/a"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Generate" subtitle={cost === null ? "combination not offered" : `${cost} credits for this clip`}>
        <form onSubmit={submit} className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" variant={mode === "i2v" ? "primary" : "outline"} size="sm" onClick={() => setMode("i2v")}>
              Image to video
            </Button>
            <Button type="button" variant={mode === "t2v" ? "primary" : "outline"} size="sm" onClick={() => setMode("t2v")}>
              Text to video
            </Button>
          </div>

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
            <label className="block text-sm text-text-main">
              <span className="mb-1 block text-xs text-text-muted">Start image</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setImage(e.target.files?.[0] || null)}
                className="w-full rounded-lg border border-border bg-surface-2 p-2 text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </label>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button type="submit" variant="primary" loading={busy} disabled={!prompt.trim() || cost === null}>
              Queue render
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Jobs" subtitle="Newest first">
        <div className="space-y-3">
          {jobs.length === 0 ? <p className="text-sm text-text-muted">No jobs yet.</p> : null}
          {jobs.map((job) => (
            <div key={job.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[job.status] || "default"} dot>
                  {job.status}
                </Badge>
                <span className="text-sm text-text-main">{job.model}</span>
                <span className="text-xs text-text-muted">
                  {job.mode} · {job.duration}s · {job.aspect} · {job.creditCost} credits
                </span>
                <span className="ml-auto text-xs text-text-muted">{when(job.createdAt)}</span>
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-text-muted">{job.prompt}</p>
              {job.step ? <p className="mt-1 text-xs text-text-subtle">{job.step}</p> : null}
              {job.error ? <p className="mt-1 text-xs text-red-500">{job.error}</p> : null}
              {job.status === "completed" && job.mediaPath ? (
                <video src={mediaUrl(job)} controls preload="metadata" className="mt-3 w-full max-w-md rounded-lg" />
              ) : null}
              {job.status === "failed" && job.mode === "i2v" ? (
                <Button variant="outline" size="sm" className="mt-2" loading={busy} onClick={() => resume(job)}>
                  Resume in Flow
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
