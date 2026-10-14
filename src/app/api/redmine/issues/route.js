import { NextResponse } from "next/server";
import { getRedmineIssues } from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const statusId = searchParams.get("status_id") || "open";
    const assignedToId = searchParams.get("assigned_to_id") || "me";
    const projectId = searchParams.get("project_id") || "";
    const trackerId = searchParams.get("tracker_id") || "";
    const search = searchParams.get("q") || searchParams.get("search") || "";
    const limit = Number(searchParams.get("limit") || 50);
    const offset = Number(searchParams.get("offset") || 0);
    const sort = searchParams.get("sort") || "updated_on:desc";

    const data = await getRedmineIssues({
      statusId,
      assignedToId,
      projectId,
      trackerId,
      search,
      limit,
      offset,
      sort,
    });

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
