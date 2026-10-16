import { describe, it, expect, beforeEach, vi } from "vitest";
import { publicProxyManager } from "../../src/lib/network/publicProxyManager.js";
import { resolveConnectionProxyConfig, PUBLIC_PROXY_POOL_ID } from "../../src/lib/network/connectionProxy.js";

describe("PublicProxyManager - Round Robin and Sticky Mode", () => {
  beforeEach(() => {
    publicProxyManager.stop();
    publicProxyManager.proxies = [
      { url: "http://1.1.1.1:8080", latency: 200, lastChecked: Date.now() },
      { url: "http://2.2.2.2:8080", latency: 300, lastChecked: Date.now() },
      { url: "http://3.3.3.3:8080", latency: 400, lastChecked: Date.now() },
    ];
    publicProxyManager.currentIndex = 0;
    publicProxyManager.roundRobin = true;
    publicProxyManager._settingsLoaded = true;
  });

  it("cycles proxies in round-robin mode when roundRobin is true", () => {
    publicProxyManager.roundRobin = true;
    const first = publicProxyManager.getNextProxy();
    const second = publicProxyManager.getNextProxy();
    const third = publicProxyManager.getNextProxy();
    const fourth = publicProxyManager.getNextProxy();

    expect(first).toBe("http://2.2.2.2:8080");
    expect(second).toBe("http://3.3.3.3:8080");
    expect(third).toBe("http://1.1.1.1:8080");
    expect(fourth).toBe("http://2.2.2.2:8080");
  });

  it("stays sticky on the current proxy in sticky mode when roundRobin is false", () => {
    publicProxyManager.roundRobin = false;
    publicProxyManager.currentIndex = 0;

    const first = publicProxyManager.getNextProxy();
    const second = publicProxyManager.getNextProxy();
    const third = publicProxyManager.getNextProxy();

    expect(first).toBe("http://1.1.1.1:8080");
    expect(second).toBe("http://1.1.1.1:8080");
    expect(third).toBe("http://1.1.1.1:8080");
  });

  it("switches to the next proxy when current proxy fails in sticky mode", () => {
    publicProxyManager.roundRobin = false;
    publicProxyManager.currentIndex = 0;

    expect(publicProxyManager.getNextProxy()).toBe("http://1.1.1.1:8080");

    // Report timeout failure for current proxy
    publicProxyManager.reportFailure("http://1.1.1.1:8080");

    expect(publicProxyManager.proxies.map((p) => p.url)).toEqual([
      "http://2.2.2.2:8080",
      "http://3.3.3.3:8080",
    ]);

    // Next request should switch to next healthy proxy
    expect(publicProxyManager.getNextProxy()).toBe("http://2.2.2.2:8080");
    expect(publicProxyManager.getNextProxy()).toBe("http://2.2.2.2:8080");
  });

  it("removes dead proxy from rotation in round-robin mode", () => {
    publicProxyManager.roundRobin = true;

    // Report failure on 2.2.2.2
    publicProxyManager.reportFailure("http://2.2.2.2:8080");

    expect(publicProxyManager.proxies.map((p) => p.url)).toEqual([
      "http://1.1.1.1:8080",
      "http://3.3.3.3:8080",
    ]);

    const calls = [
      publicProxyManager.getNextProxy(),
      publicProxyManager.getNextProxy(),
      publicProxyManager.getNextProxy(),
    ];

    expect(calls).not.toContain("http://2.2.2.2:8080");
  });

  it("handles normalized URLs with trailing slashes in reportFailure", () => {
    publicProxyManager.reportFailure("http://1.1.1.1:8080/");
    expect(publicProxyManager.proxies.map((p) => p.url)).toEqual([
      "http://2.2.2.2:8080",
      "http://3.3.3.3:8080",
    ]);
  });

  it("returns null safely when all proxies have failed and ejected", () => {
    publicProxyManager.reportFailure("http://1.1.1.1:8080");
    publicProxyManager.reportFailure("http://2.2.2.2:8080");
    publicProxyManager.reportFailure("http://3.3.3.3:8080");

    expect(publicProxyManager.proxies.length).toBe(0);
    expect(publicProxyManager.getNextProxy()).toBeNull();
  });

  it("resolves connection proxy config with isPublicProxy and dynamic mode label", async () => {
    publicProxyManager.roundRobin = true;
    publicProxyManager.currentIndex = 0;

    const resolvedRR = await resolveConnectionProxyConfig({
      proxyPoolId: PUBLIC_PROXY_POOL_ID,
    });

    expect(resolvedRR.isPublicProxy).toBe(true);
    expect(resolvedRR.connectionProxyEnabled).toBe(true);
    expect(resolvedRR.proxyPool.name).toBe("Public Proxy (Round Robin)");

    publicProxyManager.roundRobin = false;
    const resolvedSticky = await resolveConnectionProxyConfig({
      proxyPoolId: PUBLIC_PROXY_POOL_ID,
    });

    expect(resolvedSticky.isPublicProxy).toBe(true);
    expect(resolvedSticky.proxyPool.name).toBe("Public Proxy (Sticky)");
  });
});
