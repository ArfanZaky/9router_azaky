// Shared helpers for image provider adapters
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../../src/lib/dataDir.js";

export const POLL_INTERVAL_MS = 1500;
export const POLL_TIMEOUT_MS = 120000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Map OpenAI size to provider-specific aspect ratio
export function sizeToAspectRatio(size) {
  if (!size || typeof size !== "string") return "1:1";
  const map = {
    "1024x1024": "1:1",
    "1024x1792": "9:16",
    "1792x1024": "16:9",
    "1024x1536": "2:3",
    "1536x1024": "3:2",
  };
  return map[size] || "1:1";
}

// Fetch URL → base64 (for providers returning image URLs)
export async function urlToBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const buf = await res.arrayBuffer();
  return Buffer.from(buf).toString("base64");
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function mimeFromPath(p = "") {
  const ext = path.extname(String(p)).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/png";
}

function isLocalHostname(hostname = "") {
  const h = String(hostname).toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1" || h === "[::1]";
}

/**
 * Normalize reference image input for upstream providers.
 * - data:image/* kept as-is
 * - raw base64 → data:image/png;base64,...
 * - local /api/image-gen/assets/{id} → read from DATA_DIR and convert to data URI
 * - localhost absolute URLs → fetch and convert to data URI (upstream can't reach host)
 * - public http(s) kept as-is (or forceDataUri=true to always convert)
 */
export async function normalizeReferenceImage(input, { forceDataUri = false } = {}) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^data:image\//i.test(trimmed)) return trimmed;

  // Raw base64 (no data: prefix)
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith("/") && /^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.replace(/\s+/g, "").length > 32) {
    return `data:image/png;base64,${trimmed.replace(/\s+/g, "")}`;
  }

  // Local asset path from dashboard gallery: /api/image-gen/assets/{id}
  const assetMatch = trimmed.match(/\/api\/image-gen\/assets\/([^/?#]+)/i);
  if (assetMatch) {
    const assetId = assetMatch[1];
    try {
      // Lazy import to avoid circular deps in some runtimes
      const { getImageAsset } = await import("../../../src/lib/db/repos/imageGenRepo.js");
      const { readImageFile } = await import("../../../src/lib/media/imageStore.js");
      const asset = await getImageAsset(assetId);
      if (asset?.path) {
        const buf = readImageFile(asset.path);
        if (buf) {
          const mime = asset.mime || mimeFromPath(asset.path);
          return `data:${mime};base64,${buf.toString("base64")}`;
        }
      }
      if (asset?.sourceUrl) return normalizeReferenceImage(asset.sourceUrl, { forceDataUri });
    } catch {
      // fall through
    }
  }

  // Absolute or relative URL
  let absolute = trimmed;
  if (trimmed.startsWith("/")) {
    // Relative app path without host — try local file under DATA_DIR for media/
    if (trimmed.startsWith("/media/") || trimmed.startsWith("media/")) {
      const rel = trimmed.replace(/^\//, "");
      const abs = path.join(DATA_DIR, rel);
      if (fs.existsSync(abs)) {
        const buf = fs.readFileSync(abs);
        return `data:${mimeFromPath(abs)};base64,${buf.toString("base64")}`;
      }
    }
    // Can't resolve relative without origin; leave as-is (caller should pass absolute)
    return trimmed;
  }

  try {
    const u = new URL(absolute);
    if (isLocalHostname(u.hostname) || forceDataUri) {
      const b64 = await urlToBase64(absolute);
      const ctype = "image/png";
      return `data:${ctype};base64,${b64}`;
    }
  } catch {
    // not a URL
  }

  return trimmed;
}

/** Split data URI into { mime, b64 } */
export function parseDataUri(input) {
  if (!input || typeof input !== "string") return null;
  const m = input.match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (m) return { mime: m[1], b64: m[2] };
  if (/^[A-Za-z0-9+/=]+$/.test(input) && input.length > 100) {
    return { mime: "image/png", b64: input };
  }
  return null;
}
