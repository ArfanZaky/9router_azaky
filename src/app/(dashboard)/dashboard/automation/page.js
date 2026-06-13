"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, BulkAccountAutomationModal, Card, CardSkeleton, KiroOAuthWrapper, OAuthModal } from "@/shared/components";
import { FREE_PROVIDERS } from "@/shared/constants/providers";

function getConnectionLabel(count) {
  return `${count} connection${count === 1 ? "" : "s"}`;
}

function KiroAutomationPanel({ providerInfo, onRefresh }) {
  const [isOpen, setIsOpen] = useState(false);
  const [bulkJob, setBulkJob] = useState(null);
  const [initialFlow, setInitialFlow] = useState(null);
  const openFlow = (flow) => {
    setInitialFlow({ ...flow, key: Date.now() });
    setIsOpen(true);
  };

  const options = [
    {
      id: "bulk-account",
      title: "Auto Login Bulk",
      icon: "group_add",
      description: "Run bulk gmail|password automation with worker progress and manual assist.",
      action: () => openFlow({ method: "import", importMode: "bulk-account" }),
    },
    {
      id: "bulk-token",
      title: "Bulk Token",
      icon: "playlist_add",
      description: "Import many Kiro refresh tokens, one token per line.",
      action: () => openFlow({ method: "import", importMode: "bulk-token" }),
    },
    {
      id: "single-token",
      title: "Single Token",
      icon: "vpn_key",
      description: "Auto-detect or paste one Kiro refresh token.",
      action: () => openFlow({ method: "import", importMode: "single-token" }),
    },
    {
      id: "builder-id",
      title: "AWS Builder ID",
      icon: "shield",
      description: "Open the standard AWS Builder ID device login.",
      action: () => openFlow({ method: "builder-id" }),
    },
    {
      id: "idc",
      title: "AWS IDC",
      icon: "business",
      description: "Enter an IAM Identity Center start URL and region.",
      action: () => openFlow({ method: "idc" }),
    },
    {
      id: "google",
      title: "Google Login",
      icon: "account_circle",
      description: "Open Kiro social Google login with callback capture.",
      action: () => openFlow({ method: "social", provider: "google" }),
    },
  ];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={option.action}
            className="flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
              <span className="material-symbols-outlined text-[20px] text-primary">{option.icon}</span>
              {option.title}
            </span>
            <span className="text-xs leading-relaxed text-text-muted">{option.description}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {bulkJob?.jobId && (
          <Badge variant="default">
            Bulk job: {bulkJob.status}
          </Badge>
        )}
        {bulkJob?.jobId && (
          <Button
            size="sm"
            variant="secondary"
            icon="monitoring"
            onClick={() => openFlow({ method: "import", importMode: "bulk-account" })}
          >
            Resume Bulk Progress
          </Button>
        )}
      </div>
      <KiroOAuthWrapper
        isOpen={isOpen}
        providerInfo={providerInfo}
        onSuccess={onRefresh}
        onRefresh={onRefresh}
        initialBulkJobId={bulkJob?.jobId || null}
        initialFlow={initialFlow}
        onBulkJobChange={setBulkJob}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

function CodeBuddyBulkTokenModal({ isOpen, onClose, onSuccess }) {
  const [tokens, setTokens] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const handleImport = async () => {
    if (!tokens.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/oauth/codebuddy/bulk-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokens }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) onSuccess?.();
    } catch (error) {
      setResult({ error: error.message });
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const successMsg = result?.success
    ? `Imported ${result.imported}/${result.total} tokens.${result.failed ? ` ${result.failed} failed.` : ""}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-surface p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-semibold text-text-main">CodeBuddy OAuth Token Import</h3>
        <p className="mb-3 text-xs text-text-muted">Paste CodeBuddy OAuth access tokens, one per line. This is separate from generated CodeBuddy Access Keys.</p>
        <textarea
          className="mb-3 w-full rounded-lg border border-border bg-background p-3 font-mono text-xs text-text-main placeholder:text-text-muted focus:border-primary focus:outline-none"
          rows={8}
          placeholder={"eyJhbGciOiJSUzI1NiIs...\neyJhbGciOiJSUzI1NiIs...\neyJhbGciOiJSUzI1NiIs..."}
          value={tokens}
          onChange={(e) => setTokens(e.target.value)}
          disabled={loading}
        />
        {result && (
          <div className={"mb-3 rounded-lg p-3 text-xs " + (result.success ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400")}>
            {successMsg || result.error || "Import failed"}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-text-muted hover:bg-border/50">Close</button>
          <button
            type="button"
            onClick={handleImport}
            disabled={loading || !tokens.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Importing..." : "Import Tokens"}
          </button>
        </div>
      </div>
    </div>
  );
}

function CodeBuddyAutomationPanel({ providerInfo, onRefresh }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [isBulkTokenOpen, setIsBulkTokenOpen] = useState(false);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <button
          type="button"
          onClick={() => setIsBulkOpen(true)}
          className="flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">group_add</span>
            Auto Login + Generate Key
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Run bulk GSuite gmail|password login, create a CodeBuddy Access Key, and save it for model calls.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIsBulkTokenOpen(true)}
          className="flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">playlist_add</span>
            OAuth Token Import
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Paste OAuth access tokens directly. Generated Access Keys should come from automation.
          </span>
        </button>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex min-h-[112px] min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-main">
            <span className="material-symbols-outlined text-[20px] text-primary">login</span>
            Device OAuth Login
          </span>
          <span className="text-xs leading-relaxed text-text-muted">
            Open CodeBuddy browser login and poll until the OAuth token is saved.
          </span>
        </button>
      </div>
      <CodeBuddyBulkTokenModal
        isOpen={isBulkTokenOpen}
        onClose={() => setIsBulkTokenOpen(false)}
        onSuccess={onRefresh}
      />
      <BulkAccountAutomationModal
        isOpen={isBulkOpen}
        provider="codebuddy"
        title="CodeBuddy Bulk GSuite Login + Access Key"
        serviceName="CodeBuddy"
        onSuccess={onRefresh}
        onClose={() => setIsBulkOpen(false)}
      />
      <OAuthModal
        isOpen={isOpen}
        provider="codebuddy"
        providerInfo={providerInfo}
        onSuccess={() => {
          onRefresh?.();
          setIsOpen(false);
        }}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

const AUTOMATION_PROVIDERS = [
  {
    id: "kiro",
    label: "Kiro AI",
    icon: "psychology_alt",
    description: "Token import, bulk import, and social login automation.",
    supportedModes: ["single-token", "bulk-token", "bulk-account", "social"],
    component: KiroAutomationPanel,
  },
  {
    id: "codebuddy",
    label: "CodeBuddy",
    icon: "smart_toy",
    description: "Bulk GSuite automation and browser OAuth polling login.",
    supportedModes: ["bulk-account", "device-oauth"],
    component: CodeBuddyAutomationPanel,
  },
];

export default function AutomationPage() {
  const [connections, setConnections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeProviderId, setActiveProviderId] = useState(AUTOMATION_PROVIDERS[0].id);

  const fetchConnections = useCallback(async () => {
    try {
      const res = await fetch("/api/providers", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) setConnections(data.connections || []);
    } catch (error) {
      console.log("Error fetching automation connections:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnections();
  }, [fetchConnections]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requestedProvider = new URLSearchParams(window.location.search).get("provider");
    if (AUTOMATION_PROVIDERS.some((provider) => provider.id === requestedProvider)) {
      setActiveProviderId(requestedProvider);
    }
  }, []);

  const activeProvider = AUTOMATION_PROVIDERS.find((provider) => provider.id === activeProviderId) || AUTOMATION_PROVIDERS[0];
  const providerInfo = FREE_PROVIDERS[activeProvider.id] || { id: activeProvider.id, name: activeProvider.label };
  const ProviderPanel = activeProvider.component;
  const providerCounts = useMemo(() => {
    const counts = {};
    for (const provider of AUTOMATION_PROVIDERS) {
      counts[provider.id] = connections.filter((connection) => connection.provider === provider.id).length;
    }
    return counts;
  }, [connections]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-6 px-1 sm:px-0">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Automation</h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {AUTOMATION_PROVIDERS.map((provider) => {
          const selected = provider.id === activeProviderId;
          return (
            <button
              key={provider.id}
              type="button"
              onClick={() => setActiveProviderId(provider.id)}
              className={`flex min-w-0 items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                selected
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-surface text-text-main hover:border-primary/30 hover:bg-primary/5"
              }`}
            >
              <span className="material-symbols-outlined text-[22px]">{provider.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{provider.label}</span>
                <span className="mt-0.5 block text-xs text-text-muted">
                  {getConnectionLabel(providerCounts[provider.id] || 0)}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <Card>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[22px] text-primary">{activeProvider.icon}</span>
                <h2 className="text-lg font-semibold">{activeProvider.label}</h2>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {activeProvider.supportedModes.map((mode) => (
                  <Badge key={mode} variant="default" size="sm">
                    {mode}
                  </Badge>
                ))}
              </div>
            </div>
            <Badge variant="success">{getConnectionLabel(providerCounts[activeProvider.id] || 0)}</Badge>
          </div>

          <ProviderPanel providerInfo={providerInfo} onRefresh={fetchConnections} />
        </div>
      </Card>
    </div>
  );
}
