import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "../dataDir.js";
import { writeVideoAssetFile } from "../media/videoStore.js";
import { VERSION } from "remotion/version";

const BUNDLE_ROOT = path.join(DATA_DIR, "motion");
const ENTRY_NAME = "remotionEntry.js";

// Same lookup strategy as src/mitm/manager.js: dev runs from repo root, standalone from .next/standalone.
function resolveEntry() {
  const candidates = [
    path.join(process.cwd(), "src", "lib", "motion", ENTRY_NAME),
    path.join(process.cwd(), "..", "src", "lib", "motion", ENTRY_NAME),
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`Remotion entry not found (looked in: ${candidates.join(", ")})`);
  return found;
}

function bundleKey(entry) {
  const dir = path.dirname(entry);
  const stamp = ["compile.js", ENTRY_NAME]
    .map((f) => fs.statSync(path.join(dir, f)).mtimeMs)
    .join("-");
  return crypto.createHash("sha1").update(`${VERSION}:${stamp}`).digest("hex").slice(0, 12);
}

let bundlePromise = null;
let bundleKeyCached = null;

async function getServeUrl(onStage) {
  const entry = resolveEntry();
  const key = bundleKey(entry);
  const outDir = path.join(BUNDLE_ROOT, `bundle-${key}`);
  if (bundleKeyCached === key && bundlePromise) return bundlePromise;
  bundleKeyCached = key;
  bundlePromise = (async () => {
    if (fs.existsSync(path.join(outDir, "index.html"))) return outDir;
    onStage?.("bundling");
    const { bundle } = await import("@remotion/bundler");
    fs.mkdirSync(BUNDLE_ROOT, { recursive: true });
    return bundle({ entryPoint: entry, outDir, enableCaching: true });
  })();
  bundlePromise.catch(() => {
    bundlePromise = null;
    bundleKeyCached = null;
  });
  return bundlePromise;
}

const jobs = (globalThis.__motionRenderJobs ??= new Map());

export function getRenderJob(id) {
  return jobs.get(id) || null;
}

function isBusy() {
  for (const job of jobs.values()) if (job.status === "running") return true;
  return false;
}

// ponytail: one render at a time, in-memory job state (lost on restart). Add a queue + DB rows when parallel/persistent renders are needed.
export function startRenderJob(props) {
  if (isBusy()) {
    const err = new Error("Another render is already running");
    err.status = 409;
    throw err;
  }
  const id = `motion-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const job = { id, status: "running", stage: "preparing", progress: 0, error: null, video: null, startedAt: Date.now() };
  jobs.set(id, job);

  (async () => {
    const tmpOut = path.join(BUNDLE_ROOT, `${id}.mp4`);
    try {
      const serveUrl = await getServeUrl((stage) => (job.stage = stage));
      const { ensureBrowser, selectComposition, renderMedia } = await import("@remotion/renderer");
      job.stage = "browser";
      await ensureBrowser();
      job.stage = "rendering";
      const composition = await selectComposition({ serveUrl, id: "Dynamic", inputProps: props });
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        inputProps: props,
        outputLocation: tmpOut,
        concurrency: "50%",
        onProgress: ({ progress }) => {
          job.progress = progress;
        },
      });
      const saved = writeVideoAssetFile({ id, buffer: fs.readFileSync(tmpOut), ext: "mp4" });
      job.video = { id: saved.id, url: `/api/video-prompt/media/${saved.id}`, size: saved.size };
      job.progress = 1;
      job.stage = "done";
      job.status = "done";
    } catch (e) {
      job.status = "error";
      job.error = e?.message || String(e);
    } finally {
      fs.rmSync(tmpOut, { force: true });
      job.finishedAt = Date.now();
    }
  })();

  return job;
}
