import { runGoogleAccountAutomation } from "./kiroGoogleAutomation.js";

const ZARKLAB_APP_URL = "https://www.zarklab.ai";
const LOGIN_URL = `${ZARKLAB_APP_URL}/login`;

const DEFAULT_SHORT_TIMEOUT_MS = 90_000;
const DEFAULT_MANUAL_TIMEOUT_MS = 15 * 60_000;

const ZARKLAB_LOGIN_TRIGGER_SELECTORS = [
  'button:has-text("Continue with Google")',
  'button:has-text("Sign in")',
  'button:has-text("Log in")',
  'a:has-text("Sign in")',
  'a:has-text("Log in")',
];

/**
 * Poll all browser context pages for ZarkLab Firebase authentication session.
 *
 * ZarkLab uses Firebase Auth (auth.zarklab.ai) with Google SSO Popup.
 * When authentication finishes, Firebase stores the user token in:
 *   1. IndexedDB ("firebaseLocalStorageDb" -> "firebaseLocalStorage")
 *   2. LocalStorage (keys matching firebase:authUser)
 *   3. Network API headers / tokens
 */
export function createZarkLabTokenMonitor(context, timeoutMs = DEFAULT_MANUAL_TIMEOUT_MS) {
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
    settle(null, new Error("Timed out waiting for ZarkLab Firebase auth session"));
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
      if (!url.includes("zarklab.ai")) return false;

      const data = await page.evaluate(async () => {
        try {
          // 1. Check IndexedDB firebaseLocalStorageDb
          if (window.indexedDB) {
            const dbData = await new Promise((res) => {
              try {
                const req = indexedDB.open("firebaseLocalStorageDb");
                req.onsuccess = (e) => {
                  const db = e.target.result;
                  if (!db.objectStoreNames.contains("firebaseLocalStorage")) {
                    return res(null);
                  }
                  const tx = db.transaction("firebaseLocalStorage", "readonly");
                  const store = tx.objectStore("firebaseLocalStorage");
                  const getAllReq = store.getAll();
                  getAllReq.onsuccess = () => {
                    const entries = getAllReq.result || [];
                    for (const item of entries) {
                      const val = item?.value || item;
                      if (val?.stsTokenManager?.accessToken) {
                        return res({
                          token: val.stsTokenManager.accessToken,
                          apiKey: val.stsTokenManager.accessToken,
                          refreshToken: val.stsTokenManager.refreshToken,
                          email: val.email,
                          uid: val.uid,
                        });
                      }
                    }
                    res(null);
                  };
                  getAllReq.onerror = () => res(null);
                };
                req.onerror = () => res(null);
              } catch {
                res(null);
              }
            });
            if (dbData) return dbData;
          }

          // 2. Check localStorage for Firebase Auth keys
          for (const key of Object.keys(localStorage)) {
            if (key.includes("firebase:authUser")) {
              const valStr = localStorage.getItem(key);
              if (valStr) {
                const parsed = JSON.parse(valStr);
                const token = parsed?.stsTokenManager?.accessToken || parsed?.accessToken;
                if (token) {
                  return {
                    token,
                    apiKey: token,
                    refreshToken: parsed?.stsTokenManager?.refreshToken,
                    email: parsed?.email,
                    uid: parsed?.uid,
                  };
                }
              }
            }
          }
          return null;
        } catch {
          return null;
        }
      });

      if (!data?.token) return false;

      settle({
        token: data.token,
        apiKey: data.apiKey || data.token,
        refreshToken: data.refreshToken || "",
        email: data.email || "",
        uid: data.uid || "",
      });
      return true;
    } catch {
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
 * Sign up or log into ZarkLab using Google SSO automation and extract Firebase API token.
 */
export async function runZarkLabGoogleAutomation({
  page,
  email,
  password,
  callbackPromise,
  shortTimeoutMs = DEFAULT_SHORT_TIMEOUT_MS,
  onStep,
}) {
  const reportStep = (step, message) => onStep?.(step, message);

  reportStep("opening_zarklab_login", "Opening ZarkLab login page");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2000 + Math.floor(Math.random() * 1000));

  // Find Google login button or click login gate trigger
  reportStep("clicking_zarklab_google", "Clicking Continue with Google on ZarkLab");
  const context = page.context();

  let popup = null;
  let isPopup = false;

  // Listen for popup event before clicking
  const popupPromise = context.waitForEvent("page", { timeout: 15_000 }).catch(() => null);

  const clicked = await clickFirstVisible(page, ZARKLAB_LOGIN_TRIGGER_SELECTORS);
  if (!clicked) {
    return {
      status: "failed",
      error: "Could not find 'Continue with Google' button on ZarkLab.",
    };
  }

  popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => null);
    isPopup = true;
    reportStep("zarklab_google_popup_opened", "Google sign-in popup opened");
  } else {
    reportStep("zarklab_google_same_tab", "No separate popup tab — continuing on active page");
    popup = page;
  }

  const result = await runGoogleAccountAutomation({
    page: popup,
    skipNavigation: true,
    email,
    password,
    successPromise: callbackPromise,
    shortTimeoutMs,
    serviceLabel: "ZarkLab AI",
    openingStep: "starting_google_login",
    openingMessage: "Authenticating Google account for ZarkLab",
    successStep: "zarklab_token_extracted",
    successMessage: "ZarkLab session token extracted successfully",
    onStep,
  });

  if (isPopup && popup !== page) {
    await popup.close().catch(() => null);
  }

  return result;
}

async function clickFirstVisible(page, selectors) {
  for (const sel of selectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 2000 })) {
        await loc.click({ timeout: 5000 });
        return true;
      }
    } catch {}
  }
  return false;
}
