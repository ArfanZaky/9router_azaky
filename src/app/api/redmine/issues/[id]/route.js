import { NextResponse } from "next/server";
import {
  getRedmineIssueDetail,
  updateRedmineIssue,
  getRedmineConfig,
} from "@/lib/redmine/redmineClient";
import { getSettings, getChatSession } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing issue ID" }, { status: 400 });
    const issue = await getRedmineIssueDetail(id);
    if (!issue) return NextResponse.json({ error: "Issue not found" }, { status: 404 });

    const config = await getRedmineConfig();
    const projectPaths = config.projectPaths || {};
    const pid = String(issue.project?.id || "");
    const pident = String(issue.project?.identifier || "");
    const assigned = projectPaths[pid] || projectPaths[pident] || null;
    const localPath = assigned?.path || null;

    let localTaskStatuses = {};
    try {
      const settings = await getSettings();
      localTaskStatuses = settings?.redmineTaskStatuses || {};
    } catch {
      // ignore
    }
    const localTask = localTaskStatuses[String(issue.id)] || null;

    let validSessionId = localTask?.sessionId || null;
    let localStatus = localTask?.status || null;
    if (validSessionId) {
      try {
        const session = await getChatSession(validSessionId, { includeMessages: false });
        if (!session) {
          validSessionId = null;
          if (localStatus === "working") {
            localStatus = null;
          }
        }
      } catch {
        // ignore
      }
    }

    return NextResponse.json({
      ...issue,
      localPath,
      localStatus,
      localStatusReason: localTask?.reason || null,
      localSessionId: validSessionId,
      localSessionTitle: validSessionId ? localTask?.sessionTitle || null : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing issue ID" }, { status: 400 });
    const body = await request.json();
    const result = await updateRedmineIssue(id, body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
