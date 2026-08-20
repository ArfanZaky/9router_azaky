"use client";

import { useCallback, useEffect, useState } from "react";
import PropTypes from "prop-types";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";

const GATEWAY_DEFAULT = "http://127.0.0.1:8787";
const API_KEY_DEFAULT = "freebuff-default-key";
const GATEWAY_DIR_DEFAULT = "F:\\project\\9router\\custom\\extensions\\freebuff2api";

const TERMINAL = new Set(["completed", "failed", "cancelled"]);
const ACTIVE = new Set(["running"]);

function statusVariant(status) {
  if (status === "ok" || status === "completed" || status === "ready") return "success";
  if (status === "running" || status === "queued" || status === "scanning") return "info";
  if (status === "warning" || status === "degraded" || status === "needs_manual") return "warning";
  return "default";
}

export default function Freebuff2ApiGatewayModal({ isOpen, onClose, onSuccess }) {
  const [baseUrl, setBaseUrl] = useState(GATEWAY_DEFAULT);
  const [apiKey, setApiKey] = useState(API_KEY_DEFAULT);
  const [gatewayDir, setGatewayDir] = useState(GATEWAY_DIR_DEFAULT);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);

  const [token, setToken] = useState("");
  const [adding, setAdding] = useState(false);

  const [batch, setBatch] = useState("");
  const [proxy, setProxy] = useState("");
  const [registerJob, setRegisterJob] = useState(null);
  const [registering, setRegistering] = useState(false);

  const fetchStatus = useCallback(async () => {
    // Defer so the effect body never calls setState synchronously (ESLint
    // react-hooks/set-state-in-effect). The interval/effect drives the refresh.
    await Promise.resolve();
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ baseUrl, apiKey });
      const res = await fetch(`/api/oauth/freebuff2api/gateway?${params}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `Failed (${res.status})`);
      setData(json);
      if (json.gatewayDir) setGatewayDir(json.gatewayDir);
    } catch (e) {
      setError(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [baseUrl, apiKey]);

  const refreshRegister = useCallback(async () => {
    try {
      const res = await fetch("/api/oauth/freebuff2api/gateway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "register-status", baseUrl, apiKey }),
      });
      const json = await res.json();
      if (json.ok && json.result) setRegisterJob(json.result);
    } catch {
      /* keep last state */
    }
  }, [baseUrl, apiKey]);

  useEffect(() => {
    if (!isOpen) return;
    // Initial load deferred out of the effect body (ESLint set-state-in-effect);
    // the interval drives the ongoing refresh.
    const t0 = window.setTimeout(() => {
      fetchStatus();
      refreshRegister();
    }, 0);
    const t = window.setInterval(() => {
      fetchStatus();
      refreshRegister();
    }, 10_000);
    return () => {
      window.clearTimeout(t0);
      window.clearInterval(t);
    };
  }, [isOpen, fetchStatus, refreshRegister]);

  const postAction = useCallback(async (body, { showError = true } = {}) => {
    const res = await fetch("/api/oauth/freebuff2api/gateway", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, baseUrl, apiKey }),
    });
    const json = await res.json();
    if (!res.ok || !json.ok) throw new Error(json.error || `Failed (${res.status})`);
    return json;
  }, [baseUrl, apiKey]);

  const startService = async () => {
    setStarting(true);
    setError("");
    try {
      const json = await postAction({ action: "start", dir: gatewayDir.trim() });
      if (json.gatewayDir) setGatewayDir(json.gatewayDir);
      await fetchStatus();
      onSuccess?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setStarting(false);
    }
  };

  const stopService = async () => {
    setStopping(true);
    setError("");
    try {
      await postAction({ action: "stop" });
      await fetchStatus();
      onSuccess?.();
    } catch (e) {
      setError(e.message);
    } finally {
      setStopping(false);
    }
  };

  const addAccount = async () => {
    if (!token.trim()) return;
    setAdding(true);
    setError("");
    try {
      await postAction({ action: "add-account", token: token.trim() });
      setToken("");
      onSuccess?.();
      await fetchStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const startRegister = async () => {
    if (!batch.trim()) return;
    setRegistering(true);
    setError("");
    try {
      await postAction({ action: "register", batch, proxy: proxy.trim() });
      setBatch("");
      await refreshRegister();
    } catch (e) {
      setError(e.message);
    } finally {
      setRegistering(false);
    }
  };

  const cancelRegister = async () => {
    setError("");
    try {
      await postAction({ action: "register-cancel" });
      await refreshRegister();
    } catch (e) {
      setError(e.message);
    }
  };

  const status = data?.status || {};
  const accounts = Array.isArray(data?.accounts) && !data.accounts.some((a) => a.error)
    ? data.accounts
    : [];
  const quotaModels = data?.quota?.models || [];
  const alive = data?.alive === true;
  const managed = data?.managed === true;

  return (
    <Modal isOpen={isOpen} title="Freebuff2API Gateway" onClose={onClose} size="lg">
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
          Manages your self-hosted <b>freebuff2api</b> gateway (server.js on :8787). It owns the
          freebuff account pool, sessions, proxies and quota. Add tokens or run GSuite auto-register
          here; chat uses the gateway via the <b>freebuff2api</b> provider.
        </div>

        {/* Gateway config */}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input label="Gateway Base URL" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={GATEWAY_DEFAULT} />
          <Input label="Gateway API Key" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={API_KEY_DEFAULT} />
          <div className="pt-6">
            <Button onClick={fetchStatus} disabled={loading} variant="secondary">
              {loading ? "Loading..." : "Refresh"}
            </Button>
          </div>
        </div>

        {/* Service control */}
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold">Service</p>
            <Badge variant={alive ? "success" : "default"}>{alive ? "running" : "stopped"}</Badge>
            {managed && <Badge variant="info">managed by 9Router</Badge>}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={gatewayDir}
              onChange={(e) => setGatewayDir(e.target.value)}
              placeholder={GATEWAY_DIR_DEFAULT}
              label="Gateway folder (server.js)"
              className="flex-1 font-mono text-xs"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="success"
              icon="play_arrow"
              onClick={startService}
              disabled={starting || alive}
              loading={starting}
            >
              Start Service
            </Button>
            <Button
              variant="danger"
              icon="stop"
              onClick={stopService}
              disabled={stopping || !alive}
              loading={stopping}
            >
              Stop Service
            </Button>
          </div>
        </div>

        {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

        {/* Status summary */}
        {data && status && !status.error && (
          <div className="rounded-xl border border-border bg-sidebar p-4">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={statusVariant(status.status)}>{status.status || "unknown"}</Badge>
              <span className="text-xs text-text-muted">
                v{status.version || "?"} · uptime {(status.uptime ?? 0) / 60 | 0}m
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-text-muted">Accounts</p>
                <p className="text-base font-semibold">{status.accounts?.active ?? 0} <span className="text-text-muted text-xs">/ {status.accounts?.total ?? 0}</span></p>
              </div>
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-text-muted">Alive</p>
                <p className="text-base font-semibold text-green-500">{status.accounts?.alive ?? 0}</p>
              </div>
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-text-muted">Unhealthy</p>
                <p className="text-base font-semibold text-red-400">{status.accounts?.unhealthy ?? 0}</p>
              </div>
              <div className="rounded-lg bg-background/60 p-2">
                <p className="text-text-muted">Sessions / Models</p>
                <p className="text-base font-semibold">{status.sessions ?? 0} / {status.models ?? 0}</p>
              </div>
            </div>
            {status.accounts?.states && Object.keys(status.accounts.states).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {Object.entries(status.accounts.states).map(([state, n]) => (
                  <Badge key={state} variant="default" size="sm">{state}: {n}</Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Add account token */}
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-sm font-semibold">Add Freebuff Account Token</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="token or token:uid"
              className="flex-1 font-mono text-xs"
            />
            <Button onClick={addAccount} disabled={adding || !token.trim()}>
              {adding ? "Adding..." : "Add to Gateway Pool"}
            </Button>
          </div>
        </div>

        {/* GSuite auto-register */}
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-semibold">GSuite Auto-Register (Playwright)</p>
            {registerJob?.running && (
              <Badge variant="info">running {registerJob.ok}/{registerJob.total}</Badge>
            )}
          </div>
          <textarea
            className="mb-2 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-text-main placeholder:text-text-muted focus:border-primary focus:outline-none"
            rows={4}
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder={"email1:password1\nemail2:password2"}
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              placeholder="proxy (optional, e.g. socks5h://host:1080)"
              className="flex-1 font-mono text-xs"
            />
            {registerJob?.running ? (
              <Button variant="danger" onClick={cancelRegister}>Cancel</Button>
            ) : (
              <Button onClick={startRegister} disabled={registering || !batch.trim()}>
                {registering ? "Starting..." : "Start Register Job"}
              </Button>
            )}
          </div>
          {registerJob && (
            <div className="mt-2 text-xs text-text-muted">
              ok {registerJob.ok} · failed {registerJob.failed} · done {registerJob.done}/{registerJob.total}
            </div>
          )}
        </div>

        {/* Quota snapshot */}
        {quotaModels.length > 0 && (
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-sm font-semibold">Quota Snapshot</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {quotaModels.slice(0, 12).map((m) => (
                <div key={m.model || m.id} className="flex items-center justify-between rounded-lg bg-background/60 px-3 py-1.5 text-xs">
                  <span className="font-mono">{m.model || m.id}</span>
                  <span className="text-text-muted">{m.recentCount ?? "?"}/{m.limit ?? "?"} sessions</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

Freebuff2ApiGatewayModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  onSuccess: PropTypes.func,
};
