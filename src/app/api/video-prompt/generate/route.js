import { NextResponse } from "next/server";
import { getApiKeys } from "@/lib/localDb";

function cleanJsonText(raw) {
  let cleaned = String(raw || "").trim();
  // Strip Markdown code fences if wrapped in ```json ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "").replace(/```$/, "").trim();
  }
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const {
      prompt,
      model,
      style = "Cinematic",
      sceneCount = 4,
      targetEngine = "General AI Video (Runway / Kling / Sora / Luma)",
      aspectRatio = "16:9",
      characterDesc = "",
    } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Story/prompt is required" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ error: "LLM model is required" }, { status: 400 });
    }

    const apiKeys = await getApiKeys();
    const activeKey = apiKeys.find((k) => k.isActive !== false)?.key;

    const systemPrompt = `You are a world-class AI Video Director, Cinematographer, and Storyboard Prompt Engineer.
Your task is to break down the user's storyline/concept into an exact sequence of ${sceneCount} coherent, highly cinematic storyboard scenes.

CRITICAL INSTRUCTIONS:
1. CHARACTER & VISUAL CONSISTENCY:
   - Identify the main character(s) and their exact appearance (clothing, hair, face features, colors, age).
   - Maintain STRICT visual consistency across ALL scenes. Scene 2 and subsequent scenes must explicitly reference and maintain the same character details, environment lighting, and art style from Scene 1.
   - If user provides specific character details: "${characterDesc || "Derive from prompt and keep strictly consistent"}", you MUST adhere to it.

2. ONE SINGLE TEXT PROMPT FORMAT:
   - For every scene, "motionPrompt" MUST combine camera motion, subject action, environment lighting, audio soundscape, and dialogue/voiceover into ONE continuous, production-ready video generation prompt.
   - Example motionPrompt: "Slow forward camera dolly descending through mist, a detective in a worn trench coat walks under blinking neon signs, volumetric raindrops hitting the lens, Cyberpunk Neon & Wet Reflection, [SFX: Heavy rain and distant sirens], [VO: 'Every empire starts in the dark.']"

3. FIRST-FRAME IMAGE PROMPT:
   - "imagePrompt" must be a pristine, photorealistic/stylized still frame describing the starting frame for image generator (Midjourney/DALL-E/Flux style), including exact composition, camera lens (e.g., 35mm / 85mm), lighting, and aspect ratio tag --ar ${aspectRatio}.

4. JSON OUTPUT FORMAT:
You MUST respond with valid JSON ONLY. No preamble, no explanation.

{
  "projectTitle": "Short catchy title",
  "characterConsistencyPrompt": "Detailed visual description of consistent main character(s) and signature style",
  "scenes": [
    {
      "sceneNumber": 1,
      "timecode": "00:00 - 00:05",
      "summary": "Brief 1-sentence action summary",
      "imagePrompt": "Detailed first-frame image prompt with character details, lens, lighting, --ar ${aspectRatio}",
      "motionPrompt": "Full combined prompt: camera movement, subject motion, lighting ambiance, [SFX: audio description], [VO: voiceover if any]",
      "camera": "Camera shot & movement (e.g., Wide Drone Crane Down / Close-up Pan Right)",
      "lighting": "Lighting & atmosphere description",
      "audioSfx": "Sound effects and ambient background audio",
      "voiceover": "Spoken line or narration (or empty string if none)"
    }
  ]
}`;

    const userMessage = `Story Concept: ${prompt.trim()}
Visual Style: ${style}
Target AI Video Platform: ${targetEngine}
Scene Count: ${sceneCount}
Aspect Ratio: ${aspectRatio}
Main Character Specs: ${characterDesc ? characterDesc : "Extract and make strictly consistent across scenes"}`;

    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "127.0.0.1:3000";
    const protocol = request.headers.get("x-forwarded-proto") || (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
    const chatEndpoint = `${protocol}://${host}/api/v1/chat/completions`;

    const chatRes = await fetch(chatEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(activeKey ? { Authorization: `Bearer ${activeKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.7,
      }),
    });

    const data = await chatRes.json().catch(() => ({}));
    if (!chatRes.ok) {
      return NextResponse.json(
        { error: data.error?.message || data.error || `LLM generation error (${chatRes.status})` },
        { status: chatRes.status }
      );
    }

    const content = data.choices?.[0]?.message?.content || "";
    if (!content) {
      return NextResponse.json({ error: "Empty response from LLM" }, { status: 500 });
    }

    let parsed;
    try {
      const cleaned = cleanJsonText(content);
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return NextResponse.json(
        {
          error: "Failed to parse storyboard JSON from model output",
          raw: content,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      projectTitle: parsed.projectTitle || "Generated Storyboard",
      characterConsistencyPrompt: parsed.characterConsistencyPrompt || "",
      scenes: Array.isArray(parsed.scenes) ? parsed.scenes : [],
    });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
