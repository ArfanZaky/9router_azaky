"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import GitSourceControl from "./GitSourceControl";

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
  { id: "plan", label: "Plan", icon: "list_alt" },
  { id: "git", label: "Git", icon: "git" },
  { id: "changes", label: "Changes", icon: "edit" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "scripts", label: "Scripts", icon: "terminal" },
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

  // Process manager state
  const [processes, setProcesses] = useState([]);
  const [expandedLogsId, setExpandedLogsId] = useState(null);
  const [processLogs, setProcessLogs] = useState({});
  const [customCmd, setCustomCmd] = useState("");
  const [startingCmd, setStartingCmd] = useState(false);
  const [killingId, setKillingId] = useState(null);

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
        <button onClick={onClose} className="text-text-muted hover:text-text-main">
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
                group relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200
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
            activeModel={activeModel}
            onStatusChange={(updatedGit) => {
              setData((prev) => prev ? { ...prev, git: updatedGit } : prev);
            }}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "info" ? (
            <div className="space-y-2 text-xs">
              <p className="font-medium">Name</p><p className="text-text-muted">{data?.name || "—"}</p>
              <p className="font-medium">Package</p><p className="font-mono text-text-muted">{data?.packageName || "—"}</p>
              <p className="font-medium">Files</p><p className="text-text-muted">{(data?.files || []).length} indexed</p>
            </div>
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
              {!tree[""] ? <p className="text-[11px] text-text-muted">Loading…</p> : null}
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
                      className="p-1 text-text-muted hover:text-foreground transition rounded hover:bg-background/60"
                      title="Refresh processes"
                    >
                      <span className="material-symbols-outlined text-[14px]">refresh</span>
                    </button>
                    {processes.some((p) => p.status !== "running") ? (
                      <button
                        onClick={handleClearFinished}
                        className="text-[10px] text-text-muted hover:text-red-400 transition"
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
                                className={`flex items-center gap-1 text-[11px] px-2 py-1 rounded transition ${
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
                                  className="flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20 transition disabled:opacity-50 shadow-sm"
                                  title="Kill / Stop Process Tree"
                                >
                                  <span className="material-symbols-outlined text-[13px]">
                                    {killingId === proc.id ? "sync" : "stop_circle"}
                                  </span>
                                  <span>{killingId === proc.id ? "Killing…" : "Kill"}</span>
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
                                {logs.length > 0 ? logs.join("\n") : "Waiting for output…"}
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
                    className="flex shrink-0 items-center gap-1 rounded-lg bg-primary/20 border border-primary/30 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/30 transition disabled:opacity-50"
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
                            className="flex items-center gap-0.5 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20 transition"
                            title="Run in background"
                          >
                            <span className="material-symbols-outlined text-[13px]">play_arrow</span>
                            <span>Run</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => onRun(`npm run ${name}`)}
                            className="p-1 rounded-lg text-text-muted hover:text-text-main hover:bg-background/80 transition"
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
