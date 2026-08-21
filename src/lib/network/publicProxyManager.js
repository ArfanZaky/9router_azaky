import { ProxyAgent, fetch as undiciFetch } from "undici";

// In-memory public proxy pool state
class PublicProxyManager {
  constructor() {
    this.proxies = []; // [{ url, latency, lastChecked, failures }]
    this.currentIndex = 0;
    this.isScanning = false;
    this.lastScanTime = 0;
    this.timer = null;
    this.maxLatencyMs = 3000; // Filter N latency: default 3000ms
    this.scanIntervalMs = 10 * 60 * 1000; // 10 minutes
    this.sources = [
      // Regional HProxy (ID, SG, MY, TH, VN, PH, JP, KR)
      "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/by-country/ID.txt",
      "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/by-country/SG.txt",
      "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/by-country/MY.txt",
      "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/by-country/TH.txt",
      "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/by-country/VN.txt",
      "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/by-country/PH.txt",
      "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/by-country/JP.txt",
      "https://raw.githubusercontent.com/hproxy-com/free-proxy-list/main/by-country/KR.txt",

      // Regional ProxyScrape via jsDelivr CDN
      "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/countries/id/data.txt",
      "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/countries/sg/data.txt",
      "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/countries/my/data.txt",
      "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/countries/th/data.txt",
      "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/countries/vn/data.txt",
      "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/countries/ph/data.txt",
      "https://cdn.jsdelivr.net/gh/proxyscrape/free-proxy-list@main/proxies/countries/jp/data.txt",

      // GProxyNet sources
      "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/http.txt",
      "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/socks4.txt",
      "https://raw.githubusercontent.com/gproxynet/free-proxy-list/main/socks5.txt",

      // General sources
      "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/http.txt",
      "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
      "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
      "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master-List/main/http.txt",
      "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt",
      "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=3000&country=all&ssl=all&anonymity=all"
    ];
  }

  setMaxLatency(ms) {
    if (Number.isFinite(ms) && ms > 0) {
      this.maxLatencyMs = ms;
    }
  }

  getStats() {
    return {
      total: this.proxies.length,
      maxLatencyMs: this.maxLatencyMs,
      isScanning: this.isScanning,
      lastScanTime: this.lastScanTime,
      proxies: this.proxies.slice(0, 50).map((p) => ({
        url: p.url,
        latency: p.latency,
        lastChecked: p.lastChecked,
      })),
    };
  }

  // Get next proxy using Round-Robin
  getNextProxy() {
    if (this.proxies.length === 0) return null;
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return this.proxies[this.currentIndex]?.url || null;
  }

  // Report a dead or timed out proxy - automatically removes it from the list
  reportFailure(proxyUrl) {
    if (!proxyUrl) return;
    const initialLen = this.proxies.length;
    this.proxies = this.proxies.filter((p) => p.url !== proxyUrl);
    if (this.proxies.length < initialLen) {
      console.log(`[PublicProxy] Ejected dead/timeout proxy: ${proxyUrl} (Remaining: ${this.proxies.length})`);
    }
    if (this.currentIndex >= this.proxies.length) {
      this.currentIndex = 0;
    }
  }

  // Test single proxy health and measure latency
  async testProxy(rawProxy, timeoutMs = 3000) {
    let proxyUrl = rawProxy.trim();
    if (!proxyUrl.startsWith("http://") && !proxyUrl.startsWith("https://") && !proxyUrl.startsWith("socks5://") && !proxyUrl.startsWith("socks4://")) {
      proxyUrl = `http://${proxyUrl}`;
    }

    let dispatcher;
    try {
      dispatcher = new ProxyAgent({ uri: proxyUrl });
      const controller = new AbortController();
      const start = Date.now();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const res = await undiciFetch("https://httpbin.org/ip", {
          method: "GET",
          dispatcher,
          signal: controller.signal,
          headers: { "User-Agent": "9Router-ProxyCheck/1.0" },
        });

        const elapsed = Date.now() - start;
        if (res.ok && elapsed <= this.maxLatencyMs) {
          return { ok: true, latency: elapsed, proxyUrl };
        }
        return { ok: false, error: `Latency too high or bad status: ${res.status} (${elapsed}ms)` };
      } catch (err) {
        return { ok: false, error: err.message };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      try {
        await dispatcher?.close?.();
      } catch {}
    }
  }

  // Fetch proxy lists from public endpoints
  async fetchRawProxyList() {
    const rawList = new Set();
    for (const source of this.sources) {
      try {
        const res = await fetch(source, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;
        const text = await res.text();
        const lines = text.split(/\r?\n/);
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith("#") && trimmed.includes(":")) {
            rawList.add(trimmed);
          }
        }
      } catch {
        // Skip failed source silently
      }
    }
    return Array.from(rawList);
  }

  // Screen public proxies with concurrency
  async screenProxies() {
    if (this.isScanning) {
      console.log("[PublicProxy] Scan already in progress...");
      return;
    }

    this.isScanning = true;
    console.log(`[PublicProxy] Starting proxy screening (Filter max latency: ${this.maxLatencyMs}ms)...`);

    try {
      const candidates = await this.fetchRawProxyList();
      console.log(`[PublicProxy] Found ${candidates.length} raw candidates. Verifying...`);

      // Shuffle & limit candidates to avoid overload
      const shuffled = candidates.sort(() => 0.5 - Math.random()).slice(0, 300);
      const verified = [];
      const concurrency = 30;
      const queue = [...shuffled];

      const worker = async () => {
        while (queue.length > 0) {
          const candidate = queue.shift();
          if (!candidate) break;
          const result = await this.testProxy(candidate, this.maxLatencyMs);
          if (result.ok) {
            verified.push({
              url: result.proxyUrl,
              latency: result.latency,
              lastChecked: Date.now(),
              failures: 0,
            });
            console.log(`[PublicProxy] + Valid proxy: ${result.proxyUrl} (${result.latency}ms)`);
          }
        }
      };

      await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

      if (verified.length > 0) {
        // Merge with existing working proxies and deduplicate
        const map = new Map();
        for (const p of this.proxies) {
          map.set(p.url, p);
        }
        for (const p of verified) {
          map.set(p.url, p);
        }
        this.proxies = Array.from(map.values()).sort((a, b) => a.latency - b.latency);
      }

      this.lastScanTime = Date.now();
      console.log(`[PublicProxy] Screening finished. Active pool size: ${this.proxies.length}`);
    } catch (error) {
      console.error("[PublicProxy] Error during proxy screening:", error.message);
    } finally {
      this.isScanning = false;
    }
  }

  // Start background periodic screening every 10 minutes
  startPeriodicScreening(intervalMs = null) {
    if (intervalMs) this.scanIntervalMs = intervalMs;
    if (this.timer) clearInterval(this.timer);

    // Initial background scan
    this.screenProxies().catch(() => {});

    // Periodic loop
    this.timer = setInterval(() => {
      this.screenProxies().catch(() => {});
    }, this.scanIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

// Global singleton instance
if (!globalThis.__publicProxyManager) {
  globalThis.__publicProxyManager = new PublicProxyManager();
  globalThis.__publicProxyManager.startPeriodicScreening();
}

export const publicProxyManager = globalThis.__publicProxyManager;
export default publicProxyManager;
