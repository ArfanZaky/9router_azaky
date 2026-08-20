/**
 * Freebuff (freebuff.com / codebuff.com) Google-SSO automation.
 *
 * Freebuff is a free, ad-supported coding agent. Accounts authenticate via
 * Google OAuth through a device-flow hybrid:
 *   1. HTTP  POST /api/auth/cli/code  → fingerprintId + loginUrl (auth_code)
 *   2. Browser: Google login → codebuff.com/login?auth_code=XXX
 *      → click "Continue with Google" → consent → redirect to /onboard
 *   3. HTTP  GET  /api/auth/cli/status → authToken (bearer for chat)
 *
 * The browser MUST initiate the OAuth flow (NextAuth PKCE is generated
 * server-side); doing signin/google via bare HTTP breaks the PKCE exchange.
 * This module is the browser-side half consumed by FreebuffBulkImportManager.
 */

import crypto from "node:crypto";

const FREEBUFF_BASE = "https://www.codebuff.com";
const FREEBUFF_LOGIN_PATH = "/login";
const FREEBUFF_ONBOARD_MARKER = "codebuff.com/onboard";
const FREEBUFF_HOME_MARKERS = ["codebuff.com/onboard", "codebuff.com/app", "codebuff.com/welcome"];
const DEFAULT_SHORT_TIMEOUT_MS = 20_000;

const EMAIL_INPUT_SELECTORS = [
  "#identifierId",
  'input[type="email"]',
  'input[name="identifier"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[inputmode="email"]',
  'input[placeholder*="email" i]',
  'input[id*="email" i]',
  'input[aria-label*="email" i]',
];
const PASSWORD_INPUT_SELECTORS = [
  'input[name="Passwd"]',
  'input[type="password"]',
  'input[autocomplete="current-password"]',
  'input[autocomplete="new-password"]',
  'input[placeholder*="password" i]',
  'input[id*="password" i]',
  'input[aria-label*="password" i]',
];
const NEXT_BUTTON_SELECTORS = [
  "#identifierNext",
  "#passwordNext",
  'button[type="submit"]',
  'button:has-text("Next")',
  'button:has-text("Continue")',
  'button:has-text("Lanjut")',
];
const CONSENT_SELECTORS = [
  "#submit_approve_access",
  "#approve_button",
  "#confirm",
  'button[type="submit"]',
  'button:has-text("Continue")',
  'button:has-text("Allow")',
  'button:has-text("Accept")',
  'button:has-text("I agree")',
  'button:has-text("I understand")',
  'button:has-text("Got it")',
  'button:has-text("Agree")',
  'button:has-text("Setuju")',
  'button:has-text("Terima")',
  'button:has-text("Izinkan")',
  'button:has-text("Lanjutkan")',
  'button:has-text("Mengerti")',
];

// Google "new user" / welcome / confirm screens (shown after password for fresh
// accounts) + codebuff onboarding confirm buttons. Clicking the first visible
// one advances the flow without getting stuck.
const CONFIRM_SCREEN_SELECTORS = [
  'button:has-text("Confirm")',
  'button:has-text("confirm")',
  'button:has-text("Continue")',
  'button:has-text("Get started")',
  'button:has-text("Let\'s go")',
  'button:has-text("Next")',
  'button:has-text("Done")',
  'button:has-text("Skip")',
  'button:has-text("Not now")',
  'button:has-text("I\'ll do it later")',
  'button:has-text("I will do this later")',
  '[role="button"]:has-text("Confirm")',
  '[role="button"]:has-text("Continue")',
  'a:has-text("Continue")',
  'a:has-text("Get started")',
];
const ACCOUNT_CHOOSER_SELECTORS = [
  '[data-identifier]',
  '[data-email]',
  'div[role="option"]',
  'button:has-text("Continue as")',
  'a:has-text("Continue as")',
  '[role="button"]:has-text("Continue as")',
  'li[data-identifier]',
  'div[data-identifier]',
];
const GOOGLE_BUTTON_SELECTORS = [
  'button:has-text("Google")',
  'a:has-text("Google")',
  '[role="button"]:has-text("Google")',
  'button:has-text("Continue with Google")',
  'a:has-text("Continue with Google")',
  'button:has-text("Sign in with Google")',
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fillFirst(page, selectors, value, { timeoutMs = 10_000 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible({ timeout: 1_500 }).catch(() => false);
    if (visible) {
      await locator.click({ timeout: 3_000 }).catch(() => null);
      await locator.fill(value, { timeout: timeoutMs }).catch(() => null);
      const current = await locator.inputValue().catch(() => "");
      if (current === value) return true;
    }
    // Fallback: direct DOM fill via evaluate (handles non-standard fields)
    const filled = await locator
      .evaluate((el, next) => {
        if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        )?.set;
        if (setter) setter.call(el, next);
        else el.value = next;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return el.value === next;
      }, value)
      .catch(() => false);
    if (filled) return true;
  }
  return false;
}

async function clickFirst(page, selectors, { timeoutMs = 8_000 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible({ timeout: 1_500 }).catch(() => false);
    if (!visible) continue;
    await locator.scrollIntoViewIfNeeded().catch(() => null);
    await locator.click({ timeout: timeoutMs }).catch(() => null);
    return true;
  }
  return false;
}

// Material-Design Google buttons (VfPpkd-vQzf8d = MD ripple overlay, jsname=V67aGc =
// submit button) — reference Python matches on these. `.first().click()` matches
// the reference's DOM `btn.click()` (no visibility gate).
async function clickFirstDom(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    await locator.click({ timeout: 3_000, force: true }).catch(() => null);
    return true;
  }
  return false;
}

// Full-page text sweep that clicks the first button whose text matches a known
// consent/confirm keyword (EN + ID), mirroring the reference Python consent handler.
const CONSENT_KEYWORDS = [
  "i understand", "i agree", "agree", "allow", "continue",
  "approve", "confirm", "accept", "got it", "accept all", "done",
  "i accept", "accept & continue", "sign in", "log in",
  "get started", "proceed", "next", "skip",
  "saya mengerti", "saya setuju", "setuju", "lanjutkan", "terima",
  "izinkan", "konfirmasi", "mengerti", "oke", "ya", "masuk", "mulai", "lanjut",
  "confirm", "create account", "welcome",
];

async function clickConsentByText(page) {
  try {
    return await page.evaluate((keywords) => {
      const buttons = document.querySelectorAll(
        "button, [role=\"button\"], span[role=\"button\"], input[type=\"submit\"], " +
        "span.VfPpkd-vQzf8d, div.VfPpkd-RLmnJb, [jsname=\"V67aGc\"]"
      );
      for (const btn of buttons) {
        const txt = (btn.textContent || btn.value || "").toLowerCase().trim();
        if (!txt) continue;
        if (keywords.some((k) => txt.includes(k) || txt === k)) {
          btn.click();
          if (btn.tagName === "SPAN" && btn.parentElement && btn.parentElement.tagName === "BUTTON") {
            btn.parentElement.click();
          }
          return txt;
        }
      }
      return null;
    }, CONSENT_KEYWORDS);
  } catch {
    return null;
  }
}

async function isOnGoogleLogin(page) {
  try {
    const url = page.url?.() || "";
    return /accounts\.google\.com/.test(url);
  } catch {
    return false;
  }
}

// Google considers the account signed in once we leave the login flow. Landing
// on myaccount.google.com (plain signin, no continue URL) still means cookies
// are valid — treat it as success and move on.
async function googleSignedIn(page) {
  try {
    const url = page.url?.() || "";
    if (/accounts\.google\.com/.test(url)) return false;
    if (/myaccount\.google\.com|accounts\.google\.com\/AccountChooser/.test(url)) return true;
    if (url.includes("codebuff.com")) return true;
    return /google\.com/.test(url);
  } catch {
    return false;
  }
}

/**
 * Detect that the browser reached a Freebuff page that indicates auth completed.
 * STRICT URL-based check only — a body-text sweep is unreliable because Google
 * signin screens contain words like "sign in" / "signed in" that false-positive.
 */
async function reachedFreebuff(page) {
  try {
    const url = page.url?.() || "";
    // Boarding markers (onboard / app / welcome) are definitive.
    if (FREEBUFF_HOME_MARKERS.some((m) => url.includes(m))) {
      return true;
    }
    // Any codebuff.com page that is NOT the login page (and not an OAuth
    // intermediate like accounts.google.com / google.com) counts as success.
    if (url.includes("codebuff.com") && !url.includes("/login") && !url.includes("google")) {
      return true;
    }
  } catch (e) {
    /* ignore */
  }
  return false;
}

async function runGoogleSignin(page, email, password) {
  if (!(await fillFirst(page, EMAIL_INPUT_SELECTORS, email))) return false;
  await clickFirst(page, NEXT_BUTTON_SELECTORS);
  // Wait for password field to appear
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const pwdVisible = await page
      .locator(PASSWORD_INPUT_SELECTORS.join(", "))
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (pwdVisible) break;
    await page.waitForTimeout(300);
  }
  if (!(await fillFirst(page, PASSWORD_INPUT_SELECTORS, password))) return false;
  await clickFirst(page, NEXT_BUTTON_SELECTORS);
  return true;
}

async function handleConsentScreens(page, { onStep }) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (await reachedFreebuff(page)) return true;
    if (await clickFirst(page, CONSENT_SELECTORS)) {
      onStep?.("consent_clicked", "Consent/agreement screen accepted");
      await page.waitForTimeout(1_500);
      continue;
    }
    // Google account chooser
    if (await clickFirst(page, ACCOUNT_CHOOSER_SELECTORS)) {
      onStep?.("account_chooser", "Selected account in Google chooser");
      await page.waitForTimeout(1_000);
      continue;
    }
    await page.waitForTimeout(500);
  }
  return reachedFreebuff(page);
}

async function clickContinueWithGoogle(page, { onStep }) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    // Prefer explicit selector matches first
    if (await clickFirstDom(page, GOOGLE_BUTTON_SELECTORS)) {
      onStep?.("continue_with_google", "Clicked Continue with Google");
      return true;
    }
    // Text sweep (like reference Python): any button/a whose text includes "google"
    try {
      const clicked = await page.evaluate(() => {
        const btns = document.querySelectorAll("button, a, [role=\"button\"]");
        for (const b of btns) {
          const t = (b.innerText || "").toLowerCase();
          if (t.includes("google")) {
            b.click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        onStep?.("continue_with_google", "Clicked Continue with Google (text match)");
        return true;
      }
    } catch {
      /* navigation race — retry */
    }
    await page.waitForTimeout(700);
  }
  return false;
}

/**
 * Browser-side Freebuff Google-SSO automation.
 *
 * Mirrors the reference Python flow (freebuff_register.py) that is proven to
 * work:
 *   1. accounts.google.com/signin → email → password → consent/ToS
 *   2. Once signed in (left accounts.google.com OR landed myaccount) →
 *      navigate codebuff.com/login?auth_code=XXX
 *   3. Click "Continue with Google" (text match) → codebuff starts NextAuth PKCE
 *   4. Handle account chooser + consent until redirected to /onboard|/app
 *
 * The browser MUST initiate the codebuff OAuth (NextAuth PKCE is generated
 * server-side); doing signin/google via bare HTTP breaks the PKCE exchange.
 *
 * @returns {Promise<{status:string, error?:string, browserAuthorized?:boolean}>}
 */
export async function runFreebuffGoogleAutomation({
  page,
  email,
  password,
  authCode,
  baseUrl = FREEBUFF_BASE,
  onStep = () => {},
  shortTimeoutMs = DEFAULT_SHORT_TIMEOUT_MS,
  proxyUrl = null,
  proxyDispatcher = null,
}) {
  if (!page) {
    return { status: "failed", error: "No page provided to Freebuff automation" };
  }
  try {
    onStep("starting", "Starting Freebuff Google-SSO automation");

    // 1. Google email + password + consent (single consolidated loop, mirroring
    //    handle_google_login from the reference Python).
    if (!(await isOnGoogleLogin(page))) {
      await page.goto("https://accounts.google.com/signin", {
        waitUntil: "domcontentloaded",
        timeout: shortTimeoutMs,
      });
      await page.waitForTimeout(1_000);
    }
    onStep("google_login", "Filling Google credentials");

    const googleDeadline = Date.now() + 120_000;
    let googleDone = false;
    while (Date.now() < googleDeadline) {
      if (await reachedFreebuff(page)) {
        onStep("browser_authorized", "Already at Freebuff after Google login");
        return { status: "success", browserAuthorized: true };
      }
      // Left Google entirely, or landed on myaccount (signin without continue URL
      // lands there) → account is signed in, cookies are valid.
      if (await googleSignedIn(page)) {
        onStep("google_signed_in", `Google login completed (${page.url?.()?.slice(0, 60) || "url?"})`);
        googleDone = true;
        break;
      }
      // Password step FIRST (#identifierId stays in the DOM after navigating to
      // the password page — filling it again would reset the flow).
      const pwdVisible = await page
        .locator(PASSWORD_INPUT_SELECTORS.join(", "))
        .first()
        .isVisible({ timeout: 400 })
        .catch(() => false);
      if (pwdVisible) {
        await fillFirst(page, PASSWORD_INPUT_SELECTORS, password);
        await clickFirstDom(page, ["#passwordNext button", "#passwordNext"]);
        await page.waitForTimeout(1_000);
        continue;
      }
      // Email step (only visible while on the identifier screen)
      const emailVisible = await page
        .locator(EMAIL_INPUT_SELECTORS.join(", "))
        .first()
        .isVisible({ timeout: 400 })
        .catch(() => false);
      if (emailVisible) {
        await fillFirst(page, EMAIL_INPUT_SELECTORS, email);
        await clickFirstDom(page, ["#identifierNext button", "#identifierNext"]);
        await page.waitForTimeout(800);
        continue;
      }
      // Consent/ToS/new-user screens (EN + ID, Material Design aware)
      if (await clickConsentByText(page)) {
        onStep("consent_clicked", "Consent/ToS/new-user screen accepted");
        await page.waitForTimeout(1_200);
        continue;
      }
      if (await clickFirstDom(page, ACCOUNT_CHOOSER_SELECTORS)) {
        onStep("account_chooser", "Selected account in Google chooser");
        await page.waitForTimeout(800);
        continue;
      }
      await page.waitForTimeout(600);
    }

    if (!googleDone && !(await reachedFreebuff(page))) {
      return {
        status: "needs_manual",
        error: "Google login did not complete automatically (may need manual confirm)",
        browserAuthorized: false,
      };
    }

    // 2. Navigate to Freebuff login with auth_code
    const loginUrl = `${baseUrl}${FREEBUFF_LOGIN_PATH}?auth_code=${encodeURIComponent(authCode || "")}`;
    onStep("navigating_login", "Navigating to Freebuff login");
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: shortTimeoutMs });
    await page.waitForTimeout(1_500);

    // 3. Click "Continue with Google" (text match, like the reference)
    onStep("continue_with_google", "Clicking Continue with Google");
    const clicked = await clickContinueWithGoogle(page, { onStep });
    if (!clicked) {
      return { status: "failed", error: "Continue with Google button not found" };
    }
    await page.waitForTimeout(3_000);

    // 4. Handle account chooser + consent until Freebuff onboard page
    const oauthDeadline = Date.now() + 120_000;
    while (Date.now() < oauthDeadline) {
      if (await reachedFreebuff(page)) {
        onStep("success_page_reached", "OAuth completed, reached Freebuff");
        return { status: "success", browserAuthorized: true };
      }
      // Account chooser — click matching account first (like the reference)
      if (await clickFirstDom(page, [`[data-identifier="${email}"]`, ACCOUNT_CHOOSER_SELECTORS[0]])) {
        onStep("account_chooser", "Selected matching Google account");
        await page.waitForTimeout(800);
        continue;
      }
      // Consent / ToS / new-user screens
      if (await clickConsentByText(page)) {
        onStep("consent_clicked", "OAuth consent accepted");
        await page.waitForTimeout(1_200);
        continue;
      }
      if (await clickFirstDom(page, ACCOUNT_CHOOSER_SELECTORS)) {
        onStep("account_chooser", "Selected Google account");
        await page.waitForTimeout(800);
        continue;
      }
      await page.waitForTimeout(600);
    }

    return { status: "needs_manual", error: "OAuth did not complete automatically", browserAuthorized: false };
  } catch (error) {
    return { status: "failed", error: error?.message || "Freebuff automation failed" };
  }
}

/**
 * HTTP device-flow helpers (Node side). Shared with the bulk import manager.
 */
export async function requestFreebuffDeviceCode({
  proxyUrl = null,
  proxyDispatcher = null,
  baseUrl = FREEBUFF_BASE,
} = {}) {
  const raw = crypto.randomBytes(32).toString("hex");
  const fingerprintId = `nexus-fb-${raw.slice(0, 16)}`;
  const fingerprintHash = crypto.createHash("sha256").update(raw).digest("hex");

  const requestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ fingerprintId }),
  };
  if (proxyDispatcher) requestInit.dispatcher = proxyDispatcher;

  const response = await fetch(`${baseUrl}/api/auth/cli/code`, requestInit);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Freebuff device code request failed (${response.status}): ${error}`);
  }
  const data = await response.json();
  if (!data.loginUrl || !data.loginUrl.includes("auth_code=")) {
    throw new Error("Freebuff device flow response missing loginUrl/auth_code");
  }
  const authCode = data.loginUrl.split("auth_code=")[1];
  // Server returns the authoritative fingerprintId/fingerprintHash/expiresAt —
  // prefer those over the client-generated ones (server hash is what polling
  // validates against).
  return {
    ...data,
    authCode,
    fingerprintId: data.fingerprintId || fingerprintId,
    fingerprintHash: data.fingerprintHash || fingerprintHash,
  };
}

export async function pollFreebuffToken(
  fingerprint,
  {
    proxyUrl = null,
    proxyDispatcher = null,
    baseUrl = FREEBUFF_BASE,
    timeoutMs = 120_000,
    intervalMs = 2_000,
  } = {}
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const params = new URLSearchParams({
      fingerprintId: fingerprint.fingerprintId,
      fingerprintHash: fingerprint.fingerprintHash || "",
      expiresAt: String(fingerprint.expiresAt || 0),
    });
    const requestInit = { method: "GET", headers: { Accept: "application/json" } };
    if (proxyDispatcher) requestInit.dispatcher = proxyDispatcher;
    const response = await fetch(`${baseUrl}/api/auth/cli/status?${params.toString()}`, requestInit);
    const statusCode = response.status;
    let data = null;
    try {
      data = await response.json();
    } catch {
      data = { raw: await response.text().catch(() => "") };
    }
    if (statusCode === 200) {
      const status = data?.status || "pending";
      const user = data?.user || {};
      const token = user.authToken || data.authToken || null;
      if ((status === "ready" || token) && token) {
        return {
          token,
          email: user.email || "",
          userId: user.id || "",
        };
      }
    }
    await wait(intervalMs);
  }
  throw new Error("Freebuff token polling timeout");
}

export const __test__ = {
  FREEBUFF_BASE,
  fillFirst,
  clickFirst,
  clickFirstDom,
  clickConsentByText,
  googleSignedIn,
  isOnGoogleLogin,
  requestFreebuffDeviceCode,
  pollFreebuffToken,
};
