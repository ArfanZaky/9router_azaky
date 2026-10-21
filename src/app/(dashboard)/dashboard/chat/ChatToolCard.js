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

// Line-based LCS diff between old and new text -> rows of {type: ctx|add|del, text}.
function lineDiff(oldText, newText) {
  const a = String(oldText || "").replace(/\n$/, "").split("\n");
  const b = String(newText || "").replace(/\n$/, "").split("\n");
  if (!oldText) {
    return {
      rows: b.map((text) => ({ type: "add", text })),
      added: b.length,
      removed: 0,
    };
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

// Pair lines for split diff view
function buildSplitRows(rows) {
  const split = [];
  let curDel = [];
  let curAdd = [];

  const flush = () => {
    const maxLen = Math.max(curDel.length, curAdd.length);
    for (let k = 0; k < maxLen; k++) {
      split.push({
        left: curDel[k] !== undefined ? curDel[k] : null,
        right: curAdd[k] !== undefined ? curAdd[k] : null,
      });
    }
    curDel = [];
    curAdd = [];
  };

  for (const r of rows) {
    if (r.type === "ctx") {
      flush();
      split.push({ left: r.text, right: r.text, isCtx: true });
    } else if (r.type === "del") {
      curDel.push(r.text);
    } else if (r.type === "add") {
      curAdd.push(r.text);
    }
  }
  flush();
  return split;
}

export default function ChatToolCard({ segment, messageCreatedAt }) {
  const [open, setOpen] = useState(false);
  const [diffMode, setDiffMode] = useState("unified"); // unified | split
  const [reverting, setReverting] = useState(false);
  const [revertStatus, setRevertStatus] = useState(null); // { success: boolean, msg: string }

  const running = segment.status === "running";
  const progress = segment.progress || "";
  const args = segment.arguments || {};

  const isEdit = segment.name === "edit_file";
  const isCreate = segment.name === "write_file";
  const isDiff = isEdit || isCreate;

  const resultData = useMemo(() => {
    if (!segment.content) return null;
    try {
      return JSON.parse(segment.content);
    } catch {
      return null;
    }
  }, [segment.content]);

  const diff = useMemo(() => {
    if (isEdit) {
      return lineDiff(String(args.old_string ?? ""), String(args.new_string ?? ""));
    }
    if (isCreate) {
      const prev = resultData?.previousContent;
      return lineDiff(prev ? String(prev) : "", String(args.content ?? ""));
    }
    return { rows: [], added: 0, removed: 0 };
  }, [isEdit, isCreate, args.old_string, args.new_string, args.content, resultData?.previousContent]);

  const splitRows = useMemo(() => {
    if (diffMode !== "split" || diff.rows.length === 0) return [];
    return buildSplitRows(diff.rows);
  }, [diffMode, diff.rows]);

  const handleRevert = async (e) => {
    e.stopPropagation();
    const filePath = args.path;
    if (!filePath || reverting) return;

    setReverting(true);
    setRevertStatus(null);
    try {
      const prevContent = isEdit ? (args.old_string ?? "") : resultData?.previousContent;
      const isNewFile = resultData?.isNew || (!isEdit && !prevContent);

      const res = await fetch("/api/chat/files/revert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: filePath,
          isNew: isNewFile,
          previousContent: prevContent,
        }),
      });

      const data = await res.json().catch(() => null);
      if (data?.ok) {
        setRevertStatus({ success: true, msg: data.message || "Reverted successfully" });
      } else {
        setRevertStatus({ success: false, msg: data?.error || "Revert failed" });
      }
    } catch (err) {
      setRevertStatus({ success: false, msg: err?.message || "Revert request failed" });
    } finally {
      setReverting(false);
      setTimeout(() => setRevertStatus(null), 4000);
    }
  };

  const body = progress ? progress : (segment.content || JSON.stringify(args, null, 2));
  const timeStr = formatTime(segment.timestamp || segment.createdAt || messageCreatedAt);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-sidebar/35 shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-sidebar/70 transition"
      >
        <span
          className={`material-symbols-outlined text-[16px] ${
            running ? "animate-spin text-primary" : "text-emerald-500"
          }`}
        >
          {running ? "progress_activity" : "check_circle"}
        </span>
        <span className="font-mono text-[11px] font-semibold">{segment.name || "tool"}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-text-muted">
          {summary(segment)}
        </span>
        {timeStr ? (
          <span className="font-mono text-[10px] text-text-muted opacity-70">{timeStr}</span>
        ) : null}
        {isDiff ? (
          <span className="flex items-center gap-1 text-[10px] font-semibold tabular-nums ml-1">
            {diff.added > 0 ? <span className="text-emerald-500">+{diff.added}</span> : null}
            {diff.removed > 0 ? <span className="text-red-500">-{diff.removed}</span> : null}
          </span>
        ) : null}
        <span className="material-symbols-outlined text-[15px] text-text-muted">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-border bg-background/60">
          {isDiff && (
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-background/80 text-[10px]">
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-text-muted truncate max-w-[200px] sm:max-w-[340px]">
                  {args.path || "File diff"}
                </span>
                {revertStatus && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      revertStatus.success
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {revertStatus.msg}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {/* Unified / Split toggle */}
                <div className="flex rounded border border-border overflow-hidden text-[9px]">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDiffMode("unified");
                    }}
                    className={`px-1.5 py-0.5 transition ${
                      diffMode === "unified"
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-text-muted hover:text-foreground"
                    }`}
                  >
                    Unified
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDiffMode("split");
                    }}
                    className={`px-1.5 py-0.5 transition border-l border-border ${
                      diffMode === "split"
                        ? "bg-primary text-primary-foreground font-semibold"
                        : "text-text-muted hover:text-foreground"
                    }`}
                  >
                    Split
                  </button>
                </div>

                {/* Revert Button */}
                <button
                  type="button"
                  disabled={reverting || !args.path}
                  onClick={handleRevert}
                  className="flex items-center gap-1 rounded bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 border border-red-500/30 px-2 py-0.5 text-[10px] font-medium transition disabled:opacity-50"
                  title="Revert changes made to this file"
                >
                  <span className="material-symbols-outlined text-[12px]">
                    {reverting ? "sync" : "undo"}
                  </span>
                  <span>{reverting ? "Reverting..." : "Revert"}</span>
                </button>
              </div>
            </div>
          )}

          {isDiff && diff.rows.length > 0 ? (
            diffMode === "split" ? (
              <div className="max-h-80 overflow-auto py-1 font-mono text-[11px] leading-[1.5] custom-scrollbar">
                <table className="w-full border-collapse">
                  <tbody>
                    {splitRows.map((row, i) => (
                      <tr key={i} className="border-b border-border/20">
                        {/* Old / Deleted Column */}
                        <td
                          className={`w-1/2 align-top px-2 py-0.5 border-r border-border/40 ${
                            row.isCtx
                              ? "text-text-muted/70"
                              : row.left !== null
                              ? "bg-red-500/10 text-red-600 dark:text-red-300"
                              : "bg-transparent"
                          }`}
                        >
                          <div className="flex gap-1.5">
                            <span className="select-none text-red-500 text-[10px] w-3 shrink-0">
                              {row.left !== null && !row.isCtx ? "-" : " "}
                            </span>
                            <span className="whitespace-pre break-all">{row.left ?? ""}</span>
                          </div>
                        </td>

                        {/* New / Added Column */}
                        <td
                          className={`w-1/2 align-top px-2 py-0.5 ${
                            row.isCtx
                              ? "text-text-muted/70"
                              : row.right !== null
                              ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : "bg-transparent"
                          }`}
                        >
                          <div className="flex gap-1.5">
                            <span className="select-none text-emerald-500 text-[10px] w-3 shrink-0">
                              {row.right !== null && !row.isCtx ? "+" : " "}
                            </span>
                            <span className="whitespace-pre break-all">{row.right ?? ""}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="max-h-80 overflow-auto py-1 font-mono text-[11px] leading-[1.5] custom-scrollbar">
                {diff.rows.map((row, i) => (
                  <div
                    key={i}
                    className={`flex gap-2 px-3 py-0.5 ${
                      row.type === "add"
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : row.type === "del"
                        ? "bg-red-500/10 text-red-600 dark:text-red-300"
                        : "text-text-muted/70"
                    }`}
                  >
                    <span
                      className={`select-none w-3 shrink-0 text-center ${
                        row.type === "add"
                          ? "text-emerald-500 font-bold"
                          : row.type === "del"
                          ? "text-red-500 font-bold"
                          : "text-transparent"
                      }`}
                    >
                      {row.type === "add" ? "+" : row.type === "del" ? "-" : " "}
                    </span>
                    <span className="whitespace-pre break-all">{row.text || " "}</span>
                  </div>
                ))}
              </div>
            )
          ) : (
            <pre className="max-h-80 overflow-auto p-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 custom-scrollbar">
              {body}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
