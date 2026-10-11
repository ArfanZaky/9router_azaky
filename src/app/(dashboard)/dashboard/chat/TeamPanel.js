"use client";

import { useMemo, useState } from "react";

const STATUS_COLORS = {
  idle: "text-text-muted bg-surface",
  running: "text-primary bg-primary/10",
  completed: "text-emerald-500 bg-emerald-500/10",
  failed: "text-red-500 bg-red-500/10",
};

const STATUS_ICONS = {
  idle: "pause_circle",
  running: "play_circle",
  completed: "check_circle",
  failed: "error",
};

const TASK_STATUS_STYLE = {
  pending: "border-border/70 bg-background/80 text-text-muted",
  claimed: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  in_progress: "border-primary/40 bg-primary/10 text-primary",
  review: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  completed: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  blocked: "border-red-500/30 bg-red-500/10 text-red-500",
  failed: "border-red-500/40 bg-red-500/15 text-red-600",
};

const TASK_COLUMNS = [
  { key: "pending", label: "Pending", icon: "hourglass_empty" },
  { key: "in_progress", label: "In Progress", icon: "play_arrow" },
  { key: "review", label: "Review", icon: "rate_review" },
  { key: "completed", label: "Done", icon: "check_circle" },
];

/**
 * Enhanced DSH-Style Agent Teams Native Workspace Panel (DeepSeek Harness).
 * Includes:
 * - Segmented Progress Bar & Team Statistics
 * - Kanban Task Board with Dependency Links
 * - Interactive Dependency Flow (DAG Graph / Stages)
 * - Roster with Active Agent Badges & Transcript Inspection
 * - Chronological P2P Mailbox & Broadcast Activity Feed
 */
export default function TeamPanel({
  roster = [],
  tasks = [],
  messages = [],
  subAgents = [],
  onViewAgent,
}) {
  const [tab, setTab] = useState("board"); // board | dag | roster | feed
  const [collapsed, setCollapsed] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [feedFilter, setFeedFilter] = useState("all"); // all | broadcast | p2p

  const activeCount = roster.filter((m) => m.status === "running").length;
  const doneCount = tasks.filter((t) => t.status === "completed").length;
  const totalCount = tasks.length;
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  // Compute Task Dependency Readiness for DAG & Cards
  const completedTaskIds = useMemo(() => {
    return new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
  }, [tasks]);

  const taskMap = useMemo(() => {
    const map = new Map();
    tasks.forEach((t) => map.set(t.id, t));
    return map;
  }, [tasks]);

  // Compute DAG topological levels/stages
  const dagStages = useMemo(() => {
    if (!tasks.length) return [];
    const stages = [];
    const assigned = new Map();

    // Find max depth for each task based on dependencies
    const getDepth = (taskId, visited = new Set()) => {
      if (visited.has(taskId)) return 0;
      visited.add(taskId);
      const t = taskMap.get(taskId);
      if (!t || !Array.isArray(t.dependsOn) || t.dependsOn.length === 0) return 0;
      let maxD = 0;
      for (const depId of t.dependsOn) {
        maxD = Math.max(maxD, 1 + getDepth(depId, new Set(visited)));
      }
      return maxD;
    };

    tasks.forEach((t) => {
      const depth = getDepth(t.id);
      assigned.set(t.id, depth);
    });

    const maxDepth = Math.max(0, ...Array.from(assigned.values()));
    for (let d = 0; d <= maxDepth; d++) {
      const stageTasks = tasks.filter((t) => assigned.get(t.id) === d);
      if (stageTasks.length > 0) {
        stages.push({ stage: d + 1, tasks: stageTasks });
      }
    }
    return stages;
  }, [tasks, taskMap]);

  // Filtered feed
  const filteredMessages = useMemo(() => {
    if (feedFilter === "broadcast") return messages.filter((m) => m.type === "broadcast");
    if (feedFilter === "p2p") return messages.filter((m) => m.type === "message" || m.from);
    return messages;
  }, [messages, feedFilter]);

  if (roster.length === 0 && tasks.length === 0 && messages.length === 0) return null;

  return (
    <div className="mx-auto mb-3 max-w-3xl rounded-xl border border-primary/30 bg-gradient-to-b from-primary/5 via-background to-transparent shadow-sm">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-3 py-2">
        <div className="flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[18px] text-primary">groups</span>
          <span className="text-[12px] font-semibold text-primary">Agent Team</span>
          <span className="rounded-full bg-primary/15 px-1.5 py-0.2 text-[9px] font-medium text-primary">
            DSH Harness
          </span>
        </div>

        {/* Live Counters */}
        <div className="flex items-center gap-2 text-[10px] text-text-muted">
          <span className="flex items-center gap-1 rounded-md bg-sidebar/80 px-1.5 py-0.5">
            <span className="material-symbols-outlined text-[11px] text-primary">badge</span>
            {roster.length} agents
          </span>
          {activeCount > 0 && (
            <span className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              <span className="size-1.5 rounded-full bg-primary animate-pulse" />
              {activeCount} running
            </span>
          )}
          {totalCount > 0 && (
            <span className="flex items-center gap-1 rounded-md bg-sidebar/80 px-1.5 py-0.5">
              <span className="material-symbols-outlined text-[11px] text-emerald-500">task_alt</span>
              {doneCount}/{totalCount} ({progressPct}%)
            </span>
          )}
        </div>

        {/* View Tabs */}
        <div className="ml-auto flex items-center gap-1">
          {[
            { id: "board", label: "Board", icon: "view_kanban" },
            { id: "dag", label: "DAG", icon: "account_tree" },
            { id: "roster", label: "Roster", icon: "badge" },
            { id: "feed", label: `Feed${messages.length > 0 ? ` (${messages.length})` : ""}`, icon: "forum" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setCollapsed(false);
              }}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                tab === t.id
                  ? "bg-primary/20 text-primary shadow-xs"
                  : "text-text-muted hover:bg-sidebar hover:text-text-main"
              }`}
            >
              <span className="material-symbols-outlined text-[12px]">{t.icon}</span>
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="ml-1 text-text-muted hover:text-text-main"
            title={collapsed ? "Expand panel" : "Collapse panel"}
          >
            <span className="material-symbols-outlined text-[16px]">
              {collapsed ? "expand_more" : "expand_less"}
            </span>
          </button>
        </div>
      </div>

      {/* Segmented Progress Line */}
      {totalCount > 0 && !collapsed && (
        <div className="h-1 w-full bg-sidebar">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {!collapsed && (
        <div className="p-3">
          {/* TAB 1: KANBAN BOARD */}
          {tab === "board" && (
            <div className="space-y-2">
              {tasks.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border/70 p-4 text-center">
                  <span className="material-symbols-outlined text-[24px] text-text-muted">pending_actions</span>
                  <p className="mt-1 text-[11px] text-text-muted">
                    No tasks on the shared board yet.
                  </p>
                  <p className="text-[10px] text-text-muted opacity-75">
                    The team captain will register tasks with <code className="text-primary font-mono">team_post_task</code>.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {TASK_COLUMNS.map((col) => {
                    const colTasks = tasks.filter((t) => {
                      if (col.key === "in_progress") return t.status === "in_progress" || t.status === "claimed";
                      return t.status === col.key;
                    });
                    return (
                      <div key={col.key} className="flex min-w-0 flex-col rounded-lg border border-border/40 bg-sidebar/20 p-1.5">
                        <div className="mb-1.5 flex items-center justify-between border-b border-border/30 pb-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                          <span className="flex items-center gap-1">
                            <span className="material-symbols-outlined text-[12px]">{col.icon}</span>
                            {col.label}
                          </span>
                          <span className="rounded-full bg-sidebar px-1.5 py-0.2 text-[9px] font-mono">
                            {colTasks.length}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {colTasks.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              completedIds={completedTaskIds}
                              isSelected={selectedTask?.id === task.id}
                              onSelect={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
                            />
                          ))}
                          {colTasks.length === 0 && (
                            <p className="py-2 text-center text-[9px] text-text-muted/60 italic">None</p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Blocked or Failed Tasks */}
              {tasks.some((t) => t.status === "blocked" || t.status === "failed") && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-2">
                  <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold text-red-500 uppercase tracking-wider">
                    <span className="material-symbols-outlined text-[12px]">block</span>
                    Blocked / Failed Tasks
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {tasks
                      .filter((t) => t.status === "blocked" || t.status === "failed")
                      .map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          completedIds={completedTaskIds}
                          isSelected={selectedTask?.id === task.id}
                          onSelect={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
                        />
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DAG DEPENDENCY FLOW */}
          {tab === "dag" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-text-muted">
                <span>Task Execution Stages (Dependency DAG)</span>
                <span className="text-[10px] opacity-75">Tasks run left-to-right as dependencies resolve</span>
              </div>
              {dagStages.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-text-muted italic">No tasks created yet.</p>
              ) : (
                <div className="flex flex-wrap gap-3 overflow-x-auto p-1 custom-scrollbar">
                  {dagStages.map((stageGroup) => (
                    <div
                      key={stageGroup.stage}
                      className="min-w-[140px] flex-1 rounded-lg border border-border/50 bg-sidebar/30 p-2"
                    >
                      <div className="mb-2 flex items-center gap-1 border-b border-border/40 pb-1 text-[10px] font-bold uppercase tracking-wider text-primary">
                        <span className="material-symbols-outlined text-[12px]">step</span>
                        Stage {stageGroup.stage}
                      </div>
                      <div className="space-y-1.5">
                        {stageGroup.tasks.map((task) => {
                          const isBlocked =
                            Array.isArray(task.dependsOn) &&
                            task.dependsOn.some((d) => !completedTaskIds.has(d));
                          return (
                            <div
                              key={task.id}
                              onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
                              className={`cursor-pointer rounded-md border p-1.5 transition ${
                                TASK_STATUS_STYLE[task.status] || TASK_STATUS_STYLE.pending
                              } ${selectedTask?.id === task.id ? "ring-2 ring-primary" : ""}`}
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="font-semibold text-[10px] truncate">{task.title || task.id}</span>
                                <span className="text-[9px] opacity-70">
                                  {task.status === "completed" ? "✓" : isBlocked ? "⏳" : "⚡"}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center justify-between text-[9px] text-text-muted">
                                <span>{task.assignee || "unassigned"}</span>
                                {Array.isArray(task.dependsOn) && task.dependsOn.length > 0 && (
                                  <span title={`Depends on: ${task.dependsOn.join(", ")}`}>
                                    🔗 {task.dependsOn.length} dep
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: ROSTER */}
          {tab === "roster" && (
            <div className="grid gap-2 sm:grid-cols-2">
              {roster.map((member) => {
                const agent = subAgents.find(
                  (a) => a.role === member.name || a.id?.includes(member.name)
                );
                const status = agent?.status === "running" ? "running" : member.status || "idle";
                const assignedTasks = tasks.filter((t) => t.assignee === member.name);

                return (
                  <div
                    key={member.name}
                    className="flex flex-col justify-between rounded-xl border border-border/50 bg-background/60 p-2.5 transition hover:border-primary/40 hover:bg-sidebar/30"
                  >
                    <div className="flex items-start gap-2">
                      <div className="relative mt-0.5">
                        <span className={`material-symbols-outlined text-[22px] ${STATUS_COLORS[status]?.split(" ")[0]}`}>
                          {STATUS_ICONS[status]}
                        </span>
                        {status === "running" && (
                          <span className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-primary animate-ping" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-bold text-text-main">{member.name}</span>
                          <span className={`rounded-full px-1.5 py-0 text-[9px] font-semibold uppercase ${STATUS_COLORS[status]}`}>
                            {status}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] font-medium text-primary/80">{member.role}</p>
                        <p className="text-[10px] text-text-muted line-clamp-2">{member.description || "Active specialist agent"}</p>
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-1.5 text-[10px]">
                      <span className="text-text-muted">
                        Tasks: <span className="font-semibold text-text-main">{assignedTasks.length}</span>
                        {assignedTasks.filter((t) => t.status === "completed").length > 0 && (
                          <span className="text-emerald-500 font-medium"> ({assignedTasks.filter((t) => t.status === "completed").length} done)</span>
                        )}
                      </span>
                      {agent && (
                        <button
                          type="button"
                          onClick={() => onViewAgent?.(agent)}
                          className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-primary hover:bg-primary/10 transition"
                        >
                          <span>Transcript</span>
                          <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TAB 4: ACTIVITY FEED / MAILBOX */}
          {tab === "feed" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between border-b border-border/40 pb-1.5">
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-text-muted">Filter:</span>
                  {["all", "broadcast", "p2p"].map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFeedFilter(f)}
                      className={`rounded px-1.5 py-0.5 capitalize transition ${
                        feedFilter === f ? "bg-primary/15 text-primary font-semibold" : "text-text-muted hover:text-text-main"
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <span className="text-[10px] text-text-muted">{filteredMessages.length} entries</span>
              </div>

              <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                {filteredMessages.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-text-muted italic">No team messages recorded yet.</p>
                ) : (
                  filteredMessages.map((msg, i) => (
                    <div
                      key={msg.id || i}
                      className="rounded-lg border border-border/40 bg-background/50 p-2 text-[11px] leading-relaxed transition hover:bg-sidebar/40"
                    >
                      <div className="mb-1 flex items-center justify-between gap-1 text-[10px]">
                        <span className="flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px] text-primary">
                            {msg.type === "broadcast" ? "campaign" : "chat_bubble"}
                          </span>
                          {msg.type === "broadcast" ? (
                            <span className="font-bold text-primary">[BROADCAST] {msg.topic || "Team Announcement"}</span>
                          ) : (
                            <span>
                              <span className="font-bold text-text-main">{msg.from || "peer"}</span>
                              <span className="text-text-muted mx-1">→</span>
                              <span className="font-bold text-primary">{msg.to || "teammate"}</span>
                            </span>
                          )}
                        </span>
                        {msg.timestamp && (
                          <span className="font-mono text-[9px] text-text-muted">
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-text-muted">{msg.message}</p>
                      {msg.context && (
                        <div className="mt-1 rounded bg-sidebar/70 p-1 font-mono text-[9px] text-text-muted">
                          Context: {msg.context}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Selected Task Inspection Card */}
          {selectedTask && (
            <div className="mt-2.5 rounded-lg border border-primary/40 bg-primary/5 p-2.5 text-[11px]">
              <div className="flex items-center justify-between gap-2 border-b border-primary/20 pb-1">
                <span className="font-bold text-primary">Task Details: {selectedTask.title || selectedTask.id}</span>
                <button
                  type="button"
                  onClick={() => setSelectedTask(null)}
                  className="text-text-muted hover:text-text-main"
                >
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
              <div className="mt-2 space-y-1 text-text-muted">
                {selectedTask.description && (
                  <p><span className="font-semibold text-text-main">Spec:</span> {selectedTask.description}</p>
                )}
                <div className="flex flex-wrap gap-3 text-[10px]">
                  <span><strong className="text-text-main">Status:</strong> {selectedTask.status}</span>
                  <span><strong className="text-text-main">Assignee:</strong> {selectedTask.assignee || "Unassigned"}</span>
                  {Array.isArray(selectedTask.dependsOn) && selectedTask.dependsOn.length > 0 && (
                    <span><strong className="text-text-main">Dependencies:</strong> {selectedTask.dependsOn.join(", ")}</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, completedIds, isSelected, onSelect }) {
  const isBlocked =
    Array.isArray(task.dependsOn) &&
    task.dependsOn.some((d) => !completedIds?.has(d));

  const style = isBlocked
    ? TASK_STATUS_STYLE.blocked
    : TASK_STATUS_STYLE[task.status] || TASK_STATUS_STYLE.pending;

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer rounded-md border p-1.5 transition hover:shadow-xs ${style} ${
        isSelected ? "ring-2 ring-primary" : ""
      }`}
    >
      <p className="text-[10px] font-semibold leading-tight line-clamp-2" title={task.description || task.title}>
        {task.title || task.description || "Untitled task"}
      </p>
      <div className="mt-1 flex items-center justify-between text-[9px]">
        {task.assignee ? (
          <span className="flex items-center gap-0.5 truncate max-w-[80px]" title={task.assignee}>
            <span className="material-symbols-outlined text-[10px]">person</span>
            {task.assignee}
          </span>
        ) : (
          <span className="text-text-muted/60">unassigned</span>
        )}
        {Array.isArray(task.dependsOn) && task.dependsOn.length > 0 && (
          <span
            className={`flex items-center gap-0.5 ${isBlocked ? "text-red-500 font-bold" : "text-text-muted"}`}
            title={`Depends on: ${task.dependsOn.join(", ")}`}
          >
            <span className="material-symbols-outlined text-[10px]">link</span>
            {task.dependsOn.length}
          </span>
        )}
      </div>
    </div>
  );
}
