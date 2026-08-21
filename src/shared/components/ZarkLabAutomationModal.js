"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import PropTypes from "prop-types";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";
import {
  formatBrowserProxyPoolOption,
  getBrowserProxyPools,
} from "@/lib/oauth/services/bulkImportProxyOptions.js";
import { readJsonResponse } from "@/shared/utils/httpResponse.js";

const PROVIDER = "zarklab";
const DEFAULT_ENGINE = "chromium";
const ACTIVE_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function formatStep(value) {
  return String(value || "waiting").replaceAll("_", " ");
}

function formatClock(value) {
  if (!value) return "--";
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(value));
  } catch {
    return "--";
  }
}

function statusVariant(status) {
  if (status === "success" || status === "completed") return "success";
  if (status === "needs_manual") return "warning";
  if (status === "running" || status === "queued") return "info";
  if (status === "cancelled") return "default";
  return "danger";
}

async function fetchJob(jobId) {
  const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/${jobId}`, { cache: "no-store" });
  return { res, data: await readJsonResponse(res, "Failed to fetch ZarkLab job") };
}

async function fetchLatestJob() {
  const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/latest?scope=recoverable`, { cache: "no-store" });
  return { res, data: await readJsonResponse(res, "Failed to fetch latest ZarkLab job") };
}

export default function ZarkLabAutomationModal({ isOpen, onClose, onSuccess }) {
  const storageKey = `${PROVIDER}-signup-active-job`;
  const [count, setCount] = useState("1");
  const [domain, setDomain] = useState("random");
  const [proxyPoolId, setProxyPoolId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyPools, setProxyPools] = useState([]);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const active = job && ACTIVE_STATUSES.has(job.status);
  const terminal = job && TERMINAL_STATUSES.has(job.status);
  const requestedCount = Math.min(Number.parseInt(count, 10) || 1, 8);
  const startDisabled = starting || !requestedCount;

  const reset = useCallback(() => {
    setJob(null);
    setError("");
    if (typeof window !== "undefined") window.localStorage.removeItem(storageKey);
  }, [storageKey]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const loadPools = async () => {
      try {
        const res = await fetch("/api/proxy-pools?isActive=true", { cache: "no-store" });
        if (!res.ok) return;
        const data = await readJsonResponse(res, "Failed to fetch proxy pools");
        if (cancelled) return;
        setProxyPools(getBrowserProxyPools(data));
      } catch {}
    };
    void loadPools();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const restore = async () => {
      try {
        const storedJobId = typeof window !== "undefined" ? window.localStorage.getItem(storageKey) : null;
        if (storedJobId) {
          const { res, data } = await fetchJob(storedJobId);
          if (!cancelled && res.ok && data?.job && data.recoverable) {
            setJob(data.job);
            return;
          }
        }
        const latest = await fetchLatestJob();
        if (!cancelled && latest.res.ok && latest.data?.job) {
          setJob(latest.data.job);
          if (typeof window !== "undefined") window.localStorage.setItem(storageKey, latest.data.job.jobId);
        }
      } catch {}
    };
    void restore();
    return () => {
      cancelled = true;
    };
  }, [isOpen, storageKey]);

  useEffect(() => {
    if (!isOpen || !job?.jobId || terminal) return undefined;
    const interval = window.setInterval(async () => {
      try {
        const { res, data } = await fetchJob(job.jobId);
        if (res.ok && data?.job) {
          setJob(data.job);
          if (typeof window !== "undefined") window.localStorage.setItem(storageKey, data.job.jobId);
          if (TERMINAL_STATUSES.has(data.job.status)) onSuccess?.();
        }
      } catch {}
    }, 2000);
    return () => window.clearInterval(interval);
  }, [isOpen, job?.jobId, onSuccess, storageKey, terminal]);

  const startJob = async () => {
    setStarting(true);
    setError("");
    try {
      const body = {
        count,
        concurrency: Math.min(Number.parseInt(count, 10) || 1, 4),
        engine: DEFAULT_ENGINE,
        domain: domain === "random" ? "random" : domain.trim(),
      };
      if (proxyPoolId) {
        body.proxyPoolId = proxyPoolId;
      } else if (proxyUrl.trim()) {
        body.proxyUrl = proxyUrl.trim();
      }

      const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonResponse(res, "ZarkLab bulk automation failed");
      if (!res.ok || data.error) throw new Error(data.error || "ZarkLab bulk automation failed");
      setJob(data.job);
      if (data.job?.jobId && typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, data.job.jobId);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  const cancelJob = async () => {
    if (!job?.jobId) return;
    try {
      const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/${job.jobId}/cancel`, { method: "POST" });
      const data = await readJsonResponse(res, "Failed to cancel job");
      if (!res.ok) throw new Error(data.error || "Failed to cancel job");
      if (data?.job) setJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const manualAccounts = useMemo(() => (
    (job?.accounts || []).filter((account) => account.manualSessionAvailable)
  ), [job]);

  const openManual = async (workerId) => {
    if (!job?.jobId || !workerId) return;
    try {
      const res = await fetch(`/api/oauth/${PROVIDER}/bulk-import/${job.jobId}/manual/${workerId}`, { method: "POST" });
      const data = await readJsonResponse(res, "Failed to open manual browser session");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to open manual browser session");
      if (data?.job) setJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal isOpen={isOpen} title="ZarkLab AI Bulk Signup & Auto Connect" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {!job && (
          <>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-200">
              Signs up ZarkLab.ai accounts using temporary mailboxes, captures authentication session keys, and imports them automatically to 9Router media provider pool for Image (GPT Image 2, Kling O3, Seedream), Video (Veo 3.1, Kling, Seedance), and Audio (ElevenLabs, BytePlus) generation.
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium">Number of Accounts</label>
                <Input type="number" min="1" max="8" value={count} onChange={(event) => setCount(event.target.value)} />
                <p className="mt-1 text-xs text-text-muted">
                  One account = one temp email + one signup. Concurrency defaults to min(count, 4).
                </p>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">Temp Email Domain</label>
                <Input
                  type="text"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                  placeholder="random"
                />
                <p className="mt-1 text-xs text-text-muted">
                  <code className="rounded bg-background px-1">random</code> picks catchmail.io / mailistry.com / zeppost.com.
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">Network Proxy (optional)</label>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Proxy Pool</label>
                  <select
                    value={proxyPoolId}
                    onChange={(event) => {
                      setProxyPoolId(event.target.value);
                      if (event.target.value) setProxyUrl("");
                    }}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">None</option>
                    {proxyPools.map((pool) => (
                      <option key={pool.id} value={pool.id} disabled={!pool.browserCompatible}>
                        {formatBrowserProxyPoolOption(pool)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Custom Proxy URL</label>
                  <Input
                    type="text"
                    value={proxyUrl}
                    onChange={(event) => setProxyUrl(event.target.value)}
                    disabled={Boolean(proxyPoolId)}
                    placeholder="http://user:pass@host:port"
                  />
                </div>
              </div>
            </div>
          </>
        )}

        {job && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-sidebar p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant(job.status)}>{formatStep(job.status)}</Badge>
                    <span className="text-sm font-semibold">Job {job.jobId}</span>
                  </div>
                  <p className="mt-2 text-xs text-text-muted">
                    Success {job.summary?.success || 0}/{job.summary?.total || 0}; failed {job.summary?.failed || 0}; manual {job.summary?.needs_manual || 0}.
                  </p>
                </div>
                <div className="flex gap-2">
                  {active && <Button size="sm" variant="secondary" onClick={cancelJob}>Cancel</Button>}
                  {terminal && <Button size="sm" onClick={() => { reset(); onSuccess?.(); }}>Done</Button>}
                  <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-sidebar">
              <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold">Live Browser Preview</p>
                  <p className="text-xs text-text-muted">
                    {job.preview?.email || "Waiting for worker"}
                    {job.preview?.workerId ? ` | Worker ${job.preview.workerId}` : ""}
                  </p>
                </div>
                <div className="text-left text-xs text-text-muted sm:text-right">
                  <p>{formatStep(job.preview?.step)}</p>
                  <p>Updated {formatClock(job.preview?.updatedAt)}</p>
                </div>
              </div>
              <div className="relative bg-black/90">
                {job.preview?.imageData ? (
                  <Image
                    src={job.preview.imageData}
                    alt={`Live ZarkLab worker preview for ${job.preview.email || "signup"}`}
                    width={1440}
                    height={900}
                    unoptimized
                    className="h-[320px] w-full object-contain"
                  />
                ) : (
                  <div className="flex h-[320px] flex-col items-center justify-center gap-3 px-6 text-center text-slate-200">
                    <span className="material-symbols-outlined text-5xl text-primary/80">browser_updated</span>
                    <div>
                      <p className="text-base font-medium">Preview will appear when a worker opens ZarkLab</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {manualAccounts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Manual assist is needed.
                <div className="mt-3 flex flex-wrap gap-2">
                  {manualAccounts.map((account) => (
                    <Button key={`${account.workerId}-${account.email}`} size="sm" variant="secondary" onClick={() => openManual(account.workerId)}>
                      Open Worker {account.workerId}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              {(job.accounts || []).map((account) => (
                <div key={`${account.line}-${account.email}`} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs">{account.email}</span>
                    <Badge variant={statusVariant(account.status)} size="sm">{formatStep(account.status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{formatStep(account.currentStep)}</p>
                  {account.error && <p className="mt-1 text-xs text-red-400">{account.error}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

        {!job && (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Close</Button>
            <Button onClick={startJob} disabled={startDisabled}>
              {starting ? "Starting..." : `Sign Up ${requestedCount} ZarkLab Account${requestedCount === 1 ? "" : "s"}`}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

ZarkLabAutomationModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  onSuccess: PropTypes.func,
};
