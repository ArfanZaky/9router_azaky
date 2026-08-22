"use client";

import { useMemo, useState } from "react";

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function summary(segment) {
  const args = segment.arguments || {};
  return args.path || args.command || args.pattern || args.query || args.url || args.task || "";
}

// Line-based LCS diff between old and new text → rows of {type: ctx|add|del, text}.
function lineDiff(oldText, newText) {
  const a = String(oldText || "").replace(/\n$/, "").split("\n");
  const b = String(newText || "").replace(/\n$/, "").split("\n");
  if (!oldText) {
    return b.map((text) => ({ type: "add", text }));
  }
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ type: "ctx", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: a[i] });
      i++;
      removed++;
    } else {
      rows.push({ type: "add", text: b[j] });
      j++;
      added++;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: a[i] });
    i++;
    removed++;
  }
  while (j < m) {
    rows.push({ type: "add", text: b[j] });
    j++;
    added++;
  }
  return { rows, added, removed };
}

export default function ChatToolCard({ segment, messageCreatedAt }) {
  const [open, setOpen] = useState(false);
  const running = segment.status === "running";
  const progress = segment.progress || "";
  const args = segment.arguments || {};

  const isEdit = segment.name === "edit_file";
  const isCreate = segment.name === "write_file";
  const isDiff = isEdit || isCreate;

  const diff = useMemo(() => {
    if (isEdit) return lineDiff(String(args.old_string ?? ""), String(args.new_string ?? ""));
    if (isCreate) return lineDiff("", String(args.content ?? ""));
    return { rows: [], added: 0, removed: 0 };
  }, [isEdit, isCreate, args.old_string, args.new_string, args.content]);

  const body = progress ? progress : (segment.content || JSON.stringify(args, null, 2));
  const timeStr = formatTime(segment.timestamp || segment.createdAt || messageCreatedAt);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-sidebar/35">
      <button type="button" onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sidebar/70">
        <span className={`material-symbols-outlined text-[16px] ${running ? "animate-spin text-primary" : "text-emerald-500"}`}>{running ? "progress_activity" : "check_circle"}</span>
        <span className="font-mono text-[11px] font-medium">{segment.name || "tool"}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-muted">{summary(segment)}</span>
        {timeStr ? <span className="font-mono text-[10px] text-text-muted opacity-70">{timeStr}</span> : null}
        {isDiff ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold tabular-nums">
            {diff.added > 0 ? <span className="text-emerald-500">+{diff.added}</span> : null}
            {diff.removed > 0 ? <span className="text-red-500">-{diff.removed}</span> : null}
          </span>
        ) : null}
        <span className="material-symbols-outlined text-[15px] text-text-muted">{open ? "expand_less" : "expand_more"}</span>
      </button>
      {open ? (
        isDiff && diff.rows.length > 0 ? (
          <div className="max-h-72 overflow-auto border-t border-border bg-background/60 py-1 font-mono text-[11px] leading-[1.5]">
            {diff.rows.map((row, i) => (
              <div key={i} className={`flex gap-2 px-3 ${row.type === "add" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : row.type === "del" ? "bg-red-500/10 text-red-600 dark:text-red-300" : "text-text-muted/70"}`}>
                <span className={`select-none ${row.type === "add" ? "text-emerald-500" : row.type === "del" ? "text-red-500" : "text-transparent"}`}>
                  {row.type === "add" ? "+" : row.type === "del" ? "-" : " "}
                </span>
                <span className="whitespace-pre">{row.text || " "}</span>
              </div>
            ))}
          </div>
        ) : (
          <pre className="max-h-72 overflow-auto border-t border-border bg-background/60 p-3 whitespace-pre-wrap break-words text-[11px] leading-5">{body}</pre>
        )
      ) : null}
    </div>
  );
}
