import {
  clickContinueButton,
  clickFirstVisible,
  dismissGrokCookieBanner,
  fillDeviceCodeIfNeeded,
  readPageText,
} from "./grokCliAutomation.js";
import { GrokDomainOtpClient } from "./grokDomainOtpClient.js";
import { obtainGrokCliPkceTokens, __test__ as pkceTest } from "./grokCliPkce.js";
import {
  GROK_ALLOW_BUTTON_SELECTORS,
} from "../constants/grok.js";

const SIGN_UP_SELECTORS = [
  'button:text-is("Sign up")',
  'a:text-is("Sign up")',
  '[role="button"]:text-is("Sign up")',
  'button:text-is("Create account")',
];
const EMAIL_LOGIN_SELECTORS = [
  'button:has-text("Login with email")',
  '[role="button"]:has-text("Login with email")',
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
  'input[name="username"]',
  'input[autocomplete="email"]',
  'input[autocomplete="username"]',
  'input[inputmode="email"]',
  'input[placeholder*="email" i]',
  'input[placeholder*="Email" i]',
  'input[id*="email" i]',
  'input[aria-label*="email" i]',
];
const PASSWORD_INPUT_SELECTORS = [
  'input[type="password"]',
  'input[name="password"]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="current-password"]',
  'input[placeholder*="password" i]',
  'input[id*="password" i]',
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
    const count = await locator.count().catch(() => 0);
    if (!count) continue;
    const visible = await locator.isVisible().catch(() => false);
    if (visible) {
      await locator.click({ timeout: 3_000 }).catch(() => null);
      await locator.fill(value, { timeout: 10_000 }).catch(() => null);
      const current = await locator.inputValue().catch(() => "");
      if (current === value) return true;
    }
    // xAI sometimes renders a non-standard field that fails isVisible/fill.
    const filled = await locator.evaluate((el, next) => {
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
      el.focus();
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.value = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return el.value === next;
    }, value).catch(() => false);
    if (filled) return true;
  }
  return false;
}

async function waitForAny(page, selectors, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible().catch(() => false)) return locator;
      // Attached but not yet "visible" to Playwright (opacity/animation).
      if (await locator.count().catch(() => 0)) return locator;
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
    if (slots.length) return normalize(slots.map((input) => input.value || "").join(""));
    if (roots[0]) return normalize(roots[0].value);
    return "";
  }).catch(() => "");
}

async function otpInputsReady(page) {
  return page.evaluate(() => {
    const pick = document.querySelector(
      'input[name="code"], input[autocomplete="one-time-code"], input[maxlength="1"]'
    );
    return Boolean(pick && !pick.disabled);
  }).catch(() => false);
}

async function softClearOtp(page) {
  for (const key of ["Control+A", "Meta+A"]) {
    await page.keyboard.press(key).catch(() => null);
  }
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press("Backspace").catch(() => null);
  }
}

async function typeOtpChars(page, code, delayMs = 40) {
  const focused = page.locator("input:focus").first();
  if (await focused.count().catch(() => 0)) {
    if (typeof focused.pressSequentially === "function") {
      await focused.pressSequentially(code, { delay: delayMs }).catch(() => null);
      return;
    }
  }
  await page.keyboard.type(code, { delay: delayMs }).catch(async () => {
    for (const char of code) {
      await page.keyboard.press(char).catch(async () => {
        await page.keyboard.insertText(char).catch(() => null);
      });
    }
  });
}

async function focusOtp(page) {
  for (const selector of ['input[maxlength="1"]', 'input[name="code"]', 'input[autocomplete="one-time-code"]']) {
    const locator = page.locator(selector).first();
    if (!await locator.count().catch(() => 0)) continue;
    if (await locator.isDisabled().catch(() => false)) continue;
    if (await locator.click({ timeout: 2_000 }).then(() => true).catch(() => false)) return true;
    if (await locator.click({ timeout: 1_200, force: true }).then(() => true).catch(() => false)) return true;
    if (await locator.focus().then(() => true).catch(() => false)) return true;
  }
  return page.evaluate(() => {
    const el = document.querySelector(
      'input[maxlength="1"], input[name="code"], input[autocomplete="one-time-code"]'
    );
    if (!el) return false;
    el.focus();
    return true;
  }).catch(() => false);
}

async function pasteOtp(page, code) {
  return page.evaluate((value) => {
    const el = document.querySelector(
      'input[name="code"], input[autocomplete="one-time-code"]'
    ) || document.querySelector('input[maxlength="1"]');
    if (!el) return false;
    el.focus();
    try {
      const data = new DataTransfer();
      data.setData("text/plain", value);
      el.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      }));
      return true;
    } catch {
      return false;
    }
  }, code).catch(() => false);
}

async function pageLeftOtpVerify(page) {
  const text = await readPageText(page);
  if (/expected string, received undefined|invalid input|incorrect|expired|try again/i.test(text)) {
    return false;
  }
  if (await waitForAny(page, [...FIRST_NAME_SELECTORS, ...LAST_NAME_SELECTORS, ...PASSWORD_INPUT_SELECTORS], 250)) {
    return true;
  }
  return !/verify your email|confirmation code|validation code|enter the code/i.test(text);
}

async function fillXaiOtp(page, rawCode, reportStep = () => {}) {
  const code = normalizeOtp(rawCode);
  if (code.length !== 6) throw new Error(`Unexpected xAI OTP length: ${code.length}`);

  const readyDeadline = Date.now() + 5_000;
  while (Date.now() < readyDeadline) {
    if (await otpInputsReady(page)) break;
    await page.waitForTimeout(300);
  }

  const fillDeadline = Date.now() + 28_000;
  for (let round = 1; round <= 3 && Date.now() < fillDeadline; round++) {
    reportStep("entering_domain_otp", `Entering xAI OTP (round ${round}/3)`);
    await dismissGrokCookieBanner(page, reportStep);

    if (await focusOtp(page)) {
      await page.waitForTimeout(80);
      await softClearOtp(page);
      await typeOtpChars(page, code, 35);
      await page.waitForTimeout(250);
      if (await readOtpValue(page) === code || await pageLeftOtpVerify(page)) return true;
    }

    const slots = page.locator('input[maxlength="1"]');
    const slotCount = await slots.count().catch(() => 0);
    if (slotCount > 0) {
      await slots.first().click({ timeout: 2_000 }).catch(async () => {
        await slots.first().click({ timeout: 1_000, force: true }).catch(() => null);
      });
      await softClearOtp(page);
      await typeOtpChars(page, code, 40);
      await page.waitForTimeout(250);
      if (await readOtpValue(page) === code || await pageLeftOtpVerify(page)) return true;

      for (let index = 0; index < Math.min(6, slotCount); index++) {
        const slot = slots.nth(index);
        await slot.click({ timeout: 1_200 }).catch(() => null);
        await page.keyboard.press("Backspace").catch(() => null);
        await page.keyboard.type(code[index], { delay: 30 }).catch(() => null);
      }
      await page.waitForTimeout(250);
      if (await readOtpValue(page) === code || await pageLeftOtpVerify(page)) return true;
    }

    if (await pasteOtp(page, code)) {
      await page.waitForTimeout(300);
      if (await readOtpValue(page) === code || await pageLeftOtpVerify(page)) return true;
    }

    await page.waitForTimeout(350 * round);
  }
  return await pageLeftOtpVerify(page);
}

async function finishOtpVerification(page, reportStep, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await readPageText(page);
    if (/expected string, received undefined|invalid input|incorrect|expired|try again|wrong code|invalid code/i.test(text)) {
      reportStep("otp_rejected", "xAI rejected the OTP; will wait for a fresh code");
      return { ok: false, rejected: true };
    }

    const profileVisible = Boolean(await waitForAny(
      page,
      [...FIRST_NAME_SELECTORS, ...LAST_NAME_SELECTORS, ...PASSWORD_INPUT_SELECTORS],
      250
    ));
    if (profileVisible || /complete your sign up/i.test(text)) {
      reportStep("otp_auto_confirmed", "xAI accepted OTP and opened the signup profile");
      return { ok: true, rejected: false };
    }
    if (!/verify your email|confirmation code|validation code/i.test(text)) {
      reportStep("otp_auto_confirmed", "xAI accepted OTP automatically");
      return { ok: true, rejected: false };
    }
    // xAI auto-submits after the sixth character. Never click/resubmit here;
    // doing so races the navigation to the First name / Last name form.
    await page.waitForTimeout(500);
  }
  return { ok: false, rejected: false };
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

function classifyTurnstileSnapshot(snapshot = {}, pageText = "") {
  if (Number(snapshot.tokenLength) > 20) return "solved";
  if (
    snapshot.interactiveVisible ||
    snapshot.broken ||
    /verify you are human|verification failed|troubleshoot|unable to find onload callback|turnstile already has been loaded/i.test(pageText)
  ) {
    return "interactive";
  }
  return snapshot.mounted ? "checking" : "loading";
}

async function mouseClickAt(page, x, y) {
  await page.mouse.move(x - 40, y - 18, { steps: 6 }).catch(() => null);
  await page.waitForTimeout(80 + Math.floor(Math.random() * 120));
  await page.mouse.move(x, y, { steps: 8 }).catch(() => null);
  await page.waitForTimeout(100 + Math.floor(Math.random() * 180));
  await page.mouse.click(x, y);
}

async function tryClickTurnstile(page) {
  // Same-session managed checkbox click only (farm.py parity). No external solver.
  for (const selector of [
    'text=Verify you are human',
    'label:has-text("Verify you are human")',
    '[aria-label*="Verify you are human" i]',
  ]) {
    const loc = page.locator(selector).first();
    if (!await loc.count().catch(() => 0)) continue;
    if (!await loc.isVisible().catch(() => false)) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (!box) continue;
    await mouseClickAt(page, box.x + Math.min(18, box.width * 0.15), box.y + box.height / 2);
    return "host_text";
  }

  for (const selector of [
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    "[data-sitekey]",
    ".cf-turnstile",
  ]) {
    const loc = page.locator(selector).first();
    if (!await loc.count().catch(() => 0)) continue;
    const box = await loc.boundingBox().catch(() => null);
    if (!box || box.width < 20 || box.height < 20) continue;
    await mouseClickAt(
      page,
      box.x + Math.min(28, Math.max(12, box.width * 0.12)),
      box.y + box.height / 2
    );
    return "widget";
  }

  for (const frame of page.frames?.() || []) {
    const url = frame.url?.() || "";
    if (!/challenges\.cloudflare\.com|turnstile/i.test(url)) continue;
    for (const selector of [
      'input[type="checkbox"]',
      "label.cb-lb input",
      'label input[type="checkbox"]',
      '[role="checkbox"]',
      "body",
    ]) {
      const loc = frame.locator(selector).first();
      if (!await loc.count().catch(() => 0)) continue;
      const box = await loc.boundingBox().catch(() => null);
      if (!box) continue;
      await mouseClickAt(page, box.x + Math.min(20, box.width * 0.2), box.y + box.height / 2);
      return "frame";
    }
  }

  const complete = page.locator('button:text-is("Complete sign up"), button:text-is("Complete Sign Up")').first();
  if (await complete.count().catch(() => 0)) {
    const box = await complete.boundingBox().catch(() => null);
    if (box && box.y > 40) {
      await mouseClickAt(page, box.x + Math.min(28, box.width * 0.12), box.y - 36);
      return "slot_above_complete";
    }
  }
  return null;
}

function isXaiSignInPage(page) {
  try {
    const url = String(page.url?.() || "");
    if (/accounts\.x\.ai\/sign-in(?:\?|$|\/)/i.test(url)) return true;
    if (/\/sign-in(?:\?|$|\/)/i.test(url) && /x\.ai/i.test(url)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

const SIGN_IN_NEXT_SELECTORS = [
  'button:text-is("Next")',
  'button:has-text("Next")',
  'button[type="submit"]',
  'button:has-text("Continue")',
];

function isEmailLoginChooser(pageText) {
  return /log into your account|log in to your account/i.test(pageText)
    && /login with email|sign in with email|continue with email/i.test(pageText);
}

/**
 * One incremental step of domain email login (email-only → Next → password → submit).
 * Safe to call repeatedly from PKCE poll loop; no-ops when nothing to do.
 */
async function progressDomainEmailLogin(page, email, password, reportStep) {
  await dismissGrokCookieBanner(page, reportStep);
  const pageText = await readPageText(page);
  const onEmailLoginForm = isXaiSignInPage(page)
    || /log in with your email|login with your email|sign in with your email/i.test(pageText);

  const passwordInput = await waitForAny(page, PASSWORD_INPUT_SELECTORS, 800);
  if (passwordInput) {
    const current = await passwordInput.inputValue().catch(() => "");
    if (!current) {
      await fillFirst(page, PASSWORD_INPUT_SELECTORS, password);
      reportStep("entering_sign_in_password", "Entering domain password for login");
    }
    const nextClicked = await clickFirstVisible(page, [...SIGN_IN_NEXT_SELECTORS, ...SUBMIT_SELECTORS]);
    if (!nextClicked) {
      await page.getByRole("button", { name: /^next$/i }).click({ timeout: 3_000 }).catch(() => null);
    }
    await page.waitForTimeout(800);
    return true;
  }

  // The PKCE method chooser also uses /sign-in, so select email before
  // treating that URL as the email-entry form.
  if (isEmailLoginChooser(pageText)) {
    const loginClicked = await waitAndClick(page, EMAIL_LOGIN_SELECTORS, 1_500);
    if (loginClicked) {
      reportStep("existing_account_login", "Selecting Login with email");
      await page.waitForTimeout(500);
      return true;
    }
  }

  // Prefer email field when already on "Log in with your email" (do NOT re-click Login).
  const emailInput = await waitForAny(page, EMAIL_INPUT_SELECTORS, onEmailLoginForm ? 3_000 : 800);
  if (emailInput || onEmailLoginForm) {
    const filled = await fillFirst(page, EMAIL_INPUT_SELECTORS, email);
    if (!filled && onEmailLoginForm) {
      // Last resort: first visible text-like input on sign-in form.
      const anyInput = page.locator('form input:not([type="hidden"]), input:not([type="hidden"])').first();
      if (await anyInput.count().catch(() => 0)) {
        await anyInput.click({ timeout: 2_000 }).catch(() => null);
        await anyInput.fill(email, { timeout: 5_000 }).catch(async () => {
          await anyInput.evaluate((el, next) => {
            el.focus();
            el.value = next;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }, email).catch(() => null);
        });
      }
    }
    reportStep("entering_sign_in_email", "Entering domain email for login");
    // xAI sign-in shows email alone first ("Log in with your email" + Next).
    let nextClicked = await clickFirstVisible(page, [...SIGN_IN_NEXT_SELECTORS, ...SUBMIT_SELECTORS]);
    if (!nextClicked) {
      nextClicked = await page.getByRole("button", { name: /^next$/i }).click({ timeout: 3_000 })
        .then(() => true)
        .catch(() => false);
    }
    if (!nextClicked) {
      await page.keyboard.press("Enter").catch(() => null);
    }
    await page.waitForTimeout(800);
    return true;
  }

  // Only on the method chooser — never when email form is already open.
  if (!onEmailLoginForm) {
    const loginClicked = await waitAndClick(page, EMAIL_LOGIN_SELECTORS, 1_500);
    if (loginClicked) {
      reportStep("existing_account_login", "Selecting Login with email");
      await page.waitForTimeout(500);
      return true;
    }
  }
  return false;
}

async function loginDomainEmail(page, email, password, reportStep) {
  reportStep("post_signup_sign_in", "Signup finished on sign-in; logging in with domain email");
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline && !page.isClosed?.()) {
    if (!isXaiSignInPage(page)) {
      const text = await readPageText(page);
      // Left sign-in for consent / authorize / profile — done.
      if (/oauth2\/consent|authorize|complete your sign up|Account Management/i.test(text)
        || /\/oauth2\//i.test(String(page.url?.() || ""))) {
        break;
      }
    }
    const advanced = await progressDomainEmailLogin(page, email, password, reportStep);
    if (!advanced) await page.waitForTimeout(500);
  }
  await dismissGrokCookieBanner(page, reportStep);
  return true;
}

async function completeSignupProfile(page, email, password, reportStep) {
  const profileReady = await waitForAny(page, [...FIRST_NAME_SELECTORS, ...LAST_NAME_SELECTORS, ...PASSWORD_INPUT_SELECTORS], 15_000);
  if (!profileReady) {
    const text = await readPageText(page);
    if (/verify your email|confirmation code|validation code/i.test(text)) {
      throw new Error("xAI did not advance from OTP to the signup profile");
    }
    if (isXaiSignInPage(page)) return "sign_in";
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
  const automaticGraceDeadline = turnstileStartedAt + 60_000;
  const extendedManualDeadline = turnstileStartedAt + 10 * 60_000;
  let checkingReported = false;
  let loadingReported = false;
  let manualReported = false;
  let profileSubmitted = false;
  let extendedWaitReported = false;
  let lastManualElapsedBucket = 0;
  let lastAutomaticElapsedBucket = 0;
  let lastClickAt = 0;
  let clickAttempts = 0;
  while (!page.isClosed?.()) {
    const text = await readPageText(page);
    if (isXaiSignInPage(page)) {
      reportStep("signup_redirected_sign_in", "Left complete-signup form for xAI sign-in page");
      return "sign_in";
    }

    const profileStillVisible = Boolean(await waitForAny(
      page,
      [...FIRST_NAME_SELECTORS, ...LAST_NAME_SELECTORS, ...PASSWORD_INPUT_SELECTORS],
      250
    ));
    if (!profileStillVisible && !/complete your sign up/i.test(text)) {
      if (isXaiSignInPage(page)) return "sign_in";
      return true;
    }
    await dismissGrokCookieBanner(page, reportStep);

    const turnstile = await page.evaluate(() => {
      const responses = [...document.querySelectorAll(
        'input[name*="turnstile" i], textarea[name*="turnstile" i]'
      )];
      const widget = document.querySelector(
        'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], .cf-turnstile, [data-sitekey]'
      );
      const box = widget?.getBoundingClientRect?.();
      let apiToken = "";
      let broken = false;
      try {
        if (window.turnstile && typeof window.turnstile.getResponse === "function") {
          apiToken = String(window.turnstile.getResponse() || "");
        } else if (window.turnstile && typeof window.turnstile.getResponse !== "function") {
          broken = true;
        }
      } catch {
        apiToken = "";
        broken = true;
      }
      const tokenLength = Math.max(
        apiToken.length,
        ...responses.map((response) => String(response?.value || "").length),
        0
      );
      return {
        tokenLength,
        mounted: Boolean(widget || responses.length),
        interactiveVisible: Boolean(
          (widget && box && box.width > 20 && box.height > 20)
          || /verify you are human/i.test(document.body?.innerText || "")
        ),
        broken,
      };
    }).catch(() => ({ tokenLength: 0, mounted: false, interactiveVisible: false, broken: false }));
    const turnstileState = classifyTurnstileSnapshot(turnstile, text);

    if (turnstileState === "solved" && !profileSubmitted) {
      reportStep(
        manualReported ? "turnstile_completed" : "turnstile_auto_verified",
        manualReported
          ? "Cloudflare verification completed; submitting signup profile"
          : "Cloudflare automatic verification completed; submitting signup profile"
      );
      profileSubmitted = true;
      await clickFirstVisible(page, COMPLETE_SIGNUP_SELECTORS);
      await page.waitForTimeout(2_000);
      if (isXaiSignInPage(page)) {
        reportStep("signup_redirected_sign_in", "Complete sign up redirected to sign-in");
        return "sign_in";
      }
      continue;
    }

    if (turnstileState === "checking" && !checkingReported) {
      reportStep("turnstile_checking", "Waiting for Cloudflare automatic verification");
      checkingReported = true;
    }

    if (turnstileState === "loading" && !loadingReported) {
      reportStep("turnstile_loading", "Waiting for the Cloudflare verification widget to load");
      loadingReported = true;
    }

    // Attempt same-session checkbox clicks while waiting (managed challenge).
    // Cap attempts; never refill profile or spam Complete without a token.
    const canClick = turnstileState !== "solved"
      && turnstileState !== "loading"
      && clickAttempts < 8
      && Date.now() - lastClickAt >= 4_000
      && (turnstile.mounted || turnstile.interactiveVisible || Date.now() >= turnstileStartedAt + 8_000);
    if (canClick) {
      const method = await tryClickTurnstile(page).catch(() => null);
      lastClickAt = Date.now();
      if (method) {
        clickAttempts += 1;
        reportStep(
          "turnstile_click_attempt",
          `Clicked Cloudflare checkbox via ${method} (attempt ${clickAttempts}/8)`
        );
        await page.waitForTimeout(1_500);
        continue;
      }
    }

    // After grace, never stay on turnstile_checking forever — CF may hang without
    // a visible interactive widget (broken onload, silent managed challenge).
    if (Date.now() >= automaticGraceDeadline && turnstileState !== "solved" && !manualReported) {
      reportStep(
        "manual_turnstile_required",
        turnstileState === "interactive" || turnstile.broken
          ? "Cloudflare challenge needs manual completion in the open browser"
          : "Cloudflare automatic verification timed out; complete any visible challenge in the open browser"
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
    } else {
      const elapsedSeconds = Math.floor((Date.now() - turnstileStartedAt) / 1000);
      const elapsedBucket = Math.floor(elapsedSeconds / 30);
      if (elapsedBucket > lastAutomaticElapsedBucket) {
        reportStep(
          turnstileState === "loading" ? "turnstile_loading" : "turnstile_checking",
          `Waiting for Cloudflare automatic verification (${elapsedSeconds}s)`
        );
        lastAutomaticElapsedBucket = elapsedBucket;
      }
    }
    await page.waitForTimeout(1_000);
  }
  if (page.isClosed?.()) throw new Error("Browser closed while waiting for signup verification");
  return false;
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
      // /code → fill → /confirm → xAI accept. Wrong OTP: wait for a newer /code and retry.
      const maxOtpAttempts = 3;
      let lastUsedCode = baselineCode;
      let otpAccepted = false;
      let lastOtpError = "OTP verification failed";

      for (let attempt = 1; attempt <= maxOtpAttempts; attempt++) {
        reportStep(
          "waiting_domain_otp",
          attempt === 1
            ? "Waiting up to 60s for a fresh domain email OTP"
            : `OTP attempt ${attempt}/${maxOtpAttempts}: waiting up to 60s for a newer domain email OTP`
        );
        let pollCount = 0;
        let code;
        try {
          code = await otpClient.waitForCode(email, {
            baselineCode: lastUsedCode,
            timeoutMs: 60_000,
            signal: abortController.signal,
            onPoll: () => {
              pollCount += 1;
              if (pollCount === 1 || pollCount % 5 === 0) {
                reportStep(
                  "polling_domain_otp",
                  `Still waiting for a fresh domain email OTP (max 60s, attempt ${attempt}/${maxOtpAttempts}); no resend attempted`
                );
              }
            },
          });
        } catch (error) {
          lastOtpError = error.message || "OTP timeout waiting for a fresh domain email code";
          reportStep("otp_wait_failed", lastOtpError);
          break;
        }

        lastUsedCode = code;
        otpInput ||= await waitForAny(page, OTP_INPUT_SELECTORS, 15_000);
        if (!otpInput && !await otpInputsReady(page)) {
          lastOtpError = "Fresh OTP received, but xAI OTP input was not found";
          reportStep("otp_input_missing", lastOtpError);
          break;
        }

        const otpFilled = await fillXaiOtp(page, code, reportStep);
        if (!otpFilled) {
          const finalValue = await readOtpValue(page);
          lastOtpError = `Failed to enter all 6 xAI OTP characters (got ${finalValue.length}/6)`;
          reportStep("otp_fill_failed", lastOtpError);
          await softClearOtp(page);
          if (attempt < maxOtpAttempts) {
            reportStep("otp_retry", `OTP fill failed; waiting for a newer code (attempt ${attempt + 1}/${maxOtpAttempts})`);
            continue;
          }
          break;
        }

        reportStep("confirming_domain_otp", "Confirming domain email OTP with OTP service");
        try {
          await otpClient.confirm(email, code, abortController.signal);
        } catch (error) {
          // Service-side confirm failure is not always fatal for xAI; still verify page advance.
          reportStep("otp_confirm_soft_fail", `OTP service confirm failed; verifying xAI page (${error.message || "unknown"})`);
        }

        reportStep("submitting_domain_otp", "Submitting domain email OTP to xAI");
        await dismissGrokCookieBanner(page, reportStep);
        const verified = await finishOtpVerification(page, reportStep, 30_000);
        if (verified.ok) {
          otpAccepted = true;
          break;
        }

        lastOtpError = verified.rejected
          ? "xAI rejected the OTP"
          : "xAI remained on Verify your email after OTP submission";
        await softClearOtp(page);
        if (attempt < maxOtpAttempts) {
          reportStep(
            "otp_retry",
            verified.rejected
              ? `xAI rejected OTP; waiting for a newer code (attempt ${attempt + 1}/${maxOtpAttempts})`
              : `OTP not accepted yet; waiting for a newer code (attempt ${attempt + 1}/${maxOtpAttempts})`
          );
          continue;
        }
      }

      if (!otpAccepted) {
        return { status: "failed", error: lastOtpError };
      }
    }

    const profileResult = await completeSignupProfile(page, email, password, reportStep);
    // Only when signup lands on /sign-in (account already created / no consent redirect).
    // Other outcomes keep the previous path: OTP→profile→PKCE unchanged.
    if (profileResult === "sign_in" || isXaiSignInPage(page)) {
      await loginDomainEmail(page, email, password, reportStep);
    }

    // farm.py succeeds reliably by switching to PKCE after signup. The original
    // device grant is only used to enter the account flow; it is not redeemed.
    const tokens = await obtainGrokCliPkceTokens({
      page,
      proxyDispatcher,
      reportStep,
      handleAuthorizationPage: async () => {
        await dismissGrokCookieBanner(page, reportStep);
        const url = page.url();
        if (url.includes("/oauth2/consent")) {
          const approved = await clickFirstVisible(page, GROK_ALLOW_BUTTON_SELECTORS);
          if (approved) reportStep("approving_pkce_consent", "Approving Grok CLI PKCE consent");
          return;
        }
        // After successful signup, PKCE often lands on /sign-in "Log in with your email"
        // (email → Next → password). Drive multi-step login; leave other pages alone.
        const text = await readPageText(page);
        const needsLogin = isXaiSignInPage(page)
          || /log in with your email|login with email|sign in with email/i.test(text)
          || Boolean(await waitForAny(page, [...EMAIL_INPUT_SELECTORS, ...PASSWORD_INPUT_SELECTORS, ...EMAIL_LOGIN_SELECTORS], 250));
        if (needsLogin) {
          await progressDomainEmailLogin(page, email, password, reportStep);
        }
      },
    });
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
  classifyTurnstileSnapshot,
  finishOtpVerification,
  fillXaiOtp,
  readOtpValue,
  otpInputsReady,
  tryClickTurnstile,
  isXaiSignInPage,
  isEmailLoginChooser,
  progressDomainEmailLogin,
  callbackCode: pkceTest.callbackCode,
  createPkce: pkceTest.createPkce,
};
