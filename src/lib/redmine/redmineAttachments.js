function isImageFile(filename = "", contentType = "") {
  if (typeof contentType === "string" && contentType.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(String(filename || ""));
}

export async function fetchRedmineImageAttachments(issue, config, { maxImages = 8, maxBytes = 8 * 1024 * 1024 } = {}) {
  if (!issue || !config?.apiKey) return [];

  const candidateMap = new Map();

  // 1. From issue.attachments
  if (Array.isArray(issue.attachments)) {
    for (const a of issue.attachments) {
      if (a?.id && a?.filename) {
        candidateMap.set(String(a.id), {
          id: String(a.id),
          filename: a.filename,
          content_type: a.content_type || "",
          filesize: a.filesize || 0,
          content_url: a.content_url || `${config.baseUrl}/attachments/download/${a.id}/${encodeURIComponent(a.filename)}`,
        });
      }
    }
  }

  // 2. From issue.journals details
  if (Array.isArray(issue.journals)) {
    for (const j of issue.journals) {
      if (Array.isArray(j.details)) {
        for (const d of j.details) {
          if (d?.property === "attachment" && d.name && d.new_value) {
            const attId = String(d.name);
            if (!candidateMap.has(attId)) {
              candidateMap.set(attId, {
                id: attId,
                filename: d.new_value,
                content_type: "",
                filesize: 0,
                content_url: `${config.baseUrl}/attachments/download/${attId}/${encodeURIComponent(d.new_value)}`,
              });
            }
          }
        }
      }
    }
  }

  const imageCandidates = [...candidateMap.values()].filter((item) =>
    isImageFile(item.filename, item.content_type)
  );

  const selected = imageCandidates.slice(0, maxImages);

  const results = await Promise.allSettled(
    selected.map(async (att) => {
      const fetchUrl = att.content_url || `${config.baseUrl}/attachments/download/${att.id}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(fetchUrl, {
          headers: {
            "X-Redmine-API-Key": config.apiKey,
          },
          signal: controller.signal,
        });
        if (!res.ok) return null;
        const contentType = res.headers.get("content-type") || att.content_type || "image/png";
        const buffer = Buffer.from(await res.arrayBuffer());
        if (buffer.length === 0 || buffer.length > maxBytes) return null;
        const dataUrl = `data:${contentType};base64,${buffer.toString("base64")}`;
        return {
          id: `redmine_att_${att.id}`,
          name: att.filename,
          type: contentType,
          size: buffer.length,
          dataUrl,
        };
      } catch {
        return null;
      } finally {
        clearTimeout(timeout);
      }
    })
  );

  return results
    .filter((r) => r.status === "fulfilled" && r.value)
    .map((r) => r.value);
}
