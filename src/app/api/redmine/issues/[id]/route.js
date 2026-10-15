import { NextResponse } from "next/server";
import {
  getRedmineIssueDetail,
  updateRedmineIssue,
  getRedmineConfig,
} from "@/lib/redmine/redmineClient";
import { getSettings } from "@/lib/localDb";

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

    return NextResponse.json({
      ...issue,
      localPath,
      localStatus: localTask?.status || null,
      localSessionId: localTask?.sessionId || null,
      localSessionTitle: localTask?.sessionTitle || null,
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
