import { NextResponse } from "next/server";
import path from "node:path";
import {
  gitProjectStatus,
  gitStagePath,
  gitUnstagePath,
  gitDiscardPath,
  gitCommitChanges,
  gitUndoLastCommit,
  gitPushBranch,
  gitPullBranch,
  gitDiffPath,
  listGitRepositories,
  resolveProjectWorkspace,
} from "@/lib/chat/projectWorkspace.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validateWorkspaceBoundary(targetPath, rootPath) {
  if (!rootPath) return true;
  try {
    const resolvedTarget = resolveProjectWorkspace(targetPath);
    const resolvedRoot = resolveProjectWorkspace(rootPath);
    if (!resolvedTarget || !resolvedRoot) return false;
    const rel = path.relative(resolvedRoot, resolvedTarget);
    return !rel.startsWith("..") && !path.isAbsolute(rel) || resolvedTarget === resolvedRoot;
  } catch {
    return false;
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetPath = String(body.path || "").trim();
    const rootPath = String(body.rootPath || "").trim();
    const action = String(body.action || "status").trim().toLowerCase();

    if (!targetPath) {
      return NextResponse.json({ error: "path is required" }, { status: 400 });
    }

    // Safety boundary check if rootPath is specified
    if (rootPath && !validateWorkspaceBoundary(targetPath, rootPath)) {
      return NextResponse.json({ error: "Target path outside workspace boundary" }, { status: 403 });
    }

    if (action === "repos") {
      const repos = listGitRepositories(targetPath);
      return NextResponse.json({ repos });
    }

    if (action === "status") {
      return NextResponse.json(gitProjectStatus(targetPath, rootPath || null));
    }

    if (action === "diff") {
      const file = String(body.file || "");
      const staged = Boolean(body.staged);
      const diff = gitDiffPath(targetPath, file, staged);
      return NextResponse.json({ diff });
    }

    let message = "";
    let extraData = {};

    if (action === "stage") {
      message = gitStagePath(targetPath, body.file);
    } else if (action === "unstage") {
      message = gitUnstagePath(targetPath, body.file);
    } else if (action === "discard") {
      message = gitDiscardPath(targetPath, body.file, Boolean(body.isUntracked));
    } else if (action === "commit") {
      const commitRes = gitCommitChanges(targetPath, body.message, { stageAll: Boolean(body.stageAll) });
      message = commitRes.message;
    } else if (action === "undo-commit") {
      const undoRes = gitUndoLastCommit(targetPath);
      message = undoRes.message;
      extraData = { undoneMessage: undoRes.undoneMessage };
    } else if (action === "push") {
      message = gitPushBranch(targetPath, { remote: body.remote, branch: body.branch });
    } else if (action === "pull") {
      message = gitPullBranch(targetPath);
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    // Return the updated status along with action message
    const updatedStatus = gitProjectStatus(targetPath, rootPath || null);
    return NextResponse.json({
      ok: true,
      message,
      status: updatedStatus,
      ...extraData,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Git operation failed" },
      { status: 400 }
    );
  }
}
