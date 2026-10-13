"use client";

import { memo, useEffect, useMemo, useState } from "react";
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
  { id: "scripts", label: "Scripts", icon: "play_arrow" },
  { id: "tools", label: "Tools", icon: "handyman" },
];

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

  useEffect(() => {
    if (initialTab) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (!workspacePath) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
            Object.keys(scripts).length ? (
              <div className="space-y-1.5">
                {Object.entries(scripts).map(([name, cmd]) => (
                  <div key={name} className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-2 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium">{name}</p>
                      <p className="truncate font-mono text-[10px] text-text-muted">{cmd}</p>
                    </div>
                    <button onClick={() => onRun(cmd)} className="material-symbols-outlined text-[16px] text-primary hover:text-text-main" title={`Run ${cmd}`}>play_arrow</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-text-muted">No npm scripts found.</p>
            )
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
