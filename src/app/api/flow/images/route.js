import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { MAX_IMAGE_BYTES } from "open-sse/config/mediaConfig.js";
import { writeImageAssetFile } from "@/lib/media/imageStore.js";
import { addFlowImage, listFlowImages } from "@/lib/db/repos/flowImagesRepo.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const images = await listFlowImages({
    q: searchParams.get("q") || "",
    characterId: searchParams.get("characterId") || "",
    limit: searchParams.get("limit") || 100,
    offset: searchParams.get("offset") || 0,
  });
  return NextResponse.json({ images });
}

/** Multipart upload: `file` (image) + optional `name`. */
export async function POST(request) {
  try {
    const type = request.headers.get("content-type") || "";
    if (!type.includes("multipart/form-data")) {
      return NextResponse.json({ error: "expected multipart/form-data with a 'file' field" }, { status: 415 });
    }
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (!String(file.type || "").startsWith("image/")) {
      return NextResponse.json({ error: "only image files can be uploaded" }, { status: 415 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: `image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024}MB` }, { status: 413 });
    }

    const { rel, mime } = writeImageAssetFile({ id: uuidv4(), buffer, mime: file.type });
    const name = String(form.get("name") || file.name || "").trim() || "untitled";
    const image = await addFlowImage({ name, path: rel, mime, origin: "upload" });
    return NextResponse.json(image, { status: 201 });
  } catch (error) {
    console.log("Error uploading flow image:", error);
    return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status: 500 });
  }
}
