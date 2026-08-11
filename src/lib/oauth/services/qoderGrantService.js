/**
 * Qoder Pro Trial grant / status-check service.
 *
 * Bridges to the external Python harness (`harness-win`) that ships the real
 * Qoder binary helper (`runtime-info-win32-x64.exe` + `sgsdk.dll` proxy) used
 * to generate fresh P1g UMID machine tokens and the Cosy status-bind that
 * grants Pro Trial. This keeps the heavy binary/UMID work out of the JS
 * process while exposing a clean API.
 *
 * Endpoints mirrored from qoder_spoof.py:
 *   POST https://openapi.qoder.sh/api/v1/jobToken/exchange   (PAT → JT)
 *   GET  https://openapi.qoder.sh/api/v3/user/status
 *   GET  https://openapi.qoder.sh/api/v2/user/plan
 *   GET  https://openapi.qoder.sh/api/v2/quota/usage
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

const execFileAsync = promisify(execFile);

const EXCHANGE_URL = "https://openapi.qoder.sh/api/v1/jobToken/exchange";
const STATUS_URL = "https://openapi.qoder.sh/api/v3/user/status";
const PLAN_URL = "https://openapi.qoder.sh/api/v2/user/plan";
const QUOTA_URL = "https://openapi.qoder.sh/api/v2/quota/usage";
const ELIGIBILITY_URL = "https://openapi.qoder.sh/api/v2/activity/claim/eligibility";
const CLAIM_URL = "https://openapi.qoder.sh/api/v2/activity/claim";

const DEFAULT_HARNESS_ROOT = process.env.QODER_HARNESS_ROOT || "C:\\Users\\arfan\\Downloads\\Data-Code\\qoder\\harness-win\\harness-win";

function findPython() {
  if (process.env.QODER_PYTHON) return process.env.QODER_PYTHON;
  const name = process.platform === "win32" ? "python.exe" : "python3";
  const dirs = (process.env.PATH || "").split(";").filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  // PATH didn't resolve — fall back to the bare command (execFile will try via shell-less lookup).
  return process.platform === "win32" ? "python" : "python3";
}

function harnessEnv() {
  return {
    ...process.env,
    PYTHONIOENCODING: "utf-8",
    PYTHONUTF8: "1",
  };
}

/**
 * Parse the gen_p1g.py JSON output. The child process may interleave the JSON
 * with helper stderr lines or wrap it with newlines, so we extract the first
 * balanced JSON object instead of relying on line boundaries.
 */
function parseUmidJson(stdout) {
  const text = String(stdout || "");
  // Fast path: whole stdout is valid JSON.
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // fall through
  }
  // Fallback: find the first '{' and attempt JSON.parse at each candidate end.
  const start = text.indexOf("{");
  if (start === -1) return null;
  const depthScan = text.slice(start);
  let depth = 0;
  for (let i = 0; i < depthScan.length; i += 1) {
    const ch = depthScan[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(depthScan.slice(0, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function defaultFetchTimeoutMs() {
  return 30_000;
}

async function fetchJson(url, { method = "GET", headers = {}, body = null, timeoutMs = defaultFetchTimeoutMs(), proxyUrl = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  const init = { method, headers, signal: controller.signal };
  if (body) init.body = JSON.stringify(body);
  let response;
  try {
    response = await fetch(url, init);
  } finally {
    clearTimeout(timer);
  }
  const text = await response.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`Qoder HTTP ${response.status}: ${text.slice(0, 200)}`);
    error.status = response.status;
    error.body = json;
    throw error;
  }
  return json;
}

export async function exchangePat(pat, { proxyUrl = null, timeoutMs } = {}) {
  const body = await fetchJson(EXCHANGE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: { personal_token: pat },
    timeoutMs,
    proxyUrl,
  });
  if (!body?.token) throw new Error("Qoder PAT exchange returned no token");
  return body.token;
}

function buildStatusHeaders(jt) {
  return {
    Authorization: `Bearer ${jt}`,
    Accept: "application/json",
    "Cosy-ClientType": "0",
    "Cosy-Version": "1.18.2",
    "Cosy-MachineOS": "x86_64_windows",
  };
}

// Qwen38 activity claim requires the CLI client fingerprint (type 5) AND the
// machine identity (UMID) — bare-JT requests come back USER_NOT_ELIGIBLE.
// Version 1.1.13 / ClientType 5 is the combination the server accepts.
function buildActivityHeaders(jt, umid = null) {
  const base = {
    Authorization: `Bearer ${jt}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    "Cosy-ClientType": "5",
    "Cosy-Version": "1.1.13",
    "Cosy-MachineOS": "x86_64_windows",
    "User-Agent": "qoder/1.1.13",
  };
  if (umid?.machineToken) {
    const serial = umid.serial || umid.factors?.serial || "";
    return {
      ...base,
      "Cosy-MachineToken": umid.machineToken,
      "Cosy-MachineType": umid.machineType || "",
      "Cosy-MachineCode": umid.machineCode || "",
      "Cosy-MachineId": serial ? Buffer.from(String(serial), "utf8").toString("hex") : "",
    };
  }
  return base;
}

export const QWEN38_800_ACTIVITY = "qwen38_800_invoke";
export const QWEN38_2000_ACTIVITY = "qwen38_2000_invoke";

/**
 * List claimable Qoder activities (qwen38 free-call grants etc).
 * Pass a fresh `umid` so the server sees a real machine identity.
 */
export async function fetchEligibility(jt, { proxyUrl = null, timeoutMs = 15_000, umid = null, harnessRoot } = {}) {
  const resolvedUmid = umid || (harnessRoot ? await genUmid({ harnessRoot }).catch(() => null) : null);
  const headers = buildActivityHeaders(jt, resolvedUmid);
  let body;
  try {
    body = await fetchJson(ELIGIBILITY_URL, { headers, timeoutMs, proxyUrl });
  } catch (error) {
    return { ok: false, error: error.message, activities: [] };
  }
  const activities = Array.isArray(body?.data)
    ? body.data.map((act) => ({
        activityId: act?.activityId || "",
        claimed: act?.claimed === true,
        canClaim: act?.canClaim === true,
        reason: act?.reason || "",
        disabled: act?.ifShowClaimDisable === true,
        text: act?.claimText?.en || act?.cliText?.en || act?.claimText?.zh || "",
      }))
    : [];
  return { ok: true, activities, umid: resolvedUmid };
}

/**
 * Claim an activity (e.g. qwen38_800_invoke) for the given PAT/JT.
 * Requires a fresh `umid` machine identity for eligibility.
 * Returns { ok, code, msg, alreadyClaimed }.
 */
export async function claimActivity(jt, activityId, { proxyUrl = null, timeoutMs = 20_000, umid = null, harnessRoot } = {}) {
  const resolvedUmid = umid || (harnessRoot ? await genUmid({ harnessRoot }).catch(() => null) : null);
  const headers = buildActivityHeaders(jt, resolvedUmid);
  const url = `${CLAIM_URL}?activityId=${encodeURIComponent(activityId)}`;
  let body;
  try {
    body = await fetchJson(url, {
      method: "POST",
      headers,
      body: {},
      timeoutMs,
      proxyUrl,
    });
  } catch (error) {
    return { ok: false, error: error.message, code: error?.body?.code, msg: error?.body?.msg };
  }
  const code = body?.code;
  const msg = body?.msg || "";
  const alreadyClaimed = /ALREADY_CLAIMED/i.test(String(msg || "")) || /already/i.test(String(msg || ""));
  return {
    ok: code === 0,
    alreadyClaimed,
    code,
    msg,
    body,
  };
}

/**
 * Claim the 800 Qwen3.8-Max free-call grant for a PAT. Best-effort — the
 * activity may already be claimed or ineligible; never throws.
 */
export async function claimQwen38(pat, { proxyUrl = null, timeoutMs = 30_000, harnessRoot = DEFAULT_HARNESS_ROOT } = {}) {
  let jt;
  try {
    jt = await exchangePat(pat, { proxyUrl, timeoutMs });
  } catch (error) {
    return { ok: false, step: "exchange", error: error.message };
  }
  // A fresh UMID machine identity is required — the server returns
  // USER_NOT_ELIGIBLE for bare-JT eligibility/claim.
  const umid = await genUmid({ harnessRoot }).catch(() => null);
  if (!umid) {
    return { ok: false, step: "umid", error: "could not generate UMID machine token", reason: "no_umid" };
  }
  const elig = await fetchEligibility(jt, { proxyUrl, timeoutMs, umid });
  const target = elig.activities.find((a) => a.activityId === QWEN38_800_ACTIVITY);

  if (!target) {
    return { ok: false, step: "eligibility", error: "qwen38_800 not in eligibility list", activities: elig.activities };
  }
  if (target.claimed) {
    return { ok: true, alreadyClaimed: true, step: "eligibility", msg: "qwen38_800 already claimed", activities: elig.activities };
  }
  if (!target.canClaim) {
    return { ok: false, step: "eligibility", error: target.reason || "not eligible", reason: target.reason, activities: elig.activities };
  }

  const claim = await claimActivity(jt, QWEN38_800_ACTIVITY, { proxyUrl, timeoutMs, umid });
  return {
    ok: claim.ok || claim.alreadyClaimed,
    alreadyClaimed: claim.alreadyClaimed,
    step: "claim",
    code: claim.code,
    msg: claim.msg,
    activities: elig.activities,
  };
}

export async function fetchStatus(jt, { proxyUrl = null, timeoutMs } = {}) {
  const headers = buildStatusHeaders(jt);
  const [status, plan, quota] = await Promise.all([
    fetchJson(STATUS_URL, { headers, timeoutMs, proxyUrl }).catch((e) => ({ http: e.status, error: e.message })),
    fetchJson(PLAN_URL, { headers, timeoutMs, proxyUrl }).catch((e) => ({ http: e.status, error: e.message })),
    fetchJson(QUOTA_URL, { headers, timeoutMs, proxyUrl }).catch((e) => ({ http: e.status, error: e.message })),
  ]);

  const quotaBody = quota?.userQuota || {};
  const total = Number(quotaBody.total) || 0;
  const remaining = Number(quotaBody.remaining) || 0;
  const planStr = String(
    status?.plan || plan?.plan_tier_name || status?.userTag || quota?.userType || ""
  );
  const userType = status?.userType || plan?.user_type || quota?.userType || "";
  const pro = (
    /PRO_TRIAL/i.test(planStr.replace(/ /g, "_"))
    || /PROFESSIONAL_TRIAL/i.test(String(userType).toUpperCase())
    || total >= 100
  );

  return {
    plan: planStr,
    userTag: status?.userTag || planStr,
    userType,
    creditsTotal: total,
    creditsRemaining: remaining,
    creditsUsed: quotaBody.used || 0,
    email: status?.email || "",
    userId: status?.id || quota?.userId || "",
    proTrialOk: Boolean(pro),
    trialGranted: Boolean(pro),
    status: status?.http ? { http: status.http } : status,
    quota: { ...quotaBody },
  };
}

export async function checkPat(pat, { proxyUrl = null, timeoutMs, harnessRoot = DEFAULT_HARNESS_ROOT } = {}) {
  const jt = await exchangePat(pat, { proxyUrl, timeoutMs });
  const status = await fetchStatus(jt, { proxyUrl, timeoutMs });
  let qwen38 = null;
  try {
    const umid = await genUmid({ harnessRoot }).catch(() => null);
    const elig = await fetchEligibility(jt, { proxyUrl, timeoutMs: 15_000, umid });
    const target = elig.activities.find((a) => a.activityId === QWEN38_800_ACTIVITY);
    qwen38 = target ? { claimed: target.claimed, canClaim: target.canClaim, reason: target.reason, text: target.text } : { available: false };
  } catch {
    qwen38 = { available: false };
  }
  return { ...status, jt, qwen38 };
}

/**
 * Generate a fresh P1g UMID machine token via the harness binary helper.
 * Returns null when the harness/helper is unavailable.
 */
export async function genUmid({
  harnessRoot = DEFAULT_HARNESS_ROOT,
  timeoutMs = 60_000,
} = {}) {
  const genPy = path.join(harnessRoot, "gen_p1g.py");
  if (!fs.existsSync(genPy)) return null;
  try {
    const { stdout } = await execFileAsync(findPython(), [genPy, "-n", "1", "--json"], {
      cwd: harnessRoot,
      env: harnessEnv(),
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
    });
    const data = parseUmidJson(stdout);
    if (!data?.machineToken || !String(data.machineToken).startsWith("P1g")) return null;
    const factors = data.factors || {};
    return {
      machineToken: data.machineToken,
      machineType: data.machineType || "",
      machineCode: data.machineCode || "",
      serial: factors.serial || data.serial || "",
      machineId: factors.serial ? Buffer.from(String(factors.serial), "utf8").toString("hex") : "",
      factors,
      genMs: data.gen_ms || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Grant Pro Trial for a PAT. Uses the harness `qoder_spoof.py grant` one-shot
 * subprocess (real UMID + Cosy bind). Returns the parsed result.
 */
export async function grantProTrial(pat, {
  harnessRoot = DEFAULT_HARNESS_ROOT,
  proxyUrl = null,
  timeoutMs = 120_000,
} = {}) {
  const spoofPy = path.join(harnessRoot, "qoder_spoof.py");
  if (!fs.existsSync(spoofPy)) {
    const error = new Error(
      `Qoder harness not found at ${harnessRoot}. Set QODER_HARNESS_ROOT to the harness-win folder.`
    );
    error.code = "QODER_HARNESS_MISSING";
    throw error;
  }

  const args = [spoofPy, "grant", "--pat", pat];
  if (proxyUrl) args.push("--proxy", proxyUrl);

  const { stdout, stderr } = await execFileAsync(findPython(), args, {
    cwd: harnessRoot,
    env: harnessEnv(),
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
  });
  const output = stdout + "\n" + stderr;

  // The harness writes a full JSON result to captures/grant_last.json — prefer
  // that over parsing the human-readable stdout summary.
  let parsed = readHarnessGrantResult(harnessRoot);
  if (!parsed) {
    const lastJson = output
      .split(/\r?\n/)
      .filter((line) => line.trim().startsWith("{"))
      .pop();
    if (lastJson) {
      try {
        parsed = JSON.parse(lastJson);
      } catch {
        parsed = null;
      }
    }
  }

  const afterBind = parsed?.after_bind || {};
  const machine = parsed?.machine || {};
  const proTrialOk = Boolean(
    parsed?.pro_trial_ok
    || afterBind.pro_trial_ok
    || afterBind.trial_granted
    || afterBind.credits_total >= 100
  );

  const result = {
    ok: proTrialOk,
    proTrialOk,
    patPrefix: String(pat).slice(0, 22),
    plan: afterBind.plan || "",
    userType: afterBind.user_type || "",
    creditsTotal: afterBind.credits_total || 0,
    creditsRemaining: afterBind.credits_remaining || 0,
    machine: machine || {},
    bindMs: parsed?.bind_ms || 0,
    ultimate: parsed?.ultimate || null,
    status: parsed?.status || (proTrialOk ? "pro_ok" : "not_pro"),
    raw: parsed || { stdout: output.slice(-1500) },
  };

  // Best-effort: claim the 800 Qwen3.8-Max free-call grant after a
  // successful Pro Trial. Never fails the grant when the claim is ineligible.
  try {
    const qwen38 = await claimQwen38(pat, { proxyUrl: proxyUrl || undefined, timeoutMs: 30_000, harnessRoot });
    result.qwen38 = qwen38;
  } catch (error) {
    result.qwen38 = { ok: false, step: "claim", error: error.message };
  }

  return result;
}

/**
 * Read the latest harness grant result from captures/grant_last.json.
 * Returns null when missing/unreadable.
 */
function readHarnessGrantResult(harnessRoot) {
  try {
    const captureFile = path.join(harnessRoot, "captures", "grant_last.json");
    if (!fs.existsSync(captureFile)) return null;
    const parsed = JSON.parse(fs.readFileSync(captureFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export const __test__ = {
  EXCHANGE_URL,
  STATUS_URL,
  PLAN_URL,
  QUOTA_URL,
  ELIGIBILITY_URL,
  CLAIM_URL,
  DEFAULT_HARNESS_ROOT,
};
