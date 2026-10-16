// CodeBuddy Global video jobs (Seedance 2.5).
//
// CodeBuddy does NOT speak the xAI /v1/videos shape. Verified against the live
// API:
//
//   create → POST https://www.codebuddy.ai/v2/videos/generations
//            body { model, prompt, duration?, aspect_ratio?, image? }
//            → { code:0, msg:"OK", requestId:"<uuid>",
//                data:{ id:"<jobId>", status:"queued", created_at:<ts> } }
//   poll   → GET  https://www.codebuddy.ai/v2/videos/tasks/<data.id>
//            → { code:0, msg:"OK", requestId:"<uuid>",
//                data:{ id:"<jobId>", status:"in_progress" | … } }
//
// Two things differ from the default xAI passthrough, so this adapter does both:
//   * the poll path is `/tasks/{id}` and must be driven by `data.id` (the job
//     id), NOT the envelope's `requestId` — polling the envelope id 404s;
//   * the provider-native envelope is translated onto the async-job shape the
//     rest of 9Router already consumes ({ id, status, video:{url} }), so a
//     client that only understands the xAI shape still works.

// CodeBuddy sends the CLI envelope expected by its chat gateway; video shares it.
const CLI_USER_AGENT = "CLI/2.105.2 CodeBuddy/2.105.2";

function headers(config, token) {
  return {
    Accept: "application/json",
    ...(config.headers || {}),
    "User-Agent": config.userAgent || CLI_USER_AGENT,
    "X-Product": "SaaS",
    "X-App": "cli",
    "X-IDE-Type": "CLI",
    "X-IDE-Name": "CLI",
    "X-IDE-Version": "2.105.2",
    "X-Domain": "www.codebuddy.ai",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Upstream job states → the status vocabulary 9Router clients already poll for.
function mapStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (["succeeded", "success", "completed", "complete", "done", "finished"].includes(s)) return "completed";
  if (["failed", "error", "cancelled", "canceled", "rejected"].includes(s)) return "failed";
  return "pending";
}

/**
 * Pull the finished video out of whatever shape CodeBuddy returns.
 * The terminal payload is not pinned down upstream yet, so this scans the
 * documented candidates and falls back to a shallow key search rather than
 * returning nothing when the field name shifts.
 */
function extractVideo(...nodes) {
  const seen = new Set();
  const queue = nodes.filter(Boolean);
  let depth = 0;

  while (queue.length && depth < 200) {
    depth += 1;
    const node = queue.shift();
    if (node == null || typeof node !== "object") continue;
    if (seen.has(node)) continue;
    seen.add(node);

    for (const [key, value] of Object.entries(node)) {
      if (typeof value === "string" && value) {
        const k = key.toLowerCase();
        const looksLikeVideo = /(^|_)(video|output|download|play|result)?_?(url|uri)$/.test(k) || k === "video_url" || k === "url";
        const isHttp = /^https?:\/\//i.test(value);
        const isDataVideo = /^data:video\//i.test(value);
        if (looksLikeVideo && (isHttp || isDataVideo)) {
          if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(value) || isDataVideo || /video/i.test(k)) {
            return { url: value, mime_type: isDataVideo ? "video/mp4" : "video/mp4" };
          }
        }
        // A bare *.mp4 link anywhere is still the render.
        if (isHttp && /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(value)) {
          return { url: value, mime_type: "video/mp4" };
        }
        continue;
      }
      if (value && typeof value === "object") queue.push(value);
    }
  }
  return null;
}

function firstError(payload) {
  if (!payload || typeof payload !== "object") return null;
  const candidates = [
    payload.error?.message,
    payload.error?.data?.msg,
    payload.error?.msg,
    payload.error_msg,
    typeof payload.error === "string" ? payload.error : null,
    typeof payload.msg === "string" && payload.code && payload.code !== 0 ? payload.msg : null,
  ];
  return candidates.find((m) => typeof m === "string" && m.length) || null;
}

export default {
  buildRequest({ config, action, requestId, rawBody, contentType, token }) {
    const base = (config.baseUrl || "https://www.codebuddy.ai/v2/videos").replace(/\/$/, "");

    if (requestId) {
      // Job-scoped: the poll route hangs off /tasks/ and takes the job id.
      return {
        method: "GET",
        url: `${base}/tasks/${encodeURIComponent(requestId)}`,
        headers: headers(config, token),
      };
    }

    // ponytail: generations only — CodeBuddy exposes no edits/extensions route today.
    if (action !== "generations") {
      return { error: `CodeBuddy video supports 'generations' only (got '${action}')` };
    }
    if (contentType && !contentType.includes("application/json")) {
      return { error: "CodeBuddy video requires an application/json body" };
    }

    return {
      method: "POST",
      url: `${base}/generations`,
      headers: { ...headers(config, token), "Content-Type": "application/json" },
      body: rawBody,
    };
  },

  transformResponse(json) {
    // Errors keep their upstream message (create path) rather than looking like an empty job.
    const error = firstError(json);
    if (error) {
      return {
        id: json?.data?.id || json?.requestId || null,
        status: "failed",
        error: { message: error, code: json?.error?.data?.code ?? json?.data?.code ?? json?.code ?? null },
      };
    }

    const job = json?.data || {};
    // The poll target is the job id; the envelope requestId only correlates logs.
    const id = job.id || json?.requestId || null;
    const status = mapStatus(job.status);

    const out = {
      id,
      request_id: id,
      // Kept for callers that read the raw envelope field.
      upstream_request_id: json?.requestId || null,
      status,
      created_at: job.created_at ?? null,
      model: job.model || json?.model || null,
    };

    if (status === "completed") {
      const video = extractVideo(job, json);
      if (video) {
        out.video = { ...video, duration: job.duration ?? null };
        out.videos = [out.video];
      } else {
        // Rendered but no URL we recognise — surface it instead of a silent empty success.
        out.status = "failed";
        out.error = { message: "CodeBuddy reported completion without a video URL" };
      }
    }

    if (status === "pending" && job.progress != null) out.progress = job.progress;
    return out;
  },
};
