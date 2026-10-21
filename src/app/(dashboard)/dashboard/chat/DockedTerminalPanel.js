"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";

function cleanOutput(text) {
  if (!text) return "";
  return String(text).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function DockedTerminalPanel({
  isOpen,
  onClose,
  workspacePath,
  onSendToChat,
}) {
  const [height, setHeight] = useState(260);
  const [isResizing, setIsResizing] = useState(false);
  const [command, setCommand] = useState("");
  const [executing, setExecuting] = useState(false);
  const [logs, setLogs] = useState([]);
  const [history, setHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [launching, setLaunching] = useState(false);
  const [launchMsg, setLaunchMsg] = useState(null);

  const consoleEndRef = useRef(null);
  const inputRef = useRef(null);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(260);

  // Resize handler
  const handleMouseDownResize = (e) => {
    setIsResizing(true);
    dragStartYRef.current = e.clientY;
    dragStartHeightRef.current = height;
  };

  useEffect(() => {
    if (!isResizing) return;
    const onMouseMove = (e) => {
      const delta = dragStartYRef.current - e.clientY;
      const nextH = Math.min(Math.max(160, dragStartHeightRef.current + delta), 600);
      setHeight(nextH);
    };
    const onMouseUp = () => setIsResizing(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isResizing, height]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  const handleExecute = useCallback(
    async (cmdToRun) => {
      const trimmed = String(cmdToRun || command).trim();
      if (!trimmed || executing || !workspacePath) return;

      setExecuting(true);
      setCommand("");
      setHistory((prev) => [trimmed, ...prev.filter((c) => c !== trimmed)].slice(0, 50));
      setHistoryIdx(-1);

      const runEntry = {
        id: `dock_cmd_${Date.now()}`,
        command: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        status: "running",
        stdout: "",
        stderr: "",
      };

      setLogs((prev) => [...prev, runEntry]);

      try {
        const res = await fetch("/api/chat/projects/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "exec",
            path: workspacePath,
            command: trimmed,
          }),
        });

        const data = await res.json().catch(() => null);

        setLogs((prev) =>
          prev.map((entry) => {
            if (entry.id !== runEntry.id) return entry;
            if (data?.ok) {
              return {
                ...entry,
                status: "success",
                stdout: cleanOutput(data.stdout || "(Completed with no output)"),
                stderr: cleanOutput(data.stderr || ""),
                exitCode: data.exitCode ?? 0,
              };
            }
            return {
              ...entry,
              status: "error",
              stdout: cleanOutput(data?.stdout || ""),
              stderr: cleanOutput(data?.stderr || data?.error || "Command failed"),
              exitCode: data?.exitCode ?? 1,
            };
          })
        );
      } catch (err) {
        setLogs((prev) =>
          prev.map((entry) =>
            entry.id === runEntry.id
              ? {
                  ...entry,
                  status: "error",
                  stderr: err?.message || "Execution error",
                  exitCode: 1,
                }
              : entry
          )
        );
      } finally {
        setExecuting(false);
        setTimeout(() => {
          consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }, 50);
      }
    },
    [command, executing, workspacePath]
  );

  const handleLaunchSystemTerminal = async () => {
    if (!workspacePath || launching) return;
    setLaunching(true);
    setLaunchMsg(null);
    try {
      const res = await fetch("/api/chat/projects/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "open",
          path: workspacePath,
          terminal: "default",
        }),
      });
      const data = await res.json().catch(() => null);
      if (data?.ok) {
        setLaunchMsg({ success: true, text: `Opened ${data.terminal || "terminal"}` });
      } else {
        setLaunchMsg({ success: false, text: data?.error || "Launch failed" });
      }
    } catch (e) {
      setLaunchMsg({ success: false, text: e?.message || "Launch failed" });
    } finally {
      setLaunching(false);
      setTimeout(() => setLaunchMsg(null), 3000);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleExecute();
    } else if (e.key === "ArrowUp") {
      if (history.length > 0) {
        e.preventDefault();
        const next = Math.min(historyIdx + 1, history.length - 1);
        setHistoryIdx(next);
        setCommand(history[next]);
      }
    } else if (e.key === "ArrowDown") {
      if (historyIdx > 0) {
        e.preventDefault();
        const next = historyIdx - 1;
        setHistoryIdx(next);
        setCommand(history[next]);
      } else if (historyIdx === 0) {
        e.preventDefault();
        setHistoryIdx(-1);
        setCommand("");
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  const quickCommands = [
    { label: "git status", cmd: "git status" },
    { label: "git branch", cmd: "git branch -a" },
    { label: "npm test", cmd: "npm test" },
    { label: "node -v", cmd: "node -v" },
  ];

  return (
    <div
      style={{ height: `${height}px` }}
      className="shrink-0 border-t border-border bg-zinc-950 text-zinc-100 flex flex-col font-mono text-xs select-text shadow-xl relative z-10"
    >
      {/* Resizer Handle */}
      <div
        onMouseDown={handleMouseDownResize}
        className="h-1.5 w-full bg-border/40 hover:bg-primary/50 cursor-ns-resize transition select-none flex items-center justify-center"
        title="Drag to resize terminal height"
      >
        <div className="w-8 h-0.5 rounded-full bg-zinc-500" />
      </div>

      {/* Terminal Title Bar */}
      <div className="shrink-0 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/90 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="material-symbols-outlined text-[16px] text-emerald-400">terminal</span>
          <span className="font-semibold text-zinc-200 text-[11px]">Terminal</span>
          <span className="truncate text-zinc-500 text-[10px] max-w-[280px]" title={workspacePath}>
            {workspacePath || "No directory"}
          </span>
          {launchMsg && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${launchMsg.success ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-400"}`}>
              {launchMsg.text}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quick command buttons */}
          <div className="hidden sm:flex items-center gap-1 mr-1">
            {quickCommands.map((q) => (
              <button
                key={q.cmd}
                type="button"
                disabled={executing}
                onClick={() => handleExecute(q.cmd)}
                className="rounded bg-zinc-800/80 px-1.5 py-0.5 text-[9px] text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition"
              >
                {q.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={launching || !workspacePath}
            onClick={handleLaunchSystemTerminal}
            className="flex items-center gap-1 rounded bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 transition"
            title="Open native system terminal"
          >
            <span className="material-symbols-outlined text-[12px]">open_in_new</span>
            <span className="hidden md:inline">External</span>
          </button>

          {logs.length > 0 && (
            <button
              type="button"
              onClick={() => setLogs([])}
              className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
              title="Clear terminal logs"
            >
              <span className="material-symbols-outlined text-[14px]">delete_sweep</span>
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition"
            title="Close terminal (Esc)"
          >
            <span className="material-symbols-outlined text-[15px]">close</span>
          </button>
        </div>
      </div>

      {/* Terminal Output Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5 custom-scrollbar text-[11px]">
        {logs.length === 0 ? (
          <div className="py-6 text-center text-zinc-500">
            <span className="material-symbols-outlined text-[24px] block mb-1 text-zinc-600">
              terminal
            </span>
            <p className="font-sans text-[11px]">Docked terminal active at {workspacePath || "project workspace"}</p>
            <p className="text-[10px] text-zinc-600 mt-0.5">Type a shell command below or click a quick action.</p>
          </div>
        ) : (
          logs.map((item) => (
            <div key={item.id} className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-zinc-400 border-b border-zinc-900 pb-0.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-emerald-400 font-bold">$</span>
                  <span className="font-semibold text-zinc-200 truncate">{item.command}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-zinc-500">{item.timestamp}</span>
                  {item.status === "running" ? (
                    <span className="rounded bg-amber-500/20 px-1 text-[9px] text-amber-300 animate-pulse">
                      running
                    </span>
                  ) : item.status === "success" ? (
                    <span className="rounded bg-emerald-500/20 px-1 text-[9px] text-emerald-400">
                      code 0
                    </span>
                  ) : (
                    <span className="rounded bg-red-500/20 px-1 text-[9px] text-red-400">
                      exit {item.exitCode}
                    </span>
                  )}
                  {onSendToChat && (
                    <button
                      type="button"
                      onClick={() =>
                        onSendToChat(`Terminal output for \`${item.command}\`:\n\`\`\`\n${item.stdout || item.stderr}\n\`\`\``)
                      }
                      className="text-zinc-400 hover:text-primary transition p-0.5 rounded"
                      title="Send output to chat for agent review"
                    >
                      <span className="material-symbols-outlined text-[13px]">chat</span>
                    </button>
                  )}
                </div>
              </div>

              {item.stdout && (
                <pre className="whitespace-pre-wrap break-all text-[11px] leading-4 text-zinc-300 pl-2">
                  {item.stdout}
                </pre>
              )}
              {item.stderr && (
                <pre className="whitespace-pre-wrap break-all text-[11px] leading-4 text-red-400 pl-2">
                  {item.stderr}
                </pre>
              )}
            </div>
          ))
        )}
        <div ref={consoleEndRef} />
      </div>

      {/* Terminal Input Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleExecute();
        }}
        className="shrink-0 flex items-center gap-2 border-t border-zinc-800 bg-zinc-900/70 px-3 py-1.5"
      >
        <span className="text-emerald-400 font-bold text-sm select-none">$</span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={executing}
          placeholder="Type command (e.g. npm test, git status, dir, ls)..."
          className="min-w-0 flex-1 bg-transparent py-1 font-mono text-[11px] text-zinc-100 placeholder:text-zinc-600 outline-none"
        />
        <button
          type="submit"
          disabled={executing || !command.trim()}
          className="flex shrink-0 items-center gap-1 rounded bg-primary text-primary-foreground px-2.5 py-1 text-[10px] font-semibold transition disabled:opacity-40"
        >
          <span className="material-symbols-outlined text-[13px]">
            {executing ? "sync" : "play_arrow"}
          </span>
          <span>{executing ? "Running" : "Run"}</span>
        </button>
      </form>
    </div>
  );
}

export default memo(DockedTerminalPanel);
