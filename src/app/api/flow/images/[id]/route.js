import { NextResponse } from "next/server";
import { deleteImageFile, readImageFile } from "@/lib/media/imageStore.js";
import { deleteFlowImage, getFlowImage } from "@/lib/db/repos/flowImagesRepo.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const { id } = await params;
  const image = await getFlowImage(id);
  if (!image) return NextResponse.json({ error: "Image not found" }, { status: 404 });

  const buf = readImageFile(image.path);
  if (!buf) return NextResponse.json({ error: "Image file missing on disk" }, { status: 404 });

  return new Response(buf, {
    headers: {
      "Content-Type": image.mime || "image/png",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(_request, { params }) {
  const { id } = await params;
  const removed = await deleteFlowImage(id);
  if (!removed) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  deleteImageFile(removed.path);
  return NextResponse.json({ ok: true });
}
