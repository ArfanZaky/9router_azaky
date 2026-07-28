/**
 * Grok CLI Bulk Import Manager
 * 
 * Automates bulk import of Grok CLI accounts using Google SSO.
 * Extends KiroBulkImportManager with Grok-specific device code + Google flow.
 * 
 * Flow:
 * 1. Request device code from auth.x.ai
 * 2. Open browser to verification_uri
 * 3. Automate device code entry + "Continue"
 * 4. Click "Login with Google"
 * 5. Run Google SSO automation
 * 6. Poll device code for token
 * 7. Save connection to database
 */

import {
  KiroBulkImportManager,
  parseKiroBulkAccounts,
  createFreshContext,
} from "./kiroBulkImportManager.js";
import { runGrokCliGoogleAutomation } from "./grokCliAutomation.js";
import {
  GROK_CLI_PROVIDER_ID,
  GROK_CLI_LABEL,
  GROK_CLI_DEVICE_CODE_URL,
  GROK_CLI_TOKEN_URL,
  GROK_CLI_CLIENT_ID,
  GROK_CLI_SCOPE,
  GROK_CLI_REFERRER,
  GROK_CLI_POLL_TIMEOUT_MS,
  GROK_CLI_POLL_INTERVAL_MS,
  GROK_CLI_BULK_IMPORT_DEFAULT_CONCURRENCY,
  GROK_CLI_BULK_CONFIG,
} from "../constants/grok.js";
import { ProxyAgent } from "undici";
import { createHash } from "node:crypto";

const GROK_PROXY_QUARANTINE_MS = 30 * 60_000;
const GROK_PROXY_INVALID_GRANT_LIMIT = 2;

function getProxyHealthStore() {
  if (!globalThis.__grokCliProxyHealth) globalThis.__grokCliProxyHealth = new Map();
  return globalThis.__grokCliProxyHealth;
}

function getProxyKey(proxyUrl) {
  return createHash("sha256").update(String(proxyUrl || "direct")).digest("hex").slice(0, 10);
}

function getIpFingerprint(ip) {
  return createHash("sha256").update(String(ip || "unknown")).digest("hex").slice(0, 8);
}

function createProxyDispatcher(proxyUrl) {
  const clean = String(proxyUrl || "").trim();
  return clean ? new ProxyAgent({ uri: clean }) : null;
}

async function readNodeEgressIp(dispatcher) {
  const response = await fetch("https://api.ipify.org?format=json", {
    ...(dispatcher ? { dispatcher } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Node egress check HTTP ${response.status}`);
  return String((await response.json())?.ip || "").trim();
}

async function readBrowserEgressIp(browser) {
  const { context, page } = await createFreshContext(browser);
  try {
    await page.goto("https://api.ipify.org?format=json", {
      waitUntil: "domcontentloaded",
      timeout: 20_000,
    });
    const text = await page.locator("body").innerText({ timeout: 5_000 });
    return String(JSON.parse(text)?.ip || "").trim();
  } finally {
    await context.close().catch(() => null);
  }
}

/**
 * Default device code request function
 */
/**
 * Request device code via Node fetch (fallback).
 */
async function defaultRequestDeviceCode(proxyUrl, proxyDispatcher) {
  const body = new URLSearchParams({
    client_id: GROK_CLI_CLIENT_ID,
    scope: GROK_CLI_SCOPE,
    referrer: GROK_CLI_REFERRER,
  });

  try {
    console.log("[GrokCLI] Requesting device code from:", GROK_CLI_DEVICE_CODE_URL);
    const requestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      },
      body,
    };
    const dispatcher = proxyDispatcher || createProxyDispatcher(proxyUrl);
    if (dispatcher) requestInit.dispatcher = dispatcher;
    const response = await fetch(GROK_CLI_DEVICE_CODE_URL, requestInit);

    console.log("[GrokCLI] Response status:", response.status);

    if (!response.ok) {
      const error = await response.text();
      console.error("[GrokCLI] Request failed:", error);
      throw new Error(`Grok CLI device code request failed (${response.status}): ${error}`);
    }

    const data = await response.json();
    console.log(
      "[GrokCLI] Device code received:",
      data.user_code,
      "device_code_len=",
      String(data.device_code || "").length,
      "interval=",
      data.interval,
      "has_complete_uri=",
      Boolean(data.verification_uri_complete),
      "via=node"
    );
    return data;
  } catch (error) {
    console.error("[GrokCLI] Fetch error:", error);
    throw new Error(`Failed to request device code: ${error.message} (URL: ${GROK_CLI_DEVICE_CODE_URL})`);
  }
}

/**
 * Default token polling function
 */
async function defaultPollDeviceToken(deviceCode, proxyUrl, proxyDispatcher) {
  try {
    console.log("[GrokCLI] Polling token for device code:", deviceCode.substring(0, 10) + "...");
    const requestInit = {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: GROK_CLI_CLIENT_ID,
      }),
    };
    const dispatcher = proxyDispatcher || createProxyDispatcher(proxyUrl);
    if (dispatcher) requestInit.dispatcher = dispatcher;
    const response = await fetch(GROK_CLI_TOKEN_URL, requestInit);

    console.log("[GrokCLI] Poll response status:", response.status);

    let data;
    try {
      data = await response.json();
    } catch {
      const text = await response.text();
      console.error("[GrokCLI] Failed to parse JSON response:", text);
      data = { error: "invalid_response", error_description: text };
    }

    console.log("[GrokCLI] Poll response data:", JSON.stringify(data));

    // Device flow: 400 + authorization_pending is expected
    const pending =
      data?.error === "authorization_pending" ||
      data?.error === "slow_down";

    return {
      ok: response.ok || pending,
      pending,
      data,
    };
  } catch (error) {
    console.error("[GrokCLI] Poll fetch error:", error);
    throw error;
  }
}

/**
 * Default save connection function
 */
async function defaultSaveGrokCliConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");

  const accessTokenForProfile = tokens.accessToken || tokens.access_token;
  // Fetch user profile (best-effort, non-fatal)
  let user = null;
  if (accessTokenForProfile) {
    try {
      const res = await fetch("https://cli-chat-proxy.grok.com/v1/user", {
        headers: {
          Authorization: `Bearer ${accessTokenForProfile}`,
          Accept: "application/json",
          "User-Agent": "grok-pager/0.2.93 grok-shell/0.2.93 (linux; x86_64)",
          "x-xai-token-auth": "xai-grok-cli",
          "x-grok-client-version": "0.2.93",
        },
      });
      if (res.ok) {
        user = await res.json();
      }
    } catch {
      // Ignore
    }
  }

  const displayName = user
    ? [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || null
    : null;

  // pollForToken mapTokens returns camelCase; raw OAuth returns snake_case
  const accessToken = tokens.accessToken || tokens.access_token;
  const refreshToken = tokens.refreshToken || tokens.refresh_token || null;
  const idToken = tokens.idToken || tokens.id_token || tokens.providerSpecificData?.idToken || null;
  const expiresIn = tokens.expiresIn || tokens.expires_in || null;

  if (!accessToken) {
    throw new Error("No access token in OAuth response");
  }

  const connectionData = {
    provider: GROK_CLI_PROVIDER_ID,
    authType: "oauth",
    accessToken,
    refreshToken,
    idToken,
    expiresIn,
    email: email || tokens.email || user?.email || null,
    displayName: displayName || tokens.displayName || null,
    providerSpecificData: {
      ...(tokens.providerSpecificData || {}),
      authMethod: "device_code_google_sso",
      automation: "gsuite-bulk",
      loginEmail: email,
      userId: user?.userId || user?.principalId || tokens.providerSpecificData?.userId || null,
      hasGrokCodeAccess: user?.hasGrokCodeAccess ?? tokens.providerSpecificData?.hasGrokCodeAccess ?? null,
      subscriptionTier: user?.subscriptionTier || tokens.providerSpecificData?.subscriptionTier || null,
      idToken,
    },
    expiresAt: expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null,
    testStatus: "active",
  };

  const connection = await createProviderConnection(connectionData);
  return { connection };
}

/**
 * Wait helper
 */
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Grok CLI Bulk Import Manager
 */
export class GrokCliBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher,
    googleAutomation = runGrokCliGoogleAutomation,
    requestDeviceCode = defaultRequestDeviceCode,
    pollDeviceToken = defaultPollDeviceToken,
    saveConnection = defaultSaveGrokCliConnection,
    storageName = "grok-cli-bulk-import",
  } = {}) {
    super({
      // Always Camoufox: Chromium + bare Node fetch get invalid_grant/Access denied from xAI
      browserLauncher:
        browserLauncher ||
        (async (job) => {
          const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
          console.log("[GrokCLI] Launching Camoufox (required for xAI device token redeem)");
          return launchBulkImportBrowser({
            engine: "camoufox",
            proxyUrl: job?.proxyUrl || undefined,
            headless: false,
            args: ["--start-maximized"],
          });
        }),
      googleAutomation,
      storageName,
    });

    this.requestDeviceCode = requestDeviceCode;
    this.pollDeviceToken = pollDeviceToken;
    this.saveConnection = saveConnection;
    this.config = GROK_CLI_BULK_CONFIG;
  }

  refreshRuntimeDefaults({ googleAutomation } = {}) {
    this.requestDeviceCode = defaultRequestDeviceCode;
    this.pollDeviceToken = defaultPollDeviceToken;
    this.saveConnection = defaultSaveGrokCliConnection;
    if (googleAutomation) this.googleAutomation = googleAutomation;
  }

  async startJob(opts = {}) {
    // Force engine even if UI/API sends chromium
    return super.startJob({
      ...opts,
      engine: "camoufox",
      concurrency: 1,
    });
  }

  _isProxyQuarantined(proxyUrl) {
    const state = getProxyHealthStore().get(getProxyKey(proxyUrl));
    return Boolean(state?.quarantinedUntil && state.quarantinedUntil > Date.now());
  }

  _recordProxyFailure(proxyUrl, reason) {
    if (!proxyUrl) return;
    const key = getProxyKey(proxyUrl);
    const store = getProxyHealthStore();
    const state = store.get(key) || { invalidGrants: 0, mismatches: 0, quarantinedUntil: 0 };
    if (reason === "egress_mismatch") state.mismatches += 1;
    if (reason === "invalid_grant") state.invalidGrants += 1;
    if (reason === "egress_mismatch" || state.invalidGrants >= GROK_PROXY_INVALID_GRANT_LIMIT) {
      state.quarantinedUntil = Date.now() + GROK_PROXY_QUARANTINE_MS;
    }
    store.set(key, state);
  }

  _recordProxySuccess(proxyUrl) {
    if (!proxyUrl) return;
    getProxyHealthStore().delete(getProxyKey(proxyUrl));
  }

  async runWorker(job, workerId, browser = job.browser) {
    const proxyUrls = Array.isArray(job.proxyUrls) ? job.proxyUrls : [];
    if (job.proxyMode !== "round-robin" || proxyUrls.length < 2) {
      return super.runWorker(job, workerId, browser);
    }

    while (!job.cancelRequested && job.status !== "cancelled") {
      const account = this.dequeueAccount(job, workerId);
      if (!account) return;

      let accountBrowser = null;
      let proxyDispatcher = null;
      let proxyUrl = null;
      try {
        const originalIndex = Number.isInteger(job.proxyAccountIndexes?.[String(account.email).toLowerCase()])
          ? job.proxyAccountIndexes[String(account.email).toLowerCase()]
          : Math.max(1, account.line || 1) - 1;
        const startIndex = (originalIndex + Number(job.proxyOffset || 0)) % proxyUrls.length;
        for (let attempt = 0; attempt < proxyUrls.length; attempt++) {
          const proxyIndex = (startIndex + attempt) % proxyUrls.length;
          const candidate = proxyUrls[proxyIndex];
          if (this._isProxyQuarantined(candidate)) continue;

          accountBrowser = await this.browserLauncher({ ...job, proxyUrl: candidate });
          accountBrowser.__ninerouterProxyUrl = candidate;
          job.workerBrowsers.add(accountBrowser);
          proxyDispatcher = createProxyDispatcher(candidate);

          let nodeIp = "";
          let browserIp = "";
          try {
            [nodeIp, browserIp] = await Promise.all([
              readNodeEgressIp(proxyDispatcher),
              readBrowserEgressIp(accountBrowser),
            ]);
          } catch (error) {
            console.warn(`[GrokCLI] Proxy ${proxyIndex + 1}/${proxyUrls.length} egress check unavailable: ${error.message}`);
          }

          if (!nodeIp || !browserIp) {
            this.setAccountStep(
              account,
              "proxy_unverified",
              `Proxy ${proxyIndex + 1}/${proxyUrls.length} egress could not be verified; trying next proxy`
            );
            await proxyDispatcher.close().catch(() => null);
            proxyDispatcher = null;
            job.workerBrowsers.delete(accountBrowser);
            await accountBrowser.close().catch(() => null);
            accountBrowser = null;
            continue;
          }

          if (nodeIp && browserIp && nodeIp !== browserIp) {
            this._recordProxyFailure(candidate, "egress_mismatch");
            this.setAccountStep(
              account,
              "proxy_rejected",
              `Proxy ${proxyIndex + 1}/${proxyUrls.length} rotates egress IP; trying next proxy`
            );
            await proxyDispatcher.close().catch(() => null);
            proxyDispatcher = null;
            job.workerBrowsers.delete(accountBrowser);
            await accountBrowser.close().catch(() => null);
            accountBrowser = null;
            continue;
          }

          proxyUrl = candidate;
          account.assignedProxyUrl = candidate;
          account.assignedProxyDispatcher = proxyDispatcher;
          this.setAccountStep(
            account,
            "proxy_assigned",
            `Proxy ${proxyIndex + 1}/${proxyUrls.length} verified${nodeIp ? ` (egress ${getIpFingerprint(nodeIp)})` : ""}`
          );
          break;
        }

        if (!accountBrowser || !proxyUrl) {
          throw new Error("No healthy sticky proxy available; all proxies are mismatched or quarantined");
        }
        await this.processAccount(job, account, workerId, accountBrowser);
        if (account.status === "success") this._recordProxySuccess(proxyUrl);
        if (/invalid_grant|Access denied/i.test(account.error || "")) {
          this._recordProxyFailure(proxyUrl, "invalid_grant");
        }
      } catch (error) {
        if (!String(account.status || "").startsWith("failed") && account.status !== "cancelled") {
          this.finalizeAccount(account, job.cancelRequested ? "cancelled" : "failed", {
            error: error.message || "Failed to launch account proxy browser",
            step: job.cancelRequested ? "cancelled" : "proxy_browser_failed",
            message: error.message || "Failed to launch account proxy browser",
          });
        }
      } finally {
        account.assignedProxyDispatcher = null;
        if (proxyDispatcher) await proxyDispatcher.close().catch(() => null);
        if (accountBrowser) {
          job.workerBrowsers.delete(accountBrowser);
          await accountBrowser.close().catch(() => null);
        }
      }
    }
  }

  /**
   * Request device code from auth.x.ai
   */
  async _requestDeviceCode(account) {
    this.setAccountStep(account, "requesting_device_code", "Requesting device code");
    
    try {
      const deviceData = await this.requestDeviceCode(
        account?.assignedProxyUrl || null,
        account?.assignedProxyDispatcher || null
      );
      
      if (!deviceData.device_code || !deviceData.verification_uri) {
        throw new Error("Invalid device code response");
      }

      account.deviceCode = deviceData.device_code;
      account.userCode = deviceData.user_code;
      // Prefer complete URI so user_code is bound in the URL (official device flow)
      account.verificationUri =
        deviceData.verification_uri_complete ||
        deviceData.verification_uri ||
        deviceData.verification_url;
      account.expiresIn = deviceData.expires_in || 900;
      account.pollIntervalSec = Number(deviceData.interval) > 0 ? Number(deviceData.interval) : 5;
      
      this.setAccountStep(
        account,
        "device_code_received",
        `Device code received: ${deviceData.user_code}`
      );

      return deviceData;
    } catch (error) {
      throw new Error(`Device code request failed: ${error.message}`);
    }
  }

  /**
   * Poll token via Node — same path as dashboard Providers OAuth (manual).
   * Device flow: issue + redeem on the CLI client; browser only authorizes.
   */
  async _pollTokenOnceServer(deviceCode, proxyUrl, proxyDispatcher) {
    const result = await this.pollDeviceToken(deviceCode, proxyUrl, proxyDispatcher);
    const data = result.data || {};
    if (data.access_token) {
      return {
        success: true,
        tokens: {
          accessToken: data.access_token,
          refreshToken: data.refresh_token || null,
          idToken: data.id_token || null,
          expiresIn: data.expires_in,
          scope: data.scope,
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          id_token: data.id_token,
          expires_in: data.expires_in,
        },
      };
    }
    return {
      success: false,
      error: data.error || "no_access_token",
      errorDescription: data.error_description || data.message,
      pending: data.error === "authorization_pending",
      slowDown: data.error === "slow_down",
    };
  }

  /**
   * Poll device code for token AFTER browser reaches /done.
   * Uses Node poll only (matches working manual Providers path).
   */
  async _pollForToken(job, account, deviceCode, page = null) {
    const code = String(deviceCode || "");
    if (code.length < 20) {
      throw new Error(
        `Refusing to poll with short code (len=${code.length}) — expected long device_code not user_code`
      );
    }

    const startTime = Date.now();
    const timeoutMs = this.config.pollTimeoutMs;
    let currentInterval = Math.max((account.pollIntervalSec || 5) * 1000, 5_000);
    const deviceCodeHint = `${code.slice(0, 8)}...${code.slice(-6)} (len=${code.length})`;

    this.setAccountStep(account, "polling_token", "Polling for authorization token");
    console.log(`[GrokCLI] Poll start device_code=${deviceCodeHint} via=node (manual path)`);

    // Settle after /done so xAI can bind the grant
    console.log("[GrokCLI] Post-authorize settle 5s before first poll");
    await wait(5_000);

    while (Date.now() - startTime < timeoutMs) {
      if (job.cancelRequested) {
        console.log("[GrokCLI] Poll aborted — job cancelled");
        throw new Error("Job cancelled");
      }

      try {
        console.log("[GrokCLI] Polling via Node pollForToken (same as Providers OAuth)...");
        const result = await this._pollTokenOnceServer(
          code,
          account?.assignedProxyUrl || null,
          account?.assignedProxyDispatcher || null
        );
        console.log(
          `[GrokCLI] Node poll: success=${result.success} error=${result.error || "-"} desc=${result.errorDescription || "-"}`
        );

        if (result.success && result.tokens) {
          this.setAccountStep(account, "token_received", "Authorization token received");
          console.log(`[GrokCLI] Token received!`, Object.keys(result.tokens));
          return result.tokens;
        }

        if (result.error === "slow_down" || result.slowDown) {
          currentInterval = Math.min(currentInterval + 5000, 30_000);
          console.log(`[GrokCLI] Rate limited - interval ${currentInterval}ms`);
          await wait(currentInterval);
          continue;
        }

        if (result.pending || result.error === "authorization_pending") {
          console.log(`[GrokCLI] Still pending authorization...`);
          await wait(currentInterval);
          continue;
        }

        if (result.error === "expired_token") {
          throw new Error("Device code expired — restart import for this account");
        }

        if (result.error === "invalid_grant" || result.error === "access_denied") {
          throw new Error(
            `invalid_grant after browser /done; retry with a fresh device_code and next proxy. ${result.errorDescription || result.error} | ${deviceCodeHint}`
          );
        }

        console.log(`[GrokCLI] Poll error:`, result.error, result.errorDescription);
        await wait(currentInterval);
      } catch (error) {
        if (
          error.message.includes("authorization_pending") ||
          error.message.includes("slow_down") ||
          error.message.includes("fetch failed")
        ) {
          console.log(`[GrokCLI] Poll transient: ${error.message}`);
          await wait(currentInterval);
          continue;
        }
        throw error;
      }
    }

    throw new Error("Token polling timeout - user did not complete authorization");
  }

  /**
   * Create promise that monitors device code polling
   */
  _createTokenPollingPromise(job, account, deviceCode, page = null) {
    return this._pollForToken(job, account, deviceCode, page);
  }

  /**
   * Process a single account (main automation logic)
   * 
   * @param {Object} job - Job state
   * @param {Object} account - Account being processed
   * @param {string} workerId - Worker ID
   * @param {Object} browser - Playwright browser instance
   */
  async processAccount(job, account, workerId, browser = job.browser) {
    if (job.cancelRequested || job.status === "cancelled" || !browser) {
      this.finalizeAccount(account, "cancelled", {
        error: "Job cancelled",
        step: "cancelled",
        message: "Job cancelled",
      });
      return;
    }

    account.workerId = workerId;
    this.setAccountStep(account, "starting", "Starting account automation");

    let context = null;
    let page = null;

    try {
      // CLI issues + redeems the device_code; browser handles user authorization.
      const deviceData = await this._requestDeviceCode(account);
      if (!deviceData.device_code || !(deviceData.verification_uri_complete || deviceData.verification_uri || account.verificationUri)) {
        throw new Error("Invalid device code response");
      }

      // Step 2: Browser for UI only
      this.setAccountStep(account, "launching_browser", "Launching browser context");
      const { context: newContext, page: newPage } = await createFreshContext(browser);
      context = newContext;
      page = newPage;

      // Store runtime session for preview
      account.runtimeSession = {
        context,
        page,
        workerId,
        deviceCode: deviceData.device_code,
        userCode: deviceData.user_code,
        verificationUri: account.verificationUri,
      };

      // Step 3: Browser UI only — DO NOT poll until /done.
      this.setAccountStep(account, "starting_automation", "Starting browser automation");
      console.log(
        `[GrokCLI] processAccount start | email=${account.email} | userCode=${deviceData.user_code} | device_code_len=${String(deviceData.device_code || "").length} | verify=${account.verificationUri} | pageClosed=${page?.isClosed?.()} | via=node`
      );

      const automationResult = await this.googleAutomation({
        page,
        verificationUri: account.verificationUri,
        userCode: deviceData.user_code,
        email: account.email,
        password: account.password,
        proxyUrl: account?.assignedProxyUrl || null,
        proxyDispatcher: account?.assignedProxyDispatcher || null,
        successPromise: null,
        shortTimeoutMs: this.config.shortTimeoutMs,
        onStep: (step, message) => {
          // Only /done (or explicit browser_authorized) means redeemable grant
          if (
            step === "device_done_page" ||
            step === "already_authorized" ||
            step === "browser_authorized" ||
            step === "success_page_reached"
          ) {
            account.browserAuthorized = true;
          }
          console.log(`[GrokCLI:STEP] ${account.email} | ${step} | ${message}`);
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      let pageUrl = "";
      try {
        pageUrl = page?.url?.() || "";
      } catch {
        pageUrl = "";
      }
      console.log(
        `[GrokCLI] automation done | email=${account.email} | status=${automationResult?.status} | browserAuthorized=${account.browserAuthorized} | pageUrl=${pageUrl} | error=${automationResult?.error || "-"} | pageClosed=${page?.isClosed?.()}`
      );
      if (
        account.browserAuthorized ||
        pageUrl.includes("/oauth2/device/done") ||
        automationResult?.browserAuthorized
      ) {
        account.browserAuthorized = true;
      }

      // Step 4: Poll token ONLY after browser authorize
      let tokensFromPoll =
        automationResult?.tokens ||
        (automationResult?.accessToken || automationResult?.access_token
          ? automationResult
          : null);

      if (
        !(tokensFromPoll?.accessToken || tokensFromPoll?.access_token) &&
        account.browserAuthorized
      ) {
        this.setAccountStep(account, "polling_token", "Polling token after browser authorize");
        console.log(
          `[GrokCLI] begin post-auth poll | device_code_len=${String(deviceData.device_code).length} | pageClosed=${page?.isClosed?.()}`
        );
        try {
          tokensFromPoll = await this._pollForToken(
            job,
            account,
            deviceData.device_code,
            page
          );
          console.log(
            `[GrokCLI] post-auth poll OK | keys=${tokensFromPoll ? Object.keys(tokensFromPoll).join(",") : "null"}`
          );
        } catch (error) {
          console.log(`[GrokCLI] Poll after authorize failed: ${error.message}`);
          tokensFromPoll = null;
          if (!automationResult?.error) {
            automationResult.error = error.message;
          }
        }
      } else if (!account.browserAuthorized) {
        console.log(
          `[GrokCLI] skip poll — browser not authorized | status=${automationResult?.status} | url=${pageUrl}`
        );
      }

      if (tokensFromPoll?.accessToken || tokensFromPoll?.access_token) {
        this.setAccountStep(account, "retrieving_tokens", "Saving authorization tokens");
        await this._saveConnection(job, account, tokensFromPoll);

        this.finalizeAccount(account, "success", {
          step: "completed",
          message: "Account imported successfully",
        });

      } else if (automationResult.status === "needs_manual") {
        // Manual assist — keep browser open; poll with page cookies after user finishes
        this.setAccountStep(
          account,
          "needs_manual_assist",
          automationResult.error || "Manual assistance required"
        );

        account.browserAuthorized = true; // allow post-auth poll semantics once user finishes
        const tokenPromise = this._pollForToken(job, account, deviceData.device_code, page);

        account.manualSession = {
          context,
          page,
          workerId,
          deviceCode: deviceData.device_code,
          userCode: deviceData.user_code,
          tokenPromise,
        };

        await this.runManualFollowup(job, account, workerId, context, tokenPromise);

      } else if (automationResult.status === "failed_invalid_credentials") {
        this.finalizeAccount(account, "failed_invalid_credentials", {
          error: automationResult.error || "Invalid Google credentials",
          step: "invalid_credentials",
          message: "Google rejected the email or password",
        });

      } else if (automationResult.status === "failed_restricted") {
        this.finalizeAccount(account, "failed_restricted", {
          error: automationResult.error || "Account is restricted",
          step: "account_restricted",
          message: "Account is restricted, suspended, or banned",
        });

      } else {
        // Generic failure
        const terminalStatus = String(automationResult.status || "").startsWith("failed")
          ? automationResult.status
          : "failed";
        this.finalizeAccount(account, terminalStatus, {
          error: automationResult.error || "Automation failed",
          step: "automation_failed",
          message: automationResult.error || "Browser automation failed",
        });
      }

    } catch (error) {
      if (job.cancelRequested || error?.code === "PAGE_CLOSED" || /cancelled|closed/i.test(error?.message || "")) {
        this.finalizeAccount(account, "cancelled", {
          error: "Job cancelled",
          step: "cancelled",
          message: error.message || "Job cancelled",
        });
      } else {
        this.finalizeAccount(account, "failed", {
          error: error.message || "Unknown error",
          step: "exception",
          message: error.message || "An unexpected error occurred",
        });
      }

    } finally {
      // Always drop runtime session; close context unless manual assist still needs it
      if (!account.manualSession && context) {
        await context.close().catch(() => null);
      }
      if (job.cancelRequested && account.manualSession?.context) {
        await account.manualSession.context.close().catch(() => null);
        account.manualSession = null;
      }

      account.runtimeSession = null;
      account.workerId = null;

      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }

  /**
   * Run manual followup for accounts needing manual assistance
   */
  async runManualFollowup(job, account, workerId, context, tokenPromise) {
    const followupPromise = (async () => {
      try {
        this.setAccountStep(
          account,
          "waiting_manual_completion",
          "Waiting for manual completion in browser"
        );

        // Wait for token promise to resolve (user completes in browser)
        const tokens = await tokenPromise;

        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
          await this.persistJobSnapshot(job, { forcePreview: true });
          return;
        }

        // Save connection
        await this._saveConnection(job, account, tokens);
        
        this.finalizeAccount(account, "success", {
          step: "completed_manual",
          message: "Account imported successfully (manual assist)",
        });

        await this.persistJobSnapshot(job, { forcePreview: true });

      } catch (error) {
        if (job.cancelRequested) {
          this.finalizeAccount(account, "cancelled", {
            error: "Job cancelled",
            step: "cancelled",
            message: "Job cancelled while waiting for manual completion",
          });
        } else {
          this.finalizeAccount(account, "failed", {
            error: error.message || "Manual assist flow failed",
            step: "manual_failed",
            message: error.message || "Manual assist flow failed",
          });
        }
        await this.persistJobSnapshot(job, { forcePreview: true });

      } finally {
        // Clean up manual session
        if (account.manualSession?.context) {
          await account.manualSession.context.close().catch(() => null);
        }
        account.manualSession = null;
        account.runtimeSession = null;
        job.manualFollowups?.delete?.(followupPromise);
        await this.persistJobSnapshot(job, { forcePreview: true });
      }
    })();

    if (!job.manualFollowups) {
      job.manualFollowups = new Set();
    }
    job.manualFollowups.add(followupPromise);
  }

  /**
   * Save connection to database
   */
  async _saveConnection(job, account, tokens) {
    this.setAccountStep(account, "saving_connection", "Saving connection to database");

    try {
      const result = await this.saveConnection({
        tokens,
        email: account.email,
      });

      account.connectionId = result.connection.id;
      
      this.setAccountStep(
        account,
        "connection_saved",
        `Connection saved: ${result.connection.id}`
      );

    } catch (error) {
      throw new Error(`Failed to save connection: ${error.message}`);
    }
  }
}

/**
 * Process-wide singleton (survives Next.js HMR). Module-level let loses in-memory
 * jobs after hot reload → cancel/status hit a fresh manager while workers still run.
 */
function getGrokCliSingletonStore() {
  if (!globalThis.__grokCliBulkImportSingleton) {
    globalThis.__grokCliBulkImportSingleton = { manager: null };
  }
  return globalThis.__grokCliBulkImportSingleton;
}

/**
 * Get or create singleton instance
 */
export function getGrokCliBulkImportManager() {
  const store = getGrokCliSingletonStore();
  if (!store.manager) {
    store.manager = new GrokCliBulkImportManager();
  }
  store.manager.refreshRuntimeDefaults?.({ googleAutomation: runGrokCliGoogleAutomation });
  return store.manager;
}

/**
 * Reset singleton (for testing)
 */
export function _resetGrokCliBulkImportManager() {
  const store = getGrokCliSingletonStore();
  store.manager = null;
}
