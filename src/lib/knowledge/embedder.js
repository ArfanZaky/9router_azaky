/**
 * Embed text chunks via internal 9Router /api/v1/embeddings endpoint.
 * Batches input to avoid token limits.
 */

const BATCH_SIZE = 20; // max texts per embedding call

/**
 * @param {string[]} texts - array of text strings to embed
 * @param {string} model - embedding model ID (e.g. "text-embedding-3-small")
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
      const err = await res.text().catch(() => "");
      throw new Error(`Embedding failed (${res.status}): ${err.slice(0, 200)}`);
    }

    const data = await res.json();
    if (!data?.data?.length) {
      throw new Error("Embedding returned no data");
    }

    // Sort by index to maintain order
    const sorted = data.data.sort((a, b) => a.index - b.index);
    for (const item of sorted) {
      allEmbeddings.push(item.embedding);
    }
  }

  return allEmbeddings;
}

function getBaseUrl() {
  // In Next.js server context
  const port = process.env.PORT || 3000;
  return `http://localhost:${port}`;
}
