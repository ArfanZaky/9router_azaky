// Four prompts for one character. The character description is copied verbatim
// into every view: that shared text is the only thing keeping the angles
// consistent when the image model cannot take a reference image.

export const CHARACTER_VIEWS = ["front", "back", "left", "right"];

const VIEW_DIRECTION = {
  front: "front view, facing the camera, full face visible",
  back: "back view, seen from behind, back of head and body visible, face not visible",
  left: "left side view, seen from the character's left, full profile",
  right: "right side view, seen from the character's right, full profile",
};

/**
 * @param {{ name?: string, description?: string, style?: string }} input
 * @returns {{ view: string, prompt: string }[]} one entry per CHARACTER_VIEWS
 */
export function buildViewPrompts({ name = "", description = "", style = "" } = {}) {
  const subject = [name, description].map((part) => String(part || "").trim()).filter(Boolean).join(", ");
  if (!subject) throw new Error("a character needs a name or a description to build prompts");

  return CHARACTER_VIEWS.map((view) => ({
    view,
    prompt: [
      subject,
      VIEW_DIRECTION[view],
      style ? String(style).trim() : "",
      "full body, neutral standing pose, plain light grey background, soft even studio lighting",
      "character reference sheet, detailed, sharp focus",
    ]
      .filter(Boolean)
      .join(", "),
  }));
}

/** Prompt for a single angle; throws when `view` is not one of CHARACTER_VIEWS. */
export function buildViewPrompt(character, view) {
  const found = buildViewPrompts(character).find((entry) => entry.view === view);
  if (!found) throw new Error(`unknown view '${view}' (allowed: ${CHARACTER_VIEWS.join(", ")})`);
  return found.prompt;
}
