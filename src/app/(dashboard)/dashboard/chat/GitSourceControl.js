"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";

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

function getFileIcon(filename = "") {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(ext)) return "code";
  if (["json", "yaml", "yml", "toml"].includes(ext)) return "data_object";
  if (["css", "scss", "sass", "less"].includes(ext)) return "css";
  if (["html", "svg"].includes(ext)) return "html";
  if (["md", "txt", "doc"].includes(ext)) return "article";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "image";
  if (["sh", "bat", "ps1"].includes(ext)) return "terminal";
  return "description";
}

function parseFilePath(filePath = "") {
  const parts = filePath.split(/[/\\]/);
  const name = parts.pop() || filePath;
  const dir = parts.join("/");
  return { name, dir };
}

function GitSourceControlComponent({
  workspacePath,
  activeRepoPath: parentActiveRepoPath,
  onSelectRepoPath,
  knownRepos: parentKnownRepos,
  onUpdateRepos,
  activeModel,
  onStatusChange,
  onViewGraph,
}) {
  const [internalRepoPath, setInternalRepoPath] = useState(parentActiveRepoPath || workspacePath);
  const [internalKnownRepos, setInternalKnownRepos] = useState([]);
  const [gitData, setGitData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(false);
  const [operationText, setOperationText] = useState("");
  const [generatingMessage, setGeneratingMessage] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', text: '' }
  const [stagedExpanded, setStagedExpanded] = useState(true);
  const [unstagedExpanded, setUnstagedExpanded] = useState(true);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Diff viewer state
  const [diffModal, setDiffModal] = useState(null); // { file, staged, content, loading }
  const commitInputRef = useRef(null);
  const dropdownRef = useRef(null);
  const moreMenuRef = useRef(null);

  const activeRepoPath = parentActiveRepoPath || internalRepoPath;

  const setActiveRepoPath = (p) => {
    setInternalRepoPath(p);
    onSelectRepoPath?.(p);
  };

  // Reset internal state and active path when workspacePath changes
  useEffect(() => {
    setInternalKnownRepos([]);
    setGitData(null);
    setNotice(null);
    setInternalRepoPath(parentActiveRepoPath || workspacePath);
  }, [workspacePath, parentActiveRepoPath]);

  const repos = useMemo(() => {
    const list = [
      ...(parentKnownRepos || []),
      ...internalKnownRepos,
      ...(gitData?.repos || []),
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
  }, [parentKnownRepos, internalKnownRepos, gitData?.repos, workspacePath]);

  // Click outside listener for dropdowns
  useEffect(() => {
    if (!repoDropdownOpen && !moreMenuOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setRepoDropdownOpen(false);
      }
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [repoDropdownOpen, moreMenuOpen]);

  const targetPath = activeRepoPath || workspacePath;

  const fetchStatus = async (overridePath = null) => {
    const pathToUse = overridePath || targetPath;
    if (!pathToUse) return;
    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: pathToUse,
          rootPath: workspacePath,
          action: "status",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        setGitData(data);
        if (data.repos?.length) {
          const map = new Map();
          for (const r of data.repos) {
            if (r?.path) map.set(r.path, r);
          }
          const combined = Array.from(map.values());
          setInternalKnownRepos(combined);
          onUpdateRepos?.(combined);

          if (data.repo === false && data.repos.length > 0 && !parentActiveRepoPath) {
            setActiveRepoPath(data.repos[0].path);
          }
        }
        onStatusChange?.(data);
      } else {
        setNotice({ type: "error", text: data.error || "Failed to read git status" });
      }
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Failed to connect to git" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetchStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepoPath]);

  const runGitAction = async (action, params = {}) => {
    if (!targetPath || operating) return null;
    setOperating(true);
    setOperationText(params.label || action);
    setNotice(null);

    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          rootPath: workspacePath,
          action,
          ...params,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || data.error) {
        throw new Error(data.error || `Git ${action} failed`);
      }

      if (data.status) {
        setGitData(data.status);
        if (data.status.repos?.length) {
          const map = new Map();
          for (const r of data.status.repos) {
            if (r?.path) map.set(r.path, r);
          }
          const combined = Array.from(map.values());
          setInternalKnownRepos(combined);
          onUpdateRepos?.(combined);
        }
        onStatusChange?.(data.status);
      } else {
        await fetchStatus();
      }

      if (data.message) {
        setNotice({ type: "success", text: data.message });
      }

      return data;
    } catch (err) {
      setNotice({ type: "error", text: err.message || `Git ${action} failed` });
      return null;
    } finally {
      setOperating(false);
      setOperationText("");
    }
  };

  // Actions
  const handleStageFile = (file) => runGitAction("stage", { file, label: `Staging ${file}` });
  const handleStageAll = () => runGitAction("stage", { file: "all", label: "Staging all changes" });
  
  const handleUnstageFile = (file) => runGitAction("unstage", { file, label: `Unstaging ${file}` });
  const handleUnstageAll = () => runGitAction("unstage", { file: "all", label: "Unstaging all changes" });

  const handleDiscardFile = (file, isUntracked = false) => {
    const ok = globalThis.confirm?.(`Are you sure you want to discard changes in "${file}"?\nThis cannot be undone.`);
    if (!ok) return;
    runGitAction("discard", { file, isUntracked, label: `Discarding ${file}` });
  };

  const handleDiscardAll = () => {
    const ok = globalThis.confirm?.("Are you sure you want to discard ALL unstaged changes?\nThis cannot be undone.");
    if (!ok) return;
    runGitAction("discard", { file: "all", label: "Discarding all changes" });
  };

  const handleCommit = (stageAll = false) => {
    const msg = commitMessage.trim();
    if (!msg) {
      setNotice({ type: "error", text: "Please enter a commit message" });
      commitInputRef.current?.focus();
      return;
    }

    const stagedCount = gitData?.staged?.length || 0;
    const unstagedCount = gitData?.unstaged?.length || 0;

    if (stagedCount === 0) {
      if (unstagedCount === 0) {
        setNotice({ type: "error", text: "No changes to commit" });
        return;
      }
      const ok = globalThis.confirm?.("There are no staged changes to commit.\nWould you like to stage all changes and commit them directly?");
      if (!ok) return;
      stageAll = true;
    }

    runGitAction("commit", { message: msg, stageAll, label: "Committing changes" }).then(() => {
      setCommitMessage("");
    });
  };

  const handleGenerateCommitMessage = async () => {
    if (generatingMessage || operating) return;
    const stagedCount = gitData?.staged?.length || 0;
    const unstagedCount = gitData?.unstaged?.length || 0;
    if (stagedCount === 0 && unstagedCount === 0) {
      setNotice({ type: "error", text: "No changes detected to generate commit message" });
      return;
    }

    setGeneratingMessage(true);
    setNotice(null);

    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: targetPath,
          rootPath: workspacePath,
          action: "generate-commit-message",
          model: activeModel || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to generate commit message");
      }
      if (data.message) {
        setCommitMessage(data.message);
        commitInputRef.current?.focus();
        setNotice({ type: "success", text: "Generated commit message with AI" });
      }
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Failed to generate commit message" });
    } finally {
      setGeneratingMessage(false);
    }
  };

  const handleUndoLastCommit = async () => {
    const lastSummary = gitData?.last || "the most recent commit";
    const ok = globalThis.confirm?.(
      `Undo commit terakhir (${lastSummary})?\n\nPerubahan commit ini akan dikembalikan ke Staged Changes (aman, tidak ada data yang hilang).`
    );
    if (!ok) return;

    const data = await runGitAction("undo-commit", { label: "Undoing commit..." });
    if (data?.undoneMessage) {
      setCommitMessage(data.undoneMessage);
      commitInputRef.current?.focus();
    }
  };

  const handlePush = () => runGitAction("push", { label: "Pushing commits..." });
  const handlePull = () => runGitAction("pull", { label: "Pulling latest changes..." });

  const handleOpenDiff = async (file, staged = false) => {
    setDiffModal({ file, staged, loading: true, content: "" });
    try {
      const res = await fetch("/api/chat/projects/git", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath, action: "diff", file, staged }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && !data.error) {
        setDiffModal((prev) => prev ? { ...prev, loading: false, content: data.diff || "(No differences)" } : null);
      } else {
        setDiffModal((prev) => prev ? { ...prev, loading: false, content: `Error loading diff: ${data.error}` } : null);
      }
    } catch (err) {
      setDiffModal((prev) => prev ? { ...prev, loading: false, content: `Error: ${err.message}` } : null);
    }
  };

  const stagedFiles = gitData?.staged || [];
  const unstagedFiles = gitData?.unstaged || [];
  const hasRepo = gitData?.repo !== false;
  const branchName = gitData?.branch || "HEAD";
  const aheadCount = gitData?.ahead || 0;
  const behindCount = gitData?.behind || 0;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center text-text-muted">
        <span className="material-symbols-outlined text-[20px] animate-spin text-primary">progress_activity</span>
        <p className="mt-2 text-xs">Loading Git repository…</p>
      </div>
    );
  }

  // If this specific path isn't a repo, but multi-repos were discovered in this directory tree:
  if (!hasRepo && repos.length > 0) {
    return (
      <div className="flex h-full flex-col p-4 text-xs">
        <div className="rounded-xl border border-dashed border-border p-4 text-center text-text-muted">
          <span className="material-symbols-outlined text-[28px] text-primary">source_environment</span>
          <p className="mt-2 text-xs font-semibold text-text-main">Multi-Repository Workspace</p>
          <p className="mt-1 text-[11px] text-text-muted">
            The workspace root is not a git repo, but {repos.length} Git repositories were detected inside:
          </p>
          <div className="mt-3 flex flex-col gap-1.5">
            {repos.map((r) => (
              <button
                key={r.path}
                type="button"
                onClick={() => {
                  setActiveRepoPath(r.path);
                }}
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
          <span className="material-symbols-outlined text-[32px] text-text-muted/60">git</span>
          <p className="mt-2 text-xs font-medium text-text-main">Not a Git Repository</p>
          <p className="mt-1 text-[11px]">The current project workspace folder does not contain a .git directory.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col font-sans text-xs select-none">
      {/* VS Code Style Header Toolbar */}
      <div className="flex items-center justify-between border-b border-border/80 bg-background/50 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* Multi-Repo Switcher Dropdown */}
          {repos.length > 1 ? (
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setRepoDropdownOpen((v) => !v)}
                className="flex items-center gap-1.5 rounded-md border border-border bg-sidebar/80 px-2 py-0.5 text-[11px] font-semibold text-text-main hover:bg-sidebar"
                title="Switch repository"
              >
                <span className="truncate max-w-[120px]">
                  {repos.find((r) => r.path === targetPath)?.name || "Repo"}
                </span>
                <span className="material-symbols-outlined text-[13px] text-text-muted">arrow_drop_down</span>
              </button>

              {repoDropdownOpen && (
                <div
                  className="absolute left-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-surface p-1 shadow-2xl backdrop-blur-md"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                    Repositories ({repos.length})
                  </div>
                  {repos.map((r) => (
                    <button
                      key={r.path}
                      type="button"
                      onClick={() => {
                        setActiveRepoPath(r.path);
                        setRepoDropdownOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors ${
                        r.path === targetPath ? "bg-primary/15 text-primary font-semibold" : "text-text-main hover:bg-sidebar"
                      }`}
                    >
                      <span className="truncate">{r.name}</span>
                      <span className="font-mono text-[9px] opacity-60 truncate max-w-[90px]">{r.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <span className="text-[10px] font-bold tracking-wider text-text-muted uppercase">Source Control</span>
          )}

          {(stagedFiles.length > 0 || unstagedFiles.length > 0) && (
            <span className="rounded-full bg-primary/15 px-1.5 py-0.2 text-[9px] font-semibold text-primary">
              {stagedFiles.length + unstagedFiles.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {/* Quick Jump to Graph View */}
          {onViewGraph && (
            <button
              type="button"
              onClick={onViewGraph}
              className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-primary transition-colors"
              title="Open Git Graph & History (Antigravity style)"
            >
              <span className="material-symbols-outlined text-[15px]">schema</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => fetchStatus()}
            disabled={operating}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-text-main disabled:opacity-40"
            title="Refresh"
          >
            <span className={`material-symbols-outlined text-[15px] ${operating && operationText === "status" ? "animate-spin" : ""}`}>
              refresh
            </span>
          </button>
          <button
            type="button"
            onClick={handlePull}
            disabled={operating}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-text-main disabled:opacity-40"
            title="Pull"
          >
            <span className="material-symbols-outlined text-[15px]">cloud_download</span>
          </button>
          <button
            type="button"
            onClick={handlePush}
            disabled={operating}
            className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-text-main disabled:opacity-40"
            title={aheadCount > 0 ? `Push ${aheadCount} commit(s)` : "Push to remote"}
          >
            <span className="material-symbols-outlined text-[15px]">cloud_upload</span>
          </button>

          {/* More Actions Menu (VS Code style ...) */}
          <div className="relative" ref={moreMenuRef}>
            <button
              type="button"
              onClick={() => setMoreMenuOpen((v) => !v)}
              disabled={operating}
              className="flex size-6 items-center justify-center rounded text-text-muted hover:bg-sidebar hover:text-text-main disabled:opacity-40"
              title="Views and More Actions…"
            >
              <span className="material-symbols-outlined text-[15px]">more_horiz</span>
            </button>

            {moreMenuOpen && (
              <div
                className="absolute right-0 top-full z-50 mt-1 w-56 rounded-xl border border-border bg-surface p-1 shadow-2xl backdrop-blur-md"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-text-muted">
                  Commit Actions
                </div>

                {onViewGraph && (
                  <button
                    type="button"
                    onClick={() => {
                      setMoreMenuOpen(false);
                      onViewGraph();
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-main hover:bg-sidebar transition-colors"
                  >
                    <span className="material-symbols-outlined text-[15px] text-purple-400">schema</span>
                    <span className="font-medium">View Git Graph</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleGenerateCommitMessage();
                  }}
                  disabled={generatingMessage || operating}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-primary hover:bg-sidebar transition-colors disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[15px] text-primary">auto_awesome</span>
                  <span className="font-medium">Generate Message (AI)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleUndoLastCommit();
                  }}
                  disabled={!gitData?.last}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-main hover:bg-sidebar transition-colors disabled:opacity-40"
                >
                  <span className="material-symbols-outlined text-[15px] text-amber-500">undo</span>
                  <div className="flex flex-col min-w-0">
                    <span className="font-medium">Undo Last Commit</span>
                    {gitData?.last && (
                      <span className="truncate font-mono text-[9px] text-text-muted">{gitData.last}</span>
                    )}
                  </div>
                </button>

                <div className="my-1 border-t border-border/60" />

                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleStageAll();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-main hover:bg-sidebar transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px] text-text-muted">done_all</span>
                  <span>Stage All Changes</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleUnstageAll();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-main hover:bg-sidebar transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px] text-text-muted">remove_done</span>
                  <span>Unstage All Changes</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    handleDiscardAll();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">delete_sweep</span>
                  <span>Discard All Changes</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Branch & Sync Status Banner */}
      <div className="flex items-center justify-between border-b border-border/60 bg-surface/40 px-3 py-1.5 text-[11px]">
        <div className="flex min-w-0 items-center gap-1.5 font-mono">
          <GitBranchIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate font-medium text-text-main" title={branchName}>
            {branchName}
          </span>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-[10px]">
          {aheadCount > 0 && (
            <span className="flex items-center gap-0.5 rounded bg-emerald-500/10 px-1 py-0.5 font-bold text-emerald-500" title={`${aheadCount} commits ahead`}>
              ↑{aheadCount}
            </span>
          )}
          {behindCount > 0 && (
            <span className="flex items-center gap-0.5 rounded bg-amber-500/10 px-1 py-0.5 font-bold text-amber-500" title={`${behindCount} commits behind`}>
              ↓{behindCount}
            </span>
          )}
          {(aheadCount > 0 || behindCount > 0) && (
            <button
              type="button"
              onClick={handlePush}
              disabled={operating}
              className="rounded bg-primary/20 px-1.5 py-0.5 font-sans text-[10px] font-medium text-primary hover:bg-primary/30"
              title="Sync Changes"
            >
              Sync
            </button>
          )}
        </div>
      </div>

      {/* Notification Toast */}
      {notice && (
        <div className={`mx-2 mt-2 flex items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] ${
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

      {/* Commit Input Box (VS Code Style) */}
      <div className="p-3">
        <div className="relative rounded-lg border border-border bg-background focus-within:border-primary/70 focus-within:ring-1 focus-within:ring-primary/40">
          <textarea
            ref={commitInputRef}
            rows={2}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                e.preventDefault();
                handleCommit();
              }
            }}
            placeholder="Message (Ctrl+Enter to commit)"
            className="w-full resize-none bg-transparent p-2 pr-7 text-xs text-text-main outline-none placeholder:text-text-muted/60"
          />
          {/* Sparkle shortcut button inside the textarea */}
          <button
            type="button"
            onClick={handleGenerateCommitMessage}
            disabled={generatingMessage || operating}
            className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded text-text-muted hover:text-primary hover:bg-sidebar transition-colors disabled:opacity-40"
            title="Generate commit message with AI (Message only)"
          >
            {generatingMessage ? (
              <span className="material-symbols-outlined animate-spin text-[12px] text-primary">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[13px]">auto_awesome</span>
            )}
          </button>
        </div>

        {/* Commit Action Buttons */}
        <div className="mt-2 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleCommit(false)}
            disabled={operating || generatingMessage}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
          >
            {operating ? (
              <span className="material-symbols-outlined animate-spin text-[14px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[15px]">check</span>
            )}
            <span>{operating ? (operationText || "Working…") : "Commit"}</span>
          </button>

          {/* AI Generate Commit Message Button (Beside Commit) */}
          <button
            type="button"
            onClick={handleGenerateCommitMessage}
            disabled={generatingMessage || operating}
            className="flex items-center justify-center rounded-lg border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary hover:bg-primary/20 hover:border-primary/60 disabled:opacity-40 transition-colors shadow-sm"
            title="Generate commit message with AI (Message only - does not commit or push)"
          >
            {generatingMessage ? (
              <span className="material-symbols-outlined animate-spin text-[15px]">progress_activity</span>
            ) : (
              <span className="material-symbols-outlined text-[15px]">auto_awesome</span>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              handleCommit(false);
              setTimeout(() => handlePush(), 800);
            }}
            disabled={operating || generatingMessage}
            className="flex items-center gap-1 rounded-lg border border-border bg-sidebar/70 px-2.5 py-1.5 text-[11px] font-medium text-text-muted hover:bg-sidebar hover:text-text-main disabled:opacity-50"
            title="Commit & Push"
          >
            <span className="material-symbols-outlined text-[14px]">publish</span>
          </button>

          <button
            type="button"
            onClick={handleUndoLastCommit}
            disabled={operating || generatingMessage || !gitData?.last}
            className="flex items-center gap-1 rounded-lg border border-border bg-sidebar/70 px-2.5 py-1.5 text-[11px] font-medium text-text-muted hover:bg-sidebar hover:text-amber-500 hover:border-amber-500/40 disabled:opacity-40 transition-colors"
            title={gitData?.last ? `Undo Last Commit: ${gitData.last}` : "No commits to undo"}
          >
            <span className="material-symbols-outlined text-[14px]">undo</span>
          </button>
        </div>

        {/* Last Commit Info & Undo action (VS Code Source Control style) */}
        {gitData?.last && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-sidebar/50 px-2.5 py-1.5 text-[11px]">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="material-symbols-outlined text-[13px] text-text-muted shrink-0">history</span>
              <span className="truncate font-mono text-[10px] text-text-muted" title={gitData.last}>
                {gitData.last}
              </span>
            </div>
            <button
              type="button"
              onClick={handleUndoLastCommit}
              disabled={operating || generatingMessage}
              className="flex shrink-0 items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-500 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
              title="Undo last commit and keep changes staged"
            >
              <span className="material-symbols-outlined text-[12px]">undo</span>
              <span>Undo Commit</span>
            </button>
          </div>
        )}
      </div>

      {/* Scrollable Changes Section */}
      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1 custom-scrollbar">
        {/* SECTION 1: STAGED CHANGES */}
        <div className="mb-2">
          <div className="group flex items-center justify-between rounded px-2 py-1 hover:bg-sidebar/50">
            <button
              type="button"
              onClick={() => setStagedExpanded((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-text-muted uppercase"
            >
              <span className="material-symbols-outlined text-[13px] transition-transform">
                {stagedExpanded ? "expand_more" : "chevron_right"}
              </span>
              <span>Staged Changes</span>
              <span className="ml-1 rounded-full bg-sidebar px-1.5 py-0.2 text-[9px] font-bold text-text-muted">
                {stagedFiles.length}
              </span>
            </button>

            {stagedFiles.length > 0 && (
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={handleUnstageAll}
                  disabled={operating}
                  className="flex size-5 items-center justify-center rounded text-text-muted hover:text-text-main hover:bg-sidebar"
                  title="Unstage All Changes"
                >
                  <span className="material-symbols-outlined text-[13px]">remove</span>
                </button>
              </div>
            )}
          </div>

          {stagedExpanded && (
            <div className="mt-0.5 space-y-0.5">
              {stagedFiles.length === 0 ? (
                <p className="px-5 py-1 text-[11px] text-text-muted/60 italic">No staged changes</p>
              ) : (
                stagedFiles.map((item) => {
                  const { name, dir } = parseFilePath(item.path);
                  return (
                    <div
                      key={`staged-${item.path}`}
                      className="group flex items-center gap-1.5 rounded px-2 py-1 text-[11px] hover:bg-sidebar transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenDiff(item.path, true)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      >
                        <span className="material-symbols-outlined text-[14px] text-text-muted shrink-0">
                          {getFileIcon(name)}
                        </span>
                        <span className="truncate font-medium text-text-main max-w-[130px]">{name}</span>
                        {dir && <span className="truncate text-[10px] text-text-muted/60 max-w-[100px]">{dir}</span>}
                      </button>

                      {/* Status Badge */}
                      <span className={`font-mono text-[10px] font-bold uppercase shrink-0 px-1 ${
                        item.letter === "A" ? "text-emerald-500" :
                        item.letter === "D" ? "text-red-500" :
                        item.letter === "R" ? "text-blue-500" : "text-amber-500"
                      }`}>
                        {item.letter}
                      </span>

                      {/* Action Icon Group - Fixed Size & Balanced Proportions */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenDiff(item.path, true)}
                          className="flex size-5 items-center justify-center rounded text-text-muted hover:text-text-main hover:bg-background"
                          title="Open Diff"
                        >
                          <span className="material-symbols-outlined text-[13px]">visibility</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleUnstageFile(item.path)}
                          disabled={operating}
                          className="flex size-5 items-center justify-center rounded text-text-muted hover:text-text-main hover:bg-background"
                          title="Unstage Changes"
                        >
                          <span className="material-symbols-outlined text-[13px]">remove</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* SECTION 2: CHANGES (UNSTAGED) */}
        <div>
          <div className="group flex items-center justify-between rounded px-2 py-1 hover:bg-sidebar/50">
            <button
              type="button"
              onClick={() => setUnstagedExpanded((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-bold tracking-wider text-text-muted uppercase"
            >
              <span className="material-symbols-outlined text-[13px] transition-transform">
                {unstagedExpanded ? "expand_more" : "chevron_right"}
              </span>
              <span>Changes</span>
              <span className="ml-1 rounded-full bg-sidebar px-1.5 py-0.2 text-[9px] font-bold text-text-muted">
                {unstagedFiles.length}
              </span>
            </button>

            {unstagedFiles.length > 0 && (
              <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={handleDiscardAll}
                  disabled={operating}
                  className="flex size-5 items-center justify-center rounded text-text-muted hover:text-red-500 hover:bg-sidebar"
                  title="Discard All Changes"
                >
                  <span className="material-symbols-outlined text-[13px]">undo</span>
                </button>
                <button
                  type="button"
                  onClick={handleStageAll}
                  disabled={operating}
                  className="flex size-5 items-center justify-center rounded text-text-muted hover:text-text-main hover:bg-sidebar"
                  title="Stage All Changes"
                >
                  <span className="material-symbols-outlined text-[13px]">add</span>
                </button>
              </div>
            )}
          </div>

          {unstagedExpanded && (
            <div className="mt-0.5 space-y-0.5">
              {unstagedFiles.length === 0 ? (
                <div className="px-5 py-3 text-center text-text-muted/60">
                  <p className="text-[11px] italic">No changes detected</p>
                  <p className="mt-0.5 text-[10px]">Working tree clean</p>
                </div>
              ) : (
                unstagedFiles.map((item) => {
                  const { name, dir } = parseFilePath(item.path);
                  const isUntracked = item.letter === "U";
                  return (
                    <div
                      key={`unstaged-${item.path}`}
                      className="group flex items-center gap-1.5 rounded px-2 py-1 text-[11px] hover:bg-sidebar transition-colors"
                    >
                      <button
                        type="button"
                        onClick={() => handleOpenDiff(item.path, false)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                      >
                        <span className="material-symbols-outlined text-[14px] text-text-muted shrink-0">
                          {getFileIcon(name)}
                        </span>
                        <span className="truncate font-medium text-text-main max-w-[130px]">{name}</span>
                        {dir && <span className="truncate text-[10px] text-text-muted/60 max-w-[100px]">{dir}</span>}
                      </button>

                      {/* Status Badge */}
                      <span className={`font-mono text-[10px] font-bold uppercase shrink-0 px-1 ${
                        isUntracked ? "text-emerald-500" :
                        item.letter === "D" ? "text-red-500" : "text-amber-500"
                      }`}>
                        {item.letter}
                      </span>

                      {/* Action Icon Group - Fixed Size & Balanced Proportions */}
                      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          type="button"
                          onClick={() => handleOpenDiff(item.path, false)}
                          className="flex size-5 items-center justify-center rounded text-text-muted hover:text-text-main hover:bg-background"
                          title="Open Diff"
                        >
                          <span className="material-symbols-outlined text-[13px]">visibility</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDiscardFile(item.path, isUntracked)}
                          disabled={operating}
                          className="flex size-5 items-center justify-center rounded text-text-muted hover:text-red-500 hover:bg-background"
                          title="Discard Changes"
                        >
                          <span className="material-symbols-outlined text-[13px]">undo</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleStageFile(item.path)}
                          disabled={operating}
                          className="flex size-5 items-center justify-center rounded text-text-muted hover:text-text-main hover:bg-background"
                          title="Stage Changes"
                        >
                          <span className="material-symbols-outlined text-[13px]">add</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* VS Code Style Diff Viewer Modal */}
      {diffModal && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setDiffModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Diff Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">difference</span>
                <p className="truncate font-mono text-xs font-semibold text-text-main">{diffModal.file}</p>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                  diffModal.staged ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-500"
                }`}>
                  {diffModal.staged ? "Staged" : "Working Tree"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {diffModal.staged ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleUnstageFile(diffModal.file);
                      setDiffModal(null);
                    }}
                    className="rounded-lg border border-border bg-sidebar px-2.5 py-1 text-xs font-medium hover:bg-background"
                  >
                    Unstage
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      handleStageFile(diffModal.file);
                      setDiffModal(null);
                    }}
                    className="rounded-lg bg-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-primary/90"
                  >
                    Stage
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setDiffModal(null)}
                  className="rounded p-1 text-text-muted hover:text-text-main"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
              </div>
            </div>

            {/* Diff Body with Syntax Highlighting */}
            <div className="min-h-0 flex-1 overflow-auto bg-[#0d1117] p-3 font-mono text-[11px] leading-5 text-gray-200">
              {diffModal.loading ? (
                <div className="flex items-center justify-center p-8 text-text-muted">
                  <span className="material-symbols-outlined animate-spin text-[20px] text-primary">progress_activity</span>
                  <span className="ml-2">Computing diff…</span>
                </div>
              ) : (
                <div className="space-y-0.5 whitespace-pre">
                  {diffModal.content.split("\n").map((line, idx) => {
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

export default memo(GitSourceControlComponent);
