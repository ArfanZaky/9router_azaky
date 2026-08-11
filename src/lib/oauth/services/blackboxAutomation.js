/**
 * Blackbox.ai signup automation, ported from the NovaBox Python farm into
 * the 9Router bulk-import architecture.
 *
 * Flow (all in ONE browser context so cookies persist signup → key creation):
 *   1. GET /signup → fill email + password → submit (Next.js server action)
 *   2. Wait for OTP screen, poll catchmail.io for the 6-digit code
 *   3. Fill OTP → click Verify → wait until URL lands on /activity|/dashboard
 *   4. GET /keys → click CREATE KEY → name it → confirm → read sk-... key
 *      from the POST /api/v0/keys response (with page-text fallback)
 */

const BLACKBOX_APP_URL = "https://app.blackbox.ai";
const SIGNUP_URL = `${BLACKBOX_APP_URL}/signup`;
const KEYS_URL = `${BLACKBOX_APP_URL}/keys`;

const EMAIL_INPUT_SELECTORS = [
  "#email-password-signup",
  'input[type="email"]',
  'input[name="email"]',
  'input[autocomplete="email"]',
  'input[inputmode="email"]',
  'input[placeholder*="email" i]',
  'input[id*="email" i]',
  'input[aria-label*="email" i]',
];

const PASSWORD_INPUT_SELECTORS = [
  "#password-signup",
  'input[type="password"]',
  'input[name="password"]',
  'input[autocomplete="new-password"]',
  'input[autocomplete="current-password"]',
  'input[placeholder*="password" i]',
  'input[id*="password" i]',
];

const OTP_INPUT_SELECTORS = [
  'input[placeholder="Enter 6-digit code"]',
  'input[placeholder*="6-digit" i]',
  'input[maxlength="6"]',
  'input[autocomplete="one-time-code"]',
  'input[name="code"]',
  'input[inputmode="numeric"]',
  'input[placeholder*="code" i]',
];

const OTP_SCREEN_SELECTORS = [
  'input[placeholder="Enter 6-digit code"]',
  "text=Verify Email",
  "text=Verify",
  "input[maxlength='6']",
  "text=verification",
  "text=code",
  "input[autocomplete='one-time-code']",
];

const KEY_NAME_INPUT_SELECTORS = [
  'input[placeholder*="Production"]',
  'input[placeholder*="Key name"]',
  'input[placeholder*="e.g."]',
];

const KEY_CONFIRM_SELECTORS = [
  'button:has-text("CREATE API KEY")',
  'button:has-text("Create API Key")',
];

const KEY_DONE_SELECTORS = [
  'button:has-text("DONE")',
  'button:has-text("Done")',
  'button:has-text("Close")',
];

const CREATE_KEY_BUTTON_SELECTORS = [
  'button:has-text("CREATE KEY")',
  'button:has-text("Create key")',
  'button:has-text("Create Key")',
];

const KEY_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/,
  /\b(?:bb_|sk_)[A-Za-z0-9_-]{16,}\b/,
];

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_OTP_TIMEOUT_MS = 60_000;
const DEFAULT_OTP_POLL_INTERVAL_MS = 3_000;

const SPECIAL_CHARS = "!@#$%^&*()-_=+[]{};:,.<>?";
const LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS = "0123456789";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function generatePassword(length = 16) {
  const pool = LETTERS + DIGITS + SPECIAL_CHARS;
  const bytes = globalThis.crypto?.getRandomValues?.(new Uint8Array(length)) || null;
  const chars = [];
  for (let i = 0; i < length; i += 1) {
    if (bytes) {
      chars.push(pool[bytes[i] % pool.length]);
    } else {
      chars.push(pool[Math.floor(Math.random() * pool.length)]);
    }
  }
  return chars.join("");
}

async function waitForAnyVisible(page, selectors, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        if ((await locator.count()) > 0 && (await locator.isVisible({ timeout: 250 }).catch(() => false))) {
          return true;
        }
      } catch {
        // keep polling
      }
    }
    await sleep(500);
  }
  return false;
}

async function waitForVisible(page, selector, timeoutMs) {
  try {
    await page.locator(selector).first().waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function fillFirst(page, selectors, value, { waitForVisibleMs = 3_000 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (!(await waitForVisible(page, selector, waitForVisibleMs))) continue;
      try {
        await locator.fill(String(value), { timeout: 3_000 });
      } catch {
        // Some controlled inputs (OTP boxes) reject .fill() — type instead.
        await locator.click({ timeout: 2_000 });
        await locator.press("Control+A").catch(() => null);
        if (typeof locator.pressSequentially === "function") {
          await locator.pressSequentially(String(value), { timeout: 5_000 });
        } else {
          await locator.type(String(value), { timeout: 5_000 });
        }
      }
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function clickFirst(page, selectors, { timeoutMs = 3_000, waitForVisibleMs = 3_000 } = {}) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    try {
      if (!(await waitForVisible(page, selector, waitForVisibleMs))) continue;
      await locator.click({ timeout: timeoutMs });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

async function readBodyText(page) {
  try {
    return await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
  } catch {
    return "";
  }
}

function extractKeyFromText(text) {
  for (const pattern of KEY_PATTERNS) {
    const match = pattern.exec(text || "");
    if (match) return match[0];
  }
  return "";
}

async function readKeyFromPage(page) {
  for (let i = 0; i < 5; i += 1) {
    const key = extractKeyFromText(await readBodyText(page));
    if (key) return key;
    await sleep(1_000);
  }
  return "";
}

/**
 * Fill and submit the /signup form.
 */
export async function signup(page, email, password, { requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded", timeout: requestTimeoutMs });

  const emailFilled = await fillFirst(page, EMAIL_INPUT_SELECTORS, email);
  if (!emailFilled) throw new Error("Blackbox signup email input not found");

  const passwordFilled = await fillFirst(page, PASSWORD_INPUT_SELECTORS, password);
  if (!passwordFilled) throw new Error("Blackbox signup password input not found");

  const submitted = await clickFirst(page, [
    'button[type="submit"]:has-text("Create Account")',
    'button[type="submit"]',
  ], { timeoutMs: 5_000 });
  if (!submitted) throw new Error("Blackbox signup submit button not found");

  const otpScreen = await waitForAnyVisible(page, OTP_SCREEN_SELECTORS, 15_000);
  if (!otpScreen) throw new Error("Blackbox did not advance to the OTP screen after signup");
}

/**
 * Enter the 6-digit OTP and verify. Polls until the app lands on
 * /activity or /dashboard (auto-login after verify).
 */
export async function verifyOtp(page, code, { requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
  const otpFilled = await fillFirst(page, OTP_INPUT_SELECTORS, code);
  if (!otpFilled) throw new Error("Blackbox OTP input not found");

  await clickFirst(page, [
    'button:has-text("Verify Email")',
    'button:has-text("Verify")',
    'button[type="submit"]',
  ]);

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const url = page.url();
      if (/\/(activity|dashboard)/.test(url)) return;
    } catch {
      // page may be navigating; keep polling
    }
    await sleep(500);
  }
  throw new Error("Blackbox did not reach the dashboard after OTP verify");
}

/**
 * Navigate to /keys, create an API key, and read the sk-... value from the
 * POST /api/v0/keys response (with page-text fallback).
 */
export async function createApiKey(page, keyName, {
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  onStep,
} = {}) {
  let capturedKey = "";
  let createFailedMessage = "";
  let keyResolver = null;
  let keyEvent = null;

  const onResponse = async (response) => {
    try {
      const url = response.url();
      if (!url.endsWith("/api/v0/keys") && !url.includes("/api/v0/keys?")) return;
      if (response.request?.method?.() !== "POST") return;
      const body = await response.text().catch(() => "");
      const match = /"(?:api_key|key|token)"\s*:\s*"([^"]+)"/.exec(body || "");
      if (match) {
        capturedKey = match[1];
        if (keyResolver) keyResolver();
        return;
      }
      if (!response.ok()) {
        // Surface server-side failures (e.g. "Failed to create key").
        let errorText = "";
        try {
          const payload = body ? JSON.parse(body) : null;
          if (payload) {
            const err = payload.error;
            if (typeof err === "string") errorText = err;
            else if (err && typeof err === "object") {
              errorText = err.message || err.error_description || err.detail || JSON.stringify(err);
            } else if (typeof payload.message === "string") {
              errorText = payload.message;
            } else if (typeof payload.detail === "string") {
              errorText = payload.detail;
            }
          }
        } catch {
          // body not JSON — fall back to regex
          const errorMatch = /"(?:error|message)"\s*:\s*"([^"]+)"/.exec(body || "");
          if (errorMatch) errorText = errorMatch[1];
        }
        createFailedMessage = errorText || `HTTP ${response.status()}`;
        if (keyResolver) keyResolver();
      }
    } catch {
      // ignore — page-text fallback below
    }
  };

  keyEvent = new Promise((resolve) => {
    keyResolver = resolve;
  });
  page.on("response", onResponse);

  try {
    onStep?.("opening_blackbox_keys", "Opening Blackbox API keys page");
    await page.goto(KEYS_URL, { waitUntil: "domcontentloaded", timeout: requestTimeoutMs });

    const createOpened = await waitForAnyVisible(page, CREATE_KEY_BUTTON_SELECTORS, 30_000);
    if (!createOpened) throw new Error("Blackbox CREATE KEY button not found");

    const clickedCreate = await clickFirst(page, CREATE_KEY_BUTTON_SELECTORS);
    if (!clickedCreate) throw new Error("Blackbox CREATE KEY button did not respond");

    const nameFilled = await waitForAnyVisible(page, KEY_NAME_INPUT_SELECTORS, 15_000);
    if (!nameFilled) throw new Error("Blackbox key-name input not found");
    await fillFirst(page, KEY_NAME_INPUT_SELECTORS, keyName);

    // The confirm button starts disabled and enables once a name is entered.
    try {
      await page.waitForFunction(
        () => {
          const buttons = [...document.querySelectorAll("button")];
          return buttons.some((b) => /create api key/i.test(b.textContent || "") && !b.disabled);
        },
        { timeout: 15_000 }
      );
    } catch {
      // some builds never disable the button — try clicking anyway
    }
    await clickFirst(page, KEY_CONFIRM_SELECTORS);

    try {
      await Promise.race([
        keyEvent,
        sleep(15_000),
      ]);
    } catch {
      // fall through to page-text scan
    }

    if (createFailedMessage) {
      throw new Error(`Blackbox API key creation failed: ${createFailedMessage}`);
    }

    let apiKey = capturedKey;
    if (!apiKey) {
      apiKey = await readKeyFromPage(page);
    }

    if (!apiKey) {
      // Detect the in-modal error text when the server response wasn't captured.
      const modalText = await readBodyText(page);
      const failureMatch = /(failed to create key[^\n.]*|create key[^\n.]*(?:failed|error)[^\n.]*)/i.exec(modalText || "");
      if (failureMatch) {
        throw new Error(`Blackbox API key creation failed: ${failureMatch[1].trim()}`);
      }
    }

    if (!apiKey) {
      throw new Error("Blackbox API key not found after creation");
    }

    await clickFirst(page, KEY_DONE_SELECTORS).catch(() => null);
    return apiKey;
  } finally {
    if (typeof page.off === "function") page.off("response", onResponse);
  }
}

/**
 * Run the whole Blackbox account flow and return the harvested sk-... key.
 */
export async function runBlackboxAccount({
  page,
  email,
  password,
  keyName,
  waitForOtp,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  onStep,
}) {
  onStep?.("signing_up_blackbox", "Opening Blackbox signup form");
  await signup(page, email, password, { requestTimeoutMs });

  onStep?.("waiting_blackbox_otp", "Waiting for Blackbox OTP email");
  const code = await waitForOtp();

  onStep?.("verifying_blackbox_otp", "Verifying Blackbox email OTP");
  await verifyOtp(page, code, { requestTimeoutMs });

  onStep?.("creating_blackbox_key", "Creating Blackbox API key");
  const apiKey = await createApiKey(page, keyName, { requestTimeoutMs, onStep });

  onStep?.("blackbox_done", "Blackbox account created and API key harvested");
  return apiKey;
}

export const __test__ = {
  EMAIL_INPUT_SELECTORS,
  PASSWORD_INPUT_SELECTORS,
  OTP_INPUT_SELECTORS,
  OTP_SCREEN_SELECTORS,
  KEY_NAME_INPUT_SELECTORS,
  KEY_CONFIRM_SELECTORS,
  KEY_DONE_SELECTORS,
  CREATE_KEY_BUTTON_SELECTORS,
  extractKeyFromText,
  generatePassword,
};
