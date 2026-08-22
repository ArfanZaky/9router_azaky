import { getProxyPoolById, getProxyPools } from "../../../models/index.js";
import { getSettings } from "../../db/repos/settingsRepo.js";
import { publicProxyManager } from "../../network/publicProxyManager.js";
import { PUBLIC_PROXY_POOL_ID } from "@/shared/constants/proxy";

const RELAY_POOL_TYPES = new Set(["vercel", "cloudflare", "deno"]);
const VALID_PROXY_PROTOCOLS = new Set(["http:", "https:", "socks4:", "socks5:"]);

export function splitBulkImportProxyUrls(value) {
  return String(value || "")
    .split(/[\s,;]+(?=(?:https?:\/\/|socks[45]:\/\/))/i)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function validateProxyUrls(proxyUrls) {
  for (const proxyUrl of proxyUrls) {
    let parsed;
    try {
      parsed = new URL(proxyUrl);
    } catch {
      return "proxyUrl must be a valid URL";
    }
    if (!VALID_PROXY_PROTOCOLS.has(parsed.protocol)) {
      return "proxyUrl must start with http://, https://, socks4://, or socks5://";
    }
    if (!parsed.hostname) return "proxyUrl must include a host";
  }
  return null;
}

function buildResolvedProxy(proxyUrls, source) {
  const urls = [...new Set(proxyUrls)];
  return {
    proxyUrl: urls[0] || null,
    proxyUrls: urls,
    proxyMode: urls.length > 1 ? "round-robin" : (urls.length === 1 ? "single" : "none"),
    proxyPoolId: source?.proxyPoolId || null,
    proxySource: source?.proxySource || null,
    error: null,
  };
}

export function applyBulkImportProxyMode(resolvedProxy, proxyModePreference) {
  const proxyUrls = Array.isArray(resolvedProxy?.proxyUrls) ? resolvedProxy.proxyUrls : [];
  const fallbackUrl = resolvedProxy?.proxyUrl || proxyUrls[0] || null;
  const preference = String(proxyModePreference || "auto").trim().toLowerCase();

  if (preference === "single") {
    const singleUrl = fallbackUrl || null;
    return {
      ...resolvedProxy,
      proxyUrl: singleUrl,
      proxyUrls: singleUrl ? [singleUrl] : [],
      proxyMode: singleUrl ? "single" : "none",
    };
  }

  if (preference === "round-robin") {
    const urls = proxyUrls.length ? proxyUrls : (fallbackUrl ? [fallbackUrl] : []);
    return {
      ...resolvedProxy,
      proxyUrl: urls[0] || null,
      proxyUrls: urls,
      proxyMode: urls.length ? "round-robin" : "none",
    };
  }

  return resolvedProxy;
}

export async function resolveAllBulkImportProxies({ httpOnly = false } = {}) {
  const pools = await getProxyPools({ isActive: true });
  const proxyUrls = (pools || [])
    .filter((pool) => pool?.isActive !== false && !RELAY_POOL_TYPES.has(pool?.type))
    .flatMap((pool) => splitBulkImportProxyUrls(pool?.proxyUrl))
    .filter((proxyUrl) => !httpOnly || /^https?:\/\//i.test(proxyUrl));
  const validationError = validateProxyUrls(proxyUrls);
  if (validationError) {
    return {
      proxyUrl: null,
      proxyUrls: [],
      proxyMode: "none",
      proxyPoolId: null,
      proxySource: "all-active-pools",
      error: validationError,
    };
  }
  return buildResolvedProxy(proxyUrls, { proxySource: "all-active-pools" });
}

/**
 * Resolve a launchable proxy URL from bulk-import request body.
 *
 * Priority:
 *   1. proxyPoolId (lookup pool or handle PUBLIC_PROXY_POOL_ID)
 *   2. proxyUrl (freeform, basic prefix validation)
 *   3. settings.useOutboundProxyForAutomation + settings.outboundProxyUrl fallback
 *
 * Returns { proxyUrl, proxyUrls, proxyMode, proxyPoolId, proxySource, error }.
 * When error is non-null the caller should respond with 400.
 */
export async function resolveBulkImportProxy({ proxyPoolId, proxyUrl, useSettingsFallback = true } = {}) {
  if (proxyPoolId === PUBLIC_PROXY_POOL_ID) {
    // Get all screened public proxies, or fetch next active proxy
    const stats = publicProxyManager.getStats();
    const activePublicUrls = (stats.proxies || []).map((p) => p.url).filter(Boolean);
    const chosenNext = publicProxyManager.getNextProxy();

    const proxyUrls = activePublicUrls.length > 0
      ? activePublicUrls
      : (chosenNext ? [chosenNext] : []);

    if (!proxyUrls.length) {
      // If screening is still running or no public proxies available yet, attempt immediate test or report message
      return {
        proxyUrl: null,
        proxyUrls: [],
        proxyMode: "none",
        proxyPoolId: PUBLIC_PROXY_POOL_ID,
        proxySource: "public-pool",
        error: "No active public proxies available at the moment. Please wait for proxy screening or choose another proxy pool.",
      };
    }

    return {
      proxyUrl: chosenNext || proxyUrls[0],
      proxyUrls: proxyUrls.length > 1 ? proxyUrls : [chosenNext || proxyUrls[0]],
      proxyMode: "round-robin",
      proxyPoolId: PUBLIC_PROXY_POOL_ID,
      proxySource: "public-pool",
      error: null,
    };
  }

  if (proxyPoolId) {
    const pool = await getProxyPoolById(proxyPoolId);
    if (!pool) {
      return { proxyUrl: null, proxyUrls: [], proxyMode: "none", proxyPoolId, proxySource: "pool", error: "Proxy pool not found" };
    }
    if (!pool.isActive) {
      return { proxyUrl: null, proxyUrls: [], proxyMode: "none", proxyPoolId, proxySource: "pool", error: "Proxy pool is inactive" };
    }
    if (RELAY_POOL_TYPES.has(pool.type)) {
      return {
        proxyUrl: null,
        proxyUrls: [],
        proxyMode: "none",
        proxyPoolId,
        proxySource: "pool",
        error: `Proxy pool type "${pool.type}" is a URL-rewriting relay and cannot be used for browser launch`,
      };
    }
    const proxyUrls = splitBulkImportProxyUrls(pool.proxyUrl);
    const validationError = validateProxyUrls(proxyUrls);
    if (validationError) {
      return { proxyUrl: null, proxyUrls: [], proxyMode: "none", proxyPoolId, proxySource: "pool", error: validationError };
    }
    return buildResolvedProxy(proxyUrls, { proxyPoolId, proxySource: "pool" });
  }

  if (proxyUrl) {
    const proxyUrls = splitBulkImportProxyUrls(proxyUrl);
    if (!proxyUrls.length) return buildResolvedProxy([], { proxySource: "custom" });
    const validationError = validateProxyUrls(proxyUrls);
    if (validationError) {
      return {
        proxyUrl: null,
        proxyUrls: [],
        proxyMode: "none",
        proxyPoolId: null,
        proxySource: "custom",
        error: validationError,
      };
    }
    return buildResolvedProxy(proxyUrls, { proxySource: "custom" });
  }

  // Fallback: check settings for outbound proxy automation opt-in
  if (useSettingsFallback) {
    try {
      const settings = await getSettings();
      if (settings.useOutboundProxyForAutomation === true && settings.outboundProxyUrl) {
        const proxyUrls = splitBulkImportProxyUrls(settings.outboundProxyUrl);
        const validationError = validateProxyUrls(proxyUrls);
        if (validationError) {
          return { proxyUrl: null, proxyUrls: [], proxyMode: "none", proxyPoolId: null, proxySource: "settings", error: validationError };
        }
        return buildResolvedProxy(proxyUrls, { proxySource: "settings" });
      }
    } catch {
      // Settings unavailable; proceed without proxy
    }
  }

  return buildResolvedProxy([], { proxySource: null });
}
