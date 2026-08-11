/**
 * Qoder signup HTTP client — JS port of the harness `http_register.py`.
 *
 * Flow (all against qoder.com, pure HTTP except the baxia token harvest):
 *   1. check-login-type (probe the email)
 *   2. solve Aliyun captcha via the warm solver sidecar (:8878)
 *   3. POST /api/v1/verificationCodes with x-captcha-verify-param
 *   4. poll the caller-supplied OTP source (catchmail.io by default) for the 6-digit OTP
 *   5. POST /api/v1/users (email_pwd) → user session
 *   6. POST /api/v1/me/personal-access-tokens → PAT
 *
 * The baxia (bx-ua / bx-umidtoken / bx_et) tokens are harvested from a fresh
 * browser context that loads qoder.com/users/sign-up, then closed. This keeps
 * the register path headless-safe while satisfying the site's fingerprint
 * checks.
 *
 * TMD (Aliyun sliding) blocking on /users is handled by harvesting the x5sec
 * cookie via the solver sidecar and retrying once.
 */

import { v4 as uuidv4 } from "uuid";
import { QoderService } from "./qoder.js";

const API_BASE = "https://qoder.com";
const SIGNUP_URL = `${API_BASE}/users/sign-up`;
const CHECK_LOGIN = `${API_BASE}/api/v1/auth/check-login-type`;
const VERIFICATION_CODES = `${API_BASE}/api/v1/verificationCodes`;
const USERS = `${API_BASE}/api/v1/users`;
const ME = `${API_BASE}/api/v1/me`;
const PAT_URL = `${API_BASE}/api/v1/me/personal-access-tokens`;

const UA = (
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
  + "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36"
);
const BX_V = "2.5.35";
const CSRF = "_echo_csrf_using_sec_fetch_site_";

const DEFAULT_OTP_TIMEOUT_MS = 60_000;
const DEFAULT_OTP_POLL_INTERVAL_MS = 3_000;
const DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_REGISTER_ATTEMPTS = 8;
const MAX_CAPTCHA_WAIT_MS = 100_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSetCookie(rawSetCookie, into) {
  const lines = Array.isArray(rawSetCookie) ? rawSetCookie : String(rawSetCookie || "").split("\n");
  for (const line of lines) {
    const first = line.split(";", 1)[0].trim();
    if (!first.includes("=")) continue;
    const [name, ...rest] = first.split("=");
    const value = rest.join("=");
    if (name) into[name] = value;
  }
}

export class QoderSignupHttpClient {
  constructor({ tokens, cookie = "", proxyUrl = null } = {}) {
    this.tokens = { ...(tokens || {}) };
    this.cookies = {};
    this.x5sec = "";
    this.proxyUrl = proxyUrl || null;
    this._seedCookie(cookie);
  }

  _seedCookie(cookie) {
    this.cookies = {};
    this.x5sec = "";
    if (!cookie) return;
    const DROP = new Set(["qoderuid", "qoder_token", "token", "session", "sid", "auth", "access_token", "refresh_token", "x5sec"]);
    for (const part of cookie.split(";")) {
      const trimmed = part.trim();
      if (!trimmed || !trimmed.includes("=")) continue;
      const [name, ...rest] = trimmed.split("=");
      const key = name.trim();
      if (!key || DROP.has(key.toLowerCase())) continue;
      if (key.toLowerCase().startsWith("qoder_") && key.toLowerCase() !== "qoder_locale") continue;
      this.cookies[key] = rest.join("=");
    }
  }

  setCookie(name, value) {
    this.cookies[name] = value;
    if (name === "x5sec") this.x5sec = value;
  }

  setX5sec(x5sec) {
    this.x5sec = x5sec || "";
    if (x5sec) this.cookies.x5sec = x5sec;
  }

  cookieHeader() {
    return Object.entries(this.cookies)
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => `${key}=${value}`)
      .join("; ");
  }

  refreshTokens(tokens) {
    if (!tokens) return;
    for (const key of ["bx-ua", "bx-umidtoken", "bx_et"]) {
      if (tokens[key]) this.tokens[key] = tokens[key];
    }
  }

  async _request(url, { method = "GET", body, captchaHeader, injectBx = true, referer, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS } = {}) {
    const headers = {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      Origin: API_BASE,
      Referer: referer || SIGNUP_URL,
      "x-csrf-token": CSRF,
      "x-requested-with": "XMLHttpRequest",
      "bx-v": BX_V,
      "sec-ch-ua": '"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": "Windows",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.Cookie = cookie;
    if (captchaHeader) headers["x-captcha-verify-param"] = captchaHeader;

    let payload = null;
    if (method === "POST" && body) {
      payload = { ...body };
      if (injectBx) {
        payload["bx-ua"] = this.tokens["bx-ua"] || "";
        payload["bx-umidtoken"] = this.tokens["bx-umidtoken"] || "";
        payload["bx_et"] = this.tokens["bx_et"] || "";
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("timeout"), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text().catch(() => "");
    const rawSetCookie = response.headers?.getSetCookie?.() || [];
    if (rawSetCookie.length) {
      parseSetCookie(rawSetCookie, this.cookies);
      if (this.cookies.x5sec) this.x5sec = this.cookies.x5sec;
    } else {
      const sc = response.headers?.get?.("set-cookie");
      if (sc) {
        parseSetCookie(sc, this.cookies);
        if (this.cookies.x5sec) this.x5sec = this.cookies.x5sec;
      }
    }
    const bxX5 = response.headers?.get?.("bx-x5sec");
    if (bxX5) {
      const m = /x5sec=([^;]+)/.exec(bxX5);
      if (m) this.setX5sec(m[1]);
    }

    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: response.status, headers: response.headers, text, json, ok: response.ok };
  }

  async checkLoginType(email) {
    return this._request(CHECK_LOGIN, { method: "POST", body: { email } });
  }

  async sendVerificationCode(email, captchaHeader) {
    return this._request(VERIFICATION_CODES, {
      method: "POST",
      body: { channel: "email", scene: "register", email },
      captchaHeader,
    });
  }

  async createUser({ email, password, name, otp }) {
    return this._request(USERS, {
      method: "POST",
      body: { type: "email_pwd", email, password, code: otp, name },
    });
  }

  async fetchMe() {
    return this._request(ME, { method: "GET", referer: API_BASE });
  }

  async createPat(name = "farm", expiresDays = 180) {
    const expiresAt = Date.now() + expiresDays * 24 * 60 * 60 * 1000;
    const result = await this._request(PAT_URL, {
      method: "POST",
      body: { name, expires_at: expiresAt },
      injectBx: false,
      referer: `${API_BASE}/account/integrations`,
    });
    if ((result.status !== 200 && result.status !== 201) || !result.json?.token) {
      throw new Error(`Qoder PAT create failed: HTTP ${result.status} ${result.text.slice(0, 200)}`);
    }
    return result.json;
  }
}

const BX_HARVEST_JS = `(() => {
  const o = { url: location.href, ts: Date.now(), err: [] };
  try {
    const s = window.__baxia__ || {};
    const post = s.postFYModule, get = s.getFYModule, et = s.etModule;
    if (post && post.fyObj && post.fyObj.startRecord) { try { post.fyObj.startRecord(); } catch (e) { o.err.push('sr:' + e); } }
    o['bx-ua'] = (post && post.getFYToken && post.getFYToken())
      || (window.baxiaCommon && baxiaCommon.getUA && baxiaCommon.getUA())
      || (get && get.getFYToken && get.getFYToken()) || '';
    o['bx-umidtoken'] = (post && post.getUidToken && post.getUidToken())
      || (get && get.getUidToken && get.getUidToken())
      || (window.baxiaCommon && baxiaCommon.getUmidToken && baxiaCommon.getUmidToken()) || '';
    o.bx_et = (et && (et.getETToken ? et.getETToken() : (et.getToken ? et.getToken() : null))) || '';
    if ((!o.bx_et || !o.bx_et.length) && window.AWSCFY) {
      try {
        const k = Object.keys(window.AWSCFY);
        for (const n of k) {
          const v = window.AWSCFY[n];
          if (v && typeof v.getETToken === 'function') { o.bx_et = v.getETToken(); break; }
          if (v && typeof v.getToken === 'function') { o.bx_et = v.getToken(); break; }
        }
      } catch (e) { o.err.push('et:' + e); }
    }
    o.cookie = document.cookie || '';
    o.ua_len = (o['bx-ua'] || '').length;
    o.umid_len = (o['bx-umidtoken'] || '').length;
    o.et_len = (o.bx_et || '').length;
  } catch (e) { o.err.push(String(e)); }
  return o;
})()`;

function bxReady(data) {
  if (!data || typeof data !== "object") return false;
  const ua = data["bx-ua"] || "";
  const umid = data["bx-umidtoken"] || "";
  if (!ua || ua === "default_not_fun" || ua === "null" || ua === "undefined") return false;
  if (ua.length < 40 || !umid || umid.length < 20) return false;
  return true;
}

/**
 * Harvest baxia bx tokens from a fresh (temporary) browser context.
 * The caller owns the context/page lifetime — the page must already be on
 * qoder.com. If no page is provided we launch a throwaway headless browser.
 */
export async function harvestQoderBxTokens({
  browser,
  page,
  proxyUrl = null,
  timeoutMs = 20_000,
  engine = "chromium",
} = {}) {
  let ownedBrowser = null;
  let ownedPage = null;
  try {
    let target = page;
    if (!target) {
      const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
      ownedBrowser = await launchBulkImportBrowser({
        engine,
        proxyUrl: proxyUrl || undefined,
        headless: true,
      });
      ownedPage = await ownedBrowser.newPage();
      target = ownedPage;
    }
    await target.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: Math.min(timeoutMs, 30_000) });

    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try {
        last = await target.evaluate(BX_HARVEST_JS);
      } catch (error) {
        last = { err: [String(error)], "bx-ua": "", "bx-umidtoken": "" };
      }
      if (bxReady(last)) break;
      await sleep(400);
    }
    if (!bxReady(last)) {
      // One retry: force reload — baxia sometimes needs a second load to boot.
      try {
        await target.goto(SIGNUP_URL, { waitUntil: "load", timeout: Math.min(timeoutMs, 30_000) });
      } catch {}
      const retryDeadline = Date.now() + Math.min(timeoutMs, 15_000);
      while (Date.now() < retryDeadline) {
        try {
          last = await target.evaluate(BX_HARVEST_JS);
        } catch {
          last = { err: [], "bx-ua": "", "bx-umidtoken": "" };
        }
        if (bxReady(last)) break;
        await sleep(500);
      }
    }
    if (!bxReady(last)) {
      throw new Error(`Qoder baxia tokens incomplete: ua=${last?.ua_len} umid=${last?.umid_len} url=${last?.url}`);
    }
    return {
      "bx-ua": last["bx-ua"],
      "bx-umidtoken": last["bx-umidtoken"],
      bx_et: last.bx_et || "",
      cookie: last.cookie || "",
      ts: last.ts || Date.now(),
      url: last.url || SIGNUP_URL,
      err: last.err || [],
    };
  } finally {
    if (ownedBrowser) await ownedBrowser.close().catch(() => null);
    if (ownedPage && !page) await ownedPage.close().catch(() => null);
  }
}

function isTmdBlock(body) {
  const ret = Array.isArray(body?.ret) ? body.ret : [];
  if (ret.some((x) => /FAIL_SYS_USER_VALIDATE|RGV587/.test(String(x)))) {
    const url = body?.data?.url;
    return { blocked: true, url: url || null };
  }
  if (body?.data && typeof body.data === "object" && /_____tmd_____/.test(String(body.data.url || ""))) {
    return { blocked: true, url: body.data.url || null };
  }
  return { blocked: false, url: null };
}

/**
 * Solve the TMD punish page in a live browser using a vision LLM.
 *
 * The punish URL is one-time — it must be opened immediately. We detect the
 * challenge type, capture the image grid + question, send them to the
 * caller-supplied visionSolver, click the matching cells, submit, then harvest
 * the x5sec cookie. Returns the x5sec value (or "").
 */
async function solveTmdWithBrowser({ browser, punishUrl, visionSolver, onStep }) {
  const { detectTmdCaptchaType, captureClickCaptcha, submitClickCaptcha, harvestX5secFromContext } = await import("./qoderCaptchaSolver.js");

  let context = null;
  let page = null;
  try {
    const existing = typeof browser.contexts === "function" ? browser.contexts() : [];
    context = existing[0] || await browser.newContext({ viewport: null });
    page = (context.pages?.() || []).find((p) => {
      try {
        const u = p.url() || "";
        return !u || u === "about:blank" || u.startsWith("about:");
      } catch { return true; }
    }) || await context.newPage();

    await page.goto(punishUrl.replace("https://qoder.com//", "https://qoder.com/"), {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await sleep(3500);

    const type = await detectTmdCaptchaType(page);
    onStep?.("tmd_type", `TMD captcha type: ${type.type}`);

    if (type.type === "click") {
      const captured = await captureClickCaptcha(page);
      let indexes = [];
      try {
        indexes = await visionSolver(captured, { page });
      } catch {
        indexes = [];
      }
      if (!Array.isArray(indexes) || !indexes.length) {
        onStep?.("tmd_vision_no_click", "Vision returned no grid indexes");
      } else {
        const submit = await submitClickCaptcha(page, indexes);
        if (submit.ok && submit.x5sec) return submit.x5sec;
      }
    }

    // Slider or fallback: give the sidecar-style drag a chance, then harvest.
    const x5 = await harvestX5secFromContext(context);
    if (x5) return x5;

    // After any submit/slide, re-check cookies for x5sec (server sets it async).
    for (let i = 0; i < 4; i += 1) {
      await sleep(800);
      const got = await harvestX5secFromContext(context);
      if (got) return got;
    }
    return "";
  } catch {
    try {
      const x5 = await harvestX5secFromContext(context || browser);
      if (x5) return x5;
    } catch {}
    return "";
  } finally {
    // Do NOT close the browser — the caller owns it. Close only a fresh page we made.
    if (page && context && context.pages?.().length === 1) {
      // keep the context alive; the caller reuses it.
    }
  }
}

function buildCaptchaHeader({ certifyId, sceneId, securityToken }) {
  const payload = {
    certifyId,
    sceneId,
    isSign: true,
    securityToken,
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export async function solveQoderCaptcha({ solverBase, proxyUrl, onStep } = {}) {
  const { solverHealth, solveAliyunCaptcha } = await import("./qoderSolverClient.js");
  onStep?.("solver", "checking");
  const health = await solverHealth({ base: solverBase });
  if (!health.ok) {
    throw new Error(
      "Qoder captcha solver is not running at the configured SOLVER_HTTP endpoint. "
      + "Start `qoder-solver` (solver_http.py on :8878) before running signup."
    );
  }
  onStep?.("captcha", "solving");
  const result = await solveAliyunCaptcha({ base: solverBase, proxy: proxyUrl || undefined });
  if (!result.ok || !result.securityToken) {
    throw new Error(`Qoder Aliyun captcha solve failed: ${result.error || "no securityToken"}`);
  }
  const header = buildCaptchaHeader({
    certifyId: result.certifyId,
    sceneId: result.sceneId || "1r7eif79x",
    securityToken: result.securityToken,
  });
  return { header, result };
}

export async function runQoderSignup({
  email,
  password,
  name,
  waitForOtp,
  solverBase,
  proxyUrl,
  onStep,
  registerAttempts = DEFAULT_REGISTER_ATTEMPTS,
  otpTimeoutMs = DEFAULT_OTP_TIMEOUT_MS,
  otpIntervalMs = DEFAULT_OTP_POLL_INTERVAL_MS,
  browser = null,
  visionSolver = null,
} = {}) {
  const { solverHealth } = await import("./qoderSolverClient.js");
  onStep?.("checking_solver", "Checking captcha solver");
  const health = await solverHealth({ base: solverBase });
  if (!health.ok) {
    throw new Error(
      "Qoder captcha solver is not running. Start qoder-solver (solver_http.py, :8878) first."
    );
  }

  // Harvest baxia tokens ONCE — the SDK is slow to boot and re-opening the
  // browser per attempt is wasteful and unreliable. Reuse the same tokens
  // across register attempts.
  onStep?.("harvesting_bx", "Harvesting baxia tokens");
  let tokens = await harvestQoderBxTokens({ proxyUrl }).catch((error) => {
    onStep?.("harvest_bx_failed", `Baxia harvest failed: ${error.message}`);
    return null;
  });
  if (!tokens) {
    throw new Error("bx_harvest_failed: could not harvest baxia tokens from qoder.com");
  }

  let lastError = "";
  for (let attempt = 1; attempt <= registerAttempts; attempt += 1) {
    onStep?.("signup_attempt", `Signup attempt ${attempt}/${registerAttempts}`);

    const client = new QoderSignupHttpClient({ tokens, cookie: tokens.cookie || "", proxyUrl });

    onStep?.("check_login_type", "Checking email login type");
    const check = await client.checkLoginType(email);
    if (check.status !== 200) {
      lastError = `check_login_type:${check.status}:${check.text.slice(0, 200)}`;
      continue;
    }

    onStep?.("solving_captcha", "Solving Aliyun captcha");
    let captchaHeader;
    try {
      const solved = await solveQoderCaptcha({ solverBase, proxyUrl });
      captchaHeader = solved.header;
    } catch (error) {
      lastError = `captcha:${error.message}`;
      continue;
    }

    onStep?.("sending_code", "Sending verification code");
    const vc = await client.sendVerificationCode(email, captchaHeader);
    if (vc.status !== 200) {
      lastError = `verificationCodes:${vc.status}:${vc.text.slice(0, 200)}`;
      continue;
    }

    onStep?.("waiting_otp", "Waiting for email OTP");
    let otp;
    try {
      otp = await waitForOtp({ timeoutMs: otpTimeoutMs, intervalMs: otpIntervalMs });
    } catch (error) {
      lastError = error.code === "QODER_OTP_TIMEOUT" ? "otp_timeout" : `otp:${error.message}`;
      continue;
    }

    // Refresh baxia tokens before /users — the server re-validates the bx
    // fingerprint against the account creation request. A fresh bx token
    // reduces the chance of FAIL_SYS_USER_VALIDATE (TMD) here.
    onStep?.("refreshing_bx", "Refreshing baxia tokens before account creation");
    try {
      const fresh = await harvestQoderBxTokens({ proxyUrl }).catch(() => null);
      if (fresh && bxReady(fresh)) {
        tokens = fresh;
        client.refreshTokens(fresh);
      }
    } catch {
      // Non-fatal — fall back to the pre-harvested tokens.
    }

    onStep?.("creating_user", "Creating Qoder account");
    const users = await client.createUser({ email, password, name, otp });
    onStep?.("users_response", `users st=${users.status} cookies=${Object.keys(client.cookies).length} x5sec_len=${(client.x5sec || "").length}`);
    let blocked = isTmdBlock(users.json);
    if (blocked.blocked) {
      onStep?.("tmd_blocked", `TMD required — ${(blocked.url || "").slice(0, 120)}`);
      let x5sec = client.x5sec;
      let x5Detail = null;

      // Preferred: solve the live punish page in a browser with the vision LLM
      // (image-matching captcha). The punish URL is one-time, so it must be
      // opened immediately in a live browser.
      if (!x5sec && blocked.url && browser && visionSolver) {
        onStep?.("tmd_vision_solve", "Solving TMD captcha with vision LLM");
        x5sec = await solveTmdWithBrowser({ browser, punishUrl: blocked.url, visionSolver, onStep }).catch(() => "");
        if (!x5sec) x5Detail = { error: "vision_solve_failed" };
      }

      // Fallback: solver sidecar (slider only) or direct retry.
      if (!x5sec && blocked.url) {
        const { solveX5sec } = await import("./qoderSolverClient.js");
        const x5 = await solveX5sec({ punishUrl: blocked.url, proxy: proxyUrl });
        x5Detail = x5;
        if (x5.ok && x5.x5sec) x5sec = x5.x5sec;
      }
      if (!x5sec) {
        // Fallback: sometimes a plain retry with the (fresh) session cookie
        // passes TMD on the second attempt — the punish page sets a cookie
        // on GET that satisfies the check. Try once before giving up.
        onStep?.("tmd_retry_direct", "TMD without x5sec — trying direct retry");
        const direct = await client.createUser({ email, password, name, otp }).catch(() => null);
        if (direct && !isTmdBlock(direct.json).blocked && (direct.status === 200 || direct.status === 201)) {
          users = direct;
        } else {
          lastError = `tmd_no_x5sec:${JSON.stringify(x5Detail || {}).slice(0, 200)}`;
          continue;
        }
      } else {
        client.setX5sec(x5sec);
        const retry = await client.createUser({ email, password, name, otp });
        if (isTmdBlock(retry.json).blocked) {
          lastError = `tmd_still_blocked:${retry.text.slice(0, 200)}`;
          continue;
        }
        if (retry.status !== 200 && retry.status !== 201) {
          lastError = `users_retry:${retry.status}:${retry.text.slice(0, 200)}`;
          continue;
        }
        users = retry;
      }
    } else if (users.status !== 200 && users.status !== 201) {
      lastError = `users:${users.status}:${users.text.slice(0, 200)}`;
      continue;
    }

    // Confirm via /me when the body is empty or reports a generic ret code
    let user = users.json;
    const needsMe = !user || typeof user !== "object" || !Object.keys(user).length || user.ret;
    if (needsMe) {
      const me = await client.fetchMe();
      if (me.status === 200 && me.json) user = me.json;
      else {
        lastError = `register_uncertain:${me.status}:${me.text.slice(0, 200)}`;
        continue;
      }
    }

    onStep?.("creating_pat", "Creating Qoder personal access token");
    let patMeta;
    try {
      patMeta = await client.createPat("farm");
    } catch (error) {
      lastError = `pat:${error.message}`;
      continue;
    }

    onStep?.("signup_done", "Qoder signup complete");
    return {
      ok: true,
      email,
      password,
      name,
      otp,
      user,
      pat: patMeta.token,
      patMeta,
      cookies: { ...client.cookies },
      attempts: attempt,
    };
  }

  const error = new Error(lastError || "Qoder signup failed");
  error.code = "QODER_SIGNUP_FAILED";
  throw error;
}

export const __test__ = {
  API_BASE,
  SIGNUP_URL,
  CHECK_LOGIN,
  VERIFICATION_CODES,
  USERS,
  ME,
  PAT_URL,
  bxReady,
  isTmdBlock,
  buildCaptchaHeader,
  QoderSignupHttpClient,
};
