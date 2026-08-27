"use client";

import { useState } from "react";

const STATUS_COLORS = {
  idle: "text-text-muted",
  running: "text-primary",
  completed: "text-emerald-500",
  failed: "text-red-500",
};

const STATUS_ICONS = {
  idle: "pause_circle",
  running: "play_circle",
  completed: "check_circle",
  failed: "error",
};

const TASK_STATUS_STYLE = {
  pending: "border-border bg-background text-text-muted",
  in_progress: "border-primary/40 bg-primary/10 text-primary",
  review: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600",
  blocked: "border-red-500/30 bg-red-500/10 text-red-500",
};

const TASK_COLUMNS = [
  { key: "pending", label: "Pending", icon: "hourglass_empty" },
  { key: "in_progress", label: "In Progress", icon: "play_arrow" },
  { key: "review", label: "Review", icon: "rate_review" },
  { key: "completed", label: "Done", icon: "check" },
];

/**
 * DSH-style Agent Team Panel.
 * Shows: Roster (agents + status), Task Board (kanban columns), Activity Feed (messages + broadcasts).
 */
export default function TeamPanel({ roster = [], tasks = [], messages = [], subAgents = [], onViewAgent }) {
  const [tab, setTab] = useState("board"); // board | roster | feed
  const [collapsed, setCollapsed] = useState(false);

  const activeCount = roster.filter((m) => m.status === "running").length;
  const doneCount = tasks.filter((t) => t.status === "completed").length;

  if (roster.length === 0 && tasks.length === 0 && messages.length === 0) return null;

  return (
    <div className="mx-auto mb-3 max-w-3xl rounded-xl border border-primary/30 bg-gradient-to-b from-primary/5 to-transparent shadow-sm">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <span className="material-symbols-outlined text-[18px] text-primary">groups</span>
        <span className="text-[12px] font-semibold text-primary">Agent Team</span>
        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
          {roster.length} agents
        </span>
        {activeCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-primary">
            <span className="size-1.5 rounded-full bg-primary animate-pulse" />
            {activeCount} active
          </span>
        )}
        {tasks.length > 0 && (
          <span className="text-[10px] text-text-muted">
            {doneCount}/{tasks.length} tasks
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {["board", "roster", "feed"].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t); setCollapsed(false); }}
              className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                tab === t ? "bg-primary/15 text-primary" : "text-text-muted hover:text-text-main hover:bg-sidebar"
              }`}
            >
              {t === "board" ? "Board" : t === "roster" ? "Roster" : "Feed"}
              {t === "feed" && messages.length > 0 ? ` (${messages.length})` : ""}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="ml-1 text-text-muted hover:text-text-main"
          >
            <span className="material-symbols-outlined text-[16px]">
              {collapsed ? "expand_more" : "expand_less"}
            </span>
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="px-3 py-2">
          {/* Tab: Board (Kanban) */}
          {tab === "board" && (
            <div className="space-y-2">
              {tasks.length === 0 ? (
                <p className="text-[11px] text-text-muted italic">No tasks posted yet. The orchestrator will create tasks via team_post_task.</p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {TASK_COLUMNS.map((col) => {
                    const colTasks = tasks.filter((t) => t.status === col.key);
                    return (
                      <div key={col.key} className="min-w-0">
                        <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-text-muted uppercase tracking-wider">
                          <span className="material-symbols-outlined text-[12px]">{col.icon}</span>
                          {col.label}
                          {colTasks.length > 0 && (
                            <span className="rounded-full bg-sidebar px-1 text-[9px]">{colTasks.length}</span>
                          )}
                        </div>
                        <div className="space-y-1">
                          {colTasks.map((task) => (
                            <TaskCard key={task.id} task={task} />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {/* Blocked tasks shown separately */}
              {tasks.filter((t) => t.status === "blocked").length > 0 && (
                <div className="mt-1.5">
                  <div className="mb-1 text-[10px] font-semibold text-red-500 uppercase tracking-wider flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">block</span> Blocked
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tasks.filter((t) => t.status === "blocked").map((task) => (
                      <TaskCard key={task.id} task={task} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Tab: Roster */}
          {tab === "roster" && (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {roster.map((member) => {
                const agent = subAgents.find(
                  (a) => a.role === member.name || a.id?.includes(member.name)
                );
                const status = agent?.status === "running" ? "running" : member.status || "idle";
                return (
                  <button
                    key={member.name}
                    type="button"
                    onClick={() => agent && onViewAgent?.(agent)}
                    className={`flex items-start gap-2 rounded-lg border border-border/50 bg-background/50 px-2.5 py-2 text-left transition hover:bg-sidebar/50 ${
                      agent ? "cursor-pointer" : "cursor-default"
                    }`}
                  >
                    <span className={`material-symbols-outlined text-[18px] mt-0.5 ${STATUS_COLORS[status]}`}>
                      {STATUS_ICONS[status]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-semibold">{member.name}</span>
                        <span className={`rounded-full px-1.5 py-0 text-[9px] font-medium ${STATUS_COLORS[status]}`}>
                          {status}
                        </span>
                      </div>
                      <p className="text-[10px] text-text-muted truncate">{member.role || member.description || ""}</p>
                    </div>
                    {agent && (
                      <span className="material-symbols-outlined text-[14px] text-text-muted mt-0.5">open_in_new</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Tab: Activity Feed */}
          {tab === "feed" && (
            <div className="max-h-48 space-y-1 overflow-y-auto custom-scrollbar">
              {messages.length === 0 ? (
                <p className="text-[11px] text-text-muted italic">No team activity yet.</p>
              ) : (
                messages.map((msg, i) => (
                  <div key={msg.id || i} className="flex items-start gap-1.5 text-[11px]">
                    <span className="material-symbols-outlined text-[13px] mt-0.5 text-text-muted shrink-0">
                      {msg.type === "broadcast" ? "campaign" : msg.type === "message" ? "chat" : "info"}
                    </span>
                    <div className="min-w-0 flex-1">
                      {msg.type === "broadcast" ? (
                        <span>
                          <span className="font-semibold text-primary">[Broadcast]</span>{" "}
                          <span className="font-medium">{msg.topic}:</span> {msg.message}
                        </span>
                      ) : msg.type === "message" ? (
                        <span>
                          <span className="font-semibold text-primary">{msg.from}</span>
                          <span className="text-text-muted"> → </span>
                          <span className="font-semibold">{msg.to}</span>
                          <span className="text-text-muted">: </span>
                          {msg.message}
                        </span>
                      ) : (
                        <span className="text-text-muted">{msg.message || JSON.stringify(msg)}</span>
                      )}
                    </div>
                    {msg.timestamp && (
                      <span className="shrink-0 text-[9px] text-text-muted">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task }) {
  const style = TASK_STATUS_STYLE[task.status] || TASK_STATUS_STYLE.pending;
  return (
    <div className={`rounded-md border px-2 py-1.5 ${style}`}>
      <p className="text-[10px] font-medium leading-tight truncate" title={task.description || task.title}>
        {task.title || task.description || "Untitled"}
      </p>
      <div className="mt-0.5 flex items-center gap-1 text-[9px]">
        {task.assignee && (
          <span className="flex items-center gap-0.5">
            <span className="material-symbols-outlined text-[10px]">person</span>
            {task.assignee}
          </span>
        )}
        {Array.isArray(task.dependsOn) && task.dependsOn.length > 0 && (
          <span className="flex items-center gap-0.5 text-text-muted" title={`Depends on: ${task.dependsOn.join(", ")}`}>
            <span className="material-symbols-outlined text-[10px]">link</span>
            {task.dependsOn.length}
          </span>
        )}
      </div>
    </div>
  );
}
