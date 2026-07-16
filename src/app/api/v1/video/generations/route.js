import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * POST /v1/video/generations
 * OpenAI-style video generation. Reuses the image generation pipeline + adapters
 * (e.g. Runway image_to_video) which already normalize to { data: [{ url }] }.
 */
export async function POST(request) {
  return await handleImageGeneration(request);
}
