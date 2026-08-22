import { PUBLIC_PROXY_POOL_ID } from "@/shared/constants/proxy";

const RELAY_POOL_TYPES = new Set(["vercel", "cloudflare", "deno"]);

function splitProxyUrls(value) {
  return String(value || "")
    .split(/[\s,;]+(?=(?:https?:\/\/|socks[45]:\/\/))/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getBrowserProxyPools(payload = {}) {
  const pools = payload.proxyPools
    || payload.pools
    || payload.data?.proxyPools
    || payload.data?.pools
    || [];

  const standardPools = pools
    .filter((pool) => pool?.isActive !== false && splitProxyUrls(pool?.proxyUrl).length > 0)
    .map((pool) => ({
      ...pool,
      proxyCount: splitProxyUrls(pool?.proxyUrl).length,
      browserCompatible: !RELAY_POOL_TYPES.has(pool?.type),
    }));

  return [
    {
      id: PUBLIC_PROXY_POOL_ID,
      name: "🌐 Public Proxy (Round Robin)",
      browserCompatible: true,
      isPublic: true,
    },
    ...standardPools,
  ];
}

export function formatBrowserProxyPoolOption(pool) {
  if (pool?.id === PUBLIC_PROXY_POOL_ID || pool?.isPublic) {
    return "🌐 Public Proxy (Round Robin)";
  }
  const label = pool?.name || pool?.proxyUrl || pool?.id || "Proxy pool";
  if (pool?.browserCompatible === false) return `${label} (relay - unavailable for browser)`;
  const count = splitProxyUrls(pool?.proxyUrl).length;
  return `${label} (${count} ${count === 1 ? "proxy" : "proxies"})`;
}
