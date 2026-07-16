import { NextResponse } from "next/server";
import { getImageJob, updateImageJob, deleteImageJob } from "@/lib/localDb";
import { deleteImageFile } from "@/lib/media/imageStore.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const job = await getImageJob(id);
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(job);
  } catch (error) {
    console.log("Error fetching image job:", error);
    return NextResponse.json({ error: "Failed to fetch image job" }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const job = await updateImageJob(id, body || {});
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    return NextResponse.json(job);
  } catch (error) {
    console.log("Error updating image job:", error);
    return NextResponse.json({ error: "Failed to update image job" }, { status: 500 });
  }
}

export async function DELETE(_request, { params }) {
  try {
    const { id } = await params;
    const { ok, assets } = await deleteImageJob(id);
    if (!ok) return NextResponse.json({ error: "Job not found" }, { status: 404 });
    for (const asset of assets || []) {
      if (asset.path) deleteImageFile(asset.path);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error deleting image job:", error);
    return NextResponse.json({ error: "Failed to delete image job" }, { status: 500 });
  }
}
