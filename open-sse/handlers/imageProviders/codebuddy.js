// CodeBuddy Global exposes image models through its stream-only chat gateway,
// not an OpenAI /images/generations endpoint. Reuse its executor for the
// authenticated, gzipped CLI request envelope and decode only real image output.
import { getExecutor } from "../../executors/index.js";
import { nowSec } from "./_base.js";

const MAX_STREAM_CHARS = 40 * 1024 * 1024;

function collectImages(value, images, seen, depth = 0) {
  if (depth > 7 || value == null) return;
  if (typeof value === "string") {
    // Data URI in a markdown image or an image content block; do not mistake
    // ordinary prose or a quoted reference image for generated output.
    const dataUrls = value.match(/data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+/gi) || [];
    for (const uri of dataUrls) {
      if (!seen.has(uri)) {
        seen.add(uri);
        images.push({ b64_json: uri.slice(uri.indexOf(",") + 1) });
      }
    }
    const links = [...value.matchAll(/!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g)];
    for (const [, url] of links) {
      if (!seen.has(url)) {
        seen.add(url);
        images.push({ url });
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const part of value) collectImages(part, images, seen, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  if (typeof value.b64_json === "string" && value.b64_json.length > 32) {
    if (!seen.has(value.b64_json)) {
      seen.add(value.b64_json);
      images.push({ b64_json: value.b64_json });
    }
    return;
  }
  const image = value.image_url || (value.type === "image" ? value.url : null);
  if (image) collectImages(typeof image === "string" ? `![image](${image})` : image, images, seen, depth + 1);
  // Only traverse response output fields, never the request/user echo.
  for (const key of ["choices", "message", "delta", "data", "content", "output", "parts", "result", "images", "image", "inlineData", "inline_data", "url"]) {
    if (value[key] !== undefined && key !== "image_url") {
      if (key === "url" && typeof value.url === "string") collectImages(`![image](${value.url})`, images, seen, depth + 1);
      else if ((key === "inlineData" || key === "inline_data") && value[key]?.data) collectImages({ b64_json: value[key].data }, images, seen, depth + 1);
      else collectImages(value[key], images, seen, depth + 1);
    }
  }
}

async function decodeResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/event-stream")) return response.json();
  if (!response.body) throw new Error("Empty CodeBuddy image stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  const parts = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.length + fullText.length > MAX_STREAM_CHARS) throw new Error("CodeBuddy image response too large");
      // Handles both LF and CRLF frames, including partial chunks.
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        if (!data || data === "[DONE]") continue;
        let event;
        try { event = JSON.parse(data); } catch { continue; }
        if (event.error) throw new Error(event.error.message || "CodeBuddy image stream failed");
        for (const choice of event.choices || []) {
          const delta = choice.delta || choice.message || {};
          if (typeof delta.content === "string") fullText += delta.content;
          else if (delta.content) parts.push(delta.content);
        }
        if (event.data || event.output || event.image) parts.push(event);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return { content: fullText, parts };
}

export default {
  useExecutor: true,
  async executeViaExecutor(model, body, credentials, log) {
    const executor = getExecutor("codebuddy");
    if (!executor) throw new Error("CodeBuddy executor not found");
    const content = [{ type: "text", text: body.prompt }];
    // Image editing is account/model-dependent; pass references as input images.
    const refs = Array.isArray(body.images) && body.images.length ? body.images : body.image ? [body.image] : [];
    for (const ref of refs) {
      if (typeof ref === "string") content.push({ type: "image_url", image_url: { url: ref } });
    }
    const { response } = await executor.execute({
      model,
      body: { messages: [{ role: "user", content }] },
      stream: true,
      credentials,
      log,
    });
    if (!response.ok) throw new Error(`CodeBuddy image request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    return decodeResponse(response);
  },
  normalize: (result) => {
    const images = [];
    const seen = new Set();
    collectImages(result, images, seen);
    return {
      created: nowSec(),
      data: images,
      ...(images.length ? {} : { error: { message: "CodeBuddy did not return an image; this account/model may not support image generation." } }),
    };
  },
};
