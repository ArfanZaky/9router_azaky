"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Card, SegmentedControl } from "@/shared/components";
import FlowGeneratePanel from "./FlowGeneratePanel";
import ImagesPanel from "./ImagesPanel";
import CharactersPanel from "./CharactersPanel";
import JobsPanel from "./JobsPanel";

const TABS = [
  { value: "generate", label: "Generate", icon: "movie" },
  { value: "images", label: "Images", icon: "photo_library" },
  { value: "characters", label: "Characters", icon: "person" },
  { value: "jobs", label: "Jobs", icon: "list" },
];

export default function FlowPageClient() {
  const [price, setPrice] = useState(null);
  const [credits, setCredits] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("generate");
  const [startAsset, setStartAsset] = useState(null);

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

  function useForVideo(asset) {
    setStartAsset(asset);
    setTab("generate");
  }

  const balance = credits?.balance;
  const cap = credits?.dailyCap || 0;
  const spentToday = credits?.spentToday || 0;
  const queued = useMemo(() => jobs.filter((j) => j.status === "queued").length, [jobs]);
  const running = useMemo(() => jobs.filter((j) => j.status === "running").length, [jobs]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-10">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-text-main">Google Flow</h1>
        <p className="text-sm text-text-muted">
          Render jalan di profil Chrome yang sudah login Flow. Satu clip per akun; setiap submit memakai credits.
        </p>
      </header>

      <Card padding="sm">
        <div className="grid grid-cols-3 items-center gap-3">
          <div>
            <p className="text-xs text-text-muted">Balance</p>
            <p className="text-lg font-semibold text-text-main">{balance ?? "—"}</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Spent today</p>
            <p className="text-lg font-semibold text-text-main">
              {spentToday}
              <span className="ml-1 text-xs font-normal text-text-muted">{cap ? `of ${cap}` : "no cap"}</span>
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-text-muted">Queue</p>
              <p className="text-lg font-semibold text-text-main">
                {running}
                <span className="ml-1 text-xs font-normal text-text-muted">{queued} waiting</span>
              </p>
            </div>
            <Button variant="outline" size="sm" loading={busy} onClick={refreshCredits}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}

      <SegmentedControl options={TABS} value={tab} onChange={setTab} />

      {tab === "generate" ? (
        <FlowGeneratePanel
          price={price}
          busy={busy}
          startAsset={startAsset}
          onClearStart={() => setStartAsset(null)}
          onPickImage={() => setTab("images")}
          onQueued={() => setTab("jobs")}
          onReload={load}
        />
      ) : null}

      {tab === "images" ? <ImagesPanel onUseForVideo={useForVideo} /> : null}
      {tab === "characters" ? <CharactersPanel onUseForVideo={useForVideo} /> : null}
      {tab === "jobs" ? <JobsPanel jobs={jobs} onResume={resume} reloading={busy} /> : null}
    </div>
  );
}
