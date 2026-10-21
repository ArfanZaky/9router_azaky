"use client";

import { memo, useEffect, useState } from "react";

function SubAgentOverlay({ agent, onClose }) {
  const [info, setInfo] = useState(null);
  const [stopping, setStopping] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch(`/api/chat/subagents/${agent.id}`)
        .then((r) => r.json())
        .then((d) => {
          if (alive && !d.error) setInfo(d);
        })
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [agent.id]);

  const handleInterrupt = async () => {
    setStopping(true);
    try {
      await fetch(`/api/chat/subagents/${agent.id}`, { method: "DELETE" });
      setInfo((prev) => (prev ? { ...prev, status: "interrupted" } : prev));
    } catch {
      // ignore
    } finally {
      setStopping(false);
    }
  };

  const textEvents = (info?.events || []).filter((e) => e.type === "text" || e.type === "message");
  const lastText = textEvents.at(-1)?.data?.content || "";
  const reasoning = (info?.events || []).filter((e) => e.type === "reasoning").at(-1)?.data?.content || "";
  const toolCount = (info?.events || []).filter((e) => e.type === "tool_start").length;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sub-agent transcript"
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <span className="material-symbols-outlined text-[20px] text-primary">account_tree</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{agent.role || "Sub-agent"}</p>
            <p className="truncate text-[11px] text-text-muted">{agent.task}</p>
          </div>
          <span
            className={`text-[11px] font-medium ${
              info?.status === "running"
                ? "text-primary"
                : info?.status === "failed"
                ? "text-red-500"
                : info?.status === "interrupted"
                ? "text-amber-500"
                : "text-emerald-500"
            }`}
          >
            {info?.status || "running"}
          </span>
          {info?.status === "running" && (
            <button
              type="button"
              onClick={handleInterrupt}
              disabled={stopping}
              className="flex items-center gap-1 rounded-md bg-red-500/10 border border-red-500/30 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-500/20 transition disabled:opacity-50"
              title="Interrupt this agent"
            >
              <span className="material-symbols-outlined text-[13px]">stop_circle</span>
              <span>{stopping ? "Stopping..." : "Interrupt"}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-main transition"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 custom-scrollbar">
          <div className="mx-auto max-w-3xl space-y-4">
            {reasoning ? (
              <details open className="rounded-xl border border-border bg-background/40 px-3 py-2">
                <summary className="cursor-pointer text-[11px] font-medium text-text-muted">
                  Reasoning
                </summary>
                <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-text-muted">
                  {reasoning}
                </div>
              </details>
            ) : null}
            <div className="whitespace-pre-wrap break-words text-sm leading-6">
              {lastText || "Working…"}
            </div>
            {toolCount > 0 ? (
              <p className="text-[11px] text-text-muted">
                {toolCount} tool call{toolCount > 1 ? "s" : ""}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(SubAgentOverlay);
