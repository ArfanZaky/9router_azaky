// Google Gemini embeddings — embedContent / batchEmbedContents
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function modelPath(model) {
  // Strip provider prefix if present (e.g. "gemini/text-embedding-004" -> "text-embedding-004")
  const clean = model.includes("/") ? model.split("/").pop() : model;
  return clean.startsWith("models/") ? clean : `models/${clean}`;
}

export default {
  buildUrl: (model, creds, { input } = {}) => {
    const apiKey = creds?.apiKey;
    const path = modelPath(model);
    const op = Array.isArray(input) ? "batchEmbedContents" : "embedContent";
    if (apiKey) {
      return `${BASE}/${path}:${op}?key=${encodeURIComponent(apiKey)}`;
    }
    return `${BASE}/${path}:${op}`;
  },
  buildHeaders: (creds) => {
    const headers = { "Content-Type": "application/json" };
    if (creds?.accessToken && !creds?.apiKey) {
      headers.Authorization = `Bearer ${creds.accessToken}`;
    }
    return headers;
  },
  buildBody: (model, { input, dimensions }) => {
    const m = modelPath(model);
    const outputDimensionality = Number(dimensions);
    const hasOutputDimensionality = Number.isFinite(outputDimensionality) && outputDimensionality > 0;
    if (Array.isArray(input)) {
      return {
        requests: input.map((text) => ({
          model: m,
          content: { parts: [{ text: String(text) }] },
          ...(hasOutputDimensionality ? { outputDimensionality } : {}),
        })),
      };
    }
    return {
      model: m,
      content: { parts: [{ text: String(input) }] },
      ...(hasOutputDimensionality ? { outputDimensionality } : {}),
    };
  },
  normalize: (responseBody, model) => {
    if (responseBody.object === "list" && Array.isArray(responseBody.data)) return responseBody;
    let items = [];
    if (Array.isArray(responseBody.embeddings)) {
      items = responseBody.embeddings.map((emb, idx) => ({
        object: "embedding",
        index: idx,
        embedding: emb.values || [],
      }));
    } else if (responseBody.embedding?.values) {
      items = [{ object: "embedding", index: 0, embedding: responseBody.embedding.values }];
    }
    return {
      object: "list",
      data: items,
      model,
      usage: { prompt_tokens: 0, total_tokens: 0 },
    };
  },
};
