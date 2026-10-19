import { NextResponse } from "next/server";
import { spawn, execSync, exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveProjectWorkspace } from "@/lib/chat/projectWorkspace.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getGitBashPath() {
  const candidates = [
    "C:\\Program Files\\Git\\git-bash.exe",
    "C:\\Program Files (x86)\\Git\\git-bash.exe",
    path.join(process.env.LOCALAPPDATA || "", "Programs\\Git\\git-bash.exe"),
  ];
  return candidates.find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }) || null;
}

function getAvailableTerminals() {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const list = [];

  if (isWin) {
    let hasWt = false;
    try {
      execSync("where wt.exe", { stdio: "ignore" });
      hasWt = true;
    } catch {
      // not in PATH
    }

    const gitBashPath = getGitBashPath();

    list.push({
      id: "wt",
      name: "Windows Terminal",
      available: hasWt,
      isDefault: hasWt,
      command: "wt.exe",
    });

    list.push({
      id: "gitbash",
      name: "Git Bash",
      available: Boolean(gitBashPath),
      isDefault: false,
      command: gitBashPath || "git-bash.exe",
    });

    list.push({
      id: "powershell",
      name: "PowerShell",
      available: true,
      isDefault: !hasWt,
      command: "powershell.exe",
    });

    list.push({
      id: "cmd",
      name: "Command Prompt",
      available: true,
      isDefault: false,
      command: "cmd.exe",
    });

    return list;
  }

  if (isMac) {
    list.push({
      id: "terminal",
      name: "Terminal.app",
      available: true,
      isDefault: true,
      command: "Terminal.app",
    });

    let hasIterm = false;
    try {
      hasIterm = fs.existsSync("/Applications/iTerm.app");
    } catch {
      // ignore
    }

    list.push({
      id: "iterm2",
      name: "iTerm2",
      available: hasIterm,
      isDefault: false,
      command: "iTerm.app",
    });

    return list;
  }

  // Linux / Unix
  const emulators = [
    { id: "x-terminal-emulator", name: "Default Terminal", cmd: "x-terminal-emulator" },
    { id: "gnome-terminal", name: "GNOME Terminal", cmd: "gnome-terminal" },
    { id: "konsole", name: "Konsole", cmd: "konsole" },
    { id: "xfce4-terminal", name: "XFCE Terminal", cmd: "xfce4-terminal" },
    { id: "alacritty", name: "Alacritty", cmd: "alacritty" },
    { id: "kitty", name: "Kitty", cmd: "kitty" },
    { id: "xterm", name: "XTerm", cmd: "xterm" },
  ];

  let firstFound = false;
  for (const emu of emulators) {
    let found = false;
    try {
      execSync(`which ${emu.cmd}`, { stdio: "ignore" });
      found = true;
    } catch {
      // not found
    }
    const isDef = found && !firstFound;
    if (found) firstFound = true;
    list.push({
      id: emu.id,
      name: emu.name,
      available: found,
      isDefault: isDef,
      command: emu.cmd,
    });
  }

  return list;
}

function launchSystemTerminal(resolvedPath, preferredType = "default") {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWin) {
    let type = preferredType;
    const gitBashPath = getGitBashPath();

    let hasWt = false;
    try {
      execSync("where wt.exe", { stdio: "ignore" });
      hasWt = true;
    } catch {
      // ignore
    }

    if (!type || type === "default" || type === "auto") {
      type = hasWt ? "wt" : "powershell";
    }

    if (type === "wt" && hasWt) {
      const child = spawn("cmd.exe", ["/c", "start", "", "wt.exe", "-d", resolvedPath], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return { terminal: "Windows Terminal", command: `wt.exe -d "${resolvedPath}"` };
    }

    if (type === "gitbash" && gitBashPath) {
      const child = spawn("cmd.exe", ["/c", "start", "", gitBashPath, `--cd=${resolvedPath}`], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
      child.unref();
      return { terminal: "Git Bash", command: `git-bash.exe --cd="${resolvedPath}"` };
    }

    if (type === "powershell") {
      const escapedPath = resolvedPath.replace(/'/g, "''");
      const child = spawn(
        "cmd.exe",
        [
          "/c",
          "start",
          "",
          "powershell.exe",
          "-NoExit",
          "-Command",
          `Set-Location -LiteralPath '${escapedPath}'`,
        ],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: false,
        }
      );
      child.unref();
      return { terminal: "PowerShell", command: `powershell.exe -NoExit -Command Set-Location -LiteralPath '${escapedPath}'` };
    }

    // Default cmd fallback
    const child = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/K", `cd /d "${resolvedPath}"`], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return { terminal: "Command Prompt", command: `cmd.exe /K cd /d "${resolvedPath}"` };
  }

  if (isMac) {
    if (preferredType === "iterm2") {
      const child = spawn("open", ["-a", "iTerm", resolvedPath], {
        detached: true,
        stdio: "ignore",
      });
      child.unref();
      return { terminal: "iTerm2", command: `open -a iTerm "${resolvedPath}"` };
    }
    const child = spawn("open", ["-a", "Terminal", resolvedPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return { terminal: "Terminal.app", command: `open -a Terminal "${resolvedPath}"` };
  }

  // Linux / Unix
  const emulators = ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal", "alacritty", "kitty", "xterm"];
  for (const emu of emulators) {
    try {
      execSync(`which ${emu}`, { stdio: "ignore" });
      let args = [];
      if (emu === "gnome-terminal" || emu === "xfce4-terminal") {
        args = [`--working-directory=${resolvedPath}`];
      } else if (emu === "konsole") {
        args = ["--workdir", resolvedPath];
      } else {
        args = ["-e", `bash -c "cd '${resolvedPath}' && exec bash"`];
      }
      const child = spawn(emu, args, { detached: true, stdio: "ignore" });
      child.unref();
      return { terminal: emu, command: `${emu} ${args.join(" ")}` };
    } catch {
      // continue search
    }
  }

  throw new Error("No terminal emulator found on this system");
}

export async function GET() {
  try {
    const terminals = getAvailableTerminals();
    return NextResponse.json({
      ok: true,
      platform: process.platform,
      terminals,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "open").toLowerCase();
    const rawPath = String(body.path || "").trim();

    if (!rawPath) {
      return NextResponse.json({ ok: false, error: "Project path is required" }, { status: 400 });
    }

    let resolvedPath = "";
    try {
      resolvedPath = resolveProjectWorkspace(rawPath);
    } catch (err) {
      return NextResponse.json({ ok: false, error: `Invalid project path: ${err.message}` }, { status: 400 });
    }

    if (action === "terminals") {
      const terminals = getAvailableTerminals();
      return NextResponse.json({ ok: true, platform: process.platform, terminals });
    }

    if (action === "open") {
      const terminalType = String(body.terminal || "default").trim();
      const launchResult = launchSystemTerminal(resolvedPath, terminalType);
      return NextResponse.json({
        ok: true,
        message: `Opened ${launchResult.terminal} at ${resolvedPath}`,
        terminal: launchResult.terminal,
        command: launchResult.command,
        path: resolvedPath,
      });
    }

    if (action === "exec") {
      const command = String(body.command || "").trim();
      if (!command) {
        return NextResponse.json({ ok: false, error: "Command is required" }, { status: 400 });
      }

      const timeoutMs = Math.min(Number(body.timeout) || 30000, 60000);
      const isWin = process.platform === "win32";
      const shellOption = isWin ? "powershell.exe" : "/bin/bash";

      return new Promise((resolve) => {
        exec(
          command,
          {
            cwd: resolvedPath,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024 * 2,
            shell: shellOption,
          },
          (error, stdout, stderr) => {
            resolve(
              NextResponse.json({
                ok: !error || error.code === 0,
                stdout: stdout || "",
                stderr: stderr || (error ? error.message : ""),
                exitCode: error ? (error.code ?? 1) : 0,
                path: resolvedPath,
                command,
              })
            );
          }
        );
      });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Request failed" }, { status: 500 });
  }
}
