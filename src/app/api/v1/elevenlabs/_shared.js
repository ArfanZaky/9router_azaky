// Public, API-key authenticated surface of ElevenLabs Studio (/dashboard/elevenlabs).
// Served at /v1/elevenlabs/* (next.config rewrite → /api/v1/elevenlabs/*).
//
// Auth layers:
//  1. dashboardGuard: /api/v1/* from a non-local client needs a valid 9Router API key.
//  2. guardElevenApi: honours settings.requireApiKey for local clients too.
//  3. A restricted key must list the "elevenlabs" provider in its allow list.
import { extractApiKey, isValidApiKey } from "@/sse/services/auth.js";
import { getKeyAccessContext, enforceKeyAccessProvider } from "@/sse/services/keyAccess.js";
import { getSettings } from "@/lib/localDb";
import { ElevenRequestError, PROVIDER_ID } from "@/lib/elevenlabs/service";

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...extraHeaders },
  });
}

/** OpenAI-style error body: { error: { message, code } }. */
export function apiError(status, message, code = null, extra = {}) {
  return json({ error: { message: String(message).slice(0, 1000), code, ...extra } }, status);
}

export function errorFromThrown(error) {
  if (error instanceof ElevenRequestError) {
    return apiError(error.status, error.message, error.code || null, error.job ? { job_id: error.job.id } : {});
  }
  return apiError(500, error?.message || String(error));
}

export function preflight(methods) {
  return new Response(null, {
    headers: { ...CORS_HEADERS, "Access-Control-Allow-Methods": `${methods}, OPTIONS` },
  });
}

/** @returns {Promise<Response|null>} an error Response, or null when the caller may proceed. */
export async function guardElevenApi(request) {
  const settings = await getSettings();
  if (settings.requireApiKey) {
    const apiKey = extractApiKey(request);
    if (!apiKey) return apiError(401, "Missing API key", "missing_api_key");
    if (!(await isValidApiKey(apiKey))) return apiError(401, "Invalid API key", "invalid_api_key");
  }
  const ctx = await getKeyAccessContext(request);
  const denied = await enforceKeyAccessProvider(ctx, PROVIDER_ID, null);
  if (denied) return denied;
  return null;
}

/** Absolute URL of a job's audio under the same origin the client used. */
export function audioUrl(request, jobId) {
  return new URL(`/v1/elevenlabs/audio/${encodeURIComponent(jobId)}`, request.url).toString();
}

export function withAudioUrl(request, job) {
  if (!job) return job;
  return { ...job, audioUrl: job.hasAudio ? audioUrl(request, job.id) : null };
}
