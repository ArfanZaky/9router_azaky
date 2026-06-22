import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse text-only content arrays to the string shape expected by plain
// OpenAI-compatible endpoints. Preserve arrays whenever a non-text part exists.
export function collapseTextParts(parts) {
  if (parts.length > 0 && parts.every((part) => part?.type === OPENAI_BLOCK.TEXT)) {
    return parts.map((part) => part.text || "").join("\n");
  }
  return parts;
}
