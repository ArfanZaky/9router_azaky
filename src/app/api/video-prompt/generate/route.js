import { NextResponse } from "next/server";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { getApiKeys } from "@/lib/localDb";
import {
  ANTISLOP_STORYBOARD_DIRECTIVE,
  getDirectorPersonaInstruction,
  sanitizeStoryboardOutput,
} from "@/lib/videoPrompt/antislop.js";

let translatorsReady = false;
async function ensureTranslators() {
  if (!translatorsReady) {
    await initTranslators();
    translatorsReady = true;
  }
}

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

function extractTextFromChoices(data) {
  const choice = data?.choices?.[0];
  if (!choice) return "";
  const msg = choice.message || choice.delta || {};
  if (typeof msg.content === "string" && msg.content.trim()) {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    const combined = msg.content
      .map((part) => {
        if (typeof part === "string") return part;
        if ((!part?.type || part.type === "text" || part.type === "output_text") && typeof part?.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("")
      .trim();
    if (combined) return combined;
  }
  if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) {
    return msg.reasoning_content;
  }
  if (typeof msg.reasoning === "string" && msg.reasoning.trim()) {
    return msg.reasoning;
  }
  return "";
}

export async function POST(request) {
  try {
    await ensureTranslators();
    const body = await request.json().catch(() => ({}));
    const {
      prompt,
      model,
      style = "35mm Film, natural lighting",
      sceneCount = 4,
      targetEngine = "General Video (Runway / Kling / Sora / Luma)",
      aspectRatio = "16:9",
      characterDesc = "",
      refImage = "",
      directorPersona = "cinematic_slowburn",
      negativePrompt = "",
    } = body;

    if (!prompt || !prompt.trim()) {
      return NextResponse.json({ error: "Story/prompt is required" }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ error: "LLM model is required" }, { status: 400 });
    }

    const apiKeys = await getApiKeys();
    const activeKey = apiKeys.find((k) => k.isActive !== false)?.key;
    const personaInstruction = getDirectorPersonaInstruction(directorPersona);

    const systemPrompt = `You are a production storyboard artist and cinematographer.
Break the user's story concept into an exact sequence of ${sceneCount} contiguous storyboard shots.

${ANTISLOP_STORYBOARD_DIRECTIVE}

PRODUCTION REQUIREMENTS:
1. CHARACTER & VISUAL CONTINUITY:
   - Identify the primary character(s) with concrete physical details (age, build, hair, face, clothing, props).
   - Repeat those exact visual identifiers in Scene 2 and every subsequent scene so each shot can be rendered independently without character drift.
   - Respect provided character specs or reference image: "${characterDesc || "Derive directly from the story concept and keep identical across shots"}".

2. DIRECTION & PACING:
   - ${personaInstruction}
   ${negativePrompt ? `- Visual elements to avoid across all prompts: ${negativePrompt}` : ""}

3. SHOT PROMPTS:
   - "motionPrompt": Combine camera movement, subject action, physical lighting source, ambient sound, and spoken line (if any) into one continuous prompt.
     Example: "Locked 50mm medium shot inside a fluorescent-lit office, an accountant in a grey wool suit closes a ledger on the desk and looks toward the glass door, rain tapping against the window, [SFX: paper rustle and low fluorescent hum], [VO: 'The audit starts at eight.']"
   - "imagePrompt": Describe the still starting frame for an image generator with composition, lens focal length (e.g., 35mm, 50mm, 85mm), physical lighting, natural surface texture, and aspect ratio tag --ar ${aspectRatio}.

4. JSON OUTPUT FORMAT:
Respond with valid JSON ONLY. No markdown prose or preamble.

{
  "projectTitle": "Short factual project title",
  "characterConsistencyPrompt": "Concrete physical and wardrobe description of main character(s) and lighting continuity",
  "scenes": [
    {
      "sceneNumber": 1,
      "timecode": "00:00 - 00:05",
      "summary": "One-sentence factual action summary",
      "imagePrompt": "First-frame still description with character details, lens focal length, physical lighting, --ar ${aspectRatio}",
      "motionPrompt": "Camera movement, subject action, physical lighting, [SFX: sound description], [VO: spoken line or empty]",
      "camera": "Shot size, lens, and camera movement (e.g., 35mm Medium Tracking Left)",
      "lighting": "Physical light source and atmosphere",
      "audioSfx": "Concrete sound effects and room tone",
      "voiceover": "Spoken line (or empty string if none)"
    }
  ]
}`;

    const textPrompt = `Story Concept: ${prompt.trim()}
Visual Style: ${style}
Target Video Platform: ${targetEngine}
Scene Count: ${sceneCount}
Aspect Ratio: ${aspectRatio}
Director Pacing: ${personaInstruction}
Main Character Specs: ${characterDesc ? characterDesc : "Extract from story concept and keep identical across all shots"}`;

    let userContent = textPrompt;
    if (refImage && (refImage.startsWith("data:image/") || refImage.startsWith("http") || refImage.startsWith("/api/flow/images/"))) {
      let resolvedRefUrl = refImage;
      const flowMatch = refImage.match(/^\/api\/flow\/images\/([^/?#]+)/i);
      if (flowMatch) {
        try {
          const [{ getFlowImage }, { readImageFile }] = await Promise.all([
            import("@/lib/db/repos/flowImagesRepo.js"),
            import("@/lib/media/imageStore.js"),
          ]);
          const row = await getFlowImage(flowMatch[1]);
          const buf = row?.path ? readImageFile(row.path) : null;
          if (buf) {
            resolvedRefUrl = `data:${row.mime || "image/png"};base64,${buf.toString("base64")}`;
          }
        } catch {
          // ignore fallback
        }
      }
      if (resolvedRefUrl.startsWith("data:image/") || resolvedRefUrl.startsWith("http")) {
        userContent = [
          { type: "text", text: `${textPrompt}\n[Reference visual image attached above for character/scene styling]` },
          { type: "image_url", image_url: { url: resolvedRefUrl } },
        ];
      }
    }

    const payload = {
      model,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.7,
    };

    const headers = {
      "Content-Type": "application/json",
      ...(activeKey ? { Authorization: `Bearer ${activeKey}` } : {}),
    };

    const inProcessReq = new Request("http://9router.local/api/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    const chatRes = await handleChat(inProcessReq, {
      endpoint: "/api/v1/chat/completions",
      body: payload,
      headers,
    });

    const data = await chatRes.json().catch(() => ({}));
    if (!chatRes.ok) {
      return NextResponse.json(
        { error: data.error?.message || data.error || `LLM generation error (${chatRes.status})` },
        { status: chatRes.status }
      );
    }

    const content = extractTextFromChoices(data);
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

    return NextResponse.json(sanitizeStoryboardOutput(parsed));
  } catch (error) {
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
