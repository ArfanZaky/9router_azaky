"use client";

import { useState } from "react";
import { Button, Input, Modal } from "@/shared/components";

export default function QoderPatImportModal({ isOpen, initialMode = "single", onClose, onSuccess }) {
  const [mode, setMode] = useState(initialMode);
  const [personalToken, setPersonalToken] = useState("");
  const [machineToken, setMachineToken] = useState("");
  const [machineType, setMachineType] = useState("0");
  const [machineCode, setMachineCode] = useState("");
  const [bulk, setBulk] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const close = () => {
    if (!loading) onClose();
  };

  const submit = async () => {
    const entry = [personalToken.trim(), machineToken.trim(), machineType.trim(), machineCode.trim()]
      .join(":")
      .replace(/:+$/, "");
    const entries = mode === "single" ? [entry] : bulk;
    if ((mode === "single" && !personalToken.trim()) || (mode === "bulk" && !bulk.trim())) {
      setError("Enter at least one Qoder PAT.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/oauth/qoder/pat-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Qoder PAT import failed");
      setResult(data);
      if (data.success > 0) await onSuccess?.();
    } catch (err) {
      setError(err.message || "Qoder PAT import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Add Qoder PAT"
      size="lg"
      closeOnOverlay={!loading}
      footer={(
        <>
          <Button variant="ghost" onClick={close} disabled={loading}>Close</Button>
          <Button onClick={submit} loading={loading}>Import PAT</Button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-2 rounded-[10px] bg-surface-2 p-1">
          {[["single", "Single"], ["bulk", "Bulk Add"]].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { setMode(value); setError(""); setResult(null); }}
              className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${mode === value ? "bg-primary text-white" : "text-text-muted hover:text-text-main"}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "single" ? (
          <div className="space-y-4">
            <Input label="Personal Access Token" type="password" value={personalToken} onChange={(event) => setPersonalToken(event.target.value)} placeholder="pt-..." required />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Machine Token" value={machineToken} onChange={(event) => setMachineToken(event.target.value)} placeholder="Optional" />
              <Input label="Machine Type" value={machineType} onChange={(event) => setMachineType(event.target.value)} placeholder="0" />
            </div>
            <Input label="Machine Code" value={machineCode} onChange={(event) => setMachineCode(event.target.value)} placeholder="Optional" />
          </div>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium text-text-main">PAT entries</label>
            <textarea
              value={bulk}
              onChange={(event) => setBulk(event.target.value)}
              rows={9}
              placeholder={"pt-token:machineToken:0:machineCode\npt-token-2"}
              className="w-full rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 font-mono text-sm text-text-main focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
            />
            <p className="text-xs text-text-muted">One account per line. Machine fields optional.</p>
          </div>
        )}

        {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
        {result && (
          <div className="rounded-lg border border-border-subtle bg-surface-2 p-3 text-sm">
            <p className="font-medium text-text-main">Imported {result.success} of {result.total}. Failed {result.failed}.</p>
            {result.results?.filter((item) => !item.ok).map((item) => (
              <p key={`${item.line}-${item.error}`} className="mt-1 text-xs text-red-500">Line {item.line}: {item.error}</p>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
