import { describe, it, expect, beforeEach, vi } from "vitest";
import { publicProxyManager } from "../../src/lib/network/publicProxyManager.js";

vi.mock("../../src/lib/network/proxyTest.js", () => ({
  testProxyUrl: vi.fn(async () => ({
    ok: false,
    status: 500,
    error: "Proxy test timed out",
  })),
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnectionById: vi.fn(async (id) => ({
    id,
    provider: "openai",
    authType: "apikey",
    apiKey: "sk-test",
    providerSpecificData: {
      proxyPoolId: "__public_proxy__",
    },
  })),
  updateProviderConnection: vi.fn(async () => ({})),
}));

describe("Public Proxy Timeout Ejection in testSingleConnection", () => {
  beforeEach(() => {
    publicProxyManager.stop();
    publicProxyManager.proxies = [
      { url: "http://10.0.0.1:8080", latency: 250, lastChecked: Date.now() },
      { url: "http://10.0.0.2:8080", latency: 350, lastChecked: Date.now() },
    ];
    publicProxyManager.currentIndex = 0;
    publicProxyManager.roundRobin = false;
    publicProxyManager._settingsLoaded = true;
  });

  it("ejects public proxy from pool when testProxyUrl returns 'Proxy test timed out'", async () => {
    const { testSingleConnection } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

    const countBefore = publicProxyManager.proxies.length;
    expect(countBefore).toBe(2);

    const result = await testSingleConnection("conn-1");

    expect(result.valid).toBe(false);
    expect(result.error).toBe("Proxy test timed out");

    // Exactly one proxy (the one tested) must be ejected
    expect(publicProxyManager.proxies.length).toBe(1);
  });
});
