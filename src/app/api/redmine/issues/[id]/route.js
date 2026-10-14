import { NextResponse } from "next/server";
import {
  getRedmineIssueDetail,
  updateRedmineIssue,
} from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing issue ID" }, { status: 400 });
    const issue = await getRedmineIssueDetail(id);
    return NextResponse.json(issue);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Missing issue ID" }, { status: 400 });
    const body = await request.json();
    const result = await updateRedmineIssue(id, body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
