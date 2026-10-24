"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import GitSourceControl from "./GitSourceControl";
import GitGraphView from "./GitGraphView";
import ProjectTerminalView from "./ProjectTerminalView";
import { useModelCaps } from "@/shared/hooks/useModelCaps";

function GitBranchIcon({ className = "h-3.5 w-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

const TABS = [
  { id: "info", label: "Info", icon: "info" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "plan", label: "Plan", icon: "list_alt" },
  { id: "git", label: "Git", icon: "git" },
  { id: "graph", label: "Graph", icon: "schema" },
  { id: "changes", label: "Changes", icon: "edit" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "scripts", label: "Scripts", icon: "play_circle" },
  { id: "tools", label: "Tools", icon: "handyman" },
];

function formatDuration(isoStart, isoEnd = null) {
  if (!isoStart) return "";
  const start = new Date(isoStart).getTime();
  const end = isoEnd ? new Date(isoEnd).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) return "";
  const diffSec = Math.max(0, Math.floor((end - start) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ${diffSec % 60}s`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ${diffMin % 60}m`;
}

function ProjectSidebarComponent({
  workspacePath,
  sessionId,
  refreshKey,
  messages,
  activeModel,
  onRun,
  onClose,
  initialTab = "info",
}) {
  const [tab, setTab] = useState(initialTab || "info");
  const [data, setData] = useState(null);
  const [tree, setTree] = useState({});
  const [openDirs, setOpenDirs] = useState({});

  // Shared Git & Multi-repo state across Git and Graph tabs
  const [activeRepoPath, setActiveRepoPath] = useState(workspacePath);
  const [knownRepos, setKnownRepos] = useState([]);

  useEffect(() => {
    setActiveRepoPath(workspacePath);
    setKnownRepos([]);
  }, [workspacePath]);

  // CodeGraph state
  const [codeGraphStatus, setCodeGraphStatus] = useState(null);
  const [codeGraphLoading, setCodeGraphLoading] = useState(false);
  const [codeGraphSyncing, setCodeGraphSyncing] = useState(false);
  const [codeGraphMsg, setCodeGraphMsg] = useState(null);

  // Model capabilities for context window
  const { getCaps } = useModelCaps();
  const caps = useMemo(() => (getCaps ? getCaps(activeModel) : null), [getCaps, activeModel]);
  const contextWindow = caps?.contextWindow || 128000;

  const lastMsgWithUsage = useMemo(() => {
    return [...(messages || [])].reverse().find(
      (m) => m.tokenUsage && (m.tokenUsage.prompt_tokens != null || m.tokenUsage.total_tokens != null)
    );
  }, [messages]);

  const contextTokens = useMemo(() => {
    if (lastMsgWithUsage?.tokenUsage) {
      return Number(
        lastMsgWithUsage.tokenUsage.prompt_tokens ??
        lastMsgWithUsage.tokenUsage.input_tokens ??
        lastMsgWithUsage.tokenUsage.total_tokens ??
        0
      );
    }
    const totalChars = (messages || []).reduce(
      (acc, m) => acc + (typeof m.content === "string" ? m.content.length : 0),
      0
    );
    return Math.round(totalChars / 4);
  }, [lastMsgWithUsage, messages]);

  const contextPct = contextWindow > 0 && contextTokens > 0
    ? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
    : 0;

  // Process manager state
  const [processes, setProcesses] = useState([]);
  const [expandedLogsId, setExpandedLogsId] = useState(null);
  const [processLogs, setProcessLogs] = useState({});
  const [customCmd, setCustomCmd] = useState("");
  const [startingCmd, setStartingCmd] = useState(false);
  const [killingId, setKillingId] = useState(null);
  const [openingTerminal, setOpeningTerminal] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (!workspacePath) {
      setData(null);
      return;
    }
    let alive = true;
    fetch("/api/chat/projects/detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: workspacePath }),
    })
      .then((r) => r.json())
      .then((d) => { if (alive && !d.error) setData(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, [workspacePath, refreshKey]);

  // Load CodeGraph status
  const loadCodeGraphStatus = useCallback(async () => {
    if (!workspacePath) return;
    try {
      setCodeGraphLoading(true);
      const res = await fetch(`/api/chat/projects/codegraph?workspace=${encodeURIComponent(workspacePath)}`);
      const d = await res.json().catch(() => null);
      if (d?.ok && d.status) {
        setCodeGraphStatus(d.status);
      } else if (d?.status) {
        setCodeGraphStatus(d.status);
      }
    } catch {
      // ignore
    } finally {
      setCodeGraphLoading(false);
    }
  }, [workspacePath]);

  useEffect(() => {
    if (workspacePath && (tab === "info" || tab === "graph")) {
      loadCodeGraphStatus();
    }
  }, [workspacePath, tab, loadCodeGraphStatus, refreshKey]);

  // Reindex CodeGraph handler
  const handleReindexCodeGraph = async () => {
    if (!workspacePath || codeGraphSyncing) return;
    setCodeGraphSyncing(true);
    setCodeGraphMsg(null);
    try {
      const res = await fetch("/api/chat/projects/codegraph", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync", workspace: workspacePath }),
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        if (d.status) setCodeGraphStatus(d.status);
        setCodeGraphMsg({ type: "success", text: "CodeGraph sync completed" });
        fetch("/api/chat/projects/detail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: workspacePath }),
        }).then((r) => r.json()).then((pd) => { if (!pd.error) setData(pd); }).catch(() => {});
      } else {
        setCodeGraphMsg({ type: "error", text: d?.error || "Reindex failed" });
      }
    } catch (err) {
      setCodeGraphMsg({ type: "error", text: err?.message || "Failed to trigger reindex" });
    } finally {
      setCodeGraphSyncing(false);
    }
  };

  // Load running / tracked processes for this workspace
  const loadProcesses = useCallback(async () => {
    if (!workspacePath) return;
    try {
      const res = await fetch(`/api/chat/projects/processes?workspace=${encodeURIComponent(workspacePath)}`);
      const d = await res.json().catch(() => null);
      if (d?.ok && Array.isArray(d.processes)) {
        setProcesses(d.processes);
      }
    } catch {
      // ignore
    }
  }, [workspacePath]);

  // Quick open native terminal
  const handleOpenSystemTerminal = useCallback(async () => {
    if (!workspacePath || openingTerminal) return;
    setOpeningTerminal(true);
    try {
      await fetch("/api/chat/projects/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", path: workspacePath }),
      });
    } catch {
      // ignore
    } finally {
      setOpeningTerminal(false);
    }
  }, [workspacePath, openingTerminal]);

  // Periodic poll for processes when tab is active or processes are running
  useEffect(() => {
    if (!workspacePath) return;
    loadProcesses();
    const hasRunning = processes.some((p) => p.status === "running");
    const intervalTime = tab === "scripts" || hasRunning ? 2500 : 8000;
    const interval = setInterval(loadProcesses, intervalTime);
    return () => clearInterval(interval);
  }, [workspacePath, tab, processes.length, loadProcesses]);

  // Fetch logs when expanded
  useEffect(() => {
    if (!expandedLogsId) return;
    let alive = true;
    const fetchLogs = async () => {
      try {
        const res = await fetch("/api/chat/projects/processes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "logs", id: expandedLogsId }),
        });
        const d = await res.json().catch(() => null);
        if (alive && d?.ok && Array.isArray(d.logs)) {
          setProcessLogs((prev) => ({ ...prev, [expandedLogsId]: d.logs }));
        }
      } catch {
        // ignore
      }
    };
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [expandedLogsId]);

  const handleKillProcess = async (proc) => {
    if (!proc?.id && !proc?.pid) return;
    setKillingId(proc.id);
    try {
      const res = await fetch("/api/chat/projects/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "kill", id: proc.id, pid: proc.pid }),
      });
      const d = await res.json().catch(() => null);
      if (d?.ok) {
        await loadProcesses();
      }
    } catch {
      // ignore
    } finally {
      setKillingId(null);
    }
  };

  const handleRunBackground = async (command) => {
    const cmd = String(command || "").trim();
    if (!cmd || !workspacePath) return;
    setStartingCmd(true);
    try {
      const res = await fetch("/api/chat/projects/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run",
          command: cmd,
          workspace: workspacePath,
          sessionId: sessionId || "",
        }),
      });
      const d = await res.json().catch(() => null);
      if (d?.ok && d.process) {
        setCustomCmd("");
        await loadProcesses();
        setExpandedLogsId(d.process.id);
      }
    } catch {
      // ignore
    } finally {
      setStartingCmd(false);
    }
  };

  const handleClearFinished = async () => {
    if (!workspacePath) return;
    try {
      await fetch("/api/chat/projects/processes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear", workspace: workspacePath }),
      });
      await loadProcesses();
    } catch {
      // ignore
    }
  };

  const loadTree = (sub) => {
    fetch("/api/chat/projects/detail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: workspacePath, tree: true, sub }),
    })
      .then((r) => r.json())
      .then((d) => { if (!d.error) setTree((t) => ({ ...t, [sub]: d.entries || [] })); })
      .catch(() => {});
  };

  useEffect(() => {
    if (tab === "files" && workspacePath && !tree[""]) {
      loadTree("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, workspacePath]);

  const changedFiles = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const m of messages || []) {
      const segs = m.segments || [];
      for (const seg of segs) {
        if (seg.type !== "tool") continue;
        if (seg.name !== "write_file" && seg.name !== "edit_file") continue;
        const p = seg.arguments?.path;
        if (p && !seen.has(p)) { seen.add(p); out.push({ path: p, tool: seg.name }); }
      }
    }
    return out;
  }, [messages]);

  const toolStats = useMemo(() => {
    const by = new Map();
    for (const m of messages || []) {
      for (const seg of m.segments || []) {
        if (seg.type !== "tool") continue;
        const s = by.get(seg.name) || { name: seg.name, count: 0 };
        s.count++;
        by.set(seg.name, s);
      }
    }
    return [...by.values()].sort((a, b) => b.count - a.count);
  }, [messages]);

  const scripts = data?.scripts || {};
  const git = data?.git || {};
  const plan = data?.plan || {};
  const gitChangesCount = (git?.staged?.length || 0) + (git?.unstaged?.length || 0) || (git?.changes?.length || 0);
  const runningProcessesCount = useMemo(() => processes.filter((p) => p.status === "running").length, [processes]);

  function renderTree(entries, parent, depth) {
    return (entries || []).map((node) => (
      <div key={node.path}>
        <button
          onClick={() => {
            if (!node.is_dir) return;
            const isOpen = !!openDirs[node.path];
            setOpenDirs((d) => ({ ...d, [node.path]: !isOpen }));
            if (!isOpen && !tree[node.path]) loadTree(node.path);
          }}
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          className="flex w-full items-center gap-1.5 rounded py-0.5 text-left text-[11px] hover:bg-sidebar"
        >
          <span className={`material-symbols-outlined text-[14px] ${node.is_dir ? "text-text-muted" : "text-text-subtle"}`}>
            {node.is_dir ? (openDirs[node.path] ? "folder_open" : "folder") : "description"}
          </span>
          <span className="truncate">{node.name}</span>
        </button>
        {node.is_dir && openDirs[node.path] ? renderTree(tree[node.path] || [], node.path, depth + 1) : null}
      </div>
    ));
  }

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-sidebar/25">
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <span className="material-symbols-outlined text-[18px] text-primary">folder_open</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{data?.name || "Project"}</p>
          <p className="truncate font-mono text-[10px] text-text-muted">{workspacePath}</p>
        </div>
        <button
          type="button"
          onClick={handleOpenSystemTerminal}
          className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-background/80 transition cursor-pointer"
          title="Open in System Terminal"
        >
          <span className="material-symbols-outlined text-[18px]">
            {openingTerminal ? "sync" : "terminal"}
          </span>
        </button>
        <button onClick={onClose} className="text-text-muted hover:text-text-main cursor-pointer">
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Improved Tab Navigation */}
      <div className="relative overflow-x-auto border-b border-border bg-background/40 custom-scrollbar">
        <div className="flex min-w-max gap-1 px-2 py-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`
                group relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200 cursor-pointer
                ${tab === t.id 
                  ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20" 
                  : "text-text-muted hover:bg-background/60 hover:text-foreground"
                }
              `}
            >
              <span className={`flex items-center transition-transform duration-200 ${tab === t.id ? "scale-110" : "group-hover:scale-105"}`}>
                {t.id === "git" ? (
                  <GitBranchIcon className="h-3.5 w-3.5" />
                ) : (
                  <span className="material-symbols-outlined text-[14px]">{t.icon}</span>
                )}
              </span>
              <span className="whitespace-nowrap">{t.label}</span>
              
              {t.id === "git" && gitChangesCount > 0 ? (
                <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0.2 text-[9px] font-bold text-primary ring-1 ring-primary/30">
                  {gitChangesCount}
                </span>
              ) : null}

              {t.id === "graph" && git?.ahead > 0 ? (
                <span className="ml-0.5 rounded-full bg-sky-500/20 px-1.5 py-0.2 text-[9px] font-bold text-sky-400 ring-1 ring-sky-500/30">
                  ↑{git.ahead}
                </span>
              ) : null}

              {t.id === "changes" && changedFiles.length > 0 ? (
                <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0.2 text-[9px] font-bold text-primary ring-1 ring-primary/30">
                  {changedFiles.length}
                </span>
              ) : null}

              {t.id === "scripts" && runningProcessesCount > 0 ? (
                <span className="ml-0.5 flex items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-bold text-emerald-400 ring-1 ring-emerald-500/30">
                  <span className="size-1.5 rounded-full bg-emerald-400 animate-ping" />
                  {runningProcessesCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Main Tab Content */}
      {tab === "git" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <GitSourceControl
            workspacePath={workspacePath}
            activeRepoPath={activeRepoPath}
            onSelectRepoPath={setActiveRepoPath}
            knownRepos={knownRepos}
            onUpdateRepos={setKnownRepos}
            activeModel={activeModel}
            onViewGraph={() => setTab("graph")}
            onStatusChange={(updatedGit) => {
              setData((prev) => prev ? { ...prev, git: updatedGit } : prev);
            }}
          />
        </div>
      ) : tab === "graph" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <GitGraphView
            workspacePath={workspacePath}
            activeRepoPath={activeRepoPath}
            onSelectRepoPath={setActiveRepoPath}
            knownRepos={knownRepos}
            onUpdateRepos={setKnownRepos}
            onViewGit={() => setTab("git")}
            onPushSuccess={() => {
              fetch("/api/chat/projects/detail", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ path: workspacePath }),
              }).then((r) => r.json()).then((d) => { if (!d.error) setData(d); }).catch(() => {});
            }}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "info" ? (
            <div className="space-y-4 text-xs">
              {/* Project Metadata Card */}
              <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">
                  <span className="material-symbols-outlined text-[15px] text-primary">folder</span>
                  <span>Project Overview</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">Name</span>
                    <span className="font-semibold text-text-main">{data?.name || "(unnamed)"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">Package</span>
                    <span className="font-mono text-text-muted">{data?.packageName || "(none)"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-text-muted">Files</span>
                    <span className="text-text-main">{(data?.files || []).length} indexed</span>
                  </div>
                  <div className="flex items-start justify-between gap-2 pt-1 border-t border-border/50">
                    <span className="text-text-muted shrink-0">Path</span>
                    <span className="font-mono text-[10px] text-text-muted break-all text-right">{workspacePath}</span>
                  </div>
                </div>
              </div>

              {/* CodeGraph Index & Reindex Card */}
              <div className="rounded-xl border border-border bg-background/40 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[15px] text-primary">schema</span>
                    <span>CodeGraph Index</span>
                  </div>
                  {codeGraphLoading ? (
                    <span className="text-[10px] text-text-muted">Checking...</span>
                  ) : codeGraphStatus ? (
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                        codeGraphStatus.isUpToDate
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                          : codeGraphStatus.initialized
                          ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
                          : "bg-sidebar border-border text-text-muted"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          codeGraphStatus.isUpToDate
                            ? "bg-emerald-500"
                            : codeGraphStatus.initialized
                            ? "bg-amber-500"
                            : "bg-text-muted"
                        }`}
                      />
                      {codeGraphStatus.isUpToDate
                        ? "Up to date"
                        : codeGraphStatus.initialized
                        ? "Pending sync"
                        : "Not initialized"}
                    </span>
                  ) : null}
                </div>

                {/* CodeGraph Stats Grid */}
                {codeGraphStatus?.initialized ? (
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-black/20 dark:bg-black/40 border border-border/60 p-2">
                      <p className="text-[10px] text-text-muted">Indexed Files</p>
                      <p className="font-mono text-xs font-semibold text-text-main mt-0.5">
                        {codeGraphStatus.files || "-"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/20 dark:bg-black/40 border border-border/60 p-2">
                      <p className="text-[10px] text-text-muted">Graph Nodes</p>
                      <p className="font-mono text-xs font-semibold text-text-main mt-0.5">
                        {codeGraphStatus.nodes || "-"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/20 dark:bg-black/40 border border-border/60 p-2">
                      <p className="text-[10px] text-text-muted">Call Edges</p>
                      <p className="font-mono text-xs font-semibold text-text-main mt-0.5">
                        {codeGraphStatus.edges || "-"}
                      </p>
                    </div>
                    <div className="rounded-lg bg-black/20 dark:bg-black/40 border border-border/60 p-2">
                      <p className="text-[10px] text-text-muted">DB Size</p>
                      <p className="font-mono text-xs font-semibold text-text-main mt-0.5">
                        {codeGraphStatus.dbSize || "-"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-text-muted">
                    Code intelligence graph not yet initialized for this workspace. Click reindex to build the symbol graph.
                  </p>
                )}

                {/* Reindex Button */}
                <div className="space-y-1.5 pt-1">
                  <button
                    type="button"
                    disabled={codeGraphSyncing}
                    onClick={handleReindexCodeGraph}
                    className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/20 transition disabled:opacity-50 shadow-sm cursor-pointer"
                    title="Sync CodeGraph index with codebase changes"
                  >
                    <span className={`material-symbols-outlined text-[16px] ${codeGraphSyncing ? "animate-spin" : ""}`}>
                      sync
                    </span>
                    <span>{codeGraphSyncing ? "Syncing CodeGraph..." : "Reindex (codegraph sync)"}</span>
                  </button>

                  {codeGraphMsg && (
                    <div
                      className={`rounded-lg px-2.5 py-1.5 text-[11px] font-medium flex items-center gap-1.5 ${
                        codeGraphMsg.type === "success"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                          : "bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20"
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px]">
                        {codeGraphMsg.type === "success" ? "check_circle" : "error"}
                      </span>
                      <span className="truncate">{codeGraphMsg.text}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Active Session Context Card */}
              <div className="rounded-xl border border-border bg-background/40 p-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-text-muted font-semibold text-[11px] uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[15px] text-primary">data_usage</span>
                    <span>Session Context</span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border ${
                      contextPct > 80
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400"
                        : contextPct > 60
                        ? "bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-400"
                        : "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        contextPct > 80 ? "bg-rose-500" : contextPct > 60 ? "bg-amber-500" : "bg-emerald-500"
                      }`}
                    />
                    {contextPct > 80 ? "High Usage" : contextPct > 60 ? "Elevated" : "Healthy"}
                  </span>
                </div>

                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-bold font-mono text-text-main tabular-nums">
                    {contextPct}%
                  </span>
                  <span className="text-[11px] text-text-muted tabular-nums">
                    {contextTokens.toLocaleString()} / {contextWindow.toLocaleString()} tokens
                  </span>
                </div>

                {/* Visual Progress Bar */}
                <div className="h-2 w-full rounded-full bg-border/60 overflow-hidden">
                  <div
                    style={{ width: `${Math.min(100, Math.max(contextPct > 0 ? 2 : 0, contextPct))}%` }}
                    className={`h-full rounded-full transition-all duration-300 ${
                      contextPct > 80
                        ? "bg-rose-500"
                        : contextPct > 60
                        ? "bg-amber-500"
                        : "bg-emerald-500"
                    }`}
                  />
                </div>

                <div className="space-y-1 text-[11px] pt-1 border-t border-border/50 text-text-muted">
                  <div className="flex items-center justify-between">
                    <span>Active Model</span>
                    <span className="font-mono text-text-main truncate max-w-[150px]">{activeModel || "No model"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Free Capacity</span>
                    <span className="font-mono text-text-main tabular-nums">
                      {Math.max(0, contextWindow - contextTokens).toLocaleString()} tokens ({Math.max(0, 100 - contextPct)}%)
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : tab === "terminal" ? (
            <ProjectTerminalView
              workspacePath={workspacePath}
              onRunInChat={onRun}
            />
          ) : tab === "plan" ? (
            plan.exists ? (
              <pre className="whitespace-pre-wrap break-words rounded-lg bg-background/60 p-2 font-mono text-[11px]">{plan.raw}</pre>
            ) : (
              <p className="text-[11px] text-text-muted">No plan file (.antares/plan.md / PLAN.md).</p>
            )
          ) : tab === "changes" ? (
            changedFiles.length ? (
              <div className="space-y-1">
                {changedFiles.map((f) => (
                  <div key={f.path} className="flex items-center gap-2 font-mono text-[11px]">
                    <span className={`material-symbols-outlined text-[14px] ${f.tool === "write_file" ? "text-emerald-500" : "text-amber-500"}`}>{f.tool === "write_file" ? "note_add" : "edit"}</span>
                    <span className="truncate">{f.path}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-text-muted">No files changed this session.</p>
            )
          ) : tab === "files" ? (
            <div className="space-y-0.5">
              {!tree[""] ? <p className="text-[11px] text-text-muted">Loading...</p> : null}
              {renderTree(tree[""] || [], "", 0)}
            </div>
          ) : tab === "scripts" ? (
            <div className="space-y-4">
              {/* Running Processes Section */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                      Active / Running Processes
                    </span>
                    {runningProcessesCount > 0 ? (
                      <span className="rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                        {runningProcessesCount} running
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={loadProcesses}
                      className="p-1 text-text-muted hover:text-foreground transition rounded hover:bg-background/60 cursor-pointer"
                      title="Refresh processes"
                    >
                      <span className="material-symbols-outlined text-[14px]">refresh</span>
                    </button>
                    {processes.some((p) => p.status !== "running") ? (
                      <button
                        onClick={handleClearFinished}
                        className="text-[10px] text-text-muted hover:text-red-400 transition cursor-pointer"
                        title="Clear completed/killed records"
                      >
                        Clear finished
                      </button>
                    ) : null}
                  </div>
                </div>

                {processes.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border bg-background/30 p-3.5 text-center">
                    <span className="material-symbols-outlined text-[24px] text-text-muted mb-1 block">terminal</span>
                    <p className="text-[11px] font-medium text-text-main">No processes running</p>
                    <p className="text-[10px] text-text-muted mt-0.5">
                      Scripts started by AI or background servers will appear here with live logs and a Kill button.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {processes.map((proc) => {
                      const isRunning = proc.status === "running";
                      const isExpanded = expandedLogsId === proc.id;
                      const logs = processLogs[proc.id] || [];

                      return (
                        <div
                          key={proc.id}
                          className={`rounded-xl border transition-all ${
                            isRunning
                              ? "border-emerald-500/35 bg-emerald-500/[0.03] shadow-sm"
                              : "border-border bg-background/40"
                          }`}
                        >
                          <div className="p-2.5 space-y-1.5">
                            <div className="flex items-center justify-between gap-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {isRunning ? (
                                  <span className="relative flex size-2 shrink-0">
                                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                                    <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                                  </span>
                                ) : (
                                  <span
                                    className={`size-2 shrink-0 rounded-full ${
                                      proc.status === "killed"
                                        ? "bg-red-500"
                                        : proc.status === "error"
                                        ? "bg-red-400"
                                        : "bg-text-muted"
                                    }`}
                                  />
                                )}
                                <span
                                  className={`text-[10px] font-bold uppercase tracking-wider ${
                                    isRunning
                                      ? "text-emerald-400"
                                      : proc.status === "killed"
                                      ? "text-red-400"
                                      : "text-text-muted"
                                  }`}
                                >
                                  {proc.status}
                                </span>
                                {proc.pid ? (
                                  <span className="font-mono text-[10px] text-text-muted opacity-80">
                                    PID {proc.pid}
                                  </span>
                                ) : null}
                              </div>

                              <span className="font-mono text-[10px] text-text-muted">
                                {formatDuration(proc.startedAt, proc.finishedAt)}
                              </span>
                            </div>

                            {/* Command Line */}
                            <div className="rounded-lg bg-black/40 px-2 py-1.5 border border-white/5">
                              <p className="font-mono text-[11px] font-medium text-text-main break-all select-all">
                                {proc.command}
                              </p>
                              {proc.lastLog && (
                                <p className="truncate font-mono text-[10px] text-text-muted/80 mt-0.5">
                                  &gt; {proc.lastLog}
                                </p>
                              )}
                            </div>

                            {/* Action Row */}
                            <div className="flex items-center justify-between gap-2 pt-0.5">
                              <button
                                type="button"
                                onClick={() => setExpandedLogsId(isExpanded ? null : proc.id)}
                                className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition cursor-pointer ${
                                  isExpanded
                                    ? "bg-primary/20 text-primary font-medium"
                                    : "text-text-muted hover:bg-background/80 hover:text-foreground"
                                }`}
                              >
                                <span className="material-symbols-outlined text-[13px]">terminal</span>
                                <span>{isExpanded ? "Hide Logs" : "View Logs"}</span>
                              </button>

                              {isRunning && (
                                <button
                                  type="button"
                                  disabled={killingId === proc.id}
                                  onClick={() => handleKillProcess(proc)}
                                  className="flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20 transition disabled:opacity-50 shadow-sm cursor-pointer"
                                  title="Kill / Stop Process Tree"
                                >
                                  <span className="material-symbols-outlined text-[13px]">
                                    {killingId === proc.id ? "sync" : "stop_circle"}
                                  </span>
                                  <span>{killingId === proc.id ? "Killing..." : "Kill"}</span>
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Expanded Logs Terminal Window */}
                          {isExpanded && (
                            <div className="border-t border-border bg-black/60 p-2 rounded-b-xl">
                              <div className="mb-1 flex items-center justify-between text-[10px] text-text-muted">
                                <span>Console Output ({logs.length} lines)</span>
                                <span className="font-mono">{isRunning ? "Live Streaming" : "Finished"}</span>
                              </div>
                              <pre className="max-h-48 overflow-y-auto custom-scrollbar whitespace-pre-wrap break-all font-mono text-[10px] leading-4 text-emerald-400/90 select-text p-1">
                                {logs.length > 0 ? logs.join("\n") : "Waiting for output..."}
                              </pre>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Quick Run Custom Command */}
              <div className="space-y-1.5 pt-2 border-t border-border">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Run Custom Command
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (customCmd.trim()) handleRunBackground(customCmd);
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={customCmd}
                    onChange={(e) => setCustomCmd(e.target.value)}
                    placeholder="e.g. npm run dev or dotnet run"
                    className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] font-mono outline-none focus:border-primary"
                  />
                  <button
                    type="submit"
                    disabled={startingCmd || !customCmd.trim()}
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/20 border border-primary/30 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/30 transition disabled:opacity-50 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[14px]">play_arrow</span>
                    <span>Run</span>
                  </button>
                </form>
              </div>

              {/* Available Package Scripts */}
              <div className="space-y-2 pt-2 border-t border-border">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                  Available Scripts (package.json)
                </p>
                {Object.keys(scripts).length ? (
                  <div className="space-y-1.5">
                    {Object.entries(scripts).map(([name, cmd]) => (
                      <div
                        key={name}
                        className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background/40 px-2.5 py-2 hover:bg-background/60 transition"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[11px] font-semibold text-text-main">{name}</p>
                          <p className="truncate font-mono text-[10px] text-text-muted">{cmd}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleRunBackground(`npm run ${name}`)}
                            className="flex items-center gap-0.5 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20 transition cursor-pointer"
                            title="Run in background"
                          >
                            <span className="material-symbols-outlined text-[13px]">play_arrow</span>
                            <span>Run</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onRun(`npm run ${name}`)}
                            className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-background/80 transition cursor-pointer"
                            title="Send to chat draft"
                          >
                            <span className="material-symbols-outlined text-[14px]">chat</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-text-muted">No npm scripts detected in package.json.</p>
                )}
              </div>
            </div>
          ) : tab === "tools" ? (
            toolStats.length ? (
              <div className="space-y-1">
                {toolStats.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 py-0.5 text-[11px]">
                    <span className="min-w-0 flex-1 truncate font-mono">{s.name}</span>
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">{s.count}×</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-text-muted">No tools used yet.</p>
            )
          ) : null}
        </div>
      )}
    </aside>
  );
}

export default memo(ProjectSidebarComponent);
