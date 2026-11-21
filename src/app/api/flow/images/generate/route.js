import fs from "node:fs";
import { NextResponse } from "next/server";
import { FlowRequestError, generateFlowImage } from "@/lib/flow/bridge";
import { getFlowImage } from "@/lib/db/repos/flowImagesRepo.js";
import { resolveImageAssetPath } from "@/lib/media/imageStore.js";

export const dynamic = "force-dynamic";
// t2i takes about a minute, but the request waits behind any running video job.
export const maxDuration = 900;

/**
 * POST /api/flow/images/generate
 * Body: { prompt, model?, aspect?, count?: 1-4, refAssetIds?: string[], profile?, projectId? }
 *
 * References are library ids only, resolved here to files under the media
 * store. Raw paths and URLs are not accepted on this route.
 * Returns { images: [{ id, url, name }] }; every image is already saved in the library.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "expected a JSON body" }, { status: 400 });
    }

    const ids = Array.isArray(body.refAssetIds) ? body.refAssetIds.map(String).filter(Boolean) : [];
    const refPaths = [];
    for (const id of ids) {
      const asset = await getFlowImage(id);
      if (!asset) throw new FlowRequestError(`reference '${id}' is not in the Flow library`);
      const abs = resolveImageAssetPath(asset.path);
      if (!abs || !fs.existsSync(abs)) throw new FlowRequestError(`library image '${asset.name || asset.id}' is missing from disk`);
      refPaths.push(abs);
    }

    const result = await generateFlowImage(
      {
        prompt: body.prompt,
        model: body.model,
        aspect: body.aspect,
        count: body.count,
        profile: body.profile || undefined,
        projectId: body.projectId || undefined,
      },
      { refPaths }
    );

    const prompt = String(body.prompt || "").trim().slice(0, 60);
    const images = (result.images || [result]).map((image) => ({ id: image.id, url: image.url, name: prompt }));
    return NextResponse.json({ images, dryRun: Boolean(result.dry_run) }, { status: 201 });
  } catch (error) {
    if (error instanceof FlowRequestError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.log("Error generating flow image:", error?.message || error);
    return NextResponse.json({ error: String(error?.message || error).slice(0, 600) }, { status: 500 });
  }
}
