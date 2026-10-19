"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";

function cleanOutput(text) {
  if (!text) return "";
  // Strip ANSI escape codes
  return String(text).replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

function ProjectTerminalView({ workspacePath, onRunInChat }) {
  const [terminals, setTerminals] = useState([]);
  const [selectedTerminal, setSelectedTerminal] = useState("default");
  const [autoOpen, setAutoOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState(null);
  const [copiedPath, setCopiedPath] = useState(false);

  // In-browser command runner
  const [command, setCommand] = useState("");
  const [executing, setExecuting] = useState(false);
  const [outputLogs, setOutputLogs] = useState([]);
  const [cmdHistory, setCmdHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const consoleEndRef = useRef(null);
  const inputRef = useRef(null);
  const hasAutoOpenedRef = useRef(false);

  // Load preferences from localStorage
  useEffect(() => {
    try {
      const savedTerm = globalThis.localStorage?.getItem("chat.terminal.preferred");
      if (savedTerm) setSelectedTerminal(savedTerm);

      const savedAuto = globalThis.localStorage?.getItem("chat.terminal.autoOpen");
      if (savedAuto === "true") setAutoOpen(true);
    } catch {
      // ignore
    }
  }, []);

  // Fetch available terminals
  useEffect(() => {
    let alive = true;
    fetch("/api/chat/projects/terminal")
      .then((r) => r.json())
      .then((d) => {
        if (!alive || !d.ok || !Array.isArray(d.terminals)) return;
        setTerminals(d.terminals);
        const def = d.terminals.find((t) => t.isDefault && t.available);
        if (def && !globalThis.localStorage?.getItem("chat.terminal.preferred")) {
          setSelectedTerminal(def.id);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Launch native terminal
  const handleLaunchTerminal = useCallback(
    async (typeOverride = null) => {
      if (!workspacePath || launching) return;
      const targetType = typeOverride || selectedTerminal || "default";
      setLaunching(true);
      setLaunchResult(null);

      try {
        const res = await fetch("/api/chat/projects/terminal", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "open",
            path: workspacePath,
            terminal: targetType,
          }),
        });
        const data = await res.json().catch(() => null);
        if (data?.ok) {
          setLaunchResult({
            success: true,
            message: data.message || `Terminal opened at ${workspacePath}`,
            terminal: data.terminal,
          });
        } else {
          setLaunchResult({
            success: false,
            message: data?.error || "Failed to open terminal",
          });
        }
      } catch (err) {
        setLaunchResult({
          success: false,
          message: err?.message || "Failed to launch terminal process",
        });
      } finally {
        setLaunching(false);
      }
    },
    [workspacePath, selectedTerminal, launching]
  );

  // Auto-open on tab open if configured
  useEffect(() => {
    if (autoOpen && workspacePath && !hasAutoOpenedRef.current) {
      hasAutoOpenedRef.current = true;
      handleLaunchTerminal();
    }
  }, [autoOpen, workspacePath, handleLaunchTerminal]);

  // Execute in-sidebar shell command
  const handleExecuteCommand = useCallback(
    async (cmdToRun) => {
      const trimmed = String(cmdToRun || command).trim();
      if (!trimmed || executing || !workspacePath) return;

      setExecuting(true);
      setCommand("");
      setCmdHistory((prev) => [trimmed, ...prev.filter((c) => c !== trimmed)]);
      setHistoryIndex(-1);

      const runEntry = {
        id: `cmd_${Date.now()}`,
        command: trimmed,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        status: "running",
        stdout: "",
        stderr: "",
      };

      setOutputLogs((prev) => [...prev, runEntry]);

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

        setOutputLogs((prev) =>
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
        setOutputLogs((prev) =>
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
        }, 60);
      }
    },
    [command, executing, workspacePath]
  );

  const handleCopyPath = () => {
    if (!workspacePath) return;
    try {
      navigator.clipboard.writeText(workspacePath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleSelectTerminal = (termId) => {
    setSelectedTerminal(termId);
    try {
      globalThis.localStorage?.setItem("chat.terminal.preferred", termId);
    } catch {
      // ignore
    }
  };

  const handleToggleAutoOpen = (e) => {
    const val = e.target.checked;
    setAutoOpen(val);
    try {
      globalThis.localStorage?.setItem("chat.terminal.autoOpen", val ? "true" : "false");
    } catch {
      // ignore
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleExecuteCommand();
    } else if (e.key === "ArrowUp") {
      if (cmdHistory.length > 0) {
        e.preventDefault();
        const nextIdx = Math.min(historyIndex + 1, cmdHistory.length - 1);
        setHistoryIndex(nextIdx);
        setCommand(cmdHistory[nextIdx]);
      }
    } else if (e.key === "ArrowDown") {
      if (historyIndex > 0) {
        e.preventDefault();
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setCommand(cmdHistory[nextIdx]);
      } else if (historyIndex === 0) {
        e.preventDefault();
        setHistoryIndex(-1);
        setCommand("");
      }
    }
  };

  const quickCommands = [
    { label: "git status", cmd: "git status" },
    { label: "git branch", cmd: "git branch -a" },
    { label: "npm test", cmd: "npm test" },
    { label: "dir / ls", cmd: process.platform === "win32" ? "dir" : "ls -la" },
    { label: "node -v", cmd: "node -v" },
  ];

  return (
    <div className="space-y-4 text-xs">
      {/* Workspace Path Card */}
      <div className="rounded-xl border border-border bg-background/50 p-2.5 space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-text-muted">
          <span className="font-semibold uppercase tracking-wider">Working Directory</span>
          <button
            type="button"
            onClick={handleCopyPath}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-background/80 hover:text-foreground transition"
            title="Copy path to clipboard"
          >
            <span className="material-symbols-outlined text-[13px]">
              {copiedPath ? "check" : "content_copy"}
            </span>
            <span>{copiedPath ? "Copied" : "Copy"}</span>
          </button>
        </div>
        <div className="rounded-lg bg-black/40 px-2 py-1.5 border border-white/5 font-mono text-[11px] text-text-main break-all select-all">
          {workspacePath}
        </div>
      </div>

      {/* System Terminal Launcher */}
      <div className="rounded-xl border border-primary/20 bg-primary/[0.03] p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px] text-primary">terminal</span>
            <span className="text-[12px] font-semibold text-text-main">System Terminal</span>
          </div>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-medium text-primary border border-primary/20">
            Auto CD
          </span>
        </div>

        <p className="text-[11px] text-text-muted leading-relaxed">
          Open an external terminal window automatically navigated to this project path.
        </p>

        {/* Terminal Selection Pills */}
        {terminals.length > 0 && (
          <div className="space-y-1">
            <span className="text-[10px] font-medium text-text-muted">Choose Terminal App:</span>
            <div className="flex flex-wrap gap-1">
              {terminals.map((t) => {
                const isSelected = selectedTerminal === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    disabled={!t.available}
                    onClick={() => handleSelectTerminal(t.id)}
                    className={`rounded-lg px-2 py-1 text-[10px] font-medium transition ${
                      isSelected
                        ? "bg-primary text-primary-foreground font-semibold shadow-sm"
                        : t.available
                        ? "bg-background/70 text-text-muted hover:bg-background hover:text-foreground border border-border"
                        : "opacity-40 cursor-not-allowed border border-border/50 text-text-muted"
                    }`}
                    title={t.available ? `Open with ${t.name}` : `${t.name} (not detected)`}
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Primary Launch Button */}
        <button
          type="button"
          disabled={launching || !workspacePath}
          onClick={() => handleLaunchTerminal()}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-primary text-primary-foreground py-2.5 px-3 text-[12px] font-semibold shadow-sm hover:opacity-95 active:scale-[0.99] transition disabled:opacity-50"
        >
          <span className="material-symbols-outlined text-[16px]">
            {launching ? "sync" : "open_in_new"}
          </span>
          <span>
            {launching
              ? "Opening Terminal..."
              : `Open Terminal (${terminals.find((t) => t.id === selectedTerminal)?.name || "System"})`}
          </span>
        </button>

        {/* Auto-Open Setting */}
        <label className="flex items-center gap-2 cursor-pointer select-none pt-0.5">
          <input
            type="checkbox"
            checked={autoOpen}
            onChange={handleToggleAutoOpen}
            className="rounded border-border text-primary focus:ring-primary size-3.5"
          />
          <span className="text-[11px] text-text-muted">
            Auto-open system terminal when switching to this tab
          </span>
        </label>

        {/* Launch Status Feedback */}
        {launchResult && (
          <div
            className={`rounded-lg p-2 text-[11px] flex items-start gap-1.5 ${
              launchResult.success
                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                : "bg-red-500/10 text-red-400 border border-red-500/20"
            }`}
          >
            <span className="material-symbols-outlined text-[14px] shrink-0 mt-0.5">
              {launchResult.success ? "check_circle" : "error"}
            </span>
            <span className="break-all leading-4">{launchResult.message}</span>
          </div>
        )}
      </div>

      {/* Embedded Web Terminal Console */}
      <div className="space-y-2 pt-2 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-text-muted">terminal</span>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
              Web Console
            </span>
          </div>
          {outputLogs.length > 0 && (
            <button
              type="button"
              onClick={() => setOutputLogs([])}
              className="text-[10px] text-text-muted hover:text-foreground transition flex items-center gap-0.5"
              title="Clear terminal screen"
            >
              <span className="material-symbols-outlined text-[12px]">delete_sweep</span>
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Quick Command Chips */}
        <div className="flex flex-wrap gap-1">
          {quickCommands.map((q) => (
            <button
              key={q.cmd}
              type="button"
              disabled={executing}
              onClick={() => handleExecuteCommand(q.cmd)}
              className="rounded-md border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px] text-text-muted hover:border-primary/40 hover:text-foreground transition disabled:opacity-50"
            >
              {q.label}
            </button>
          ))}
        </div>

        {/* Console Output Screen */}
        <div className="rounded-xl border border-border bg-zinc-950 p-2.5 font-mono text-[11px] text-zinc-100 shadow-inner">
          <div className="max-h-64 min-h-[120px] overflow-y-auto space-y-3 custom-scrollbar pr-1 select-text">
            {outputLogs.length === 0 ? (
              <div className="py-4 text-center text-zinc-500">
                <span className="material-symbols-outlined text-[20px] block mb-1 text-zinc-600">
                  terminal
                </span>
                <p className="text-[11px]">Ready in {workspacePath}</p>
                <p className="text-[10px] text-zinc-600 mt-0.5">
                  Type a command below or click a quick action above.
                </p>
              </div>
            ) : (
              outputLogs.map((item) => (
                <div key={item.id} className="space-y-1">
                  {/* Command Row */}
                  <div className="flex items-center justify-between gap-1 text-[10px] text-zinc-400 border-b border-zinc-800/80 pb-0.5">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-emerald-400 font-bold">$</span>
                      <span className="font-semibold text-zinc-200 truncate">{item.command}</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
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
                          err {item.exitCode}
                        </span>
                      )}
                      {onRunInChat && (
                        <button
                          type="button"
                          onClick={() =>
                            onRunInChat(`Output for command \`${item.command}\`:\n\`\`\`\n${item.stdout || item.stderr}\n\`\`\``)
                          }
                          className="text-zinc-400 hover:text-zinc-200 p-0.5 rounded transition"
                          title="Send output to chat"
                        >
                          <span className="material-symbols-outlined text-[12px]">chat</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Stdout / Stderr display */}
                  {item.stdout && (
                    <pre className="whitespace-pre-wrap break-all text-[10px] leading-4 text-zinc-300">
                      {item.stdout}
                    </pre>
                  )}
                  {item.stderr && (
                    <pre className="whitespace-pre-wrap break-all text-[10px] leading-4 text-red-400/90">
                      {item.stderr}
                    </pre>
                  )}
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>

          {/* Interactive Command Input Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleExecuteCommand();
            }}
            className="flex items-center gap-1.5 pt-2 border-t border-zinc-800 mt-2"
          >
            <span className="text-emerald-400 font-bold text-[12px] select-none">$</span>
            <input
              ref={inputRef}
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={executing}
              placeholder="Type command (e.g. git status, npm test)..."
              className="min-w-0 flex-1 bg-transparent px-1 py-1 font-mono text-[11px] text-zinc-100 placeholder:text-zinc-600 outline-none"
            />
            <button
              type="submit"
              disabled={executing || !command.trim()}
              className="flex shrink-0 items-center gap-1 rounded bg-zinc-800 hover:bg-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-200 transition disabled:opacity-40"
              title="Execute command (Enter)"
            >
              <span className="material-symbols-outlined text-[12px]">
                {executing ? "sync" : "play_arrow"}
              </span>
              <span>{executing ? "Running" : "Run"}</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default memo(ProjectTerminalView);
