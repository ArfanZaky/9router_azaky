import { NextResponse } from "next/server";
import {
  getRedmineConfig,
  getRedmineIssues,
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

    // Eligible issues: has localPath assigned, no localStatus yet, and no session yet
    const eligible = (issues || []).filter(
      (i) => i.localPath && !i.localStatus && !i.localSessionId
    );

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
        if (spawnRes.ok && spawnData.ok) {
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
