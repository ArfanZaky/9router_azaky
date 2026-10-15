import { NextResponse } from "next/server";
import {
  createRedmineTimeEntry,
  getTimeEntries,
} from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const issueId = searchParams.get("issue_id");
    const userId = searchParams.get("user_id");
    const limit = Number(searchParams.get("limit") || 50);

    const timeEntries = await getTimeEntries({ issueId, userId, limit });
    return NextResponse.json({ timeEntries });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await createRedmineTimeEntry(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
