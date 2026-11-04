"use client";

import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components";

function ChatHeader({
  activeSession,
  activeSessionCodebase,
  viewMode,
  setViewMode,
  paramsOpen,
  setParamsOpen,
  showReasoning,
  setShowReasoning,
  skillsModalOpen,
  setSkillsModalOpen,
  shortcodesModalOpen,
  setShortcodesModalOpen,
  terminalOpen,
  toggleTerminal,
  projectOpen,
  projectTab,
  toggleProject,
  onOpenModelModal,
  onOpenCodebaseEdit,
  onOpenMcpModal,
  onDuplicateSession,
  onExport,
  onOpenCreateModal,
  onToggleMobileSessions,
}) {
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const moreMenuRef = useRef(null);

  useEffect(() => {
    if (!moreMenuOpen) return undefined;
    const handleOutside = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) {
        setMoreMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [moreMenuOpen]);

  return (
    <header className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 lg:px-4">
      {/* Mobile Sessions Drawer Toggle */}
      {onToggleMobileSessions ? (
        <button
          type="button"
          onClick={onToggleMobileSessions}
          className="flex md:hidden items-center justify-center rounded-xl border border-border bg-sidebar/50 p-2 text-text-main hover:bg-sidebar transition cursor-pointer"
          title="Open chat sessions"
          aria-label="Open chat sessions"
        >
          <span className="material-symbols-outlined text-[18px] text-primary">forum</span>
        </button>
      ) : null}

      {/* Model Selector */}
      <button
        type="button"
        onClick={onOpenModelModal}
        className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-sidebar/50 px-3 py-2 text-left hover:bg-sidebar transition cursor-pointer"
      >
        <span className="material-symbols-outlined text-[18px] text-primary">smart_toy</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{activeSession?.model || "Select model"}</p>
          <p className="truncate text-[11px] text-text-muted">Click to change</p>
        </div>
      </button>

      {/* Codebase / Workspace Path */}
      {activeSessionCodebase ? (
        <button
          type="button"
          onClick={onOpenCodebaseEdit}
          className="hidden min-w-0 max-w-[16rem] items-center gap-1.5 rounded-xl border border-border bg-sidebar/50 px-3 py-2 text-left hover:bg-sidebar transition md:flex cursor-pointer"
          title="Session codebase / repository URL - click to edit"
        >
          <span className="material-symbols-outlined text-[15px] text-primary">link</span>
          <span className="truncate font-mono text-[11px] text-text-muted">{activeSessionCodebase}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={onOpenCodebaseEdit}
          className="hidden items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-[11px] text-text-muted hover:bg-sidebar transition md:flex cursor-pointer"
          title="Set a codebase / repository URL for this session"
        >
          <span className="material-symbols-outlined text-[15px]">link</span>
          Codebase
        </button>
      )}

      {/* Action Buttons Right Side */}
      <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
        {/* Raw vs Chat View Toggle */}
        <div className="flex rounded-full border border-border overflow-hidden text-[11px]">
          <button
            type="button"
            onClick={() => setViewMode("raw")}
            className={`px-2.5 py-1.5 transition ${
              viewMode === "raw"
                ? "bg-primary/15 text-primary font-medium"
                : "text-text-muted hover:bg-sidebar"
            }`}
            title="Show tool calls in transcript"
          >
            Raw
          </button>
          <button
            type="button"
            onClick={() => setViewMode("chat")}
            className={`px-2.5 py-1.5 border-l border-border transition ${
              viewMode === "chat"
                ? "bg-primary/15 text-primary font-medium"
                : "text-text-muted hover:bg-sidebar"
            }`}
            title="Hide tool calls - only user/assistant messages"
          >
            Only chat
          </button>
        </div>

        <Button
          variant={paramsOpen ? "secondary" : "ghost"}
          size="sm"
          icon="tune"
          onClick={() => setParamsOpen((v) => !v)}
          title="Model parameters"
        >
          Params
        </Button>

        <Button
          variant="ghost"
          size="sm"
          icon="psychology"
          onClick={() => setShowReasoning((value) => !value)}
          title="Toggle reasoning display"
        >
          {showReasoning ? "Reasoning" : "Hidden"}
        </Button>

        <div className="hidden 2xl:flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            icon="extension"
            onClick={onOpenMcpModal}
            title="Manage MCP servers"
          >
            MCP
          </Button>

          <Button
            variant={skillsModalOpen ? "secondary" : "ghost"}
            size="sm"
            icon="auto_awesome"
            onClick={() => setSkillsModalOpen(true)}
            title="Agent Skills Hub"
          >
            Skills
          </Button>

          <Button
            variant={shortcodesModalOpen ? "secondary" : "ghost"}
            size="sm"
            icon="bookmark"
            onClick={() => setShortcodesModalOpen(true)}
            title="Shortcode Prompts"
          >
            Shortcodes
          </Button>
        </div>

        {/* Docked Terminal Toggle Button */}
        <Button
          variant={terminalOpen ? "secondary" : "ghost"}
          size="sm"
          icon="terminal"
          onClick={toggleTerminal}
          title="Toggle Docked Terminal Panel (Ctrl+`)"
        >
          Terminal
        </Button>

        {activeSessionCodebase ? (
          <>
            <Button
              variant={projectOpen && projectTab === "scripts" ? "secondary" : "ghost"}
              size="sm"
              icon="play_circle"
              onClick={() => toggleProject("scripts")}
              title="Running Scripts & Processes"
            >
              Scripts
            </Button>
            <Button
              variant={projectOpen && projectTab === "git" ? "secondary" : "ghost"}
              size="sm"
              icon="fork_right"
              onClick={() => toggleProject("git")}
              title="Source Control (Git)"
            >
              Git
            </Button>
            <Button
              variant={projectOpen && projectTab === "graph" ? "secondary" : "ghost"}
              size="sm"
              icon="schema"
              onClick={() => toggleProject("graph")}
              title="Git Graph & History"
            >
              Graph
            </Button>
            <Button
              variant={projectOpen && !["git", "scripts", "graph", "terminal"].includes(projectTab) ? "secondary" : "ghost"}
              size="sm"
              icon="folder_open"
              onClick={() => toggleProject("info")}
              title="Project Workspace"
            >
              Project
            </Button>
          </>
        ) : null}

        <div className="hidden 2xl:flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            icon="content_copy"
            onClick={onDuplicateSession}
            title="Duplicate session (new session with same name and path)"
            disabled={!activeSession}
          >
            Duplicate
          </Button>

          <Button variant="ghost" size="sm" icon="download" onClick={() => onExport("md")} title="Export as Markdown">
            MD
          </Button>
          <Button variant="ghost" size="sm" icon="data_object" onClick={() => onExport("json")} title="Export as JSON">
            JSON
          </Button>
        </div>

        {/* Grouped secondary actions dropdown for < 2xl screens */}
        <div ref={moreMenuRef} className="relative 2xl:hidden">
          <Button
            variant={moreMenuOpen ? "secondary" : "ghost"}
            size="sm"
            icon="more_horiz"
            onClick={() => setMoreMenuOpen((v) => !v)}
            title="More tools & export options"
          >
            More
          </Button>
          {moreMenuOpen ? (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-border bg-surface p-1.5 shadow-2xl">
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setSkillsModalOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-main hover:bg-surface-2 transition cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px] text-primary">auto_awesome</span>
                <span>Skills Hub</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  setShortcodesModalOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-main hover:bg-surface-2 transition cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px] text-primary">bookmark</span>
                <span>Shortcodes</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  onOpenMcpModal();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-main hover:bg-surface-2 transition cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px] text-primary">extension</span>
                <span>MCP Servers</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  onOpenCodebaseEdit();
                }}
                className="flex md:hidden w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-main hover:bg-surface-2 transition cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px] text-primary">link</span>
                <span>Set Codebase</span>
              </button>
              <div className="my-1 border-t border-border" />
              <button
                type="button"
                disabled={!activeSession}
                onClick={() => {
                  setMoreMenuOpen(false);
                  onDuplicateSession();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-main hover:bg-surface-2 transition disabled:opacity-50 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">content_copy</span>
                <span>Duplicate Session</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  onExport("md");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-main hover:bg-surface-2 transition cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">download</span>
                <span>Export Markdown</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMoreMenuOpen(false);
                  onExport("json");
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-text-main hover:bg-surface-2 transition cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">data_object</span>
                <span>Export JSON</span>
              </button>
            </div>
          ) : null}
        </div>

        <Button className="md:hidden" variant="ghost" size="sm" icon="add" onClick={onOpenCreateModal} title="New Chat">
          New
        </Button>
      </div>
    </header>
  );
}

export default memo(ChatHeader);
