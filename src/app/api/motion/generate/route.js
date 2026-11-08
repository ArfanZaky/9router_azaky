import { NextResponse } from "next/server";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getApiKeys } from "@/lib/localDb";

let translatorsReady = false;
async function ensureTranslators() {
  if (!translatorsReady) {
    await initTranslators();
    translatorsReady = true;
  }
}

const SYSTEM_PROMPT = `You write Remotion (React) motion graphics components.

Output ONLY one JavaScript/JSX code block, nothing else. Rules:
- Define exactly one component: export const MyComposition = () => { ... };
- No import statements. These globals are already available: React, AbsoluteFill, Sequence, Series, Img, useCurrentFrame, useVideoConfig, interpolate, interpolateColors, spring, Easing, random.
- Drive ALL animation from useCurrentFrame() (and fps/width/height/durationInFrames from useVideoConfig()). No CSS transitions/animations, no setTimeout, no useEffect timers.
- Always pass { extrapolateLeft: "clamp", extrapolateRight: "clamp" } to interpolate when the range should not overshoot.
- Inline styles only. No external CSS, fonts, or network assets except <Img src="https://..."> when the user explicitly gives an image URL.
- Fill the frame (AbsoluteFill root with a background). Layout must adapt to width/height (portrait and landscape).
- Use the full duration; distribute scenes with <Sequence from={...} durationInFrames={...}> or <Series>.`;

function extractCode(raw) {
  const text = String(raw || "");
  const fenced = text.match(/```(?:jsx|tsx|javascript|js|typescript|ts)?\s*\n([\s\S]*?)```/);
  return (fenced ? fenced[1] : text).trim();
}

export async function POST(request) {
  try {
    await ensureTranslators();
    const body = await request.json().catch(() => ({}));
    const { prompt, model, width = 1920, height = 1080, fps = 30, durationInFrames = 150, previousCode = "", compileError = "" } = body;

    if (!prompt?.trim() && !compileError) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ error: "LLM model is required" }, { status: 400 });
    }

    const spec = `Video: ${width}x${height}, ${fps} fps, ${durationInFrames} frames (${(durationInFrames / fps).toFixed(1)}s).`;
    const userText = compileError
      ? `${spec}\nThis code fails with error:\n${compileError}\n\nFix it and return the full corrected component.\n\n${previousCode}`
      : previousCode
        ? `${spec}\nCurrent code:\n${previousCode}\n\nChange request: ${prompt.trim()}\nReturn the full updated component.`
        : `${spec}\nCreate: ${prompt.trim()}`;

    const apiKeys = await getApiKeys();
    const activeKey = apiKeys.find((k) => k.isActive !== false)?.key;
    const payload = {
      model,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText },
      ],
      temperature: 0.4,
    };
    const headers = {
      "Content-Type": "application/json",
      ...(activeKey ? { Authorization: `Bearer ${activeKey}` } : {}),
    };
    const chatRes = await handleChat(
      new Request("http://9router.local/api/v1/chat/completions", { method: "POST", headers, body: JSON.stringify(payload) }),
      { endpoint: "/api/v1/chat/completions", body: payload, headers }
    );

    const data = await chatRes.json().catch(() => ({}));
    if (!chatRes.ok) {
      return NextResponse.json(
        { error: data.error?.message || data.error || `LLM generation error (${chatRes.status})` },
        { status: chatRes.status }
      );
    }

    const msg = data?.choices?.[0]?.message || {};
    const content = typeof msg.content === "string"
      ? msg.content
      : Array.isArray(msg.content)
        ? msg.content.map((p) => (typeof p === "string" ? p : p?.text || "")).join("")
        : "";
    const code = extractCode(content);
    if (!code) {
      return NextResponse.json({ error: "Empty response from LLM" }, { status: 502 });
    }
    return NextResponse.json({ code });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
