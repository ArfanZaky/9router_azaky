import { NextResponse } from "next/server";
import { postTaskCompletionComment } from "@/lib/redmine/commentSummary";
import { findActiveRedmineSession } from "@/lib/redmine/taskSpawner";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const issueId = body.issueId || body.id;

    if (!issueId) {
      return NextResponse.json({ error: "issueId is required" }, { status: 400 });
    }

    let sessionId = body.sessionId || null;
    if (!sessionId) {
      const existing = await findActiveRedmineSession(issueId);
      sessionId = existing?.id || null;
    }

    const result = await postTaskCompletionComment(issueId, {
      sessionId,
      summary: body.summary || undefined,
      commitMsg: body.commitMsg || undefined,
      commitHash: body.commitHash || undefined,
      force: true, // Manual trigger overrides disabled toggle
    });

    return NextResponse.json(result);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    return NextResponse.json({ error: err.message }, { status: statusCode });
  }
}
