import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MIME_MAP = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
  ".txt": "text/plain",
  ".lua": "text/plain",
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get("path") || searchParams.get("file");
    if (!rawPath) {
      return Response.json({ error: "Missing path parameter" }, { status: 400 });
    }

    const cleaned = String(rawPath).trim().replace(/^[\\\/]+/, "");
    const allowedRoots = [
      path.resolve(process.cwd()),
      path.resolve(DATA_DIR),
      path.resolve(process.cwd(), "output"),
    ];

    let targetPath = null;
    if (path.isAbsolute(rawPath)) {
      targetPath = path.resolve(rawPath);
    } else {
      for (const root of allowedRoots) {
        const candidate = path.resolve(root, cleaned);
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          targetPath = candidate;
          break;
        }
      }
      if (!targetPath) {
        targetPath = path.resolve(process.cwd(), cleaned);
      }
    }

    const normalizedTarget = path.normalize(targetPath);
    const isSafe = allowedRoots.some((root) => {
      const normRoot = path.normalize(root);
      return normalizedTarget === normRoot || normalizedTarget.startsWith(normRoot + path.sep);
    });

    if (!isSafe) {
      return Response.json({ error: "Access denied: path outside allowed directories" }, { status: 403 });
    }

    if (!fs.existsSync(normalizedTarget) || !fs.statSync(normalizedTarget).isFile()) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    const ext = path.extname(normalizedTarget).toLowerCase();
    const contentType = MIME_MAP[ext] || "application/octet-stream";
    const buf = fs.readFileSync(normalizedTarget);

    return new Response(buf, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return Response.json({ error: error?.message || "Failed to serve file" }, { status: 500 });
  }
}
