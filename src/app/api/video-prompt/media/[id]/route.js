import { NextResponse } from "next/server";
import fs from "node:fs";
import {
  resolveVideoAssetPath,
  readVideoAssetChunk,
  getVideoFileStat,
  downloadAndSaveVideo,
  sanitizeVideoId,
} from "@/lib/media/videoStore.js";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const sourceUrl = searchParams.get("url");
    const download = searchParams.get("download") === "1";

    let filePath = resolveVideoAssetPath(id);

    // If not found locally, but sourceUrl is provided, attempt on-demand download & cache
    if (!filePath && sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
      try {
        const saved = await downloadAndSaveVideo({ url: sourceUrl, id });
        if (saved?.abs) {
          filePath = saved.abs;
        }
      } catch (err) {
        console.warn("On-demand video caching failed:", err.message);
      }
    }

    if (!filePath) {
      return NextResponse.json({ error: "Video asset not found or expired" }, { status: 404 });
    }

    const stat = fs.statSync(filePath);
    const totalSize = stat.size;
    const rangeHeader = request.headers.get("range");
    const sanitizedName = sanitizeVideoId(id) || "video";

    const commonHeaders = {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=31536000, immutable",
    };

    if (download) {
      commonHeaders["Content-Disposition"] = `attachment; filename="${sanitizedName}.mp4"`;
    } else {
      commonHeaders["Content-Disposition"] = "inline";
    }

    // Range request handling (HTTP 206)
    if (rangeHeader && rangeHeader.startsWith("bytes=")) {
      const parts = rangeHeader.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;

      if (start >= totalSize || end >= totalSize || start > end) {
        return new Response(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${totalSize}`,
            ...commonHeaders,
          },
        });
      }

      const chunk = readVideoAssetChunk(filePath, start, end);
      return new Response(chunk.buffer, {
        status: 206,
        headers: {
          ...commonHeaders,
          "Content-Range": `bytes ${start}-${end}/${totalSize}`,
          "Content-Length": String(chunk.length),
        },
      });
    }

    // Full file response (HTTP 200)
    const fileBuf = fs.readFileSync(filePath);
    return new Response(fileBuf, {
      status: 200,
      headers: {
        ...commonHeaders,
        "Content-Length": String(fileBuf.length),
      },
    });
  } catch (error) {
    console.error("Error serving video asset:", error);
    return NextResponse.json({ error: error.message || "Failed to serve video" }, { status: 500 });
  }
}

export async function HEAD(request, { params }) {
  try {
    const { id } = await params;
    const filePath = resolveVideoAssetPath(id);
    if (!filePath) {
      return new Response(null, { status: 404 });
    }
    const stat = fs.statSync(filePath);
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Accept-Ranges": "bytes",
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return new Response(null, { status: 500 });
  }
}
