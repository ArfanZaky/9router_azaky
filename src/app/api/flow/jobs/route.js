import { NextResponse } from "next/server";
import path from "node:path";
import fs from "node:fs";
import { v4 as uuidv4 } from "uuid";
import { enqueueFlowJob, FlowRequestError } from "@/lib/flow/bridge";
import { listFlowJobs } from "@/lib/db/repos/flowRepo";
import { DATA_DIR } from "@/lib/dataDir";

export const dynamic = "force-dynamic";

const UPLOAD_DIR = path.join(DATA_DIR, "flow", "uploads");

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const jobs = await listFlowJobs({
    status: searchParams.get("status") || "",
    limit: searchParams.get("limit") || 50,
    offset: searchParams.get("offset") || 0,
  });
  return NextResponse.json({ jobs });
}

/** Save an uploaded frame and return its absolute path (the driver reads it from disk). */
async function saveUpload(file) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const ext = path.extname(file.name || "").toLowerCase() || ".png";
  const abs = path.join(UPLOAD_DIR, `${uuidv4()}${ext}`);
  fs.writeFileSync(abs, Buffer.from(await file.arrayBuffer()));
  return abs;
}

export async function POST(request) {
  try {
    const type = request.headers.get("content-type") || "";
    let body;
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      body = {};
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") body[key] = value;
      }
      // duration/aspect arrive as strings from a form
      if (body.duration) body.duration = Number(body.duration);
      const file = form.get("image");
      if (file && typeof file !== "string") body.imagePath = await saveUpload(file);
    } else {
      body = await request.json().catch(() => ({}));
    }

    const job = await enqueueFlowJob(body);
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    if (error instanceof FlowRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.log("Error enqueueing flow job:", error);
    return NextResponse.json({ error: String(error?.message || error).slice(0, 500) }, { status: 500 });
  }
}
