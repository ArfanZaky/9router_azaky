"use client";

import { memo } from "react";
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
}) {
  return (
    <header className="shrink-0 flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 lg:px-4">
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

        <Button className="md:hidden" variant="ghost" size="sm" icon="add" onClick={onOpenCreateModal} title="New Chat">
          New
        </Button>
      </div>
    </header>
  );
}

export default memo(ChatHeader);
