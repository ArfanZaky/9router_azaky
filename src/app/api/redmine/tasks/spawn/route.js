import { NextResponse } from "next/server";
import { spawnRedmineTaskSession } from "@/lib/redmine/taskSpawner";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await spawnRedmineTaskSession(body);
    return NextResponse.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    return NextResponse.json({ error: err.message }, { status });
  }
}
