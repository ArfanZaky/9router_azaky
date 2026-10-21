import { NextResponse } from "next/server";
import { getServerChatRun, steerServerChatRun, stopServerChatRun, getLiveRunForSession } from "@/lib/chat/serverRunManager.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request, { params }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const bySession = searchParams.get("bySession");

  if (bySession) {
    const liveRun = getLiveRunForSession(id);
    if (!liveRun) return NextResponse.json({ active: false });
    return NextResponse.json({
      active: true,
      runId: liveRun.id,
      sessionId: liveRun.sessionId,
      status: liveRun.status,
      lastSeq: liveRun.seq || 0,
      assistantId: liveRun.assistantId,
      assistantText: liveRun.assistantText || "",
      messages: liveRun.messages || [],
      tasks: liveRun.tasks || [],
      subAgents: Array.from(liveRun.subAgents?.values() || []).map((s) => ({
        id: s.id,
        role: s.role,
        task: s.task,
        status: s.status,
        sessionId: liveRun.sessionId,
      })),
      teamRoster: Array.from(liveRun.teamRoster?.values() || []),
      teamTasks: Array.from(liveRun.teamTasks?.values() || []),
      teamMessages: liveRun.teamMessages || [],
      gates: Array.from(liveRun.gates?.entries() || []).map(([gid, g]) => ({
        id: gid,
        kind: g.kind,
        runId: liveRun.id,
        sessionId: liveRun.sessionId,
        ...(g.payload || {}),
      })),
    });
  }

  const after = searchParams.get("after") || 0;
  const run = await getServerChatRun(id, after);
  return run ? NextResponse.json(run) : NextResponse.json({ error: "Run not found" }, { status: 404 });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const run = await stopServerChatRun(id);
  return run ? NextResponse.json(run, { status: 202 }) : NextResponse.json({ error: "Run not found" }, { status: 404 });
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await steerServerChatRun(id, body.instruction);
    return result ? NextResponse.json(result, { status: 202 }) : NextResponse.json({ error: "Active run not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Unable to steer run" }, { status: 400 });
  }
}
