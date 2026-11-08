// Anti-slop filter and prompt directives for /dashboard/video-prompt AI calls.
// Enforces antislop core, antislop-copywriting, and antislop-ui rules across LLM, image, and video generation.

const SLOP_BUZZWORDS_RE =
  /\b(masterpiece|best quality|ultra[- ]detailed|hyper[- ]realistic|hyper[- ]detailed|photorealistic|breathtaking|stunning|revolutionary|cutting[- ]edge|seamless|next[- ]generation|world[- ]class|jaw[- ]dropping|mind[- ]blowing|award[- ]winning|unreal engine(?:\s*5)?|octane render|trending on artstation|8k uhd|4k uhd)\b/gi;

const DIRECTOR_PERSONA_GUIDANCE = {
  huobao_drama:
    "Pacing: tight dramatic cuts, immediate conflict in the opening shot, clear facial reactions, and grounded dialogue.",
  cinematic_slowburn:
    "Pacing: measured unhurried camera movement, motivated environmental lighting, held reaction shots, and minimal dialogue.",
  action_packed:
    "Pacing: clear spatial geography, physical momentum, tracking camera movement, and impact sound effects.",
  documentary:
    "Pacing: observational framing, available natural light, handheld or locked-off tripod shots, and authentic ambient sound.",
};

export const DEFAULT_NEGATIVE_PROMPT =
  "blurry, low quality, deformed anatomy, extra limbs, plastic skin, oversaturated neon purple-cyan cast, floating orbs, watermark, text overlay, subtitles";

export const ANTISLOP_STORYBOARD_DIRECTIVE = `ANTI-SLOP RULES (MANDATORY):
1. NO EM DASHES: Never output the em dash character (\u2014), en dash (\u2013), or spaced double hyphens ( -- ) in any field. Use commas, periods, colons, or parentheses.
2. NO AI BUZZWORDS: Never use filler adjectives like "masterpiece", "breathtaking", "stunning", "hyper-realistic", "ultra-detailed", "cutting-edge", "seamless", "epic", "revolutionary", or "trending on ArtStation".
3. NO DEFAULT AI VISUAL CLICHES: Do not inject unrequested blue-purple/cyan-magenta neon lighting, floating glowing orbs, volumetric god-rays everywhere, or plastic skin. Use them only if the user's prompt explicitly asks for them.
4. GROUNDED CINEMATOGRAPHY: Specify real focal lengths (e.g., 24mm, 35mm, 50mm, 85mm), concrete physical light sources (e.g., overcast daylight through blinds, overhead fluorescent tube, tungsten desk lamp), and one clear camera movement per shot.
5. NATURAL DIALOGUE & VOICEOVER: Write voiceover or dialogue only when it advances the scene. Avoid movie-trailer cliches ("In a world...", "Every empire starts in the dark", "Little did they know"). Leave voiceover empty ("") when action and sound carry the beat.
6. STRICT FACTUAL CONSISTENCY: Do not invent subplots, sci-fi gadgets, or character traits that contradict or drift from the user's story concept.`;

export const ANTISLOP_CHARACTER_EXTRACT_DIRECTIVE = `ANTI-SLOP RULES (MANDATORY):
1. Extract ONLY characters present or directly implied in the user's story text. Never invent random sci-fi props (like glowing cybernetic eyes) unless stated in the story.
2. Write plain, concrete physical and wardrobe descriptions (age range, build, hair, clothing, key item).
3. Never use the em dash character (\u2014) or AI buzzwords ("stunning", "breathtaking", "ethereal", "badass", "iconic").`;

export function getDirectorPersonaInstruction(directorPersona) {
  return DIRECTOR_PERSONA_GUIDANCE[directorPersona] || DIRECTOR_PERSONA_GUIDANCE.cinematic_slowburn;
}

export function sanitizeAntislopText(input) {
  if (typeof input !== "string") return "";
  let out = input
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+--\s+(?!ar\b)/gi, ", ")
    .replace(SLOP_BUZZWORDS_RE, "");

  while (/,\s*,/.test(out)) {
    out = out.replace(/,\s*,+/g, ",");
  }
  return out
    .replace(/\s+,/g, ",")
    .replace(/,\s*/g, ", ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[,.\s]+|[,;\s]+$/g, "")
    .trim();
}

export function sanitizeStoryboardOutput(parsed = {}) {
  const scenes = Array.isArray(parsed.scenes)
    ? parsed.scenes.map((scene, idx) => ({
        ...scene,
        sceneNumber: Number(scene?.sceneNumber) || idx + 1,
        timecode: sanitizeAntislopText(String(scene?.timecode || "")),
        summary: sanitizeAntislopText(String(scene?.summary || "")),
        imagePrompt: sanitizeAntislopText(String(scene?.imagePrompt || "")),
        motionPrompt: sanitizeAntislopText(String(scene?.motionPrompt || "")),
        camera: sanitizeAntislopText(String(scene?.camera || "")),
        lighting: sanitizeAntislopText(String(scene?.lighting || "")),
        audioSfx: sanitizeAntislopText(String(scene?.audioSfx || "")),
        voiceover: sanitizeAntislopText(String(scene?.voiceover || "")),
      }))
    : [];

  return {
    projectTitle: sanitizeAntislopText(String(parsed.projectTitle || "")) || "Untitled Storyboard",
    characterConsistencyPrompt: sanitizeAntislopText(String(parsed.characterConsistencyPrompt || "")),
    scenes,
  };
}

function resolveNegativePrompt(optionsOrNeg, fallback = "") {
  if (typeof optionsOrNeg === "string") return optionsOrNeg || fallback;
  if (optionsOrNeg && typeof optionsOrNeg === "object") {
    return optionsOrNeg.negativePrompt || fallback;
  }
  return fallback;
}

export function applyAntislopImagePrompt(prompt, optionsOrNeg = {}) {
  const base = sanitizeAntislopText(prompt);
  if (!base) return "";
  const neg = sanitizeAntislopText(resolveNegativePrompt(optionsOrNeg, DEFAULT_NEGATIVE_PROMPT));
  const guard =
    "Natural surface texture, physically grounded lighting, accurate proportions, no watermark or text overlay";
  const parts = [base];
  if (!base.toLowerCase().includes("natural surface texture")) {
    parts.push(guard);
  }
  if (neg) {
    parts.push(`Avoid: ${neg}`);
  }
  return parts.join(". ");
}

export function applyAntislopVideoPrompt(prompt, optionsOrNeg = {}) {
  const base = sanitizeAntislopText(prompt);
  if (!base) return "";
  const neg = sanitizeAntislopText(resolveNegativePrompt(optionsOrNeg, ""));
  const guard = "Steady camera path, consistent subject proportions, physically grounded motion";
  const parts = [base];
  if (!base.toLowerCase().includes("physically grounded motion")) {
    parts.push(guard);
  }
  if (neg) {
    parts.push(`Avoid: ${neg}`);
  }
  return parts.join(". ");
}
