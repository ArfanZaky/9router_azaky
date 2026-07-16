import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { listImageJobs, createImageJob } from "@/lib/localDb";
import { writeImageFromBase64 } from "@/lib/media/imageStore.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") || "";
    const model = searchParams.get("model") || "";
    const favoriteOnly = searchParams.get("favorite") === "1";
    const limit = searchParams.get("limit") || 100;
    const offset = searchParams.get("offset") || 0;
    const jobs = await listImageJobs({ q, model, favoriteOnly, limit, offset });
    return NextResponse.json({ jobs });
  } catch (error) {
    console.log("Error listing image jobs:", error);
    return NextResponse.json({ error: "Failed to list image jobs" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    if (!body?.prompt) {
      return NextResponse.json({ error: "prompt is required" }, { status: 400 });
    }

    const assetsIn = [];
    for (const item of body.assets || body.images || []) {
      const id = item.id || uuidv4();
      if (item.b64_json || item.b64) {
        const mime = item.mime || item.content_type || "image/png";
        const written = writeImageFromBase64({
          id,
          b64: item.b64_json || item.b64,
          mime,
        });
        assetsIn.push({
          id,
          path: written.rel,
          mime: written.mime,
          sourceUrl: item.url || null,
        });
      } else if (item.path || item.url) {
        assetsIn.push({
          id,
          path: item.path || null,
          mime: item.mime || "image/png",
          sourceUrl: item.url || item.sourceUrl || null,
        });
      }
    }

    // OpenAI-style data: [{ b64_json|url }]
    if ((!body.assets && !body.images) && Array.isArray(body.data)) {
      for (const item of body.data) {
        const id = uuidv4();
        if (item.b64_json) {
          const written = writeImageFromBase64({ id, b64: item.b64_json, mime: "image/png" });
          assetsIn.push({ id, path: written.rel, mime: written.mime, sourceUrl: item.url || null });
        } else if (item.url) {
          assetsIn.push({ id, path: null, mime: "image/png", sourceUrl: item.url });
        }
      }
    }

    const job = await createImageJob({
      prompt: body.prompt,
      negativePrompt: body.negativePrompt || body.negative_prompt || "",
      model: body.model || "",
      providerId: body.providerId || "",
      params: body.params || {},
      status: body.status || "done",
      error: body.error || null,
      favorite: !!body.favorite,
      assets: assetsIn,
    });

    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    console.log("Error creating image job:", error);
    return NextResponse.json({ error: "Failed to create image job" }, { status: 500 });
  }
}
