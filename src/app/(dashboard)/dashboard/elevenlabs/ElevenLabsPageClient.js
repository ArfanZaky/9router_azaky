"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card, SegmentedControl, Select } from "@/shared/components";
import GeneratePanel from "./GeneratePanel";
import HistoryPanel from "./HistoryPanel";
import AccountsPanel from "./AccountsPanel";
import ConfigPanel from "./ConfigPanel";
import { formatNumber, formatReset } from "./format";

const TABS = [
  { value: "generate", label: "Generate", icon: "record_voice_over" },
  { value: "history", label: "History", icon: "library_music" },
  { value: "accounts", label: "Accounts", icon: "manage_accounts" },
  { value: "config", label: "Config & Limits", icon: "tune" },
];

async function getJson(url) {
  const res = await fetch(url);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${url} gagal (${res.status})`);
  return body;
}

function fetchAll() {
  return Promise.all([
    getJson("/api/elevenlabs/credits"),
    getJson("/api/elevenlabs/accounts"),
    getJson("/api/elevenlabs/config"),
    getJson("/api/elevenlabs/models").catch(() => ({ models: [] })),
    getJson("/api/elevenlabs/jobs?limit=50"),
  ]);
}

export default function ElevenLabsPageClient() {
  const [credits, setCredits] = useState(null);
  const [accounts, setAccounts] = useState(null);
  const [configData, setConfigData] = useState(null);
  const [models, setModels] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("generate");
  const [prefill, setPrefill] = useState(null);

  const apply = useCallback(([c, a, cfg, m, j]) => {
    setCredits(c);
    setAccounts(a);
    setConfigData(cfg);
    setModels(m.models || []);
    setJobs(j.jobs || []);
  }, []);

  const load = useCallback(async () => apply(await fetchAll()), [apply]);

  useEffect(() => {
    let alive = true;
    fetchAll()
      .then((data) => alive && apply(data))
      .catch((e) => alive && setError(String(e.message || e)));
    return () => {
      alive = false;
    };
  }, [apply]);

  async function run(fn) {
    setError("");
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setBusy(false);
    }
  }

  const refreshCredits = () =>
    run(async () => {
      const res = await fetch("/api/elevenlabs/credits", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal refresh saldo");
    });

  const switchAccount = (id) =>
    run(async () => {
      const res = await fetch("/api/elevenlabs/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "use", id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Gagal mengganti akun");
    });

  function reuse(job) {
    setPrefill({ ...job, nonce: Date.now() });
    setTab("generate");
  }

  const list = accounts?.accounts || [];
  const activeId = accounts?.activeAccountId || "";
  const active = list.find((a) => a.id === activeId) || null;
  const snap = credits?.credits || null;
  const cap = credits?.dailyCap || 0;
  const spentToday = credits?.spentToday || 0;
  const usedPct = snap?.characterLimit ? Math.min(100, Math.round((snap.characterCount / snap.characterLimit) * 100)) : 0;
  const strategy = accounts?.rotationStrategy || "active_only";

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6 lg:p-10">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-text-main">ElevenLabs</h1>
            {strategy !== "active_only" ? <Badge variant="info">Mode: {strategy}</Badge> : null}
          </div>
          <p className="text-sm text-text-muted">
            Text to speech lewat API ElevenLabs. Mendukung banyak API key, rotasi akun, dan limit credit harian. Audio tersimpan di history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" icon="person_add" onClick={() => setTab("accounts")}>
            Kelola Akun ({list.length})
          </Button>
          <Button variant="outline" size="sm" icon="tune" onClick={() => setTab("config")}>
            Config &amp; Limit
          </Button>
        </div>
      </header>

      <Card padding="sm">
        <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <p className="text-xs text-text-muted">Akun Aktif</p>
            {list.length > 1 ? (
              <div className="mt-1">
                <Select
                  value={activeId}
                  onChange={(e) => switchAccount(e.target.value)}
                  options={list.map((a) => ({ value: a.id, label: `${a.name}${a.enabled ? "" : " (disabled)"}` }))}
                />
              </div>
            ) : (
              <div className="min-w-0">
                <p className="truncate text-base font-semibold text-text-main">{active?.name || "Belum ada akun"}</p>
                {active ? <p className="truncate font-mono text-xs text-text-muted">{active.keyPreview}</p> : null}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs text-text-muted">
              Sisa credit{snap?.tier ? ` · ${snap.tier}` : ""}
            </p>
            {snap ? (
              <>
                <p className="text-lg font-semibold text-text-main">
                  {formatNumber(snap.remaining)}
                  <span className="ml-1 text-xs font-normal text-text-muted">/ {formatNumber(snap.characterLimit)}</span>
                </p>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div
                    className={`h-full rounded-full ${usedPct >= 90 ? "bg-red-500" : usedPct >= 70 ? "bg-yellow-500" : "bg-green-500"}`}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-text-muted">Reset {formatReset(snap.nextResetUnix)}</p>
              </>
            ) : (
              <p className="text-sm text-text-muted">
                {credits?.account?.creditCheck === "missing_user_read" ? "Key tanpa permission user_read" : "—"}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-text-muted">Terpakai hari ini / Limit harian</p>
            <p className="text-lg font-semibold text-text-main">
              {formatNumber(spentToday)}
              <span className="ml-1 text-xs font-normal text-text-muted">{cap ? `/ ${formatNumber(cap)} credits` : "(tanpa limit harian)"}</span>
            </p>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs text-text-muted">Generate tersimpan</p>
              <p className="text-lg font-semibold text-text-main">{formatNumber(configData?.stats?.jobs || 0)}</p>
            </div>
            <Button variant="outline" size="sm" icon="refresh" loading={busy} disabled={!active} onClick={refreshCredits}>
              Refresh Saldo
            </Button>
          </div>
        </div>
      </Card>

      {error ? <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-500">{error}</div> : null}

      <SegmentedControl options={TABS} value={tab} onChange={setTab} />

      {tab === "generate" ? (
        <GeneratePanel
          key={prefill?.nonce || "new"}
          models={models}
          config={configData?.config}
          outputFormats={configData?.outputFormats || []}
          accounts={list}
          activeAccount={active}
          prefill={prefill}
          onReload={load}
          onOpenAccounts={() => setTab("accounts")}
        />
      ) : null}
      {tab === "history" ? <HistoryPanel jobs={jobs} onReload={load} onReuse={reuse} /> : null}
      {tab === "accounts" ? <AccountsPanel accountsData={accounts} onReload={load} /> : null}
      {tab === "config" && configData?.config ? (
        <ConfigPanel key={JSON.stringify(configData.config)} configData={configData} models={models} onReload={load} />
      ) : null}
    </div>
  );
}
