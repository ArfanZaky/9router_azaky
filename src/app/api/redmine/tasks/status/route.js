import { NextResponse } from "next/server";
import { getSettings, updateSettings, listChatSessions, updateChatSession } from "@/lib/localDb";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      ok: true,
      statuses: settings?.redmineTaskStatuses || {},
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const issueId = body.issueId || body.id;
    const status = body.status; // 'done' | 'working' | 'pending' | null

    if (!issueId) {
      return NextResponse.json({ error: "issueId is required" }, { status: 400 });
    }

    const settings = await getSettings();
    const rts = { ...(settings?.redmineTaskStatuses || {}) };
    const issueKey = String(issueId);

    if (status === null || status === "reset") {
      delete rts[issueKey];
    } else {
      rts[issueKey] = {
        ...(rts[issueKey] || {}),
        status,
        updatedAt: new Date().toISOString(),
      };
    }

    await updateSettings({ redmineTaskStatuses: rts });

    // Also update any matching chatSession projectMeta
    const allSessions = await listChatSessions({ limit: 300 });
    const matching = allSessions.find(
      (s) => String(s.projectMeta?.redmineIssueId) === issueKey
    );
    if (matching) {
      await updateChatSession(matching.id, {
        projectMeta: { ...matching.projectMeta, localStatus: status || "pending" },
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      issueId,
      status,
      updatedRecord: rts[issueKey] || null,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
