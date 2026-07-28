import {
  clickContinueButton,
  clickFirstVisible,
  dismissGrokCookieBanner,
  fillDeviceCodeIfNeeded,
  readPageText,
} from "./grokCliAutomation.js";
import { GrokDomainOtpClient } from "./grokDomainOtpClient.js";
import {
  GROK_ALLOW_BUTTON_SELECTORS,
} from "../constants/grok.js";
import crypto from "node:crypto";

const XAI_AUTHORIZE_URL = "https://auth.x.ai/oauth2/authorize";
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_REDIRECT_URI = "http://127.0.0.1:56121/callback";
const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";

const SIGN_UP_SELECTORS = [
  'button:text-is("Sign up")',
  'a:text-is("Sign up")',
  '[role="button"]:text-is("Sign up")',
  'button:text-is("Create account")',
];
const EMAIL_LOGIN_SELECTORS = [
  'button:has-text("Login with email")',
  'button:has-text("Sign in with email")',
  'button:has-text("Continue with email")',
  'a:has-text("Login with email")',
];
const EMAIL_SIGNUP_SELECTORS = [
  'button:text-is("Sign up with email")',
  '[role="button"]:text-is("Sign up with email")',
  'a:text-is("Sign up with email")',
  'button:text-is("Continue with email")',
  'button:text-is("Use email")',
];
const EMAIL_INPUT_SELECTORS = [
  'input[type="email"]',
  'input[name="email"]',
  'input[autocomplete="email"]',
];
const PASSWORD_INPUT_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="current-password"]',
];
const OTP_INPUT_SELECTORS = [
  'input[name*="code" i]',
  'input[autocomplete="one-time-code"]',
  'input[maxlength="1"]',
  'input[inputmode="numeric"]',
  'input[placeholder*="code" i]',
];
const SUBMIT_SELECTORS = [
  'button[type="submit"]',
  'button:has-text("Continue")',
  'button:has-text("Next")',
  'button:has-text("Confirm")',
  'button:has-text("Verify")',
];
const FIRST_NAME_SELECTORS = [
  'input[name="firstName"]',
  'input[name="first_name"]',
  'input[name="given_name"]',
  'input[name*="first" i]',
  'input[autocomplete="given-name"]',
  'input[placeholder*="First" i]',
];
const LAST_NAME_SELECTORS = [
  'input[name="lastName"]',
  'input[name="last_name"]',
  'input[name="family_name"]',
  'input[name*="last" i]',
  'input[autocomplete="family-name"]',
  'input[placeholder*="Last" i]',
];
const COMPLETE_SIGNUP_SELECTORS = [
  'button:text-is("Complete sign up")',
  'button:text-is("Complete Sign Up")',
  'button:text-is("Create account")',
  'button:text-is("Continue")',
];

async function fillFirst(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (!await locator.isVisible().catch(() => false)) continue;
    await locator.fill(value, { timeout: 10_000 });
    return true;
  }
  return false;
}

async function waitForAny(page, selectors, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
    }
    await page.waitForTimeout(500);
  }
  return null;
}

async function waitAndClick(page, selectors, timeoutMs = 20_000) {
  const locator = await waitForAny(page, selectors, timeoutMs);
  if (!locator) return false;
  await locator.scrollIntoViewIfNeeded().catch(() => null);
  await locator.click({ timeout: 10_000 });
  return true;
}

function normalizeOtp(code) {
  return String(code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

async function readOtpValue(page) {
  return page.evaluate(() => {
    const normalize = (value) => String(value || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const roots = [...document.querySelectorAll('input[name="code"], input[autocomplete="one-time-code"]')];
    for (const input of roots) {
      const value = normalize(input.value);
      if (value.length >= 3) return value;
    }
    const slots = [...document.querySelectorAll('input[maxlength="1"]')];
    return normalize(slots.map((input) => input.value || "").join(""));
  }).catch(() => "");
}

async function softClearOtp(page) {
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => null);
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Backspace").catch(() => null);
  }
}

async function focusOtp(page) {
  for (const selector of ['input[maxlength="1"]', 'input[name="code"]', 'input[autocomplete="one-time-code"]']) {
    const locator = page.locator(selector).first();
    if (!await locator.count().catch(() => 0)) continue;
    if (await locator.isDisabled().catch(() => true)) continue;
    if (await locator.click({ timeout: 2_000 }).then(() => true).catch(() => false)) return true;
    if (await locator.focus().then(() => true).catch(() => false)) return true;
  }
  return false;
}

async function fillXaiOtp(page, rawCode) {
  const code = normalizeOtp(rawCode);
  if (code.length !== 6) throw new Error(`Unexpected xAI OTP length: ${code.length}`);

  for (let round = 0; round < 3; round++) {
    if (await focusOtp(page)) {
      await softClearOtp(page);
      await page.keyboard.type(code, { delay: 40 });
      await page.waitForTimeout(250);
      if (await readOtpValue(page) === code) return true;
    }

    const slots = page.locator('input[maxlength="1"]');
    const slotCount = await slots.count().catch(() => 0);
    if (slotCount > 0) {
      for (let index = 0; index < Math.min(6, slotCount); index++) {
        const slot = slots.nth(index);
        await slot.click({ timeout: 2_000 }).catch(() => null);
        await page.keyboard.press("Backspace").catch(() => null);
        await page.keyboard.type(code[index], { delay: 30 }).catch(() => null);
      }
      await page.waitForTimeout(250);
      if (await readOtpValue(page) === code) return true;
    }
    await page.waitForTimeout(350 * (round + 1));
  }
  return false;
}

async function finishOtpVerification(page, reportStep, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readPageText(page);
    if (/expected string, received undefined|invalid input|incorrect|expired|try again/i.test(text)) {
      throw new Error("xAI rejected the OTP");
    }

    const profileVisible = Boolean(await waitForAny(
      page,
      [...FIRST_NAME_SELECTORS, ...LAST_NAME_SELECTORS, ...PASSWORD_INPUT_SELECTORS],
      250
    ));
    if (profileVisible || /complete your sign up/i.test(text)) {
      reportStep("otp_auto_confirmed", "xAI accepted OTP and opened the signup profile");
      return true;
    }
    if (!/verify your email|confirmation code|validation code/i.test(text)) {
      reportStep("otp_auto_confirmed", "xAI accepted OTP automatically");
      return true;
    }
    // xAI auto-submits after the sixth character. Never click/resubmit here;
    // doing so races the navigation to the First name / Last name form.
    await page.waitForTimeout(500);
  }
  return false;
}

function profileNames(email) {
  const local = String(email || "user").split("@", 1)[0];
  const words = local.split(/[^A-Za-z]+/).filter(Boolean);
  const capitalize = (value, fallback) => {
    const clean = String(value || fallback).slice(0, 24);
    return clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
  };
  return {
    first: capitalize(words[0], "Cloud"),
    last: capitalize(words[1], "Verra"),
  };
}

async function completeSignupProfile(page, email, password, reportStep) {
  const profileReady = await waitForAny(page, [...FIRST_NAME_SELECTORS, ...LAST_NAME_SELECTORS, ...PASSWORD_INPUT_SELECTORS], 15_000);
  if (!profileReady) {
    const text = await readPageText(page);
    if (/verify your email|confirmation code|validation code/i.test(text)) {
      throw new Error("xAI did not advance from OTP to the signup profile");
    }
    return true;
  }

  const { first, last } = profileNames(email);
  reportStep("completing_signup_profile", "Completing xAI signup profile");
  await fillFirst(page, FIRST_NAME_SELECTORS, first);
  await fillFirst(page, LAST_NAME_SELECTORS, last);
  const singleName = page.locator('input[name="name"], input[autocomplete="name"], input[placeholder*="Name" i]').first();
  if (await singleName.isVisible().catch(() => false)) await singleName.fill(`${first} ${last}`);
  await fillFirst(page, PASSWORD_INPUT_SELECTORS, password);

  const turnstileStartedAt = Date.now();
  const automaticGraceDeadline = turnstileStartedAt + 15_000;
  const extendedManualDeadline = turnstileStartedAt + 10 * 60_000;
  let checkingReported = false;
  let manualReported = false;
  let profileSubmitted = false;
  let extendedWaitReported = false;
  let lastManualElapsedBucket = 0;
  while (!page.isClosed?.()) {
    const text = await readPageText(page);
    const profileStillVisible = Boolean(await waitForAny(
      page,
      [...FIRST_NAME_SELECTORS, ...LAST_NAME_SELECTORS, ...PASSWORD_INPUT_SELECTORS],
      250
    ));
    if (!profileStillVisible && !/complete your sign up/i.test(text)) return true;
    await dismissGrokCookieBanner(page, reportStep);

    const turnstile = await page.evaluate(() => {
      const response = document.querySelector(
        'input[name="cf-turnstile-response"], textarea[name="cf-turnstile-response"]'
      );
      let apiToken = "";
      try {
        if (window.turnstile && typeof window.turnstile.getResponse === "function") {
          apiToken = String(window.turnstile.getResponse() || "");
        }
      } catch {
        apiToken = "";
      }
      const token = String(response?.value || apiToken || "");
      return { solved: token.length > 20 };
    }).catch(() => ({ solved: false }));

    if (turnstile.solved && !profileSubmitted) {
      reportStep(
        manualReported ? "turnstile_completed" : "turnstile_auto_verified",
        manualReported
          ? "Cloudflare verification completed; submitting signup profile"
          : "Cloudflare automatic verification completed; submitting signup profile"
      );
      profileSubmitted = true;
      await clickFirstVisible(page, COMPLETE_SIGNUP_SELECTORS);
      await page.waitForTimeout(2_000);
      continue;
    }

    if (!checkingReported) {
      reportStep("turnstile_checking", "Waiting for Cloudflare automatic verification");
      checkingReported = true;
    }

    if (Date.now() >= automaticGraceDeadline && !manualReported) {
      reportStep(
        "manual_turnstile_required",
        "Cloudflare verification requires manual completion in the open browser; waiting without resubmitting"
      );
      manualReported = true;
    }

    if (manualReported) {
      const elapsedSeconds = Math.floor((Date.now() - turnstileStartedAt) / 1000);
      const elapsedBucket = Math.floor(elapsedSeconds / 30);
      if (elapsedBucket > lastManualElapsedBucket) {
        reportStep(
          "manual_turnstile_required",
          `Waiting for manual Cloudflare verification (${elapsedSeconds}s); no profile refill or resubmit`
        );
        lastManualElapsedBucket = elapsedBucket;
      }
      if (Date.now() >= extendedManualDeadline && !extendedWaitReported) {
        reportStep(
          "manual_turnstile_required",
          "Cloudflare verification has waited 10 minutes; browser remains open and recoverable until completion or cancellation"
        );
        extendedWaitReported = true;
      }
    }
    await page.waitForTimeout(1_000);
  }
  if (page.isClosed?.()) throw new Error("Browser closed while waiting for signup verification");
  return false;
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(96));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function callbackCode(url) {
  try {
    const parsed = new URL(url);
    if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) return null;
    if (!parsed.pathname.includes("/callback")) return null;
    return parsed.searchParams.get("code");
  } catch {
    return null;
  }
}

async function obtainPkceTokens({ page, email, password, proxyDispatcher, reportStep }) {
  const { verifier, challenge } = createPkce();
  const state = base64Url(crypto.randomBytes(24));
  const nonce = crypto.randomBytes(16).toString("hex");
  const authorizeUrl = new URL(XAI_AUTHORIZE_URL);
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: XAI_CLIENT_ID,
    redirect_uri: XAI_REDIRECT_URI,
    scope: XAI_SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    plan: "generic",
    referrer: "cli-proxy-api",
  })) authorizeUrl.searchParams.set(key, value);

  let authorizationCode = null;
  const captureCallback = async (route) => {
    const code = callbackCode(route.request().url());
    if (!code) return route.continue();
    authorizationCode = code;
    await route.abort().catch(() => null);
  };
  await page.route("**/*", captureCallback);
  try {
    reportStep("starting_pkce_authorization", "Starting Grok CLI PKCE authorization");
    await page.goto(authorizeUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => null);
    const deadline = Date.now() + 120_000;
    while (!authorizationCode && Date.now() < deadline) {
      authorizationCode = callbackCode(page.url()) || authorizationCode;
      if (authorizationCode) break;

      await dismissGrokCookieBanner(page, reportStep);
      const url = page.url();
      if (url.includes("/oauth2/consent")) {
        const approved = await clickFirstVisible(page, GROK_ALLOW_BUTTON_SELECTORS);
        if (approved) reportStep("approving_pkce_consent", "Approving Grok CLI PKCE consent");
      } else {
        const emailInput = await waitForAny(page, EMAIL_INPUT_SELECTORS, 250);
        const passwordInput = await waitForAny(page, PASSWORD_INPUT_SELECTORS, 250);
        if (!emailInput && !passwordInput) await clickFirstVisible(page, EMAIL_LOGIN_SELECTORS);
        if (emailInput) await emailInput.fill(email);
        if (passwordInput) await passwordInput.fill(password);
        if (emailInput || passwordInput) await clickFirstVisible(page, SUBMIT_SELECTORS);
      }
      await page.waitForTimeout(750);
    }
  } finally {
    await page.unroute("**/*", captureCallback).catch(() => null);
  }
  if (!authorizationCode) throw new Error("Grok CLI PKCE callback code was not captured");

  reportStep("exchanging_pkce_token", "Exchanging Grok CLI PKCE code for tokens");
  const requestInit = {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: XAI_CLIENT_ID,
      code: authorizationCode,
      redirect_uri: XAI_REDIRECT_URI,
      code_verifier: verifier,
    }),
  };
  if (proxyDispatcher) requestInit.dispatcher = proxyDispatcher;
  const response = await fetch(XAI_TOKEN_URL, requestInit);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    throw new Error(`Grok CLI PKCE token exchange failed (${response.status}): ${payload.error_description || payload.error || "missing access token"}`);
  }
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    idToken: payload.id_token || null,
    expiresIn: payload.expires_in,
    scope: payload.scope,
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
    id_token: payload.id_token,
    expires_in: payload.expires_in,
  };
}

export async function runGrokCliDomainAutomation({
  page,
  verificationUri,
  userCode,
  email,
  password,
  proxyDispatcher,
  onStep,
  otpClient = new GrokDomainOtpClient(),
}) {
  const reportStep = (step, message) => onStep?.(step, message);
  const abortController = new AbortController();
  const abortOnClose = () => abortController.abort(new Error("Browser closed while waiting for OTP"));
  page.once?.("close", abortOnClose);

  try {
    reportStep("opening_verification_page", "Opening Grok CLI verification page");
    await page.goto(verificationUri, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await dismissGrokCookieBanner(page, reportStep);
    await fillDeviceCodeIfNeeded(page, userCode, reportStep);
    await clickContinueButton(page, reportStep);
    await page.waitForTimeout(1500);

    const baseline = await otpClient.getLatestCode(email, abortController.signal).catch(() => null);
    const baselineCode = baseline?.code || null;

    reportStep("starting_domain_signup", "Starting xAI domain email signup");
    let loginMode = false;
    let clickedSignup = await waitAndClick(page, SIGN_UP_SELECTORS, 20_000);
    if (!clickedSignup) {
      clickedSignup = await waitAndClick(page, EMAIL_LOGIN_SELECTORS, 5_000);
      if (clickedSignup) {
        loginMode = true;
        reportStep("existing_account_login", "Using xAI email login");
      }
    }
    if (!clickedSignup) {
      return { status: "failed", error: "Could not find xAI Sign up or Login with email" };
    }

    if (!loginMode) {
      reportStep("opening_signup_methods", "Opening xAI account creation methods");
      await dismissGrokCookieBanner(page, reportStep);
      const emailSignupClicked = await waitAndClick(page, EMAIL_SIGNUP_SELECTORS, 30_000);
      if (!emailSignupClicked) {
        const pageText = await readPageText(page);
        return {
          status: "failed",
          error: /create your account/i.test(pageText)
            ? "Create your account page opened, but Sign up with email button was not clickable"
            : "xAI Create your account page did not show Sign up with email",
        };
      }
      reportStep("email_signup_selected", "Selected Sign up with email");
    }

    const emailInput = await waitForAny(page, EMAIL_INPUT_SELECTORS, 30_000);
    if (!emailInput) return { status: "failed", error: "xAI email input not found" };
    await emailInput.fill(email);
    reportStep("entering_domain_email", "Entering domain email");
    await clickFirstVisible(page, SUBMIT_SELECTORS);
    await page.waitForTimeout(1200);

    const passwordInput = await waitForAny(page, PASSWORD_INPUT_SELECTORS, 12_000);
    if (passwordInput) {
      await passwordInput.fill(password);
      reportStep("entering_domain_password", "Entering domain email password");
      await clickFirstVisible(page, SUBMIT_SELECTORS);
      await page.waitForTimeout(1200);
    }

    const textAfterSubmit = (await readPageText(page)).toLowerCase();
    if (/already exists|already registered|sign in instead|account exists/.test(textAfterSubmit)) {
      reportStep("existing_account_detected", "Account exists; switching to email login");
      await clickFirstVisible(page, EMAIL_LOGIN_SELECTORS);
      await fillFirst(page, EMAIL_INPUT_SELECTORS, email);
      await fillFirst(page, PASSWORD_INPUT_SELECTORS, password);
      await clickFirstVisible(page, SUBMIT_SELECTORS);
    }

    let otpInput = await waitForAny(page, OTP_INPUT_SELECTORS, 30_000);
    const otpPageText = (await readPageText(page)).toLowerCase();
    const waitingForOtp = Boolean(otpInput) || /validation codes sent|confirmation code|check your (?:email|inbox)|spam\/junk/.test(otpPageText);
    if (waitingForOtp) {
      reportStep("waiting_domain_otp", "Waiting continuously for a fresh domain email OTP");
      let pollCount = 0;
      const code = await otpClient.waitForCode(email, {
        baselineCode,
        signal: abortController.signal,
        onPoll: () => {
          pollCount += 1;
          // Avoid filling the job log every three seconds during long xAI cooldowns.
          if (pollCount === 1 || pollCount % 20 === 0) {
            reportStep("polling_domain_otp", "Still waiting for a fresh domain email OTP; no resend attempted");
          }
        },
      });
      reportStep("confirming_domain_otp", "Confirming domain email OTP with OTP service");
      await otpClient.confirm(email, code, abortController.signal);
      otpInput ||= await waitForAny(page, OTP_INPUT_SELECTORS, 30_000);
      if (!otpInput) {
        return { status: "failed", error: "Fresh OTP received, but xAI OTP input was not found" };
      }
      const otpFilled = await fillXaiOtp(page, code);
      if (!otpFilled) {
        return { status: "failed", error: "Failed to enter all 6 xAI OTP characters" };
      }
      reportStep("submitting_domain_otp", "Submitting domain email OTP to xAI");
      await dismissGrokCookieBanner(page, reportStep);
      if (!await finishOtpVerification(page, reportStep, 30_000)) {
        return { status: "failed", error: "xAI remained on Verify your email after OTP submission" };
      }
    }

    await completeSignupProfile(page, email, password, reportStep);

    // farm.py succeeds reliably by switching to PKCE after signup. The original
    // device grant is only used to enter the account flow; it is not redeemed.
    const tokens = await obtainPkceTokens({ page, email, password, proxyDispatcher, reportStep });
    return { status: "success", tokens };
  } catch (error) {
    return {
      status: "failed",
      error: error.message || "Grok domain email automation failed",
    };
  } finally {
    page.off?.("close", abortOnClose);
  }
}

export const __test__ = {
  fillFirst,
  waitForAny,
  waitAndClick,
  normalizeOtp,
  profileNames,
  finishOtpVerification,
  callbackCode,
  createPkce,
};
