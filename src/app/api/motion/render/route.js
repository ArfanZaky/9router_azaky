import { NextResponse } from "next/server";
import { getRenderJob, startRenderJob } from "@/lib/motion/render.js";

export const dynamic = "force-dynamic";

const int = (v, min, max) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
};

export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const code = typeof body.code === "string" ? body.code : "";
  const width = int(body.width, 16, 3840);
  const height = int(body.height, 16, 3840);
  const fps = int(body.fps, 1, 60);
  const durationInFrames = int(body.durationInFrames, 1, 60 * 60 * 5);
  if (!code.trim()) return NextResponse.json({ error: "Code is required" }, { status: 400 });
  if (!width || !height || !fps || !durationInFrames) {
    return NextResponse.json({ error: "Invalid width/height/fps/durationInFrames" }, { status: 400 });
  }
  // H.264 requires even dimensions.
  if (width % 2 || height % 2) {
    return NextResponse.json({ error: "Width and height must be even numbers" }, { status: 400 });
  }
  try {
    const job = startRenderJob({ code, width, height, fps, durationInFrames });
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: e.status || 500 });
  }
}

export async function GET(request) {
  const id = new URL(request.url).searchParams.get("id");
  const job = id ? getRenderJob(id) : null;
  if (!job) return NextResponse.json({ error: "Render job not found" }, { status: 404 });
  return NextResponse.json({ job });
}
