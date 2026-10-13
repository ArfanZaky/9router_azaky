import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getAvailableDrives() {
  if (process.platform !== "win32") {
    return ["/"];
  }
  const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const drives = [];
  for (const letter of letters) {
    const drivePath = `${letter}:\\`;
    try {
      if (fs.existsSync(drivePath)) {
        drives.push(drivePath);
      }
    } catch {
      // ignore
    }
  }
  return drives.length > 0 ? drives : ["C:\\"];
}

function getShortcuts() {
  const list = [];
  const cwd = process.cwd();
  list.push({ label: "Workspace", path: cwd, icon: "folder_open" });

  try {
    const parent = path.resolve(cwd, "..");
    if (fs.existsSync(parent) && parent !== cwd) {
      list.push({ label: "Parent Dir", path: parent, icon: "drive_folder_upload" });
    }
  } catch {
    // ignore
  }

  const homedir = os.homedir();
  if (homedir) {
    list.push({ label: "Home", path: homedir, icon: "home" });
    const docs = path.join(homedir, "Documents");
    if (fs.existsSync(docs)) list.push({ label: "Documents", path: docs, icon: "description" });
    const desktop = path.join(homedir, "Desktop");
    if (fs.existsSync(desktop)) list.push({ label: "Desktop", path: desktop, icon: "desktop_windows" });
  }

  return list;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    let target = String(body.path || "").trim();

    // Default target: cwd or parent if cwd is custom
    if (!target) {
      target = process.cwd();
    }

    // Resolve target path
    let resolved = path.resolve(target);

    // If target doesn't exist, fallback to its dirname or cwd
    if (!fs.existsSync(resolved)) {
      const parentCandidate = path.dirname(resolved);
      if (fs.existsSync(parentCandidate)) {
        resolved = parentCandidate;
      } else {
        resolved = process.cwd();
      }
    }

    // If it's a file, get its folder
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      resolved = path.dirname(resolved);
    }

    const drives = getAvailableDrives();
    const shortcuts = getShortcuts();

    // Determine parent path
    const parentPath = path.dirname(resolved) !== resolved ? path.dirname(resolved) : null;

    // Read directory entries
    const folders = [];
    const SKIP_NAMES = new Set([
      "$RECYCLE.BIN",
      "System Volume Information",
      "node_modules",
      ".git",
      ".next",
    ]);

    try {
      const dirEntries = fs.readdirSync(resolved, { withFileTypes: true });
      for (const entry of dirEntries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        if (SKIP_NAMES.has(entry.name)) continue;

        const fullSub = path.join(resolved, entry.name);
        let isGit = false;
        let isNode = false;
        let isPython = false;
        let mtime = null;

        try {
          const subStat = fs.statSync(fullSub);
          mtime = subStat.mtime ? subStat.mtime.toISOString() : null;
          isGit = fs.existsSync(path.join(fullSub, ".git"));
          isNode = fs.existsSync(path.join(fullSub, "package.json"));
          isPython =
            fs.existsSync(path.join(fullSub, "requirements.txt")) ||
            fs.existsSync(path.join(fullSub, "pyproject.toml"));
        } catch {
          // unreadable subdirectory, skip or include with basic info
        }

        folders.push({
          name: entry.name,
          path: fullSub,
          isGit,
          isNode,
          isPython,
          mtime,
        });
      }
    } catch (readErr) {
      return NextResponse.json({
        currentPath: resolved,
        parentPath,
        drives,
        shortcuts,
        folders: [],
        error: `Cannot read folder: ${readErr.message}`,
      });
    }

    // Sort folders alphabetically, with git/node projects first
    folders.sort((a, b) => {
      const aScore = (a.isGit ? 2 : 0) + (a.isNode ? 1 : 0);
      const bScore = (b.isGit ? 2 : 0) + (b.isNode ? 1 : 0);
      if (bScore !== aScore) return bScore - aScore;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    return NextResponse.json({
      currentPath: resolved,
      parentPath,
      drives,
      shortcuts,
      folders,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to browse directory" },
      { status: 400 }
    );
  }
}
