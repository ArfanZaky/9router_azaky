"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Badge from "./Badge";
import Button from "./Button";
import Input from "./Input";
import Modal from "./Modal";
import { readJsonResponse } from "@/shared/utils/httpResponse.js";

function fmtCredits(value) {
  const n = Number(value) || 0;
  return Number.isFinite(n) ? String(n) : "--";
}

function statusVariant(status) {
  if (status === "success") return "success";
  if (status === "claimed") return "success";
  if (status === "not_eligible" || status === "not_pro") return "warning";
  return "default";
}

function ResultRow({ label, value, mono }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-2 text-sm last:border-0">
      <span className="text-text-muted">{label}</span>
      <span className={`text-right ${mono ? "font-mono text-xs break-all" : "text-text-main"}`}>{value || "--"}</span>
    </div>
  );
}

ResultRow.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node,
  mono: PropTypes.bool,
};

function qwen38Label(qwen38) {
  if (!qwen38) return null;
  if (qwen38.claimed === true) return "claimed (800 calls)";
  if (qwen38.alreadyClaimed) return "claimed (800 calls)";
  if (qwen38.canClaim) return "available — click to claim";
  if (qwen38.error) return `no (${qwen38.error})`;
  return qwen38.reason || "not eligible";
}

function renderQwen38Row(qwen38) {
  if (!qwen38) return null;
  const ok = qwen38.claimed === true || qwen38.alreadyClaimed || qwen38.ok;
  return (
    <ResultRow
      label="Qwen38 800 calls"
      value={`${ok ? "yes" : "no"} — ${qwen38Label(qwen38)}`}
    />
  );
}

export default function QoderGrantModal({ isOpen, onClose, onSuccess }) {
  const [mode, setMode] = useState("grant");
  const [pat, setPat] = useState("");
  const [proxyUrl, setProxyUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const reset = () => {
    setResult(null);
    setError("");
  };

  const run = async () => {
    if (!pat.trim()) {
      setError("Enter a Qoder PAT (pt-...).");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const endpoint = mode === "grant" ? "/api/oauth/qoder/grant" : "/api/oauth/qoder/grant/check";
      const body = mode === "grant" ? { pat: pat.trim(), proxyUrl: proxyUrl.trim() || null } : { pat: pat.trim() };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJsonResponse(res, `Qoder ${mode} failed`);
      if (!res.ok || data.error) throw new Error(data.error || `Qoder ${mode} failed`);
      setResult(data);
      if (data.proTrialOk) onSuccess?.();
    } catch (err) {
      setError(err.message || `Qoder ${mode} failed`);
    } finally {
      setLoading(false);
    }
  };

  const claimQwen38 = async () => {
    if (!pat.trim()) {
      setError("Enter a Qoder PAT (pt-...).");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/oauth/qoder/grant/claim-qwen38", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: pat.trim(), proxyUrl: proxyUrl.trim() || null }),
      });
      const data = await readJsonResponse(res, "Qwen38 claim failed");
      if (!res.ok || data.error) throw new Error(data.error || "Qwen38 claim failed");
      setResult((prev) => ({ ...(prev || {}), qwen38: data }));
      onSuccess?.();
    } catch (err) {
      setError(err.message || "Qwen38 claim failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Qoder Pro Trial Grant / Status" size="md">
      <div className="space-y-4">
        <div className="grid grid-cols-2 rounded-[10px] bg-surface-2 p-1">
          {[["grant", "Grant Pro Trial"], ["check", "Check Status"]].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setMode(value); reset(); }}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${mode === value ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          {mode === "grant"
            ? "Generates a fresh P1g machine token via the local Qoder harness (runtime-info + sgsdk.dll) and binds a Pro Trial grant through the Cosy status endpoint. Requires the harness-win folder and a running solver sidecar."
            : "Reads the account plan tier, user type, and credit quota for the given PAT."}
        </div>

        <Input
          label="Qoder PAT"
          type="password"
          value={pat}
          onChange={(event) => setPat(event.target.value)}
          placeholder="pt-..."
          required
        />
        {mode === "grant" && (
          <Input
            label="Proxy URL (optional)"
            type="text"
            value={proxyUrl}
            onChange={(event) => setProxyUrl(event.target.value)}
            placeholder="http://user:pass@host:port"
          />
        )}

        {error && <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</div>}

        {result && (
          <div className="rounded-xl border border-border bg-sidebar p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold">Result</span>
              <Badge variant={statusVariant(result.status || (result.proTrialOk ? "success" : "default"))}>
                {result.status || (result.proTrialOk ? "pro_ok" : "checked")}
              </Badge>
            </div>
            <ResultRow label="Plan" value={result.plan} />
            <ResultRow label="User type" value={result.userType} />
            <ResultRow label="Credits" value={`${fmtCredits(result.creditsRemaining)} / ${fmtCredits(result.creditsTotal)}`} />
            <ResultRow label="Pro Trial" value={result.proTrialOk ? "yes" : "no"} />
            <ResultRow label="Machine token" value={result.machine?.machineToken} mono />
            {result.ultimate && (
              <ResultRow
                label="Ultimate"
                value={result.ultimate.canClaim ? "claimable" : `no (${result.ultimate.reason || "?"})`}
              />
            )}
            {renderQwen38Row(result.qwen38)}
            <ResultRow label="PAT" value={result.patPrefix} mono />
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" icon="local_fire_department" onClick={claimQwen38} disabled={loading}>
                Claim Qwen38 800 Calls
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={run} loading={loading} disabled={!pat.trim()}>
            {loading ? "Running..." : mode === "grant" ? "Grant Pro Trial" : "Check Status"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

QoderGrantModal.propTypes = {
  isOpen: PropTypes.bool,
  onClose: PropTypes.func,
  onSuccess: PropTypes.func,
};
