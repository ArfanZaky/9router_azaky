import { NextResponse } from "next/server";
import { listFlowProfiles } from "@/lib/flow/driver";
import { exportFlowProfiles, FlowBackupError } from "@/lib/flow/profileBackup";

export const dynamic = "force-dynamic";

/**
 * GET /api/flow/accounts/export[?profiles=a,b]
 * Downloads the Google sessions of the chosen Flow profiles. Behind the dashboard
 * auth guard; the file is as sensitive as being signed in to those accounts.
 */
export async function GET(request) {
  try {
    const raw = new URL(request.url).searchParams.get("profiles") || "";
    const only = raw.split(",").map((s) => s.trim()).filter(Boolean);
    const bundle = exportFlowProfiles(await listFlowProfiles(), only.length ? only : null);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(bundle), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="flow-accounts-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const status = error instanceof FlowBackupError ? error.status : 500;
    return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status });
  }
}
