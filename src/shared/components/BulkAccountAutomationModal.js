"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const DEFAULT_CONCURRENCY = 4;
// Camoufox/Firefox: one shared browser window per job; keep workers low by default
const DEFAULT_CONCURRENCY_BY_PROVIDER = {
  "grok-cli": 1,
};
const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
// Auto-retry failed emails when queue drains; stop only on all-success or user abort
const AUTO_RETRY_FAILED_PROVIDERS = new Set(["grok-cli", "kiro", "antigravity"]);
const DEFAULT_ENGINE = "chromium";
// Grok xAI rejects Chromium TLS fingerprint on device_code redeem → force Camoufox
const DEFAULT_ENGINE_BY_PROVIDER = {
  "grok-cli": "camoufox",
};
const ENGINE_OPTIONS = [
  { value: "chromium", label: "Chromium (default, fast)" },
  { value: "camoufox", label: "Camoufox (stealth Firefox, slower)" },
];
const ENGINE_OPTIONS_GROK = [
  { value: "camoufox", label: "Camoufox only (required — Chromium gets Access denied)" },
];

function describeWorkerLimit(limitedBy) {
  if (limitedBy === "ram") return "RAM";
  if (limitedBy === "cpu") return "CPU";
  return "default";
}

function formatStepLabel(value) {
  return String(value || "waiting").replaceAll("_", " ");
}

function formatClock(value) {
  if (!value) return "now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "now";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getBulkAccountEmail(line) {
  const raw = String(line || "").trim();
  if (!raw || raw.startsWith("#")) return "";
  const separator = raw.includes("|") ? "|" : raw.includes("\t") ? "\t" : ":";
  return raw.split(separator, 1)[0].trim().toLowerCase();
}

function getStatusVariant(status) {
  if (status === "success" || status === "completed") return "success";
  if (status === "needs_manual") return "warning";
  if (status === "running" || status === "queued") return "info";
  if (status === "cancelled") return "default";
  return "danger";
}

function AccountStatusBadge({ status }) {
  return (
    <Badge variant={getStatusVariant(status)} size="sm">
      {formatStepLabel(status)}
    </Badge>
  );
}

AccountStatusBadge.propTypes = {
  status: PropTypes.string,
};

async function fetchJob(provider, jobId) {
  const res = await fetch(`/api/oauth/${provider}/bulk-import/${jobId}`, { cache: "no-store" });
  const data = await readJsonResponse(res, "Failed to fetch bulk login job");
  return { res, data };
}

async function fetchLatestJob(provider, scope = "recoverable") {
  const res = await fetch(`/api/oauth/${provider}/bulk-import/latest?scope=${encodeURIComponent(scope)}`, { cache: "no-store" });
  const data = await readJsonResponse(res, "Failed to fetch latest bulk login job");
  return { res, data };
}

export default function BulkAccountAutomationModal({
  isOpen,
  onClose,
  onSuccess,
  provider,
  title,
  serviceName,
}) {
  const storageKey = `${provider}-bulk-import-active-job`;
  const completedRefreshJobsRef = useRef(new Set());
  const autoRetriedJobIdsRef = useRef(new Set());
  const autoRetryInFlightRef = useRef(false);
  // Campaign: keep original credentials + cumulative success across auto-retry rounds
  const campaignRef = useRef(null);
  const [bulkText, setBulkText] = useState("");
  const providerDefaultConcurrency = DEFAULT_CONCURRENCY_BY_PROVIDER[provider] ?? DEFAULT_CONCURRENCY;
  const providerDefaultEngine = DEFAULT_ENGINE_BY_PROVIDER[provider] ?? DEFAULT_ENGINE;
  const engineOptions = provider === "grok-cli" ? ENGINE_OPTIONS_GROK : ENGINE_OPTIONS;
  const autoRetryEnabled = AUTO_RETRY_FAILED_PROVIDERS.has(provider);
  const [concurrency, setConcurrency] = useState(String(providerDefaultConcurrency));
  const [autoConcurrency, setAutoConcurrency] = useState(true);
  const [systemSpecInfo, setSystemSpecInfo] = useState(null);
  const [systemSpecLoading, setSystemSpecLoading] = useState(false);
  const [engine, setEngine] = useState(providerDefaultEngine);
  const [proxyMode, setProxyMode] = useState("none");
  const [proxyPoolId, setProxyPoolId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyPools, setProxyPools] = useState([]);
  const [activeJob, setActiveJob] = useState(null);
  const [error, setError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [jobRestoreNotice, setJobRestoreNotice] = useState(null);
  const [campaignSummary, setCampaignSummary] = useState(null);
  const [autoRetryNotice, setAutoRetryNotice] = useState(null);

  const runningJob = activeJob && ACTIVE_JOB_STATUSES.has(activeJob.status);
  const finishedJob = activeJob && TERMINAL_JOB_STATUSES.has(activeJob.status);
  const campaignActive = Boolean(campaignSummary && !campaignSummary.stopped);
  // Treat as "still working" while auto-retry will continue failed emails
  const willAutoRetry =
    autoRetryEnabled &&
    finishedJob &&
    activeJob?.status !== "cancelled" &&
    (activeJob?.summary?.failed || 0) > 0 &&
    campaignActive;

  const groupedAccounts = useMemo(() => {
    const groups = new Map();
    for (const account of activeJob?.accounts || []) {
      const key = account.status || "unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(account);
    }
    return [...groups.entries()].map(([status, accounts]) => ({ status, accounts }));
  }, [activeJob]);

  const activityItems = useMemo(() => (
    [...(activeJob?.activity || [])].reverse()
  ), [activeJob]);

  const resetState = useCallback(() => {
    setBulkText("");
    setConcurrency(String(providerDefaultConcurrency));
    setEngine(providerDefaultEngine);
    setAutoConcurrency(true);
    setProxyMode("none");
    setProxyPoolId("");
    setProxyUrl("");
    setActiveJob(null);
    setError(null);
    setImporting(false);
    setJobRestoreNotice(null);
    setCampaignSummary(null);
    setAutoRetryNotice(null);
    campaignRef.current = null;
    autoRetryInFlightRef.current = false;
    autoRetriedJobIdsRef.current = new Set();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey, providerDefaultConcurrency, providerDefaultEngine]);

  const buildRetryLinesFromJob = useCallback((job, sourceText) => {
    const failedEmails = new Set(
      (job?.accounts || [])
        .filter((account) => String(account.status).startsWith("failed"))
        .map((account) => String(account.email || "").toLowerCase())
        .filter(Boolean)
    );
    const campaign = campaignRef.current;
    const linesSource = (campaign?.originalLines || []).length
      ? campaign.originalLines
      : String(sourceText || "")
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);

    return linesSource.filter((line) => {
      const email = getBulkAccountEmail(line);
      if (!email || !failedEmails.has(email)) return false;
      if (campaign?.successEmails?.has(email)) return false;
      return true;
    });
  }, []);

  const mergeCampaignFromJob = useCallback((job) => {
    const campaign = campaignRef.current;
    if (!campaign || !job) return null;

    const successNow = (job.accounts || [])
      .filter((a) => a.status === "success")
      .map((a) => String(a.email || "").toLowerCase())
      .filter(Boolean);
    for (const email of successNow) campaign.successEmails.add(email);

    const failedNow = (job.accounts || [])
      .filter((a) => String(a.status).startsWith("failed"))
      .map((a) => ({
        email: String(a.email || "").toLowerCase(),
        error: a.error || a.message || a.currentStep || "failed",
      }))
      .filter((a) => a.email);

    const total = campaign.originalLines.length || job.summary?.total || 0;
    const success = campaign.successEmails.size;
    const failed = failedNow.filter((a) => !campaign.successEmails.has(a.email));
    const cancelled = job.status === "cancelled" || campaign.aborted;
    const allSuccess = total > 0 && success >= total && failed.length === 0;
    const stopped = cancelled || allSuccess;

    const next = {
      round: campaign.round,
      total,
      success,
      failed: failed.length,
      failedAccounts: failed,
      successEmails: [...campaign.successEmails],
      cancelled,
      allSuccess,
      stopped,
      lastJobId: job.jobId,
      lastJobStatus: job.status,
    };
    campaignRef.current = { ...campaign, lastSummary: next };
    setCampaignSummary(next);
    return next;
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (systemSpecInfo) return;

    let cancelled = false;
    const run = async () => {
      setSystemSpecLoading(true);
      try {
        const res = await fetch("/api/system/specs", { cache: "no-store" });
        const data = await readJsonResponse(res, "Failed to detect system specs");
        if (cancelled || !data?.success) return;
        setSystemSpecInfo(data);
        setConcurrency((current) => {
          const parsed = Number.parseInt(current, 10);
          return Number.isFinite(parsed) ? current : String(data.recommended);
        });
      } catch {
        // noop
      } finally {
        if (!cancelled) setSystemSpecLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, systemSpecInfo]);

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
      } catch {
        // noop
      }
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
      setError(null);
      setJobRestoreNotice(null);
      try {
        const storedJobId = typeof window !== "undefined"
          ? window.localStorage.getItem(storageKey)
          : null;
        if (storedJobId) {
          const { res, data } = await fetchJob(provider, storedJobId);
          if (!cancelled && res.ok && data?.job && data.recoverable) {
            setActiveJob(data.job);
            setJobRestoreNotice("Restored the active bulk login job.");
            return;
          }
        }

        const latest = await fetchLatestJob(provider);
        if (!cancelled && latest.res.ok && latest.data?.job) {
          setActiveJob(latest.data.job);
          setJobRestoreNotice("Restored the latest recoverable bulk login job.");
          if (typeof window !== "undefined") {
            window.localStorage.setItem(storageKey, latest.data.job.jobId);
          }
        }
      } catch {
        if (!cancelled) setJobRestoreNotice(null);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, [isOpen, provider, storageKey]);

  useEffect(() => {
    if (!isOpen || !activeJob?.jobId || finishedJob) return undefined;

    const interval = window.setInterval(async () => {
      try {
        const { res, data } = await fetchJob(provider, activeJob.jobId);
        if (res.ok && data?.job) {
          setActiveJob((prev) => {
            // Do not let a stale server snapshot resurrect a job we already cancelled in UI
            if (
              prev?.status === "cancelled" &&
              ACTIVE_JOB_STATUSES.has(data.job.status) &&
              prev.jobId === data.job.jobId
            ) {
              return prev;
            }
            return data.job;
          });
          if (typeof window !== "undefined" && !TERMINAL_JOB_STATUSES.has(data.job.status)) {
            window.localStorage.setItem(storageKey, data.job.jobId);
          }
          if (TERMINAL_JOB_STATUSES.has(data.job.status) && !completedRefreshJobsRef.current.has(data.job.jobId)) {
            completedRefreshJobsRef.current.add(data.job.jobId);
            if (typeof window !== "undefined") {
              try {
                window.localStorage.removeItem(storageKey);
              } catch {
                /* ignore */
              }
            }
            onSuccess?.();
          }
        }
      } catch {
        // Keep the current snapshot visible; the next interval can recover.
      }
    }, 2000);

    return () => window.clearInterval(interval);
  }, [activeJob?.jobId, finishedJob, isOpen, onSuccess, provider, storageKey]);

  const startBulkJob = async (lines, { isRetryRound = false } = {}) => {
    const normalizedLines = (lines || []).map((line) => String(line).trim()).filter(Boolean);
    if (!normalizedLines.length) {
      setError("No accounts to import");
      return null;
    }

    setImporting(true);
    setError(null);
    setJobRestoreNotice(null);
    if (!isRetryRound) setAutoRetryNotice(null);

    try {
      if (!isRetryRound || !campaignRef.current) {
        campaignRef.current = {
          originalLines: normalizedLines,
          successEmails: new Set(),
          round: 1,
          aborted: false,
          lastSummary: null,
        };
        setCampaignSummary({
          round: 1,
          total: normalizedLines.length,
          success: 0,
          failed: 0,
          failedAccounts: [],
          cancelled: false,
          allSuccess: false,
          stopped: false,
        });
      } else {
        campaignRef.current.round = (campaignRef.current.round || 1) + 1;
      }

      const postBody = {
        accounts: normalizedLines,
        concurrency: autoConcurrency
          ? "auto"
          : Number.parseInt(concurrency, 10) || providerDefaultConcurrency,
        // Grok must always use Camoufox (xAI Access denied on Chromium/Node poll)
        engine: provider === "grok-cli" ? "camoufox" : engine,
      };
      if (provider === "grok-cli") {
        postBody.proxyMode = proxyMode;
        if (proxyMode === "round-robin") {
          if (!proxyPoolId) {
            throw new Error("Select a proxy pool containing at least 2 proxies for Round Robin Proxy");
          }
          postBody.proxyPoolId = proxyPoolId;
        }
      } else if (proxyPoolId) {
        postBody.proxyPoolId = proxyPoolId;
      } else if (proxyUrl.trim()) {
        postBody.proxyUrl = proxyUrl.trim();
      }
      const res = await fetch(`/api/oauth/${provider}/bulk-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(postBody),
      });
      const data = await readJsonResponse(res, "Bulk account import failed");
      if (!res.ok || data.error) {
        const invalidHint = Array.isArray(data.invalidLines) && data.invalidLines.length > 0
          ? ` Invalid lines: ${data.invalidLines.join(", ")}`
          : "";
        throw new Error((data.error || "Bulk account import failed") + invalidHint);
      }

      setActiveJob(data.job || null);
      if (data.job?.jobId) {
        completedRefreshJobsRef.current.delete(data.job.jobId);
        if (typeof window !== "undefined") window.localStorage.setItem(storageKey, data.job.jobId);
      }
      return data.job || null;
    } catch (err) {
      setError(err.message);
      return null;
    } finally {
      setImporting(false);
      autoRetryInFlightRef.current = false;
    }
  };

  const handleStartBulk = async () => {
    const lines = bulkText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (!lines.length) {
      setError("Please enter at least one email:password or email|password line");
      return;
    }

    await startBulkJob(lines, { isRetryRound: false });
  };

  const handleRetryFailed = async () => {
    const retryLines = buildRetryLinesFromJob(activeJob, bulkText);

    if (!retryLines.length) {
      setError("Failed account credentials are no longer available. Clear the job and enter them again.");
      return;
    }

    await startBulkJob(retryLines, { isRetryRound: true });
  };

  // When a job finishes: update campaign summary; auto-retry failed if queue drained
  useEffect(() => {
    if (!isOpen || !activeJob?.jobId || !finishedJob) return;
    const timer = window.setTimeout(() => {
      if (activeJob.status === "cancelled") {
        if (campaignRef.current) campaignRef.current.aborted = true;
        mergeCampaignFromJob(activeJob);
        setAutoRetryNotice("Stopped — cancelled by user.");
        return;
      }

      const summary = mergeCampaignFromJob(activeJob);
      if (!summary) return;

      if (summary.allSuccess) {
        setAutoRetryNotice(`All ${summary.success}/${summary.total} accounts succeeded.`);
        return;
      }

      if (!autoRetryEnabled || summary.failed <= 0) return;
      if (autoRetriedJobIdsRef.current.has(activeJob.jobId)) return;
      if (autoRetryInFlightRef.current || campaignRef.current?.aborted) return;

      const retryLines = buildRetryLinesFromJob(activeJob, bulkText);
      if (!retryLines.length) {
        setAutoRetryNotice(
          `Finished with ${summary.success}/${summary.total} success, ${summary.failed} failed (no credentials to retry).`
        );
        return;
      }

      autoRetriedJobIdsRef.current.add(activeJob.jobId);
      autoRetryInFlightRef.current = true;
      const nextRound = (campaignRef.current?.round || 1) + 1;
      setAutoRetryNotice(
        `Queue empty — auto-retry round ${nextRound}: ${retryLines.length} failed account${retryLines.length === 1 ? "" : "s"}…`
      );
      void startBulkJob(retryLines, { isRetryRound: true });
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startBulkJob uses latest closure state intentionally once per terminal job
  }, [
    isOpen,
    finishedJob,
    activeJob?.jobId,
    activeJob?.status,
    activeJob?.summary?.failed,
    activeJob?.summary?.success,
    autoRetryEnabled,
    bulkText,
    buildRetryLinesFromJob,
    mergeCampaignFromJob,
  ]);

  const handleCancelJob = async () => {
    if (!activeJob?.jobId) return;

    if (campaignRef.current) campaignRef.current.aborted = true;
    autoRetryInFlightRef.current = false;
    setAutoRetryNotice("Stopped — user abort (no more auto-retry).");

    // Terminal job: only stop campaign auto-retry (no server cancel needed)
    if (TERMINAL_JOB_STATUSES.has(activeJob.status) && activeJob.status !== "cancelled") {
      mergeCampaignFromJob({ ...activeJob, status: "cancelled" });
      setCampaignSummary((prev) =>
        prev
          ? { ...prev, cancelled: true, stopped: true, lastJobStatus: "cancelled" }
          : prev
      );
      return;
    }

    // Optimistic UI — do not wait for poll to flip status
    setActiveJob((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: "cancelled",
        cancelRequested: true,
        accounts: (prev.accounts || []).map((a) =>
          a.status === "queued" || a.status === "running" || a.status === "needs_manual"
            ? { ...a, status: "cancelled", currentStep: "cancelled", message: "Job cancelled" }
            : a
        ),
        summary: {
          ...(prev.summary || {}),
          running: 0,
          queued: 0,
          needs_manual: 0,
        },
      };
    });

    try {
      setError(null);
      const res = await fetch(`/api/oauth/${provider}/bulk-import/${activeJob.jobId}/cancel`, {
        method: "POST",
      });
      const data = await readJsonResponse(res, "Failed to cancel job");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to cancel job");
      if (data.job) {
        setActiveJob({ ...data.job, status: "cancelled" });
        mergeCampaignFromJob({ ...data.job, status: "cancelled" });
      }
      try {
        window.localStorage?.removeItem?.(storageKey);
      } catch {
        /* ignore */
      }
    } catch (err) {
      setError(err.message || "Cancel failed — restart server to kill stuck browsers");
    }
  };

  const handleOpenManualSession = async (workerId) => {
    if (!activeJob?.jobId || !workerId) return;

    try {
      const res = await fetch(`/api/oauth/${provider}/bulk-import/${activeJob.jobId}/manual/${workerId}`, {
        method: "POST",
      });
      const data = await readJsonResponse(res, "Failed to open manual session");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to open manual session");
      if (data.job) setActiveJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleDoneRefresh = () => {
    resetState();
    onSuccess?.();
  };

  return (
    <Modal
      isOpen={isOpen}
      title={title}
      onClose={onClose}
      size="full"
      className="max-w-[min(96vw,1320px)]"
    >
      <div className="flex flex-col gap-4">
        {!activeJob && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Bulk GSuite login runs browser workers in the background. Use one account per line: <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">email:password</code> or <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">email|password</code>. Lines starting with <code className="rounded bg-blue-100 px-1 dark:bg-blue-800">#</code> are skipped. Accounts that hit CAPTCHA, 2FA, or recovery prompts move to manual assist.
              </p>
              {provider === "grok-cli" && (
                <p className="mt-2 text-sm font-medium text-amber-800 dark:text-amber-200">
                  Grok/xAI: token redeem only works with Camoufox (same as real browser). Chromium + server-side poll get Access denied. Manual Providers OAuth works because it uses your normal browser fingerprint.
                </p>
              )}
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                Bulk Accounts <span className="text-red-500">*</span>
              </label>
              <textarea
                value={bulkText}
                onChange={(event) => setBulkText(event.target.value)}
                placeholder={"gmail1@example.com:password1\ngmail2@example.com|password2\n# comment lines are skipped"}
                className="min-h-[180px] w-full resize-y rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-text-muted">
                One account per line. Supported formats: email:password, email|password, or tab-separated.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <label className="block text-sm font-medium">Concurrent Workers</label>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-text-muted">
                    <input
                      type="checkbox"
                      checked={autoConcurrency}
                      onChange={(event) => {
                        const next = event.target.checked;
                        setAutoConcurrency(next);
                        if (next && systemSpecInfo?.recommended) {
                          setConcurrency(String(systemSpecInfo.recommended));
                        }
                      }}
                    />
                    Auto-detect by system spec
                  </label>
                </div>
                <Input
                  type="number"
                  min="1"
                  max="8"
                  value={
                    autoConcurrency
                      ? String(systemSpecInfo?.recommended ?? concurrency)
                      : concurrency
                  }
                  onChange={(event) => setConcurrency(event.target.value)}
                  disabled={autoConcurrency}
                  placeholder="4"
                />
                <p className="mt-1 text-xs text-text-muted">
                  {autoConcurrency
                    ? systemSpecLoading
                      ? "Detecting system specs..."
                      : systemSpecInfo
                        ? `Recommended ${systemSpecInfo.recommended} workers for this machine (${systemSpecInfo.specs.cpuCount}-core CPU, ${systemSpecInfo.specs.totalMemGb} GB RAM, limited by ${describeWorkerLimit(systemSpecInfo.limitedBy)}).`
                        : `Falling back to default ${DEFAULT_CONCURRENCY} workers.`
                    : "Manual mode. Allowed range: 1 to 8 workers."}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium">Browser Engine</label>
                <select
                  value={engine}
                  onChange={(event) => setEngine(event.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  disabled={provider === "grok-cli"}
                >
                  {engineOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-text-muted">
                  {provider === "grok-cli"
                    ? "Grok/xAI authorization uses Camoufox. Device-code issue and token redeem use the same direct or per-account proxy route."
                    : "Camoufox is a stealth Firefox; first run downloads ~150MB."}
                </p>
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium">
                {provider === "grok-cli" ? "Proxy Mode" : "Network Proxy (optional)"}
              </label>
              {provider === "grok-cli" && (
                <div className="mb-3 grid grid-cols-2 gap-2">
                  {[
                    { value: "none", label: "No Proxy", hint: "Direct connection" },
                    { value: "round-robin", label: "Round Robin Proxy", hint: "Different proxy per account" },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setProxyMode(option.value);
                        if (option.value === "none") {
                          setProxyPoolId("");
                          setProxyUrl("");
                        }
                      }}
                      className={`rounded-lg border px-3 py-3 text-left transition-colors ${
                        proxyMode === option.value
                          ? "border-primary bg-primary/10 text-text-main"
                          : "border-border bg-background text-text-muted hover:border-primary/40"
                      }`}
                    >
                      <span className="block text-sm font-semibold">{option.label}</span>
                      <span className="mt-1 block text-xs">{option.hint}</span>
                    </button>
                  ))}
                </div>
              )}
              {(provider !== "grok-cli" || proxyMode === "round-robin") && (
                <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">
                    {provider === "grok-cli" ? "Round Robin Proxy Pool" : "Proxy Pool"}
                  </label>
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
                      <option
                        key={pool.id}
                        value={pool.id}
                        disabled={!pool.browserCompatible || (provider === "grok-cli" && pool.proxyCount < 2)}
                      >
                        {formatBrowserProxyPoolOption(pool)}
                      </option>
                    ))}
                  </select>
                </div>
                {provider !== "grok-cli" && <div>
                  <label className="mb-1 block text-xs text-text-muted">Custom Proxy URL</label>
                  <Input
                    type="text"
                    value={proxyUrl}
                    onChange={(event) => setProxyUrl(event.target.value)}
                    disabled={Boolean(proxyPoolId)}
                    placeholder="http://user:pass@host:port"
                  />
                </div>}
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {provider === "grok-cli"
                  ? "Each account gets the next proxy URL from the selected pool. Assignment follows input order and wraps around when accounts exceed proxies."
                  : "Browsers will route login traffic through the chosen proxy. Multiple URLs in a pool or custom field rotate round-robin across workers. Relay-style pools (Vercel, Cloudflare, Deno) are excluded because they only rewrite API URLs."}
              </p>
                </>
              )}
            </div>
          </>
        )}

        {activeJob && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-xl border border-border p-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h3 className="font-semibold">{serviceName} Bulk Login Job</h3>
                <p className="text-xs text-text-muted">
                  Job ID: <span className="font-mono">{activeJob.jobId}</span>
                </p>
                <p className="text-xs text-text-muted">
                  Status: <span className="font-medium">{activeJob.status}</span> | Workers: {activeJob.concurrency}
                </p>
              </div>
              <div className="flex gap-2">
                {(runningJob || willAutoRetry) && (
                  <Button size="sm" variant="secondary" onClick={handleCancelJob} disabled={importing && !runningJob}>
                    {willAutoRetry && !runningJob ? "Stop Auto-Retry" : "Cancel Job"}
                  </Button>
                )}
                {finishedJob && !willAutoRetry && (
                  <Button size="sm" onClick={handleDoneRefresh}>
                    Done & Refresh
                  </Button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(activeJob.summary || {}).map(([label, value]) => (
                <div key={label} className="rounded-lg bg-sidebar px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-text-muted">{formatStepLabel(label)}</p>
                  <p className="text-lg font-semibold">{value}</p>
                </div>
              ))}
            </div>

            {campaignSummary && (
              <div
                className={`rounded-xl border p-4 ${
                  campaignSummary.allSuccess
                    ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
                    : campaignSummary.cancelled
                      ? "border-border bg-sidebar"
                      : "border-primary/30 bg-primary/5"
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold">
                      {campaignSummary.allSuccess
                        ? "Campaign complete — all success"
                        : campaignSummary.cancelled
                          ? "Campaign stopped — user abort"
                          : willAutoRetry || runningJob
                            ? "Campaign running"
                            : "Campaign summary"}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      Round {campaignSummary.round}
                      {autoRetryEnabled ? " · auto-retry failed when queue is empty" : ""}
                      {" · "}stops only when all succeed or you cancel
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-md bg-background/80 px-2 py-1">
                      Total <strong>{campaignSummary.total}</strong>
                    </span>
                    <span className="rounded-md bg-green-500/15 px-2 py-1 text-green-700 dark:text-green-300">
                      Success <strong>{campaignSummary.success}</strong>
                    </span>
                    <span className="rounded-md bg-red-500/15 px-2 py-1 text-red-700 dark:text-red-300">
                      Failed <strong>{campaignSummary.failed}</strong>
                    </span>
                  </div>
                </div>

                {autoRetryNotice && (
                  <p className="mt-3 text-sm text-text-main">{autoRetryNotice}</p>
                )}

                {campaignSummary.failedAccounts?.length > 0 && (
                  <div className="mt-3 max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border/60 bg-background/60 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-text-muted">Failed emails</p>
                    {campaignSummary.failedAccounts.map((item) => (
                      <div key={item.email} className="flex gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate font-medium">{item.email}</span>
                        <span className="max-w-[55%] truncate text-red-500" title={item.error}>
                          {item.error}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {campaignSummary.success > 0 && campaignSummary.allSuccess && (
                  <p className="mt-2 text-xs text-green-700 dark:text-green-300">
                    All {campaignSummary.success} account{campaignSummary.success === 1 ? "" : "s"} imported.
                  </p>
                )}
              </div>
            )}

            {activeJob.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {activeJob.error}
              </div>
            )}

            {activeJob.summary?.needs_manual > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Some accounts need manual assist. Open the worker session, finish the Google or {serviceName} prompts, and the job will keep polling.
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(300px,3fr)]">
              <div className="space-y-4">
                <div className="overflow-hidden rounded-xl border border-border bg-sidebar">
                  <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold">Live Browser Preview</p>
                      <p className="text-xs text-text-muted">
                        {activeJob.preview?.email || "Waiting for worker"}
                        {activeJob.preview?.workerId ? ` | Worker ${activeJob.preview.workerId}` : ""}
                      </p>
                    </div>
                    <div className="text-right text-xs text-text-muted">
                      <p>{formatStepLabel(activeJob.preview?.step)}</p>
                      <p>Updated {formatClock(activeJob.preview?.updatedAt)}</p>
                    </div>
                  </div>
                  <div className="relative bg-black/90">
                    {activeJob.preview?.imageData ? (
                      <Image
                        src={activeJob.preview.imageData}
                        alt={`Live worker preview for ${activeJob.preview.email || serviceName}`}
                        width={1440}
                        height={900}
                        unoptimized
                        className="h-[340px] w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-[340px] flex-col items-center justify-center gap-3 px-6 text-center text-slate-200">
                        <span className="material-symbols-outlined text-5xl text-primary/80">browser_updated</span>
                        <div>
                          <p className="text-base font-medium">Preview will appear when a worker opens Google or {serviceName}</p>
                          <p className="mt-1 text-sm text-slate-400">The job keeps running even when a screenshot is not available yet.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {groupedAccounts.map((group) => (
                  <div key={group.status} className="rounded-xl border border-border p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <AccountStatusBadge status={group.status} />
                        <p className="text-sm font-semibold capitalize">{formatStepLabel(group.status)}</p>
                      </div>
                      <p className="text-xs text-text-muted">{group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}</p>
                    </div>

                    <div className="grid gap-3 xl:grid-cols-2">
                      {group.accounts.map((account) => (
                        <div key={`${account.email}-${account.line}`} className="rounded-xl border border-border bg-background/80 p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold">{account.email}</p>
                              <p className="text-[11px] text-text-muted">
                                Line {account.line}{account.workerId ? ` | Worker ${account.workerId}` : ""} | {formatClock(account.updatedAt)}
                              </p>
                            </div>
                            <AccountStatusBadge status={account.status} />
                          </div>

                          <div className="mt-3 rounded-lg border border-border/70 bg-sidebar/70 px-3 py-2">
                            <p className="text-[11px] uppercase tracking-wide text-text-muted">Current Step</p>
                            <p className="mt-1 text-sm font-medium capitalize">{formatStepLabel(account.currentStep)}</p>
                          </div>

                          {account.error && (
                            <p className="mt-3 text-xs text-red-500">{account.error}</p>
                          )}

                          {account.manualSessionAvailable && account.workerId ? (
                            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                              <Button
                                size="sm"
                                variant={account.manualSessionOpened ? "secondary" : "primary"}
                                onClick={() => handleOpenManualSession(account.workerId)}
                              >
                                {account.manualSessionOpened ? "Re-open Manual Session" : "Open Manual Session"}
                              </Button>
                              <p className="text-[11px] text-text-muted">
                                Use this only for CAPTCHA, 2FA, or recovery prompts.
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-sidebar/70">
                <div className="border-b border-border px-4 py-3">
                  <p className="text-sm font-semibold">Live Activity Log</p>
                  <p className="text-xs text-text-muted">Worker steps update in near real time.</p>
                </div>
                <div className="max-h-[640px] space-y-3 overflow-y-auto p-4">
                  {activityItems.length === 0 && (
                    <div className="rounded-lg bg-background/70 px-3 py-4 text-sm text-text-muted">
                      Waiting for the first worker event...
                    </div>
                  )}
                  {activityItems.map((entry) => (
                    <div key={entry.id} className="rounded-lg border border-border/70 bg-background/80 px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{entry.email}</p>
                          <p className="text-[11px] text-text-muted">
                            {entry.workerId ? `Worker ${entry.workerId}` : "Waiting"} | {formatStepLabel(entry.step)}
                          </p>
                        </div>
                        <span className="shrink-0 text-[11px] text-text-muted">{formatClock(entry.at)}</span>
                      </div>
                      <p className="mt-2 text-xs text-text-muted">{entry.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {jobRestoreNotice && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
            <p className="text-sm text-amber-700 dark:text-amber-300">{jobRestoreNotice}</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex gap-2">
          {!activeJob && (
            <Button onClick={handleStartBulk} fullWidth disabled={importing || !bulkText.trim()}>
              {importing ? "Starting..." : "Start Bulk Login"}
            </Button>
          )}
          {activeJob && (!finishedJob || willAutoRetry) && (
            <Button onClick={handleCancelJob} fullWidth variant="secondary" disabled={!runningJob && !willAutoRetry}>
              {willAutoRetry && !runningJob
                ? "Stop Auto-Retry"
                : runningJob
                  ? "Cancel Running Job"
                  : "Job Stopped"}
            </Button>
          )}
          {finishedJob && !willAutoRetry && (
            <>
              {autoRetryEnabled && activeJob.summary?.failed > 0 && !campaignSummary?.allSuccess && (
                <Button onClick={handleRetryFailed} fullWidth disabled={importing}>
                  {importing ? "Retrying..." : `Retry Failed Emails (${activeJob.summary.failed})`}
                </Button>
              )}
              <Button
                onClick={handleDoneRefresh}
                fullWidth
                variant={autoRetryEnabled && activeJob.summary?.failed > 0 ? "secondary" : "primary"}
              >
                Done & Refresh Connections
              </Button>
            </>
          )}
          <Button onClick={activeJob ? resetState : onClose} variant="ghost" fullWidth disabled={willAutoRetry && importing}>
            {activeJob ? "Clear" : "Cancel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

BulkAccountAutomationModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
  provider: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  serviceName: PropTypes.string.isRequired,
};
