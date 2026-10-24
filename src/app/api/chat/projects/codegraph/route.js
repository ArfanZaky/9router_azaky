import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveProjectWorkspace } from "@/lib/chat/projectWorkspace.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function cleanAnsi(str = "") {
  return String(str || "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
}

function parseCodegraphStatus(raw = "") {
  const clean = cleanAnsi(raw);
  const filesMatch = clean.match(/Files:\s+([\d,]+)/i);
  const nodesMatch = clean.match(/Nodes:\s+([\d,]+)/i);
  const edgesMatch = clean.match(/Edges:\s+([\d,]+)/i);
  const sizeMatch = clean.match(/DB Size:\s+([^\r\n]+)/i);
  const isUpToDate = /index is up to date|already up to date/i.test(clean);
  const isNotInitialized = /not initialized/i.test(clean);

  return {
    initialized: !isNotInitialized,
    files: filesMatch ? filesMatch[1].trim() : null,
    nodes: nodesMatch ? nodesMatch[1].trim() : null,
    edges: edgesMatch ? edgesMatch[1].trim() : null,
    dbSize: sizeMatch ? sizeMatch[1].trim() : null,
    isUpToDate,
    raw: clean,
  };
}

function runCodegraph(args, cwd, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    execFile("codegraph", args, { shell: true, cwd, timeout: timeoutMs }, (err, stdout, stderr) => {
      const outStr = cleanAnsi(stdout);
      const errStr = cleanAnsi(stderr);
      if (err) {
        const error = new Error(errStr || outStr || err.message);
        error.code = err.code;
        error.stdout = outStr;
        error.stderr = errStr;
        return reject(error);
      }
      resolve({
        stdout: outStr,
        stderr: errStr,
      });
    });
  });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawWorkspace = searchParams.get("workspace") || "";
    if (!rawWorkspace) {
      return NextResponse.json({ ok: false, error: "workspace parameter is required" }, { status: 400 });
    }
    let workspace = "";
    try {
      workspace = resolveProjectWorkspace(rawWorkspace);
    } catch {
      workspace = rawWorkspace;
    }
    if (!workspace) {
      return NextResponse.json({ ok: false, error: "Invalid workspace path" }, { status: 400 });
    }

    try {
      const res = await runCodegraph(["status", workspace], workspace, 20000);
      const parsed = parseCodegraphStatus(res.stdout);
      return NextResponse.json({ ok: true, installed: true, status: parsed });
    } catch (err) {
      if (err.message?.includes("not recognized") || err.message?.includes("not found")) {
        return NextResponse.json({ ok: false, installed: false, error: "codegraph CLI not installed or not in PATH" });
      }
      const parsed = parseCodegraphStatus(err.stderr || err.stdout || err.message);
      return NextResponse.json({ ok: true, installed: true, status: parsed, error: err.message });
    }
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message || "Failed to get codegraph status" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawWorkspace = String(body.workspace || "").trim();
    if (!rawWorkspace) {
      return NextResponse.json({ ok: false, error: "workspace is required" }, { status: 400 });
    }
    let workspace = "";
    try {
      workspace = resolveProjectWorkspace(rawWorkspace);
    } catch {
      workspace = rawWorkspace;
    }
    if (!workspace) {
      return NextResponse.json({ ok: false, error: "Invalid workspace path" }, { status: 400 });
    }

    const action = String(body.action || "sync").toLowerCase();

    // Check if initialized
    const hasCodegraphDir = fs.existsSync(path.join(workspace, ".codegraph"));
    const cmd = (!hasCodegraphDir && action === "sync") ? "init" : (action === "init" ? "init" : "sync");

    const execRes = await runCodegraph([cmd, workspace], workspace, 180000);

    // After sync, get updated status
    let status = null;
    try {
      const statusRes = await runCodegraph(["status", workspace], workspace, 20000);
      status = parseCodegraphStatus(statusRes.stdout);
    } catch {
      // ignore status fetch failure
    }

    return NextResponse.json({
      ok: true,
      action: cmd,
      output: execRes.stdout,
      status,
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      error: err.message || "Codegraph execution failed",
      stdout: err.stdout || "",
      stderr: err.stderr || "",
    }, { status: 500 });
  }
}
