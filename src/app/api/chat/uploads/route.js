import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DATA_DIR } from "@/lib/dataDir.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const file = searchParams.get("file");
    if (!file) return NextResponse.json({ error: "File param required" }, { status: 400 });

    const safeName = path.basename(file);
    const uploadDir = path.join(DATA_DIR, "chat-uploads");
    const filePath = path.join(uploadDir, safeName);

    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".pdf": "application/pdf",
      ".txt": "text/plain",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";
    const buf = fs.readFileSync(filePath);

    return new Response(buf, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

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

    const url = `/api/chat/uploads?file=${encodeURIComponent(storedName)}`;
    return NextResponse.json({ path: storedPath, name: safeName, url });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Upload failed" }, { status: 500 });
  }
}
