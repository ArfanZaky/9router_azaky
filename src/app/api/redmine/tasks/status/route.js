import { NextResponse } from "next/server";
import {
  getSettings,
  updateSettings,
  updateChatSession,
} from "@/lib/localDb";
import {
  findActiveRedmineSession,
  spawnRedmineTaskSession,
} from "@/lib/redmine/taskSpawner";
import { postTaskCompletionComment } from "@/lib/redmine/commentSummary";

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
    const status = body.status; // 'done' | 'working' | 'pending' | 'reset' | null

    if (!issueId) {
      return NextResponse.json({ error: "issueId is required" }, { status: 400 });
    }

    const issueKey = String(issueId);
    const settings = await getSettings();
    const rts = { ...(settings?.redmineTaskStatuses || {}) };
    const currentTracked = rts[issueKey];

    if (status === null || status === "reset") {
      delete rts[issueKey];
      await updateSettings({ redmineTaskStatuses: rts });

      // Update matching chat session if present
      const existing = await findActiveRedmineSession(issueKey, currentTracked?.sessionId);
      if (existing) {
        await updateChatSession(existing.id, {
          projectMeta: { ...existing.projectMeta, localStatus: null },
        }).catch(() => {});
      }

      return NextResponse.json({
        ok: true,
        issueId,
        status: null,
        sessionId: null,
        updatedRecord: null,
      });
    }

    // When status is "working", check whether a valid session already exists or must be spawned
    if (status === "working") {
      const existingSession = await findActiveRedmineSession(issueKey, currentTracked?.sessionId);

      if (existingSession) {
        // Session already exists and is valid: reuse it
        rts[issueKey] = {
          ...(currentTracked || {}),
          status: "working",
          sessionId: existingSession.id,
          sessionTitle: existingSession.title,
          reason: null,
          updatedAt: new Date().toISOString(),
        };
        await updateSettings({ redmineTaskStatuses: rts });

        await updateChatSession(existingSession.id, {
          projectMeta: { ...existingSession.projectMeta, localStatus: "working" },
        }).catch(() => {});

        return NextResponse.json({
          ok: true,
          issueId,
          status: "working",
          sessionId: existingSession.id,
          sessionTitle: existingSession.title,
          spawned: false,
          updatedRecord: rts[issueKey],
        });
      }

      // No active session found (never created or was deleted): spawn new chat session
      try {
        const spawnResult = await spawnRedmineTaskSession({
          issueId,
          forceNew: true,
          model: body.model,
        });

        const refreshedSettings = await getSettings();
        const updatedRts = refreshedSettings?.redmineTaskStatuses || {};

        return NextResponse.json({
          ok: true,
          issueId,
          status: "working",
          sessionId: spawnResult.sessionId,
          sessionTitle: spawnResult.title,
          spawned: true,
          updatedRecord: updatedRts[issueKey] || null,
        });
      } catch (spawnErr) {
        // If spawn fails because no local path is assigned, record status without session and report warning
        if (spawnErr.message && spawnErr.message.includes("belum di-assign local path")) {
          rts[issueKey] = {
            ...(currentTracked || {}),
            status: "working",
            sessionId: null,
            reason: body.reason || null,
            updatedAt: new Date().toISOString(),
          };
          await updateSettings({ redmineTaskStatuses: rts });
          return NextResponse.json({
            ok: true,
            issueId,
            status: "working",
            sessionId: null,
            spawned: false,
            warning: spawnErr.message,
            updatedRecord: rts[issueKey],
          });
        }
        throw spawnErr;
      }
    }

    // For other statuses ('done', 'pending', etc.)
    const existing = await findActiveRedmineSession(issueKey, currentTracked?.sessionId);
    const resolvedSessionId = existing?.id || currentTracked?.sessionId || null;
    const resolvedSessionTitle = existing?.title || currentTracked?.sessionTitle || null;

    let commentSent = false;
    let commentError = null;

    if (status === "done" && (body.sendComment === true || body.postComment === true)) {
      try {
        const commentRes = await postTaskCompletionComment(issueKey, {
          sessionId: resolvedSessionId,
          force: true,
        });
        commentSent = commentRes?.commentSent === true;
      } catch (err) {
        commentError = err.message;
      }
    }

    rts[issueKey] = {
      ...(currentTracked || {}),
      status,
      sessionId: resolvedSessionId,
      sessionTitle: resolvedSessionTitle,
      reason: body.reason !== undefined ? body.reason : (status === "done" ? null : (currentTracked?.reason || null)),
      summaryCommentSent: commentSent || currentTracked?.summaryCommentSent || false,
      summaryCommentAt: commentSent ? new Date().toISOString() : (currentTracked?.summaryCommentAt || null),
      updatedAt: new Date().toISOString(),
    };

    await updateSettings({ redmineTaskStatuses: rts });

    if (existing) {
      await updateChatSession(existing.id, {
        projectMeta: {
          ...existing.projectMeta,
          localStatus: status,
          summaryCommentSent: rts[issueKey].summaryCommentSent,
          summaryCommentAt: rts[issueKey].summaryCommentAt,
        },
      }).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      issueId,
      status,
      sessionId: resolvedSessionId,
      sessionTitle: resolvedSessionTitle,
      summaryCommentSent: rts[issueKey].summaryCommentSent,
      commentError,
      updatedRecord: rts[issueKey] || null,
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return NextResponse.json({ error: err.message }, { status: statusCode });
  }
}
