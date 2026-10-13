import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

// In-memory process registry: id -> ProcessRecord
const processRegistry = new Map();

function isProcessAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killProcessTree(pid) {
  if (!pid) return false;
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      return true;
    } else {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        process.kill(pid, "SIGKILL");
      }
      return true;
    }
  } catch {
    return !isProcessAlive(pid);
  }
}

function resolveShell(shell, cmd, isWin) {
  const s = String(shell || "").trim().toLowerCase();
  if (s === "powershell") {
    return { shell: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", cmd] };
  }
  if (s === "pwsh") {
    return { shell: "pwsh", args: ["-NoProfile", "-NonInteractive", "-Command", cmd] };
  }
  if (s === "bash") {
    return { shell: "bash", args: ["-c", cmd] };
  }
  if (s === "sh") {
    return { shell: "sh", args: ["-c", cmd] };
  }
  if (s === "cmd") {
    return { shell: "cmd.exe", args: ["/d", "/s", "/c", cmd] };
  }
  return isWin
    ? { shell: "cmd.exe", args: ["/d", "/s", "/c", cmd] }
    : { shell: "/bin/sh", args: ["-c", cmd] };
}

export function registerProcess({
  id = null,
  pid,
  command,
  cwd,
  workspace,
  sessionId,
  child = null,
  background = false,
}) {
  const procId = id || `proc_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  const record = {
    id: procId,
    pid,
    command: String(command || "").trim(),
    cwd: cwd ? path.normalize(cwd) : process.cwd(),
    workspace: workspace ? path.normalize(workspace) : "",
    sessionId: sessionId || "",
    background: Boolean(background),
    status: "running",
    exitCode: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    logs: [],
    childRef: child || null,
  };

  processRegistry.set(procId, record);

  const appendLog = (chunk) => {
    const text = String(chunk || "");
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    record.logs.push(...lines);
    if (record.logs.length > 300) {
      record.logs = record.logs.slice(-300);
    }
  };

  if (child) {
    child.stdout?.on("data", appendLog);
    child.stderr?.on("data", appendLog);
    child.on("close", (code) => {
      record.status = record.status === "killed" ? "killed" : "exited";
      record.exitCode = code;
      record.finishedAt = new Date().toISOString();
      record.childRef = null;
    });
    child.on("error", (err) => {
      record.status = "error";
      record.logs.push(`Error: ${err?.message || err}`);
      record.finishedAt = new Date().toISOString();
      record.childRef = null;
    });
  }

  return record;
}

export function startBackgroundProcess({
  command,
  cwd,
  workspace,
  sessionId,
  shell = "auto",
}) {
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("Command cannot be empty");

  const isWin = process.platform === "win32";
  const { shell: sh, args } = resolveShell(shell, cmd, isWin);
  const effectiveCwd = cwd ? path.normalize(cwd) : (workspace ? path.normalize(workspace) : process.cwd());

  const child = spawn(sh, args, {
    cwd: effectiveCwd,
    env: process.env,
    windowsHide: true,
    detached: !isWin, // Detach on POSIX so it has its own process group
  });

  const record = registerProcess({
    pid: child.pid,
    command: cmd,
    cwd: effectiveCwd,
    workspace: workspace || effectiveCwd,
    sessionId: sessionId || "",
    child,
    background: true,
  });

  return {
    id: record.id,
    pid: record.pid,
    command: record.command,
    cwd: record.cwd,
    status: record.status,
    startedAt: record.startedAt,
  };
}

export function listProcesses({ workspace = null, sessionId = null, activeOnly = false } = {}) {
  const normalizedWs = workspace ? path.normalize(workspace).toLowerCase() : null;
  const list = [];

  for (const record of processRegistry.values()) {
    // Check liveness if currently thought to be running
    if (record.status === "running") {
      if (!isProcessAlive(record.pid)) {
        record.status = "exited";
        record.finishedAt = record.finishedAt || new Date().toISOString();
        record.childRef = null;
      }
    }

    if (activeOnly && record.status !== "running") continue;

    // Filter by workspace if specified
    if (normalizedWs) {
      const matchWs = record.workspace && record.workspace.toLowerCase() === normalizedWs;
      const matchCwd = record.cwd && record.cwd.toLowerCase().startsWith(normalizedWs);
      if (!matchWs && !matchCwd) continue;
    }

    // Filter by sessionId if specified
    if (sessionId && record.sessionId && record.sessionId !== sessionId) {
      continue;
    }

    list.push({
      id: record.id,
      pid: record.pid,
      command: record.command,
      cwd: record.cwd,
      workspace: record.workspace,
      sessionId: record.sessionId,
      background: record.background,
      status: record.status,
      exitCode: record.exitCode,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      logsCount: record.logs.length,
      lastLog: record.logs.length > 0 ? record.logs[record.logs.length - 1] : "",
    });
  }

  // Sort: running first, then by startedAt descending
  list.sort((a, b) => {
    if (a.status === "running" && b.status !== "running") return -1;
    if (a.status !== "running" && b.status === "running") return 1;
    return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
  });

  return list.slice(0, 50);
}

export function getProcessLogs(id) {
  const record = processRegistry.get(id);
  if (!record) return { logs: [], status: "not_found" };
  if (record.status === "running" && !isProcessAlive(record.pid)) {
    record.status = "exited";
    record.finishedAt = record.finishedAt || new Date().toISOString();
  }
  return {
    id: record.id,
    pid: record.pid,
    command: record.command,
    status: record.status,
    logs: record.logs,
  };
}

export function killProcess(idOrPid) {
  let target = null;
  if (typeof idOrPid === "string" && processRegistry.has(idOrPid)) {
    target = processRegistry.get(idOrPid);
  } else {
    const numPid = Number(idOrPid);
    for (const r of processRegistry.values()) {
      if (r.pid === numPid) { target = r; break; }
    }
  }

  if (target) {
    killProcessTree(target.pid);
    target.status = "killed";
    target.finishedAt = new Date().toISOString();
    target.logs.push(`Process killed by user at ${target.finishedAt}`);
    return { ok: true, killed: true, id: target.id, pid: target.pid };
  }

  // If not found in registry but a valid PID was given, attempt killing it directly
  const pidNum = Number(idOrPid);
  if (pidNum > 0) {
    const success = killProcessTree(pidNum);
    return { ok: success, killed: success, pid: pidNum };
  }

  throw new Error("Process not found");
}

export function clearFinishedProcesses(workspace = null) {
  const normalizedWs = workspace ? path.normalize(workspace).toLowerCase() : null;
  let count = 0;
  for (const [id, r] of processRegistry.entries()) {
    if (r.status !== "running") {
      if (normalizedWs) {
        const matchWs = r.workspace && r.workspace.toLowerCase() === normalizedWs;
        const matchCwd = r.cwd && r.cwd.toLowerCase().startsWith(normalizedWs);
        if (!matchWs && !matchCwd) continue;
      }
      processRegistry.delete(id);
      count++;
    }
  }
  return { clearedCount: count };
}
