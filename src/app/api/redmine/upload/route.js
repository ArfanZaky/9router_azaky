import { NextResponse } from "next/server";
import { uploadRedmineFile } from "@/lib/redmine/redmineClient";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No file provided" }, { status: 400 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = file.name || "upload.png";
      const mime = file.type || "application/octet-stream";

      const uploaded = await uploadRedmineFile({
        buffer,
        filename,
        contentType: mime,
      });

      return NextResponse.json(uploaded);
    }

    // JSON body with base64 / dataUrl (ideal for clipboard image paste)
    const body = await request.json();
    let buffer;
    let filename = body.filename || `clipboard-${Date.now()}.png`;
    let mime = body.contentType || "image/png";

    if (body.dataUrl) {
      const match = body.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mime = match[1];
        buffer = Buffer.from(match[2], "base64");
      } else {
        return NextResponse.json({ error: "Invalid dataUrl format" }, { status: 400 });
      }
    } else if (body.base64) {
      buffer = Buffer.from(body.base64, "base64");
    } else {
      return NextResponse.json({ error: "Missing dataUrl, base64, or file" }, { status: 400 });
    }

    const uploaded = await uploadRedmineFile({
      buffer,
      filename,
      contentType: mime,
    });

    return NextResponse.json(uploaded);
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
