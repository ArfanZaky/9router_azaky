"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

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

function CloudIcon({ className = "h-3 w-3" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
    </svg>
  );
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return "";
  const time = typeof timestamp === "number" ? timestamp : new Date(timestamp).getTime();
  if (Number.isNaN(time)) return "";
  const diffSec = Math.max(1, Math.floor((Date.now() - time) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo`;
}

function parseFilePath(filePath = "") {
  const parts = filePath.split(/[/\\]/);
  const name = parts.pop() || filePath;
  const dir = parts.join("/");
  return { name, dir };
}

function GitGraphViewComponent({
  workspacePath,
  activeRepoPath: parentActiveRepoPath,
  onSelectRepoPath,
  knownRepos: parentKnownRepos,
  onUpdateRepos,
  onPushSuccess,
  onViewGit,
}) {
  const [internalRepoPath, setInternalRepoPath] = useState(parentActiveRepoPath || workspacePath);
  const [internalKnownRepos, setInternalKnownRepos] = useState([]);
  const [graphData, setGraphData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(false);
  const [operationText, setOperationText] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [notice, setNotice] = useState(null);

  // Dropdowns & Modals
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [branchDropdownOpen, setBranchDropdownOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [selectedCommitHash, setSelectedCommitHash] = useState(null);
  const [commitDetail, setCommitDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [fileDiffModal, setFileDiffModal] = useState(null); // { file, content, loading }

  const repoDropdownRef = useRef(null);
  const branchDropdownRef = useRef(null);
  const moreMenuRef = useRef(null);
  const headRef = useRef(null);

  const activeRepoPath = parentActiveRepoPath || internalRepoPath;

  // Reset internal state and active path when workspacePath changes
  useEffect(() => {
    setInternalKnownRepos([]);
    setGraphData(null);
    setSelectedCommitHash(null);
    setCommitDetail(null);
    setNotice(null);
    setInternalRepoPath(parentActiveRepoPath || workspacePath);
  }, [workspacePath, parentActiveRepoPath]);

  // Combined repos list strictly bounded to current workspacePath
  const repos = useMemo(() => {
    const list = [
      ...(parentKnownRepos || []),
      ...internalKnownRepos,
      ...(graphData?.repos || []),
    ];
    const map = new Map();
    const normWorkspace = (workspacePath || "").replace(/[/\\]+/g, "/").toLowerCase().replace(/\/+$/, "");
    for (const r of list) {
      if (!r?.path) continue;
      const normPath = r.path.replace(/[/\\]+/g, "/").toLowerCase().replace(/\/+$/, "");
      // Strictly only keep repos that are inside workspacePath, or if workspacePath is inside the repo
      if (normWorkspace && !normPath.startsWith(normWorkspace) && !normWorkspace.startsWith(normPath)) {
        continue;
      }
      map.set(r.path, r);
    }
    return Array.from(map.values());
  }, [parentKnownRepos, internalKnownRepos, graphData?.repos, workspacePath]);

  // Click outside listener for dropdowns
  useEffect(() => {
    if (!repoDropdownOpen && !branchDropdownOpen && !moreMenuOpen) return;
    const handleClickOutside = (e) => {
      if (repoDropdownRef.current && !repoDropdownRef.current.contains(e.target)) {
        setRepoDropdownOpen(false);
      }
      if (branchDropdownRef.current && !branchDropdownRef.current.contains(e.target)) {
        setBranchDropdownOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [repoDropdownOpen, branchDropdownOpen, moreMenuOpen]);

  const targetPath = activeRepoPath || workspacePath;

  const fetchGraph = useCallback(async (overridePath = null) => {
    const pathToUse = overridePath || targetPath;
    if (!pathToUse) return;
    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: pathToUse,
          rootPath: workspacePath,
          action: "graph",
          maxCount: 90,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        setGraphData(data);
        if (data.repos?.length) {
          const map = new Map();
          for (const r of data.repos) {
            if (r?.path) map.set(r.path, r);
          }
          const combined = Array.from(map.values());
          setInternalKnownRepos(combined);
          onUpdateRepos?.(combined);

          // If current target path is not a repo, but multi-repos exist, auto-select first repo
          if (data.repo === false && data.repos.length > 0) {
            const first = data.repos[0];
            setInternalRepoPath(first.path);
            onSelectRepoPath?.(first.path);
          }
        }
      } else {
        setNotice({ type: "error", text: data.error || "Failed to load git graph" });
      }
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Failed to connect to git" });
    } finally {
      setLoading(false);
    }
  }, [targetPath, workspacePath, onUpdateRepos, onSelectRepoPath]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchGraph();
  }, [activeRepoPath, fetchGraph]);

  // Auto-refresh interval
  useEffect(() => {
    if (!autoRefresh || !targetPath) return;
    const timer = setInterval(() => {
      fetchGraph();
    }, 7000);
    return () => clearInterval(timer);
  }, [autoRefresh, targetPath, fetchGraph]);

  const handleSelectRepo = (path) => {
    setInternalRepoPath(path);
    onSelectRepoPath?.(path);
    setRepoDropdownOpen(false);
    setSelectedCommitHash(null);
    setCommitDetail(null);
    fetchGraph(path);
  };

  // Fetch commit details when clicked
  const handleSelectCommit = async (hash) => {
    if (selectedCommitHash === hash && commitDetail) {
      setSelectedCommitHash(null);
      setCommitDetail(null);
      return;
    }
    setSelectedCommitHash(hash);
    setLoadingDetail(true);
    setCommitDetail(null);

    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          action: "commit-detail",
          hash,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        setCommitDetail(data);
      } else {
        setNotice({ type: "error", text: data.error || "Failed to load commit detail" });
      }
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Error reading commit" });
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleOpenFileDiff = async (hash, file) => {
    setFileDiffModal({ file, loading: true, content: "" });
    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          action: "commit-diff",
          hash,
          file,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        setFileDiffModal({ file, loading: false, content: data.diff || "(No differences)" });
      } else {
        setFileDiffModal({ file, loading: false, content: `Error: ${data.error}` });
      }
    } catch (err) {
      setFileDiffModal({ file, loading: false, content: `Error: ${err.message}` });
    }
  };

  const handlePush = async () => {
    if (operating) return;
    setOperating(true);
    setOperationText("Pushing commits…");
    setNotice(null);
    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          action: "push",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Push failed");
      setNotice({ type: "success", text: data.message || "Pushed successfully" });
      await fetchGraph();
      onPushSuccess?.();
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Push failed" });
    } finally {
      setOperating(false);
      setOperationText("");
    }
  };

  const handlePull = async () => {
    if (operating) return;
    setOperating(true);
    setOperationText("Pulling latest changes…");
    setNotice(null);
    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          action: "pull",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Pull failed");
      setNotice({ type: "success", text: data.message || "Pull completed" });
      await fetchGraph();
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Pull failed" });
    } finally {
      setOperating(false);
      setOperationText("");
    }
  };

  const handleCheckoutBranch = async (branchName) => {
    if (operating || !branchName) return;
    setBranchDropdownOpen(false);
    setOperating(true);
    setOperationText(`Switching to ${branchName}…`);
    setNotice(null);
    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          action: "checkout",
          branch: branchName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || "Checkout failed");
      setNotice({ type: "success", text: `Switched to ${branchName}` });
      await fetchGraph();
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Checkout failed" });
    } finally {
      setOperating(false);
      setOperationText("");
    }
  };

  const handleJumpToHead = () => {
    headRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const currentRepoName = useMemo(() => {
    const found = repos.find((r) => r.path === targetPath);
    if (found?.name) return found.name;
    if (graphData?.name) return graphData.name;
    const parts = (targetPath || "").split(/[/\\]/).filter(Boolean);
    return parts.pop() || "Repo";
  }, [repos, targetPath, graphData]);

  const branchName = graphData?.branch || "HEAD";
  const upstream = graphData?.upstream || "";
  const aheadCount = graphData?.ahead || 0;
  const behindCount = graphData?.behind || 0;
  const commits = graphData?.commits || [];
  const branches = graphData?.branches || [];
  const outgoingCommits = graphData?.outgoingCommits || [];
  const hasRepo = graphData?.repo !== false;

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center text-text-muted">
        <span className="material-symbols-outlined text-[20px] animate-spin text-primary">progress_activity</span>
        <p className="mt-2 text-xs">Loading Git history graph…</p>
      </div>
    );
  }

  // Multi-repo picker when current path is not a repo, but sub-repos exist
  if (!hasRepo && repos.length > 0) {
    return (
      <div className="flex h-full flex-col p-4 text-xs">
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-text-muted">
          <span className="material-symbols-outlined text-[28px] text-primary">schema</span>
          <p className="mt-2 text-xs font-semibold text-text-main">Multi-Repository Workspace</p>
          <p className="mt-1 text-[11px] text-text-muted">
            The workspace root is not a Git repo, but {repos.length} Git repositories were detected. Select one to view its Graph:
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {repos.map((r) => (
              <button
                key={r.path}
                type="button"
                onClick={() => handleSelectRepo(r.path)}
                className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left hover:border-primary/50 hover:bg-sidebar transition-all"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate font-semibold text-text-main">{r.name}</span>
                  <span className="truncate font-mono text-[10px] text-text-muted">{r.label}</span>
                </div>
                <span className="material-symbols-outlined text-[16px] text-text-muted">chevron_right</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!hasRepo && repos.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-xl border border-dashed border-border p-6 text-center text-text-muted">
          <span className="material-symbols-outlined text-[32px] text-text-muted/60">schema</span>
          <p className="mt-2 text-xs font-medium text-text-main">No Git Repository</p>
          <p className="mt-1 text-[11px]">The current project workspace folder does not contain a .git directory.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col font-sans text-xs select-none bg-background">
      {/* ── Antigravity Style Header Toolbar ─────────────────────────────── */}
      <div className="flex items-center justify-between border-b border-border/80 bg-background/60 px-3 py-2 shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          {/* Chevron / Title */}
          <div className="flex items-center gap-1 text-[11px] font-bold text-text-main">
            <span className="material-symbols-outlined text-[15px] text-text-muted">expand_more</span>
            <span>Graph</span>
          </div>

          {/* Repo Name / Multi-Repo Switcher Dropdown (Antigravity Style) */}
          <div className="relative" ref={repoDropdownRef}>
            <button
              type="button"
              onClick={() => repos.length > 1 && setRepoDropdownOpen((v) => !v)}
              className={`flex items-center gap-1.5 rounded-md border border-border bg-sidebar/80 px-2 py-0.5 text-[11px] font-medium text-text-main transition-colors ${
                repos.length > 1 ? "hover:bg-sidebar hover:border-primary/50 cursor-pointer" : "cursor-default"
              }`}
              title={`Switch Repository (Current: ${currentRepoName})`}
            >
              <span className="material-symbols-outlined text-[13px] text-primary shrink-0">
                {repos.length > 1 ? "source_environment" : "description"}
              </span>
              <span className="truncate max-w-[120px] font-medium text-[11px]">{currentRepoName}</span>
              {repos.length > 1 && (
                <span className="material-symbols-outlined text-[13px] text-text-muted">arrow_drop_down</span>
              )}
            </button>

            {repoDropdownOpen && (
              <div
                className="absolute left-0 top-full z-50 mt-1 w-60 rounded-xl border border-border bg-surface p-1 shadow-2xl backdrop-blur-md"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-muted border-b border-border/40">
                  <span>Repositories ({repos.length})</span>
                  <span className="text-[9px] font-normal text-text-muted/70">Select repo</span>
                </div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar p-0.5 space-y-0.5">
                  {repos.map((r) => {
                    const isSelected = r.path === targetPath;
                    return (
                      <button
                        key={r.path}
                        type="button"
                        onClick={() => handleSelectRepo(r.path)}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
                          isSelected
                            ? "bg-primary/15 text-primary font-semibold border border-primary/20"
                            : "text-text-main hover:bg-sidebar"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`material-symbols-outlined text-[13px] ${isSelected ? "text-primary" : "text-text-muted"}`}>
                            {r.isRoot ? "home_work" : "folder"}
                          </span>
                          <span className="truncate">{r.name}</span>
                        </div>
                        <span className="font-mono text-[9px] opacity-60 truncate max-w-[85px]">{r.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Auto Refresh Toggle Badge */}
          <button
            type="button"
            onClick={() => setAutoRefresh((v) => !v)}
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${
              autoRefresh
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                : "bg-sidebar text-text-muted border border-border"
            }`}
            title={autoRefresh ? "Auto-refresh active (every 7s)" : "Auto-refresh paused"}
          >
            Auto
          </button>
        </div>

        {/* Right Action Icons (Target, Branches, Merge/Sync, Push, Refresh, ...) */}
        <div className="flex items-center gap-0.5">
          {/* Target / Focus HEAD */}
          <button
            type="button"
            onClick={handleJumpToHead}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-text-main transition-colors"
            title="Focus Current HEAD"
          >
            <span className="material-symbols-outlined text-[15px]">my_location</span>
          </button>

          {/* Branch Switcher Dropdown */}
          <div className="relative" ref={branchDropdownRef}>
            <button
              type="button"
              onClick={() => setBranchDropdownOpen((v) => !v)}
              className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-text-main transition-colors"
              title={`Switch Branch (current: ${branchName})`}
            >
              <span className="material-symbols-outlined text-[15px]">call_split</span>
            </button>

            {branchDropdownOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-60 rounded-xl border border-border bg-surface p-1 shadow-2xl backdrop-blur-md"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  Branches
                </div>
                <div className="max-h-56 overflow-y-auto custom-scrollbar">
                  {branches.length === 0 ? (
                    <p className="px-2 py-1 text-[11px] text-text-muted">No branches found</p>
                  ) : (
                    branches.map((b) => (
                      <button
                        key={b.name}
                        type="button"
                        onClick={() => handleCheckoutBranch(b.name)}
                        className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
                          b.name === branchName ? "bg-primary/15 text-primary font-semibold" : "text-text-main hover:bg-sidebar"
                        }`}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <GitBranchIcon className="h-3 w-3 shrink-0 opacity-70" />
                          <span className="truncate">{b.name}</span>
                        </div>
                        {b.current && <span className="text-[9px] font-bold text-primary">current</span>}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Sync / Merge / Pull Icon */}
          <button
            type="button"
            onClick={handlePull}
            disabled={operating}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-text-main disabled:opacity-40 transition-colors"
            title={behindCount > 0 ? `Pull ${behindCount} incoming commit(s)` : "Pull from remote"}
          >
            <span className="material-symbols-outlined text-[15px]">call_merge</span>
          </button>

          {/* Outgoing Push Icon */}
          <button
            type="button"
            onClick={handlePush}
            disabled={operating}
            className={`relative flex size-6 items-center justify-center rounded transition-colors ${
              aheadCount > 0
                ? "text-sky-400 bg-sky-500/15 hover:bg-sky-500/25"
                : "text-text-muted hover:bg-sidebar hover:text-text-main disabled:opacity-40"
            }`}
            title={aheadCount > 0 ? `Push ${aheadCount} outgoing commit(s)` : "Push to remote"}
          >
            <span className="material-symbols-outlined text-[15px]">cloud_upload</span>
            {aheadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex size-3.5 items-center justify-center rounded-full bg-sky-500 text-[8px] font-bold text-white shadow">
                {aheadCount}
              </span>
            )}
          </button>

          {/* Refresh Icon */}
          <button
            type="button"
            onClick={() => fetchGraph()}
            disabled={operating}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-text-main disabled:opacity-40 transition-colors"
            title="Refresh Graph"
          >
            <span className={`material-symbols-outlined text-[15px] ${operating ? "animate-spin text-primary" : ""}`}>
              refresh
            </span>
          </button>

          {/* More Actions Menu (...) */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setMoreMenuOpen((v) => !v)}
              className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-text-main transition-colors"
              title="More Actions…"
            >
              <span className="material-symbols-outlined text-[15px]">more_horiz</span>
            </button>

            {moreMenuOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-border bg-surface p-1 shadow-2xl backdrop-blur-md"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onViewGit?.();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-main hover:bg-sidebar transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px] text-primary">commit</span>
                  <span>Open Changes & Commit</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handlePull();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-main hover:bg-sidebar transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">cloud_download</span>
                  <span>Pull Latest</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handlePush();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-main hover:bg-sidebar transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">cloud_upload</span>
                  <span>Push Commits</span>
                </button>
                <div className="my-1 border-t border-border/60" />
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    navigator.clipboard?.writeText(branchName);
                    setNotice({ type: "success", text: `Copied branch "${branchName}"` });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-muted hover:bg-sidebar hover:text-text-main transition-colors"
                >
                  <span className="material-symbols-outlined text-[14px]">content_copy</span>
                  <span>Copy Branch Name</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Notice Toast */}
      {notice && (
        <div className={`mx-3 mt-2 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${
          notice.type === "error"
            ? "border-red-500/30 bg-red-500/10 text-red-500"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        }`}>
          <span className="material-symbols-outlined text-[14px]">
            {notice.type === "error" ? "error" : "check_circle"}
          </span>
          <span className="flex-1 break-words">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="opacity-70 hover:opacity-100">
            <span className="material-symbols-outlined text-[13px]">close</span>
          </button>
        </div>
      )}

      {/* Operation Status banner */}
      {operating && (
        <div className="flex items-center gap-2 border-b border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[11px] text-sky-400">
          <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>
          <span>{operationText || "Executing git action…"}</span>
        </div>
      )}

      {/* ── Graph Tree & History Timeline ────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 custom-scrollbar">
        {/* SECTION 1: OUTGOING CHANGES (if any ahead commits or unpushed) */}
        {aheadCount > 0 && (
          <div className="mb-1">
            {/* Outgoing Header Row with Dashed Circle */}
            <div className="group flex items-center justify-between rounded-lg px-1.5 py-1 hover:bg-sidebar/40 transition-colors">
              <div className="flex items-center gap-2 min-w-0">
                {/* Dashed Circle Node */}
                <div className="relative flex size-4 items-center justify-center shrink-0">
                  <div className="size-3.5 rounded-full border-2 border-dashed border-sky-400 flex items-center justify-center">
                    <span className="size-1 rounded-full bg-sky-400" />
                  </div>
                </div>

                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-semibold text-text-main text-[11px]">Outgoing Changes</span>
                  <span className="text-[11px] font-mono text-text-muted">{branchName}</span>
                </div>
              </div>

              {/* Push Button */}
              <button
                type="button"
                onClick={handlePush}
                disabled={operating}
                className="flex items-center gap-1 rounded border border-sky-400/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-400 hover:bg-sky-500/20 disabled:opacity-40 transition-colors shadow-sm"
                title="Push outgoing commits to upstream"
              >
                <span className="material-symbols-outlined text-[12px]">upload</span>
                <span>Push ↑{aheadCount}</span>
              </button>
            </div>

            {/* Outgoing Commits List with Blue Stem Line */}
            <div className="relative ml-2 border-l-2 border-dashed border-sky-400/80 pl-3 space-y-1 my-1">
              {outgoingCommits.map((c, idx) => {
                const isSelected = selectedCommitHash === c.hash;
                const isFirst = idx === 0;

                return (
                  <div
                    key={c.hash}
                    onClick={() => handleSelectCommit(c.hash)}
                    className={`group flex items-center justify-between gap-2 rounded-lg px-2 py-1 cursor-pointer transition-colors ${
                      isSelected
                        ? "bg-sky-500/15 border border-sky-500/30 text-text-main"
                        : "hover:bg-sidebar text-text-main"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {/* Node Bullet */}
                      <span className="relative -ml-[19px] flex size-3 items-center justify-center shrink-0 bg-background">
                        {isFirst ? (
                          <span className="size-3 rounded-full border-2 border-sky-400 bg-background" />
                        ) : (
                          <span className="size-2 rounded-full bg-sky-400" />
                        )}
                      </span>

                      {/* Commit Subject & Author */}
                      <span className="truncate text-[11px] font-medium" title={c.subject}>
                        {c.subject}
                      </span>
                      <span className="truncate text-[10px] text-text-muted shrink-0">
                        {c.author}
                      </span>
                    </div>

                    {/* Badge: (@) main for local branch head */}
                    {isFirst && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-sky-400/50 bg-sky-500/15 px-2 py-0.2 font-mono text-[9px] font-semibold text-sky-400">
                        <span className="material-symbols-outlined text-[10px]">adjust</span>
                        <span>{branchName}</span>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* SECTION 2: COMMIT HISTORY GRAPH (Antigravity Style) */}
        <div className="relative">
          {commits.length === 0 ? (
            <div className="p-6 text-center text-text-muted">
              <p className="text-[11px]">No commits in repository history yet.</p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {commits.map((c, idx) => {
                const isSelected = selectedCommitHash === c.hash;
                const isHead = c.isHead || (idx === 0 && aheadCount === 0);
                const hasRemoteBranch = c.remoteBranches?.length > 0;
                const hasTag = c.tags?.length > 0;
                const isOutgoing = c.isOutgoing;

                return (
                  <div key={c.hash} ref={isHead ? headRef : null} className="relative">
                    <div
                      onClick={() => handleSelectCommit(c.hash)}
                      className={`group flex items-center justify-between gap-2 rounded-lg px-2 py-1 cursor-pointer transition-colors ${
                        isSelected
                          ? "bg-purple-500/15 border border-purple-500/30 text-text-main shadow-sm"
                          : "hover:bg-sidebar text-text-main"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {/* Connected Vertical Branch Line & Colored Node */}
                        <div className="relative flex items-center justify-center shrink-0 w-3">
                          {/* Continuous vertical line connecting commits */}
                          {idx < commits.length - 1 && (
                            <div className="absolute top-2 bottom-[-18px] w-0.5 bg-purple-500/40" />
                          )}
                          {/* Colored Dot Node */}
                          {isOutgoing ? (
                            <span className="relative z-10 size-2.5 rounded-full border-2 border-sky-400 bg-background" />
                          ) : (
                            <span className="relative z-10 size-2.5 rounded-full bg-purple-400" />
                          )}
                        </div>

                        {/* Commit Title */}
                        <span
                          className={`truncate text-[11px] font-medium max-w-[200px] sm:max-w-[280px] ${
                            isHead ? "text-primary font-semibold" : "text-text-main"
                          }`}
                          title={`${c.shortHash} - ${c.subject}`}
                        >
                          {c.subject}
                        </span>

                        {/* Author */}
                        <span className="truncate text-[10px] text-text-muted/70 shrink-0 hidden sm:inline">
                          {c.author}
                        </span>
                      </div>

                      {/* Right Tag Badges: Remote Head, Local Branch, Tags, Relative Time */}
                      <div className="flex items-center gap-1 shrink-0">
                        {/* Remote Branch Tag Badge (e.g. origin/main - purple pill with cloud icon) */}
                        {hasRemoteBranch && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-purple-500/40 bg-purple-500/15 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-purple-300"
                            title={c.remoteBranches.join(", ")}
                          >
                            <CloudIcon className="h-2.5 w-2.5 shrink-0" />
                            <span className="truncate max-w-[80px]">{c.remoteBranches[0]}</span>
                          </span>
                        )}

                        {/* Local Head Badge (@ main) */}
                        {isHead && !isOutgoing && (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-sky-400/40 bg-sky-500/15 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-sky-400">
                            <span className="material-symbols-outlined text-[10px]">adjust</span>
                            <span>{branchName}</span>
                          </span>
                        )}

                        {/* Tags */}
                        {hasTag && (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-amber-400">
                            <span className="material-symbols-outlined text-[10px]">label</span>
                            <span>{c.tags[0]}</span>
                          </span>
                        )}

                        {/* Relative Time */}
                        <span className="font-mono text-[9px] text-text-muted/60 min-w-[24px] text-right">
                          {formatRelativeTime(c.timestamp)}
                        </span>
                      </div>
                    </div>

                    {/* Inline Expanded Commit Details (when selected) */}
                    {isSelected && (
                      <div className="my-1.5 ml-4 rounded-xl border border-purple-500/30 bg-purple-500/[0.04] p-3 shadow-inner">
                        {loadingDetail ? (
                          <div className="flex items-center gap-2 py-2 text-text-muted">
                            <span className="material-symbols-outlined text-[15px] animate-spin text-primary">progress_activity</span>
                            <span>Loading commit changes…</span>
                          </div>
                        ) : commitDetail ? (
                          <div className="space-y-2">
                            {/* Metadata */}
                            <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2">
                              <div className="flex items-center gap-1.5">
                                <span className="font-mono text-[10px] font-bold text-primary select-all">
                                  {commitDetail.shortHash}
                                </span>
                                <span className="text-[10px] text-text-muted">by</span>
                                <span className="font-medium text-[10px] text-text-main">{commitDetail.author}</span>
                              </div>
                              <span className="font-mono text-[10px] text-text-muted">
                                {new Date(commitDetail.timestamp).toLocaleString()}
                              </span>
                            </div>

                            {/* Full Commit Message */}
                            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-text-main/90 leading-relaxed bg-black/30 p-2 rounded-lg border border-white/5">
                              {commitDetail.message || c.subject}
                            </pre>

                            {/* Changed Files */}
                            <div className="space-y-1 pt-1">
                              <div className="flex items-center justify-between text-[10px] font-semibold text-text-muted uppercase">
                                <span>Changed Files ({commitDetail.files?.length || 0})</span>
                                <span className="text-[9px] normal-case opacity-70">Click to view diff</span>
                              </div>

                              <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-0.5">
                                {commitDetail.files?.map((f) => {
                                  const { name, dir } = parseFilePath(f.path);
                                  return (
                                    <button
                                      key={f.path}
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleOpenFileDiff(commitDetail.hash, f.path);
                                      }}
                                      className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11px] hover:bg-sidebar transition-colors group"
                                    >
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <span className={`font-mono text-[10px] font-bold ${
                                          f.status === "A" ? "text-emerald-400" :
                                          f.status === "D" ? "text-red-400" :
                                          f.status === "R" ? "text-blue-400" : "text-amber-400"
                                        }`}>
                                          {f.status}
                                        </span>
                                        <span className="truncate font-medium text-text-main">{name}</span>
                                        {dir && <span className="truncate font-mono text-[9px] text-text-muted opacity-60">{dir}</span>}
                                      </div>
                                      <span className="material-symbols-outlined text-[13px] text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                                        visibility
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── File Diff Modal Viewer ────────────────────────────────────────── */}
      {fileDiffModal && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setFileDiffModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">difference</span>
                <p className="truncate font-mono text-xs font-semibold text-text-main">{fileDiffModal.file}</p>
                <span className="rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-purple-400 font-mono">
                  {selectedCommitHash?.slice(0, 8)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setFileDiffModal(null)}
                className="rounded p-1 text-text-muted hover:text-text-main"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-[#0d1117] p-3 font-mono text-[11px] leading-5 text-gray-200">
              {fileDiffModal.loading ? (
                <div className="flex items-center justify-center p-8 text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-[20px] text-primary">progress_activity</span>
                  <span className="ml-2">Computing commit diff…</span>
                </div>
              ) : (
                <div className="space-y-0.5 whitespace-pre">
                  {fileDiffModal.content.split("\n").map((line, idx) => {
                    const isAdd = line.startsWith("+") && !line.startsWith("+++");
                    const isDel = line.startsWith("-") && !line.startsWith("---");
                    const isHunk = line.startsWith("@@");
                    const isHeader = line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ");

                    let lineStyle = "text-gray-300";
                    let bgStyle = "";

                    if (isAdd) {
                      lineStyle = "text-emerald-400";
                      bgStyle = "bg-emerald-950/40";
                    } else if (isDel) {
                      lineStyle = "text-red-400";
                      bgStyle = "bg-red-950/40";
                    } else if (isHunk) {
                      lineStyle = "text-cyan-400 font-semibold";
                      bgStyle = "bg-cyan-950/20";
                    } else if (isHeader) {
                      lineStyle = "text-gray-500 font-semibold";
                    }

                    return (
                      <div key={idx} className={`px-2 py-0.2 ${bgStyle} ${lineStyle}`}>
                        <span className="mr-3 inline-block w-8 select-none text-right opacity-30">{idx + 1}</span>
                        {line || " "}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(GitGraphViewComponent);
