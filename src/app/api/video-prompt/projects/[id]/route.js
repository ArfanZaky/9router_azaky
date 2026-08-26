import { NextResponse } from "next/server";
import {
  getVideoPromptProject,
  updateVideoPromptProject,
  deleteVideoPromptProject,
} from "@/lib/localDb";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const project = await getVideoPromptProject(id);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to get project" }, { status: 500 });
  }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const project = await updateVideoPromptProject(id, body);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({ project });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to update project" }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const result = await deleteVideoPromptProject(id);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Failed to delete project" }, { status: 500 });
  }
}
