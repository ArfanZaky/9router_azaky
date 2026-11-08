"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, SegmentedControl, Select } from "@/shared/components";
import FlowGeneratePanel from "./FlowGeneratePanel";
import ImagesPanel from "./ImagesPanel";
import CharactersPanel from "./CharactersPanel";
import JobsPanel from "./JobsPanel";
import AccountsPanel from "./AccountsPanel";
import ConfigPanel from "./ConfigPanel";

const TABS = [
  { value: "generate", label: "Generate", icon: "movie" },
  { value: "images", label: "Images", icon: "photo_library" },
  { value: "characters", label: "Characters", icon: "person" },
  { value: "jobs", label: "Jobs", icon: "list" },
  { value: "accounts", label: "Accounts", icon: "manage_accounts" },
  { value: "config", label: "Config & Limits", icon: "tune" },
];

export default function FlowPageClient() {
  const [price, setPrice] = useState(null);
  const [credits, setCredits] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [accounts, setAccounts] = useState(null);
  const [configData, setConfigData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("generate");
  const [startAsset, setStartAsset] = useState(null);

  const load = useCallback(async () => {
    const [p, c, j, a, cfg] = await Promise.all([
      fetch("/api/flow/models").then((r) => r.json()),
      fetch("/api/flow/credits").then((r) => r.json()),
      fetch("/api/flow/jobs?limit=25").then((r) => r.json()),
      fetch("/api/flow/accounts").then((r) => r.json()).catch(() => ({ profiles: [] })),
      fetch("/api/flow/config").then((r) => r.json()).catch(() => ({})),
    ]);
    setPrice(p);
    setCredits(c);
    setJobs(j.jobs || []);
    setAccounts(a);
    setConfigData(cfg);
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

  async function switchAccount(profileName) {
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/flow/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "use", profile: profileName }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "gagal mengganti akun");
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
  const profiles = accounts?.profiles || [];
  const activeProfile = accounts?.activeProfile || credits?.profile || "";
  const activeAccountObj = profiles.find((p) => p.name === activeProfile) || profiles.find((p) => p.is_default) || null;
  const queued = useMemo(() => jobs.filter((j) => j.status === "queued").length, [jobs]);
  const running = useMemo(() => jobs.filter((j) => j.status === "running").length, [jobs]);

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-text-main">Google Flow</h1>
            {configData?.config?.dryRun ? <Badge variant="warning">Dry Run</Badge> : null}
            {accounts?.rotationStrategy && accounts.rotationStrategy !== "active_only" ? (
              <Badge variant="info">Mode: {accounts.rotationStrategy}</Badge>
            ) : null}
          </div>
          <p className="text-sm text-text-muted">
            Render berjalan pada profil Chrome yang sudah login Flow. Satu clip per akun secara serial; mendukung multi-akun &amp; proteksi budget kredit.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" icon="person_add" onClick={() => setTab("accounts")}>
            Kelola Akun ({profiles.length})
          </Button>
          <Button variant="outline" size="sm" icon="tune" onClick={() => setTab("config")}>
            Config &amp; Limit
          </Button>
        </div>
      </header>

      <Card padding="sm">
        <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-text-muted">Akun Aktif</p>
            {profiles.length > 1 ? (
              <div className="mt-1">
                <Select
                  value={activeProfile}
                  onChange={(e) => switchAccount(e.target.value)}
                  options={profiles.map((p) => ({
                    value: p.name,
                    label: `${p.name}${p.google_account ? ` (${p.google_account})` : ""}`,
                  }))}
                />
              </div>
            ) : (
              <div>
                <p className="truncate text-base font-semibold text-text-main">
                  {activeAccountObj?.name || activeProfile || "Belum ada akun"}
                </p>
                {activeAccountObj?.google_account ? (
                  <p className="truncate text-xs text-text-muted">{activeAccountObj.google_account}</p>
                ) : null}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs text-text-muted">Balance ({activeProfile || "default"})</p>
            <p className="text-lg font-semibold text-text-main">{balance ?? "—"} <span className="text-xs font-normal text-text-muted">credits</span></p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Spent today / Daily Limit</p>
            <p className="text-lg font-semibold text-text-main">
              {spentToday}
              <span className="ml-1 text-xs font-normal text-text-muted">{cap ? `/ ${cap} credits` : "(tanpa limit harian)"}</span>
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
            <Button variant="outline" size="sm" icon="refresh" loading={busy} onClick={refreshCredits}>
              Refresh Saldo
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
          profiles={profiles}
          activeProfile={activeProfile}
        />
      ) : null}

      {tab === "images" ? <ImagesPanel onUseForVideo={useForVideo} /> : null}
      {tab === "characters" ? <CharactersPanel onUseForVideo={useForVideo} /> : null}
      {tab === "jobs" ? <JobsPanel jobs={jobs} onResume={resume} reloading={busy} /> : null}
      {tab === "accounts" ? (
        <AccountsPanel accountsData={accounts} creditsData={credits} onReload={load} />
      ) : null}
      {tab === "config" ? (
        <ConfigPanel
          configData={configData}
          accountsData={accounts}
          creditsData={credits}
          priceData={price}
          onReload={load}
        />
      ) : null}
    </div>
  );
}
