"use client";

import { useEffect, useMemo, useState } from "react";

const TABS = [
  { id: "info", label: "Info", icon: "info" },
  { id: "plan", label: "Plan", icon: "list_alt" },
  { id: "git", label: "Git", icon: "git_branch" },
  { id: "changes", label: "Changes", icon: "edit" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "scripts", label: "Scripts", icon: "play_arrow" },
  { id: "tools", label: "Tools", icon: "handyman" },
];

export default function ProjectSidebar({ workspacePath, sessionId, refreshKey, messages, onRun, onClose }) {
  const [tab, setTab] = useState("info");
  const [data, setData] = useState(null);
  const [tree, setTree] = useState({});
  const [openDirs, setOpenDirs] = useState({});

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
        <button onClick={onClose} className="text-text-muted hover:text-text-main"><span className="material-symbols-outlined text-[18px]">close</span></button>
      </div>

      {/* Improved Tab Navigation */}
      <div className="relative overflow-x-auto border-b border-border bg-background/40">
        <div className="flex min-w-max gap-1 px-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`
                group relative flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-medium transition-all duration-200
                ${tab === t.id 
                  ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/20" 
                  : "text-text-muted hover:bg-background/60 hover:text-foreground"
                }
              `}
            >
              <span className={`transition-transform duration-200 ${tab === t.id ? "scale-110" : "group-hover:scale-105"}`}>
                <span className="material-symbols-outlined text-[14px]">{t.icon}</span>
              </span>
              <span className="whitespace-nowrap">{t.label}</span>
              
              {t.id === "changes" && changedFiles.length > 0 ? (
                <span className="ml-0.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[9px] font-bold text-primary ring-1 ring-primary/30">
                  {changedFiles.length}
                </span>
              ) : null}
              
              {tab === t.id && (
                <span className="absolute -bottom-1 left-1/2 h-0.5 w-8 -translate-x-1/2 translate-y-full rounded-t bg-primary opacity-60"></span>
              )}
            </button>
          ))}
        </div>
      </div>

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
        ) : tab === "git" ? (
          git.repo ? (
            <div className="space-y-3 text-xs">
              {/* Branch Section */}
              <div className="rounded-lg bg-background/60 p-2">
                <div className="mb-2 flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-primary">git_branch</span>
                  <span className="font-medium text-primary">{git.branch}</span>
                  {git.ahead ? (
                    <span className="rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-bold text-emerald-600 ring-1 ring-emerald-500/30">
                      ↑{git.ahead}
                    </span>
                  ) : null}
                  {git.behind ? (
                    <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-600 ring-1 ring-amber-500/30">
                      ↓{git.behind}
                    </span>
                  ) : null}
                </div>
                {git.last ? <p className="truncate font-mono text-[10px] text-text-muted">{git.last}</p> : null}
              </div>

              {/* Changes Section */}
              <div>
                <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">Changes</p>
                <div className="space-y-1">
                  {(git.changes || []).map((c) => (
                    <div key={c.path} className="flex items-center gap-2 font-mono text-[10px]">
                      <span className="w-16 shrink-0 uppercase text-text-muted">{c.status}</span>
                      <span className="truncate">{c.path}</span>
                    </div>
                  ))}
                  {(git.changes || []).length === 0 ? <p className="text-text-muted">Working tree clean</p> : null}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-text-muted">Not a git repository.</p>
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
    </aside>
  );
}
