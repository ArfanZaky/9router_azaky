import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "../dataDir.js";

export const VIDEO_MEDIA_DIR = path.join(DATA_DIR, "media", "videos");

export function ensureVideoMediaDir() {
  if (!fs.existsSync(VIDEO_MEDIA_DIR)) {
    fs.mkdirSync(VIDEO_MEDIA_DIR, { recursive: true });
  }
  return VIDEO_MEDIA_DIR;
}

export function sanitizeVideoId(id) {
  if (!id) return "";
  return String(id).replace(/[^a-zA-Z0-9_-]/g, "");
}

export function resolveVideoAssetPath(idOrRelOrAbs) {
  if (!idOrRelOrAbs) return null;
  const str = String(idOrRelOrAbs).trim();

  // If already absolute path
  if (path.isAbsolute(str)) {
    return fs.existsSync(str) ? str : null;
  }

  // If relative path like "media/videos/abc.mp4"
  if (str.startsWith("media/") || str.startsWith("media\\")) {
    const full = path.join(DATA_DIR, str);
    return fs.existsSync(full) ? full : null;
  }

  // If just filename or sanitized ID
  const sanitized = sanitizeVideoId(str.replace(/\.mp4$/i, ""));
  if (!sanitized) return null;

  ensureVideoMediaDir();
  const directWithExt = path.join(VIDEO_MEDIA_DIR, `${sanitized}.mp4`);
  if (fs.existsSync(directWithExt)) return directWithExt;

  const directWithoutExt = path.join(VIDEO_MEDIA_DIR, sanitized);
  if (fs.existsSync(directWithoutExt)) return directWithoutExt;

  return null;
}

export function writeVideoAssetFile({ id, buffer, ext = "mp4" }) {
  ensureVideoMediaDir();
  const sanitized = sanitizeVideoId(id) || crypto.randomUUID();
  const fileName = `${sanitized}.${ext.replace(/^\./, "")}`;
  const abs = path.join(VIDEO_MEDIA_DIR, fileName);
  fs.writeFileSync(abs, buffer);
  const rel = path.join("media", "videos", fileName).replace(/\\/g, "/");
  return { id: sanitized, abs, rel, fileName, size: buffer.length };
}

export function getVideoFileStat(idOrRelOrAbs) {
  const abs = resolveVideoAssetPath(idOrRelOrAbs);
  if (!abs) return null;
  try {
    const stat = fs.statSync(abs);
    return { abs, size: stat.size, mtime: stat.mtime };
  } catch {
    return null;
  }
}

export function readVideoAssetChunk(idOrRelOrAbs, start = 0, end = null) {
  const abs = resolveVideoAssetPath(idOrRelOrAbs);
  if (!abs) return null;
  const stat = fs.statSync(abs);
  const total = stat.size;
  const chunkStart = Math.max(0, Math.min(start, total - 1));
  const chunkEnd = end !== null ? Math.min(end, total - 1) : total - 1;
  const length = chunkEnd - chunkStart + 1;

  const fd = fs.openSync(abs, "r");
  const buffer = Buffer.alloc(length);
  fs.readSync(fd, buffer, 0, length, chunkStart);
  fs.closeSync(fd);

  return { buffer, total, start: chunkStart, end: chunkEnd, length };
}

export async function downloadAndSaveVideo({ url, id }) {
  if (!url || typeof url !== "string") {
    throw new Error("Invalid video download URL");
  }

  ensureVideoMediaDir();

  // Deduce or generate ID
  let targetId = sanitizeVideoId(id);
  if (!targetId) {
    // Try extract from URL path (e.g. /tasks/xyz or .../2600029973-AigcVideo-xxx_0.mp4)
    try {
      const parsed = new URL(url);
      const match = parsed.pathname.match(/([a-zA-Z0-9_-]+)(?:_\d+)?\.(?:mp4|webm|mov)$/i);
      if (match && match[1]) {
        targetId = sanitizeVideoId(match[1]);
      }
    } catch {
      // ignore
    }
  }
  if (!targetId) {
    targetId = crypto.randomUUID();
  }

  // If already downloaded and exists, return existing
  const existingPath = resolveVideoAssetPath(targetId);
  if (existingPath) {
    const stat = fs.statSync(existingPath);
    if (stat.size > 1024) {
      return {
        id: targetId,
        abs: existingPath,
        size: stat.size,
        localUrl: `/api/video-prompt/media/${targetId}`,
      };
    }
  }

  // Fetch remote video with 60s timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "video/*,application/octet-stream,*/*",
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to download remote video (${res.status} ${res.statusText})`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (buffer.length < 100) {
      throw new Error(`Downloaded video file too small (${buffer.length} bytes)`);
    }

    const written = writeVideoAssetFile({ id: targetId, buffer, ext: "mp4" });
    return {
      id: targetId,
      abs: written.abs,
      size: written.size,
      localUrl: `/api/video-prompt/media/${targetId}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
