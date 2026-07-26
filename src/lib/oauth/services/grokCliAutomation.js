/**
 * Grok CLI Google SSO Automation
 * 
 * Handles the device code + Google login flow for auth.x.ai:
 * 1. Navigate to verification_uri with user_code
 * 2. Auto-fill device code (if needed)
 * 3. Click "Continue" button (Image 1)
 * 4. Click "Login with Google" button (Image 2)
 * 5. Delegate to Google automation (kiroGoogleAutomation.js)
 * 6. Wait for authorization completion
 */

import { runGoogleAccountAutomation } from "./googleAutomation.js";
import {
  GROK_DEVICE_CODE_INPUT_SELECTORS,
  GROK_CONTINUE_BUTTON_SELECTORS,
  GROK_GOOGLE_LOGIN_BUTTON_SELECTORS,
  GROK_ALLOW_BUTTON_SELECTORS,
  GROK_COOKIE_BUTTON_SELECTORS,
  GROK_AUTH_PAGE_MARKERS,
  GROK_AUTH_SUCCESS_MARKERS,
  GROK_AUTH_ERROR_MARKERS,
  GROK_MANUAL_ASSIST_MARKERS,
  GROK_CLI_SHORT_TIMEOUT_MS,
  GROK_CLI_LABEL,
} from "../constants/grok.js";

const DEFAULT_TIMEOUT_MS = GROK_CLI_SHORT_TIMEOUT_MS;

/** Compact page snapshot for debugging stuck flows */
async function debugPageSnapshot(page, tag = "snap") {
  try {
    const url = page?.url?.() || "(no-url)";
    const closed = page?.isClosed?.() || false;
    let title = "";
    let buttons = [];
    let inputs = [];
    let bodyPreview = "";
    if (!closed) {
      const info = await page.evaluate(() => {
        const btns = [...document.querySelectorAll("button, [role=button], a, input[type=submit]")]
          .slice(0, 20)
          .map((el) => {
            const t = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ");
            return t ? t.slice(0, 60) : el.tagName;
          })
          .filter(Boolean);
        const inps = [...document.querySelectorAll("input")]
          .slice(0, 12)
          .map((el) => ({
            name: el.name || "",
            type: el.type || "",
            value: String(el.value || "").slice(0, 24),
            ph: el.placeholder || "",
          }));
        return {
          title: document.title || "",
          body: (document.body?.innerText || "").slice(0, 280).replace(/\s+/g, " "),
          buttons: btns,
          inputs: inps,
        };
      }).catch((e) => ({ title: "", body: `evaluate_err:${e.message}`, buttons: [], inputs: [] }));
      title = info.title;
      buttons = info.buttons;
      inputs = info.inputs;
      bodyPreview = info.body;
    }
    console.log(
      `[GrokCLI:DBG] ${tag} | closed=${closed} | URL=${url} | title=${JSON.stringify(title)} | buttons=${JSON.stringify(buttons)} | inputs=${JSON.stringify(inputs)} | body=${JSON.stringify(bodyPreview)}`
    );
  } catch (e) {
    console.log(`[GrokCLI:DBG] ${tag} snapshot failed: ${e.message}`);
  }
}

/**
 * Get all interaction scopes (main page + frames)
 */
function getInteractionScopes(page) {
  const frames = typeof page.frames === "function" ? page.frames() : [];
  return [page, ...frames.filter((frame) => frame !== page.mainFrame?.())];
}

/**
 * Read page text from all scopes
 */
async function readPageText(page) {
  const chunks = [];
  for (const scope of getInteractionScopes(page)) {
    try {
      chunks.push(await scope.evaluate(() => document.body?.innerText || ""));
    } catch {
      // Cross-origin frames may be unreadable
    }
  }
  return chunks.join("\n");
}

/**
 * Check if text contains any markers
 */
function includesAny(text, markers) {
  const normalized = String(text || "").toLowerCase();
  return markers.some((marker) => normalized.includes(marker));
}

/**
 * Check if page is a Grok auth page
 */
function isGrokAuthPage(page) {
  try {
    const url = new URL(page.url());
    return url.hostname === "auth.x.ai" 
      || url.hostname === "accounts.x.ai"
      || url.hostname.endsWith(".x.ai");
  } catch {
    return false;
  }
}

/**
 * Click first visible selector from list
 */
async function clickFirstVisible(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      await locator.click({ timeout: 5_000 }).catch(() => null);
      return true;
    }
  }
  return false;
}

/**
 * Get first visible locator
 */
async function getFirstVisibleLocator(page, selectors) {
  for (const scope of getInteractionScopes(page)) {
    for (const selector of selectors) {
      const locator = scope.locator(selector).first();
      const count = await locator.count().catch(() => 0);
      if (!count) continue;

      const visible = await locator.isVisible().catch(() => false);
      if (!visible) continue;

      return locator;
    }
  }
  return null;
}

/**
 * Fill device code if input is present.
 * If URL already has user_code= and input matches, skip typing (avoids flaky click timeouts).
 */
async function fillDeviceCodeIfNeeded(page, userCode, reportStep) {
  if (!userCode) return false;

  try {
    await page.waitForLoadState("domcontentloaded", { timeout: 5_000 });
    await page.waitForTimeout(800);
  } catch (e) {
    console.log("[GrokCLI] Page load wait skipped:", e.message);
  }

  const pageUrl = page.url() || "";
  const input = await getFirstVisibleLocator(page, GROK_DEVICE_CODE_INPUT_SELECTORS);

  // Prefer reading current value without click (cookie overlay often blocks click)
  let currentValue = "";
  if (input) {
    currentValue = await input.inputValue().catch(() => "");
  }
  console.log(
    `[GrokCLI] fillDeviceCode | urlHasCode=${pageUrl.includes("user_code=")} | inputFound=${Boolean(input)} | currentValue=${JSON.stringify(currentValue)} | expected=${userCode}`
  );

  // Already correct (prefilled via verification_uri_complete)
  if (currentValue === userCode || (pageUrl.includes(`user_code=${userCode}`) && (!currentValue || currentValue === userCode))) {
    // Ensure value is set via evaluate if empty but URL has code
    if (input && currentValue !== userCode) {
      await input.evaluate((el, code) => {
        el.value = code;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, userCode).catch(() => null);
      currentValue = await input.inputValue().catch(() => userCode);
    }
    if (currentValue === userCode || pageUrl.includes(`user_code=${userCode}`)) {
      reportStep("device_code_prefilled", `Device code already present: ${userCode}`);
      console.log("[GrokCLI] Skipping type — code prefilled");
      return true;
    }
  }

  if (!input) {
    await debugPageSnapshot(page, "fill_no_input");
    // URL-only path: still treat as OK so Continue can proceed
    if (pageUrl.includes(`user_code=${userCode}`)) {
      reportStep("device_code_url_only", "No input found but user_code in URL");
      return true;
    }
    return false;
  }

  reportStep("filling_device_code", `Filling device code: ${userCode}`);

  // Prefer evaluate fill (no click) — more reliable with overlays
  try {
    await input.evaluate((el, code) => {
      el.setAttribute("autocomplete", "off");
      el.focus();
      el.value = "";
      el.value = code;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, userCode);
    await page.waitForTimeout(300);
    const filled = await input.inputValue().catch(() => "");
    console.log(`[GrokCLI] evaluate-fill result: expected=${userCode} got=${filled}`);
    if (filled === userCode) {
      reportStep("device_code_filled", `Device code filled via evaluate: ${userCode}`);
      return true;
    }
  } catch (e) {
    console.log("[GrokCLI] evaluate-fill failed:", e.message);
  }

  // Fallback: type with force click
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await input.click({ timeout: 5_000, force: true }).catch(() => null);
      await page.keyboard.press("Control+A");
      await page.keyboard.press("Backspace");
      await input.type(userCode, { delay: 30 });
      await page.waitForTimeout(400);
      const filled = await input.inputValue().catch(() => "");
      console.log(`[GrokCLI] type-fill attempt ${attempt}: expected=${userCode} got=${filled}`);
      if (filled === userCode) {
        reportStep("device_code_filled", `Device code filled via type: ${userCode}`);
        return true;
      }
    } catch (error) {
      console.error(`[GrokCLI] type-fill attempt ${attempt} error:`, error.message);
    }
  }

  await debugPageSnapshot(page, "fill_failed");
  // Last resort: URL has the code
  if (pageUrl.includes(`user_code=${userCode}`)) {
    reportStep("device_code_url_fallback", "Fill flaky but user_code in URL — continue");
    return true;
  }
  reportStep("device_code_fill_failed", "Failed to fill device code correctly");
  return false;
}

/**
 * Dismiss accounts.x.ai cookie banner (covers Allow on consent page)
 */
async function dismissGrokCookieBanner(page, reportStep) {
  try {
    const text = await readPageText(page);
    if (
      !text.includes("Accept All Cookies") &&
      !text.includes("Accept all cookies") &&
      !text.includes("Cookies Settings")
    ) {
      return false;
    }
    reportStep("dismissing_cookie_banner", "Dismissing cookie banner");
    const clicked = await clickFirstVisible(page, GROK_COOKIE_BUTTON_SELECTORS);
    if (clicked) {
      reportStep("cookie_banner_dismissed", "Cookie banner dismissed");
      await page.waitForTimeout(1000);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Click Continue button (Image 1 → Image 2)
 */
async function clickContinueButton(page, reportStep) {
  const urlBefore = page.url();
  reportStep("clicking_continue", "Clicking Continue button");
  console.log(`[GrokCLI] continue before URL=${urlBefore}`);
  await debugPageSnapshot(page, "before_continue");

  let clicked = await clickFirstVisible(page, GROK_CONTINUE_BUTTON_SELECTORS);
  if (!clicked) {
    clicked = await page.evaluate(() => {
      const labels = ["continue", "next", "submit"];
      const buttons = [...document.querySelectorAll("button, [role=button], input[type=submit]")];
      for (const b of buttons) {
        const t = (b.innerText || b.value || "").trim().toLowerCase();
        if (labels.some((l) => t === l || t.startsWith(l))) {
          b.scrollIntoView({ block: "center" });
          b.click();
          return t;
        }
      }
      return null;
    }).catch(() => null);
    if (clicked) console.log(`[GrokCLI] continue force-click label=${clicked}`);
  }

  if (clicked) {
    reportStep("continue_clicked", "Continue button clicked");
    // Wait for navigation away from pure device entry toward sign-in / consent
    try {
      await page.waitForURL(
        (u) => {
          const s = String(u);
          return (
            s.includes("/sign-in") ||
            s.includes("/oauth2/device/consent") ||
            s.includes("/oauth2/device/done") ||
            s.includes("accounts.google.com")
          );
        },
        { timeout: 15_000 }
      );
    } catch {
      console.log(`[GrokCLI] continue: no navigation within 15s, URL still ${page.url()}`);
    }
    await page.waitForTimeout(1000);
    console.log(`[GrokCLI] continue after URL=${page.url()}`);
    await debugPageSnapshot(page, "after_continue");
    return true;
  }

  console.log("[GrokCLI] continue: no button found");
  await debugPageSnapshot(page, "continue_not_found");
  return false;
}

/**
 * Click "Login with Google" button (Image 2)
 */
async function clickGoogleLoginButton(page, reportStep) {
  reportStep("clicking_google_login", "Clicking Login with Google");
  for (let attempt = 1; attempt <= 5; attempt++) {
    console.log(`[GrokCLI] google_login attempt ${attempt} URL=${page.url()}`);
    await debugPageSnapshot(page, `google_login_attempt_${attempt}`);

    // If still on device entry page, try Continue again
    const u = page.url() || "";
    if (u.includes("/oauth2/device") && !u.includes("consent") && !u.includes("done") && !u.includes("sign-in")) {
      console.log("[GrokCLI] Still on device page — clicking Continue before Google login");
      await clickContinueButton(page, reportStep);
      await page.waitForTimeout(1500);
    }

    let clicked = await clickFirstVisible(page, GROK_GOOGLE_LOGIN_BUTTON_SELECTORS);
    if (!clicked) {
      clicked = await page.evaluate(() => {
        const needles = ["google", "login with google", "continue with google", "sign in with google"];
        const els = [...document.querySelectorAll("button, a, [role=button]")];
        for (const el of els) {
          const t = (el.innerText || el.getAttribute("aria-label") || "").trim().toLowerCase();
          if (needles.some((n) => t.includes(n))) {
            el.scrollIntoView({ block: "center" });
            el.click();
            return t.slice(0, 40);
          }
        }
        return null;
      }).catch(() => null);
      if (clicked) console.log(`[GrokCLI] google force-click: ${clicked}`);
    }

    if (clicked) {
      reportStep("google_login_clicked", `Login with Google clicked (attempt ${attempt})`);
      try {
        await page.waitForURL((url) => String(url).includes("google.com"), { timeout: 20_000 });
      } catch {
        console.log(`[GrokCLI] After Google click, URL still ${page.url()}`);
      }
      await page.waitForTimeout(1000);
      console.log(`[GrokCLI] after google click URL=${page.url()}`);
      return true;
    }
    reportStep("google_login_retry", `Login with Google not found — wait (attempt ${attempt}/5)`);
    await page.waitForTimeout(2000);
  }
  await debugPageSnapshot(page, "google_login_failed");
  return false;
}

/**
 * Handle Google Workspace "Welcome to new account" page
 * This page appears for new Google Workspace for Education accounts
 */
async function handleGoogleWorkspaceWelcome(page, reportStep) {
  try {
    const text = await readPageText(page);
    
    // Check if we're on the "Welcome to your new account" page
    if (text.includes("Welcome to your new account") || 
        text.includes("Your school manages this account")) {
      reportStep("google_workspace_welcome", "Handling Google Workspace welcome page");
      
      // Selectors for "I understand" button
      const selectors = [
        'button:has-text("I understand")',
        '#gaplustosNext',
        'button[jsname="Njthtb"]',
        'button.VfPpkd-LgbsSe:has-text("I understand")',
      ];
      
      const clicked = await clickFirstVisible(page, selectors);
      if (clicked) {
        reportStep("workspace_welcome_accepted", "Clicked 'I understand' button");
        await page.waitForTimeout(2000);
        return true;
      }
    }
    return false;
  } catch (error) {
    console.log('[GrokCLI] Error handling workspace welcome:', error.message);
    return false;
  }
}

/**
 * Main Grok CLI Google SSO automation
 * 
 * @param {Object} options
 * @param {Object} options.page - Playwright page
 * @param {string} options.verificationUri - Device code verification URL
 * @param {string} options.userCode - Device code (e.g., "8DV8-MWFW")
 * @param {string} options.email - Google email
 * @param {string} options.password - Google password
 * @param {Promise} options.successPromise - Promise that resolves when device code is authorized
 * @param {Function} options.onStep - Step callback
 * @returns {Promise<Object>} { status, error?, ... }
 */
export async function runGrokCliGoogleAutomation({
  page,
  verificationUri,
  userCode,
  email,
  password,
  successPromise,
  shortTimeoutMs = DEFAULT_TIMEOUT_MS,
  onStep,
}) {
  const reportStep = (step, message) => {
    let url = "(closed)";
    try {
      url = page?.isClosed?.() ? "(closed)" : page.url();
    } catch {
      url = "(error)";
    }
    console.log(`[GrokCLI:${email}] [${step}] ${message} | URL: ${url}`);
    onStep?.(step, message);
  };

  const assertPageOpen = () => {
    if (!page || page.isClosed?.()) {
      const err = new Error("Browser page closed (job cancelled or browser exited)");
      err.code = "PAGE_CLOSED";
      throw err;
    }
  };

  try {
    console.log(
      `[GrokCLI:${email}] START | userCode=${userCode} | verificationUri=${verificationUri} | shortTimeoutMs=${shortTimeoutMs} | pageClosed=${page?.isClosed?.()}`
    );

    // Step 1: Navigate to verification URI
    reportStep("opening_verification_page", "Opening Grok CLI verification page");
    assertPageOpen();
    await page.goto(verificationUri, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2000);
    console.log(`[GrokCLI:${email}] after goto URL=${page.url()}`);
    await debugPageSnapshot(page, "after_goto");

    // Step 2: Check if we're on the right page
    if (!isGrokAuthPage(page)) {
      await debugPageSnapshot(page, "not_grok_auth");
      return {
        status: "failed",
        error: `Not on Grok auth page after navigation: ${page.url()}`,
      };
    }

    // Cookie banner can appear early on accounts.x.ai
    await dismissGrokCookieBanner(page, reportStep);
    await debugPageSnapshot(page, "after_cookie");

    // Step 3: Check if we are actually on the device code page
    const initialUrl = page.url();
    console.log(`[GrokCLI:${email}] initialUrl=${initialUrl}`);
    if (initialUrl.includes("/oauth2/device") && !initialUrl.includes("/consent") && !initialUrl.includes("/done")) {
      const codeFilled = await fillDeviceCodeIfNeeded(page, userCode, reportStep);
      console.log(`[GrokCLI:${email}] codeFilled=${codeFilled}`);
      if (codeFilled || initialUrl.includes("user_code=") || userCode) {
        const continueClicked = await clickContinueButton(page, reportStep);
        console.log(`[GrokCLI:${email}] continueClicked=${continueClicked} URL=${page.url()}`);
        if (!continueClicked) {
          reportStep("continue_not_found", "Continue button not found, proceeding anyway");
        }
      }
    } else {
      reportStep("skip_device_code", `Not on device code page: ${initialUrl}`);
    }

    // Step 5: Wait for login options page to appear
    await page.waitForTimeout(1500);
    const text = await readPageText(page);

    // Check if we reached the login options page (Image 2)
    if (!text.toLowerCase().includes("log into your account") && 
        !text.toLowerCase().includes("login with google")) {
      reportStep("waiting_for_login_page", "Waiting for login options page");
      await page.waitForTimeout(2000);
    }

    // Step 6: Click "Login with Google" button
    const googleClicked = await clickGoogleLoginButton(page, reportStep);
    if (!googleClicked) {
      return {
        status: "failed",
        error: "Could not find or click 'Login with Google' button",
      };
    }

    // Wait for navigation to Google (do NOT reload mid-flow)
    try {
      await page.waitForURL((url) => {
        try {
          return new URL(url).hostname.includes("google.com");
        } catch {
          return false;
        }
      }, { timeout: 30_000 });
    } catch {
      reportStep("google_nav_timeout", "Timed out waiting for Google login page");
    }
    await page.waitForTimeout(1500);

    // Step 7: Google SSO UI only (manager polls token AFTER /done — early poll kills device_code)
    reportStep("starting_google_automation", "Starting Google SSO automation");

    const result = await runGoogleAccountAutomation({
      page,
      authUrl: page.url(),
      email,
      password,
      successPromise: null,
      shortTimeoutMs,
      serviceLabel: GROK_CLI_LABEL,
      openingStep: "continuing_google_flow",
      openingMessage: "Continuing with Google authentication",
      successStep: "grok_browser_authorized",
      successMessage: "Grok browser authorize complete",
      onStep,
      skipNavigation: true,
    });

    console.log(
      `[GrokCLI:${email}] Google automation result: status=${result.status} browserAuthorized=${result.browserAuthorized} error=${result.error || "-"} | URL: ${page.url()}`
    );
    await debugPageSnapshot(page, "after_google_automation");

    if (result.status === "success" && (result.accessToken || result.access_token || result.tokens)) {
      return { status: "success", tokens: result.tokens || result };
    }
    if (result.status === "success" && result.browserAuthorized) {
      console.log(`[GrokCLI:${email}] browserAuthorized=true — manager will poll`);
      return result;
    }

    // Step 8: Drive x.ai to /done, then signal manager to poll
    reportStep("checking_post_redirect", "Handling post-Google x.ai pages (poll after /done)");
    await page.waitForTimeout(2000);
    await handleGoogleWorkspaceWelcome(page, reportStep);

    const deadline = Date.now() + (shortTimeoutMs || 120_000);
    let postGoogleDeviceSettled = false;
    while (Date.now() < deadline) {
      let url = "";
      try { url = page.url(); } catch { break; }

      if (url.includes("/oauth2/device/done")) {
        reportStep("already_authorized", "On device done page — ready for token poll");
        reportStep("browser_authorized", "Browser device authorization complete");
        return { status: "success", browserAuthorized: true };
      }

      if (url.includes("exchange-token-error")) {
        reportStep("exchange_token_error", "xAI exchange-token-error page — SSO callback failed");
        return {
          status: "failed",
          error: "xAI exchange-token-error after Google login (device code / session mismatch)",
        };
      }

      if (url.includes("/oauth2/device/consent")) {
        reportStep("consent_page_detected", "On Grok consent page");
        await dismissGrokCookieBanner(page, reportStep);
        // Scroll permissions list so Allow/Authorize at bottom is visible
        for (let s = 0; s < 4; s++) {
          try {
            await page.evaluate(() => {
              const root = document.scrollingElement || document.documentElement || document.body;
              if (root) root.scrollTop = root.scrollHeight;
              window.scrollBy(0, 800);
            });
          } catch { /* ignore */ }
          await page.waitForTimeout(400);
        }
        // Wait up to 8s for Allow/Authorize (after cookie banner)
        let allowClicked = false;
        for (let attempt = 0; attempt < 8 && !allowClicked; attempt++) {
          allowClicked = await clickFirstVisible(page, GROK_ALLOW_BUTTON_SELECTORS);
          if (allowClicked) break;
          const forced = await page.evaluate(() => {
            const labels = ["allow", "authorize", "approve"];
            const buttons = [...document.querySelectorAll("button, [role=button], input[type=submit]")];
            for (const b of buttons) {
              const t = (b.innerText || b.value || "").trim().toLowerCase();
              if (labels.some((l) => t === l || t.startsWith(l + " "))) {
                if (b.disabled) return null;
                b.scrollIntoView({ block: "center" });
                b.click();
                return t;
              }
            }
            return null;
          }).catch(() => null);
          if (forced) {
            allowClicked = true;
            reportStep("consent_approved", `Force-clicked consent: ${forced}`);
            break;
          }
          await page.waitForTimeout(1000);
        }
        if (allowClicked) {
          reportStep("consent_approved", "Clicked Allow/Authorize");
          try {
            await page.waitForURL("**/oauth2/device/done", { timeout: 20_000 });
            reportStep("browser_authorized", "Reached /done after consent");
            return { status: "success", browserAuthorized: true };
          } catch {
            await page.waitForTimeout(2000);
          }
        } else {
          reportStep("consent_allow_not_found", "Allow/Authorize still not found on consent page");
          await page.waitForTimeout(1000);
        }
        continue;
      }

      if (
        url.includes("/oauth2/device") &&
        !url.includes("/consent") &&
        !url.includes("/done")
      ) {
        // After Google: user_code is already bound via verification_uri_complete.
        // Do NOT re-type user_code — that can create a new session and leave device_code unbound.
        if (!postGoogleDeviceSettled) {
          reportStep("device_page_settle", "Back on device page after Google — waiting 10s for load");
          await page.waitForTimeout(10_000);
          postGoogleDeviceSettled = true;
        }
        reportStep("post_redirect_continue", "Clicking Continue (no re-type of user_code)");
        const cont = await clickContinueButton(page, reportStep);
        if (!cont) {
          await page.waitForTimeout(1500);
        } else {
          await page.waitForTimeout(2000);
        }
        continue;
      }

      await handleGoogleWorkspaceWelcome(page, reportStep);
      await page.waitForTimeout(800);
    }

    // If Google loop already left us on done
    try {
      if (page.url().includes("/oauth2/device/done")) {
        reportStep("browser_authorized", "Browser device authorization complete");
        return { status: "success", browserAuthorized: true };
      }
    } catch { /* ignore */ }

    return result?.status === "needs_manual"
      ? result
      : {
          status: "failed",
          error: result?.error || "Grok CLI browser did not reach device authorized page",
        };

  } catch (error) {
    reportStep("automation_error", `Automation error: ${error.message}`);
    return {
      status: "failed",
      error: error.message || "Grok CLI Google automation failed",
    };
  }
}

/**
 * Detect if authorization completed successfully
 */
export async function detectGrokAuthSuccess(page) {
  const text = await readPageText(page);
  return includesAny(text, GROK_AUTH_SUCCESS_MARKERS);
}

/**
 * Detect if authorization failed
 */
export async function detectGrokAuthError(page) {
  const text = await readPageText(page);
  return includesAny(text, GROK_AUTH_ERROR_MARKERS);
}

/**
 * Detect if manual assist is needed
 */
export async function detectGrokManualAssist(page) {
  const text = await readPageText(page);
  return includesAny(text, GROK_MANUAL_ASSIST_MARKERS);
}

/**
 * Export for testing
 */
export const __test__ = {
  isGrokAuthPage,
  fillDeviceCodeIfNeeded,
  clickContinueButton,
  clickGoogleLoginButton,
  readPageText,
};
