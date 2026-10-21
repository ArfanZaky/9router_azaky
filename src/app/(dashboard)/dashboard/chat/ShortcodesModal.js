"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Button } from "@/shared/components";

export default function ShortcodesModal({ isOpen, onClose, onSelectShortcode }) {
  const [shortcodes, setShortcodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Form state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formTag, setFormTag] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const loadShortcodes = useCallback(async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/chat/shortcodes");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to load shortcodes");
      setShortcodes(Array.isArray(data.shortcodes) ? data.shortcodes : []);
    } catch (err) {
      setError(err?.message || "Unable to load shortcodes");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadShortcodes();
      setIsFormOpen(false);
      setEditingId(null);
      setFormTag("");
      setFormDescription("");
      setFormError("");
    }
  }, [isOpen, loadShortcodes]);

  const filteredShortcodes = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shortcodes;
    return shortcodes.filter(
      (s) =>
        s.tag.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q)
    );
  }, [shortcodes, search]);

  const handleStartCreate = () => {
    setEditingId(null);
    setFormTag("");
    setFormDescription("");
    setFormError("");
    setIsFormOpen(true);
  };

  const handleStartEdit = (sc) => {
    setEditingId(sc.id);
    setFormTag(sc.tag);
    setFormDescription(sc.description);
    setFormError("");
    setIsFormOpen(true);
  };

  const handleCancelForm = () => {
    setIsFormOpen(false);
    setEditingId(null);
    setFormTag("");
    setFormDescription("");
    setFormError("");
  };

  const handleSaveForm = async (e) => {
    if (e) e.preventDefault();
    const cleanTag = formTag.trim().replace(/^\/+/, "");
    const cleanDescription = formDescription.trim();

    if (!cleanTag) {
      setFormError("Tag name is required");
      return;
    }
    if (!cleanDescription) {
      setFormError("Prompt description is required");
      return;
    }

    setIsSaving(true);
    setFormError("");

    try {
      if (editingId) {
        const res = await fetch(`/api/chat/shortcodes/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag: cleanTag, description: cleanDescription }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to update shortcode");
      } else {
        const res = await fetch("/api/chat/shortcodes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag: cleanTag, description: cleanDescription }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to create shortcode");
      }

      await loadShortcodes();
      handleCancelForm();
    } catch (err) {
      setFormError(err?.message || "Failed to save shortcode");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (sc) => {
    const confirmed = globalThis.confirm?.(`Delete shortcode "${sc.tag}"?`);
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/chat/shortcodes/${sc.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to delete");
      await loadShortcodes();
    } catch (err) {
      setError(err?.message || "Failed to delete shortcode");
    }
  };

  const handleCopyDescription = async (sc) => {
    try {
      await navigator.clipboard.writeText(sc.description);
      setCopiedId(sc.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // ignore
    }
  };

  const handleUseShortcode = (sc) => {
    if (onSelectShortcode) {
      onSelectShortcode(sc);
    }
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Manage Shortcodes"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 bg-sidebar/50">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[22px] text-primary">bookmark</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text-main">Shortcode Prompts</h3>
                <span className="rounded-full bg-primary/10 border border-primary/30 px-2 py-0.5 text-[10px] font-medium text-primary">
                  {shortcodes.length} saved
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                Type /shortcode [option] in chat to insert saved prompts instantly.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isFormOpen && (
              <Button size="sm" icon="add" onClick={handleStartCreate}>
                New Shortcode
              </Button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 hover:text-text-main transition"
              title="Close modal"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
            </button>
          </div>
        </div>

        {/* Create / Edit Form Drawer */}
        {isFormOpen && (
          <form onSubmit={handleSaveForm} className="border-b border-border bg-sidebar/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-primary">
                  {editingId ? "edit" : "add_circle"}
                </span>
                {editingId ? "Edit Shortcode" : "Create New Shortcode"}
              </span>
              <button
                type="button"
                onClick={handleCancelForm}
                className="text-[11px] text-text-muted hover:text-text-main"
              >
                Cancel
              </button>
            </div>

            {formError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
                {formError}
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-muted">
                Tag (shortcut name without spaces)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-2 text-xs font-mono text-text-muted">/shortcode</span>
                <input
                  type="text"
                  value={formTag}
                  onChange={(e) => setFormTag(e.target.value.toLowerCase().replace(/\s+/g, "-"))}
                  placeholder="tag-name (e.g. refactor, fix-bug, review)"
                  className="w-full rounded-lg border border-border bg-background pl-24 pr-3 py-1.5 text-xs font-mono text-text-main outline-none focus:border-primary"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-text-muted">
                Description (prompt template to send when triggered)
              </label>
              <textarea
                rows={4}
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="Write the full prompt content that will be sent into chat when this shortcode is used..."
                className="w-full rounded-lg border border-border bg-background p-2.5 text-xs text-text-main resize-y outline-none focus:border-primary custom-scrollbar leading-relaxed"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={handleCancelForm} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" size="sm" icon={isSaving ? "progress_activity" : "check"} disabled={isSaving}>
                {isSaving ? "Saving..." : editingId ? "Update Shortcode" : "Save Shortcode"}
              </Button>
            </div>
          </form>
        )}

        {/* Global Error Notice */}
        {error && (
          <div className="border-b border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Search Bar */}
        <div className="p-3 border-b border-border bg-surface flex items-center gap-3">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-text-muted">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search shortcodes by tag or prompt content..."
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-1.5 text-xs text-text-main outline-none focus:border-primary"
            />
          </div>
          {search && (
            <button
              onClick={() => setSearch("")}
              className="text-xs text-text-muted hover:text-text-main"
            >
              Clear
            </button>
          )}
        </div>

        {/* Shortcodes List */}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2.5">
          {loading ? (
            <div className="py-12 text-center text-xs text-text-muted space-y-2">
              <span className="material-symbols-outlined text-[24px] text-primary animate-spin">
                progress_activity
              </span>
              <p>Loading saved shortcodes...</p>
            </div>
          ) : filteredShortcodes.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <div className="mx-auto size-12 rounded-2xl border border-border bg-sidebar flex items-center justify-center">
                <span className="material-symbols-outlined text-[24px] text-text-muted">bookmark_border</span>
              </div>
              <div className="max-w-sm mx-auto">
                <p className="text-xs font-medium text-text-main">
                  {search ? `No shortcodes matching "${search}"` : "No shortcodes saved yet"}
                </p>
                <p className="text-[11px] text-text-muted mt-1 leading-relaxed">
                  {search
                    ? "Try a different search term or create a new shortcode."
                    : "Create reusable prompt templates. Type /shortcode in chat to expand them instantly."}
                </p>
              </div>
              {!isFormOpen && (
                <Button size="sm" icon="add" onClick={handleStartCreate}>
                  Create your first shortcode
                </Button>
              )}
            </div>
          ) : (
            filteredShortcodes.map((sc) => (
              <div
                key={sc.id}
                className="group rounded-xl border border-border bg-background/50 hover:bg-surface-2 p-3 transition-colors space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">bookmark</span>
                    <span className="font-mono text-xs font-semibold text-primary">
                      /shortcode {sc.tag}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleCopyDescription(sc)}
                      className="rounded-lg p-1.5 text-text-muted hover:bg-surface hover:text-text-main transition text-xs flex items-center gap-1"
                      title="Copy prompt text"
                    >
                      <span className="material-symbols-outlined text-[15px]">
                        {copiedId === sc.id ? "check" : "content_copy"}
                      </span>
                      <span className="text-[10px] hidden sm:inline">
                        {copiedId === sc.id ? "Copied" : "Copy"}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartEdit(sc)}
                      className="rounded-lg p-1.5 text-text-muted hover:bg-surface hover:text-text-main transition"
                      title="Edit shortcode"
                    >
                      <span className="material-symbols-outlined text-[15px]">edit</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(sc)}
                      className="rounded-lg p-1.5 text-text-muted hover:bg-surface hover:text-red-500 transition"
                      title="Delete shortcode"
                    >
                      <span className="material-symbols-outlined text-[15px]">delete</span>
                    </button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="ml-1"
                      onClick={() => handleUseShortcode(sc)}
                    >
                      Use in chat
                    </Button>
                  </div>
                </div>

                <div className="rounded-lg bg-surface/80 border border-border/60 p-2.5">
                  <p className="whitespace-pre-wrap font-sans text-xs text-text-main leading-relaxed max-h-36 overflow-y-auto custom-scrollbar">
                    {sc.description}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-2.5 bg-sidebar/30 text-[11px] text-text-muted">
          <span>Shortcodes are available across all chat sessions</span>
          <span className="font-mono text-[10px]">Usage: /shortcode &lt;tag&gt;</span>
        </div>
      </div>
    </div>
  );
}
