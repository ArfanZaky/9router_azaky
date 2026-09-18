import { describe, it, expect, vi, beforeEach } from "vitest";

const proxyAwareFetch = vi.fn(async (url) => ({
  ok: true,
  status: 200,
  json: async () => url.includes(":loadCodeAssist")
    ? { cloudaicompanionProject: { id: " project-1 " }, currentTier: { id: "free-tier", name: "Antigravity" }, paidTier: { id: "g1-pro-tier", name: "Google AI Pro" } }
    : url.includes(":retrieveUserQuotaSummary")
      ? { groups: [] }
      : { models: {} },
  text: async () => "{}",
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch,
}));

describe("Antigravity usage headers", () => {
  beforeEach(() => proxyAwareFetch.mockClear());

  it("uses the official IDE user agent and omits router-only source headers", async () => {
    const { getAntigravityUsage } = await import("../../open-sse/services/usage/google.js");

    const usage = await getAntigravityUsage("access-token", {});

    expect(usage.plan).toBe("Google AI Pro");
    expect(usage.message).toBeUndefined();
    // loadCodeAssist + fetchAvailableModels + retrieveUserQuotaSummary
    expect(proxyAwareFetch).toHaveBeenCalledTimes(3);
    for (const [, options] of proxyAwareFetch.mock.calls) {
      expect(options.headers["User-Agent"]).toBe("antigravity/ide/2.11.0 darwin/arm64");
      expect(options.headers).not.toHaveProperty("x-request-source");
    }
  });
});
