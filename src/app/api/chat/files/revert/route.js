import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../../../../../lib/dataDir.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function resolveSafeRevertPath(rawPath) {
  const cleaned = String(rawPath || "").trim();
  if (!cleaned) throw new Error("Path is required");

  const abs = path.isAbsolute(cleaned) ? path.resolve(cleaned) : path.resolve(process.cwd(), cleaned);
  const normalized = path.normalize(abs);

  const allowedRoots = [
    path.resolve(process.cwd()),
    path.resolve(DATA_DIR),
    path.resolve(process.env.AGENT_WORKSPACE || process.cwd()),
  ];

  const ok = allowedRoots.some((root) => {
    const r = path.normalize(root);
    return normalized === r || normalized.startsWith(r + path.sep);
  });

  if (!ok) {
    throw new Error(`Path outside allowed directories: ${normalized}`);
  }

  return normalized;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawPath = body.path;
    const isNew = Boolean(body.isNew);
    const previousContent = body.previousContent;

    if (!rawPath) {
      return NextResponse.json({ ok: false, error: "File path is required" }, { status: 400 });
    }

    const targetPath = resolveSafeRevertPath(rawPath);

    if (isNew) {
      // Reverting a brand new file means removing it
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
      return NextResponse.json({
        ok: true,
        reverted: true,
        action: "deleted",
        path: targetPath,
        message: `Removed created file ${path.basename(targetPath)}`,
      });
    }

    if (previousContent !== undefined && previousContent !== null) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, String(previousContent), "utf8");
      return NextResponse.json({
        ok: true,
        reverted: true,
        action: "restored",
        path: targetPath,
        message: `Restored original content of ${path.basename(targetPath)}`,
      });
    }

    return NextResponse.json(
      { ok: false, error: "Cannot revert: no previous content or creation status recorded" },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error?.message || "Failed to revert file" }, { status: 500 });
  }
}
