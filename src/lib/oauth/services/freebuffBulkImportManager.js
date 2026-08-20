/**
 * Freebuff Bulk Import Manager
 *
 * Automates bulk import of Freebuff accounts using Google SSO + device flow.
 * Extends KiroBulkImportManager with the Freebuff-specific flow:
 *
 *   1. HTTP  POST /api/auth/cli/code  → fingerprintId + loginUrl (auth_code)
 *   2. Browser: Google login (email + password + consent)
 *   3. Browser: codebuff.com/login?auth_code=XXX → "Continue with Google"
 *   4. Browser: account chooser + OAuth consent → /onboard
 *   5. HTTP  GET  /api/auth/cli/status → authToken (bearer)
 *   6. Save provider connection to database
 */

import {
  KiroBulkImportManager,
  parseKiroBulkAccounts,
  createFreshContext,
} from "./kiroBulkImportManager.js";
import {
  runFreebuffGoogleAutomation,
  requestFreebuffDeviceCode,
  pollFreebuffToken,
} from "./freebuff.js";

const FREEBUFF_PROVIDER_ID = "freebuff";
const FREEBUFF_LABEL = "Freebuff";
const FREEBUFF_BULK_CONFIG = {
  shortTimeoutMs: 20_000,
  pollTimeoutMs: 120_000,
  pollIntervalMs: 2_000,
};

async function defaultFreebuffBrowserLauncher(job) {
  const { launchBulkImportBrowser } = await import("./bulkImportBrowserEngine.js");
  return launchBulkImportBrowser({
    engine: job?.engine || "chromium",
    proxyUrl: job?.proxyUrl || undefined,
    headless: false,
    args: ["--start-maximized"],
  });
}

async function defaultSaveFreebuffConnection({ tokens, email }) {
  const { createProviderConnection } = await import("../../../models/index.js");
  const token = tokens?.token || tokens?.accessToken || tokens?.access_token;
  if (!token) throw new Error("No Freebuff authToken in result");

  const connection = await createProviderConnection({
    provider: FREEBUFF_PROVIDER_ID,
    authType: "oauth",
    accessToken: token,
    email: email || tokens?.email || null,
    displayName: tokens?.displayName || null,
    providerSpecificData: {
      ...(tokens?.providerSpecificData || {}),
      authMethod: "device_code_google_sso",
      automation: "gsuite-bulk",
      loginEmail: email,
      userId: tokens?.userId || null,
    },
    testStatus: "active",
  });
  return { connection };
}

export class FreebuffBulkImportManager extends KiroBulkImportManager {
  constructor({
    browserLauncher = defaultFreebuffBrowserLauncher,
    googleAutomation = runFreebuffGoogleAutomation,
    requestDeviceCode = requestFreebuffDeviceCode,
    pollToken = pollFreebuffToken,
    saveConnection = defaultSaveFreebuffConnection,
    storageName = "freebuff-bulk-import",
  } = {}) {
    super({
      browserLauncher,
      googleAutomation,
      socialExchange: null,
      storageName,
    });
    this.requestDeviceCode = requestDeviceCode;
    this.pollToken = pollToken;
    this.saveConnection = saveConnection;
    this.config = FREEBUFF_BULK_CONFIG;
  }

  refreshRuntimeDefaults({ googleAutomation } = {}) {
    this.requestDeviceCode = requestFreebuffDeviceCode;
    this.pollToken = pollFreebuffToken;
    this.saveConnection = defaultSaveFreebuffConnection;
    if (googleAutomation) this.googleAutomation = googleAutomation;
  }

  async startJob(opts = {}) {
    return super.startJob({
      ...opts,
      concurrency: 1,
    });
  }

  /**
   * Process a single account through the full Freebuff flow.
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
    this.setAccountStep(account, "starting", "Starting Freebuff account automation");

    let context = null;
    let page = null;

    try {
      // Step 1: HTTP device flow
      this.setAccountStep(account, "requesting_device_code", "Requesting Freebuff device flow");
      const deviceData = await this.requestDeviceCode({
        proxyUrl: account?.assignedProxyUrl || job.proxyUrl || null,
        proxyDispatcher: account?.assignedProxyDispatcher || null,
      });
      if (!deviceData.authCode) {
        throw new Error("Freebuff device flow response missing authCode");
      }
      account.deviceCode = deviceData.fingerprintId;
      account.authCode = deviceData.authCode;
      account.fingerprint = deviceData;

      this.setAccountStep(
        account,
        "device_code_received",
        "Freebuff device flow ready, launching browser"
      );

      // Step 2: Fresh browser context for Google SSO
      const { context: newContext, page: newPage } = await createFreshContext(browser);
      context = newContext;
      page = newPage;

      account.runtimeSession = {
        context,
        page,
        workerId,
        fingerprint: deviceData,
        authCode: deviceData.authCode,
      };

      // Step 3: Browser automation (Google login → Freebuff login → consent)
      this.setAccountStep(account, "starting_automation", "Starting Freebuff browser automation");
      const automationResult = await this.googleAutomation({
        page,
        email: account.email,
        password: account.password,
        authCode: deviceData.authCode,
        baseUrl: "https://www.codebuff.com",
        proxyUrl: account?.assignedProxyUrl || job.proxyUrl || null,
        proxyDispatcher: account?.assignedProxyDispatcher || null,
        shortTimeoutMs: this.config.shortTimeoutMs,
        onStep: (step, message) => {
          if (step === "success_page_reached" || step === "browser_authorized") {
            account.browserAuthorized = true;
          }
          console.log(`[Freebuff:STEP] ${account.email} | ${step} | ${message}`);
          this.setAccountStep(account, step, message);
          void this.persistJobSnapshot(job, { forcePreview: false });
        },
      });

      if (automationResult?.status === "failed_invalid_credentials") {
        this.finalizeAccount(account, "failed_invalid_credentials", {
          error: automationResult.error || "Invalid Google credentials",
          step: "invalid_credentials",
          message: "Google rejected the email or password",
        });
        return;
      }

      if (automationResult?.status === "failed_restricted") {
        this.finalizeAccount(account, "failed_restricted", {
          error: automationResult.error || "Account is restricted",
          step: "account_restricted",
          message: "Account is restricted, suspended, or banned",
        });
        return;
      }

      if (automationResult?.status === "failed") {
        this.finalizeAccount(account, "failed", {
          error: automationResult.error || "Automation failed",
          step: "automation_failed",
          message: automationResult.error || "Freebuff browser automation failed",
        });
        return;
      }

      // Step 4: Poll for authToken via HTTP
      if (account.browserAuthorized || automationResult?.browserAuthorized) {
        this.setAccountStep(account, "polling_token", "Polling Freebuff for authToken");
        const tokenData = await this.pollToken(deviceData, {
          proxyUrl: account?.assignedProxyUrl || job.proxyUrl || null,
          proxyDispatcher: account?.assignedProxyDispatcher || null,
          timeoutMs: this.config.pollTimeoutMs,
          intervalMs: this.config.pollIntervalMs,
        });
        account.tokens = tokenData;

        this.setAccountStep(account, "token_received", "Freebuff authToken received");
        await this._saveConnection(job, account, tokenData);

        this.finalizeAccount(account, "success", {
          step: "completed",
          message: "Freebuff account imported successfully",
        });
      } else {
        this.finalizeAccount(account, "needs_manual", {
          error: automationResult?.error || "Manual assistance required",
          step: "needs_manual_assist",
          message: automationResult?.error || "Browser did not complete OAuth automatically",
        });
      }

    } catch (error) {
      if (job.cancelRequested || /cancelled|closed/i.test(error?.message || "")) {
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
      if (context) {
        await context.close().catch(() => null);
      }
      account.runtimeSession = null;
      account.workerId = null;
      await this.persistJobSnapshot(job, { forcePreview: true });
    }
  }

  async _saveConnection(job, account, tokens) {
    this.setAccountStep(account, "saving_connection", "Saving Freebuff connection to database");
    try {
      const result = await this.saveConnection({
        tokens,
        email: account.email,
      });
      account.connectionId = result.connection.id;
      this.setAccountStep(account, "connection_saved", `Connection saved: ${result.connection.id}`);
    } catch (error) {
      throw new Error(`Failed to save connection: ${error.message}`);
    }
  }
}

function getFreebuffSingletonStore() {
  if (!globalThis.__freebuffBulkImportSingleton) {
    globalThis.__freebuffBulkImportSingleton = { manager: null };
  }
  return globalThis.__freebuffBulkImportSingleton;
}

/**
 * Get or create singleton instance (survives Next.js HMR).
 */
export function getFreebuffBulkImportManager() {
  const store = getFreebuffSingletonStore();
  if (!store.manager) {
    store.manager = new FreebuffBulkImportManager();
  }
  store.manager.refreshRuntimeDefaults?.({ googleAutomation: runFreebuffGoogleAutomation });
  return store.manager;
}

/**
 * Reset singleton (for testing).
 */
export function _resetFreebuffBulkImportManager() {
  getFreebuffSingletonStore().manager = null;
}
