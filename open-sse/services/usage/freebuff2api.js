/**
 * Freebuff2API gateway usage — surfaces the gateway /api/quota snapshot.
 *
 * The self-hosted freebuff2api server (server.js on :8787) owns the freebuff
 * account pool and exposes per-model session quotas at GET /api/quota:
 *   { models: ["deepseek/deepseek-v4-flash", ...], accounts: [...],
 *     premium: [...], scannedAt, scanning? }
 * We map each account's rateLimitsByModel into quota rows so the dashboard
 * quota table shows remaining free sessions per model.
 */
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

export async function getFreebuff2apiUsage(apiKey, providerSpecificData = null, proxyOptions = null) {
  if (!apiKey) {
    return { message: "Freebuff2API gateway API key not available." };
  }
  const baseUrl = String(providerSpecificData?.baseUrl || "http://127.0.0.1:8787")
    .trim().replace(/\/+$/, "");
  try {
    const response = await proxyAwareFetch(`${baseUrl}/api/quota`, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        Accept: "application/json",
      },
    }, proxyOptions);

    if (response.status === 401 || response.status === 403) {
      return { message: "Freebuff2API gateway API key invalid or expired." };
    }
    if (!response.ok) {
      return { message: `Freebuff2API gateway quota API error (${response.status}).` };
    }

    const data = await response.json().catch(() => null);
    if (!data || data.scanning) {
      return { message: "Freebuff2API gateway connected. Quota scan in progress — retry shortly.", quotas: {} };
    }

    // Accounts array: each has rateLimits = { model: {limit, recentCount, resetAt} }
    const accounts = Array.isArray(data.accounts) ? data.accounts : [];
    if (accounts.length === 0) {
      return { message: "Freebuff2API gateway connected. No accounts in pool yet.", quotas: {} };
    }

    const quotas = {};
    for (const acct of accounts) {
      const rl = acct?.rateLimits && typeof acct.rateLimits === "object" ? acct.rateLimits : {};
      for (const [model, info] of Object.entries(rl)) {
        const total = Number(info?.limit) || 0;
        const used = Number(info?.recentCount) || 0;
        const key = model;
        const existing = quotas[key] || { used: 0, total: 0, remaining: 0, resetAt: null };
        existing.used += used;
        existing.total += total;
        existing.remaining = existing.total - existing.used;
        if (info?.resetAt && !existing.resetAt) existing.resetAt = info.resetAt;
        quotas[key] = existing;
      }
    }
    return {
      plan: "free",
      quotas,
    };
  } catch (error) {
    return { message: `Freebuff2API gateway error: ${error.message}` };
  }
}
