import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const name = String(body?.name || "").trim();
    const dataUrl = String(body?.data || "");
    if (!name) return NextResponse.json({ error: "File name is required" }, { status: 400 });
    if (!dataUrl.startsWith("data:")) return NextResponse.json({ error: "Invalid data URL" }, { status: 400 });

    const comma = dataUrl.indexOf(",");
    if (comma < 0) return NextResponse.json({ error: "Invalid data URL" }, { status: 400 });
    const base64 = dataUrl.slice(comma + 1);
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: "File too large (max 8MB)" }, { status: 413 });
    }

    const safeName = path.basename(name).replace(/[^\w.\- ]+/g, "_").slice(0, 120);
    const uploadDir = path.join(DATA_DIR, "chat-uploads");
    fs.mkdirSync(uploadDir, { recursive: true });
    const storedName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
    const storedPath = path.join(uploadDir, storedName);
    fs.writeFileSync(storedPath, buffer);

    return NextResponse.json({ path: storedPath, name: safeName });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Upload failed" }, { status: 500 });
  }
}
