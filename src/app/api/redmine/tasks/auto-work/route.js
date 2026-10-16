import { NextResponse } from "next/server";
import { getSettings, getActiveChatRunForSession } from "@/lib/localDb";
import { getInstructionComments, getNewInstructionComments } from "@/lib/redmine/commentInstructions";
import { isRunLiveForSession } from "@/lib/chat/serverRunManager";
import {
  getRedmineConfig,
  getRedmineIssues,
  getRedmineIssueDetail,
} from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const config = await getRedmineConfig();
    if (!config.apiKey) {
      return NextResponse.json(
        { error: "Redmine API key is not configured", active: false },
        { status: 400 }
      );
    }

    if (!config.autoWorkWithAi) {
      return NextResponse.json({
        ok: true,
        active: false,
        message: "Auto Work with AI is disabled in settings",
        spawnedCount: 0,
      });
    }

    // Fetch open issues assigned to user
    const { issues } = await getRedmineIssues({
      statusId: "open",
      assignedToId: "me",
      limit: 100,
      customConfig: config,
    });

    // New issues start normally. Pending issues only resume when a later
    // nonempty Redmine note is found; changes to status/attachments do not count.
    const candidates = (issues || []).filter(
      (i) => i.localPath && i.projectAutoWork &&
        ((!i.localStatus && !i.localSessionId) || i.localStatus === "pending")
    );
    const settings = await getSettings();
    const eligible = [];
    for (const issue of candidates) {
      if (issue.localStatus !== "pending") {
        eligible.push(issue);
        continue;
      }
      const tracked = settings?.redmineTaskStatuses?.[String(issue.id)];
      if (!tracked?.sessionId || isRunLiveForSession(tracked.sessionId) ||
        await getActiveChatRunForSession(tracked.sessionId)) continue;
      try {
        const detail = await getRedmineIssueDetail(issue.id, config);
        const comments = getInstructionComments(detail);
        const cursor = tracked.lastInstructionCommentKey;
        const consumedAt = tracked.finishedAt || tracked.updatedAt;
        const newComments = getNewInstructionComments(comments, cursor, consumedAt);
        if (newComments.length) eligible.push(issue);
      } catch {
        // A failed Redmine detail fetch must not restart an existing session.
      }
    }

    const spawned = [];
    const origin = req.nextUrl?.origin || "http://127.0.0.1:20128";

    for (const issue of eligible) {
      try {
        const spawnRes = await fetch(`${origin}/api/redmine/tasks/spawn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            issueId: issue.id,
            model: config.aiModel,
          }),
        });
        const spawnData = await spawnRes.json().catch(() => ({}));
        if (spawnRes.ok && spawnData.spawned) {
          spawned.push({
            issueId: issue.id,
            subject: issue.subject,
            sessionId: spawnData.sessionId,
          });
        }
      } catch {
        // Continue to next issue
      }
    }

    return NextResponse.json({
      ok: true,
      active: true,
      totalEligible: eligible.length,
      spawnedCount: spawned.length,
      spawned,
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
