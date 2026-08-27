/**
 * Recursive text splitter — splits text into chunks of ~chunkSize tokens
 * with overlap. Approximates tokens as words (÷ 0.75).
 */

const SEPARATORS = ["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " "];

function approxTokenCount(text) {
  // ~1 token per 4 chars for English, rough but good enough
  return Math.ceil(text.length / 4);
}

function splitBySeparator(text, sep) {
  const parts = text.split(sep);
  const result = [];
  for (let i = 0; i < parts.length; i++) {
    result.push(i < parts.length - 1 ? parts[i] + sep : parts[i]);
  }
  return result.filter(Boolean);
}

export function chunkText(text, { chunkSize = 512, chunkOverlap = 50 } = {}) {
  if (!text || !text.trim()) return [];

  const maxChars = chunkSize * 4; // approx chars per chunk
  const overlapChars = chunkOverlap * 4;

  if (text.length <= maxChars) {
    return [{ content: text.trim(), tokenCount: approxTokenCount(text) }];
  }

  const chunks = [];
  let currentChunk = "";

  // Try splitting by best separator
  let parts = [text];
  for (const sep of SEPARATORS) {
    if (text.includes(sep)) {
      parts = splitBySeparator(text, sep);
      break;
    }
  }

  for (const part of parts) {
    if ((currentChunk + part).length > maxChars && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        tokenCount: approxTokenCount(currentChunk),
      });
      // Keep overlap from end of current chunk
      if (overlapChars > 0 && currentChunk.length > overlapChars) {
        currentChunk = currentChunk.slice(-overlapChars) + part;
      } else {
        currentChunk = part;
      }
    } else {
      currentChunk += part;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      content: currentChunk.trim(),
      tokenCount: approxTokenCount(currentChunk),
    });
  }

  return chunks;
}

/**
 * Extract text from various file types.
 * PDF/DOCX need external parsing; for now we handle plain text, markdown, CSV, HTML.
 */
export function extractText(content, type) {
  if (!content) return "";
  if (type === "text" || type === "md" || type === "markdown" || type === "csv" || type === "txt") {
    return content;
  }
  if (type === "html") {
    // Strip HTML tags, keep text
    return content.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  // Default: treat as plain text
  return content;
}
