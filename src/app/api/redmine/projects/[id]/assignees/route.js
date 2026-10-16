import { NextResponse } from "next/server";
import { getRedmineProjectAssignees } from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    if (!/^[1-9]\d*$/.test(String(id))) {
      return NextResponse.json({ error: "Invalid project ID" }, { status: 400 });
    }
    const assignees = await getRedmineProjectAssignees(id);
    return NextResponse.json({ assignees });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
