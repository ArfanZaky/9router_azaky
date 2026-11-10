import { NextResponse } from "next/server";
import { importFlowProfiles, FlowBackupError } from "@/lib/flow/profileBackup";
import { listFlowJobs } from "@/lib/db/repos/flowRepo";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 200 * 1024 * 1024;

/** POST /api/flow/accounts/import  body: { bundle, overwrite } */
export async function POST(request) {
  try {
    const length = Number(request.headers.get("content-length") || 0);
    if (length > MAX_BODY_BYTES) return NextResponse.json({ error: "File import terlalu besar" }, { status: 413 });
    const body = await request.json().catch(() => null);
    if (!body?.bundle) return NextResponse.json({ error: "File import tidak terbaca (bukan JSON?)" }, { status: 400 });

    // Never swap a profile out from under a render that is using it.
    const running = await listFlowJobs({ status: "running", limit: 50 });
    const activeNames = running.map((j) => j.profile).filter(Boolean);

    const result = importFlowProfiles(body.bundle, { overwrite: Boolean(body.overwrite), activeNames });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const status = error instanceof FlowBackupError ? error.status : 500;
    return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status });
  }
}
