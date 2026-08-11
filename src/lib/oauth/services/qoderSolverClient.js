/**
 * Qoder captcha solver client — talks to the standalone qoder-solver warm
 * sidecar (HTTP :8878) that ships with the harness. Provides:
 *   - health(): probe solver availability + slot counts
 *   - solveAliyun(): solve an Aliyun puzzle captcha → securityToken
 *   - solveX5sec(): harvest an x5sec cookie from a TMD punish URL
 *
 * The sidecar is Python/Node external; when it is not running the caller
 * should surface an actionable message rather than failing silently.
 */

const DEFAULT_SOLVER_BASE = process.env.QODER_SOLVER_HTTP || process.env.SOLVER_HTTP || "http://127.0.0.1:8878";
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_ALIYUN_SCENE_ID = "1r7eif79x";
const DEFAULT_ALIYUN_PREFIX = "13lbkb5";

function buildHeaders() {
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "9router-qoder-automation/1.0",
  };
}

async function postJson(url, payload, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await response.text().catch(() => "");
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(
        `qoder solver HTTP ${response.status}: ${body?.error || body?.message || text.slice(0, 200)}`
      );
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  } catch (error) {
    if (error.name === "AbortError" || error?.message === "timeout") {
      const timeoutError = new Error(`qoder solver request timed out after ${timeoutMs}ms`);
      timeoutError.code = "QODER_SOLVER_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function solverHealth({ base = DEFAULT_SOLVER_BASE, timeoutMs = 5_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/health`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, status: response.status };
    const body = await response.json().catch(() => null);
    return { ok: true, ...(body || {}) };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function solveAliyunCaptcha({
  sceneId = DEFAULT_ALIYUN_SCENE_ID,
  prefix = DEFAULT_ALIYUN_PREFIX,
  region = "sgp",
  proxy,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  base = DEFAULT_SOLVER_BASE,
} = {}) {
  const baseUrl = base.replace(/\/$/, "");
  const payload = { type: "aliyun", scene_id: sceneId, prefix, region, timeout_s: Math.floor(timeoutMs / 1000) };
  if (proxy) payload.proxy = proxy;

  const errors = [];
  for (const path of ["/aliyun", "/solve", "/v1/solve"]) {
    try {
      const body = await postJson(`${baseUrl}${path}`, payload, { timeoutMs });
      const securityToken = body?.security_token || body?.securityToken || body?.token?.securityToken || "";
      const verifyCode = body?.verify_code || body?.VerifyCode || "";
      const solved = Boolean(body?.solved) || Boolean(securityToken) || verifyCode === "T001";
      return {
        ok: solved,
        solved,
        securityToken: securityToken || "",
        verifyCode: verifyCode || "T001",
        certifyId: body?.certify_id
          || body?.certifyId
          || body?.token?.certifyId
          || body?.verify_result?.certifyId
          || "",
        sceneId: body?.scene_id || body?.sceneId || body?.token?.sceneId || DEFAULT_ALIYUN_SCENE_ID,
        deviceToken: body?.token?.deviceToken || body?.device_token || "",
        data: body?.token?.data || body?.data || "",
        method: body?.method || "",
        attempts: body?.attempts || 0,
        elapsed: body?.elapsed || 0,
        slot: body?.slot || null,
        raw: body,
      };
    } catch (error) {
      errors.push(error);
      if (error?.status !== 404) {
        return { ok: false, solved: false, error: error.message, code: error.code || "QODER_SOLVER_ERROR", raw: error.body };
      }
    }
  }
  return { ok: false, solved: false, error: errors[errors.length - 1]?.message || "solver unreachable", code: "QODER_SOLVER_UNREACHABLE" };
}

export async function solveX5sec({
  punishUrl,
  proxy,
  timeoutMs = 60_000,
  base = DEFAULT_SOLVER_BASE,
} = {}) {
  const baseUrl = base.replace(/\/$/, "");
  const payload = {
    punish_url: String(punishUrl || "").replace("https://qoder.com//", "https://qoder.com/"),
    timeout_s: Math.floor(timeoutMs / 1000),
    ms_total: 320,
  };
  if (proxy) payload.proxy = proxy;

  const errors = [];
  for (const path of ["/x5sec", "/v1/solve"]) {
    try {
      const body = await postJson(`${baseUrl}${path}`, payload, { timeoutMs });
      const x5sec = body?.x5sec || "";
      return {
        ok: Boolean(x5sec),
        x5sec,
        elapsed: body?.elapsed || body?.total_s || 0,
        attempts: body?.attempts || 0,
        slot: body?.slot || null,
        raw: body,
      };
    } catch (error) {
      errors.push(error);
      if (error?.status !== 404) {
        return { ok: false, error: error.message, code: error.code || "QODER_X5SEC_ERROR", raw: error.body };
      }
    }
  }
  return { ok: false, error: errors[errors.length - 1]?.message || "solver unreachable", code: "QODER_X5SEC_UNREACHABLE" };
}

export const __test__ = {
  DEFAULT_SOLVER_BASE,
  DEFAULT_ALIYUN_SCENE_ID,
  DEFAULT_ALIYUN_PREFIX,
};
