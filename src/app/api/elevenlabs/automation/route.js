import { NextResponse } from "next/server";
import {
  AutomationError,
  cancelElevenAutomation,
  listAutomationJobs,
  listAutomationProfiles,
  startElevenAutomation,
} from "@/lib/elevenlabs/automation";

export const dynamic = "force-dynamic";

// Spawns Chrome on the host. Dashboard auth only (deny-by-default /api/* guard), like
// /api/flow: LOCAL_ONLY_PATHS cannot pass from a browser behind chat-server.mjs,
// which does not stamp the trusted peer headers that custom-server.js does.

export async function GET() {
  return NextResponse.json({ jobs: listAutomationJobs(), profiles: listAutomationProfiles() });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "cancel") {
      return NextResponse.json({ job: await cancelElevenAutomation(String(body.id || "")) });
    }
    if (body.action === "start") {
      const jobs = startElevenAutomation({
        name: body.name,
        email: body.email,
        password: body.password,
        accounts: body.accounts,
        setActive: body.setActive !== false,
        keepBrowserOpen: Boolean(body.keepBrowserOpen),
      });
      return NextResponse.json({ job: jobs[0] || null, jobs }, { status: 202 });
    }
    return NextResponse.json({ error: `Unknown action '${body.action}'` }, { status: 400 });
  } catch (error) {
    const status = error instanceof AutomationError ? error.status : 500;
    return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status });
  }
}
