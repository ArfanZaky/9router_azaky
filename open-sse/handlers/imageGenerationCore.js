import { createErrorResult, parseUpstreamError, formatProviderError } from "../utils/error.js";
import { HTTP_STATUS } from "../config/runtimeConfig.js";
import { refreshWithRetry } from "../services/tokenRefresh.js";
import { getExecutor } from "../executors/index.js";
import { getImageAdapter } from "./imageProviders/index.js";
import { urlToBase64, normalizeReferenceImage } from "./imageProviders/_base.js";

async function normalizeBodyImages(body) {
  if (!body || typeof body !== "object") return body;
  // forceDataUri: providers (Gemini/xAI/etc.) can't always fetch arbitrary URLs; data URI is portable
  const opts = { forceDataUri: true };
  const next = { ...body };
  if (next.image) {
    next.image = await normalizeReferenceImage(next.image, opts);
  }
  if (Array.isArray(next.images)) {
    next.images = await Promise.all(
      next.images.map((img) => normalizeReferenceImage(img, opts).then((v) => v || img))
    );
  }
  if (next.mask_image) next.mask_image = await normalizeReferenceImage(next.mask_image, opts);
  if (next.maskImage) next.maskImage = await normalizeReferenceImage(next.maskImage, opts);
  if (next.mask) next.mask = await normalizeReferenceImage(next.mask, opts);
  return next;
}

function serializeRequestBody(requestBody) {
  if (typeof FormData !== "undefined" && requestBody instanceof FormData) return requestBody;
  if (typeof requestBody === "string") return requestBody;
  return JSON.stringify(requestBody);
}

/**
 * Core image generation handler — orchestrator only.
 * Provider-specific URL/headers/body/parse/normalize live in `./imageProviders/{id}.js`.
 *
 * @param {object} options
 * @param {object} options.body - Request body { model, prompt, n, size, ... }
 * @param {object} options.modelInfo - { provider, model }
 * @param {object} options.credentials - Provider credentials
 * @param {object} [options.log] - Logger
 * @param {boolean} [options.streamToClient] - Pipe SSE to client (codex)
 * @param {boolean} [options.binaryOutput] - Return raw image bytes
 * @param {function} [options.onCredentialsRefreshed]
 * @param {function} [options.onRequestSuccess]
 * @returns {Promise<{ success: boolean, response: Response, status?: number, error?: string }>}
 */
export async function handleImageGenerationCore({
  body,
  modelInfo,
  credentials,
  log,
  streamToClient = false,
  binaryOutput = false,
  onCredentialsRefreshed,
  onRequestSuccess,
}) {
  const { provider, model } = modelInfo;

  if (!body.prompt) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, "Missing required field: prompt");
  }

  // Resolve local/gallery refs to data URIs so upstream providers can read them
  try {
    body = await normalizeBodyImages(body);
  } catch (e) {
    log?.warn?.("IMAGE", `Reference image normalize failed: ${e?.message || e}`);
  }

  const adapter = getImageAdapter(provider);
  if (!adapter) {
    return createErrorResult(
      HTTP_STATUS.BAD_REQUEST,
      `Provider '${provider}' does not support image generation`
    );
  }

  const hasRef = !!(body.image || (Array.isArray(body.images) && body.images.length));

  // Executor-delegating adapters: skip manual URL/headers/body, use the proven executor flow
  if (adapter.useExecutor && adapter.executeViaExecutor) {
    try {
      log?.debug?.("IMAGE", `${provider.toUpperCase()} | ${model} | prompt="${body.prompt.slice(0, 50)}..." ref=${hasRef} (executor)`);
      const responseBody = await adapter.executeViaExecutor(model, body, credentials, log);
      if (onRequestSuccess) await onRequestSuccess();
      const normalized = adapter.normalize(responseBody, body.prompt);
      const finalBody = (normalized.created && Array.isArray(normalized.data)) ? normalized : responseBody;

      if (binaryOutput) {
        const first = finalBody.data?.[0];
        let b64 = first?.b64_json;
        if (!b64 && first?.url) {
          try { b64 = await urlToBase64(first.url); } catch {}
        }
        if (b64) {
          const buf = Buffer.from(b64, "base64");
          const fmt = (body.output_format || "png").toLowerCase();
          const mime = fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png";
          return {
            success: true,
            response: new Response(buf, {
              headers: { "Content-Type": mime, "Content-Disposition": `inline; filename="image.${fmt === "jpeg" ? "jpg" : fmt}"`, "Access-Control-Allow-Origin": "*" },
            }),
          };
        }
      }

      return {
        success: true,
        response: new Response(JSON.stringify(finalBody), {
          headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
        }),
      };
    } catch (error) {
      const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
      log?.debug?.("IMAGE", `Executor error: ${errMsg}`);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
    }
  }

  let url;
  let headers;
  let requestBody;

  try {
    // Pass body so adapters can switch endpoint (e.g. xAI generations → edits when image present)
    url = adapter.buildUrl(model, credentials, body);
    requestBody = await adapter.buildBody(model, body, credentials);
    headers = adapter.buildHeaders(credentials, requestBody, model, body);
  } catch (error) {
    return createErrorResult(HTTP_STATUS.BAD_REQUEST, error.message || `Invalid ${provider} image request`);
  }

  log?.debug?.("IMAGE", `${provider.toUpperCase()} | ${model} | prompt="${body.prompt.slice(0, 50)}..." ref=${hasRef}`);

  let providerResponse;
  try {
    providerResponse = await fetch(url, {
      method: "POST",
      headers,
      body: serializeRequestBody(requestBody),
    });
  } catch (error) {
    const errMsg = formatProviderError(error, provider, model, HTTP_STATUS.BAD_GATEWAY);
    log?.debug?.("IMAGE", `Fetch error: ${errMsg}`);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, errMsg);
  }

  // Handle 401/403 — try token refresh (skipped for noAuth providers)
  const executor = getExecutor(provider);
  if (
    !executor?.noAuth &&
    !adapter.noAuth &&
    (providerResponse.status === HTTP_STATUS.UNAUTHORIZED ||
      providerResponse.status === HTTP_STATUS.FORBIDDEN)
  ) {
    const newCredentials = await refreshWithRetry(
      () => executor.refreshCredentials(credentials, log),
      3,
      log
    );

    if (newCredentials?.accessToken || newCredentials?.apiKey) {
      log?.info?.("TOKEN", `${provider.toUpperCase()} | refreshed for image generation`);
      Object.assign(credentials, newCredentials);
      if (onCredentialsRefreshed) await onCredentialsRefreshed(newCredentials);

      try {
        const retryBody = await adapter.buildBody(model, body);
        const retryHeaders = adapter.buildHeaders(credentials, retryBody, model, body);
        const retryUrl = adapter.buildUrl(model, credentials);
        providerResponse = await fetch(retryUrl, {
          method: "POST",
          headers: retryHeaders,
          body: serializeRequestBody(retryBody),
        });
      } catch {
        log?.warn?.("TOKEN", `${provider.toUpperCase()} | retry after refresh failed`);
      }
    } else {
      log?.warn?.("TOKEN", `${provider.toUpperCase()} | refresh failed`);
    }
  }

  if (!providerResponse.ok) {
    const { statusCode, message } = await parseUpstreamError(providerResponse);
    const errMsg = formatProviderError(new Error(message), provider, model, statusCode);
    log?.debug?.("IMAGE", `Provider error: ${errMsg}`);
    return createErrorResult(statusCode, errMsg);
  }

  // Parse provider response — adapter may override (codex SSE / async polling / binary)
  let parsed;
  try {
    if (adapter.parseResponse) {
      parsed = await adapter.parseResponse(providerResponse, {
        headers,
        log,
        streamToClient,
        onRequestSuccess,
        url,
        requestBody,
        model,
        body,
      });
      // Codex streaming case: returns an SSE Response directly
      if (parsed?.sseResponse) {
        return { success: true, response: parsed.sseResponse };
      }
    } else {
      parsed = await providerResponse.json();
    }
  } catch (parseError) {
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, parseError.message || `Invalid response from ${provider}`);
  }

  if (onRequestSuccess) await onRequestSuccess();

  // Normalize → OpenAI-compatible shape
  const normalized = adapter.normalize(parsed, body.prompt);

  // Already in OpenAI shape? skip re-normalize
  const finalBody = (normalized.created && Array.isArray(normalized.data)) ? normalized : parsed;

  // Binary output: decode first b64_json (or fetch url) into raw bytes
  if (binaryOutput) {
    const first = finalBody.data?.[0];
    let b64 = first?.b64_json;
    if (!b64 && first?.url) {
      try { b64 = await urlToBase64(first.url); } catch {}
    }
    if (b64) {
      const buf = Buffer.from(b64, "base64");
      const fmt = (body.output_format || "png").toLowerCase();
      const mime = fmt === "jpeg" || fmt === "jpg" ? "image/jpeg" : fmt === "webp" ? "image/webp" : "image/png";
      return {
        success: true,
        response: new Response(buf, {
          headers: {
            "Content-Type": mime,
            "Content-Disposition": `inline; filename="image.${fmt === "jpeg" ? "jpg" : fmt}"`,
            "Access-Control-Allow-Origin": "*",
          },
        }),
      };
    }
  }

  return {
    success: true,
    response: new Response(JSON.stringify(finalBody), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }),
  };
}
