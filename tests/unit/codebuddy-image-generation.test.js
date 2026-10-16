import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: (...args) => globalThis.fetch(...args) }));
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";
import { getImageAdapter } from "../../open-sse/handlers/imageProviders/index.js";
import { getModelsByProviderId } from "../../open-sse/config/providerModels.js";
import { PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });

const credentials = { accessToken: "fake-token", providerSpecificData: { domain: "www.codebuddy.ai" } };
const modelInfo = { provider: "codebuddy", model: "gpt-image-2" };
const body = { prompt: "cat on a chair" };

function streamResponse(content) {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`, {
    status: 200, headers: { "content-type": "text/event-stream" },
  });
}

describe("CodeBuddy Global image generation", () => {
  it("registers image models and adapter", () => {
    expect(PROVIDER_MEDIA.codebuddy.serviceKinds).toContain("image");
    expect(getModelsByProviderId("codebuddy").filter((m) => m.kind === "image").map((m) => m.id)).toEqual([
      "gpt-image-2", "gemini-2.5-flash-image", "gemini-3.1-flash-image",
    ]);
    expect(getImageAdapter("codebuddy")).toBeTruthy();
  });

  it("routes through CodeBuddy chat gateway and normalizes generated image", async () => {
    const b64 = Buffer.from("a".repeat(80)).toString("base64");
    global.fetch = vi.fn().mockResolvedValue(streamResponse(`![generated](data:image/png;base64,${b64})`));
    const result = await handleImageGenerationCore({ body, modelInfo, credentials });
    expect(result.success).toBe(true);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("https://www.codebuddy.ai/v2/chat/completions");
    expect(options.headers.Authorization).toBe("Bearer fake-token");
    expect(options.headers["Content-Encoding"]).toBe("gzip");
    const { gunzipSync } = await import("node:zlib");
    const upstream = JSON.parse(gunzipSync(options.body).toString());
    expect(upstream.model).toBe("gpt-image-2");
    expect(upstream.messages.at(-1).content).toEqual([{ type: "text", text: body.prompt }]);
    expect((await result.response.json()).data).toEqual([{ b64_json: b64 }]);
  });

  it("does not treat plain assistant text as a generated image", async () => {
    global.fetch = vi.fn().mockResolvedValue(streamResponse("I cannot generate an image"));
    const result = await handleImageGenerationCore({ body, modelInfo, credentials });
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toMatch(/did not return an image/);
  });
});
