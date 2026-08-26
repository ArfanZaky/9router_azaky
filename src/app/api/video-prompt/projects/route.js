import { NextResponse } from "next/server";
import {
  listVideoPromptProjects,
  createVideoPromptProject,
} from "@/lib/localDb";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const limit = Number(searchParams.get("limit") || 50);
    const offset = Number(searchParams.get("offset") || 0);

    const projects = await listVideoPromptProjects({ q, limit, offset });
    return NextResponse.json({ projects });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to list projects" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body.prompt && (!body.scenes || !body.scenes.length)) {
      return NextResponse.json({ error: "Prompt or scenes are required" }, { status: 400 });
    }

    const project = await createVideoPromptProject(body);
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to create project" }, { status: 500 });
  }
}
