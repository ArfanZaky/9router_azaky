import { NextResponse } from "next/server";
import { handleImageGeneration } from "@/sse/handlers/imageGeneration.js";
import { getApiKeys } from "@/lib/localDb";

/**
 * POST /api/video-prompt/generate-image
 * Body: { prompt, model, aspectRatio, apiKey }
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { prompt, model, aspectRatio = "16:9", apiKey: clientApiKey } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ error: "Image model is required" }, { status: 400 });
    }

    let apiKey = clientApiKey;
    if (!apiKey) {
      const apiKeys = await getApiKeys();
      apiKey = apiKeys.find((k) => k.isActive !== false)?.key;
    }

    // Map common aspect ratio to width/height or size string if applicable
    let size = "1024x1024";
    if (aspectRatio === "16:9") size = "1792x1024";
    else if (aspectRatio === "9:16") size = "1024x1792";
    else if (aspectRatio === "21:9" || aspectRatio === "2.39:1") size = "1920x800";

    const payload = {
      model,
      prompt: prompt.trim(),
      n: 1,
      size,
      response_format: "url",
    };

    const headers = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };

    const inProcessReq = new Request("http://127.0.0.1:2026/api/v1/images/generations", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const res = await handleImageGeneration(inProcessReq);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorMsg = data.error?.message || data.error || `Image generation failed (${res.status})`;
      return NextResponse.json(
        { error: errorMsg },
        { status: res.status }
      );
    }

    const firstImage = data.data?.[0];
    const imageUrl = firstImage?.url || (firstImage?.b64_json ? `data:image/png;base64,${firstImage.b64_json}` : "");

    if (!imageUrl) {
      return NextResponse.json({ error: "No image returned by provider" }, { status: 500 });
    }

    return NextResponse.json({
      imageUrl,
      model,
      data: data.data || [],
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
