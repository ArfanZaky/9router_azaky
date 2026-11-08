import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  ensureVideoMediaDir,
  resolveVideoAssetPath,
  downloadAndSaveVideo,
  writeVideoAssetFile,
} from "@/lib/media/videoStore.js";

const execFileAsync = promisify(execFile);

export const dynamic = "force-dynamic";
export const maxDuration = 600;

async function resolveClipToLocalFile(rawUrl, idx) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;

  // 1. /api/video-prompt/media/{id}?url=...
  const mediaMatch = url.match(/\/api\/video-prompt\/media\/([^/?#]+)(?:\?([^#]*))?/i);
  if (mediaMatch) {
    const id = decodeURIComponent(mediaMatch[1]);
    const local = resolveVideoAssetPath(id);
    if (local && fs.existsSync(local)) return local;

    if (mediaMatch[2]) {
      const params = new URLSearchParams(mediaMatch[2]);
      const sourceUrl = params.get("url");
      if (sourceUrl && /^https?:\/\//i.test(sourceUrl)) {
        const saved = await downloadAndSaveVideo({ url: sourceUrl, id });
        if (saved?.abs && fs.existsSync(saved.abs)) return saved.abs;
      }
    }
  }

  // 2. Direct remote URL
  if (/^https?:\/\//i.test(url)) {
    const saved = await downloadAndSaveVideo({ url, id: `clip_${idx}_${Date.now()}` });
    if (saved?.abs && fs.existsSync(saved.abs)) return saved.abs;
  }

  // 3. Relative or absolute path in videoStore
  const resolved = resolveVideoAssetPath(url);
  if (resolved && fs.existsSync(resolved)) return resolved;

  return null;
}

function escapeConcatPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

/**
 * POST /api/video-prompt/render
 * Body: { clips: Array<{ videoUrl: string, sceneNumber?: number } | string>, aspectRatio?: string, resolution?: string, projectId?: string }
 */
export async function POST(request) {
  const tempFiles = [];
  try {
    const body = await request.json().catch(() => ({}));
    const rawClips = Array.isArray(body.clips) ? body.clips : [];
    const urls = rawClips
      .map((c) => (typeof c === "string" ? c : c?.videoUrl))
      .map((u) => String(u || "").trim())
      .filter(Boolean);

    if (urls.length === 0) {
      return NextResponse.json({ error: "Pilih minimal 1 video clip yang sudah selesai dirender" }, { status: 400 });
    }

    const localPaths = [];
    for (let i = 0; i < urls.length; i++) {
      const abs = await resolveClipToLocalFile(urls[i], i);
      if (!abs) {
        return NextResponse.json(
          { error: `Clip #${i + 1} tidak ditemukan di penyimpanan lokal atau link sudah kedaluwarsa` },
          { status: 404 }
        );
      }
      localPaths.push(abs);
    }

    const outId = `render-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;

    if (localPaths.length === 1) {
      const buf = fs.readFileSync(localPaths[0]);
      const saved = writeVideoAssetFile({ id: outId, buffer: buf, ext: "mp4" });
      return NextResponse.json({
        id: saved.id,
        videoUrl: `/api/video-prompt/media/${saved.id}`,
        clipCount: 1,
        size: saved.size,
      });
    }

    const mediaDir = ensureVideoMediaDir();
    const listFile = path.join(mediaDir, `${outId}.concat.txt`);
    const outFile = path.join(mediaDir, `${outId}.mp4`);
    tempFiles.push(listFile);

    const listContent = localPaths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n") + "\n";
    fs.writeFileSync(listFile, listContent, "utf8");

    const ffmpegBin = process.env.FFMPEG_PATH || "ffmpeg";

    // Fast path: stream copy via concat demuxer
    try {
      await execFileAsync(
        ffmpegBin,
        ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", outFile],
        { timeout: 180000 }
      );
    } catch {
      // Fallback: re-encode to uniform H.264 + AAC when codecs/resolutions/framerates differ across clips
      const aspect = String(body.aspectRatio || "16:9");
      const [w, h] = aspect === "9:16" ? [720, 1280] : aspect === "1:1" ? [1080, 1080] : [1280, 720];
      const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=yuv420p`;
      await execFileAsync(
        ffmpegBin,
        [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listFile,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "fast",
          "-crf",
          "22",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          outFile,
        ],
        { timeout: 300000 }
      );
    }

    if (!fs.existsSync(outFile)) {
      return NextResponse.json({ error: "Gagal menggabungkan video" }, { status: 500 });
    }

    const stat = fs.statSync(outFile);
    return NextResponse.json({
      id: outId,
      videoUrl: `/api/video-prompt/media/${outId}`,
      clipCount: localPaths.length,
      size: stat.size,
    });
  } catch (error) {
    return NextResponse.json(
      { error: String(error?.stderr || error?.message || error).slice(0, 500) },
      { status: 500 }
    );
  } finally {
    for (const f of tempFiles) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch {
        // ignore cleanup error
      }
    }
  }
}
