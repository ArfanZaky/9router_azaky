import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../dataDir.js";

export const IMAGE_MEDIA_DIR = path.join(DATA_DIR, "media", "images");

export function ensureImageMediaDir() {
  if (!fs.existsSync(IMAGE_MEDIA_DIR)) {
    fs.mkdirSync(IMAGE_MEDIA_DIR, { recursive: true });
  }
  return IMAGE_MEDIA_DIR;
}

function extFromMime(mime = "image/png") {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "png";
}

export function resolveImageAssetPath(relOrAbs) {
  if (!relOrAbs) return null;
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  return path.join(DATA_DIR, relOrAbs);
}

export function writeImageAssetFile({ id, buffer, mime = "image/png" }) {
  ensureImageMediaDir();
  const ext = extFromMime(mime);
  const fileName = `${id}.${ext}`;
  const abs = path.join(IMAGE_MEDIA_DIR, fileName);
  fs.writeFileSync(abs, buffer);
  // store relative to DATA_DIR for portability
  const rel = path.join("media", "images", fileName).replace(/\\/g, "/");
  return { abs, rel, mime, fileName };
}

export function writeImageFromBase64({ id, b64, mime = "image/png" }) {
  const cleaned = String(b64 || "").replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(cleaned, "base64");
  return writeImageAssetFile({ id, buffer, mime });
}

export function deleteImageFile(relOrAbs) {
  const abs = resolveImageAssetPath(relOrAbs);
  if (!abs) return false;
  try {
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export function readImageFile(relOrAbs) {
  const abs = resolveImageAssetPath(relOrAbs);
  if (!abs || !fs.existsSync(abs)) return null;
  return fs.readFileSync(abs);
}
