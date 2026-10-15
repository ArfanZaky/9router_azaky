import { NextResponse } from "next/server";
import {
  assignRedmineProjectPath,
  removeRedmineProjectPath,
  inspectLocalPath,
} from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const { projectId, path: targetPath } = body;

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const cleanPath = targetPath ? String(targetPath).trim() : "";
    const updatedPaths = await assignRedmineProjectPath(projectId, cleanPath);
    const inspection = cleanPath ? inspectLocalPath(cleanPath) : null;

    return NextResponse.json({
      ok: true,
      projectId: String(projectId),
      localPath: cleanPath || null,
      inspection,
      projectPaths: updatedPaths,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    let projectId = searchParams.get("projectId");
    if (!projectId) {
      const body = await req.json().catch(() => ({}));
      projectId = body.projectId;
    }

    if (!projectId) {
      return NextResponse.json({ error: "projectId is required" }, { status: 400 });
    }

    const updatedPaths = await removeRedmineProjectPath(projectId);
    return NextResponse.json({
      ok: true,
      projectId: String(projectId),
      localPath: null,
      projectPaths: updatedPaths,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
