import { NextResponse } from "next/server";
import {
  inspectProjectWorkspace,
  gitProjectStatus,
  readProjectPlan,
  listProjectTree,
  projectEnvFiles,
} from "@/lib/chat/projectWorkspace.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const path = String(body.path || "");
    const sub = String(body.sub || "");
    if (!path) return NextResponse.json({ error: "path is required" }, { status: 400 });

    if (body.tree === true) {
      return NextResponse.json({ entries: listProjectTree(path, sub) });
    }

    const inspect = inspectProjectWorkspace(path);
    return NextResponse.json({
      workspacePath: inspect.workspacePath,
      name: inspect.name,
      scripts: inspect.scripts,
      packageName: inspect.packageName,
      files: inspect.files,
      git: gitProjectStatus(path),
      plan: readProjectPlan(path),
      envFiles: projectEnvFiles(path),
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to inspect project" }, { status: 400 });
  }
}
