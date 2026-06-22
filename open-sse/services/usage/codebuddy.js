import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const USAGE_URL = "https://www.codebuddy.ai/v2/billing/meter/get-user-resource";
const PACKAGE_LABELS = {
  TCACA_code_001_PqouKr6QWV: "Monthly Credits",
  TCACA_code_002_AkiJS3ZHF5: "Monthly Credits",
  TCACA_code_003_FAnt7lcmRT: "Monthly Credits",
  TCACA_code_006_DbXS0lrypC: "Gift Credits",
  TCACA_code_007_nzdH5h4Nl0: "Activity Credits",
  TCACA_code_008_cfWoLwvjU4: "Monthly Credits",
  TCACA_code_009_0XmEQc2xOf: "Extra Credits",
};

function finite(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function parseUsage(payload) {
  const data = payload?.data?.Response?.Data || payload?.Response?.Data || payload?.data || payload || {};
  const accounts = Array.isArray(data.Accounts) ? data.Accounts : (Array.isArray(data.accounts) ? data.accounts : []);
  const quotas = {};
  let pro = false;
  for (const account of accounts) {
    const label = PACKAGE_LABELS[account?.PackageCode] || (account?.PackageCode ? "Other Credits" : null);
    if (!label) continue;
    if (["TCACA_code_002_AkiJS3ZHF5", "TCACA_code_003_FAnt7lcmRT"].includes(account.PackageCode)) pro = true;
    const total = finite(account.CycleCapacitySizePrecise, account.CycleCapacitySize, account.CapacitySizePrecise, account.CapacitySize);
    const remaining = finite(account.CycleCapacityRemainPrecise, account.CycleCapacityRemain, account.CapacityRemainPrecise, account.CapacityRemain);
    const used = finite(account.CapacityUsedPrecise, account.CapacityUsed, total !== null && remaining !== null ? total - remaining : null);
    if (total === null && remaining === null && used === null) continue;
    const safeTotal = Math.max(0, total ?? ((used ?? 0) + (remaining ?? 0)));
    const safeRemaining = Math.max(0, remaining ?? (safeTotal - (used ?? 0)));
    const safeUsed = Math.max(0, used ?? (safeTotal - safeRemaining));
    const current = quotas[label] || { used: 0, total: 0, remaining: 0, unit: "credits", unlimited: false };
    current.used += safeUsed;
    current.total += safeTotal;
    current.remaining += safeRemaining;
    current.remainingPercentage = current.total ? Math.max(0, Math.min(100, current.remaining / current.total * 100)) : 0;
    quotas[label] = current;
  }
  return { plan: pro ? "Pro" : "Free", quotas };
}

export async function getCodeBuddyUsage(accessToken, apiKey, providerSpecificData = {}, proxyOptions = null) {
  if (!accessToken) {
    if (apiKey) return {
      plan: "CodeBuddy",
      message: "CodeBuddy chat key active. Upstream quota is unavailable without a valid IDE OAuth token; use 9router Usage for local request and token tracking.",
      quotas: {}, authMode: "generated-api-key", trackingMode: "local-router",
    };
    return { plan: "CodeBuddy", message: "CodeBuddy upstream quota is unavailable because no valid IDE OAuth token is stored.", quotas: {}, trackingMode: "unavailable" };
  }

  const domain = providerSpecificData.domain || providerSpecificData.rawAuth?.domain || "www.codebuddy.ai";
  const uid = providerSpecificData.uid || providerSpecificData.rawAuth?.uid;
  const enterpriseId = providerSpecificData.enterpriseId || providerSpecificData.rawAuth?.enterpriseId;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Domain": domain,
  };
  if (uid) headers["X-User-Id"] = uid;
  if (enterpriseId) {
    headers["X-Enterprise-Id"] = enterpriseId;
    headers["X-Tenant-Id"] = enterpriseId;
  }
  const response = await proxyAwareFetch(USAGE_URL, {
    method: "POST", headers,
    body: JSON.stringify({ PageNumber: 1, PageSize: 200, ProductCode: "p_tcaca", Status: [0, 3] }),
  }, proxyOptions);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (response.status === 401 || response.status === 403) return {
    plan: "CodeBuddy",
    message: `CodeBuddy IDE OAuth token was rejected (${response.status}). Upstream quota is unavailable; use 9router Usage for local request and token tracking.`,
    quotas: {}, authMode: "oauth-rejected", trackingMode: "local-router",
  };
  if (!response.ok) return { plan: "CodeBuddy", message: `CodeBuddy quota endpoint returned ${response.status}.`, quotas: {} };
  return { ...parseUsage(payload), authMode: "oauth" };
}
