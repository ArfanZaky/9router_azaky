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

const PROVIDER = "qoder";
const DEFAULT_ENGINE = "chromium";
const ACTIVE_STATUSES = new Set(["queued", "running", "needs_manual"]);
const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function formatStep(value) {
  return String(value || "waiting").replaceAll("_", " ");
}

function statusVariant(status) {
  if (status === "success" || status === "completed") return "success";
  if (status === "needs_manual") return "warning";
  if (status === "running" || status === "queued") return "info";
  if (status === "cancelled") return "default";
  return "danger";
}

async function fetchJob(jobId) {
  const res = await fetch(`/api/oauth/${PROVIDER}/signup/${jobId}`, { cache: "no-store" });
  return { res, data: await readJsonResponse(res, "Failed to fetch Qoder signup job") };
}

async function fetchLatestJob() {
  const res = await fetch(`/api/oauth/${PROVIDER}/signup/latest?scope=recoverable`, { cache: "no-store" });
  return { res, data: await readJsonResponse(res, "Failed to fetch latest Qoder signup job") };
}

export default function QoderSignupAutomationModal({ isOpen, onClose, onSuccess }) {
  const storageKey = "qoder-signup-active-job";
  const [count, setCount] = useState("1");
  const [domain, setDomain] = useState("random");
  const [otpMode, setOtpMode] = useState("manual"); // "manual" or "auto"
  const [accountsInput, setAccountsInput] = useState("");
  const [proxyPoolId, setProxyPoolId] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [proxyPools, setProxyPools] = useState([]);
  const [visionConnections, setVisionConnections] = useState([]);
  const [visionProvider, setVisionProvider] = useState("");
  const [visionModel, setVisionModel] = useState("");
  const [showTmdBrowser, setShowTmdBrowser] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [otpInputs, setOtpInputs] = useState({});
  const [submittingOtp, setSubmittingOtp] = useState({});

  const active = job && ACTIVE_STATUSES.has(job.status);
  const terminal = job && TERMINAL_STATUSES.has(job.status);
  const requestedCount = Math.min(Number.parseInt(count, 10) || 1, 20);
  const startDisabled = starting || !requestedCount;

  const reset = useCallback(() => {
    setJob(null);
    setError("");
    setOtpInputs({});
    setSubmittingOtp({});
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
      } catch {
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
    const loadConnections = async () => {
      try {
        const res = await fetch("/api/providers", { cache: "no-store" });
        if (!res.ok) return;
        const data = await readJsonResponse(res, "Failed to fetch providers");
        if (cancelled) return;
        const conns = (data.connections || [])
          .filter((c) => c.isActive)
          .map((c) => ({ provider: c.provider, name: c.name || c.email || c.provider, connectionId: c.id }))
          .sort((a, b) => a.provider.localeCompare(b.provider));
        setVisionConnections(conns);
        if (conns.length && !visionProvider) setVisionProvider(conns[0].provider);
      } catch {
      }
    };
    void loadConnections();
    return () => {
      cancelled = true;
    };
  }, [isOpen, visionProvider]);

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
      } catch {
      }
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
      } catch {
      }
    }, 2_000);
    return () => window.clearInterval(interval);
  }, [isOpen, job?.jobId, onSuccess, storageKey, terminal]);

  const startJob = async () => {
    setStarting(true);
    setError("");
    try {
      const explicitAccounts = accountsInput
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const body = {
        count: explicitAccounts.length > 0 ? explicitAccounts.length : count,
        concurrency: 1, // sequential if manual OTP
        engine: DEFAULT_ENGINE,
        otpMode,
      };

      if (explicitAccounts.length > 0) {
        body.accountsList = explicitAccounts;
      }
      if (domain.trim()) body.domain = domain === "random" ? "random" : domain.trim();
      if (proxyPoolId) {
        body.proxyPoolId = proxyPoolId;
      } else if (proxyUrl.trim()) {
        body.proxyUrl = proxyUrl.trim();
      }
      if (visionProvider) {
        body.visionProvider = visionProvider;
        body.visionModel = visionModel.trim() || undefined;
      }
      if (showTmdBrowser) body.showTmdBrowser = true;

      const res = await fetch(`/api/oauth/${PROVIDER}/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonResponse(res, "Qoder signup automation failed");
      if (!res.ok || data.error) throw new Error(data.error || "Qoder signup automation failed");
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

  const submitOtp = async (email) => {
    if (!job?.jobId || !email) return;
    const otpCode = (otpInputs[email] || "").trim();
    if (!otpCode) return;

    setSubmittingOtp((prev) => ({ ...prev, [email]: true }));
    try {
      const res = await fetch(`/api/oauth/${PROVIDER}/signup/${job.jobId}/otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp: otpCode }),
      });
      const data = await readJsonResponse(res, "Failed to submit OTP");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to submit OTP");
      setOtpInputs((prev) => ({ ...prev, [email]: "" }));
    } catch (err) {
      alert(err.message || "Failed to submit OTP");
    } finally {
      setSubmittingOtp((prev) => ({ ...prev, [email]: false }));
    }
  };

  const cancelJob = async () => {
    if (!job?.jobId) return;
    try {
      const res = await fetch(`/api/oauth/${PROVIDER}/signup/${job.jobId}/cancel`, { method: "POST" });
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
      const res = await fetch(`/api/oauth/${PROVIDER}/signup/${job.jobId}/manual/${workerId}`, { method: "POST" });
      const data = await readJsonResponse(res, "Failed to open manual browser session");
      if (!res.ok || data.error) throw new Error(data.error || "Failed to open manual browser session");
      if (data?.job) setJob(data.job);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <Modal isOpen={isOpen} title="Qoder Bulk Signup" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        {!job && (
          <>
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
              Registers new Qoder accounts, verifies email OTP, and saves each PAT as a Qoder connection.
            </div>

            {/* OTP Mode Selection */}
            <div>
              <label className="mb-2 block text-sm font-medium">OTP Verification Mode</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setOtpMode("manual")}
                  className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
                    otpMode === "manual"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background/50 hover:bg-background/80"
                  }`}
                >
                  <span className="font-semibold text-sm">✍️ Manual OTP</span>
                  <span className="mt-1 text-xs text-text-muted">Enter OTP manually from your own email inbox.</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOtpMode("auto")}
                  className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
                    otpMode === "auto"
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background/50 hover:bg-background/80"
                  }`}
                >
                  <span className="font-semibold text-sm">🤖 Auto OTP (Catchmail.io)</span>
                  <span className="mt-1 text-xs text-text-muted">Auto-generate disposable temp mail & poll OTP automatically.</span>
                </button>
              </div>
            </div>

            {otpMode === "manual" ? (
              <div>
                <label className="mb-2 block text-sm font-medium">Email List (One per line)</label>
                <textarea
                  value={accountsInput}
                  onChange={(event) => setAccountsInput(event.target.value)}
                  placeholder="your-email@domain.com or email:password"
                  rows={4}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <p className="mt-1 text-xs text-text-muted">
                  Leave empty to auto-generate emails with domain below.
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium">Number of Accounts</label>
                  <Input type="number" min="1" max="20" value={count} onChange={(event) => setCount(event.target.value)} />
                  <p className="mt-1 text-xs text-text-muted">One account = one temp email + one signup + one PAT.</p>
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
            )}

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
              <p className="mt-1 text-xs text-text-muted">
                Used for the baxia harvest browser and captcha requests.
              </p>
            </div>

            <div className="rounded-lg border border-border bg-background/70 p-3 text-xs text-text-muted">
              <p className="font-medium text-text-main">Vision LLM for TMD captcha (optional)</p>
              <p className="mt-1">
                Qoder sometimes shows an image-matching captcha (&quot;select all images that match the description&quot;)
                that the solver can&apos;t auto-solve. Pick a vision-capable provider + model to auto-solve it.
              </p>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Provider</label>
                  <select
                    value={visionProvider}
                    onChange={(event) => setVisionProvider(event.target.value)}
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">None</option>
                    {visionConnections.map((conn) => (
                      <option key={`${conn.provider}-${conn.name}`} value={conn.provider}>
                        {conn.provider} — {conn.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-text-muted">Model</label>
                  <Input
                    type="text"
                    value={visionModel}
                    onChange={(event) => setVisionModel(event.target.value)}
                    disabled={!visionProvider}
                    placeholder="e.g. gpt-4o / claude-3-5-sonnet"
                  />
                </div>
              </div>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-text-main">
                <input
                  type="checkbox"
                  checked={showTmdBrowser}
                  onChange={(event) => setShowTmdBrowser(event.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                Show browser for manual TMD solve
              </label>
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
                    Success {job.summary?.success || 0}/{job.summary?.total || 0}; failed {job.summary?.failed || 0}; waiting {job.summary?.needs_manual || 0}.
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    Proxy: {job.proxyMode === "round-robin" ? `round-robin (${job.proxyCount || 0})` : (job.proxyMode || "none")}
                  </p>
                </div>
                <div className="flex gap-2">
                  {active && <Button size="sm" variant="secondary" onClick={cancelJob}>Cancel</Button>}
                  {terminal && <Button size="sm" onClick={() => { reset(); onSuccess?.(); }}>Done</Button>}
                  <Button size="sm" variant="ghost" onClick={reset}>Clear</Button>
                </div>
              </div>
            </div>

            {manualAccounts.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                Manual assist is needed. Open the browser worker and finish the prompt; the job will continue.
                <div className="mt-3 flex flex-wrap gap-2">
                  {manualAccounts.map((account) => (
                    <Button key={`${account.workerId}-${account.email}`} size="sm" variant="secondary" onClick={() => openManual(account.workerId)}>
                      Open Worker {account.workerId}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {(job.accounts || []).map((account) => (
                <div key={`${account.line}-${account.email}`} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-xs font-medium">{account.email}</span>
                    <Badge variant={statusVariant(account.status)} size="sm">{formatStep(account.status)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">{formatStep(account.currentStep)}</p>
                  {account.error && <p className="mt-1 text-xs text-red-400">{account.error}</p>}

                  {/* Manual OTP Input Form if waiting */}
                  {(account.status === "needs_manual" || account.currentStep === "waiting_manual_otp" || account.waitingForOtp) && (
                    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-500/10 p-3">
                      <label className="block text-xs font-semibold text-amber-500">
                        Enter 6-digit OTP code sent to {account.email}:
                      </label>
                      <div className="mt-2 flex gap-2">
                        <Input
                          type="text"
                          maxLength={6}
                          placeholder="e.g. 123456"
                          value={otpInputs[account.email] || ""}
                          onChange={(e) => setOtpInputs({ ...otpInputs, [account.email]: e.target.value })}
                          className="font-mono text-center tracking-widest text-sm uppercase"
                        />
                        <Button
                          size="sm"
                          disabled={submittingOtp[account.email] || !(otpInputs[account.email] || "").trim()}
                          onClick={() => submitOtp(account.email)}
                        >
                          {submittingOtp[account.email] ? "Submitting..." : "Submit OTP"}
                        </Button>
                      </div>
                    </div>
                  )}
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
              {starting ? "Starting..." : `Sign Up Qoder Account`}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

QoderSignupAutomationModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  onSuccess: PropTypes.func,
};
