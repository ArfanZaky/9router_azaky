import { handleVideoCreate, handleVideoGet } from "@/sse/handlers/videoGeneration.js";
import { downloadAndSaveVideo } from "@/lib/media/videoStore.js";
import { NextResponse } from "next/server";

/**
 * POST /api/video-prompt/generate-video
 * Body: { model, prompt, image?, duration?, aspectRatio?, resolution?, apiKey }
 * Calls internal handleVideoCreate directly without external HTTP hop.
 */
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      model,
      prompt,
      image,
      duration,
      aspectRatio,
      resolution,
      apiKey,
    } = body;

    if (!model) return NextResponse.json({ error: "Video model is required" }, { status: 400 });
    if (!prompt || !prompt.trim()) return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    if (!apiKey) return NextResponse.json({ error: "No active API Key" }, { status: 400 });

    const forward = { model };
    if (prompt) forward.prompt = prompt.trim();
    if (image) forward.image = image;
    if (duration) forward.duration = Number(duration);
    if (aspectRatio) forward.aspect_ratio = aspectRatio;
    if (resolution) forward.resolution = resolution;

    const mockReq = new Request("http://localhost/v1/videos/generations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(forward),
    });

    const res = await handleVideoCreate(mockReq, "generations");
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message || data.error || `Video create error (${res.status})` }, { status: res.status });
    }

    const rawVideoUrl = data.video?.url || data.url || "";
    let finalVideoUrl = rawVideoUrl;

    if (data.status === "completed" && rawVideoUrl) {
      try {
        const id = data.request_id || data.id || data.requestId;
        const saved = await downloadAndSaveVideo({ url: rawVideoUrl, id });
        if (saved?.localUrl) {
          finalVideoUrl = saved.localUrl;
        }
      } catch (saveErr) {
        console.warn("Failed to save video locally on create:", saveErr.message);
      }
    }

    return NextResponse.json({
      requestId: data.request_id || data.id || data.requestId || null,
      status: data.status || "processing",
      videoUrl: finalVideoUrl,
      sourceUrl: rawVideoUrl,
      model,
      connectionId: res.headers.get("x-9router-connection-id") || null,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

/**
 * GET /api/video-prompt/generate-video?requestId=...&connectionId=...&apiKey=...
 * Calls internal handleVideoGet directly.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get("requestId");
    const connectionId = searchParams.get("connectionId");
    const apiKey = searchParams.get("apiKey");

    if (!requestId) return NextResponse.json({ error: "Missing requestId" }, { status: 400 });
    if (!apiKey) return NextResponse.json({ error: "No active API Key" }, { status: 400 });

    const headers = { Authorization: `Bearer ${apiKey}` };
    if (connectionId) headers["x-connection-id"] = connectionId;

    const mockReq = new Request(`http://localhost/v1/videos/${encodeURIComponent(requestId)}`, {
      method: "GET",
      headers,
    });

    const res = await handleVideoGet(mockReq, requestId);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data.error?.message || data.error || `Video poll error (${res.status})` }, { status: res.status });
    }

    const rawVideoUrl = data.video?.url || data.url || "";
    let finalVideoUrl = rawVideoUrl;

    if (data.status === "completed" && rawVideoUrl) {
      try {
        const id = data.request_id || requestId;
        const saved = await downloadAndSaveVideo({ url: rawVideoUrl, id });
        if (saved?.localUrl) {
          finalVideoUrl = saved.localUrl;
        }
      } catch (saveErr) {
        console.warn("Failed to save video locally on poll:", saveErr.message);
      }
    }

    return NextResponse.json({
      status: data.status || "processing",
      videoUrl: finalVideoUrl,
      sourceUrl: rawVideoUrl,
      requestId: data.request_id || requestId,
      error: data.error || "",
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
