"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { Button, Modal } from "@/shared/components";

function normalizeToArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    if (Array.isArray(parsed.accounts)) return parsed.accounts;
    return [parsed];
  }
  return null;
}

export default function ImportAccountsModal({ isOpen, providerId, providerName, onClose, onSuccess }) {
  const [jsonText, setJsonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [parseError, setParseError] = useState("");
  const [result, setResult] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      setJsonText("");
      setParseError("");
      setResult(null);
    }
  }, [isOpen]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setJsonText(text);
      setParseError("");
      setResult(null);
    } catch (err) {
      setParseError(err.message || "Failed to read file");
    }
  };

  const handleSubmit = async () => {
    setParseError("");
    setResult(null);
    const trimmed = jsonText.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch (err) {
      setParseError(`Invalid JSON: ${err.message}`);
      return;
    }

    const accounts = normalizeToArray(parsed);
    if (!accounts || accounts.length === 0) {
      setParseError("No accounts found in input");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accounts }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setParseError(data?.error || `Request failed: ${res.status}`);
        return;
      }
      setResult(data);
      if (data.success > 0 && typeof onSuccess === "function") onSuccess();
    } catch (err) {
      setParseError(err.message || "Request failed");
    } finally {
      setSubmitting(false);
    }
  };

  const failedItems = result?.results?.filter((r) => !r.ok) || [];

  return (
    <Modal isOpen={isOpen} title={`Import ${providerName || providerId} Accounts`} onClose={handleClose}>
      <div className="flex flex-col gap-4">
        <p className="text-xs text-text-muted">
          Paste export JSON (or load a <code className="font-mono">.json</code> file). Each account needs
          credentials: <code className="font-mono">accessToken</code> /{" "}
          <code className="font-mono">apiKey</code> / <code className="font-mono">refreshToken</code>.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" icon="upload_file" onClick={() => fileRef.current?.click()}>
            Load file
          </Button>
          <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={handleFile} />
        </div>

        <textarea
          className="w-full rounded border border-accent/30 bg-sidebar p-2 text-sm font-mono resize-y min-h-[240px] focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder={`{\n  "provider": "${providerId}",\n  "accounts": [\n    { "authType": "oauth", "email": "a@b.com", "accessToken": "..." }\n  ]\n}`}
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          disabled={submitting}
        />

        {parseError ? <p className="text-xs text-red-500 break-words">{parseError}</p> : null}

        {result ? (
          <div className="flex flex-col gap-2">
            <div
              className={`text-sm font-medium ${
                result.failed > 0 ? "text-yellow-500" : "text-green-500"
              }`}
            >
              ✓ {result.success} imported
              {result.failed > 0 ? `, ✗ ${result.failed} failed` : ""}
            </div>
            {failedItems.length > 0 ? (
              <ul className="rounded border border-accent/20 bg-sidebar/50 p-2 text-xs font-mono max-h-40 overflow-y-auto">
                {failedItems.map((item) => (
                  <li key={item.index} className="text-red-400">
                    [{item.index}] {item.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        <div className="flex gap-2 pt-1">
          <Button onClick={handleClose} variant="ghost" fullWidth size="sm" disabled={submitting}>
            {result?.success > 0 ? "Close" : "Cancel"}
          </Button>
          <Button
            onClick={handleSubmit}
            fullWidth
            size="sm"
            loading={submitting}
            disabled={submitting || !jsonText.trim()}
          >
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}

ImportAccountsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerId: PropTypes.string.isRequired,
  providerName: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
};
