"use client";

import { memo } from "react";
import { Button } from "@/shared/components";

function formatRelativeTime(value) {
  if (!value) return "";
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return "";
  const diffMinutes = Math.max(1, Math.round((Date.now() - time) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h`;
  return `${Math.round(diffHours / 24)}d`;
}

const SessionRailItem = memo(function SessionRailItem({
  session,
  active,
  isRunning,
  hasPendingAsk,
  renameId,
  renameValue,
  onSelect,
  onTogglePin,
  onEdit,
  onCopy,
  onDelete,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
}) {
  return (
    <div
      className={`group rounded-xl border px-2.5 py-2 cursor-pointer transition ${
        active
          ? "border-primary/40 bg-primary/10 shadow-sm"
          : isRunning
            ? "border-primary/35 bg-primary/5 hover:bg-primary/10"
            : "border-transparent hover:bg-sidebar hover:border-border"
      }`}
      onClick={() => onSelect(session.id)}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className={`mt-0.5 material-symbols-outlined text-[16px] ${
            session.pinned ? "text-primary" : "text-text-muted opacity-0 group-hover:opacity-100"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(session);
          }}
          title="Pin"
        >
          keep
        </button>
        <div className="min-w-0 flex-1">
          {renameId === session.id ? (
            <input
              autoFocus
              value={renameValue}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRenameSubmit(session.id);
                if (e.key === "Escape") onRenameCancel();
              }}
              onBlur={() => onRenameSubmit(session.id)}
              className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            />
          ) : (
            <div className="flex items-center justify-between gap-1.5">
              <p className="truncate text-sm font-medium">{session.title || "New chat"}</p>
              {hasPendingAsk ? (
                <span
                  className="shrink-0 inline-flex items-center gap-1 rounded-md bg-amber-500/20 border border-amber-500/35 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400 animate-pulse"
                  title="Agent is waiting for your answer in this session"
                >
                  <span className="material-symbols-outlined text-[12px]">help</span>
                  Waiting
                </span>
              ) : isRunning ? (
                <span
                  className="shrink-0 inline-flex items-center gap-1 rounded-md bg-primary/20 border border-primary/30 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                  title="Session is actively running"
                >
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
                  </span>
                  Running
                </span>
              ) : null}
            </div>
          )}
          <p className="truncate text-[11px] text-text-muted mt-0.5">
            {session.model || "No model"} · {formatRelativeTime(session.updatedAt)}
          </p>
        </div>
        <div className={`flex flex-col gap-0.5 transition-opacity ${active ? "opacity-80 group-hover:opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}>
          <button
            type="button"
            className="material-symbols-outlined text-[15px] text-text-muted hover:text-primary transition"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(session);
            }}
            title="Edit session details"
          >
            edit
          </button>
          <button
            type="button"
            className="material-symbols-outlined text-[15px] text-text-muted hover:text-primary transition"
            title="Duplicate session (new session with same name and path)"
            aria-label="Duplicate session"
            onClick={(e) => {
              e.stopPropagation();
              onCopy(session);
            }}
          >
            content_copy
          </button>
          <button
            type="button"
            className="material-symbols-outlined text-[15px] text-text-muted hover:text-red-500 transition"
            title="Delete session"
            aria-label="Delete session"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(session);
            }}
          >
            delete
          </button>
        </div>
      </div>
    </div>
  );
});

function ChatSessionRail({
  sessions,
  activeSessionId,
  runningSessionIds,
  pendingAskSessionIds,
  search,
  setSearch,
  renameId,
  renameValue,
  onOpenCreateModal,
  onSelectSession,
  onTogglePin,
  onEditSession,
  onCopySession,
  onDeleteSession,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  listRef,
}) {
  return (
    <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-border bg-sidebar/40">
      <div className="p-3 border-b border-border space-y-2">
        <Button className="w-full" icon="add" onClick={onOpenCreateModal}>
          New chat
        </Button>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sessions…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
      </div>
      <div ref={listRef} className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {sessions.length === 0 ? (
          <p className="text-xs text-text-muted p-3">No sessions yet.</p>
        ) : (
          sessions.map((session) => (
            <SessionRailItem
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              isRunning={runningSessionIds.has(session.id)}
              hasPendingAsk={pendingAskSessionIds.has(session.id)}
              renameId={renameId}
              renameValue={renameValue}
              onSelect={onSelectSession}
              onTogglePin={onTogglePin}
              onEdit={onEditSession}
              onCopy={onCopySession}
              onDelete={onDeleteSession}
              onRenameChange={onRenameChange}
              onRenameSubmit={onRenameSubmit}
              onRenameCancel={onRenameCancel}
            />
          ))
        )}
      </div>
    </aside>
  );
}

export default memo(ChatSessionRail);
export { SessionRailItem };
