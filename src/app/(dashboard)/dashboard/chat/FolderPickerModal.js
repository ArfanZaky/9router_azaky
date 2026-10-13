"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { Button } from "@/shared/components";

export default function FolderPickerModal({
  isOpen,
  initialPath = "",
  onSelect,
  onClose,
}) {
  const [currentPath, setCurrentPath] = useState(initialPath || "");
  const [parentPath, setParentPath] = useState(null);
  const [drives, setDrives] = useState([]);
  const [shortcuts, setShortcuts] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterQuery, setFilterQuery] = useState("");
  const [inputPath, setInputPath] = useState(initialPath || "");
  const [selectedFolder, setSelectedFolder] = useState(initialPath || "");

  const loadDirectory = useCallback(async (targetPath) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/chat/projects/browse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: targetPath || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Unable to browse folder");
      }
      setCurrentPath(data.currentPath || "");
      setInputPath(data.currentPath || "");
      setSelectedFolder(data.currentPath || "");
      setParentPath(data.parentPath || null);
      setDrives(data.drives || []);
      setShortcuts(data.shortcuts || []);
      setFolders(data.folders || []);
      if (data.error) {
        setError(data.error);
      }
    } catch (err) {
      setError(err?.message || "Failed to load directory");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadDirectory(initialPath || "");
      setFilterQuery("");
    }
  }, [isOpen, initialPath, loadDirectory]);

  const filteredFolders = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, filterQuery]);

  const handleNavigate = (path) => {
    setFilterQuery("");
    loadDirectory(path);
  };

  const handleManualPathSubmit = (e) => {
    e.preventDefault();
    if (inputPath.trim()) {
      handleNavigate(inputPath.trim());
    }
  };

  const handleConfirm = () => {
    const target = selectedFolder || currentPath;
    if (target) {
      onSelect(target);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/70 p-3 sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="File Manager - Select Project Folder"
    >
      <div
        className="flex h-[85vh] max-h-[700px] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3 bg-surface-2/60">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[22px] text-primary">folder_open</span>
            <div>
              <h3 className="text-sm font-semibold text-text-main">File Manager · Select Project</h3>
              <p className="text-[11px] text-text-muted">Browse host directories to bind as project workspace</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-text-muted hover:bg-sidebar hover:text-text-main transition"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Path Navigation Bar */}
        <div className="shrink-0 border-b border-border p-3 space-y-2 bg-sidebar/30">
          <form onSubmit={handleManualPathSubmit} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!parentPath || loading}
              onClick={() => parentPath && handleNavigate(parentPath)}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-text-muted hover:bg-sidebar hover:text-text-main disabled:opacity-30 disabled:pointer-events-none transition"
              title="Go to parent directory"
            >
              <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
            </button>
            <div className="relative flex-1">
              <input
                type="text"
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                placeholder="Enter folder path (e.g. F:\project\my-app)"
                className="w-full rounded-lg border border-border bg-background py-1.5 pl-3 pr-8 font-mono text-xs text-text-main outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary p-0.5"
                title="Go to path"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
              </button>
            </div>
            <button
              type="button"
              onClick={() => loadDirectory(currentPath)}
              disabled={loading}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-text-muted hover:bg-sidebar hover:text-text-main transition"
              title="Refresh"
            >
              <span className={`material-symbols-outlined text-[18px] ${loading ? "animate-spin text-primary" : ""}`}>
                refresh
              </span>
            </button>
          </form>

          {/* Quick Drives & Shortcuts */}
          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {drives.length > 0 && (
              <div className="flex items-center gap-1 mr-2">
                <span className="text-text-muted font-medium text-[10px] uppercase">Drives:</span>
                {drives.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleNavigate(d)}
                    className={`rounded border px-2 py-0.5 font-mono text-[11px] transition ${
                      currentPath.toUpperCase().startsWith(d.toUpperCase())
                        ? "border-primary/50 bg-primary/10 text-primary font-semibold"
                        : "border-border bg-background text-text-muted hover:bg-sidebar hover:text-text-main"
                    }`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar py-0.5">
              {shortcuts.map((sc) => (
                <button
                  key={sc.label}
                  type="button"
                  onClick={() => handleNavigate(sc.path)}
                  className="flex items-center gap-1 rounded-lg border border-border bg-background px-2 py-0.5 text-text-muted hover:bg-sidebar hover:text-text-main transition"
                  title={sc.path}
                >
                  <span className="material-symbols-outlined text-[13px]">{sc.icon}</span>
                  <span>{sc.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filter Input */}
        <div className="shrink-0 px-3 py-2 border-b border-border/60 bg-surface">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-text-muted">
              search
            </span>
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Filter folders in this directory…"
              className="w-full rounded-lg border border-border/70 bg-background/80 py-1 pl-8 pr-3 text-xs outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* Error message if any */}
        {error && (
          <div className="shrink-0 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-xs text-red-500 flex items-center gap-2">
            <span className="material-symbols-outlined text-[16px]">error</span>
            <span className="flex-1 truncate">{error}</span>
          </div>
        )}

        {/* Directory Contents List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {loading ? (
            <div className="flex h-40 flex-col items-center justify-center gap-2 text-text-muted text-xs">
              <span className="material-symbols-outlined animate-spin text-[24px] text-primary">progress_activity</span>
              <span>Scanning directories…</span>
            </div>
          ) : filteredFolders.length === 0 ? (
            <div className="flex h-36 flex-col items-center justify-center gap-1 text-center text-text-muted p-4">
              <span className="material-symbols-outlined text-[28px] opacity-40">folder_off</span>
              <p className="text-xs">No subdirectories found.</p>
              <p className="text-[11px] opacity-70">
                You can still choose this folder directly using &quot;Select Current Folder&quot; below.
              </p>
            </div>
          ) : (
            filteredFolders.map((folder) => {
              const isSelected = selectedFolder === folder.path;
              return (
                <div
                  key={folder.path}
                  onClick={() => setSelectedFolder(folder.path)}
                  onDoubleClick={() => handleNavigate(folder.path)}
                  className={`group flex items-center justify-between rounded-xl border px-3 py-2 text-left cursor-pointer transition ${
                    isSelected
                      ? "border-primary/50 bg-primary/10 text-text-main shadow-sm"
                      : "border-transparent hover:bg-sidebar hover:border-border text-text-muted hover:text-text-main"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`material-symbols-outlined text-[20px] ${
                        folder.isGit
                          ? "text-primary"
                          : folder.isNode
                          ? "text-emerald-500"
                          : "text-amber-500/80"
                      }`}
                    >
                      {folder.isGit ? "folder_special" : "folder"}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium text-text-main group-hover:text-primary transition-colors">
                          {folder.name}
                        </span>
                        {folder.isGit && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.2 text-[9px] font-semibold text-primary font-mono">
                            GIT
                          </span>
                        )}
                        {folder.isNode && (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-600 font-mono">
                            NODE
                          </span>
                        )}
                        {folder.isPython && (
                          <span className="rounded bg-blue-500/15 px-1.5 py-0.2 text-[9px] font-semibold text-blue-500 font-mono">
                            PYTHON
                          </span>
                        )}
                      </div>
                      <p className="truncate font-mono text-[10px] text-text-muted/80">{folder.path}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNavigate(folder.path);
                      }}
                      className="rounded border border-border bg-background px-2 py-1 text-[11px] text-text-muted hover:text-text-main hover:bg-sidebar transition"
                      title="Open inside"
                    >
                      Open &rarr;
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(folder.path);
                        onClose();
                      }}
                      className="rounded bg-primary px-2 py-1 text-[11px] font-medium text-white hover:bg-primary-hover transition"
                      title="Choose this folder immediately"
                    >
                      Pick
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border bg-surface-2/60 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="min-w-0 w-full sm:w-auto flex-1">
            <span className="block text-[10px] uppercase font-semibold text-text-muted">Target Workspace:</span>
            <p className="truncate font-mono text-xs text-text-main font-medium" title={selectedFolder || currentPath}>
              {selectedFolder || currentPath || "(none selected)"}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
            <Button size="sm" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button size="sm" icon="check" onClick={handleConfirm} disabled={!selectedFolder && !currentPath}>
              Select Folder
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
