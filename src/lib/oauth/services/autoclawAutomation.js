import { runGoogleAccountAutomation } from "./kiroGoogleAutomation.js";

const AUTOCLAW_WEB_URL = "https://autoclaw.z.ai/web/";
const DEFAULT_SHORT_TIMEOUT_MS = 90_000;
const DEFAULT_MANUAL_TIMEOUT_MS = 15 * 60_000;

// Selectors for AutoClaw web login gate
const AUTOCLAW_LOGIN_BUTTON_SELECTORS = [
  'button:has-text("去注册")',
  'button:has-text("登录")',
  'button:has-text("Sign in")',
  'button:has-text("Login")',
  '[class*="login-gate"] button',
  '[class*="login"] button',
];

const AUTOCLAW_ZAI_BUTTON_SELECTORS = [
  'button:has-text("Continue with Zai")',
  'button:has-text("Zai")',
  '[aria-label*="Zai"]',
  '[class*="zai"] button',
];

/**
 * Poll all browser context pages for AutoClaw tokens in localStorage.
 *
 * Flow: after Google login + Z.ai authorize, the popup redirects back to
 * autoclaw.z.ai/web/?webOAuthCallback=zai. The web app processes the callback,
 * stores tokens in localStorage, then may close the popup and refresh tab 0.
 *
 * This monitor polls every 500ms across ALL context pages (popup + main tab)
 * to catch the token regardless of which tab ends up with it.
 */
export function createAutoclawTokenMonitor(context, timeoutMs = DEFAULT_MANUAL_TIMEOUT_MS) {
  let resolveOuter;
  let rejectOuter;
  const promise = new Promise((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  let settled = false;
  let intervalHandle = null;
  const timeoutHandle = setTimeout(() => {
    if (intervalHandle) clearInterval(intervalHandle);
    settle(null, new Error("Timed out waiting for AutoClaw token in localStorage"));
  }, timeoutMs);

  function settle(result, error = null) {
    if (settled) return;
    settled = true;
    if (intervalHandle) clearInterval(intervalHandle);
    clearTimeout(timeoutHandle);
    if (error) rejectOuter(error);
    else resolveOuter(result);
  }

  async function checkPage(page) {
    try {
      const url = page.url();
      if (!url.includes("autoclaw.z.ai")) return false;

      const data = await page.evaluate(() => {
        try {
          const authToken = localStorage.getItem("autoclaw.web.authToken") || "";
          const refreshToken = localStorage.getItem("autoclaw.web.refreshToken") || "";
          const deviceId = localStorage.getItem("autoclaw.web.deviceId") || "";
          const loginInfoRaw = localStorage.getItem("autoclaw.web.loginInfo") || "{}";
          const loginInfo = JSON.parse(loginInfoRaw);
          return { authToken, refreshToken, deviceId, loginInfo };
        } catch {
          return null;
        }
      });

      if (!data) return false;

      if (!data.authToken || !data.refreshToken) return false;

      settle({
        access_token: data.authToken.replace(/^Bearer\s+/i, ""),
        refresh_token: data.refreshToken.replace(/^Bearer\s+/i, ""),
        user_id: data.loginInfo.user_id || "",
        user_name: data.loginInfo.user_name || "",
        device_id: data.deviceId || "",
        first_login: data.loginInfo.first_login ?? false,
      });
      return true;
    } catch {
      // page may be closed or navigating — skip
      return false;
    }
  }

  intervalHandle = setInterval(async () => {
    if (settled) return;
    const pages = context.pages();
    for (const p of pages) {
      if (await checkPage(p)) return;
    }
  }, 500);

  return promise;
}

/**
 * Run the AutoClaw web login flow:
 *
 * 1. Navigate to autoclaw.z.ai/web/
 * 2. Click login/register button → login modal appears
 * 3. Click "Continue with Zai" → new tab opens to chat.z.ai/auth
 * 4. On the Z.ai tab, runGoogleAccountAutomation handles:
 *    a. Click "Continue with Google" on Z.ai (via handleProviderLoginGate)
 *    b. Google email + password + workspace terms + consent
 *    c. Z.ai authorize page (checkbox + Continue)
 * 5. Redirect back to autoclaw.z.ai/web/?webOAuthCallback=zai
 * 6. Token monitor extracts access_token + refresh_token + deviceId from localStorage
 *
 * Tab handling:
 * - "Continue with Zai" opens a popup tab (chat.z.ai/auth)
 * - Google login happens entirely in the popup
 * - After redirect back, popup may close and main tab refreshes
 * - Token monitor polls ALL tabs to catch tokens regardless
 * - If no popup opens (same-tab redirect), fallback to running on main page
 */
export async function runAutoclawGoogleAutomation({
  page,
  email,
  password,
  deviceId: _deviceId, // unused — web app generates its own
  callbackPromise,
  shortTimeoutMs = DEFAULT_SHORT_TIMEOUT_MS,
  onStep,
}) {
  const reportStep = (step, message) => onStep?.(step, message);

  // 1. Navigate to AutoClaw web app
  reportStep("opening_autoclaw_web", "Opening AutoClaw web app");
  await page.goto(AUTOCLAW_WEB_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000 + Math.floor(Math.random() * 1500));

  // 2. Click login/register button to open login modal
  reportStep("clicking_autoclaw_login", "Clicking AutoClaw login button");
  const loginClicked = await clickFirstVisible(page, AUTOCLAW_LOGIN_BUTTON_SELECTORS);
  if (!loginClicked) {
    return {
      status: "failed",
      error: "Could not find AutoClaw login button. The web UI may have changed.",
    };
  }
  await page.waitForTimeout(1500 + Math.floor(Math.random() * 1000));

  // 3. Click "Continue with Zai" — opens a new tab (popup)
  reportStep("clicking_continue_with_zai", "Clicking Continue with Zai");
  const zaiClicked = await clickFirstVisible(page, AUTOCLAW_ZAI_BUTTON_SELECTORS);
  if (!zaiClicked) {
    return {
      status: "failed",
      error: "Could not find 'Continue with Zai' button on AutoClaw login modal.",
    };
  }

  // 4. Wait for the Z.ai auth popup tab to open.
  //    Fallback: if no popup opens within 10s, assume same-tab redirect.
  const context = page.context();
  let popup = null;
  let isPopup = false;

  try {
    popup = await context.waitForEvent("page", { timeout: 10_000 });
    await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 });
    isPopup = true;
    reportStep("zai_popup_opened", "Z.ai auth popup tab opened — starting Google login");
  } catch {
    reportStep("zai_same_tab", "No popup detected — Z.ai auth may load in same tab");
    popup = page;
  }

  try {
    await popup.waitForSelector(
      [
        'button:has-text("Continue with Google")',
        'button:has-text("Google")',
        'a:has-text("Google")',
        '[role="button"]:has-text("Google")',
        'button.ButtonContinueWithGoogle',
        'button[class*="ContinueWithGoogle"]',
        'input[type="email"]',
        'input[autocomplete="username"]',
        'input[placeholder*="Email" i]',
        'button:has-text("Login")',
        'button:has-text("Sign in")',
      ].join(", "),
      { state: "visible", timeout: 15_000 }
    );
  } catch {
    return {
      status: "failed",
      error: "Z.ai auth page did not render login form or Google button.",
    };
  }
  reportStep("zai_ready", "Z.ai auth page ready — starting automation");

  // 5. Run Google account automation on the popup (or main page).
  //    skipNavigation=true because we're already on the Z.ai auth page.
  //    handleProviderLoginGate clicks "Continue with Google" on Z.ai,
  //    then the loop handles Google email/password/consent/workspace-terms,
  //    and finally the Z.ai authorize page (checkbox + Continue).
  //    callbackPromise (token monitor) resolves when localStorage has tokens.
  const result = await runGoogleAccountAutomation({
    page: popup,
    skipNavigation: true,
    email,
    password,
    successPromise: callbackPromise,
    shortTimeoutMs,
    serviceLabel: "AutoClaw",
    openingStep: "starting_google_login",
    openingMessage: "Starting Google login via Z.ai",
    successStep: "autoclaw_token_extracted",
    successMessage: "AutoClaw token extracted from localStorage",
    onStep,
  });

  // 6. Cleanup: close the popup tab if it was a separate tab.
  //    Main page (tab 0) stays open — context close handled by bulk import manager.
  if (isPopup && popup !== page) {
    await popup.close().catch(() => null);
  }

  return result;
}

// --- helpers ---

async function clickFirstVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 })) {
        await loc.click({ timeout: 5000 });
        return true;
      }
    } catch {
      // try next selector
    }
  }
  return false;
}
