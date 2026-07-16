// OpenAI-compatible adapter (used by openai, minimax, openrouter, recraft, xai, …)
import { PROVIDER_MEDIA } from "../../providers/index.js";

const imageCfg = (id) => PROVIDER_MEDIA[id]?.imageConfig || {};
const imageUrl = (id) => imageCfg(id).baseUrl;

function toEditsUrl(generationsUrl) {
  if (!generationsUrl) return generationsUrl;
  return String(generationsUrl).replace(/\/images\/generations\/?$/i, "/images/edits");
}

/** Coerce ref image to string URL / data URI (xAI rejects map objects). */
function asImageString(image) {
  if (!image) return null;
  if (typeof image === "string") return image;
  if (typeof image === "object") {
    if (typeof image.url === "string") return image.url;
    if (typeof image.image_url === "string") return image.image_url;
    if (typeof image.image_url?.url === "string") return image.image_url.url;
  }
  return null;
}

export default function createOpenAIAdapter(providerId) {
  const cfg = imageCfg(providerId);
  return {
    buildUrl: (_model, _creds, body) => {
      const base = imageUrl(providerId);
      // xAI + OpenAI-style edit: reference image must hit /images/edits
      if (body?.image || (Array.isArray(body?.images) && body.images.length)) {
        if (providerId === "xai" || cfg.editUrl || /\/images\/generations/i.test(base || "")) {
          return cfg.editUrl || toEditsUrl(base) || base;
        }
      }
      return base;
    },
    buildHeaders: (creds) => {
      const headers = { "Content-Type": "application/json", ...(cfg.headers || {}) };
      const key = creds?.apiKey || creds?.accessToken;
      if (key) headers["Authorization"] = `Bearer ${key}`;
      return headers;
    },
    buildBody: (model, body) => {
      const {
        prompt,
        n = 1,
        size = "1024x1024",
        quality,
        style,
        response_format,
        image,
        images,
      } = body;

      const full = { model, prompt, n, size };
      if (quality) full.quality = quality;
      if (style) full.style = style;
      if (response_format) full.response_format = response_format;

      // Collect ref images as strings only (data URI or public URL)
      const list = [];
      const pushUnique = (img) => {
        const s = asImageString(img);
        if (s && !list.includes(s)) list.push(s);
      };
      if (image) pushUnique(image);
      if (Array.isArray(images)) images.forEach(pushUnique);

      if (providerId === "xai") {
        // xAI /v1/images/edits:
        //  - single: { url, type: "image_url" }  (struct ImageUrl — string rejected)
        //  - multi:  array of URL strings       (maps rejected as image[0])
        if (list.length === 1) {
          full.image = { url: list[0], type: "image_url" };
        } else if (list.length > 1) {
          full.image = list.slice(0, 3); // max 3 refs per xAI docs
        }
      } else if (list.length) {
        full.image = list[0];
        if (list.length > 1) full.images = list;
      }

      // bodyFields whitelist (e.g. xAI) — always allow image when present
      if (Array.isArray(cfg.bodyFields)) {
        const fields = new Set(cfg.bodyFields);
        if (full.image) fields.add("image");
        if (full.images) fields.add("images");
        const req = {};
        for (const f of fields) if (full[f] !== undefined) req[f] = full[f];
        return req;
      }
      return full;
    },
    normalize: (responseBody) => responseBody,
  };
}
