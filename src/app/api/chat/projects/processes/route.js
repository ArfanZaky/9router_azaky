import { NextResponse } from "next/server";
import {
  listProcesses,
  killProcess,
  startBackgroundProcess,
  getProcessLogs,
  clearFinishedProcesses,
} from "@/lib/chat/processManager.js";
import { resolveProjectWorkspace } from "@/lib/chat/projectWorkspace.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawWorkspace = searchParams.get("workspace") || "";
    const sessionId = searchParams.get("sessionId") || null;
    const activeOnly = searchParams.get("activeOnly") === "1";

    let workspace = null;
    if (rawWorkspace) {
      try {
        workspace = resolveProjectWorkspace(rawWorkspace);
      } catch {
        workspace = rawWorkspace;
      }
    }

    const processes = listProcesses({ workspace, sessionId, activeOnly });
    return NextResponse.json({ ok: true, processes });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Failed to list processes" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body.action || "list").toLowerCase();

    if (action === "kill") {
      const target = body.id || body.pid;
      if (!target) {
        return NextResponse.json({ ok: false, error: "Process id or pid is required" }, { status: 400 });
      }
      const result = killProcess(target);
      return NextResponse.json({ ok: true, ...result });
    }

    if (action === "run") {
      const command = String(body.command || "").trim();
      const rawWorkspace = String(body.workspace || "").trim();
      if (!command) {
        return NextResponse.json({ ok: false, error: "Command is required" }, { status: 400 });
      }

      let workspace = "";
      if (rawWorkspace) {
        try {
          workspace = resolveProjectWorkspace(rawWorkspace);
        } catch {
          workspace = rawWorkspace;
        }
      }

      const proc = startBackgroundProcess({
        command,
        cwd: body.cwd || workspace || process.cwd(),
        workspace,
        sessionId: body.sessionId || "",
        shell: body.shell || "auto",
      });

      return NextResponse.json({ ok: true, process: proc });
    }

    if (action === "logs") {
      const id = String(body.id || "").trim();
      if (!id) {
        return NextResponse.json({ ok: false, error: "Process id is required" }, { status: 400 });
      }
      const logsData = getProcessLogs(id);
      return NextResponse.json({ ok: true, ...logsData });
    }

    if (action === "clear") {
      const rawWorkspace = String(body.workspace || "").trim();
      let workspace = null;
      if (rawWorkspace) {
        try { workspace = resolveProjectWorkspace(rawWorkspace); } catch { workspace = rawWorkspace; }
      }
      const res = clearFinishedProcesses(workspace);
      return NextResponse.json({ ok: true, ...res });
    }

    return NextResponse.json({ ok: false, error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Action failed" }, { status: 500 });
  }
}
