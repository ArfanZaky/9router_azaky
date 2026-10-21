/**
 * Unit tests for the CodeBuddy (Seedance 2.5) video adapter.
 *
 * The adapter exists because CodeBuddy does not speak the xAI /v1/videos shape:
 *   create → POST /v2/videos/generations  → { code, msg, requestId, data:{ id, status } }
 *   poll   → GET  /v2/videos/tasks/{data.id}   (the envelope requestId 404s)
 *   done   → data.data[].url  (signed COS .mp4)
 *
 * Every fixture below was captured verbatim from the live API, so a change in
 * the upstream envelope shows up here rather than in production.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("open-sse/services/tokenRefresh.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, refreshTokenByProvider: vi.fn() };
});

import { handleVideoProxyCore, getVideoConfig } from "open-sse/handlers/videoCore.js";
import { getVideoAdapter } from "open-sse/handlers/videoProviders/index.js";
import { PROVIDER_MEDIA, PROVIDER_MODELS } from "open-sse/providers/index.js";

const originalFetch = global.fetch;
const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Captured from the live API.
const JOB = "2600029973-AigcVideo-d601cda609264180a90d6432a2a9ad64";
const ENVELOPE_REQUEST_ID = "9b9814d5-0513-4d7a-90da-d08ea7f7634a";

const QUEUED = {
  code: 0,
  msg: "OK",
  requestId: ENVELOPE_REQUEST_ID,
  data: { id: JOB, status: "queued", created_at: 1792138010 },
};

const IN_PROGRESS = {
  code: 0,
  msg: "OK",
  requestId: "7d8635e5-092a-478d-91f6-cf65f26f78ca",
  data: { id: JOB, status: "in_progress", created_at: 1792138133 },
};

const COMPLETED = {
  code: 0,
  msg: "OK",
  requestId: "a49e6428-0c67-4ec2-af5c-2a4f74656fab",
  data: {
    id: JOB,
    status: "completed",
    created_at: 1792138133,
    completed_at: 1792138331,
    data: [
      {
        url: "https://aigc-output-video-1326893053.cos.ap-guangzhou.myqcloud.com/1457276451/" + JOB + "_0.mp4?q-sign-algorithm=sha1&q-signature=e72d86",
        resolution: "1280x720",
      },
    ],
    usage: { output_video_tokens: 216900, credit: 208.01 },
    size: "1280x720",
  },
};

const CREDITS_EXHAUSTED = {
  error: {
    data: {
      code: 14018,
      msg: "Credits exhausted. Please visit the link below to purchase add-on packs and get more credits: https://www.codebuddy.ai/profile/usage",
      requestId: "777b0a1f-9e6d-4794-bc86-981928b20f81",
    },
  },
};

describe("codebuddy video registration", () => {
  it("is wired into the registry as a video provider", () => {
    expect(getVideoConfig("codebuddy").baseUrl).toBe("https://www.codebuddy.ai/v2/videos");
    expect(PROVIDER_MEDIA.codebuddy.serviceKinds).toContain("video");
    // PROVIDER_MODELS is keyed by alias ("cb"), PROVIDER_MEDIA by provider id.
    expect(PROVIDER_MODELS.cb.find((m) => m.id === "seedance-2.5")?.kind).toBe("video");
  });

  it("exposes an adapter (the default xAI passthrough would break polling)", () => {
    expect(getVideoAdapter("codebuddy")).toBeTruthy();
    expect(getVideoAdapter("xai")).toBeNull();
  });
});

describe("codebuddy video adapter", () => {
  it("POSTs creation to /v2/videos/generations with the CLI envelope", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse(QUEUED));

    const raw = '{"model":"seedance-2.5","prompt":"a neon city at night"}';
    const result = await handleVideoProxyCore({
      provider: "codebuddy",
      action: "generations",
      rawBody: raw,
      contentType: "application/json",
      credentials: { accessToken: "cb-token" },
    });

    expect(result.success).toBe(true);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://www.codebuddy.ai/v2/videos/generations");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(raw); // forwarded verbatim
    expect(init.headers.Authorization).toBe("Bearer cb-token");
    expect(init.headers["User-Agent"]).toContain("CodeBuddy");
    expect(init.headers["X-App"]).toBe("cli");

    const body = await result.response.json();
    expect(body.id).toBe(JOB);
    expect(body.request_id).toBe(JOB);
    expect(body.status).toBe("pending");
    expect(body.upstream_request_id).toBe(ENVELOPE_REQUEST_ID);

    global.fetch = originalFetch;
  });

  it("polls GET /v2/videos/tasks/{job id}, not the envelope requestId", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse(IN_PROGRESS));

    const result = await handleVideoProxyCore({
      provider: "codebuddy",
      requestId: JOB,
      credentials: { accessToken: "cb-token" },
    });

    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe("https://www.codebuddy.ai/v2/videos/tasks/" + JOB);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();

    const body = await result.response.json();
    expect(body.status).toBe("pending");
    expect(body.id).toBe(JOB);
    expect(body.video).toBeUndefined();

    global.fetch = originalFetch;
  });

  it("builds the poll plan under /tasks/ and url-encodes the id", () => {
    const adapter = getVideoAdapter("codebuddy");
    const plan = adapter.buildRequest({
      config: getVideoConfig("codebuddy"),
      requestId: "a/b?c",
      token: "t",
    });
    expect(plan.method).toBe("GET");
    expect(plan.url).toBe("https://www.codebuddy.ai/v2/videos/tasks/a%2Fb%3Fc");
  });

  it("maps a completed job onto the async-job shape with the video URL", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse(COMPLETED));

    const result = await handleVideoProxyCore({
      provider: "codebuddy",
      requestId: JOB,
      credentials: { accessToken: "cb-token" },
    });

    const body = await result.response.json();
    expect(body.status).toBe("completed");
    expect(body.id).toBe(JOB);
    expect(body.video.url).toContain(JOB + "_0.mp4");
    expect(body.video.mime_type).toBe("video/mp4");
    expect(body.videos).toHaveLength(1);
    // The signed CDN URL is passed through intact (query signature preserved).
    expect(body.video.url).toContain("q-signature=e72d86");

    global.fetch = originalFetch;
  });

  it("surfaces a credits-exhausted upstream error", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse(CREDITS_EXHAUSTED, 429));

    const result = await handleVideoProxyCore({
      provider: "codebuddy",
      action: "generations",
      rawBody: '{"model":"seedance-2.5","prompt":"x"}',
      contentType: "application/json",
      credentials: { accessToken: "cb-token" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
    const body = await result.response.json();
    expect(JSON.stringify(body)).toContain("Credits exhausted");

    global.fetch = originalFetch;
  });

  it("never reports completed without a video URL", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      jsonResponse({ code: 0, msg: "OK", requestId: "r", data: { id: JOB, status: "completed" } })
    );

    const result = await handleVideoProxyCore({
      provider: "codebuddy",
      requestId: JOB,
      credentials: { accessToken: "cb-token" },
    });

    const body = await result.response.json();
    expect(body.status).toBe("failed");
    expect(body.error.message).toContain("without a video URL");

    global.fetch = originalFetch;
  });

  it("rejects unsupported actions before any upstream call (no billable job)", async () => {
    global.fetch = vi.fn();

    const result = await handleVideoProxyCore({
      provider: "codebuddy",
      action: "edits",
      rawBody: "{}",
      contentType: "application/json",
      credentials: { accessToken: "cb-token" },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = originalFetch;
  });

  it("rejects a multipart body before any upstream call", async () => {
    global.fetch = vi.fn();

    const result = await handleVideoProxyCore({
      provider: "codebuddy",
      action: "generations",
      rawBody: Buffer.from("--boundary--"),
      contentType: "multipart/form-data; boundary=boundary",
      credentials: { accessToken: "cb-token" },
    });

    expect(result.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();

    global.fetch = originalFetch;
  });
});
