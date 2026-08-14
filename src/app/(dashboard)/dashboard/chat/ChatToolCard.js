"use client";

import { useState } from "react";

function summary(segment) {
  const args = segment.arguments || {};
  return args.path || args.command || args.pattern || args.query || args.url || args.task || "";
}

export default function ChatToolCard({ segment }) {
  const [open, setOpen] = useState(false);
  const running = segment.status === "running";
  const progress = segment.progress || "";
  const body = progress ? progress : (segment.content || JSON.stringify(segment.arguments || {}, null, 2));
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-sidebar/35">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sidebar/70">
        <span className={`material-symbols-outlined text-[16px] ${running ? "animate-spin text-primary" : "text-emerald-500"}`}>{running ? "progress_activity" : "check_circle"}</span>
        <span className="font-mono text-[11px] font-medium">{segment.name || "tool"}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-muted">{summary(segment)}</span>
        <span className="material-symbols-outlined text-[15px] text-text-muted">{open ? "expand_less" : "expand_more"}</span>
      </button>
      {open ? <pre className="max-h-72 overflow-auto border-t border-border bg-background/60 p-3 whitespace-pre-wrap break-words text-[11px] leading-5">{body}</pre> : null}
    </div>
  );
}
