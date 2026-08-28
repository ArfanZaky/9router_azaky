/**
 * Embed text chunks via internal 9Router /api/v1/embeddings endpoint.
 * Batches input to avoid token limits.
 */

const BATCH_SIZE = 20; // max texts per embedding call

function formatError(data, status, rawText) {
  if (data?.error) {
    if (typeof data.error === "string") return data.error;
    if (typeof data.error?.message === "string") return data.error.message;
    try {
      return JSON.stringify(data.error);
    } catch {
      return String(data.error);
    }
  }
  if (data?.message && typeof data.message === "string") return data.message;
  if (rawText && rawText.trim()) return rawText.slice(0, 200);
  return `HTTP ${status}`;
}

/**
 * @param {string[]} texts - array of text strings to embed
 * @param {string} model - embedding model ID (e.g. "text-embedding-3-small", "gemini-embedding-001")
 * @param {string} [baseUrl] - internal base URL, defaults to process env
 * @returns {Promise<number[][]>} array of embedding vectors
 */
export async function embedTexts(texts, model, baseUrl) {
  if (!texts.length) return [];

  const url = `${baseUrl || getBaseUrl()}/api/v1/embeddings`;
  const allEmbeddings = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: batch,
        encoding_format: "float",
      }),
    });

    if (!res.ok) {
      let errText = "";
      let errData = null;
      try {
        errData = await res.json();
      } catch {
        errText = await res.text().catch(() => "");
      }
      const msg = formatError(errData, res.status, errText);
      throw new Error(`Embedding model '${model}' failed: ${msg}`);
    }

    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Embedding returned invalid JSON from model '${model}'`);
    }

    if (!data?.data?.length) {
      throw new Error(`Embedding model '${model}' returned no vector data`);
    }

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
        throw new Error(`Embedding vector missing in response from '${model}'`);
      }
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

function getBaseUrl() {
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}
