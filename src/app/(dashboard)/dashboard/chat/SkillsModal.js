"use client";

import { useEffect, useState, useMemo } from "react";
import { Button } from "@/shared/components";

export default function SkillsModal({ isOpen, onClose, onInsertPrompt }) {
  const [skills, setSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setLoading(true);
    fetch("/api/chat/skills")
      .then((res) => res.json())
      .then((data) => {
        if (alive && Array.isArray(data.skills)) {
          setSkills(data.skills);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [isOpen]);

  const filteredSkills = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        (s.description || "").toLowerCase().includes(q)
    );
  }, [skills, search]);

  const antiSlopSkills = useMemo(
    () => skills.filter((s) => s.id === "antislop" || s.id.startsWith("antislop-")),
    [skills]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Agent Skills and Anti-Slop Standard"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-surface shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5 bg-sidebar/50">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-[22px] text-primary">auto_awesome</span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-text-main">Agent Skills Hub</h3>
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Anti-Slop Enforced
                </span>
              </div>
              <p className="text-[11px] text-text-muted mt-0.5">
                Skills catalogue loaded from workspace. Anti-Slop is mandatory for all development & integration.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-text-muted hover:bg-surface-2 hover:text-text-main transition"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Featured Anti-Slop Banner */}
        <div className="border-b border-border bg-primary/5 p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1 max-w-xl">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-primary">verified</span>
                <span className="text-xs font-semibold text-text-main">
                  Anti-Slop: Rules for AI Coding Agents
                </span>
                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-mono font-medium text-primary uppercase">
                  Mandatory Standard
                </span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                Stops generic AI slop. Enforces Craftsmanship C-1..C-5 and rules R-01..R-38: no em dashes, mandatory mobile responsiveness, WCAG AA contrast, honest placeholders [REAL DATA], real working controls, and 3 states (empty/loading/error).
              </p>
              <div className="flex items-center gap-3 pt-1 text-[11px]">
                <a
                  href="https://github.com/miqdadbadjuber/anti-slop"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1 font-mono text-[10px]"
                >
                  <span className="material-symbols-outlined text-[13px]">link</span>
                  github.com/miqdadbadjuber/anti-slop
                </a>
                <span className="text-text-muted">·</span>
                <span className="text-text-muted">
                  {antiSlopSkills.length} sub-skills available (ui, code, copywriting, human, layoutmobile)
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  onInsertPrompt?.("Audit and develop this feature following the Anti-Slop standard (https://github.com/miqdadbadjuber/anti-slop): check Craftsmanship C-1..C-5, ensure real behavior and responsiveness.");
                  onClose();
                }}
              >
                Use in prompt
              </Button>
            </div>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border bg-surface">
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-text-muted">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search loaded skills (e.g. antislop, 9router, react, git)..."
              className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-1.5 text-xs text-text-main outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* List */}
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2">
          {loading ? (
            <div className="py-8 text-center text-xs text-text-muted">Loading skills...</div>
          ) : filteredSkills.length === 0 ? (
            <div className="py-8 text-center text-xs text-text-muted">No skills matching "{search}"</div>
          ) : (
            filteredSkills.map((skill) => (
              <div
                key={skill.id}
                className={`flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors ${
                  skill.isAntiSlop
                    ? "border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10"
                    : "border-border bg-background/50 hover:bg-surface-2"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-xs text-text-main font-mono">{skill.name}</span>
                    {skill.isAntiSlop && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-medium text-emerald-600 dark:text-emerald-400">
                        ANTI-SLOP
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-text-muted leading-relaxed line-clamp-2">
                    {skill.description || "Skill loaded and accessible via read_skill tool."}
                  </p>
                  {skill.repoUrl && (
                    <a
                      href={skill.repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-primary hover:underline font-mono"
                    >
                      <span>{skill.repoUrl}</span>
                      <span className="material-symbols-outlined text-[11px]">open_in_new</span>
                    </a>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      onInsertPrompt?.(`Please load and apply the "${skill.id}" skill using read_skill.`);
                      onClose();
                    }}
                    className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-text-muted hover:bg-surface hover:text-text-main hover:border-primary/40 transition"
                  >
                    Select
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-4 py-3 bg-sidebar/30 text-[11px] text-text-muted">
          <span>Total skills active: {skills.length}</span>
          <span className="font-mono text-[10px]">read_skill &lt;name&gt;</span>
        </div>
      </div>
    </div>
  );
}
