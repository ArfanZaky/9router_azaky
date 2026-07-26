/**
 * Grok CLI Bulk Import Constants
 * 
 * Device code OAuth flow + Google SSO automation for auth.x.ai
 * Based on manual testing showing:
 *   - accounts.x.ai/oauth2/device?user_code=XXX (device code entry)
 *   - "Login with Google" button on authorization page
 */

// Grok CLI OAuth endpoints
export const GROK_CLI_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
export const GROK_CLI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
export const GROK_CLI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
export const GROK_CLI_SCOPE = "openid profile email offline_access grok-cli:access api:access conversations:read conversations:write";
export const GROK_CLI_REFERRER = "grok-build";

// Base URLs
export const GROK_AUTH_BASE = "https://auth.x.ai";
export const GROK_ACCOUNTS_BASE = "https://accounts.x.ai";
export const GROK_CLI_PROXY_BASE = "https://cli-chat-proxy.grok.com";

// Timeouts and intervals
export const GROK_CLI_POLL_TIMEOUT_MS = 5 * 60_000; // 5 minutes
export const GROK_CLI_POLL_INTERVAL_MS = 5_000; // match xAI device interval (usually 5s)
export const GROK_CLI_SHORT_TIMEOUT_MS = 3 * 60_000; // 3 min — Google SSO + x.ai consent + device poll
export const GROK_CLI_DEVICE_CODE_EXPIRES_IN = 900; // 15 minutes typically

// Bulk import settings
// Keep low for Camoufox: each worker = 1 browser window; 4 looks like "many browsers"
export const GROK_CLI_BULK_IMPORT_DEFAULT_CONCURRENCY = 1;
export const GROK_CLI_BULK_IMPORT_MIN_CONCURRENCY = 1;
export const GROK_CLI_BULK_IMPORT_MAX_CONCURRENCY = 8;

// Provider ID
export const GROK_CLI_PROVIDER_ID = "grok-cli";
export const GROK_CLI_LABEL = "Grok CLI";

/**
 * Selectors for device code page (Image 1)
 * URL: accounts.x.ai/oauth2/device?user_code=XXX
 */
export const GROK_DEVICE_CODE_INPUT_SELECTORS = [
  'input[name="user_code"]',
  'input[placeholder="Enter device code"]',
  'input[id="user_code"]',
  'input[type="text"][name="user_code"]',
];

export const GROK_CONTINUE_BUTTON_SELECTORS = [
  'button:has-text("Continue")',
  'button[type="submit"]:has-text("Continue")',
  'button:has-text("Next")',
  'button:has-text("Submit")',
  '[role="button"]:has-text("Continue")',
  'input[type="submit"][value="Continue"]',
  'button.continue-button',
  'button[data-testid*="continue" i]',
];

/**
 * Selectors for login options page (Image 2)
 * Shows after clicking Continue on device code page
 */
export const GROK_GOOGLE_LOGIN_BUTTON_SELECTORS = [
  'button:has-text("Login with Google")',
  'button:has-text("Log in with Google")',
  'button:has-text("Sign in with Google")',
  'button:has-text("Continue with Google")',
  'a:has-text("Login with Google")',
  'a:has-text("Log in with Google")',
  'a:has-text("Continue with Google")',
  '[role="button"]:has-text("Login with Google")',
  '[role="button"]:has-text("Continue with Google")',
  'button:has-text("Google")',
  'a:has-text("Google")',
  'button[data-provider="google"]',
  'button[data-testid*="google" i]',
  '.google-login-button',
  '[aria-label*="Google" i]',
];

/**
 * Cookie banner on accounts.x.ai (blocks Allow/Authorize)
 */
export const GROK_COOKIE_BUTTON_SELECTORS = [
  'button:has-text("Accept All Cookies")',
  'button:has-text("Accept all cookies")',
  'button:has-text("Accept All")',
  'button:has-text("Reject All")',
  'button:has-text("Reject all")',
  '[role="button"]:has-text("Accept All Cookies")',
  '[role="button"]:has-text("Reject All")',
];

/**
 * Selectors for OAuth consent "Allow" / Authorize button
 */
// Do NOT include "Continue" — on consent page Continue is not the grant button
// and may navigate to a fake /done without redeemable device_code.
export const GROK_ALLOW_BUTTON_SELECTORS = [
  'button:has-text("Allow")',
  'button[type="submit"]:has-text("Allow")',
  'button:has-text("Authorize")',
  'button[type="submit"]:has-text("Authorize")',
  'button:has-text("Approve")',
  'button:has-text("Authorize Grok")',
  '[role="button"]:has-text("Allow")',
  '[role="button"]:has-text("Authorize")',
];

/**
 * Page markers to detect Grok auth pages
 */
export const GROK_AUTH_PAGE_MARKERS = [
  "sign in to grok build",
  "log into your account",
  "account management",
  "auth.x.ai",
  "accounts.x.ai",
  "device code",
  "enter the code shown",
];

/**
 * Success markers after authorization
 */
export const GROK_AUTH_SUCCESS_MARKERS = [
  "authorized",
  "success",
  "you can close this window",
  "return to your device",
  "authentication complete",
];

/**
 * Error markers
 */
export const GROK_AUTH_ERROR_MARKERS = [
  "invalid code",
  "expired",
  "code has been used",
  "error",
  "authentication failed",
];

/**
 * Restricted account markers
 */
export const GROK_RESTRICTED_ACCOUNT_MARKERS = [
  "account suspended",
  "account restricted",
  "account disabled",
  "access denied",
  "account blocked",
  "violation",
];

/**
 * Manual assist markers (2FA, captcha, etc)
 */
export const GROK_MANUAL_ASSIST_MARKERS = [
  "verify it's you",
  "verification required",
  "two-factor",
  "2-step verification",
  "captcha",
  "unusual activity",
  "check your",
];

/**
 * Config object for automation
 */
export const GROK_CLI_BULK_CONFIG = {
  providerId: GROK_CLI_PROVIDER_ID,
  label: GROK_CLI_LABEL,
  deviceCodeUrl: GROK_CLI_DEVICE_CODE_URL,
  tokenUrl: GROK_CLI_TOKEN_URL,
  clientId: GROK_CLI_CLIENT_ID,
  scope: GROK_CLI_SCOPE,
  referrer: GROK_CLI_REFERRER,
  pollTimeoutMs: GROK_CLI_POLL_TIMEOUT_MS,
  pollIntervalMs: GROK_CLI_POLL_INTERVAL_MS,
  shortTimeoutMs: GROK_CLI_SHORT_TIMEOUT_MS,
  defaultConcurrency: GROK_CLI_BULK_IMPORT_DEFAULT_CONCURRENCY,
  minConcurrency: GROK_CLI_BULK_IMPORT_MIN_CONCURRENCY,
  maxConcurrency: GROK_CLI_BULK_IMPORT_MAX_CONCURRENCY,
};
