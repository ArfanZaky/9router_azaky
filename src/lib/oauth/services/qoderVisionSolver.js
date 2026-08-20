/**
 * Qoder TMD vision solver — calls a vision-capable LLM (via the 9router
 * engine) to decide which image-matching captcha grid cells to click.
 *
 * The punish page is Alibaba's "select all images that match the description"
 * click captcha. We send the question + grid images to a vision model (user
 * selects which provider/model in the UI), get back the grid indices to click.
 *
 * Uses handleChatCore directly (same engine as the dashboard chat) so the
 * chosen provider's auth/translation is reused — no self-HTTP round trip.
 */

async function loadChatCore() {
  return import("open-sse/handlers/chatCore.js");
}

/**
 * Resolve the first active connection for a provider id.
 */
export async function resolveVisionConnection(providerId) {
  const { getProviderConnections } = await import("../../db/repos/connectionsRepo.js");
  const conns = await getProviderConnections({ provider: providerId, isActive: true });
  return conns?.[0] || null;
}

/**
 * Ask a vision LLM which grid cells match the captcha question.
 *
 * @param {object} options
 * @param {Array<{index:number,dataUrl?:string}>} options.grids   grid cells (index + optional dataUrl)
 * @param {string} [options.questionDataUrl]                      question image dataUrl (optional)
 * @param {string} options.promptText                             description text if available
 * @param {string} options.provider                               provider id
 * @param {string} options.model                                  model id
 * @param {object} options.connection                             connection object (fallback: resolve by provider)
 * @param {Function} [options.log]
 * @returns {Promise<number[]>} indices to click
 */
export async function visionSolveCaptchaGrid({
  grids,
  questionDataUrl = "",
  promptText = "select all images that match the description",
  provider,
  model,
  connection = null,
  log = null,
}) {
  if (!provider || !model) {
    throw new Error("visionSolveCaptchaGrid: provider and model are required");
  }
  const conn = connection || await resolveVisionConnection(provider);
  if (!conn) {
    throw new Error(`visionSolveCaptchaGrid: no active connection for provider "${provider}"`);
  }

  // Build image content blocks. Prefer per-cell data URLs so the model can map
  // indices exactly; fall back to a single container image if unavailable.
  const content = [];
  if (promptText) content.push({ type: "text", text: promptText });
  if (questionDataUrl) content.push({ type: "image_url", image_url: { url: questionDataUrl } });

  const gridImages = (grids || []).filter((g) => g?.dataUrl);
  for (const g of gridImages) {
    content.push({
      type: "text",
      text: `Grid cell index ${g.index}:`,
    });
    content.push({ type: "image_url", image_url: { url: g.dataUrl } });
  }
  if (!gridImages.length) {
    throw new Error("visionSolveCaptchaGrid: no grid images available to send");
  }

  const prompt = [
    ...content,
    { type: "text", text: "Answer ONLY with the numeric indices of the grid cells that match the description, comma-separated. Example: 0,4,7. No explanation." },
  ];

  const { handleChatCore } = await loadChatCore();
  const body = {
    model: `${provider}/${model}`,
    messages: [{ role: "user", content: prompt }],
    stream: false,
    max_tokens: 128,
  };

  const result = await handleChatCore({
    body,
    modelInfo: { provider, model },
    credentials: conn,
    log: log || { debug() {}, info() {}, warn() {}, error() {} },
  });

  const text = extractText(result);
  return parseGridIndices(text);
}

function extractText(result) {
  try {
    if (result?.response) {
      // Non-streaming path may return a Response-like object
      const contentType = result.response.headers?.get?.("content-type") || "";
      if (contentType.includes("json")) return "";
      return "";
    }
    if (result?.choices?.[0]?.message?.content) {
      return result.choices[0].message.content;
    }
  } catch {}
  return "";
}

/**
 * Parse "0, 4, 7" or "[0,4,7]" or "cells 0,4,7" into indices 0..8.
 */
export function parseGridIndices(text) {
  const s = String(text || "");
  const nums = s.match(/(?<![\d-])[0-8](?![0-9])/g) || [];
  const out = [];
  for (const n of nums) {
    const v = Number.parseInt(n, 10);
    if (Number.isFinite(v) && v >= 0 && v <= 8 && !out.includes(v)) out.push(v);
  }
  return out;
}

export const __test__ = {
  parseGridIndices,
};
