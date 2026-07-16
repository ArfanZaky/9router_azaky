// Google Gemini adapter (Nano Banana models)
import { nowSec, parseDataUri } from "./_base.js";
import { PROVIDER_MEDIA } from "../../providers/index.js";

const BASE_URL = PROVIDER_MEDIA["gemini"]?.imageConfig?.baseUrl;

function toInlinePart(image) {
  if (!image || typeof image !== "string") return null;
  const parsed = parseDataUri(image);
  if (parsed) {
    return { inlineData: { mimeType: parsed.mime, data: parsed.b64 } };
  }
  // Public URL — Gemini generateContent expects inline/file data; skip unsupported URL-only
  if (/^https?:\/\//i.test(image)) {
    return null;
  }
  return null;
}

export default {
  buildUrl: (model, creds) => {
    const apiKey = creds?.apiKey || creds?.accessToken;
    const modelId = model.replace(/^models\//, "");
    return `${BASE_URL}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
  },
  buildHeaders: () => ({ "Content-Type": "application/json" }),
  buildBody: (_model, body) => {
    const parts = [];
    const refs = [];
    if (Array.isArray(body.images)) refs.push(...body.images.filter(Boolean));
    if (body.image) refs.unshift(body.image);
    for (const ref of refs) {
      const part = toInlinePart(ref);
      if (part) parts.push(part);
    }
    parts.push({ text: body.prompt });
    return {
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    };
  },
  normalize: (responseBody, prompt) => {
    const parts = responseBody.candidates?.[0]?.content?.parts || [];
    const images = parts.filter((p) => p.inlineData?.data).map((p) => ({ b64_json: p.inlineData.data }));
    return {
      created: nowSec(),
      data: images.length > 0 ? images : [{ b64_json: "", revised_prompt: prompt }],
    };
  },
};
