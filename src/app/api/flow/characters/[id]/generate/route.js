import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import { getApiKeys } from "@/lib/localDb";
import { deleteImageFile, writeImageAssetFile, writeImageFromBase64 } from "@/lib/media/imageStore.js";
import { CHARACTER_VIEWS, buildViewPrompt } from "@/lib/flow/characterPrompt.js";
import { getFlowCharacter, updateFlowCharacter } from "@/lib/db/repos/flowCharactersRepo.js";
import { addFlowImage, deleteFlowImage, listFlowCharacterImages } from "@/lib/db/repos/flowImagesRepo.js";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

/**
 * One image through the existing image pipeline (same in-process call as
 * /api/video-prompt/generate-image), persisted into the media store.
 */
async function generateImage({ model, prompt }) {
  const apiKey = (await getApiKeys()).find((k) => k.isActive !== false)?.key;
  const request = new Request("http://127.0.0.1:2026/api/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, prompt, n: 1, size: "1024x1024", response_format: "url" }),
  });

  const res = await handleImageGeneration(request);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error?.message || data.error || `image generation failed (${res.status})`);
  }

  const first = data.data?.[0];
  if (first?.b64_json) return writeImageFromBase64({ id: uuidv4(), b64: first.b64_json });
  if (!first?.url) throw new Error("provider returned no image");

  const download = await fetch(first.url, { signal: AbortSignal.timeout(60000) });
  if (!download.ok) throw new Error(`could not download the generated image (${download.status})`);
  const buffer = Buffer.from(await download.arrayBuffer());
  return writeImageAssetFile({ id: uuidv4(), buffer, mime: download.headers.get("content-type") || "image/png" });
}

/**
 * POST /api/flow/characters/[id]/generate
 * Body: { views?: string[], model?: string }
 * Four views run one at a time so a single failure leaves the others intact.
 */
export async function POST(request, { params }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const character = await getFlowCharacter(id);
  if (!character) return NextResponse.json({ error: "Character not found" }, { status: 404 });

  const model = String(body.model || character.imageModel || "").trim();
  if (!model) return NextResponse.json({ error: "Pick an image model first" }, { status: 400 });

  const requested = Array.isArray(body.views) && body.views.length ? body.views : CHARACTER_VIEWS;
  const views = requested.filter((view) => CHARACTER_VIEWS.includes(view));
  if (!views.length) {
    return NextResponse.json({ error: `views must include one of ${CHARACTER_VIEWS.join(", ")}` }, { status: 400 });
  }

  await updateFlowCharacter(id, { status: "generating", imageModel: model, error: null });

  // A regenerated angle replaces its old file instead of stacking a duplicate.
  for (const image of await listFlowCharacterImages()) {
    if (image.characterId === id && views.includes(image.view)) {
      await deleteFlowImage(image.id);
      deleteImageFile(image.path);
    }
  }

  const errors = [];
  for (const view of views) {
    try {
      const prompt = buildViewPrompt(character, view);
      const file = await generateImage({ model, prompt });
      await addFlowImage({
        name: `${character.name} (${view})`,
        path: file.rel,
        mime: file.mime,
        origin: "generated",
        characterId: id,
        view,
      });
    } catch (error) {
      errors.push(`${view}: ${String(error?.message || error).slice(0, 200)}`);
    }
  }

  const images = (await listFlowCharacterImages()).filter((image) => image.characterId === id);
  const status = images.length >= CHARACTER_VIEWS.length ? "ready" : "failed";
  const updated = await updateFlowCharacter(id, { status, error: errors.length ? errors.join(" | ").slice(0, 1000) : null });

  return NextResponse.json({ character: updated, images, errors });
}
